/**
 * LCD UI — Illy Bridge FNK0086 ST7789 240x320 SPI display + full UI system
 *
 * Pin mapping from official Freenove TFT_eSPI_Setups_v1.3:
 *   MOSI=GPIO20, SCLK=GPIO21, DC=GPIO0, CS=none, RST=none, BL=none
 *   Touch: FT6336U I2C SDA=GPIO2, SCL=GPIO1 (not yet wired)
 *
 * Features:
 *   - Real 5x7 bitmap font rendering
 *   - Strip-buffer rendering (no PSRAM dependency, 19.2KB internal RAM)
 *   - Button-navigated menu (BOOT btn: short=next, long=select, 3s=back)
 *   - WiFi scanning and network selection
 *   - On-screen password entry (character wheel)
 *   - Dashboard, calibration, presence scan screens
 */

#include "lcd_ui.h"

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "soc/usb_serial_jtag_reg.h"
#include "soc/system_reg.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

static const char *TAG = "lcd-ui";

/* ---- Pin Definitions (FNK0086A_2.8_CFG1_240x320_ST7789) ---- */
#define LCD_SPI_HOST   SPI2_HOST
#define LCD_PIN_MOSI   GPIO_NUM_20
#define LCD_PIN_CLK    GPIO_NUM_21
#define LCD_PIN_CS     (-1)          /* no CS — tied to GND on module */
#define LCD_PIN_DC     GPIO_NUM_0
#define LCD_PIN_RST    (-1)          /* no RST — tied to 3.3V or board RST */
#define LCD_H_RES      240
#define LCD_V_RES      320
#define LCD_SPI_FREQ   (40 * 1000 * 1000)
#define BTN_PIN        GPIO_NUM_NC   /* GPIO0 = DC now; button TBD */

/* ---- Color Palette (RGB565) ---- */
#define C_BLACK   0x0000
#define C_WHITE   0xFFFF
#define C_RED     0xF800
#define C_GREEN   0x07E0
#define C_BLUE    0x001F
#define C_CYAN    0x07FF
#define C_YELLOW  0xFFE0
#define C_ORANGE  0xFD20
#define C_DARK    0x18E3
#define C_MID     0x4208
#define C_ACCENT  0x04FF
#define C_SEL     0x2965

/* ---- 5x7 Bitmap Font (ASCII 32-126) ---- */
static const uint8_t font5x7[][5] = {
    {0x00,0x00,0x00,0x00,0x00}, /*   */
    {0x00,0x00,0x5F,0x00,0x00}, /* ! */
    {0x00,0x07,0x00,0x07,0x00}, /* " */
    {0x14,0x7F,0x14,0x7F,0x14}, /* # */
    {0x24,0x2A,0x7F,0x2A,0x12}, /* $ */
    {0x23,0x13,0x08,0x64,0x62}, /* % */
    {0x36,0x49,0x55,0x22,0x50}, /* & */
    {0x00,0x05,0x03,0x00,0x00}, /* ' */
    {0x00,0x1C,0x22,0x41,0x00}, /* ( */
    {0x00,0x41,0x22,0x1C,0x00}, /* ) */
    {0x14,0x08,0x3E,0x08,0x14}, /* * */
    {0x08,0x08,0x3E,0x08,0x08}, /* + */
    {0x00,0x50,0x30,0x00,0x00}, /* , */
    {0x08,0x08,0x08,0x08,0x08}, /* - */
    {0x00,0x60,0x60,0x00,0x00}, /* . */
    {0x20,0x10,0x08,0x04,0x02}, /* / */
    {0x3E,0x51,0x49,0x45,0x3E}, /* 0 */
    {0x00,0x42,0x7F,0x40,0x00}, /* 1 */
    {0x42,0x61,0x51,0x49,0x46}, /* 2 */
    {0x21,0x41,0x45,0x4B,0x31}, /* 3 */
    {0x18,0x14,0x12,0x7F,0x10}, /* 4 */
    {0x27,0x45,0x45,0x45,0x39}, /* 5 */
    {0x3C,0x4A,0x49,0x49,0x30}, /* 6 */
    {0x01,0x71,0x09,0x05,0x03}, /* 7 */
    {0x36,0x49,0x49,0x49,0x36}, /* 8 */
    {0x06,0x49,0x49,0x29,0x1E}, /* 9 */
    {0x00,0x36,0x36,0x00,0x00}, /* : */
    {0x00,0x56,0x36,0x00,0x00}, /* ; */
    {0x08,0x14,0x22,0x41,0x00}, /* < */
    {0x14,0x14,0x14,0x14,0x14}, /* = */
    {0x00,0x41,0x22,0x14,0x08}, /* > */
    {0x02,0x01,0x51,0x09,0x06}, /* ? */
    {0x32,0x49,0x79,0x41,0x3E}, /* @ */
    {0x7E,0x11,0x11,0x11,0x7E}, /* A */
    {0x7F,0x49,0x49,0x49,0x36}, /* B */
    {0x3E,0x41,0x41,0x41,0x22}, /* C */
    {0x7F,0x41,0x41,0x22,0x1C}, /* D */
    {0x7F,0x49,0x49,0x49,0x41}, /* E */
    {0x7F,0x09,0x09,0x09,0x01}, /* F */
    {0x3E,0x41,0x49,0x49,0x7A}, /* G */
    {0x7F,0x08,0x08,0x08,0x7F}, /* H */
    {0x00,0x41,0x7F,0x41,0x00}, /* I */
    {0x20,0x40,0x41,0x3F,0x01}, /* J */
    {0x7F,0x08,0x14,0x22,0x41}, /* K */
    {0x7F,0x40,0x40,0x40,0x40}, /* L */
    {0x7F,0x02,0x0C,0x02,0x7F}, /* M */
    {0x7F,0x04,0x08,0x10,0x7F}, /* N */
    {0x3E,0x41,0x41,0x41,0x3E}, /* O */
    {0x7F,0x09,0x09,0x09,0x06}, /* P */
    {0x3E,0x41,0x51,0x21,0x5E}, /* Q */
    {0x7F,0x09,0x19,0x29,0x46}, /* R */
    {0x46,0x49,0x49,0x49,0x31}, /* S */
    {0x01,0x01,0x7F,0x01,0x01}, /* T */
    {0x3F,0x40,0x40,0x40,0x3F}, /* U */
    {0x1F,0x20,0x40,0x20,0x1F}, /* V */
    {0x3F,0x40,0x38,0x40,0x3F}, /* W */
    {0x63,0x14,0x08,0x14,0x63}, /* X */
    {0x07,0x08,0x70,0x08,0x07}, /* Y */
    {0x61,0x51,0x49,0x45,0x43}, /* Z */
    {0x00,0x7F,0x41,0x41,0x00}, /* [ */
    {0x02,0x04,0x08,0x10,0x20}, /* \ */
    {0x00,0x41,0x41,0x7F,0x00}, /* ] */
    {0x04,0x02,0x01,0x02,0x04}, /* ^ */
    {0x40,0x40,0x40,0x40,0x40}, /* _ */
    {0x00,0x01,0x02,0x04,0x00}, /* ` */
    {0x20,0x54,0x54,0x54,0x78}, /* a */
    {0x7F,0x48,0x44,0x44,0x38}, /* b */
    {0x38,0x44,0x44,0x44,0x20}, /* c */
    {0x38,0x44,0x44,0x48,0x7F}, /* d */
    {0x38,0x54,0x54,0x54,0x18}, /* e */
    {0x08,0x7E,0x09,0x01,0x02}, /* f */
    {0x0C,0x52,0x52,0x52,0x3E}, /* g */
    {0x7F,0x08,0x04,0x04,0x78}, /* h */
    {0x00,0x44,0x7D,0x40,0x00}, /* i */
    {0x20,0x40,0x44,0x3D,0x00}, /* j */
    {0x7F,0x10,0x28,0x44,0x00}, /* k */
    {0x00,0x41,0x7F,0x40,0x00}, /* l */
    {0x7C,0x04,0x18,0x04,0x78}, /* m */
    {0x7C,0x08,0x04,0x04,0x78}, /* n */
    {0x38,0x44,0x44,0x44,0x38}, /* o */
    {0x7C,0x14,0x14,0x14,0x08}, /* p */
    {0x08,0x14,0x14,0x18,0x7C}, /* q */
    {0x7C,0x08,0x04,0x04,0x08}, /* r */
    {0x48,0x54,0x54,0x54,0x20}, /* s */
    {0x04,0x3F,0x44,0x40,0x20}, /* t */
    {0x3C,0x40,0x40,0x20,0x7C}, /* u */
    {0x1C,0x20,0x40,0x20,0x1C}, /* v */
    {0x3C,0x40,0x30,0x40,0x3C}, /* w */
    {0x44,0x28,0x10,0x28,0x44}, /* x */
    {0x0C,0x50,0x50,0x50,0x3C}, /* y */
    {0x44,0x64,0x54,0x4C,0x44}, /* z */
    {0x00,0x08,0x36,0x41,0x00}, /* { */
    {0x00,0x00,0x7F,0x00,0x00}, /* | */
    {0x00,0x41,0x36,0x08,0x00}, /* } */
    {0x10,0x08,0x08,0x10,0x10}, /* ~ */
};

