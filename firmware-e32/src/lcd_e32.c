/**
 * LCD UI for Illy Bridge on the LCDWiki 4.0" ESP32-32E (E32R40T / E32N40T).
 *
 * Implements the same lcd_ui.h API as the Freenove build, but for a 480x320
 * ST7796 panel on the ESP32's HSPI bus. Display-only: the dashboard shows live
 * CSI/WiFi/backend state and needs no touch or buttons, so both the resistive
 * and capacitive variants of the module work.
 *
 * Pins (LCDWiki 4.0" ESP32-32E):
 *   MOSI=13 SCLK=14 CS=15 DC=2 RST=EN(board reset) BL=27, MISO unused
 *
 * No PSRAM, so nothing is double-buffered: text is drawn glyph-by-glyph with an
 * opaque background (no flicker, no framebuffer), and only changed fields are redrawn.
 */

#include "lcd_ui.h"
#include "presence_csi.h"
#include "font5x7.h"

#include <stdio.h>
#include <string.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

static const char *TAG = "lcd-e32";

/* ---- Hardware ---- */
#define LCD_HOST      SPI2_HOST
#define PIN_MOSI      13
#define PIN_SCLK      14
#define PIN_CS        15
#define PIN_DC        2
#define PIN_BL        27
#define LCD_W         480
#define LCD_H         320
#define LCD_SPI_HZ    (40 * 1000 * 1000)

/* Panel quirks. If colours look wrong on first boot, flip these two. */
#define LCD_MADCTL    0x28   /* MV|BGR = landscape. 0xE8 = rotated 180 deg. */
#define LCD_INVERT    0      /* 1 = send INVON (some IPS panels need it) */

/* ---- Palette (RGB565) ---- */
#define C_BLACK   0x0000
#define C_WHITE   0xFFFF
#define C_RED     0xF800
#define C_GREEN   0x07E0
#define C_BLUE    0x001F
#define C_YELLOW  0xFFE0
#define C_ORANGE  0xFD20
#define C_GREY    0x8410
#define C_DARK    0x18E3
#define C_PANEL   0x10A2
#define C_ACCENT  0x04FF

typedef enum { SCR_BOOT, SCR_MSG, SCR_WIFI_SETUP, SCR_DASH, SCR_CAL } screen_t;

static spi_device_handle_t s_spi;
static SemaphoreHandle_t s_lock;
static bool s_ready;
static screen_t s_screen = SCR_BOOT;

static uint16_t *s_chunk;                 /* DMA-capable scratch for fills */
#define CHUNK_PX 2048

static char s_version[16], s_device_id[24];
static char s_msg_title[40], s_msg_detail[64];
static char s_room[64];
static bool s_wifi_ok, s_bound;
static char s_ssid[40], s_ip[20], s_user[40];
static int64_t s_msg_until_us;            /* dashboard shows the toast until this */

/* ---- SPI primitives ---- */
static void IRAM_ATTR pre_cb(spi_transaction_t *t) {
    gpio_set_level(PIN_DC, (int)(intptr_t)t->user);
}

static void tx(const void *data, int len, int dc) {
    if (len <= 0) return;
    spi_transaction_t t = { .length = (size_t)len * 8, .tx_buffer = data, .user = (void *)(intptr_t)dc };
    spi_device_polling_transmit(s_spi, &t);
}
static void cmd(uint8_t c) { tx(&c, 1, 0); }
static void dat(const uint8_t *d, int n) { tx(d, n, 1); }
static void cmd_d(uint8_t c, const uint8_t *d, int n) { cmd(c); if (n) dat(d, n); }

static void set_window(int x0, int y0, int x1, int y1) {
    uint8_t a[4] = { x0 >> 8, x0 & 0xFF, x1 >> 8, x1 & 0xFF };
    uint8_t b[4] = { y0 >> 8, y0 & 0xFF, y1 >> 8, y1 & 0xFF };
    cmd_d(0x2A, a, 4);
    cmd_d(0x2B, b, 4);
    cmd(0x2C);
}

