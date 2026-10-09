#include "presence_ble.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mbedtls/sha256.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"

static const char *TAG = "presence-ble";

#define MAX_DEV         64
#define SEEN_MS         30000u            /* "nearby" = heard in the last 30 s */
#define DROP_MS         120000u           /* forget devices not heard for 2 min */
#define PERSIST_MS      (10u * 60 * 1000) /* same id continuously heard for 10 min */
#define SALT_ROTATE_MS  (24u * 3600 * 1000)
#define NEAR_RSSI       (-70)             /* roughly within a few metres */
#define TOP_N           6

typedef struct {
    uint8_t  id[3];      /* first 3 bytes of the salted hash */
    uint8_t  stable;     /* 1 = address is a fixed identity (public / static random) */
    int8_t   rssi;       /* smoothed */
    uint32_t first_ms, last_ms;
} dev_t;

static dev_t s_dev[MAX_DEV];
static int s_n;
static uint8_t s_salt[16];
static uint32_t s_salt_at;
static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool s_running;
static uint8_t s_own_addr_type;

static uint32_t now_ms(void) { return (uint32_t)(esp_timer_get_time() / 1000); }

static void note_device(const uint8_t *addr, uint8_t type, int rssi) {
    uint8_t in[16 + 6 + 1], digest[32];
    memcpy(in, s_salt, 16);
    memcpy(in + 16, addr, 6);
    in[22] = type;
    mbedtls_sha256(in, sizeof(in), digest, 0);

    /* Static random addresses have their top two bits set; resolvable/non-resolvable
     * private addresses rotate every few minutes and cannot be followed. */
    uint8_t stable = (type == BLE_ADDR_RANDOM) ? ((addr[5] & 0xC0) == 0xC0) : 1;
    uint32_t t = now_ms();
    int8_t r = rssi < -127 ? -127 : rssi > 20 ? 20 : (int8_t)rssi;

    taskENTER_CRITICAL(&s_mux);
    int idx = -1;
    for (int i = 0; i < s_n; i++) {
        if (s_dev[i].id[0] == digest[0] && s_dev[i].id[1] == digest[1] && s_dev[i].id[2] == digest[2] && s_dev[i].stable == stable) {
            idx = i;
            break;
        }
    }
    if (idx < 0) {
        if (s_n < MAX_DEV) idx = s_n++;
        else {                                   /* table full: replace the stalest entry */
            idx = 0;
            for (int i = 1; i < s_n; i++) if (s_dev[i].last_ms < s_dev[idx].last_ms) idx = i;
        }
        memcpy(s_dev[idx].id, digest, 3);
        s_dev[idx].stable = stable;
        s_dev[idx].rssi = r;
        s_dev[idx].first_ms = t;
    } else {
        s_dev[idx].rssi = (int8_t)((s_dev[idx].rssi * 3 + r) / 4);
    }
    s_dev[idx].last_ms = t;
    taskEXIT_CRITICAL(&s_mux);
}

static void start_scan(void);

static int gap_cb(struct ble_gap_event *ev, void *arg) {
    switch (ev->type) {
    case BLE_GAP_EVENT_DISC:
        note_device(ev->disc.addr.val, ev->disc.addr.type, ev->disc.rssi);
        break;
    case BLE_GAP_EVENT_DISC_COMPLETE:
        start_scan();
        break;
    default:
        break;
    }
    return 0;
}

static void start_scan(void) {
    struct ble_gap_disc_params p = {0};
    p.itvl = 160;            /* 100 ms interval ...                              */
    p.window = 80;           /* ... 50 ms window: leaves air time for WiFi CSI   */
    p.passive = 1;
    p.filter_duplicates = 0; /* we want repeated RSSI samples                    */
    int rc = ble_gap_disc(s_own_addr_type, BLE_HS_FOREVER, &p, gap_cb, NULL);
    if (rc != 0) ESP_LOGW(TAG, "ble_gap_disc failed: %d", rc);
}

static void on_sync(void) {
    ble_hs_util_ensure_addr(0);
    if (ble_hs_id_infer_auto(0, &s_own_addr_type) != 0) s_own_addr_type = BLE_OWN_ADDR_PUBLIC;
    start_scan();
    s_running = true;
    ESP_LOGI(TAG, "BLE observer running (anonymised)");
}

static void on_reset(int reason) { s_running = false; ESP_LOGW(TAG, "BLE reset, reason %d", reason); }

static void host_task(void *param) {
    nimble_port_run();
    nimble_port_freertos_deinit();
}

void presence_ble_start(void) {
    esp_fill_random(s_salt, sizeof(s_salt));
    s_salt_at = now_ms();
    esp_err_t e = nimble_port_init();
    if (e != ESP_OK) {
        ESP_LOGE(TAG, "nimble_port_init failed: %s", esp_err_to_name(e));
        return;
    }
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.reset_cb = on_reset;
    nimble_port_freertos_init(host_task);
}

int presence_ble_json(char *out, size_t n) {
    if (!s_running) return 0;
    uint32_t t = now_ms();

    static dev_t snap[MAX_DEV];
    int cnt;
    taskENTER_CRITICAL(&s_mux);
    if (t - s_salt_at > SALT_ROTATE_MS) {        /* new day: old ids can no longer be matched */
        esp_fill_random(s_salt, sizeof(s_salt));
        s_salt_at = t;
        s_n = 0;
    }
    int w = 0;                                   /* drop devices not heard for a while */
    for (int i = 0; i < s_n; i++) if (t - s_dev[i].last_ms <= DROP_MS) s_dev[w++] = s_dev[i];
    s_n = w;
    cnt = s_n;
    memcpy(snap, s_dev, sizeof(dev_t) * cnt);
    taskEXIT_CRITICAL(&s_mux);

    int seen = 0, near_n = 0, persistent = 0, stable = 0;
    int top[TOP_N], ntop = 0;
    for (int i = 0; i < cnt; i++) {
        if (t - snap[i].last_ms > SEEN_MS) continue;
        seen++;
        if (snap[i].rssi >= NEAR_RSSI) near_n++;
        if (snap[i].stable) stable++;
        if (t - snap[i].first_ms >= PERSIST_MS) persistent++;
        /* keep the strongest TOP_N, strongest first */
        int pos = ntop;
        if (ntop < TOP_N) ntop++;
        else if (snap[top[TOP_N - 1]].rssi >= snap[i].rssi) continue;
        else pos = TOP_N - 1;
        while (pos > 0 && snap[top[pos - 1]].rssi < snap[i].rssi) { top[pos] = top[pos - 1]; pos--; }
        top[pos] = i;
    }

    int off = snprintf(out, n, "{\"count\":%d,\"near\":%d,\"persistent\":%d,\"stable\":%d,\"devices\":[",
                       seen, near_n, persistent, stable);
    for (int k = 0; k < ntop && off < (int)n - 80; k++) {
        const dev_t *d = &snap[top[k]];
        off += snprintf(out + off, n - off, "%s{\"id\":\"%02x%02x%02x\",\"rssi\":%d,\"t\":%d,\"p\":%d,\"age\":%u}",
                        k ? "," : "", d->id[0], d->id[1], d->id[2], d->rssi, d->stable ? 0 : 1,
                        (t - d->first_ms >= PERSIST_MS) ? 1 : 0, (unsigned)((t - d->last_ms) / 1000));
    }
    off += snprintf(out + off, n - off, "]}");
    return off;
}
