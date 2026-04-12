/**
 * Camera capture module for Illy Bridge — FNK0086 OV2640
 */
#pragma once

#include <stdint.h>
#include <stdbool.h>

typedef struct {
    uint8_t  *data;       /* JPEG-encoded frame data */
    uint32_t  len;        /* Frame data length */
    uint16_t  width;
    uint16_t  height;
    int64_t   timestamp;  /* Capture timestamp (microseconds) */
} camera_frame_t;

/* Initialize OV2640 camera on FNK0086 */
void camera_init(void);

/* Capture a single JPEG frame */
camera_frame_t *camera_capture_frame(void);

/* Free a captured frame */
void camera_free_frame(camera_frame_t *frame);

/* Send camera frame to cloud via TLS */
void bridge_send_camera_frame(void *tls, camera_frame_t *frame, const char *room_name);
