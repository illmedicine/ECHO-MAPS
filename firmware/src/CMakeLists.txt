idf_component_register(
    SRCS "main.c" "lcd_ui.c" "camera_capture.c" "bridge_httpd.c" "audio_io.c"
    INCLUDE_DIRS "."
    REQUIRES
        esp_wifi esp_event esp_netif nvs_flash
        esp_http_server mdns esp-tls
        driver esp_lcd
        json freertos esp_timer esp_system
    PRIV_REQUIRES esp_psram
)
