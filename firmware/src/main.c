/**
 * Illy Bridge Firmware — Freenove ESP32-S3 FNK0086
 *
 * Portable calibration bridge for Echo Vue / Echo Maps.
 * Hardware: ESP32-S3 + OV2640 camera + I2S mic + I2S speaker + ST7789 LCD
 *
 * Flow:
 *   1. Boot → WiFi provisioning (stored creds or SoftAP fallback)
 *   2. mDNS advertisement as "_illybridge._tcp" for local discovery
 *   3. HTTP API server for Echo Vue web app commands
 *   4. LCD UI for walk-through calibration mode
 *   5. Camera + Mic + CSI capture → streamed to cloud AI engine
 *   6. LED status: Blue=calibrating, Green=monitoring, Red=offline
 */

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_tls.h"
#include "esp_mac.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "mdns.h"
#include "driver/gpio.h"
#include "driver/ledc.h"

/* Local modules */
#include "lcd_ui.h"
#include "camera_capture.h"
#include "bridge_httpd.h"
#include "audio_io.h"

/* ── Configuration ── */
#define ILLY_BRIDGE_VERSION       "2.0.0"
#define CSI_DEFAULT_SAMPLE_RATE   100   /* Hz */
#define CLOUD_HOST                "api.echomaps.illyrobotics.com"
#define CLOUD_PORT                8443
#define PACKET_MAGIC              0x494C  /* "IL" */
#define WIFI_SOFTAP_SSID          "IllyBridge-Setup"
#define WIFI_MAX_RETRY            10
#define MDNS_SERVICE_TYPE         "_illybridge"
#define MDNS_SERVICE_PROTO        "_tcp"
#define MDNS_SERVICE_PORT         80

/* LED GPIO pins — avoid camera (4,5,6-13,15-18), I2S (2,40-42), LCD (0,20,21)
 * NOTE: GPIO1 conflicts with FT6336U touch SCL — reassign if touch is wired */
#define LED_BLUE_PIN   GPIO_NUM_1
#define LED_GREEN_PIN  GPIO_NUM_3
#define LED_RED_PIN    GPIO_NUM_46

/* WiFi event group bits */
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

/* ── Bridge Status ── */
typedef enum {
    BRIDGE_IDLE         = 0x00,
    BRIDGE_CALIBRATING  = 0x01,  /* Blue LED */
    BRIDGE_MONITORING   = 0x02,  /* Green LED */
    BRIDGE_OFFLINE      = 0x03,  /* Red LED */
    BRIDGE_OTA          = 0x04,
    BRIDGE_PROVISIONING = 0x05,  /* SoftAP mode */
    BRIDGE_ERROR        = 0xFF,
} bridge_status_t;

/* ── Calibration mode ── */
typedef enum {
    CAL_MODE_IDLE = 0,
    CAL_MODE_ROOM_SCAN,       /* Camera + mic + CSI capture */
    CAL_MODE_PRESENCE_DETECT, /* CSI + mic for presence */
    CAL_MODE_UPLOADING,       /* Sending data to cloud */
} calibration_mode_t;

static const char *TAG = "illy-bridge";
static bridge_status_t current_status = BRIDGE_OFFLINE;
static calibration_mode_t cal_mode = CAL_MODE_IDLE;
static int csi_sample_rate_hz = CSI_DEFAULT_SAMPLE_RATE;
static EventGroupHandle_t s_wifi_event_group;
static int s_wifi_retry_count = 0;
static char bridge_device_id[18] = {0};  /* MAC-based ID */
char current_room_name[64] = {0};
static char bound_user_id[128] = {0};
static bool is_user_bound = false;

/* Cloud connection state */
static esp_tls_t *cloud_tls = NULL;
static bool cloud_connected = false;

/* CSI frame queue for streaming */
static QueueHandle_t csi_queue = NULL;
#define CSI_QUEUE_SIZE 32

typedef struct {
    int64_t timestamp_us;
    int8_t  rssi;
    uint8_t n_sub;
    uint8_t antenna_config;
    int8_t  csi_data[512]; /* max 256 subcarriers × 2 antennas */
    uint16_t data_len;
} csi_frame_t;

