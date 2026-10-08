#include "presence_csi.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "nvs.h"
#include "ping/ping_sock.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Create firmware/src/secrets.h from secrets.h.example (PRESENCE_API_URL, PRESENCE_DEVICE_KEY, PRESENCE_ZONE_NAME)"
#endif

extern const char *get_bridge_device_id(void);

static const char *TAG = "presence-csi";

#define MAX_SUB        192   /* max complex subcarriers handled per frame */
#define WINDOW_MS      1000
#define PING_INTERVAL  40    /* ms -> ~25 CSI frames/s from gateway replies */
#define MAX_PENDING    10    /* windows buffered while backend is unreachable */

/* Per-window accumulators: written from the WiFi task, read by the window task. */
static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static int    s_nsub;                 /* subcarriers in the current stream */
static float  s_prev[MAX_SUB];
static bool   s_have_prev;
static float  s_sum[MAX_SUB], s_sumsq[MAX_SUB];
static uint32_t s_n;
static double s_rssi_sum, s_rssi_sumsq;
static double s_decorr_sum;
static uint32_t s_decorr_n;
static uint32_t s_frames_total;

typedef struct {
    uint32_t n;
    float rssi_mean, rssi_std, amp_cv, decorr;
} window_t;

static window_t s_pending[MAX_PENDING];
static int s_pending_n;
static presence_stats_t s_stats;

static void csi_cb(void *ctx, wifi_csi_info_t *info) {
    if (!info || !info->buf || info->len < 8) return;
    int nsub = info->len / 2;
    if (nsub > MAX_SUB) nsub = MAX_SUB;

    /* Amplitude per subcarrier, normalised by the frame mean. Normalising
     * removes receiver AGC gain steps, which would otherwise look like motion. */
    float a[MAX_SUB];
    float mean = 0;
    int valid = 0;
    for (int k = 0; k < nsub; k++) {
        float im = (float)info->buf[2 * k], re = (float)info->buf[2 * k + 1];
        a[k] = sqrtf(re * re + im * im);
        mean += a[k];
        if (a[k] > 0) valid++;
    }
    if (valid < 8) return;
    mean /= nsub;
    if (mean < 1e-3f) return;
    for (int k = 0; k < nsub; k++) a[k] /= mean;

    taskENTER_CRITICAL(&s_mux);
    if (nsub != s_nsub) {            /* stream layout changed: restart window */
        s_nsub = nsub;
        s_have_prev = false;
        s_n = 0; s_decorr_n = 0;
        s_rssi_sum = s_rssi_sumsq = s_decorr_sum = 0;
        memset(s_sum, 0, sizeof(s_sum));
        memset(s_sumsq, 0, sizeof(s_sumsq));
    }
    for (int k = 0; k < nsub; k++) {
        s_sum[k] += a[k];
        s_sumsq[k] += a[k] * a[k];
    }
    if (s_have_prev) {
        /* Pearson correlation between this frame and the previous one. */
        float ma = 1.0f, mb = 0;     /* a is normalised to mean 1 */
        for (int k = 0; k < nsub; k++) mb += s_prev[k];
        mb /= nsub;
        float sab = 0, saa = 0, sbb = 0;
        for (int k = 0; k < nsub; k++) {
            float da = a[k] - ma, db = s_prev[k] - mb;
            sab += da * db; saa += da * da; sbb += db * db;
        }
        if (saa > 1e-9f && sbb > 1e-9f) {
            s_decorr_sum += 1.0f - sab / sqrtf(saa * sbb);
            s_decorr_n++;
        }
    }
    memcpy(s_prev, a, nsub * sizeof(float));
    s_have_prev = true;
    float r = (float)info->rx_ctrl.rssi;
    s_rssi_sum += r; s_rssi_sumsq += r * r;
    s_n++;
    s_frames_total++;
    taskEXIT_CRITICAL(&s_mux);
}