/* RGB565 big-endian on the wire */
static inline uint16_t be(uint16_t c) { return (uint16_t)((c << 8) | (c >> 8)); }

static void fill_rect(int x, int y, int w, int h, uint16_t color) {
    if (!s_ready || w <= 0 || h <= 0) return;
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > LCD_W) w = LCD_W - x;
    if (y + h > LCD_H) h = LCD_H - y;
    if (w <= 0 || h <= 0) return;
    set_window(x, y, x + w - 1, y + h - 1);
    uint16_t c = be(color);
    int n = CHUNK_PX < w * h ? CHUNK_PX : w * h;
    for (int i = 0; i < n; i++) s_chunk[i] = c;
    int left = w * h;
    while (left > 0) {
        int k = left < CHUNK_PX ? left : CHUNK_PX;
        tx(s_chunk, k * 2, 1);
        left -= k;
    }
}

/* One glyph with opaque background, scaled. 5x7 cell + 1px gap. */
static void draw_char(int x, int y, char ch, uint16_t fg, uint16_t bg, int sc) {
    if (ch < 32 || ch > 126) ch = '?';
    const uint8_t *g = font5x7[ch - 32];
    int w = 6 * sc, h = 8 * sc;
    if (x + w > LCD_W || y + h > LCD_H) return;
    uint16_t f = be(fg), b = be(bg);
    int i = 0;
    for (int row = 0; row < 8; row++) {
        for (int sy = 0; sy < sc; sy++) {
            for (int col = 0; col < 6; col++) {
                uint16_t px = (col < 5 && row < 7 && (g[col] & (1 << row))) ? f : b;
                for (int sx = 0; sx < sc; sx++) s_chunk[i++] = px;
            }
        }
    }
    set_window(x, y, x + w - 1, y + h - 1);
    tx(s_chunk, w * h * 2, 1);
}

/* Draws s, then pads with background out to `cols` characters so stale text is overwritten. */
static void text(int x, int y, const char *s, uint16_t fg, uint16_t bg, int sc, int cols) {
    if (!s_ready) return;
    int n = 0;
    for (; s[n] && (cols <= 0 || n < cols); n++) draw_char(x + n * 6 * sc, y, s[n], fg, bg, sc);
    for (; cols > 0 && n < cols; n++) draw_char(x + n * 6 * sc, y, ' ', fg, bg, sc);
}

static void text_center(int y, const char *s, uint16_t fg, uint16_t bg, int sc) {
    int w = (int)strlen(s) * 6 * sc;
    text((LCD_W - w) / 2 > 0 ? (LCD_W - w) / 2 : 0, y, s, fg, bg, sc, 0);
}

/* ---- Screens ---- */
static void header(const char *right) {
    fill_rect(0, 0, LCD_W, 40, C_PANEL);
    text(12, 10, "ILLY BRIDGE", C_ACCENT, C_PANEL, 3, 0);
    if (right && right[0]) {
        int w = (int)strlen(right) * 12;
        text(LCD_W - w - 12, 14, right, C_GREY, C_PANEL, 2, 0);
    }
}

static void render_boot(void) {
    fill_rect(0, 0, LCD_W, LCD_H, C_BLACK);
    text_center(60, "ILLY BRIDGE", C_ACCENT, C_BLACK, 5);
    text_center(110, "Echo Maps presence sensing", C_WHITE, C_BLACK, 2);
    char v[48];
    snprintf(v, sizeof(v), "v%s  ESP32-32E 4.0in", s_version);
    text_center(140, v, C_GREY, C_BLACK, 2);
    text_center(166, s_device_id, C_GREY, C_BLACK, 2);
    /* colour-order check: left to right must read RED, GREEN, BLUE */
    fill_rect(120, 210, 80, 40, C_RED);
    fill_rect(200, 210, 80, 40, C_GREEN);
    fill_rect(280, 210, 80, 40, C_BLUE);
    text_center(264, "Starting...", C_YELLOW, C_BLACK, 2);
}

