/**
 * Bridge HTTP server — local API for Echo Vue web app communication.
 *
 * Endpoints (served on port 80 for local network access):
 *   GET  /api/bridge/info         — device info + status
 *   POST /api/bridge/bind         — bind bridge to Echo Vue user
 *   POST /api/bridge/unbind       — unbind bridge from user
 *   POST /api/bridge/calibrate    — start room calibration
 *   POST /api/bridge/scan         — start presence detection scan
 *   POST /api/bridge/stop         — stop current operation
 *   GET  /api/bridge/status       — current calibration status
 *   POST /api/bridge/wifi         — configure WiFi credentials
 *   GET  /api/bridge/wifi/scan    — scan for available WiFi networks
 *   POST /api/bridge/camera/start — start camera for remote calibration
 *   POST /api/bridge/camera/stop  — stop camera/calibration remotely
 *
 * All responses are JSON. CORS headers included for web app access.
 */

#include "bridge_httpd.h"

#include <string.h>
#include <stdlib.h>
#include "esp_log.h"
#include "esp_http_server.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "cJSON.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "httpd";
static httpd_handle_t server = NULL;

/* External bridge state functions (defined in main.c) */
extern const char *get_bridge_device_id(void);
extern const char *get_bridge_version(void);
extern int get_bridge_status(void);
extern bool get_bridge_bound(void);
extern const char *get_bound_user_id(void);
extern void bridge_bind_user(const char *user_id);
extern void bridge_unbind_user(void);
extern void bridge_start_room_calibration(const char *room_name);
extern void bridge_start_presence_scan(const char *room_name);
extern void bridge_stop_calibration(void);
extern void save_wifi_creds(const char *ssid, const char *pass);

/* ── CORS preflight handler ── */
static esp_err_t cors_handler(httpd_req_t *req) {
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type, Authorization");
    httpd_resp_set_hdr(req, "Access-Control-Max-Age", "86400");
    httpd_resp_set_status(req, "204 No Content");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
}

static void set_cors_headers(httpd_req_t *req) {
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* ── GET /api/bridge/info ── */
static esp_err_t info_handler(httpd_req_t *req) {
    set_cors_headers(req);

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "device_id", get_bridge_device_id());
    cJSON_AddStringToObject(root, "version", get_bridge_version());
    cJSON_AddStringToObject(root, "model", "FNK0086");
    cJSON_AddStringToObject(root, "board", "Freenove ESP32-S3");
    cJSON_AddNumberToObject(root, "status", get_bridge_status());
    cJSON_AddBoolToObject(root, "is_bound", get_bridge_bound());
    if (get_bridge_bound()) {
        cJSON_AddStringToObject(root, "bound_user_id", get_bound_user_id());
    }

    /* Hardware capabilities */
    cJSON *hw = cJSON_CreateObject();
    cJSON_AddBoolToObject(hw, "camera", true);
    cJSON_AddBoolToObject(hw, "microphone", true);
    cJSON_AddBoolToObject(hw, "speaker", true);
    cJSON_AddBoolToObject(hw, "lcd", true);
    cJSON_AddBoolToObject(hw, "csi", true);
    cJSON_AddItemToObject(root, "hardware", hw);

    char *json = cJSON_PrintUnformatted(root);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json);

    free(json);
    cJSON_Delete(root);
    return ESP_OK;
}

/* ── POST /api/bridge/bind ── */
static esp_err_t bind_handler(httpd_req_t *req) {
    set_cors_headers(req);

    char buf[256] = {0};
    int len = httpd_req_recv(req, buf, sizeof(buf) - 1);
    if (len <= 0) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Missing body");
        return ESP_FAIL;
    }

    cJSON *body = cJSON_Parse(buf);
    if (!body) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON");
        return ESP_FAIL;
    }

    cJSON *user_id = cJSON_GetObjectItem(body, "user_id");
    if (!user_id || !cJSON_IsString(user_id)) {
        cJSON_Delete(body);
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Missing user_id");
        return ESP_FAIL;
    }

    bridge_bind_user(user_id->valuestring);
    cJSON_Delete(body);

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddBoolToObject(resp, "success", true);
    cJSON_AddStringToObject(resp, "device_id", get_bridge_device_id());
    cJSON_AddStringToObject(resp, "bound_user_id", get_bound_user_id());

    char *json = cJSON_PrintUnformatted(resp);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json);
    free(json);
    cJSON_Delete(resp);
    return ESP_OK;
}

