/**
 * Illy Bridge Firmware — ESP32-S3 CSI Sensing Node
 *
 * Main entry point for the Illy Bridge wall-wart device.
 * Handles:
 *   - WiFi 6 CSI extraction at configurable rates (up to 100Hz)
 *   - 2x2 MIMO antenna AoA computation
 *   - TLS 1.3 encrypted streaming to Echo Maps cloud
 *   - LED status ring (Blue=calibrating, Green=CSI-only, Red=offline)
 *   - TinyML edge filtering (human vs pet vs noise)
 *   - Google OAuth 2.0 hardware handshake via BLE provisioning
 */

#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_tls.h"
#include "nvs_flash.h"
#include "driver/gpio.h"
#include "driver/ledc.h"

/* ── Configuration ── */
#define ILLY_BRIDGE_VERSION       "1.0.0"
#define CSI_DEFAULT_SAMPLE_RATE   100   /* Hz */
#define CLOUD_HOST                "api.echomaps.illyrobotics.com"
#define CLOUD_PORT                8443
#define PACKET_MAGIC              0x494C  /* "IL" */

/* LED GPIO pins (Privacy Ring) */
#define LED_BLUE_PIN   GPIO_NUM_38
#define LED_GREEN_PIN  GPIO_NUM_39
#define LED_RED_PIN    GPIO_NUM_40

/* ── Bridge Status ── */
typedef enum {
    BRIDGE_IDLE         = 0x00,
    BRIDGE_CALIBRATING  = 0x01,  /* Blue ring */
    BRIDGE_MONITORING   = 0x02,  /* Green ring */
    BRIDGE_OFFLINE      = 0x03,  /* Red ring */
    BRIDGE_OTA          = 0x04,
    BRIDGE_ERROR        = 0xFF,
} bridge_status_t;

static const char *TAG = "illy-bridge";
static bridge_status_t current_status = BRIDGE_OFFLINE;
static int csi_sample_rate_hz = CSI_DEFAULT_SAMPLE_RATE;

/* ── LED Control ── */
static void set_led_status(bridge_status_t status) {
    gpio_set_level(LED_BLUE_PIN, status == BRIDGE_CALIBRATING ? 1 : 0);
    gpio_set_level(LED_GREEN_PIN, status == BRIDGE_MONITORING ? 1 : 0);
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

    /*
     * CSI data format: each subcarrier as (imaginary, real) int8 pair
     * For 2x2 MIMO: data contains both antenna streams interleaved
     *
     * TODO: Package into BridgePacket and send via TLS to cloud
     */
    ESP_LOGD(TAG, "CSI frame: len=%d rssi=%d", info->len, info->rx_ctrl.rssi);
}

/* ── WiFi Init ── */
static void wifi_init(void) {
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);
    esp_wifi_set_mode(WIFI_MODE_STA);

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
    ESP_LOGI(TAG, "WiFi CSI initialized, sample rate: %d Hz", csi_sample_rate_hz);
}

/* ── Main ── */
void app_main(void) {
    ESP_LOGI(TAG, "Illy Bridge v%s starting...", ILLY_BRIDGE_VERSION);

    /* Initialize NVS (for WiFi credentials) */
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }

    init_leds();
    wifi_init();

    /* Set status to idle (ready for pairing) */
    set_led_status(BRIDGE_IDLE);
    ESP_LOGI(TAG, "Bridge ready. Waiting for cloud connection...");

    /* Main loop — managed by FreeRTOS tasks */
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
