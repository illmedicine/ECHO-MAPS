/**
 * Illy Bridge Firmware — Freenove ESP32-S3 FNK0086
 *
 * Portable calibration bridge for Echo Vue / Echo Maps.
 * Hardware: ESP32-S3 + I2S mic + I2S speaker + ST7789 LCD
 *
 * Flow:
 *   1. Boot → WiFi provisioning (stored creds or SoftAP fallback)
 *   2. mDNS advertisement as "_illybridge._tcp" for local discovery
 *   3. HTTP API server for Echo Vue web app commands
 *   4. LCD UI for walk-through calibration mode
 *   5. Continuous WiFi CSI presence sensing (public areas) → HTTPS to Echo Maps API
 *   6. LED status: Green=monitoring, Red=offline
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
#include "esp_mac.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "mdns.h"
#include "driver/gpio.h"
#include "driver/ledc.h"

/* Local modules */
#include "lcd_ui.h"
#include "presence_csi.h"
#include "bridge_httpd.h"
#include "audio_io.h"

/* ── Configuration ── */
#define ILLY_BRIDGE_VERSION       "2.0.0"
#define CSI_DEFAULT_SAMPLE_RATE   100   /* Hz */
#define PACKET_MAGIC              0x494C  /* "IL" */
#define WIFI_SOFTAP_SSID          "IllyBridge-Setup"
#define WIFI_MAX_RETRY            10
#define MDNS_SERVICE_TYPE         "_illybridge"
#define MDNS_SERVICE_PROTO        "_tcp"
#define MDNS_SERVICE_PORT         80

/* LED GPIO pins — avoid I2S (2,40-42), LCD (0,20,21)
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
    CAL_MODE_CALIBRATE,        /* legacy manual calibration */
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

/* ── Forward declarations ── */
static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data);
static void wifi_init_sta(const char *ssid, const char *pass);
static void wifi_init_softap(void);
static void init_mdns(void);
static void generate_device_id(void);

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

/* ── Captive portal auto-login (Motel 6 access code) ── */
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "secrets.h"

static char s_pbuf[1024];
static int s_plen;
static esp_err_t portal_evt(esp_http_client_event_t *e) {
    if (e->event_id == HTTP_EVENT_ON_DATA && e->data_len > 0) {
        int room = (int)sizeof(s_pbuf) - 1 - s_plen;
        int n = e->data_len < room ? e->data_len : room;
        memcpy(s_pbuf + s_plen, e->data, n);
        s_plen += n;
        s_pbuf[s_plen] = 0;
    }
    return ESP_OK;
}