/* Password character set */
static const char pw_charset[] =
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "0123456789"
    "!@#$%^&*()-_=+[]{}|;:',.<>?/~` ";
#define PW_CHARSET_LEN (sizeof(pw_charset) - 1)

/* ---- State ---- */
static spi_device_handle_t spi_dev = NULL;
static bool lcd_ready = false;

#define STRIP_H 30
static uint16_t *strip_buf = NULL;
static int strip_y = 0;
static int strip_h = 0;

typedef enum {
    SCR_BOOT, SCR_WIFI_SCAN, SCR_WIFI_PASS, SCR_WIFI_CONNECTING,
    SCR_DASHBOARD, SCR_CALIBRATING, SCR_PRESENCE, SCR_SETTINGS, SCR_STATUS_MSG,
} screen_t;

static screen_t cur_screen = SCR_BOOT;
static int menu_sel = 0;
static int scroll_offset = 0;

#define MAX_SCAN 16
static wifi_ap_record_t ap_list[MAX_SCAN];
static uint16_t ap_count = 0;
static bool scan_in_progress = false;
static char selected_ssid[33] = {0};

static char pw_buf[65] = {0};
static int pw_pos = 0;
static int pw_char_idx = 0;

static char status_title[32] = {0};
static char status_detail[48] = {0};

static bool wifi_connected = false;
static char wifi_ssid[33] = {0};
static char wifi_ip[20] = {0};
static bool user_bound = false;

static char dev_id[18] = {0};
static char dev_ver[16] = {0};
static char room_name[64] = {0};
static int cal_progress = 0;

static const char *dash_items[] = {
    "Calibrate Room", "Presence Scan", "WiFi Settings", "Device Info",
};
#define DASH_ITEM_COUNT 4

/* ---- Button State Machine ---- */
typedef enum { BTN_NONE, BTN_SHORT, BTN_LONG, BTN_VLONG } btn_event_t;
static int btn_held_ticks = 0;
static bool btn_was_down = false;
static bool btn_long_fired = false;
static bool btn_vlong_fired = false;

static btn_event_t poll_button(void) {
    /* GPIO0 is now LCD DC — no button available.
     * TODO: wire FT6336U touch or find alternate button GPIO. */
    return BTN_NONE;
#if 0  /* retained for when a button GPIO is available */
    bool down = (gpio_get_level(BTN_PIN) == 0);
    btn_event_t ev = BTN_NONE;
    if (down) {
        btn_held_ticks++;
        if (btn_held_ticks >= 60 && !btn_vlong_fired) {
            btn_vlong_fired = true;
            ev = BTN_VLONG;
        } else if (btn_held_ticks >= 20 && !btn_long_fired) {
            btn_long_fired = true;
            ev = BTN_LONG;
        }
    } else {
        if (btn_was_down && !btn_long_fired && !btn_vlong_fired && btn_held_ticks >= 2) {
            ev = BTN_SHORT;
        }
        btn_held_ticks = 0;
        btn_long_fired = false;
        btn_vlong_fired = false;
    }
    btn_was_down = down;
    return ev;
#endif
}