/* ── POST /api/bridge/unbind ── */
static esp_err_t unbind_handler(httpd_req_t *req) {
    set_cors_headers(req);
    bridge_unbind_user();

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddBoolToObject(resp, "success", true);
    char *json = cJSON_PrintUnformatted(resp);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json);
    free(json);
    cJSON_Delete(resp);
    return ESP_OK;
}

/* ── POST /api/bridge/calibrate ── */
static esp_err_t calibrate_handler(httpd_req_t *req) {
    set_cors_headers(req);

    if (!get_bridge_bound()) {
        httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "Bridge not bound to a user");
        return ESP_FAIL;
    }

    char buf[256] = {0};
    int len = httpd_req_recv(req, buf, sizeof(buf) - 1);

    char room_name[64] = "Default Room";
    if (len > 0) {
        cJSON *body = cJSON_Parse(buf);
        if (body) {
            cJSON *room = cJSON_GetObjectItem(body, "room_name");
            if (room && cJSON_IsString(room)) {
                strncpy(room_name, room->valuestring, sizeof(room_name) - 1);
            }
            cJSON_Delete(body);
        }
    }

    bridge_start_room_calibration(room_name);

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddBoolToObject(resp, "success", true);
    cJSON_AddStringToObject(resp, "room_name", room_name);
    cJSON_AddStringToObject(resp, "mode", "room_scan");
    char *json = cJSON_PrintUnformatted(resp);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json);
    free(json);
    cJSON_Delete(resp);
    return ESP_OK;
}

/* ── POST /api/bridge/scan ── */
static esp_err_t scan_handler(httpd_req_t *req) {
    set_cors_headers(req);

    if (!get_bridge_bound()) {
        httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "Bridge not bound to a user");
        return ESP_FAIL;
    }

    char buf[256] = {0};
    int len = httpd_req_recv(req, buf, sizeof(buf) - 1);

    char room_name[64] = "Default Room";
    if (len > 0) {
        cJSON *body = cJSON_Parse(buf);
        if (body) {
            cJSON *room = cJSON_GetObjectItem(body, "room_name");
            if (room && cJSON_IsString(room)) {
                strncpy(room_name, room->valuestring, sizeof(room_name) - 1);
            }
            cJSON_Delete(body);
        }
    }

    bridge_start_presence_scan(room_name);

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddBoolToObject(resp, "success", true);
    cJSON_AddStringToObject(resp, "room_name", room_name);
    cJSON_AddStringToObject(resp, "mode", "presence_detect");
    char *json = cJSON_PrintUnformatted(resp);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json);
    free(json);
    cJSON_Delete(resp);
    return ESP_OK;
}

/* ── POST /api/bridge/stop ── */
static esp_err_t stop_handler(httpd_req_t *req) {
    set_cors_headers(req);
    bridge_stop_calibration();

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddBoolToObject(resp, "success", true);
    char *json = cJSON_PrintUnformatted(resp);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json);
    free(json);
    cJSON_Delete(resp);
    return ESP_OK;
}

/* ── GET /api/bridge/status ── */
static esp_err_t status_handler(httpd_req_t *req) {
    set_cors_headers(req);

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddStringToObject(resp, "device_id", get_bridge_device_id());
    cJSON_AddNumberToObject(resp, "status", get_bridge_status());
    cJSON_AddBoolToObject(resp, "is_bound", get_bridge_bound());

    /* Status labels */
    const char *status_labels[] = {
        "idle", "calibrating", "monitoring", "offline", "ota", "provisioning"
    };
    int st = get_bridge_status();
    if (st >= 0 && st <= 5) {
        cJSON_AddStringToObject(resp, "status_label", status_labels[st]);
    } else {
        cJSON_AddStringToObject(resp, "status_label", "error");
    }

    char *json = cJSON_PrintUnformatted(resp);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json);
    free(json);
    cJSON_Delete(resp);
    return ESP_OK;
}