/* Returns true if internet is reachable (generate_204 answers 204). */
static bool portal_online(void) {
    s_plen = 0; s_pbuf[0] = 0;
    esp_http_client_config_t cfg = {
        .url = "http://connectivitycheck.gstatic.com/generate_204",
        .event_handler = portal_evt,
        .disable_auto_redirect = true,
        .timeout_ms = 8000,
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    esp_err_t err = esp_http_client_perform(c);
    int status = esp_http_client_get_status_code(c);
    esp_http_client_cleanup(c);
    return err == ESP_OK && status == 204;
}

static void portal_login(void) {
    /* The portal redirect carries the portal base URL, e.g. https://host:1112/web/... */
    char base[96] = {0};
    char *u = strstr(s_pbuf, "URL=");
    if (u) {
        u += 4;
        char *end = strstr(u, "/web/");
        if (end && (end - u) < (int)sizeof(base)) memcpy(base, u, end - u);
    }
    if (!base[0]) { ESP_LOGW("portal", "no portal redirect found"); return; }

    char url[160];
    snprintf(url, sizeof(url), "%s/usg/process?OS=http://www.motel6.com", base);
    const char *body = "username=motel6&RLF=&password=" PORTAL_ACCESS_CODE "&submit=Submit";
    esp_http_client_config_t cfg = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .disable_auto_redirect = true,
        .timeout_ms = 10000,
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    esp_http_client_set_header(c, "Content-Type", "application/x-www-form-urlencoded");
    esp_http_client_set_post_field(c, body, strlen(body));
    esp_err_t err = esp_http_client_perform(c);
    ESP_LOGI("portal", "login POST %s err=%s status=%d", base, esp_err_to_name(err),
             esp_http_client_get_status_code(c));
    esp_http_client_cleanup(c);
}

static void portal_task(void *arg) {
    for (;;) {
        if (!portal_online()) {
            ESP_LOGI("portal", "no internet - signing in to captive portal");
            portal_login();
            vTaskDelay(pdMS_TO_TICKS(3000));
            if (portal_online()) ESP_LOGI("portal", "ONLINE after login");
            else ESP_LOGW("portal", "still offline after login");
        }
        vTaskDelay(pdMS_TO_TICKS(60000));
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
    wifi_config.sta.threshold.authmode = pass[0] ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;

    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_set_config(WIFI_IF_STA, &wifi_config);

    esp_wifi_start();

    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
        WIFI_CONNECTED_BIT | WIFI_FAIL_BIT, pdFALSE, pdFALSE, portMAX_DELAY);

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "WiFi connected to %s", ssid);
        set_led_status(BRIDGE_MONITORING);

        /* Get IP for LCD display */
        esp_netif_ip_info_t ip_info;
        esp_netif_t *sta_netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
        char ip_str[20] = {0};
        if (sta_netif && esp_netif_get_ip_info(sta_netif, &ip_info) == ESP_OK) {
            snprintf(ip_str, sizeof(ip_str), IPSTR, IP2STR(&ip_info.ip));
        }
        lcd_set_wifi_status(true, ssid, ip_str);
        lcd_show_status("WiFi Connected", ssid);

        xTaskCreate(portal_task, "portal", 8192, NULL, 4, NULL);

        /* Always-on CSI presence sensing: no manual scan needed. */
        presence_csi_start();
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
        {"has_mic", "true"},
        {"has_speaker", "true"},
        {"has_lcd", "true"},
    };
    mdns_service_txt_set(MDNS_SERVICE_TYPE, MDNS_SERVICE_PROTO, txt, 5);

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
    cal_mode = CAL_MODE_CALIBRATE;
    set_led_status(BRIDGE_CALIBRATING);
    lcd_show_calibrating(room_name, CAL_MODE_CALIBRATE);
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

    /* Initialize hardware */
    init_leds();
    audio_init();

    lcd_init();
    lcd_show_boot(ILLY_BRIDGE_VERSION, bridge_device_id);

    /* Common network / WiFi init — must happen before either STA or AP path */
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    esp_netif_create_default_wifi_ap();

    wifi_init_config_t wifi_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wifi_cfg));

    /* Try stored WiFi credentials, fallback to hardcoded Motel 6, then SoftAP provisioning */
    char ssid[33] = {0}, pass[65] = {0};
    if (load_wifi_creds(ssid, sizeof(ssid), pass, sizeof(pass))) {
        ESP_LOGI(TAG, "Found stored WiFi: %s", ssid);
        lcd_show_status("Connecting...", ssid);
        wifi_init_sta(ssid, pass);
    } else {
        /* Hardcoded Motel 6 WiFi credentials as fallback */
        strncpy(ssid, "Motel 6", sizeof(ssid) - 1);
        strncpy(pass, "", sizeof(pass) - 1);  /* Open network - no password */
        ESP_LOGI(TAG, "Using hardcoded Motel 6 WiFi: %s (open)", ssid);
        lcd_show_status("Connecting...", ssid);
        wifi_init_sta(ssid, pass);
    }

    /* Start mDNS for local network discovery */
    if (current_status != BRIDGE_PROVISIONING) {
        init_mdns();
    }

    /* Start HTTP server for Echo Vue local communication */
    bridge_httpd_start();

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