static void render_msg(void) {
    fill_rect(0, 0, LCD_W, LCD_H, C_BLACK);
    header("");
    text_center(130, s_msg_title, C_WHITE, C_BLACK, 3);
    text_center(180, s_msg_detail, C_YELLOW, C_BLACK, 2);
}

static void render_wifi_setup(void) {
    fill_rect(0, 0, LCD_W, LCD_H, C_BLACK);
    header("WiFi setup");
    text_center(70, "Could not join WiFi", C_ORANGE, C_BLACK, 3);
    text(30, 130, "1. Join WiFi:  IllyBridge-Setup", C_WHITE, C_BLACK, 2, 0);
    text(30, 160, "2. Open:       http://192.168.4.1", C_WHITE, C_BLACK, 2, 0);
    text(30, 190, "3. Pick your network and save", C_WHITE, C_BLACK, 2, 0);
    text_center(260, s_device_id, C_GREY, C_BLACK, 2);
}

static void render_cal(void) {
    fill_rect(0, 0, LCD_W, LCD_H, C_BLACK);
    header("calibration");
    text_center(120, s_msg_title, C_YELLOW, C_BLACK, 3);
    text_center(170, s_room, C_WHITE, C_BLACK, 3);
}

/* Dashboard rows. Labels are drawn once; values are redrawn only when they change. */
#define ROW_Y0   48
#define ROW_DY   24
#define VAL_X    190
typedef struct { const char *label; char last[48]; uint16_t color; } row_t;
#define ROW(l) { .label = (l), .last = "", .color = 0 }
static row_t s_rows[] = {
    ROW("AREA"), ROW("BRIDGE"), ROW("WIFI"), ROW("IP"), ROW("BACKEND"),
    ROW("CSI FRAMES"), ROW("WINDOWS SENT"), ROW("MOTION / RSSI"), ROW("UPTIME"), ROW("FREE HEAP"),
};
#define NROWS ((int)(sizeof(s_rows) / sizeof(s_rows[0])))

static void render_dash_frame(void) {
    fill_rect(0, 0, LCD_W, LCD_H, C_BLACK);
    header(s_version);
    for (int i = 0; i < NROWS; i++) {
        text(12, ROW_Y0 + i * ROW_DY, s_rows[i].label, C_GREY, C_BLACK, 2, 0);
        s_rows[i].last[0] = 0;
    }
    text_center(LCD_H - 10, s_device_id, C_GREY, C_BLACK, 1);
}

static void set_row(int i, const char *val, uint16_t color) {
    if (strcmp(s_rows[i].last, val) == 0 && s_rows[i].color == color) return;
    strlcpy(s_rows[i].last, val, sizeof(s_rows[i].last));
    s_rows[i].color = color;
    text(VAL_X, ROW_Y0 + i * ROW_DY, val, color, C_BLACK, 2, 24);
}

static void refresh_dash(void) {
    char b[64], area[48], name[48];
    presence_zone_get(area, sizeof(area));
    presence_bridge_name_get(name, sizeof(name));
    presence_stats_t st = presence_csi_stats();

    set_row(0, area, C_WHITE);
    set_row(1, name, C_WHITE);
    set_row(2, s_wifi_ok ? s_ssid : "offline", s_wifi_ok ? C_GREEN : C_RED);
    set_row(3, s_ip[0] ? s_ip : "-", C_WHITE);
    if (st.windows_sent == 0 && !st.backend_ok) set_row(4, st.post_failures ? "unreachable" : "waiting", st.post_failures ? C_RED : C_YELLOW);
    else set_row(4, st.backend_ok ? "OK" : "FAILING", st.backend_ok ? C_GREEN : C_RED);
    snprintf(b, sizeof(b), "%u", (unsigned)st.frames_total);
    set_row(5, b, st.frames_total ? C_WHITE : C_YELLOW);
    snprintf(b, sizeof(b), "%u (fail %u)", (unsigned)st.windows_sent, (unsigned)st.post_failures);
    set_row(6, b, C_WHITE);
    snprintf(b, sizeof(b), "%.2f / %d dBm", st.last_amp_cv, st.last_rssi);
    set_row(7, b, C_WHITE);
    int64_t s = esp_timer_get_time() / 1000000;
    snprintf(b, sizeof(b), "%dh %02dm %02ds", (int)(s / 3600), (int)((s / 60) % 60), (int)(s % 60));
    set_row(8, b, C_WHITE);
    snprintf(b, sizeof(b), "%u KB", (unsigned)(heap_caps_get_free_size(MALLOC_CAP_8BIT) / 1024));
    set_row(9, b, C_WHITE);

    /* toast line under the rows */
    bool toast = esp_timer_get_time() < s_msg_until_us;
    static bool was_toast;
    if (toast) {
        char t[112];
        snprintf(t, sizeof(t), "%s: %s", s_msg_title, s_msg_detail);
        text(12, ROW_Y0 + NROWS * ROW_DY + 2, t, C_YELLOW, C_BLACK, 2, 38);
    } else if (was_toast) {
        fill_rect(0, ROW_Y0 + NROWS * ROW_DY, LCD_W, 20, C_BLACK);
    }
    was_toast = toast;
}

