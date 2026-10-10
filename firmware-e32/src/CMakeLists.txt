# Shared, hardware-independent modules are compiled straight from the Freenove
# project so both bridges stay in sync. Nothing under ../firmware is modified.
set(SHARED ../../firmware/src)
idf_component_register(
    SRCS "main.c" "lcd_e32.c"
         "${SHARED}/presence_csi.c" "${SHARED}/presence_ble.c" "${SHARED}/bridge_httpd.c"
    INCLUDE_DIRS "." "${SHARED}"
    REQUIRES
        esp_wifi esp_event esp_netif nvs_flash
        esp_http_server esp_http_client mdns esp-tls lwip mbedtls
        driver json freertos esp_timer esp_system bt
)
