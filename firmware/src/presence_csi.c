#include "presence_csi.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "presence_ble.h"
#include "esp_wifi.h"
#include "nvs.h"
#include "cJSON.h"
#include "freertos/semphr.h"
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

/* ── Breathing-rate estimate ──
 * People who stay still modulate the channel at their breathing rate (0.1-0.5 Hz).
 * CSI amplitude is averaged over 8 groups of subcarriers into 5 Hz bins (30 s ring),
 * and a spectrum over 6-30 breaths/min is compared with the background spectrum.
 * It only reports a rate when the peak clearly stands out (snr), which in practice means
 * one person staying roughly still near the link; walking or several people smear it. */
#define BR_GROUPS   8
#define BR_BIN_US   200000      /* 5 Hz */
#define BR_LEN      150         /* 30 s */
#define BR_MIN      100         /* need >= 20 s of samples */
#define BR_FS       5.0f
#define BR_NB       41          /* 0.10 .. 0.50 Hz, step 0.01 */
#define BR_NN       29          /* background: 0.60 .. 2.00 Hz, step 0.05 */
#define BR_MIN_SNR  3.5f

static float s_br[BR_GROUPS][BR_LEN];
static int s_br_head, s_br_n;
static float s_bin_sum[BR_GROUPS];
static int s_bin_cnt;
static int64_t s_bin_t0;

typedef struct { float bpm, snr; bool valid, fresh; } breath_t;
static breath_t s_breath;

/* Separate breathing signatures: spectral peaks that stand out and are well apart. A 30 s
 * Hann window resolves rates about 6 breaths/min apart, so two people breathing at clearly
 * different rates (or a person and a pet) show as two peaks; similar rates merge into one. */
#define BR_MAXPEAKS  3
#define BR_PEAK_SEP  6          /* bins (0.06 Hz = 3.6 breaths/min) */
typedef struct { float bpm, snr; } peak_t;
static peak_t s_peaks[BR_MAXPEAKS];
static int s_npeaks;

static void breath_reset_locked(void) {
    s_br_head = s_br_n = 0;
    s_bin_cnt = 0;
    s_bin_t0 = 0;
    memset(s_bin_sum, 0, sizeof(s_bin_sum));
}

/* Called from csi_cb inside the critical section. */
static void breath_feed_locked(const float *a, int nsub) {
    for (int g = 0; g < BR_GROUPS; g++) {
        int k0 = g * nsub / BR_GROUPS, k1 = (g + 1) * nsub / BR_GROUPS;
        float gs = 0;
        for (int k = k0; k < k1; k++) gs += a[k];
        s_bin_sum[g] += k1 > k0 ? gs / (k1 - k0) : 1.0f;
    }
    s_bin_cnt++;
    int64_t t = esp_timer_get_time();
    if (s_bin_t0 == 0) s_bin_t0 = t;
    if (t - s_bin_t0 > 4 * BR_BIN_US) {          /* frames stopped for a while: timing is broken */
        breath_reset_locked();
        return;
    }
    if (t - s_bin_t0 >= BR_BIN_US) {
        for (int g = 0; g < BR_GROUPS; g++) {
            s_br[g][s_br_head] = s_bin_sum[g] / s_bin_cnt;
            s_bin_sum[g] = 0;
        }
        s_br_head = (s_br_head + 1) % BR_LEN;
        if (s_br_n < BR_LEN) s_br_n++;
        s_bin_cnt = 0;
        s_bin_t0 = t;
    }
}