/* ── POST /api/bridge/wifi ── */
static esp_err_t wifi_handler(httpd_req_t *req) {
    set_cors_headers(req);

    char buf[256] = {0};
    int len = httpd_req_recv(req, buf, sizeof(buf) - 1);
    if (len <= 0) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Missing body");
        return ESP_FAIL;
    }

    cJSON *body = cJSON_Parse(buf);
    if (!body) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON");
        return ESP_FAIL;
    }

    cJSON *ssid = cJSON_GetObjectItem(body, "ssid");
    cJSON *pass = cJSON_GetObjectItem(body, "password");
    if (!ssid || !cJSON_IsString(ssid)) {
        cJSON_Delete(body);
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Missing ssid");
        return ESP_FAIL;
    }

    save_wifi_creds(ssid->valuestring, pass && cJSON_IsString(pass) ? pass->valuestring : "");
    cJSON_Delete(body);

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddBoolToObject(resp, "success", true);
    cJSON_AddStringToObject(resp, "message", "WiFi credentials saved. Rebooting...");
    char *json = cJSON_PrintUnformatted(resp);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json);
    free(json);
    cJSON_Delete(resp);

    /* Reboot after short delay to apply new WiFi */
    vTaskDelay(pdMS_TO_TICKS(1000));
    esp_restart();

    return ESP_OK;
}

/* ── GET /api/bridge/wifi/scan ── Trigger WiFi scan and return results */
static esp_err_t wifi_scan_handler(httpd_req_t *req) {
    set_cors_headers(req);

    /* Switch to APSTA if needed to allow scanning */
    wifi_mode_t mode;
    esp_wifi_get_mode(&mode);
    if (mode == WIFI_MODE_AP) {
        esp_wifi_set_mode(WIFI_MODE_APSTA);
    }

    wifi_scan_config_t scan_cfg = {
        .ssid = NULL, .bssid = NULL, .channel = 0,
        .show_hidden = false,
        .scan_type = WIFI_SCAN_TYPE_ACTIVE,
        .scan_time = { .active = { .min = 100, .max = 300 } },
    };

    esp_err_t err = esp_wifi_scan_start(&scan_cfg, true);
    if (err != ESP_OK) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Scan failed");
        return ESP_FAIL;
    }

    uint16_t ap_count = 20;
    wifi_ap_record_t ap_records[20];
    esp_wifi_scan_get_ap_records(&ap_count, ap_records);

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddBoolToObject(resp, "success", true);
    cJSON_AddNumberToObject(resp, "count", ap_count);
    cJSON *networks = cJSON_CreateArray();
    for (int i = 0; i < ap_count; i++) {
        cJSON *net = cJSON_CreateObject();
        cJSON_AddStringToObject(net, "ssid", (char *)ap_records[i].ssid);
        cJSON_AddNumberToObject(net, "rssi", ap_records[i].rssi);
        cJSON_AddNumberToObject(net, "channel", ap_records[i].primary);
        cJSON_AddBoolToObject(net, "secure", ap_records[i].authmode != WIFI_AUTH_OPEN);
        const char *auth_str = "unknown";
        switch (ap_records[i].authmode) {
            case WIFI_AUTH_OPEN: auth_str = "open"; break;
            case WIFI_AUTH_WEP: auth_str = "wep"; break;
            case WIFI_AUTH_WPA_PSK: auth_str = "wpa"; break;
            case WIFI_AUTH_WPA2_PSK: auth_str = "wpa2"; break;
            case WIFI_AUTH_WPA_WPA2_PSK: auth_str = "wpa/wpa2"; break;
            case WIFI_AUTH_WPA3_PSK: auth_str = "wpa3"; break;
            default: break;
        }
        cJSON_AddStringToObject(net, "auth", auth_str);
        cJSON_AddItemToArray(networks, net);
    }
    cJSON_AddItemToObject(resp, "networks", networks);

    char *json = cJSON_PrintUnformatted(resp);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json);
    free(json);
    cJSON_Delete(resp);
    return ESP_OK;
}