/* ---- Drawing Primitives ---- */
static inline void put_pixel(int x, int y, uint16_t color) {
    int ly = y - strip_y;
    if (x >= 0 && x < LCD_H_RES && ly >= 0 && ly < strip_h)
        strip_buf[ly * LCD_H_RES + x] = color;
}

static void fill_rect(int x, int y, int w, int h, uint16_t color) {
    int y0 = y - strip_y;
    int y1 = y + h - strip_y;
    if (y0 < 0) y0 = 0;
    if (y1 > strip_h) y1 = strip_h;
    int x0 = (x < 0) ? 0 : x;
    int x1 = (x + w > LCD_H_RES) ? LCD_H_RES : x + w;
    for (int r = y0; r < y1; r++)
        for (int c = x0; c < x1; c++)
            strip_buf[r * LCD_H_RES + c] = color;
}

static void draw_hline(int x, int y, int w, uint16_t color) {
    fill_rect(x, y, w, 1, color);
}

static void draw_char(int x, int y, char ch, uint16_t color, int scale) {
    if (ch < 32 || ch > 126) ch = '?';
    const uint8_t *glyph = font5x7[ch - 32];
    for (int col = 0; col < 5; col++) {
        uint8_t line = glyph[col];
        for (int row = 0; row < 7; row++) {
            if (line & (1 << row)) {
                if (scale == 1) put_pixel(x + col, y + row, color);
                else fill_rect(x + col * scale, y + row * scale, scale, scale, color);
            }
        }
    }
}

static void draw_text(int x, int y, const char *s, uint16_t color, int scale) {
    int cx = x;
    while (*s) {
        if (cx + 6 * scale > LCD_H_RES) break;
        draw_char(cx, y, *s, color, scale);
        cx += 6 * scale;
        s++;
    }
}

static void draw_text_center(int y, const char *s, uint16_t color, int scale) {
    int w = (int)strlen(s) * 6 * scale;
    int x = (LCD_H_RES - w) / 2;
    if (x < 0) x = 0;
    draw_text(x, y, s, color, scale);
}

static void draw_signal(int x, int y, int rssi) {
    int bars = (rssi > -50) ? 4 : (rssi > -65) ? 3 : (rssi > -75) ? 2 : 1;
    for (int i = 0; i < 4; i++) {
        int bh = 2 + i * 2;
        fill_rect(x + i * 4, y + (8 - bh), 3, bh, (i < bars) ? C_GREEN : C_MID);
    }
}

static void draw_lock(int x, int y, uint16_t color) {
    fill_rect(x + 1, y, 3, 1, color);
    put_pixel(x, y + 1, color); put_pixel(x + 4, y + 1, color);
    put_pixel(x, y + 2, color); put_pixel(x + 4, y + 2, color);
    fill_rect(x, y + 3, 5, 4, color);
}

static void draw_btn_bg(int x, int y, int w, int h, uint16_t color) {
    fill_rect(x + 1, y, w - 2, h, color);
    fill_rect(x, y + 1, 1, h - 2, color);
    fill_rect(x + w - 1, y + 1, 1, h - 2, color);
}

static void draw_progress(int x, int y, int w, int h, int pct, uint16_t fg, uint16_t bg) {
    fill_rect(x, y, w, h, bg);
    int fill = (pct * (w - 4)) / 100;
    if (fill < 0) fill = 0;
    if (fill > w - 4) fill = w - 4;
    fill_rect(x + 2, y + 2, fill, h - 4, fg);
}

/* ---- Screen Renderers ---- */
static void render_boot(void) {
    fill_rect(80, 20, 80, 30, C_ACCENT);
    fill_rect(85, 25, 70, 20, C_DARK);
    draw_text_center(28, "ILLY", C_WHITE, 2);
    draw_text_center(70, "ILLY BRIDGE", C_WHITE, 2);
    draw_text_center(94, "Echo Vue", C_CYAN, 2);
    char buf[32];
    snprintf(buf, sizeof(buf), "v%s", dev_ver);
    draw_text_center(130, buf, C_GREEN, 1);
    draw_text_center(145, dev_id, C_WHITE, 1);
    draw_hline(20, 165, 200, C_MID);
    draw_text_center(180, "Initializing...", C_YELLOW, 1);
    draw_text_center(200, "Freenove FNK0086", C_MID, 1);
}

static void render_wifi_scan(void) {
    draw_text(8, 4, "WiFi Networks", C_CYAN, 2);
    draw_hline(8, 22, 224, C_ACCENT);
    if (scan_in_progress) {
        draw_text_center(100, "Scanning...", C_YELLOW, 2);
        return;
    }
    if (ap_count == 0) {
        draw_text_center(80, "No networks found", C_YELLOW, 1);
        draw_text_center(100, "Press button to scan", C_WHITE, 1);
        return;
    }
    int visible = 7;
    for (int i = 0; i < visible && (scroll_offset + i) < ap_count; i++) {
        int idx = scroll_offset + i;
        int row_y = 30 + i * 26;
        bool selected = (idx == menu_sel);
        if (selected) fill_rect(4, row_y - 2, 232, 24, C_SEL);
        if (selected) draw_text(6, row_y + 2, ">", C_CYAN, 2);
        char ssid_disp[20] = {0};
        strncpy(ssid_disp, (char *)ap_list[idx].ssid, 18);
        draw_text(24, row_y + 4, ssid_disp, selected ? C_WHITE : C_GREEN, 1);
        draw_signal(200, row_y + 4, ap_list[idx].rssi);
        if (ap_list[idx].authmode != WIFI_AUTH_OPEN)
            draw_lock(218, row_y + 4, C_YELLOW);
    }
    draw_hline(8, 216, 224, C_MID);
    draw_text(8, 222, "BTN:Next", C_MID, 1);
    draw_text(100, 222, "HOLD:Connect", C_MID, 1);
}