static float goertzel_power(const float *x, int n, float f) {
    float coeff = 2.0f * cosf(2.0f * (float)M_PI * f / BR_FS);
    float s1 = 0, s2 = 0;
    for (int i = 0; i < n; i++) {
        float s0 = x[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

static void breathing_analyse(void) {
    static float buf[BR_GROUPS][BR_LEN];
    static float x[BR_LEN];
    static float P[BR_NB + BR_NN];
    int n;

    taskENTER_CRITICAL(&s_mux);
    n = s_br_n;
    for (int g = 0; g < BR_GROUPS; g++)
        for (int i = 0; i < n; i++) buf[g][i] = s_br[g][(s_br_head - n + i + BR_LEN) % BR_LEN];
    taskEXIT_CRITICAL(&s_mux);

    s_breath.valid = false;
    if (n < BR_MIN) return;

    memset(P, 0, sizeof(P));
    for (int g = 0; g < BR_GROUPS; g++) {
        /* remove mean and linear drift (AGC / thermal), then window */
        float sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (int i = 0; i < n; i++) { sx += i; sy += buf[g][i]; sxx += (float)i * i; sxy += i * buf[g][i]; }
        float den = n * sxx - sx * sx;
        float slope = den > 1e-9f ? (n * sxy - sx * sy) / den : 0;
        float icpt = (sy - slope * sx) / n;
        for (int i = 0; i < n; i++) {
            float w = 0.5f - 0.5f * cosf(2.0f * (float)M_PI * i / (n - 1));
            x[i] = (buf[g][i] - (icpt + slope * i)) * w;
        }
        for (int j = 0; j < BR_NB; j++) P[j] += goertzel_power(x, n, 0.10f + 0.01f * j);
        for (int j = 0; j < BR_NN; j++) P[BR_NB + j] += goertzel_power(x, n, 0.60f + 0.05f * j);
    }

    /* strongest bin away from the band edges */
    int pk = 2;
    for (int j = 2; j < BR_NB - 2; j++) if (P[j] > P[pk]) pk = j;

    /* median of the whole spectrum as the background level */
    static float sorted[BR_NB + BR_NN];
    memcpy(sorted, P, sizeof(P));
    for (int i = 1; i < BR_NB + BR_NN; i++) {
        float v = sorted[i];
        int j = i - 1;
        while (j >= 0 && sorted[j] > v) { sorted[j + 1] = sorted[j]; j--; }
        sorted[j + 1] = v;
    }
    float med = sorted[(BR_NB + BR_NN) / 2];
    float snr = med > 1e-12f ? P[pk] / med : 0;

    /* parabolic interpolation for a sub-bin frequency */
    float d = P[pk - 1] - 2 * P[pk] + P[pk + 1];
    float off = fabsf(d) > 1e-12f ? 0.5f * (P[pk - 1] - P[pk + 1]) / d : 0;
    float f = 0.10f + 0.01f * (pk + off);

    s_npeaks = 0;
    if (med > 1e-12f) {
        int cand[BR_NB], nc = 0;
        for (int j = 2; j < BR_NB - 2; j++)
            if (P[j] >= P[j - 1] && P[j] > P[j + 1] && P[j] / med >= BR_MIN_SNR) cand[nc++] = j;
        for (int pass = 0; pass < BR_MAXPEAKS; pass++) {
            int best = -1;
            for (int c = 0; c < nc; c++)
                if (cand[c] >= 0 && (best < 0 || P[cand[c]] > P[cand[best]])) best = c;
            if (best < 0) break;
            int j = cand[best];
            float dd = P[j - 1] - 2 * P[j] + P[j + 1];
            float of = fabsf(dd) > 1e-12f ? 0.5f * (P[j - 1] - P[j + 1]) / dd : 0;
            s_peaks[s_npeaks].bpm = (0.10f + 0.01f * (j + of)) * 60.0f;
            s_peaks[s_npeaks].snr = P[j] / med;
            s_npeaks++;
            for (int c = 0; c < nc; c++) if (cand[c] >= 0 && abs(cand[c] - j) < BR_PEAK_SEP) cand[c] = -1;
        }
    }

    s_breath.snr = snr;
    s_breath.bpm = f * 60.0f;
    s_breath.valid = snr >= BR_MIN_SNR;
    s_breath.fresh = true;
}


/* ── Wide sweep (macro mode): CSI from the traffic on every 2.4 GHz channel ──
 * The radio is normally parked on the AP's channel. A sweep pass puts it in promiscuous mode, hops
 * across the channels, and on each one keeps the CSI of the busiest transmitter (frames from one
 * transmitter see one multipath channel, so their variation is motion rather than a change of
 * transmitter). Only physical-layer amplitude features survive the dwell: addresses live in the
 * slot table in RAM and are overwritten by the next channel. */
#define SWEEP_CH_FIRST   1
#define SWEEP_CH_LAST    13
#define SWEEP_DWELL_MS   300
#define SWEEP_PERIOD_S   60       /* a sweep costs a few seconds off the AP, so not too often */
#define SWEEP_MIN_FRAMES 8
#define SWEEP_SLOTS      6
#define SWEEP_MAXSUB     128

typedef struct {
    uint8_t  mac[6];
    int      nsub;
    uint16_t n, dn;
    double   rssi_sum, decorr_sum;
    float    sum[SWEEP_MAXSUB], sumsq[SWEEP_MAXSUB], prev[SWEEP_MAXSUB];
    bool     have_prev;
} sweep_slot_t;

typedef struct { uint8_t ch; uint16_t n, all; int8_t rssi; float amp_cv, decorr; } sweep_ch_t;

static volatile bool s_sweep_on;
static volatile bool s_sweep_hold;
bool presence_sweep_holds_link(void) { return s_sweep_hold; }
static sweep_slot_t s_slot[SWEEP_SLOTS];
static int s_slot_n;
static uint32_t s_sweep_all;                 /* every frame heard on the current channel */
static sweep_ch_t s_sweep[SWEEP_CH_LAST];
static int s_sweep_n;
static bool s_sweep_fresh;
static int64_t s_next_sweep_us;
#define MACRO_FIRST_SWEEP_US  (3 * 1000000LL)

/* Called from csi_cb with the normalised amplitudes while a sweep is running. */
static void sweep_feed(const wifi_csi_info_t *info, const float *a, int nsub) {
    if (nsub > SWEEP_MAXSUB) nsub = SWEEP_MAXSUB;
    taskENTER_CRITICAL(&s_mux);
    s_sweep_all++;
    sweep_slot_t *sl = NULL;
    for (int i = 0; i < s_slot_n; i++)
        if (s_slot[i].nsub == nsub && memcmp(s_slot[i].mac, info->mac, 6) == 0) { sl = &s_slot[i]; break; }
    if (!sl && s_slot_n < SWEEP_SLOTS) {
        sl = &s_slot[s_slot_n++];
        memset(sl, 0, sizeof(*sl));
        memcpy(sl->mac, info->mac, 6);
        sl->nsub = nsub;
    }
    if (sl) {
        for (int k = 0; k < nsub; k++) { sl->sum[k] += a[k]; sl->sumsq[k] += a[k] * a[k]; }
        if (sl->have_prev) {
            float mb = 0;
            for (int k = 0; k < nsub; k++) mb += sl->prev[k];
            mb /= nsub;
            float sab = 0, saa = 0, sbb = 0;
            for (int k = 0; k < nsub; k++) {
                float da = a[k] - 1.0f, db = sl->prev[k] - mb;
                sab += da * db; saa += da * da; sbb += db * db;
            }
            if (saa > 1e-9f && sbb > 1e-9f) { sl->decorr_sum += 1.0f - sab / sqrtf(saa * sbb); sl->dn++; }
        }
        memcpy(sl->prev, a, nsub * sizeof(float));
        sl->have_prev = true;
        sl->rssi_sum += info->rx_ctrl.rssi;
        sl->n++;
    }
    taskEXIT_CRITICAL(&s_mux);
}

static volatile uint32_t s_dbg_prom, s_dbg_cb;   /* DIAG: packets heard / CSI callbacks per dwell */
static void sweep_noop_rx(void *buf, wifi_promiscuous_pkt_type_t type) { (void)buf; (void)type; s_dbg_prom++; }

static void csi_cb(void *ctx, wifi_csi_info_t *info) {
    if (s_sweep_on) s_dbg_cb++;
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

    if (s_sweep_on) { sweep_feed(info, a, nsub); return; }   /* wide sweep: not the home-channel window */

    taskENTER_CRITICAL(&s_mux);
    if (nsub != s_nsub) {            /* stream layout changed: restart window */
        s_nsub = nsub;
        s_have_prev = false;
        s_n = 0; s_decorr_n = 0;
        s_rssi_sum = s_rssi_sumsq = s_decorr_sum = 0;
        memset(s_sum, 0, sizeof(s_sum));
        memset(s_sumsq, 0, sizeof(s_sumsq));
        breath_reset_locked();
    }
    breath_feed_locked(a, nsub);
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
static esp_ping_handle_t s_ping;
static bool s_ping_running;

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
    if (esp_ping_new_session(&cfg, &cbs, &s_ping) == ESP_OK) {
        esp_ping_start(s_ping);
        s_ping_running = true;
        ESP_LOGI(TAG, "CSI traffic: pinging gateway every %d ms", PING_INTERVAL);
    }
}

/* ── Sensing strategy: time-division of the single radio between micro (CSI) and macro (census) ── */
typedef enum { STRAT_MICRO = 0, STRAT_MACRO, STRAT_AUTO, STRAT_SMART, STRAT_COUNT } strategy_t;
typedef enum { MODE_MICRO = 0, MODE_MACRO } sense_mode_t;
static const char *const STRAT_NAME[STRAT_COUNT] = {"micro", "macro", "auto", "smart"};

#define AUTO_MICRO_S        45     /* auto-sweep: seconds of CSI ... */
#define AUTO_MACRO_S        15     /* ... then seconds of census      */
#define SMART_TRIGGER       3      /* this many phones close by => crowd, go micro (2 checks in a row) */
#define SMART_BUSY_AT       2      /* at or above this the space still counts as busy */
#define SMART_MIN_MICRO_S   60     /* stay micro at least this long, so a flicker cannot thrash the radio */
#define SMART_HOLD_S        90     /* ...and until it has been quiet this long */
#define MACRO_POST_TICKS    5      /* macro mode uploads its census every ~5 s */

#ifndef PRESENCE_DEFAULT_STRATEGY
#define PRESENCE_DEFAULT_STRATEGY STRAT_MICRO
#endif
static volatile strategy_t s_strategy = PRESENCE_DEFAULT_STRATEGY;
static volatile sense_mode_t s_mode = MODE_MICRO;
static int64_t s_mode_since_us;
static bool s_mode_applied;          /* radio has been put into s_mode at least once */
static int s_smart_hits;
static int64_t s_smart_busy_us;

/* Reduce the busiest transmitter of the dwell that just ended to one channel record. */
static void sweep_collect(int ch) {
    static sweep_slot_t best;                /* copy: the CSI callback keeps writing until the next channel */
    int bi = -1;
    uint32_t all;
    taskENTER_CRITICAL(&s_mux);
    all = s_sweep_all;
    for (int i = 0; i < s_slot_n; i++) if (bi < 0 || s_slot[i].n > s_slot[bi].n) bi = i;
    if (bi >= 0) memcpy(&best, &s_slot[bi], sizeof(best));
    taskEXIT_CRITICAL(&s_mux);
    if (bi < 0 || best.n < SWEEP_MIN_FRAMES) {
        if (all > 0 && s_sweep_n < SWEEP_CH_LAST)       /* busy but not enough CSI from one link */
            s_sweep[s_sweep_n++] = (sweep_ch_t){ .ch = (uint8_t)ch, .n = best.n, .all = (uint16_t)all };
        return;
    }
    double cv = 0; int cvn = 0;
    for (int k = 0; k < best.nsub; k++) {
        double m = best.sum[k] / best.n;
        double var = best.sumsq[k] / best.n - m * m;
        if (var < 0) var = 0;
        if (m > 0.05) { cv += sqrt(var) / m; cvn++; }
    }
    if (s_sweep_n < SWEEP_CH_LAST)
        s_sweep[s_sweep_n++] = (sweep_ch_t){
            .ch = (uint8_t)ch, .n = best.n, .all = (uint16_t)all,
            .rssi = (int8_t)(best.rssi_sum / best.n),
            .amp_cv = cvn ? (float)(cv / cvn) : 0,
            .decorr = best.dn ? (float)(best.decorr_sum / best.dn) : 0,
        };
}

/* One pass over the channels. Blocks ~SWEEP_DWELL_MS x 13. Must not overlap an upload. */
static void sweep_pass(void) {
    uint8_t home = 0;
    wifi_second_chan_t sec = WIFI_SECOND_CHAN_NONE;
    if (esp_wifi_get_channel(&home, &sec) != ESP_OK || home == 0) return;

    /* The driver refuses to change channel while associated, so leave the AP for the sweep. */
    s_sweep_hold = true;
    presence_ble_pause(true);                /* BLE and WiFi share the radio: sweep alone */
    esp_wifi_set_ps(WIFI_PS_NONE);           /* a dozing receiver hears nothing while hopping */
    esp_wifi_disconnect();
    vTaskDelay(pdMS_TO_TICKS(250));

    wifi_promiscuous_filter_t f = { .filter_mask = WIFI_PROMIS_FILTER_MASK_MGMT | WIFI_PROMIS_FILTER_MASK_DATA };
    esp_wifi_set_promiscuous_filter(&f);
    esp_wifi_set_promiscuous_rx_cb(sweep_noop_rx);
    if (esp_wifi_set_promiscuous(true) != ESP_OK) { s_sweep_hold = false; presence_ble_pause(false); esp_wifi_connect(); return; }
    esp_wifi_set_csi(true);
    s_sweep_n = 0;
    s_sweep_on = true;
    int set_fail = 0;
    for (int ch = SWEEP_CH_FIRST; ch <= SWEEP_CH_LAST; ch++) {
        taskENTER_CRITICAL(&s_mux);
        s_slot_n = 0;
        s_sweep_all = 0;
        taskEXIT_CRITICAL(&s_mux);
        if (esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE) != ESP_OK) { set_fail++; continue; }
        esp_wifi_set_csi(false);                  /* CSI stops following the radio across a channel change: re-arm it */
        esp_wifi_set_csi(true);
        s_dbg_prom = 0; s_dbg_cb = 0;
        vTaskDelay(pdMS_TO_TICKS(SWEEP_DWELL_MS));
        ESP_LOGD(TAG, "sweep ch%d: promisc pkts=%u csi cb=%u", ch, (unsigned)s_dbg_prom, (unsigned)s_dbg_cb);
        sweep_collect(ch);
    }
    s_sweep_on = false;
    esp_wifi_set_csi(s_mode == MODE_MICRO);
    esp_wifi_set_promiscuous(false);
    esp_wifi_set_channel(home, sec);
    s_sweep_hold = false;
    presence_ble_pause(false);
    if (s_mode == MODE_MACRO) esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
    esp_wifi_connect();                      /* rejoin the AP; the normal handler takes over if that fails */
    s_sweep_fresh = s_sweep_n > 0;
    s_stats.sweeps_done++;
    int with_csi = 0;
    for (int i = 0; i < s_sweep_n; i++) if (s_sweep[i].n >= SWEEP_MIN_FRAMES) with_csi++;
    s_stats.sweep_channels = (uint8_t)with_csi;
    ESP_LOGI(TAG, "Wide sweep done: %d/%d channels with CSI (%d busy), %d set_channel failures, back on ch %d",
             with_csi, SWEEP_CH_LAST - SWEEP_CH_FIRST + 1, s_sweep_n, set_fail, home);
}

static void apply_mode(sense_mode_t m) {
    if (s_mode_applied && m == s_mode) return;
    if (m == MODE_MICRO) {
        esp_wifi_set_ps(WIFI_PS_NONE);               /* power-save gaps would starve CSI */
        esp_wifi_set_csi(true);
        if (s_ping && !s_ping_running) { esp_ping_start(s_ping); s_ping_running = true; }
        presence_ble_set_wide(false);                /* share air time with CSI */
    } else {
        if (s_ping && s_ping_running) { esp_ping_stop(s_ping); s_ping_running = false; }
        esp_wifi_set_csi(false);
        esp_wifi_set_ps(WIFI_PS_MIN_MODEM);          /* idle radio: wake only for beacons */
        presence_ble_set_wide(true);                 /* ...and spend the air time listening */
        taskENTER_CRITICAL(&s_mux);
        breath_reset_locked();
        s_n = 0; s_decorr_n = 0; s_have_prev = false;
        s_rssi_sum = s_rssi_sumsq = s_decorr_sum = 0;
        taskEXIT_CRITICAL(&s_mux);
    }
    s_mode = m;
    s_mode_applied = true;
    s_mode_since_us = esp_timer_get_time();
    if (m == MODE_MACRO) s_next_sweep_us = s_mode_since_us + MACRO_FIRST_SWEEP_US;
    ESP_LOGI(TAG, "Sensing mode -> %s (strategy %s)", m == MODE_MICRO ? "micro" : "macro", STRAT_NAME[s_strategy]);
}

/* Called once a second from the window task. */
static void strategy_tick(void) {
    int64_t now = esp_timer_get_time();
    int64_t in_mode_s = (now - s_mode_since_us) / 1000000;
    sense_mode_t want = s_mode;
    switch (s_strategy) {
    case STRAT_MICRO: want = MODE_MICRO; break;
    case STRAT_MACRO: want = MODE_MACRO; break;
    case STRAT_AUTO:
        if (s_mode == MODE_MICRO && in_mode_s >= AUTO_MICRO_S) want = MODE_MACRO;
        else if (s_mode == MODE_MACRO && in_mode_s >= AUTO_MACRO_S) want = MODE_MICRO;
        break;
    case STRAT_SMART: {
        int crowd = presence_ble_crowd();
        if (crowd < 0) { want = MODE_MICRO; break; }          /* no census available: keep sensing */
        if (s_mode == MODE_MACRO) {
            s_smart_hits = crowd >= SMART_TRIGGER ? s_smart_hits + 1 : 0;
            if (s_smart_hits >= 2) { want = MODE_MICRO; s_smart_busy_us = now; }
        } else {
            if (crowd >= SMART_BUSY_AT) s_smart_busy_us = now;
            if (in_mode_s >= SMART_MIN_MICRO_S && (now - s_smart_busy_us) / 1000000 >= SMART_HOLD_S) want = MODE_MACRO;
        }
        break;
    }
    default: break;
    }
    if (want != s_mode) { s_smart_hits = 0; apply_mode(want); }
}

const char *presence_strategy_get(void) { return STRAT_NAME[s_strategy]; }
const char *presence_mode_get(void) { return s_mode == MODE_MICRO ? "micro" : "macro"; }

bool presence_strategy_set(const char *name) {
    if (!name) return false;
    for (int i = 0; i < STRAT_COUNT; i++) {
        if (strcmp(name, STRAT_NAME[i]) != 0) continue;
        nvs_handle_t h;
        if (nvs_open("presence", NVS_READWRITE, &h) == ESP_OK) {
            nvs_set_str(h, "strategy", name);
            nvs_commit(h);
            nvs_close(h);
        }
        s_smart_hits = 0;
        s_smart_busy_us = esp_timer_get_time();
        s_strategy = (strategy_t)i;
        ESP_LOGI(TAG, "Sensing strategy set to '%s'", name);
        return true;                                /* the next tick moves the radio */
    }
    return false;
}

static void strategy_load(void) {
    char v[8];
    size_t l = sizeof(v);
    nvs_handle_t h;
    if (nvs_open("presence", NVS_READONLY, &h) != ESP_OK) return;
    if (nvs_get_str(h, "strategy", v, &l) == ESP_OK)
        for (int i = 0; i < STRAT_COUNT; i++) if (strcmp(v, STRAT_NAME[i]) == 0) s_strategy = (strategy_t)i;
    nvs_close(h);
}

/* ── Bridge identity (runtime-settable, persisted) ── */
#define ID_MAX 48

#define MAX_AREAS 24
static char s_areas[MAX_AREAS][ID_MAX];   /* facility's public areas (from the backend) */
static int s_area_n;

int presence_area_count(void) { return s_area_n; }

bool presence_area_at(int i, char *out, size_t n) {
    bool ok = false;
    taskENTER_CRITICAL(&s_mux);
    if (i >= 0 && i < s_area_n) { strlcpy(out, s_areas[i], n); ok = true; }
    taskEXIT_CRITICAL(&s_mux);
    return ok;
}

static bool area_listed(const char *area) {
    bool found = false;
    taskENTER_CRITICAL(&s_mux);
    for (int i = 0; i < s_area_n && !found; i++) found = strcmp(area, s_areas[i]) == 0;
    taskEXIT_CRITICAL(&s_mux);
    return found;
}

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

        /* Cached area list: names joined with '\n'. */
        size_t lj = 0;
        if (nvs_get_str(h, "areas", NULL, &lj) == ESP_OK && lj > 1 && lj < MAX_AREAS * ID_MAX) {
            char *joined = malloc(lj);
            if (joined && nvs_get_str(h, "areas", joined, &lj) == ESP_OK) {
                int n = 0;
                char tmp[MAX_AREAS][ID_MAX];
                for (char *tok = strtok(joined, "\n"); tok && n < MAX_AREAS; tok = strtok(NULL, "\n"))
                    if (*tok && strlen(tok) < ID_MAX) strlcpy(tmp[n++], tok, ID_MAX);
                taskENTER_CRITICAL(&s_mux);
                memcpy(s_areas, tmp, sizeof(tmp));
                s_area_n = n;
                taskEXIT_CRITICAL(&s_mux);
            }
            free(joined);
        }
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
    if (!area || !area_listed(area)) return false;
    if (!id_save("area", area)) return false;
    taskENTER_CRITICAL(&s_mux);
    memset(s_area, 0, sizeof(s_area));
    strlcpy(s_area, area, sizeof(s_area));
    taskEXIT_CRITICAL(&s_mux);
    s_id_loaded = true;
    ESP_LOGI(TAG, "Area set to '%s'", area);
    return true;
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

/* ── Facility area list: fetched from the backend, cached in NVS ── */
static SemaphoreHandle_t s_net_lock;      /* one TLS session at a time (RAM) */
static SemaphoreHandle_t s_sync_done;
static TaskHandle_t s_areas_task;
static char s_abuf[2048];
static int s_alen;

static esp_err_t resp_evt(esp_http_client_event_t *e) {
    if (e->event_id == HTTP_EVENT_ON_DATA && e->data_len > 0 && s_alen + e->data_len < (int)sizeof(s_abuf) - 1) {
        memcpy(s_abuf + s_alen, e->data, e->data_len);
        s_alen += e->data_len;
        s_abuf[s_alen] = 0;
    }
    return ESP_OK;
}

static bool areas_name_ok(const char *a) {
    size_t n = strlen(a);
    if (n == 0 || n >= ID_MAX) return false;
    for (; *a; a++) {
        unsigned char c = (unsigned char)*a;
        if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || strchr(" -_.,'/#()", c)))
            return false;
    }
    return true;
}

