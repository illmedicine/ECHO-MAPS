idf_component_register(
    SRCS "main.c" "lcd_ui.c" "presence_csi.c" "presence_ble.c" "bridge_httpd.c" "audio_io.c"
    INCLUDE_DIRS "."
    REQUIRES
        esp_wifi esp_event esp_netif nvs_flash
        esp_http_server esp_http_client mdns esp-tls lwip mbedtls
        driver esp_lcd
        json freertos esp_timer esp_system bt
    PRIV_REQUIRES esp_psram
)