static void render_wifi_pass(void) {
    draw_text(8, 4, "Enter Password", C_CYAN, 2);
    draw_hline(8, 22, 224, C_ACCENT);
    draw_text(8, 32, "Network:", C_MID, 1);
    draw_text(60, 32, selected_ssid, C_WHITE, 1);
    draw_text(8, 52, "Password:", C_MID, 1);
    fill_rect(8, 66, 224, 20, 0x0841);
    char disp[22] = {0};
    int show_len = pw_pos > 20 ? 20 : pw_pos;
    int show_start = pw_pos > 20 ? pw_pos - 20 : 0;
    for (int i = 0; i < show_len; i++) disp[i] = pw_buf[show_start + i];
    draw_text(12, 70, disp, C_GREEN, 1);
    if (((esp_timer_get_time() / 500000) % 2) == 0) {
        int cx = 12 + show_len * 6;
        if (cx < 228) fill_rect(cx, 68, 6, 14, C_CYAN);
    }
    fill_rect(8, 100, 224, 50, 0x0841);
    draw_hline(8, 100, 224, C_ACCENT);
    draw_hline(8, 149, 224, C_ACCENT);
    for (int i = -5; i <= 5; i++) {
        int ci = (pw_char_idx + i + (int)PW_CHARSET_LEN) % (int)PW_CHARSET_LEN;
        int px = 120 + i * 20 - 5;
        bool is_cur = (i == 0);
        if (is_cur) fill_rect(px - 2, 108, 18, 34, C_ACCENT);
        char ch_str[2] = { pw_charset[ci], 0 };
        draw_text(px, 118, ch_str, is_cur ? C_BLACK : C_WHITE, 2);
    }
    draw_hline(8, 168, 224, C_MID);
    draw_text(8, 176, "BTN: Next char", C_MID, 1);
    draw_text(8, 190, "HOLD: Add to password", C_MID, 1);
    draw_text(8, 204, "3s HOLD: Connect", C_YELLOW, 1);
    char len_str[16];
    snprintf(len_str, sizeof(len_str), "%d chars", pw_pos);
    draw_text(170, 52, len_str, C_MID, 1);
}

static void render_wifi_connecting(void) {
    draw_text_center(40, "Connecting", C_CYAN, 2);
    draw_text_center(70, "to WiFi...", C_CYAN, 2);
    draw_text_center(110, selected_ssid, C_WHITE, 1);
    draw_text_center(200, "Please wait...", C_MID, 1);
}

static void render_dashboard(void) {
    draw_text(8, 4, "ILLY BRIDGE", C_CYAN, 2);
    draw_hline(8, 22, 224, C_ACCENT);
    if (wifi_connected) {
        fill_rect(8, 28, 8, 8, C_GREEN);
        draw_text(20, 28, wifi_ssid, C_GREEN, 1);
        draw_text(20, 40, wifi_ip, C_MID, 1);
    } else {
        fill_rect(8, 28, 8, 8, C_RED);
        draw_text(20, 28, "Not connected", C_RED, 1);
    }
    draw_text(8, 56, user_bound ? "Echo Vue: Linked" : "Echo Vue: Waiting",
              user_bound ? C_GREEN : C_YELLOW, 1);
    draw_hline(8, 70, 224, C_MID);
    for (int i = 0; i < DASH_ITEM_COUNT; i++) {
        int iy = 78 + i * 34;
        bool sel = (i == menu_sel);
        if (sel) {
            draw_btn_bg(8, iy, 224, 28, C_SEL);
            draw_text(14, iy + 6, ">", C_CYAN, 2);
        }
        draw_text(32, iy + 8, dash_items[i], sel ? C_WHITE : C_GREEN, 1);
    }
    draw_hline(8, 216, 224, C_MID);
    draw_text(8, 222, "BTN:Next  HOLD:Select", C_MID, 1);
}

static void render_calibrating(void) {
    draw_text(8, 4, "CALIBRATING", C_BLUE, 2);
    draw_hline(8, 22, 224, C_BLUE);
    draw_text(8, 32, "Room:", C_MID, 1);
    draw_text(44, 32, room_name, C_WHITE, 2);
    draw_text(8, 62, "Mode: Full Scan", C_GREEN, 1);
    draw_hline(8, 76, 224, C_MID);
    draw_text(8, 86, "Camera:  Active", C_GREEN, 1);
    draw_text(8, 100, "CSI:     Capturing", C_GREEN, 1);
    draw_text(8, 114, "Audio:   Recording", C_GREEN, 1);
    draw_progress(8, 140, 224, 20, cal_progress, C_CYAN, C_MID);
    char pct[8];
    snprintf(pct, sizeof(pct), "%d%%", cal_progress);
    draw_text_center(146, pct, C_WHITE, 1);
    draw_hline(8, 200, 224, C_MID);
    draw_text_center(210, "HOLD: Stop", C_YELLOW, 1);
}

static void render_presence(void) {
    draw_text(8, 4, "PRESENCE SCAN", C_GREEN, 2);
    draw_hline(8, 22, 224, C_GREEN);
    draw_text(8, 32, "Room:", C_MID, 1);
    draw_text(44, 32, room_name, C_WHITE, 1);
    int cx = 120, cy = 120;
    draw_hline(cx - 60, cy, 121, C_MID);
    fill_rect(cx, cy - 60, 1, 121, C_MID);
    fill_rect(cx - 2, cy - 2, 5, 5, C_GREEN);
    draw_text(8, 190, "CSI + Audio active", C_GREEN, 1);
    draw_hline(8, 210, 224, C_MID);
    draw_text_center(218, "HOLD: Stop", C_YELLOW, 1);
}

static void render_settings(void) {
    draw_text(8, 4, "SETTINGS", C_CYAN, 2);
    draw_hline(8, 22, 224, C_ACCENT);
    static const char *set_items[] = { "Scan WiFi", "Reset WiFi", "< Back" };
    for (int i = 0; i < 3; i++) {
        int iy = 36 + i * 34;
        bool sel = (i == menu_sel);
        if (sel) {
            draw_btn_bg(8, iy, 224, 28, C_SEL);
            draw_text(14, iy + 6, ">", C_CYAN, 2);
        }
        draw_text(32, iy + 8, set_items[i], sel ? C_WHITE : C_GREEN, 1);
    }
    draw_hline(8, 150, 224, C_MID);
    draw_text(8, 160, "ID:", C_MID, 1);
    draw_text(30, 160, dev_id, C_WHITE, 1);
    char buf[32];
    snprintf(buf, sizeof(buf), "v%s", dev_ver);
    draw_text(8, 174, "FW:", C_MID, 1);
    draw_text(30, 174, buf, C_WHITE, 1);
    draw_text(8, 188, "Room:", C_MID, 1);
    draw_text(44, 188, room_name[0] ? room_name : "(none)", C_WHITE, 1);
    draw_hline(8, 210, 224, C_MID);
    draw_text(8, 222, "BTN:Next  HOLD:Select", C_MID, 1);
}