static void render_current(void) {
    switch (s_screen) {
    case SCR_BOOT:       render_boot(); break;
    case SCR_MSG:        render_msg(); break;
    case SCR_WIFI_SETUP: render_wifi_setup(); break;
    case SCR_DASH:       render_dash_frame(); refresh_dash(); break;
    case SCR_CAL:        render_cal(); break;
    }
}

static void go(screen_t s) {
    if (!s_ready) return;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_screen = s;
    render_current();
    xSemaphoreGive(s_lock);
}

/* ---- Init ---- */
void lcd_init(void) {
    s_lock = xSemaphoreCreateMutex();
    s_chunk = heap_caps_malloc(CHUNK_PX * 2, MALLOC_CAP_DMA);
    if (!s_chunk) { ESP_LOGE(TAG, "no DMA buffer"); return; }

    gpio_config_t io = { .pin_bit_mask = (1ULL << PIN_DC) | (1ULL << PIN_BL), .mode = GPIO_MODE_OUTPUT };
    gpio_config(&io);
    gpio_set_level(PIN_BL, 0);

    spi_bus_config_t bus = {
        .mosi_io_num = PIN_MOSI, .miso_io_num = -1, .sclk_io_num = PIN_SCLK,
        .quadwp_io_num = -1, .quadhd_io_num = -1,
        .max_transfer_sz = CHUNK_PX * 2 + 8,
    };
    if (spi_bus_initialize(LCD_HOST, &bus, SPI_DMA_CH_AUTO) != ESP_OK) { ESP_LOGE(TAG, "spi bus init failed"); return; }
    spi_device_interface_config_t dev = {
        .clock_speed_hz = LCD_SPI_HZ, .mode = 0, .spics_io_num = PIN_CS,
        .queue_size = 4, .pre_cb = pre_cb,
    };
    if (spi_bus_add_device(LCD_HOST, &dev, &s_spi) != ESP_OK) { ESP_LOGE(TAG, "spi add device failed"); return; }
    s_ready = true;

    /* ST7796S init (LCDWiki / TFT_eSPI sequence) */
    cmd(0x01); vTaskDelay(pdMS_TO_TICKS(150));
    cmd(0x11); vTaskDelay(pdMS_TO_TICKS(120));
    cmd_d(0xF0, (uint8_t[]){0xC3}, 1);
    cmd_d(0xF0, (uint8_t[]){0x96}, 1);
    cmd_d(0x36, (uint8_t[]){LCD_MADCTL}, 1);
    cmd_d(0x3A, (uint8_t[]){0x55}, 1);                      /* RGB565 */
    cmd_d(0xB4, (uint8_t[]){0x01}, 1);
    cmd_d(0xB6, (uint8_t[]){0x80, 0x02, 0x3B}, 3);
    cmd_d(0xE8, (uint8_t[]){0x40, 0x8A, 0x00, 0x00, 0x29, 0x19, 0xA5, 0x33}, 8);
    cmd_d(0xC1, (uint8_t[]){0x06}, 1);
    cmd_d(0xC2, (uint8_t[]){0xA7}, 1);
    cmd_d(0xC5, (uint8_t[]){0x18}, 1);
    vTaskDelay(pdMS_TO_TICKS(120));
    cmd_d(0xE0, (uint8_t[]){0xF0,0x09,0x0B,0x06,0x04,0x15,0x2F,0x54,0x42,0x3C,0x17,0x14,0x18,0x1B}, 14);
    cmd_d(0xE1, (uint8_t[]){0xE0,0x09,0x0B,0x06,0x04,0x03,0x2B,0x43,0x42,0x3B,0x16,0x14,0x17,0x1B}, 14);
    vTaskDelay(pdMS_TO_TICKS(120));
    cmd_d(0xF0, (uint8_t[]){0x3C}, 1);
    cmd_d(0xF0, (uint8_t[]){0x69}, 1);
    vTaskDelay(pdMS_TO_TICKS(120));
    cmd(LCD_INVERT ? 0x21 : 0x20);
    cmd(0x29);
    vTaskDelay(pdMS_TO_TICKS(50));

    fill_rect(0, 0, LCD_W, LCD_H, C_BLACK);
    gpio_set_level(PIN_BL, 1);
    ESP_LOGI(TAG, "ST7796 480x320 ready");
}