/* ── Forward declarations ── */
static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data);
static void wifi_init_sta(const char *ssid, const char *pass);
static void wifi_init_softap(void);
static void init_mdns(void);
static void generate_device_id(void);
static void cloud_connect_task(void *arg);
static void csi_stream_task(void *arg);
static void calibration_task(void *arg);

/* ── LED Control ── */
static void set_led_status(bridge_status_t status) {
    gpio_set_level(LED_BLUE_PIN, status == BRIDGE_CALIBRATING ? 1 : 0);
    gpio_set_level(LED_GREEN_PIN, (status == BRIDGE_MONITORING || status == BRIDGE_IDLE) ? 1 : 0);
    gpio_set_level(LED_RED_PIN, (status == BRIDGE_OFFLINE || status == BRIDGE_ERROR) ? 1 : 0);
    current_status = status;
}

static void init_leds(void) {
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << LED_BLUE_PIN) | (1ULL << LED_GREEN_PIN) | (1ULL << LED_RED_PIN),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
    set_led_status(BRIDGE_OFFLINE);
}

/* ── CSI Callback ── */
static void wifi_csi_cb(void *ctx, wifi_csi_info_t *info) {
    if (info == NULL || info->buf == NULL) return;
    if (current_status != BRIDGE_CALIBRATING && current_status != BRIDGE_MONITORING) return;

    csi_frame_t frame = {0};
    frame.timestamp_us = esp_timer_get_time();
    frame.rssi = info->rx_ctrl.rssi;
    frame.n_sub = info->len / 2;  /* I/Q pairs */
    frame.antenna_config = 0x22;  /* 2x2 MIMO */
    frame.data_len = info->len > (int)sizeof(frame.csi_data) ? (int)sizeof(frame.csi_data) : info->len;
    memcpy(frame.csi_data, info->buf, frame.data_len);

    /* Non-blocking enqueue — drop oldest if full */
    if (csi_queue != NULL) {
        xQueueSend(csi_queue, &frame, 0);
    }
}

/* ── WiFi ── */
static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_wifi_retry_count < WIFI_MAX_RETRY) {
            esp_wifi_connect();
            s_wifi_retry_count++;
            ESP_LOGI(TAG, "Retrying WiFi connection (%d/%d)", s_wifi_retry_count, WIFI_MAX_RETRY);
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
            ESP_LOGW(TAG, "WiFi connection failed — switching to SoftAP provisioning");
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "Connected! IP: " IPSTR, IP2STR(&event->ip_info.ip));
        s_wifi_retry_count = 0;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

static void wifi_init_sta(const char *ssid, const char *pass) {
    s_wifi_event_group = xEventGroupCreate();

    /* netif, event loop, and wifi are now initialized in app_main() */

    esp_event_handler_instance_t inst_any_id;
    esp_event_handler_instance_t inst_got_ip;
    esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, &inst_any_id);
    esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, &inst_got_ip);

    wifi_config_t wifi_config = {0};
    strncpy((char *)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid) - 1);
    strncpy((char *)wifi_config.sta.password, pass, sizeof(wifi_config.sta.password) - 1);
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_set_config(WIFI_IF_STA, &wifi_config);

    /* Enable CSI collection */
    wifi_csi_config_t csi_config = {
        .lltf_en = true,
        .htltf_en = true,
        .stbc_htltf2_en = true,
        .ltf_merge_en = true,
        .channel_filter_en = false,
        .manu_scale = false,
        .shift = false,
    };
    esp_wifi_set_csi_config(&csi_config);
    esp_wifi_set_csi_rx_cb(wifi_csi_cb, NULL);
    esp_wifi_set_csi(true);

    esp_wifi_start();

    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
        WIFI_CONNECTED_BIT | WIFI_FAIL_BIT, pdFALSE, pdFALSE, portMAX_DELAY);

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "WiFi connected to %s", ssid);
        set_led_status(BRIDGE_IDLE);

        /* Get IP for LCD display */
        esp_netif_ip_info_t ip_info;
        esp_netif_t *sta_netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
        char ip_str[20] = {0};
        if (sta_netif && esp_netif_get_ip_info(sta_netif, &ip_info) == ESP_OK) {
            snprintf(ip_str, sizeof(ip_str), IPSTR, IP2STR(&ip_info.ip));
        }
        lcd_set_wifi_status(true, ssid, ip_str);
        lcd_show_status("WiFi Connected", ssid);
    } else {
        ESP_LOGW(TAG, "WiFi failed — entering SoftAP + WiFi Setup");
        wifi_init_softap();
    }
}