/* An area sent by the dashboard through the authenticated config reply was already
 * validated by the backend, so the bridge adopts it even if its cached list is
 * stale or empty (for example after the backend restarted), and remembers it. */
static bool area_adopt_from_server(const char *area) {
    if (!areas_name_ok(area)) return false;
    if (!area_listed(area)) {
        bool added = false;
        taskENTER_CRITICAL(&s_mux);
        if (s_area_n < MAX_AREAS) { strlcpy(s_areas[s_area_n++], area, ID_MAX); added = true; }
        taskEXIT_CRITICAL(&s_mux);
        if (!added) return false;
    }
    return presence_area_set(area);
}

static bool areas_fetch(void) {
    char url[160];
    strlcpy(url, PRESENCE_API_URL, sizeof(url));
    char *p = strstr(url, "/ingest");
    if (!p) return false;
    strcpy(p, "/areas");

    esp_http_client_config_t cfg = {
        .url = url,
        .event_handler = resp_evt,
        .timeout_ms = 20000,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    xSemaphoreTake(s_net_lock, portMAX_DELAY);
    s_alen = 0;
    s_abuf[0] = 0;
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) { xSemaphoreGive(s_net_lock); return false; }
    esp_http_client_set_header(c, "X-Device-Key", PRESENCE_DEVICE_KEY);
    esp_err_t err = esp_http_client_perform(c);
    int status = err == ESP_OK ? esp_http_client_get_status_code(c) : -1;
    esp_http_client_cleanup(c);
    cJSON *root = status == 200 ? cJSON_Parse(s_abuf) : NULL;
    xSemaphoreGive(s_net_lock);
    if (status != 200) { ESP_LOGW(TAG, "areas fetch failed: err=%s status=%d", esp_err_to_name(err), status); return false; }

    cJSON *arr = root ? cJSON_GetObjectItem(root, "areas") : NULL;
    if (!cJSON_IsArray(arr)) { cJSON_Delete(root); return false; }

    static char tmp[MAX_AREAS][ID_MAX];
    int n = 0;
    cJSON *it;
    cJSON_ArrayForEach(it, arr) {
        if (n < MAX_AREAS && cJSON_IsString(it) && areas_name_ok(it->valuestring))
            strlcpy(tmp[n++], it->valuestring, ID_MAX);
    }
    cJSON_Delete(root);

    taskENTER_CRITICAL(&s_mux);
    memcpy(s_areas, tmp, sizeof(tmp));
    s_area_n = n;
    taskEXIT_CRITICAL(&s_mux);

    /* Cache for offline use. */
    static char joined[MAX_AREAS * ID_MAX];
    joined[0] = 0;
    for (int i = 0; i < n; i++) {
        strlcat(joined, tmp[i], sizeof(joined));
        if (i < n - 1) strlcat(joined, "\n", sizeof(joined));
    }
    nvs_handle_t h;
    if (nvs_open("presence", NVS_READWRITE, &h) == ESP_OK) {
        nvs_set_str(h, "areas", joined);
        nvs_commit(h);
        nvs_close(h);
    }
    ESP_LOGI(TAG, "Facility areas synced: %d", n);
    return true;
}

