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
bool presence_area_set(const char *area);             /* false if not in the preset list */
bool presence_bridge_name_set(const char *name);      /* false if empty/invalid chars */
int  presence_area_count(void);
const char *presence_area_at(int i);

/* Live counters for the LCD / status endpoint. */
typedef struct {
    uint32_t frames_total;     /* CSI frames received since boot            */
    uint32_t windows_sent;     /* windows accepted by the backend           */
    uint32_t post_failures;    /* failed POSTs since boot                   */
    bool     backend_ok;       /* last POST succeeded                       */
    float    last_amp_cv;
    float    last_decorr;
    int      last_rssi;
} presence_stats_t;

presence_stats_t presence_csi_stats(void);
