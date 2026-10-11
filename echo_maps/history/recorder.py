"""Turns the live presence stream into compact, anonymous history rows.

Every bridge upload (about every 2 s) is folded into three kinds of row:

  * minute buckets      - how occupied the area was, and how many devices/occupants were around
  * BLE sightings       - one row per anonymised BLE id per salt epoch (first/last heard, RSSI, ...)
  * signature episodes  - a breathing signature that persisted, i.e. one person-like or pet-like occupant

Only counts and the bridge's own salted/truncated hashes are kept. Nothing here can identify
a person or recover a real device address.

The recorder is synchronous and in-memory; a background task drains the dirty rows to the
store (Postgres, or memory when no database is configured) every few seconds.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

MINUTE = 60
NEAR_RSSI = -70               # same definition the bridge uses for "near" (a few metres)
VISIT_GAP_S = 300             # silence longer than this and a returning id counts as a new visit
SECONDS_CAP = 30              # an inter-sample gap longer than this is not counted as presence
SIG_MATCH_BPM = 2.5           # a breathing reading this close to an open episode continues it
SIG_STALE_S = 120             # an episode with no matching reading for this long is closed
KEEP_IN_MEMORY_S = 2 * 3600   # recent rows kept for read-your-writes; older ones live in the store only


@dataclass
class Bucket:
    device_id: str
    ts: int
    area: str = ""
    bridge_name: str = ""
    samples: int = 0
    present_samples: int = 0
    ratio_sum: float = 0.0
    ratio_max: float = 0.0
    people_max: int = 0
    pets_max: int = 0
    ble_count_max: int = 0
    ble_near_max: int = 0
    ble_stable_max: int = 0
    ble_persist_max: int = 0


@dataclass
class Sighting:
    device_id: str
    ble_id: str
    epoch: int
    area: str = ""
    first_seen: int = 0
    last_seen: int = 0
    visits: int = 1
    seconds: int = 0
    samples: int = 0
    near_samples: int = 0
    rssi_max: int = -127
    rssi_first: int = -127
    rssi_last: int = -127
    rotating: bool = False
    persistent: bool = False
    mfr: str = ""


@dataclass
class Episode:
    device_id: str
    kind: str
    first_seen: int
    area: str = ""
    last_seen: int = 0
    bpm_mean: float = 0.0
    snr_mean: float = 0.0
    readings: int = 0


@dataclass
class Batch:
    buckets: list[dict] = field(default_factory=list)
    sightings: list[dict] = field(default_factory=list)
    episodes: list[dict] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.buckets or self.sightings or self.episodes)


class Recorder:
    def __init__(self) -> None:
        self._buckets: dict[tuple[str, int], Bucket] = {}
        self._sightings: dict[tuple[str, str, int], Sighting] = {}
        self._episodes: dict[tuple[str, str, int], Episode] = {}
        self._open: dict[tuple[str, str], list[Episode]] = {}   # (device, kind) -> open episodes
        self._dirty_b: set[tuple[str, int]] = set()
        self._dirty_s: set[tuple[str, str, int]] = set()
        self._dirty_e: set[tuple[str, str, int]] = set()
        self._boot: dict[str, float] = {}                       # device -> estimated boot time
        self._last_obs: dict[str, float] = {}                   # device -> last observe() time

    # ── ingest side ──

    def observe(
        self,
        *,
        device_id: str,
        area: str,
        bridge_name: str,
        ts: float,
        present: bool,
        ratio: float,
        signatures: list[dict],
        ble: dict | None,
        uptime_s: float | None = None,
    ) -> None:
        if uptime_s is not None and uptime_s >= 0:
            est = ts - uptime_s
            old = self._boot.get(device_id)
            # Keep the first estimate: upload latency jitters it by a second or two. Replace it
            # only when it moves a lot, which means the bridge rebooted (or we just restarted).
            if old is None or abs(est - old) > 120:
                self._boot[device_id] = est
        self._last_obs[device_id] = ts
        self._observe_bucket(device_id, area, bridge_name, ts, present, ratio, signatures, ble)
        if ble:
            self._observe_ble(device_id, area, ts, ble)
        self._observe_signatures(device_id, area, ts, signatures)

    def _observe_bucket(self, device_id, area, bridge_name, ts, present, ratio, signatures, ble) -> None:
        minute = int(ts // MINUTE) * MINUTE
        key = (device_id, minute)
        b = self._buckets.get(key)
        if b is None:
            b = self._buckets[key] = Bucket(device_id=device_id, ts=minute)
        b.area, b.bridge_name = area, bridge_name
        b.samples += 1
        if present:
            b.present_samples += 1
        b.ratio_sum += max(ratio, 0.0)
        b.ratio_max = max(b.ratio_max, max(ratio, 0.0))
        b.people_max = max(b.people_max, sum(1 for s in signatures if s.get("kind") == "slower"))
        b.pets_max = max(b.pets_max, sum(1 for s in signatures if s.get("kind") == "faster"))
        if ble:
            b.ble_count_max = max(b.ble_count_max, int(ble.get("count", 0)))
            b.ble_near_max = max(b.ble_near_max, int(ble.get("near", 0)))
            b.ble_stable_max = max(b.ble_stable_max, int(ble.get("stable", 0)))
            b.ble_persist_max = max(b.ble_persist_max, int(ble.get("persistent", 0)))
        self._dirty_b.add(key)

    def salt_epoch(self, device_id: str, ts: float) -> int:
        """Which salt period an id belongs to. The bridge picks a random salt at boot and
        rotates it every 24 h, so ids are only comparable inside one (boot, day) period."""
        boot = self._boot.get(device_id)
        if boot is None:
            return int(ts // 86400)          # firmware without uptime: fall back to calendar day
        # Boot time in 10-minute steps (so a server restart re-deriving it a second off lands in
        # the same epoch) combined with the day since boot.
        return int(boot // 600) * 1000 + int((ts - boot) // 86400)

    def _observe_ble(self, device_id: str, area: str, ts: float, ble: dict) -> None:
        epoch = self.salt_epoch(device_id, ts)
        for d in ble.get("devices", []):
            ble_id = d["id"]
            heard = ts - float(d.get("age", 0))
            first_heard = ts - float(d["fa"]) if d.get("fa") is not None else heard
            key = (device_id, ble_id, epoch)
            s = self._sightings.get(key)
            rssi = int(d.get("rssi", -127))
            if s is None:
                s = self._sightings[key] = Sighting(
                    device_id=device_id, ble_id=ble_id, epoch=epoch, area=area,
                    first_seen=int(first_heard), last_seen=int(heard), visits=1,
                    rssi_first=rssi, rssi_max=rssi, rssi_last=rssi,
                )
            else:
                gap = heard - s.last_seen
                if gap > VISIT_GAP_S:
                    s.visits += 1
                if gap > 0:
                    s.seconds += int(min(gap, SECONDS_CAP))
                s.first_seen = min(s.first_seen, int(first_heard))
                s.last_seen = max(s.last_seen, int(heard))
            s.area = area
            s.samples += 1
            if rssi >= NEAR_RSSI:
                s.near_samples += 1
            s.rssi_max = max(s.rssi_max, rssi)
            s.rssi_last = rssi
            s.rotating = s.rotating or bool(d.get("t"))
            s.persistent = s.persistent or bool(d.get("p"))
            if d.get("m"):
                s.mfr = d["m"]
            self._dirty_s.add(key)

    def _observe_signatures(self, device_id: str, area: str, ts: float, signatures: list[dict]) -> None:
        t = int(ts)
        # close episodes that have gone quiet
        for k in [k for k in self._open if k[0] == device_id]:
            self._open[k] = [e for e in self._open[k] if t - e.last_seen <= SIG_STALE_S]
        claimed: set[int] = set()
        for sig in signatures:
            kind, bpm, snr = sig.get("kind"), float(sig.get("bpm", 0)), float(sig.get("snr", 0))
            if kind not in ("slower", "faster"):
                continue
            opens = self._open.setdefault((device_id, kind), [])
            best = None
            for e in opens:
                if id(e) in claimed:
                    continue
                if abs(bpm - e.bpm_mean) <= SIG_MATCH_BPM and (best is None or abs(bpm - e.bpm_mean) < abs(bpm - best.bpm_mean)):
                    best = e
            if best is None:
                best = Episode(device_id=device_id, kind=kind, first_seen=t, area=area, last_seen=t, bpm_mean=bpm, snr_mean=snr, readings=0)
                opens.append(best)
                self._episodes[(device_id, kind, t)] = best
            claimed.add(id(best))
            n = best.readings
            best.bpm_mean = (best.bpm_mean * n + bpm) / (n + 1) if n else bpm
            best.snr_mean = (best.snr_mean * n + snr) / (n + 1) if n else snr
            best.readings = n + 1
            best.last_seen = t
            best.area = area
            self._dirty_e.add((device_id, kind, best.first_seen))

    # ── persistence side ──

    def drain(self) -> Batch:
        """Take every row changed since the last drain (as dicts), and forget old rows."""
        batch = Batch(
            buckets=[asdict(self._buckets[k]) for k in self._dirty_b if k in self._buckets],
            sightings=[asdict(self._sightings[k]) for k in self._dirty_s if k in self._sightings],
            episodes=[asdict(self._episodes[k]) for k in self._dirty_e if k in self._episodes],
        )
        self._dirty_b.clear(); self._dirty_s.clear(); self._dirty_e.clear()
        return batch

    def requeue(self, batch: Batch) -> None:
        """A flush failed: mark its rows dirty again so the next drain retries them."""
        self._dirty_b.update((r["device_id"], r["ts"]) for r in batch.buckets)
        self._dirty_s.update((r["device_id"], r["ble_id"], r["epoch"]) for r in batch.sightings)
        self._dirty_e.update((r["device_id"], r["kind"], r["first_seen"]) for r in batch.episodes)

    def prune_memory(self, now: float) -> None:
        cut = now - KEEP_IN_MEMORY_S
        for k in [k for k, b in self._buckets.items() if b.ts < cut and k not in self._dirty_b]:
            del self._buckets[k]
        for k in [k for k, s in self._sightings.items() if s.last_seen < cut and k not in self._dirty_s]:
            del self._sightings[k]
        for k in [k for k, e in self._episodes.items() if e.last_seen < cut and k not in self._dirty_e]:
            del self._episodes[k]

    def overlay(self, device_id: str | None, start: float, end: float) -> Batch:
        """Recent rows still held here, so a query sees data the store has not received yet."""
        ok = lambda d: device_id is None or d == device_id  # noqa: E731
        return Batch(
            buckets=[asdict(b) for b in self._buckets.values() if ok(b.device_id) and start - MINUTE <= b.ts <= end],
            sightings=[asdict(s) for s in self._sightings.values() if ok(s.device_id) and s.last_seen >= start and s.first_seen <= end],
            episodes=[asdict(e) for e in self._episodes.values() if ok(e.device_id) and e.last_seen >= start and e.first_seen <= end],
        )

    def boot_time(self, device_id: str) -> float | None:
        return self._boot.get(device_id)

    def last_observed(self, device_id: str) -> float | None:
        return self._last_obs.get(device_id)
