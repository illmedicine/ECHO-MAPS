/**
 * Camera capture — FNK0086 OV2640 via DVP interface
 *
 * Captures JPEG frames for visual calibration (skeleton extraction on cloud).
 */

#include "camera_capture.h"

#include <string.h>
#include "esp_log.h"
#include "esp_camera.h"
#include "esp_timer.h"
#include "esp_tls.h"

static const char *TAG = "camera";

/* FNK0086 OV2640 pin mapping */
#define CAM_PIN_PWDN    -1
#define CAM_PIN_RESET   -1
#define CAM_PIN_XCLK    GPIO_NUM_15
#define CAM_PIN_SIOD    GPIO_NUM_4
#define CAM_PIN_SIOC    GPIO_NUM_5
#define CAM_PIN_D7      GPIO_NUM_16
#define CAM_PIN_D6      GPIO_NUM_17
#define CAM_PIN_D5      GPIO_NUM_18
#define CAM_PIN_D4      GPIO_NUM_12
#define CAM_PIN_D3      GPIO_NUM_10
#define CAM_PIN_D2      GPIO_NUM_8
#define CAM_PIN_D1      GPIO_NUM_9
#define CAM_PIN_D0      GPIO_NUM_11
#define CAM_PIN_VSYNC   GPIO_NUM_6
#define CAM_PIN_HREF    GPIO_NUM_7
#define CAM_PIN_PCLK    GPIO_NUM_13

void camera_init(void) {
    camera_config_t config = {
        .pin_pwdn  = CAM_PIN_PWDN,
        .pin_reset = CAM_PIN_RESET,
        .pin_xclk  = CAM_PIN_XCLK,
        .pin_sccb_sda = CAM_PIN_SIOD,
        .pin_sccb_scl = CAM_PIN_SIOC,
        .pin_d7 = CAM_PIN_D7,
        .pin_d6 = CAM_PIN_D6,
        .pin_d5 = CAM_PIN_D5,
        .pin_d4 = CAM_PIN_D4,
        .pin_d3 = CAM_PIN_D3,
        .pin_d2 = CAM_PIN_D2,
        .pin_d1 = CAM_PIN_D1,
        .pin_d0 = CAM_PIN_D0,
        .pin_vsync = CAM_PIN_VSYNC,
        .pin_href  = CAM_PIN_HREF,
        .pin_pclk  = CAM_PIN_PCLK,

        .xclk_freq_hz = 20000000,
        .ledc_timer   = LEDC_TIMER_0,
        .ledc_channel = LEDC_CHANNEL_0,

        .pixel_format = PIXFORMAT_JPEG,
        .frame_size   = FRAMESIZE_QVGA,  /* 320×240 — fits in internal DRAM */
        .jpeg_quality = 12,
        .fb_count     = 1,               /* Single buffer for DRAM mode */
        .fb_location  = CAMERA_FB_IN_DRAM,
        .grab_mode    = CAMERA_GRAB_WHEN_EMPTY,
    };

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Camera init failed: %s", esp_err_to_name(err));
        return;
    }

    /* Adjust sensor settings for indoor calibration */
    sensor_t *s = esp_camera_sensor_get();
    if (s) {
        s->set_brightness(s, 1);
        s->set_contrast(s, 1);
        s->set_whitebal(s, 1);
        s->set_awb_gain(s, 1);
    }

    ESP_LOGI(TAG, "Camera initialized (QVGA, JPEG, DRAM)");
}

camera_frame_t *camera_capture_frame(void) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
        ESP_LOGW(TAG, "Camera capture failed");
        return NULL;
    }

    camera_frame_t *frame = malloc(sizeof(camera_frame_t));
    if (!frame) {
        esp_camera_fb_return(fb);
        return NULL;
    }

    /* Copy frame data (fb is returned to DMA pool) */
    frame->data = malloc(fb->len);
    if (!frame->data) {
        free(frame);
        esp_camera_fb_return(fb);
        return NULL;
    }

    memcpy(frame->data, fb->buf, fb->len);
    frame->len = fb->len;
    frame->width = fb->width;
    frame->height = fb->height;
    frame->timestamp = esp_timer_get_time();

    esp_camera_fb_return(fb);
    return frame;
}

void camera_free_frame(camera_frame_t *frame) {
    if (frame) {
        free(frame->data);
        free(frame);
    }
}

void bridge_send_camera_frame(void *tls, camera_frame_t *frame, const char *room_name) {
    if (!tls || !frame) return;

    /*
     * Camera frame packet (IL protocol v2):
     *   [magic(2B)][version(1B)][event=0x10(1B)][seq(4B)][payload_len(4B)]
     *   [timestamp(8B)][room_name_len(1B)][room_name(N)][jpeg_data]
     *   [crc32(4B)]
     */
    uint8_t room_len = strlen(room_name);
    if (room_len > 63) room_len = 63;

    uint32_t payload_len = 8 + 1 + room_len + frame->len;
    uint8_t header[12];

    header[0] = 0x49; header[1] = 0x4C;  /* "IL" magic */
    header[2] = 0x02;                      /* version 2 */
    header[3] = 0x10;                      /* CAMERA_FRAME event */

    static uint32_t cam_seq = 0;
    cam_seq++;
    header[4] = (cam_seq >> 24) & 0xFF;
    header[5] = (cam_seq >> 16) & 0xFF;
    header[6] = (cam_seq >> 8)  & 0xFF;
    header[7] = cam_seq & 0xFF;

    header[8]  = (payload_len >> 24) & 0xFF;
    header[9]  = (payload_len >> 16) & 0xFF;
    header[10] = (payload_len >> 8)  & 0xFF;
    header[11] = payload_len & 0xFF;

    esp_tls_conn_write((esp_tls_t *)tls, header, 12);

    /* Payload: timestamp + room name + JPEG */
    uint8_t ts_buf[8];
    int64_t ts = frame->timestamp;
    for (int i = 0; i < 8; i++) ts_buf[i] = (ts >> (56 - i * 8)) & 0xFF;
    esp_tls_conn_write((esp_tls_t *)tls, ts_buf, 8);

    esp_tls_conn_write((esp_tls_t *)tls, &room_len, 1);
    esp_tls_conn_write((esp_tls_t *)tls, (const unsigned char *)room_name, room_len);
    esp_tls_conn_write((esp_tls_t *)tls, frame->data, frame->len);

    ESP_LOGD(TAG, "Sent camera frame: %lu bytes, room=%s", (unsigned long)frame->len, room_name);
}