static void wifi_init_softap(void) {
    set_led_status(BRIDGE_PROVISIONING);

    /* Stop STA mode if running (ignore error for direct call) */
    esp_wifi_stop();
    wifi_config_t ap_config = {
        .ap = {
            .ssid = WIFI_SOFTAP_SSID,
            .ssid_len = strlen(WIFI_SOFTAP_SSID),
            .channel = 1,
            .authmode = WIFI_AUTH_OPEN,
            .max_connection = 2,
        },
    };
    /* Use APSTA so we can scan while serving SoftAP */
    esp_wifi_set_mode(WIFI_MODE_APSTA);
    esp_wifi_set_config(WIFI_IF_AP, &ap_config);
    esp_wifi_start();

    ESP_LOGI(TAG, "SoftAP started: %s (open http://192.168.4.1 to configure)", WIFI_SOFTAP_SSID);

    /* Now WiFi is started — trigger LCD WiFi scan */
    lcd_enter_wifi_setup();
}

/* ── mDNS ── */
static void init_mdns(void) {
    esp_err_t err = mdns_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "mDNS init failed: %s", esp_err_to_name(err));
        return;
    }

    mdns_hostname_set("illy-bridge");
    mdns_instance_name_set("Illy Bridge - Echo Vue");

    /* Advertise as _illybridge._tcp so Echo Vue web app can discover us */
    mdns_service_add("Illy Bridge", MDNS_SERVICE_TYPE, MDNS_SERVICE_PROTO, MDNS_SERVICE_PORT, NULL, 0);

    /* Add TXT records for device info */
    mdns_txt_item_t txt[] = {
        {"version", ILLY_BRIDGE_VERSION},
        {"device_id", bridge_device_id},
        {"has_camera", "true"},
        {"has_mic", "true"},
        {"has_speaker", "true"},
        {"has_lcd", "true"},
    };
    mdns_service_txt_set(MDNS_SERVICE_TYPE, MDNS_SERVICE_PROTO, txt, 6);

    ESP_LOGI(TAG, "mDNS: advertising as illy-bridge.local (%s._illybridge._tcp)", bridge_device_id);
}