/* ── POST /api/bridge/camera/start ── Start camera streaming remotely */
static esp_err_t camera_start_handler(httpd_req_t *req) {
    set_cors_headers(req);

    if (!get_bridge_bound()) {
        httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "Bridge not bound");
        return ESP_FAIL;
    }

    /* Read optional room name from body */
    char buf[256] = {0};
    int len = httpd_req_recv(req, buf, sizeof(buf) - 1);
    char room[64] = "Default Room";
    if (len > 0) {
        cJSON *body = cJSON_Parse(buf);
        if (body) {
            cJSON *r = cJSON_GetObjectItem(body, "room_name");
            if (r && cJSON_IsString(r)) strncpy(room, r->valuestring, sizeof(room) - 1);
            cJSON_Delete(body);
        }
    }

    bridge_start_room_calibration(room);

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddBoolToObject(resp, "success", true);
    cJSON_AddStringToObject(resp, "message", "Camera started for calibration");
    cJSON_AddStringToObject(resp, "room_name", room);
    char *json = cJSON_PrintUnformatted(resp);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json);
    free(json);
    cJSON_Delete(resp);
    return ESP_OK;
}

/* ── POST /api/bridge/camera/stop ── Stop camera/calibration remotely */
static esp_err_t camera_stop_handler(httpd_req_t *req) {
    set_cors_headers(req);
    bridge_stop_calibration();

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddBoolToObject(resp, "success", true);
    cJSON_AddStringToObject(resp, "message", "Camera stopped");
    char *json = cJSON_PrintUnformatted(resp);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json);
    free(json);
    cJSON_Delete(resp);
    return ESP_OK;
}

/* ── Register all routes ── */
void bridge_httpd_start(void) {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 20;
    config.uri_match_fn = httpd_uri_match_wildcard;
    config.lru_purge_enable = true;

    if (httpd_start(&server, &config) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server");
        return;
    }

    /* CORS preflight for all routes */
    httpd_uri_t cors_uri = {
        .uri = "/api/bridge/*",
        .method = HTTP_OPTIONS,
        .handler = cors_handler,
    };
    httpd_register_uri_handler(server, &cors_uri);

    /* API routes */
    httpd_uri_t routes[] = {
        {"/api/bridge/info",         HTTP_GET,  info_handler,         NULL},
        {"/api/bridge/bind",         HTTP_POST, bind_handler,         NULL},
        {"/api/bridge/unbind",       HTTP_POST, unbind_handler,       NULL},
        {"/api/bridge/calibrate",    HTTP_POST, calibrate_handler,    NULL},
        {"/api/bridge/scan",         HTTP_POST, scan_handler,         NULL},
        {"/api/bridge/stop",         HTTP_POST, stop_handler,         NULL},
        {"/api/bridge/status",       HTTP_GET,  status_handler,       NULL},
        {"/api/bridge/wifi",         HTTP_POST, wifi_handler,         NULL},
        {"/api/bridge/wifi/scan",    HTTP_GET,  wifi_scan_handler,    NULL},
        {"/api/bridge/camera/start", HTTP_POST, camera_start_handler, NULL},
        {"/api/bridge/camera/stop",  HTTP_POST, camera_stop_handler,  NULL},
    };

    for (int i = 0; i < sizeof(routes) / sizeof(routes[0]); i++) {
        httpd_register_uri_handler(server, &routes[i]);
    }

    ESP_LOGI(TAG, "HTTP server started on port %d", config.server_port);
}

void bridge_httpd_stop(void) {
    if (server) {
        httpd_stop(server);
        server = NULL;
    }
}