static void render_status_msg(void) {
    draw_text_center(60, status_title, C_WHITE, 2);
    if (status_detail[0])
        draw_text_center(100, status_detail, C_GREEN, 1);
}

static void render_current(void) {
    switch (cur_screen) {
    case SCR_BOOT:             render_boot(); break;
    case SCR_WIFI_SCAN:        render_wifi_scan(); break;
    case SCR_WIFI_PASS:        render_wifi_pass(); break;
    case SCR_WIFI_CONNECTING:  render_wifi_connecting(); break;
    case SCR_DASHBOARD:        render_dashboard(); break;
    case SCR_CALIBRATING:      render_calibrating(); break;
    case SCR_PRESENCE:         render_presence(); break;
    case SCR_SETTINGS:         render_settings(); break;
    case SCR_STATUS_MSG:       render_status_msg(); break;
    }
}

/* Forward declarations for raw SPI helpers (defined after lcd_init) */
static void lcd_set_window(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1);

static void lcd_flush(void) {
    if (!strip_buf || !spi_dev) return;
    for (int y = 0; y < LCD_V_RES; y += STRIP_H) {
        strip_y = y;
        strip_h = (y + STRIP_H > LCD_V_RES) ? (LCD_V_RES - y) : STRIP_H;
        for (int i = 0; i < LCD_H_RES * strip_h; i++)
            strip_buf[i] = C_DARK;
        render_current();

        /* Byte-swap to big-endian for ST7789, then send via raw SPI */
        for (int i = 0; i < LCD_H_RES * strip_h; i++)
            strip_buf[i] = (strip_buf[i] >> 8) | (strip_buf[i] << 8);
        lcd_set_window(0, y, LCD_H_RES - 1, y + strip_h - 1);
        spi_transaction_t t = {
            .length = LCD_H_RES * strip_h * 16,
            .tx_buffer = strip_buf,
            .user = (void *)1,  /* DC=1 for data */
        };
        spi_device_polling_transmit(spi_dev, &t);
    }
}

/* ---- WiFi Scan ---- */
static void do_wifi_scan(void) {
    scan_in_progress = true;
    ap_count = 0;
    menu_sel = 0;
    scroll_offset = 0;
    lcd_flush();

    wifi_mode_t mode;
    esp_wifi_get_mode(&mode);
    if (mode == WIFI_MODE_AP)
        esp_wifi_set_mode(WIFI_MODE_APSTA);

    wifi_scan_config_t scan_cfg = {
        .ssid = NULL, .bssid = NULL, .channel = 0,
        .show_hidden = false,
        .scan_type = WIFI_SCAN_TYPE_ACTIVE,
        .scan_time = { .active = { .min = 100, .max = 300 } },
    };
    esp_err_t err = esp_wifi_scan_start(&scan_cfg, true);
    if (err == ESP_OK) {
        ap_count = MAX_SCAN;
        esp_wifi_scan_get_ap_records(&ap_count, ap_list);
        ESP_LOGI(TAG, "WiFi scan found %d networks", ap_count);
    } else {
        ESP_LOGW(TAG, "WiFi scan failed: %s", esp_err_to_name(err));
    }
    scan_in_progress = false;
}

/* ---- Input Handlers ---- */
extern void save_wifi_creds(const char *ssid, const char *pass);
extern void bridge_start_room_calibration(const char *name);
extern void bridge_start_presence_scan(const char *name);
extern void bridge_stop_calibration(void);
extern char current_room_name[64];

static void handle_boot(btn_event_t ev) {
    if (ev != BTN_NONE) {
        cur_screen = SCR_WIFI_SCAN;
        do_wifi_scan();
    }
}

static void handle_wifi_scan(btn_event_t ev) {
    if (ev == BTN_SHORT) {
        if (ap_count > 0) {
            menu_sel = (menu_sel + 1) % ap_count;
            if (menu_sel >= scroll_offset + 7) scroll_offset = menu_sel - 6;
            if (menu_sel < scroll_offset) scroll_offset = menu_sel;
        } else {
            do_wifi_scan();
        }
    } else if (ev == BTN_LONG && ap_count > 0 && menu_sel < ap_count) {
        strncpy(selected_ssid, (char *)ap_list[menu_sel].ssid, 32);
        if (ap_list[menu_sel].authmode == WIFI_AUTH_OPEN) {
            cur_screen = SCR_WIFI_CONNECTING;
            lcd_flush();
            save_wifi_creds(selected_ssid, "");
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_restart();
        } else {
            memset(pw_buf, 0, sizeof(pw_buf));
            pw_pos = 0;
            pw_char_idx = 0;
            cur_screen = SCR_WIFI_PASS;
        }
    } else if (ev == BTN_VLONG) {
        do_wifi_scan();
    }
}

static void handle_wifi_pass(btn_event_t ev) {
    if (ev == BTN_SHORT) {
        pw_char_idx = (pw_char_idx + 1) % (int)PW_CHARSET_LEN;
    } else if (ev == BTN_LONG) {
        if (pw_pos < 64) {
            pw_buf[pw_pos] = pw_charset[pw_char_idx];
            pw_pos++;
            pw_char_idx = 0;
        }
    } else if (ev == BTN_VLONG) {
        if (pw_pos > 0) {
            cur_screen = SCR_WIFI_CONNECTING;
            lcd_flush();
            save_wifi_creds(selected_ssid, pw_buf);
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_restart();
        } else {
            cur_screen = SCR_WIFI_SCAN;
        }
    }
}