/* ── Device ID from MAC ── */
static void generate_device_id(void) {
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(bridge_device_id, sizeof(bridge_device_id),
             "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    ESP_LOGI(TAG, "Bridge Device ID: %s", bridge_device_id);
}

/* ── Cloud TLS connection task ── */
static void cloud_connect_task(void *arg) {
    while (1) {
        if (current_status == BRIDGE_OFFLINE || current_status == BRIDGE_PROVISIONING) {
            vTaskDelay(pdMS_TO_TICKS(5000));
            continue;
        }

        if (!cloud_connected) {
            ESP_LOGI(TAG, "Connecting to cloud: %s:%d", CLOUD_HOST, CLOUD_PORT);
            esp_tls_cfg_t cfg = {
                .skip_common_name = false,
            };
            cloud_tls = esp_tls_init();
            if (esp_tls_conn_new_sync(CLOUD_HOST, strlen(CLOUD_HOST), CLOUD_PORT, &cfg, cloud_tls) == 1) {
                cloud_connected = true;
                ESP_LOGI(TAG, "Cloud TLS connected");
                lcd_show_status("Cloud Connected", CLOUD_HOST);
            } else {
                ESP_LOGW(TAG, "Cloud connection failed, retrying in 10s");
                esp_tls_conn_destroy(cloud_tls);
                cloud_tls = NULL;
            }
        }
        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}

/* ── CSI streaming task — forwards queued frames to cloud ── */
static void csi_stream_task(void *arg) {
    csi_frame_t frame;
    while (1) {
        if (xQueueReceive(csi_queue, &frame, pdMS_TO_TICKS(100)) == pdTRUE) {
            if (cloud_connected && cloud_tls != NULL) {
                /* Build IL packet header */
                uint8_t header[16];
                header[0] = 0x49; header[1] = 0x4C; /* "IL" magic */
                header[2] = 0x02; /* version 2 */
                header[3] = 0x01; /* CSI_FRAME event */
                /* sequence number (simplified) */
                static uint32_t seq = 0;
                seq++;
                header[4] = (seq >> 24) & 0xFF;
                header[5] = (seq >> 16) & 0xFF;
                header[6] = (seq >> 8)  & 0xFF;
                header[7] = seq & 0xFF;
                /* payload length */
                uint32_t plen = 12 + frame.data_len;
                header[8]  = (plen >> 24) & 0xFF;
                header[9]  = (plen >> 16) & 0xFF;
                header[10] = (plen >> 8)  & 0xFF;
                header[11] = plen & 0xFF;

                esp_tls_conn_write(cloud_tls, header, 12);
                esp_tls_conn_write(cloud_tls, (uint8_t *)&frame, 12 + frame.data_len);
            }
        }
    }
}

/* ── Calibration task — orchestrates room scan ── */
static void calibration_task(void *arg) {
    while (1) {
        if (cal_mode == CAL_MODE_ROOM_SCAN && current_status == BRIDGE_CALIBRATING) {
            /* Capture camera frame */
            camera_frame_t *cam_frame = camera_capture_frame();
            if (cam_frame != NULL) {
                /* Capture audio snippet (200ms) for room acoustics */
                audio_sample_t *audio = audio_capture_snippet(200);

                /* Package and send to cloud:
                 * Camera frame for visual calibration (skeleton extraction)
                 * Audio for room acoustic fingerprinting
                 * CSI frames arrive via csi_stream_task
                 */
                if (cloud_connected && cloud_tls != NULL) {
                    /* Camera payload: event 0x10 (CAMERA_FRAME) */
                    bridge_send_camera_frame(cloud_tls, cam_frame, current_room_name);
                    if (audio != NULL) {
                        bridge_send_audio_sample(cloud_tls, audio, current_room_name);
                        audio_free_sample(audio);
                    }
                }
                camera_free_frame(cam_frame);
            }

            /* Update LCD with calibration progress */
            lcd_show_calibrating(current_room_name, cal_mode);

            /* ~10 fps for camera during calibration */
            vTaskDelay(pdMS_TO_TICKS(100));

        } else if (cal_mode == CAL_MODE_PRESENCE_DETECT) {
            /* Presence detection: CSI + mic only (no camera) */
            audio_sample_t *audio = audio_capture_snippet(500);
            if (audio != NULL && cloud_connected) {
                bridge_send_audio_sample(cloud_tls, audio, current_room_name);
                audio_free_sample(audio);
            }
            lcd_show_presence_scan(current_room_name);
            vTaskDelay(pdMS_TO_TICKS(500));

        } else {
            vTaskDelay(pdMS_TO_TICKS(200));
        }
    }
}

/* ── NVS helpers for WiFi credentials ── */
static bool load_wifi_creds(char *ssid, size_t ssid_len, char *pass, size_t pass_len) {
    nvs_handle_t nvs;
    if (nvs_open("wifi", NVS_READONLY, &nvs) != ESP_OK) return false;
    esp_err_t e1 = nvs_get_str(nvs, "ssid", ssid, &ssid_len);
    esp_err_t e2 = nvs_get_str(nvs, "pass", pass, &pass_len);
    nvs_close(nvs);
    return (e1 == ESP_OK && e2 == ESP_OK && strlen(ssid) > 0);
}

void save_wifi_creds(const char *ssid, const char *pass) {
    nvs_handle_t nvs;
    if (nvs_open("wifi", NVS_READWRITE, &nvs) != ESP_OK) return;
    nvs_set_str(nvs, "ssid", ssid);
    nvs_set_str(nvs, "pass", pass);
    nvs_commit(nvs);
    nvs_close(nvs);
    ESP_LOGI(TAG, "WiFi credentials saved to NVS");
}

/* ── Public API for HTTP server ── */
bridge_status_t get_bridge_status(void) { return current_status; }
const char *get_bridge_device_id(void) { return bridge_device_id; }
const char *get_bridge_version(void) { return ILLY_BRIDGE_VERSION; }
bool get_bridge_bound(void) { return is_user_bound; }
const char *get_bound_user_id(void) { return bound_user_id; }

void bridge_bind_user(const char *user_id) {
    strncpy(bound_user_id, user_id, sizeof(bound_user_id) - 1);
    is_user_bound = true;
    lcd_show_status("User Bound", user_id);
    ESP_LOGI(TAG, "Bridge bound to user: %s", user_id);
}

void bridge_unbind_user(void) {
    memset(bound_user_id, 0, sizeof(bound_user_id));
    is_user_bound = false;
    lcd_show_status("Unbound", "Waiting for user...");
}

void bridge_start_room_calibration(const char *room_name) {
    strncpy(current_room_name, room_name, sizeof(current_room_name) - 1);
    cal_mode = CAL_MODE_ROOM_SCAN;
    set_led_status(BRIDGE_CALIBRATING);
    lcd_show_calibrating(room_name, CAL_MODE_ROOM_SCAN);
    ESP_LOGI(TAG, "Room calibration started: %s", room_name);
}

void bridge_start_presence_scan(const char *room_name) {
    strncpy(current_room_name, room_name, sizeof(current_room_name) - 1);
    cal_mode = CAL_MODE_PRESENCE_DETECT;
    set_led_status(BRIDGE_CALIBRATING);
    lcd_show_presence_scan(room_name);
    ESP_LOGI(TAG, "Presence scan started: %s", room_name);
}

void bridge_stop_calibration(void) {
    cal_mode = CAL_MODE_IDLE;
    set_led_status(BRIDGE_IDLE);
    lcd_show_status("Calibration Done", current_room_name);
    ESP_LOGI(TAG, "Calibration stopped for room: %s", current_room_name);
}

/* ── Main ── */
void app_main(void) {
    ESP_LOGI(TAG, "Illy Bridge v%s (FNK0086) starting...", ILLY_BRIDGE_VERSION);

    /* Initialize NVS */
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }

    /* Generate device ID from MAC */
    generate_device_id();

    /* Initialize hardware — camera FIRST so it grabs its GDMA channel
       before SPI LCD init (avoids DMA channel conflict on ESP32-S3) */
    init_leds();
    camera_init();
    audio_init();

    lcd_init();
    lcd_show_boot(ILLY_BRIDGE_VERSION, bridge_device_id);

    /* Create CSI queue */
    csi_queue = xQueueCreate(CSI_QUEUE_SIZE, sizeof(csi_frame_t));

    /* Common network / WiFi init — must happen before either STA or AP path */
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    esp_netif_create_default_wifi_ap();

    wifi_init_config_t wifi_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wifi_cfg));

    /* Try stored WiFi credentials, fallback to SoftAP provisioning */
    char ssid[33] = {0}, pass[65] = {0};
    if (load_wifi_creds(ssid, sizeof(ssid), pass, sizeof(pass))) {
        ESP_LOGI(TAG, "Found stored WiFi: %s", ssid);
        lcd_show_status("Connecting...", ssid);
        wifi_init_sta(ssid, pass);
    } else {
        ESP_LOGI(TAG, "No WiFi credentials — starting WiFi Setup");
        wifi_init_softap();
    }

    /* Start mDNS for local network discovery */
    if (current_status != BRIDGE_PROVISIONING) {
        init_mdns();
    }

    /* Start HTTP server for Echo Vue local communication */
    bridge_httpd_start();

    /* Start background tasks */
    xTaskCreatePinnedToCore(cloud_connect_task, "cloud_conn", 4096, NULL, 3, NULL, 0);
    xTaskCreatePinnedToCore(csi_stream_task, "csi_stream", 4096, NULL, 5, NULL, 1);
    xTaskCreatePinnedToCore(calibration_task, "cal_task", 8192, NULL, 4, NULL, 1);

    ESP_LOGI(TAG, "Bridge ready. Device ID: %s", bridge_device_id);

    /* Enter appropriate screen */
    if (current_status == BRIDGE_PROVISIONING) {
        /* WiFi setup is already showing */
    } else {
        lcd_set_wifi_status(true, ssid, "");
        lcd_enter_dashboard();
    }

    /* Main loop — button handling + LCD refresh */
    while (1) {
        lcd_handle_input();
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
