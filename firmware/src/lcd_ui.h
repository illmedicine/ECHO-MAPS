/**
 * LCD UI module for Illy Bridge — FNK0086 ST7789 240×240
 *
 * Full button-navigated UI system with WiFi scanning, password entry,
 * calibration controls, and Echo Vue integration dashboard.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

/* Initialize the ST7789 LCD display and button */
void lcd_init(void);

/* Boot screen */
void lcd_show_boot(const char *version, const char *device_id);

/* Screen transitions */
void lcd_enter_wifi_setup(void);
void lcd_enter_dashboard(void);

/* State updates from main */
void lcd_set_wifi_status(bool connected, const char *ssid, const char *ip);
void lcd_set_bound_status(bool bound, const char *user_id);

/* Screen pages */
void lcd_show_home(const char *device_id, bool is_bound);
void lcd_show_status(const char *title, const char *detail);
void lcd_show_provisioning(const char *ap_ssid);
void lcd_show_calibrating(const char *room_name, int cal_mode);
void lcd_show_presence_scan(const char *room_name);
void lcd_show_progress(const char *title, int percent);

/* Handle button input — call from main loop at ~50ms interval */
void lcd_handle_input(void);
