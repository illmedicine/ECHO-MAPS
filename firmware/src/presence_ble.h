/**
 * Anonymised nearby-BLE-device observer.
 *
 * Passively listens for BLE advertisements and keeps a short-lived table of the
 * devices around the bridge. Addresses are never stored or sent: each is hashed
 * with a random salt that is generated at boot and rotated every 24 h, and only
 * the first 3 bytes of the hash are kept, so the dashboard can tell devices apart
 * within a day but cannot recover (or follow across days) the real address.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>

/* Start the BLE observer. Safe to call once, after NVS is initialised. */
void presence_ble_start(void);

/* Scan duty: wide = listen continuously (macro mode, the radio is otherwise idle);
 * normal = 50 % duty, which leaves air time for WiFi CSI. Safe to call from any task. */
void presence_ble_set_wide(bool wide);

/* Stop / resume scanning (a WiFi channel sweep needs the shared radio to itself). */
void presence_ble_pause(bool pause);

/* How many rotating-address (phone/watch-like) devices are close by right now. Fixed-address
 * devices (printers, TVs, desktops, beacons) are deliberately not counted, so equipment that is
 * always there cannot trigger a crowd. Returns -1 if the observer is not running. */
int presence_ble_crowd(void);

/* Write a JSON object summarising nearby devices into `out`. Returns its length,
 * or 0 if BLE is not running yet. */
int presence_ble_json(char *out, size_t n);