/* Take the finished window and reset accumulators. Returns false if empty. */
static bool take_window(window_t *w) {
    static float sum[MAX_SUB], sumsq[MAX_SUB];
    uint32_t n, dn;
    int nsub;
    double rs, rss, ds;

    taskENTER_CRITICAL(&s_mux);
    n = s_n; dn = s_decorr_n; nsub = s_nsub; rs = s_rssi_sum; rss = s_rssi_sumsq; ds = s_decorr_sum;
    memcpy(sum, s_sum, sizeof(float) * nsub);
    memcpy(sumsq, s_sumsq, sizeof(float) * nsub);
    s_n = 0; s_decorr_n = 0; s_rssi_sum = s_rssi_sumsq = s_decorr_sum = 0;
    memset(s_sum, 0, sizeof(float) * nsub);
    memset(s_sumsq, 0, sizeof(float) * nsub);
    s_have_prev = false;             /* don't correlate across window gaps */
    taskEXIT_CRITICAL(&s_mux);

    w->n = n;
    if (n < 2) { w->rssi_mean = w->rssi_std = w->amp_cv = w->decorr = 0; return n > 0; }

    double cv = 0; int cvn = 0;
    for (int k = 0; k < nsub; k++) {
        double m = sum[k] / n;
        double var = sumsq[k] / n - m * m;
        if (var < 0) var = 0;
        if (m > 0.05) { cv += sqrt(var) / m; cvn++; }
    }
    w->amp_cv = cvn ? (float)(cv / cvn) : 0;
    w->decorr = dn ? (float)(ds / dn) : 0;
    w->rssi_mean = (float)(rs / n);
    double rv = rss / n - (rs / n) * (rs / n);
    w->rssi_std = rv > 0 ? (float)sqrt(rv) : 0;
    return true;
}

/* CSI is only produced when frames arrive, so ping the gateway to keep them flowing. */
static void start_ping(void) {
    esp_netif_t *sta = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    esp_netif_ip_info_t ip;
    if (!sta || esp_netif_get_ip_info(sta, &ip) != ESP_OK || ip.gw.addr == 0) {
        ESP_LOGW(TAG, "No gateway yet: CSI traffic not started");
        return;
    }
    esp_ping_config_t cfg = ESP_PING_DEFAULT_CONFIG();
    ip_addr_t target = {0};
    target.type = IPADDR_TYPE_V4;
    target.u_addr.ip4.addr = ip.gw.addr;
    cfg.target_addr = target;
    cfg.count = 0;                   /* forever */
    cfg.interval_ms = PING_INTERVAL;
    cfg.timeout_ms = 500;
    cfg.data_size = 16;
    cfg.task_stack_size = 3072;
    esp_ping_callbacks_t cbs = {0};
    esp_ping_handle_t h;
    if (esp_ping_new_session(&cfg, &cbs, &h) == ESP_OK) {
        esp_ping_start(h);
        ESP_LOGI(TAG, "CSI traffic: pinging gateway every %d ms", PING_INTERVAL);
    }
}

/* ── Bridge identity (runtime-settable, persisted) ── */
#define ID_MAX 48

/* Must match the public-area names generated by the dashboard's Auto-Setup Hotel,
 * so a bridge's area lines up with the dashboard's area list. */
static const char *const AREAS[] = {
    "Floor 1 Hallway", "Floor 2 Hallway", "Floor 3 Hallway",
    "Floor 4 Hallway", "Floor 5 Hallway", "Floor 6 Hallway",
    "Front Desk / Lobby", "Outdoor Pool", "Terrace", "Guest Laundry",
    "Snack Deli", "Vending Area", "Elevator", "Stairwell",
};
int presence_area_count(void) { return sizeof(AREAS) / sizeof(AREAS[0]); }
const char *presence_area_at(int i) { return (i >= 0 && i < presence_area_count()) ? AREAS[i] : NULL; }

static char s_area[ID_MAX] = PRESENCE_ZONE_NAME;
static char s_bridge_name[ID_MAX] = "Illy Bridge";
static bool s_id_loaded;