static void areas_task(void *arg) {
    for (;;) {
        areas_fetch();
        xSemaphoreGive(s_sync_done);
        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(5 * 60 * 1000));
    }
}

bool presence_areas_refresh(int timeout_ms) {
    if (!s_areas_task) return false;
    xSemaphoreTake(s_sync_done, 0);
    xTaskNotifyGive(s_areas_task);
    return xSemaphoreTake(s_sync_done, pdMS_TO_TICKS(timeout_ms)) == pdTRUE;
}

/* POST pending windows to the backend. */
static bool post_pending(void) {
    if (s_pending_n == 0 && s_mode != MODE_MACRO) return true;   /* macro uploads its census with no windows */
    static char body[3400];
    static char extra[1700];
    char zone[ID_MAX], bname[ID_MAX], ip[16] = "";
    presence_zone_get(zone, sizeof(zone));
    presence_bridge_name_get(bname, sizeof(bname));
    esp_netif_ip_info_t ipi;
    esp_netif_t *sta = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    if (sta && esp_netif_get_ip_info(sta, &ipi) == ESP_OK) snprintf(ip, sizeof(ip), IPSTR, IP2STR(&ipi.ip));
    /* Optional extras: a new breathing reading (once per analysis) and the BLE summary. */
    int xo = 0;
    extra[0] = 0;
    if (s_breath.fresh) {
        xo += snprintf(extra + xo, sizeof(extra) - xo, "\"breathing\":{\"bpm\":%.1f,\"snr\":%.1f,\"ok\":%d,\"peaks\":[",
                       s_breath.valid ? s_breath.bpm : 0.0f, s_breath.snr, s_breath.valid ? 1 : 0);
        for (int i = 0; i < s_npeaks; i++)
            xo += snprintf(extra + xo, sizeof(extra) - xo, "%s{\"bpm\":%.1f,\"snr\":%.1f}", i ? "," : "", s_peaks[i].bpm, s_peaks[i].snr);
        xo += snprintf(extra + xo, sizeof(extra) - xo, "]},");
        s_breath.fresh = false;
    }
    if (s_sweep_fresh) {
        xo += snprintf(extra + xo, sizeof(extra) - xo, "\"sweep\":[");
        for (int i = 0; i < s_sweep_n && xo < (int)sizeof(extra) - 140; i++)
            xo += snprintf(extra + xo, sizeof(extra) - xo,
                           "%s{\"ch\":%u,\"n\":%u,\"all\":%u,\"rssi\":%d,\"amp_cv\":%.4f,\"decorr\":%.4f}",
                           i ? "," : "", s_sweep[i].ch, s_sweep[i].n, s_sweep[i].all, s_sweep[i].rssi,
                           s_sweep[i].amp_cv, s_sweep[i].decorr);
        xo += snprintf(extra + xo, sizeof(extra) - xo, "],");
        s_sweep_fresh = false;
    }
    char ble[700];
    if (presence_ble_json(ble, sizeof(ble)) > 0) xo += snprintf(extra + xo, sizeof(extra) - xo, "\"ble\":%s,", ble);
    int off = snprintf(body, sizeof(body),
                       "{\"device_id\":\"%s\",\"zone\":\"%s\",\"bridge_name\":\"%s\",\"ip\":\"%s\",\"uptime_s\":%u,"
                       "\"strategy\":\"%s\",\"mode\":\"%s\",%s\"windows\":[",
                       get_bridge_device_id(), zone, bname, ip, (unsigned)(esp_timer_get_time() / 1000000),
                       presence_strategy_get(), presence_mode_get(), extra);
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
        .event_handler = resp_evt,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    xSemaphoreTake(s_net_lock, portMAX_DELAY);
    s_alen = 0;
    s_abuf[0] = 0;
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) { xSemaphoreGive(s_net_lock); return false; }
    esp_http_client_set_header(c, "Content-Type", "application/json");
    esp_http_client_set_header(c, "X-Device-Key", PRESENCE_DEVICE_KEY);
    esp_http_client_set_post_field(c, body, off);
    esp_err_t err = esp_http_client_perform(c);
    int status = err == ESP_OK ? esp_http_client_get_status_code(c) : -1;
    esp_http_client_cleanup(c);

    /* The reply may carry configuration the dashboard wants this bridge to adopt. */
    char want_area[ID_MAX] = "", want_name[ID_MAX] = "", want_strategy[12] = "";
    if (status == 200) {
        cJSON *root = cJSON_Parse(s_abuf);
        cJSON *conf = root ? cJSON_GetObjectItem(root, "config") : NULL;
        cJSON *a = conf ? cJSON_GetObjectItem(conf, "area") : NULL;
        cJSON *n = conf ? cJSON_GetObjectItem(conf, "bridge_name") : NULL;
        if (cJSON_IsString(a) && strlen(a->valuestring) < ID_MAX) strlcpy(want_area, a->valuestring, ID_MAX);
        if (cJSON_IsString(n) && strlen(n->valuestring) < ID_MAX) strlcpy(want_name, n->valuestring, ID_MAX);
        cJSON *st = conf ? cJSON_GetObjectItem(conf, "strategy") : NULL;
        if (cJSON_IsString(st) && strlen(st->valuestring) < sizeof(want_strategy)) strlcpy(want_strategy, st->valuestring, sizeof(want_strategy));
        cJSON_Delete(root);
    }
    xSemaphoreGive(s_net_lock);
    if (want_name[0] && strcmp(want_name, bname) != 0) presence_bridge_name_set(want_name);
    if (want_strategy[0] && strcmp(want_strategy, presence_strategy_get()) != 0) presence_strategy_set(want_strategy);
    if (want_area[0] && strcmp(want_area, zone) != 0 && !area_adopt_from_server(want_area))
        xTaskNotifyGive(s_areas_task);   /* could not adopt it (list full?): refresh the list, the dashboard will resend */

    if (status == 200) return true;
    ESP_LOGW(TAG, "POST failed: err=%s status=%d", esp_err_to_name(err), status);
    return false;
}

