"""BLE rotating-id linking: an id vanishing as another appears, same manufacturer and signal."""

from echo_maps.history.linking import link_rotating, mfr_name, peak_concurrent

APPLE, SAMSUNG = "004c", "0075"


def sight(ble_id, first, last, *, mfr="", rssi_first=-55, rssi_last=-55, samples=20, device="b1", rotating=True):
    return {
        "device_id": device, "ble_id": ble_id, "epoch": 1, "first_seen": first, "last_seen": last,
        "rssi_first": rssi_first, "rssi_last": rssi_last, "rssi_max": max(rssi_first, rssi_last),
        "samples": samples, "near_samples": samples, "rotating": rotating, "mfr": mfr, "visits": 1, "seconds": last - first,
    }


def test_same_manufacturer_instant_handover_is_one_device():
    rows = [sight("aaaaaa", 1000, 1600, mfr=APPLE), sight("bbbbbb", 1601, 2200, mfr=APPLE)]
    chains = link_rotating(rows)
    assert len(chains) == 1 and chains[0].linked == 1
    assert chains[0].first_seen == 1000 and chains[0].last_seen == 2200 and chains[0].mfr == APPLE


def test_a_chain_of_many_rotations_collapses_to_one_device():
    rows, t = [], 0
    for i in range(6):                     # six rotations over ~90 minutes
        rows.append(sight(f"{i:06x}", t, t + 899, mfr=APPLE))
        t += 900
    assert len(link_rotating(rows)) == 1


def test_different_known_manufacturers_never_link():
    rows = [sight("aaaaaa", 1000, 1600, mfr=APPLE), sight("bbbbbb", 1601, 2200, mfr=SAMSUNG)]
    assert len(link_rotating(rows)) == 2


def test_unknown_manufacturer_needs_a_tight_match():
    # appears within 2 s and the signal agrees: linked
    close = [sight("aaaaaa", 1000, 1600), sight("bbbbbb", 1602, 2200)]
    assert len(link_rotating(close)) == 1
    # appears 8 s later: with no manufacturer to confirm it, too loose
    late = [sight("aaaaaa", 1000, 1600), sight("bbbbbb", 1608, 2200)]
    assert len(link_rotating(late)) == 2
    # same timing but a known matching manufacturer confirms it even at 8 s
    late_known = [sight("aaaaaa", 1000, 1600, mfr=APPLE), sight("bbbbbb", 1608, 2200, mfr=APPLE)]
    assert len(link_rotating(late_known)) == 1


def test_signal_jump_prevents_a_link():
    rows = [sight("aaaaaa", 1000, 1600, mfr=APPLE, rssi_last=-50), sight("bbbbbb", 1601, 2200, mfr=APPLE, rssi_first=-80)]
    assert len(link_rotating(rows)) == 2


def test_gap_longer_than_the_window_is_a_new_device():
    rows = [sight("aaaaaa", 1000, 1600, mfr=APPLE), sight("bbbbbb", 1660, 2200, mfr=APPLE)]   # 60 s later
    assert len(link_rotating(rows)) == 2


def test_a_crowd_rotating_at_once_still_counts_each_device_once():
    # five Apple phones all rotate within the same few seconds: pairing may be crossed, the count must not be
    old = [sight(f"a{i:05x}", 1000, 1600 + i, mfr=APPLE, rssi_last=-50 - i) for i in range(5)]
    new = [sight(f"b{i:05x}", 1601 + i, 2200, mfr=APPLE, rssi_first=-50 - i) for i in range(5)]
    chains = link_rotating(old + new)
    assert len(chains) == 5 and all(c.linked == 1 for c in chains)


def test_blips_and_stable_ids_are_ignored():
    rows = [
        sight("aaaaaa", 1000, 1001, samples=1),                        # heard once: noise
        sight("bbbbbb", 1000, 2000, rotating=False, mfr=APPLE),        # fixed identity: never rotates
    ]
    assert link_rotating(rows) == []


def test_ids_are_never_linked_across_bridges():
    rows = [sight("aaaaaa", 1000, 1600, mfr=APPLE, device="b1"), sight("bbbbbb", 1601, 2200, mfr=APPLE, device="b2")]
    assert len(link_rotating(rows)) == 2


def test_peak_concurrent_and_names():
    assert peak_concurrent([(0, 10), (5, 15), (12, 20)]) == 2
    assert peak_concurrent([]) == 0
    assert mfr_name("004C") == "Apple" and mfr_name("") == "Unknown" and mfr_name("ffff") == "Other"


def test_two_guests_passing_are_not_merged_in_a_crowded_handover():
    # One id ends just as five others begin. The closest-looking stranger is 8 dB away, which the normal
    # rule would accept; in a crowd only a close signal match may link, so nothing is merged.
    old = [sight("aaaaaa", 1000, 1600, mfr=APPLE, rssi_last=-50)]
    crowd = [sight(f"b{i:05x}", 1601, 2200, mfr=APPLE, rssi_first=-58 - i) for i in range(5)]
    chains = link_rotating(old + crowd)
    assert len(chains) == 6 and all(c.linked == 0 for c in chains)
    # without the crowd the same 8 dB match is still accepted
    assert len(link_rotating(old + crowd[:1])) == 1