static void id_ensure_loaded(void) {
    if (s_id_loaded) return;
    char area[ID_MAX], name[ID_MAX];
    size_t la = sizeof(area), ln = sizeof(name);
    nvs_handle_t h;
    if (nvs_open("presence", NVS_READONLY, &h) == ESP_OK) {
        bool ga = nvs_get_str(h, "area", area, &la) == ESP_OK && area[0];
        bool gn = nvs_get_str(h, "name", name, &ln) == ESP_OK && name[0];
        taskENTER_CRITICAL(&s_mux);
        if (ga) memcpy(s_area, area, sizeof(s_area));
        if (gn) memcpy(s_bridge_name, name, sizeof(s_bridge_name));
        taskEXIT_CRITICAL(&s_mux);
        nvs_close(h);
    }
    s_id_loaded = true;
}

void presence_zone_get(char *out, size_t n) {
    id_ensure_loaded();
    taskENTER_CRITICAL(&s_mux);
    strlcpy(out, s_area, n);
    taskEXIT_CRITICAL(&s_mux);
}

void presence_bridge_name_get(char *out, size_t n) {
    id_ensure_loaded();
    taskENTER_CRITICAL(&s_mux);
    strlcpy(out, s_bridge_name, n);
    taskEXIT_CRITICAL(&s_mux);
}

static bool id_save(const char *key, const char *val) {
    nvs_handle_t h;
    if (nvs_open("presence", NVS_READWRITE, &h) != ESP_OK) return false;
    esp_err_t e = nvs_set_str(h, key, val);
    if (e == ESP_OK) e = nvs_commit(h);
    nvs_close(h);
    return e == ESP_OK;
}

bool presence_area_set(const char *area) {
    if (!area) return false;
    for (int i = 0; i < presence_area_count(); i++) {
        if (strcmp(area, AREAS[i]) != 0) continue;
        if (!id_save("area", AREAS[i])) return false;
        taskENTER_CRITICAL(&s_mux);
        memset(s_area, 0, sizeof(s_area));
        strlcpy(s_area, AREAS[i], sizeof(s_area));
        taskEXIT_CRITICAL(&s_mux);
        s_id_loaded = true;
        ESP_LOGI(TAG, "Area set to '%s'", AREAS[i]);
        return true;
    }
    return false;
}

/* Keep names JSON-safe: letters, digits, space and  - _ . , ' / # ( ) only. */
bool presence_bridge_name_set(const char *name) {
    if (!name) return false;
    char clean[ID_MAX];
    int n = 0;
    for (const char *p = name; *p && n < ID_MAX - 1; p++) {
        unsigned char c = (unsigned char)*p;
        bool ok = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                  strchr(" -_.,'/#()", c);
        if (!ok) return false;
        if (c == ' ' && (n == 0 || clean[n - 1] == ' ')) continue;   /* trim / collapse */
        clean[n++] = (char)c;
    }
    while (n > 0 && clean[n - 1] == ' ') n--;
    if (n == 0) return false;
    clean[n] = 0;
    if (!id_save("name", clean)) return false;
    taskENTER_CRITICAL(&s_mux);
    memset(s_bridge_name, 0, sizeof(s_bridge_name));
    memcpy(s_bridge_name, clean, n + 1);
    taskEXIT_CRITICAL(&s_mux);
    s_id_loaded = true;
    ESP_LOGI(TAG, "Bridge name set to '%s'", clean);
    return true;
}