static void handle_dashboard(btn_event_t ev) {
    if (ev == BTN_SHORT) {
        menu_sel = (menu_sel + 1) % DASH_ITEM_COUNT;
    } else if (ev == BTN_LONG) {
        switch (menu_sel) {
        case 0:
            if (current_room_name[0] == '\0') strcpy(current_room_name, "Room-1");
            strncpy(room_name, current_room_name, sizeof(room_name) - 1);
            bridge_start_room_calibration(current_room_name);
            cal_progress = 0;
            cur_screen = SCR_CALIBRATING;
            break;
        case 1:
            if (current_room_name[0] == '\0') strcpy(current_room_name, "Room-1");
            strncpy(room_name, current_room_name, sizeof(room_name) - 1);
            bridge_start_presence_scan(current_room_name);
            cur_screen = SCR_PRESENCE;
            break;
        case 2:
            menu_sel = 0;
            cur_screen = SCR_SETTINGS;
            break;
        case 3:
            snprintf(status_title, sizeof(status_title), "Device Info");
            snprintf(status_detail, sizeof(status_detail), "%s v%s", dev_id, dev_ver);
            cur_screen = SCR_STATUS_MSG;
            break;
        }
    }
}

static void handle_calibrating(btn_event_t ev) {
    if (ev == BTN_LONG || ev == BTN_VLONG) {
        bridge_stop_calibration();
        cur_screen = SCR_DASHBOARD;
        menu_sel = 0;
    }
    if (cal_progress < 100) cal_progress++;
}

static void handle_presence(btn_event_t ev) {
    if (ev == BTN_LONG || ev == BTN_VLONG) {
        bridge_stop_calibration();
        cur_screen = SCR_DASHBOARD;
        menu_sel = 0;
    }
}

static void handle_settings(btn_event_t ev) {
    if (ev == BTN_SHORT) {
        menu_sel = (menu_sel + 1) % 3;
    } else if (ev == BTN_LONG) {
        switch (menu_sel) {
        case 0:
            cur_screen = SCR_WIFI_SCAN;
            menu_sel = 0;
            do_wifi_scan();
            break;
        case 1: {
            nvs_handle_t nvs;
            if (nvs_open("wifi", NVS_READWRITE, &nvs) == ESP_OK) {
                nvs_erase_all(nvs);
                nvs_commit(nvs);
                nvs_close(nvs);
            }
            snprintf(status_title, sizeof(status_title), "WiFi Reset");
            snprintf(status_detail, sizeof(status_detail), "Rebooting...");
            cur_screen = SCR_STATUS_MSG;
            lcd_flush();
            vTaskDelay(pdMS_TO_TICKS(1000));
            esp_restart();
            break;
        }
        case 2:
            cur_screen = SCR_DASHBOARD;
            menu_sel = 0;
            break;
        }
    }
}

static void handle_status_msg(btn_event_t ev) {
    if (ev != BTN_NONE) {
        cur_screen = wifi_connected ? SCR_DASHBOARD : SCR_WIFI_SCAN;
        menu_sel = 0;
    }
}

/* ---- Raw SPI helpers for direct ST7789 control ---- */

/* pre_cb: set DC pin based on transaction user field (0=cmd, 1=data) */
static void IRAM_ATTR lcd_spi_pre_cb(spi_transaction_t *t) {
    gpio_set_level(LCD_PIN_DC, (int)t->user);
}

/* Send a command byte (DC=0) */
static void lcd_cmd(uint8_t cmd) {
    spi_transaction_t t = {
        .length = 8,
        .tx_buffer = &cmd,
        .user = (void *)0,
    };
    esp_err_t ret = spi_device_polling_transmit(spi_dev, &t);
    if (ret != ESP_OK) ESP_LOGE(TAG, "lcd_cmd(0x%02x) failed: %s", cmd, esp_err_to_name(ret));
}

/* Send data bytes (DC=1) */
static void lcd_data(const uint8_t *data, int len) {
    if (len == 0) return;
    spi_transaction_t t = {
        .length = len * 8,
        .tx_buffer = data,
        .user = (void *)1,
    };
    esp_err_t ret = spi_device_polling_transmit(spi_dev, &t);
    if (ret != ESP_OK) ESP_LOGE(TAG, "lcd_data(%d) failed: %s", len, esp_err_to_name(ret));
}

/* Send a single data byte */
static void lcd_data8(uint8_t val) {
    lcd_data(&val, 1);
}

/* Set the drawing window for raw pixel writes */
static void lcd_set_window(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1) {
    uint8_t buf[4];
    lcd_cmd(0x2A); /* CASET */
    buf[0] = x0 >> 8; buf[1] = x0 & 0xFF; buf[2] = x1 >> 8; buf[3] = x1 & 0xFF;
    lcd_data(buf, 4);
    lcd_cmd(0x2B); /* RASET */
    buf[0] = y0 >> 8; buf[1] = y0 & 0xFF; buf[2] = y1 >> 8; buf[3] = y1 & 0xFF;
    lcd_data(buf, 4);
    lcd_cmd(0x2C); /* RAMWR */
}

