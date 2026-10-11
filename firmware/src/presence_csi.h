/**
 * Continuous WiFi-CSI presence sensing (public areas).
 *
 * Starts CSI capture on the station interface, keeps frames flowing by pinging
 * the gateway, reduces every ~1 s of real CSI frames to motion features and
 * POSTs them to the Echo Maps backend. No manual scan is required: call
 * presence_csi_start() once WiFi is connected.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

void presence_csi_start(void);

/* Runtime identity, persisted in NVS:
 *   area        - public area this unit monitors (must be one of the preset list)
 *   bridge name - free-text label for the unit itself (e.g. "Illy Bridge 1")
 * The area is what the dashboard uses as the presence zone. */
#include <stddef.h>
void presence_zone_get(char *out, size_t n);          /* current area */
void presence_bridge_name_get(char *out, size_t n);
bool presence_area_set(const char *area);             /* false if not in the facility's area list */
bool presence_bridge_name_set(const char *name);      /* false if empty/invalid chars */

/* The selectable public areas come from the backend (published by the dashboard from
 * the facility's real layout), cached in NVS. */
int  presence_area_count(void);
bool presence_area_at(int i, char *out, size_t n);
/* Re-fetch the list now; waits up to timeout_ms. Returns true if a fresh list arrived. */
bool presence_areas_refresh(int timeout_ms);

/* Live counters for the LCD / status endpoint. */
/* Sensing strategy. The ESP32 has one 2.4 GHz radio, so it time-shares it between two jobs:
 *   micro - fixed channel, continuous high-resolution CSI (presence, breathing)
 *   macro - CSI and gateway pings off, BLE listening wide and WiFi power-save on: a cheap device census
 * and four strategies choose between them:
 *   "micro"  always micro                       "macro"  always macro
 *   "auto"   45 s micro, then 15 s macro        "smart"  macro until several phones are close, then
 *                                                        micro until the space has been quiet for a while
 * The dashboard sets the strategy through the reply to the bridge's upload; it is kept in flash.
 * Default is "micro", the behaviour of earlier firmware.
 *
 * Macro mode also runs a wide sweep every ~20 s: the radio hops across channels 1-13 (about 120 ms
 * each, then back to the AP's channel) and reduces the CSI of the traffic it hears on each channel
 * to the same motion features micro mode uses. Transmitter addresses are only used in RAM during a
 * dwell, to keep one link's frames together; they are never stored or sent.
 */
/* True while a wide sweep has deliberately taken the radio off the AP. The WiFi event handler must
 * not reconnect or count retries then; the sweep rejoins the AP itself when it is done. */
bool presence_sweep_holds_link(void);
const char *presence_strategy_get(void);
const char *presence_mode_get(void);                 /* what the radio is doing right now */
bool presence_strategy_set(const char *name);        /* false if unknown */

typedef struct {
    uint32_t frames_total;     /* CSI frames received since boot            */
    uint32_t windows_sent;     /* windows accepted by the backend           */
    uint32_t post_failures;    /* failed POSTs since boot                   */
    bool     backend_ok;       /* last POST succeeded                       */
    float    last_amp_cv;
    float    last_decorr;
    int      last_rssi;
    uint8_t  sweep_channels;   /* channels that yielded CSI in the latest wide sweep */
    uint32_t sweeps_done;      /* wide sweeps completed since boot */
    const char *strategy;      /* "micro" | "macro" | "auto" | "smart" */
    const char *mode;          /* "micro" | "macro" */
} presence_stats_t;

presence_stats_t presence_csi_stats(void);