/* POST pending windows to the backend. */
static bool post_pending(void) {
    if (s_pending_n == 0) return true;
    static char body[1400];
    char zone[ID_MAX], bname[ID_MAX];
    presence_zone_get(zone, sizeof(zone));
    presence_bridge_name_get(bname, sizeof(bname));
    int off = snprintf(body, sizeof(body),
                       "{\"device_id\":\"%s\",\"zone\":\"%s\",\"bridge_name\":\"%s\",\"windows\":[",
                       get_bridge_device_id(), zone, bname);
    for (int i = 0; i < s_pending_n && off < (int)sizeof(body) - 160; i++) {
        const window_t *w = &s_pending[i];
        off += snprintf(body + off, sizeof(body) - off,
                        "%s{\"n\":%u,\"rssi_mean\":%.1f,\"rssi_std\":%.3f,\"amp_cv\":%.5f,\"decorr\":%.5f}",
                        i ? "," : "", (unsigned)w->n, w->rssi_mean, w->rssi_std, w->amp_cv, w->decorr);
    }
    off += snprintf(body + off, sizeof(body) - off, "]}");

    esp_http_client_config_t cfg = {
        .url = PRESENCE_API_URL,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 20000,            /* Render free tier can take ~30 s to wake */
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) return false;
    esp_http_client_set_header(c, "Content-Type", "application/json");
    esp_http_client_set_header(c, "X-Device-Key", PRESENCE_DEVICE_KEY);
    esp_http_client_set_post_field(c, body, off);
    esp_err_t err = esp_http_client_perform(c);
    int status = err == ESP_OK ? esp_http_client_get_status_code(c) : -1;
    esp_http_client_cleanup(c);
    if (status == 200) return true;
    ESP_LOGW(TAG, "POST failed: err=%s status=%d", esp_err_to_name(err), status);
    return false;
}

static void window_task(void *arg) {
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        vTaskDelayUntil(&last, pdMS_TO_TICKS(WINDOW_MS));
        window_t w;
        if (take_window(&w)) {
            if (s_pending_n == MAX_PENDING) {          /* drop oldest */
                memmove(&s_pending[0], &s_pending[1], sizeof(window_t) * (MAX_PENDING - 1));
                s_pending_n--;
            }
            s_pending[s_pending_n++] = w;
            s_stats.last_amp_cv = w.amp_cv;
            s_stats.last_decorr = w.decorr;
            s_stats.last_rssi = (int)w.rssi_mean;
        }
        s_stats.frames_total = s_frames_total;
        /* Send every ~2 s to halve request overhead; retry with backlog if the backend is down. */
        if (s_pending_n >= 2) {
            int n = s_pending_n;
            if (post_pending()) {
                s_pending_n = 0;
                s_stats.windows_sent += n;
                s_stats.backend_ok = true;
            } else {
                s_stats.post_failures++;
                s_stats.backend_ok = false;
            }
        }
        if (s_frames_total == 0) {
            ESP_LOGW(TAG, "No CSI frames yet: check WiFi link / gateway ping");
        } else if ((s_frames_total % 250) < 30) {
            ESP_LOGI(TAG, "frames=%u sent=%u fail=%u cv=%.4f decorr=%.4f rssi=%d",
                     (unsigned)s_frames_total, (unsigned)s_stats.windows_sent,
                     (unsigned)s_stats.post_failures, s_stats.last_amp_cv,
                     s_stats.last_decorr, s_stats.last_rssi);
        }
    }
}

presence_stats_t presence_csi_stats(void) { return s_stats; }

void presence_csi_start(void) {
    esp_wifi_set_ps(WIFI_PS_NONE);   /* power-save gaps would starve CSI */

    wifi_csi_config_t cfg = {
        .lltf_en = true,
        .htltf_en = true,
        .stbc_htltf2_en = true,
        .ltf_merge_en = true,
        .channel_filter_en = false,
        .manu_scale = false,
        .shift = 0,
    };
    ESP_ERROR_CHECK(esp_wifi_set_csi_config(&cfg));
    ESP_ERROR_CHECK(esp_wifi_set_csi_rx_cb(csi_cb, NULL));
    ESP_ERROR_CHECK(esp_wifi_set_csi(true));

    start_ping();
    xTaskCreatePinnedToCore(window_task, "csi_window", 8192, NULL, 4, NULL, 1);
    char zone[ID_MAX], bname[ID_MAX];
    presence_zone_get(zone, sizeof(zone));
    presence_bridge_name_get(bname, sizeof(bname));
    ESP_LOGI(TAG, "Continuous CSI presence sensing started, bridge '%s', area '%s'", bname, zone);
}