static void window_task(void *arg) {
    TickType_t last = xTaskGetTickCount();
    int tick = 0, macro_ticks = 0;
    for (;;) {
        vTaskDelayUntil(&last, pdMS_TO_TICKS(WINDOW_MS));
        strategy_tick();
        if (s_mode == MODE_MACRO && esp_timer_get_time() >= s_next_sweep_us) {
            sweep_pass();
            s_next_sweep_us = esp_timer_get_time() + SWEEP_PERIOD_S * 1000000LL;
        }
        s_stats.strategy = presence_strategy_get();
        s_stats.mode = presence_mode_get();
        if (++tick % 5 == 0) {
            if (s_mode == MODE_MICRO) breathing_analyse();
            char ble[700];
            int bl = presence_ble_json(ble, sizeof(ble));
            ESP_LOGI(TAG, "breathing: %s bpm=%.1f snr=%.1f | ble: %.90s", s_breath.valid ? "yes" : "no",
                     s_breath.bpm, s_breath.snr, bl > 0 ? ble : "off");
        }
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
        /* Send every ~2 s to halve request overhead; retry with backlog if the backend is down.
         * In macro mode there are no windows: upload the BLE census every few seconds instead. */
        macro_ticks = s_mode == MODE_MACRO ? macro_ticks + 1 : 0;
        if (s_pending_n >= 2 || (s_mode == MODE_MACRO && macro_ticks >= MACRO_POST_TICKS)) {
            macro_ticks = 0;
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
        if (s_mode == MODE_MACRO) {
            /* radio is deliberately not measuring CSI */
        } else if (s_frames_total == 0) {
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
    strategy_load();
    s_stats.strategy = presence_strategy_get();
    s_stats.mode = "micro";

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

    s_net_lock = xSemaphoreCreateMutex();
    s_sync_done = xSemaphoreCreateBinary();
    xTaskCreate(areas_task, "areas_sync", 8192, NULL, 3, &s_areas_task);

    start_ping();
    presence_ble_start();
    s_mode_since_us = esp_timer_get_time();
    s_smart_busy_us = s_mode_since_us;
    /* macro-leaning strategies start in macro; the rest start measuring CSI right away */
    apply_mode((s_strategy == STRAT_MACRO || s_strategy == STRAT_SMART) ? MODE_MACRO : MODE_MICRO);
    xTaskCreatePinnedToCore(window_task, "csi_window", 8192, NULL, 4, NULL, 1);
    char zone[ID_MAX], bname[ID_MAX];
    presence_zone_get(zone, sizeof(zone));
    presence_bridge_name_get(bname, sizeof(bname));
    ESP_LOGI(TAG, "Continuous CSI presence sensing started, bridge '%s', area '%s'", bname, zone);
}