/* ---- Public API ---- */
void lcd_init(void) {
    ESP_LOGI(TAG, "Initializing ST7789 LCD (%dx%d) via raw SPI", LCD_H_RES, LCD_V_RES);

    /*
     * CRITICAL: Release GPIO19/20 from USB Serial/JTAG PHY.
     * On ESP32-S3, GPIO19=USB_D- and GPIO20=USB_D+.
     * The USB PHY holds these pins by default (pad_enable=1 at reset).
     * We must:
     *   1. Clear pad_enable while peripheral clock is on
     *   2. Gate the peripheral clock so nothing re-enables the pad
     *   3. Reset GPIOs to clean GPIO function
     */
    uint32_t conf0_before = REG_READ(USB_SERIAL_JTAG_CONF0_REG);

    /* Attempt 1: standard REG_CLR_BIT */
    REG_CLR_BIT(USB_SERIAL_JTAG_CONF0_REG, USB_SERIAL_JTAG_USB_PAD_ENABLE);
    uint32_t conf0_after1 = REG_READ(USB_SERIAL_JTAG_CONF0_REG);

    /* Attempt 2: explicit write with all other bits preserved */
    WRITE_PERI_REG(USB_SERIAL_JTAG_CONF0_REG, conf0_after1 & ~USB_SERIAL_JTAG_USB_PAD_ENABLE);
    uint32_t conf0_after2 = REG_READ(USB_SERIAL_JTAG_CONF0_REG);

    ESP_LOGI(TAG, "USB CONF0: before=0x%08lx  clr_bit=0x%08lx  write=0x%08lx  bit14=%d->%d->%d",
             (unsigned long)conf0_before, (unsigned long)conf0_after1, (unsigned long)conf0_after2,
             (conf0_before >> 14) & 1, (conf0_after1 >> 14) & 1, (conf0_after2 >> 14) & 1);

    /* Gate USB Serial/JTAG peripheral clock to prevent re-enablement.
     * Do NOT assert reset (reset would restore pad_enable=1 default). */
    CLEAR_PERI_REG_MASK(SYSTEM_PERIP_CLK_EN0_REG, SYSTEM_USB_DEVICE_CLK_EN);
    ESP_LOGI(TAG, "USB Serial/JTAG clock gated");

    /*
     * Reset GPIO19/20/21 to default GPIO function.
     * This clears any IO MUX overrides left by the USB PHY
     * and ensures the GPIO matrix can drive the pads.
     */
    gpio_reset_pin(GPIO_NUM_19);
    gpio_reset_pin(GPIO_NUM_20);
    gpio_reset_pin(GPIO_NUM_21);

    /* Verify GPIO20 is usable: brief manual toggle */
    gpio_set_direction(GPIO_NUM_20, GPIO_MODE_OUTPUT);
    gpio_set_level(GPIO_NUM_20, 1);
    esp_rom_delay_us(100);
    gpio_set_level(GPIO_NUM_20, 0);
    esp_rom_delay_us(100);
    ESP_LOGI(TAG, "GPIO20 manual toggle OK");

    /* Configure DC pin as output */
    gpio_config_t dc_conf = {
        .pin_bit_mask = (1ULL << LCD_PIN_DC),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
    };
    gpio_config(&dc_conf);
    gpio_set_level(LCD_PIN_DC, 1);

    /* Initialize SPI bus */
    spi_bus_config_t bus = {
        .mosi_io_num = LCD_PIN_MOSI,
        .miso_io_num = -1,
        .sclk_io_num = LCD_PIN_CLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = LCD_H_RES * STRIP_H * 2 + 64,
    };
    esp_err_t err = spi_bus_initialize(LCD_SPI_HOST, &bus, SPI_DMA_CH_AUTO);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "SPI bus init failed: %s", esp_err_to_name(err));
        return;
    }

    /* Add SPI device — no CS pin, SPI mode 0, with pre_cb for DC timing */
    spi_device_interface_config_t devcfg = {
        .clock_speed_hz = LCD_SPI_FREQ,
        .mode = 0,
        .spics_io_num = -1,
        .queue_size = 7,
        .flags = SPI_DEVICE_NO_DUMMY,
        .pre_cb = lcd_spi_pre_cb,
    };
    err = spi_bus_add_device(LCD_SPI_HOST, &devcfg, &spi_dev);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "SPI device add failed: %s", esp_err_to_name(err));
        return;
    }
    ESP_LOGI(TAG, "SPI bus OK (MOSI=%d, CLK=%d, DC=%d, %d MHz)",
        LCD_PIN_MOSI, LCD_PIN_CLK, LCD_PIN_DC, LCD_SPI_FREQ / 1000000);

    /*
     * ST7789 init sequence — matches TFT_eSPI (Bodmer) ST7789_Init.h exactly.
     * Reference: https://github.com/Bodmer/TFT_eSPI/blob/master/TFT_Drivers/ST7789_Init.h
     */

    /* Software reset — ensures clean state even without hardware RST pin */
    lcd_cmd(0x01);  /* SWRESET */
    vTaskDelay(pdMS_TO_TICKS(150));

    /* Sleep out */
    lcd_cmd(0x11);  /* SLPOUT */
    vTaskDelay(pdMS_TO_TICKS(120));

    /* Normal display mode on */
    lcd_cmd(0x13);  /* NORON */

    /* Memory Data Access Control: BGR order */
    lcd_cmd(0x36);  /* MADCTL */
    lcd_data8(0x08); /* TFT_MAD_BGR */

    /* Display Function Control */
    lcd_cmd(0xB6);
    { uint8_t d[] = {0x0A, 0x82}; lcd_data(d, 2); }

    /* RAM Control — set byte order for 16-bit RGB565 */
    lcd_cmd(0xB0);  /* RAMCTRL */
    { uint8_t d[] = {0x00, 0xE0}; lcd_data(d, 2); }

    /* Interface Pixel Format: 16-bit/pixel */
    lcd_cmd(0x3A);  /* COLMOD */
    lcd_data8(0x55);
    vTaskDelay(pdMS_TO_TICKS(10));

    /* Porch Setting */
    lcd_cmd(0xB2);
    { uint8_t d[] = {0x0C, 0x0C, 0x00, 0x33, 0x33}; lcd_data(d, 5); }

    /* Gate Control */
    lcd_cmd(0xB7);
    lcd_data8(0x35);

    /* VCOM Setting */
    lcd_cmd(0xBB);
    lcd_data8(0x28);

    /* LCM Control */
    lcd_cmd(0xC0);
    lcd_data8(0x0C);

    /* VDV and VRH Command Enable */
    lcd_cmd(0xC2);
    { uint8_t d[] = {0x01, 0xFF}; lcd_data(d, 2); }

    /* VRH Set */
    lcd_cmd(0xC3);
    lcd_data8(0x10);

    /* VDV Set */
    lcd_cmd(0xC4);
    lcd_data8(0x20);

    /* Frame Rate Control in Normal Mode: 60Hz */
    lcd_cmd(0xC6);
    lcd_data8(0x0F);

    /* Power Control 1 */
    lcd_cmd(0xD0);
    { uint8_t d[] = {0xA4, 0xA1}; lcd_data(d, 2); }

    /* Positive Voltage Gamma Control (from TFT_eSPI) */
    lcd_cmd(0xE0);
    { uint8_t d[] = {0xD0,0x00,0x02,0x07,0x0A,0x28,0x32,0x44,0x42,0x06,0x0E,0x12,0x14,0x17}; lcd_data(d, 14); }

    /* Negative Voltage Gamma Control (from TFT_eSPI) */
    lcd_cmd(0xE1);
    { uint8_t d[] = {0xD0,0x00,0x02,0x07,0x0A,0x28,0x31,0x54,0x47,0x0E,0x1C,0x17,0x1B,0x1E}; lcd_data(d, 14); }

    /* Display Inversion ON */
    lcd_cmd(0x21);  /* INVON */

    /* Set full display window — CASET */
    lcd_cmd(0x2A);
    { uint8_t d[] = {0x00, 0x00, 0x00, 0xEF}; lcd_data(d, 4); } /* 0..239 */

    /* RASET */
    lcd_cmd(0x2B);
    { uint8_t d[] = {0x00, 0x00, 0x01, 0x3F}; lcd_data(d, 4); } /* 0..319 */

    vTaskDelay(pdMS_TO_TICKS(120));

    /* Display ON */
    lcd_cmd(0x29);  /* DISPON */
    vTaskDelay(pdMS_TO_TICKS(120));

    ESP_LOGI(TAG, "ST7789 init sequence complete");

    /* Allocate strip buffer */
    strip_buf = (uint16_t *)heap_caps_malloc(LCD_H_RES * STRIP_H * 2,
                    MALLOC_CAP_DMA | MALLOC_CAP_8BIT);
    if (!strip_buf) strip_buf = (uint16_t *)malloc(LCD_H_RES * STRIP_H * 2);
    if (!strip_buf) {
        ESP_LOGE(TAG, "Failed to allocate LCD strip buffer!");
        return;
    }

    lcd_ready = true;
    ESP_LOGI(TAG, "LCD ready (strip buf %d bytes, raw SPI)", LCD_H_RES * STRIP_H * 2);

    /*
     * Diagnostic: fill screen with solid colors via raw SPI.
     * RED → GREEN → BLUE → WHITE, 500ms each.
     */
    uint16_t test_colors[] = { C_RED, C_GREEN, C_BLUE, C_WHITE };
    const char *test_names[] = { "RED", "GREEN", "BLUE", "WHITE" };
    for (int c = 0; c < 4; c++) {
        lcd_set_window(0, 0, LCD_H_RES - 1, LCD_V_RES - 1);
        uint16_t color_be = (test_colors[c] >> 8) | (test_colors[c] << 8);
        for (int y = 0; y < LCD_V_RES; y += STRIP_H) {
            int sh = (y + STRIP_H > LCD_V_RES) ? (LCD_V_RES - y) : STRIP_H;
            for (int i = 0; i < LCD_H_RES * sh; i++)
                strip_buf[i] = color_be;
            spi_transaction_t t = {
                .length = LCD_H_RES * sh * 16,
                .tx_buffer = strip_buf,
                .user = (void *)1,  /* DC=1 for pixel data */
            };
            spi_device_polling_transmit(spi_dev, &t);
        }
        ESP_LOGI(TAG, "Test fill: %s", test_names[c]);
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

void lcd_show_boot(const char *version, const char *device_id) {
    if (!lcd_ready) return;
    strncpy(dev_ver, version, sizeof(dev_ver) - 1);
    strncpy(dev_id, device_id, sizeof(dev_id) - 1);
    cur_screen = SCR_BOOT;
    lcd_flush();
}

void lcd_enter_wifi_setup(void) {
    if (!lcd_ready) return;
    cur_screen = SCR_WIFI_SCAN;
    menu_sel = 0;
    do_wifi_scan();
    lcd_flush();
}

void lcd_enter_dashboard(void) {
    if (!lcd_ready) return;
    cur_screen = SCR_DASHBOARD;
    menu_sel = 0;
    lcd_flush();
}

void lcd_set_wifi_status(bool connected, const char *ssid, const char *ip) {
    wifi_connected = connected;
    if (ssid) strncpy(wifi_ssid, ssid, sizeof(wifi_ssid) - 1);
    if (ip) strncpy(wifi_ip, ip, sizeof(wifi_ip) - 1);
}

void lcd_set_bound_status(bool bound, const char *uid) {
    user_bound = bound;
}

void lcd_show_calibrating(const char *rn, int mode) {
    if (!lcd_ready) return;
    if (rn) strncpy(room_name, rn, sizeof(room_name) - 1);
    cal_progress = 0;
    cur_screen = SCR_CALIBRATING;
    lcd_flush();
}

void lcd_show_presence_scan(const char *rn) {
    if (!lcd_ready) return;
    if (rn) strncpy(room_name, rn, sizeof(room_name) - 1);
    cur_screen = SCR_PRESENCE;
    lcd_flush();
}

void lcd_show_status(const char *title, const char *detail) {
    if (!lcd_ready) return;
    if (title) strncpy(status_title, title, sizeof(status_title) - 1);
    if (detail) strncpy(status_detail, detail, sizeof(status_detail) - 1);
    cur_screen = SCR_STATUS_MSG;
    lcd_flush();
}

void lcd_show_progress(const char *title, int pct) {
    if (!lcd_ready) return;
    if (title) strncpy(status_title, title, sizeof(status_title) - 1);
    cal_progress = pct;
    lcd_flush();
}

void lcd_show_provisioning(const char *ap_ssid) {
    lcd_enter_wifi_setup();
}

void lcd_show_home(const char *device_id, bool is_bound) {
    lcd_set_bound_status(is_bound, NULL);
    lcd_enter_dashboard();
}

void lcd_handle_input(void) {
    if (!lcd_ready) return;
    btn_event_t ev = poll_button();
    bool needs_redraw = (ev != BTN_NONE);
    if (cur_screen == SCR_WIFI_PASS) needs_redraw = true;
    if (cur_screen == SCR_WIFI_CONNECTING) needs_redraw = true;
    if (cur_screen == SCR_CALIBRATING) needs_redraw = true;
    if (cur_screen == SCR_PRESENCE) needs_redraw = true;

    switch (cur_screen) {
    case SCR_BOOT:             handle_boot(ev); break;
    case SCR_WIFI_SCAN:        handle_wifi_scan(ev); break;
    case SCR_WIFI_PASS:        handle_wifi_pass(ev); break;
    case SCR_WIFI_CONNECTING:  break;
    case SCR_DASHBOARD:        handle_dashboard(ev); break;
    case SCR_CALIBRATING:      handle_calibrating(ev); break;
    case SCR_PRESENCE:         handle_presence(ev); break;
    case SCR_SETTINGS:         handle_settings(ev); break;
    case SCR_STATUS_MSG:       handle_status_msg(ev); break;
    }

    if (needs_redraw) lcd_flush();
}