/* ---- lcd_ui.h API ---- */
void lcd_show_boot(const char *version, const char *device_id) {
    strlcpy(s_version, version ? version : "", sizeof(s_version));
    strlcpy(s_device_id, device_id ? device_id : "", sizeof(s_device_id));
    go(SCR_BOOT);
}

void lcd_enter_wifi_setup(void) { go(SCR_WIFI_SETUP); }
void lcd_enter_dashboard(void)  { go(SCR_DASH); }

void lcd_set_wifi_status(bool connected, const char *ssid, const char *ip) {
    s_wifi_ok = connected;
    strlcpy(s_ssid, ssid ? ssid : "", sizeof(s_ssid));
    /* main.c re-sends the status with an empty IP right after connecting; keep the real one. */
    if (!connected) s_ip[0] = 0;
    else if (ip && ip[0]) strlcpy(s_ip, ip, sizeof(s_ip));
}

void lcd_set_bound_status(bool bound, const char *user_id) {
    s_bound = bound;
    strlcpy(s_user, user_id ? user_id : "", sizeof(s_user));
}

void lcd_show_status(const char *title, const char *detail) {
    strlcpy(s_msg_title, title ? title : "", sizeof(s_msg_title));
    strlcpy(s_msg_detail, detail ? detail : "", sizeof(s_msg_detail));
    if (s_screen == SCR_DASH) s_msg_until_us = esp_timer_get_time() + 6 * 1000000LL;  /* toast */
    else go(SCR_MSG);
}

void lcd_show_provisioning(const char *ap_ssid) { lcd_show_status("Provisioning", ap_ssid); }
void lcd_show_home(const char *device_id, bool is_bound) { (void)device_id; (void)is_bound; go(SCR_DASH); }
void lcd_show_progress(const char *title, int percent) {
    char d[16]; snprintf(d, sizeof(d), "%d%%", percent);
    lcd_show_status(title, d);
}

void lcd_show_calibrating(const char *room_name, int cal_mode) {
    (void)cal_mode;
    strlcpy(s_room, room_name ? room_name : "", sizeof(s_room));
    strlcpy(s_msg_title, "Calibrating", sizeof(s_msg_title));
    go(SCR_CAL);
}

void lcd_show_presence_scan(const char *room_name) {
    strlcpy(s_room, room_name ? room_name : "", sizeof(s_room));
    strlcpy(s_msg_title, "Presence scan", sizeof(s_msg_title));
    go(SCR_CAL);
}

/* Called from the main loop every ~50 ms: refreshes live values about once a second. */
void lcd_handle_input(void) {
    static int64_t next_us;
    int64_t now = esp_timer_get_time();
    if (!s_ready || s_screen != SCR_DASH || now < next_us) return;
    next_us = now + 1000000;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    refresh_dash();
    xSemaphoreGive(s_lock);
}
