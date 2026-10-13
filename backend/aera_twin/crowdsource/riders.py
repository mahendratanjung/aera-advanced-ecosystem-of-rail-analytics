"""Crowding from riders' phones, the way Google Maps learns traffic from drivers.

Two signals:

* **Reports**: a rider taps how full their train is (Quiet to Packed). Cheap, works
  underground, but subjective; one report moves the estimate only a little.
* **Locations** (opt in): the phone sends its position while the app is open. Positions are
  snapped to the track; a phone moving along the line at train speed next to a simulated
  train is counted as on that train. Phones per train divided by the share of riders who
  share their location (``penetration``) estimates passengers. Needs many users, and GPS
  fails in the tunnel between Ampang Park and Pasar Seni.

Privacy: raw device ids are never stored. Each is replaced by a keyed hash that changes
every day, positions are reduced to a distance along the line and dropped after a few
minutes, and a train's location count is published only once ``min_devices`` phones are on
it, so no single rider can be picked out.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import deque
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field

from aera_twin.config import CrowdsourceSettings
from aera_twin.crowdsource.fusion import SOURCE_SD, Observation, ObservationBook
from aera_twin.geo import LineProjector
from aera_twin.timetable import KL_OFFSET_S, Line, TrainState

DEVICE_PATTERN = r"^[A-Za-z0-9_-]+$"
# A phone is on the line if it is this close to the track, plus its reported accuracy.
ON_LINE_M = 60.0
# How far a phone may be from a simulated train and still count as on it. Covers GPS error and
# the gap between the timetable and the real train.
MATCH_M = 450.0
MOVING_MPS = 3.0
TRACK_TTL_S = 180
MAX_ACCURACY_M = 100.0
PENETRATION_CV = 0.35  # uncertainty in the share of riders who share location


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RiderReport(_Strict):
    device: str = Field(min_length=16, max_length=64, pattern=DEVICE_PATTERN)
    trip_id: str = Field(min_length=1, max_length=64)
    level: int = Field(ge=1, le=5)  # Quiet, Comfortable, Busy, Crowded, Packed
    car: int | None = Field(default=None, ge=1, le=4)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=10_000)


class LocationPing(_Strict):
    device: str = Field(min_length=16, max_length=64, pattern=DEVICE_PATTERN)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0, le=10_000)


class RiderError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class WindowLimiter:
    """At most ``limit`` hits per key in a sliding window. Keys with no recent hits are dropped."""

    def __init__(self, limit: int, window_s: float):
        self.limit = limit
        self.window_s = window_s
        self.hits: dict[str, deque[float]] = {}

    def allow(self, key: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        q = self.hits.setdefault(key, deque())
        while q and q[0] <= now - self.window_s:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True

    def sweep(self, now: float | None = None) -> None:
        now = time.time() if now is None else now
        for key in [k for k, q in self.hits.items() if not q or q[-1] <= now - self.window_s]:
            del self.hits[key]


def level_to_pct(level: int, bounds: list[float]) -> float:
    """Middle of a crowding level, in percent of capacity, from the admin's level bounds."""
    edges = [0.0, *bounds, bounds[-1] + 20]
    return (edges[level - 1] + edges[level]) / 2


@dataclass
class _Track:
    distance_m: float
    at_s: float
    wall_s: float
    direction_id: int | None = None
    trip_id: str | None = None
    hits: int = 0  # consecutive pings matched to the same train


class RiderDesk:
    def __init__(self, line: Line, projector: LineProjector, book: ObservationBook):
        self.line = line
        self.projector = projector
        self.book = book
        self.reports_per_device = WindowLimiter(12, 3600)
        self.pings_per_device = WindowLimiter(30, 60)
        self.per_address = WindowLimiter(120, 60)
        self.tracks: dict[str, _Track] = {}
        self._salt = secrets.token_bytes(32)
        self._salt_day = -1

    # ---- privacy ---------------------------------------------------------------------

    def pseudonym(self, device: str, wall_s: float | None = None) -> str:
        """Keyed hash of the device id that changes every Kuala Lumpur day."""
        wall_s = time.time() if wall_s is None else wall_s
        day = int((wall_s + KL_OFFSET_S) // 86400)
        if day != self._salt_day:
            self._salt, self._salt_day = secrets.token_bytes(32), day
            self.tracks.clear()
        return hmac.new(self._salt, device.encode(), hashlib.sha256).hexdigest()[:24]

    # ---- reports ---------------------------------------------------------------------

    def report(self, body: RiderReport, trains: list[TrainState], sim_ms: int, cfg: CrowdsourceSettings,
               bounds: list[float], wall_s: float | None = None) -> Observation:
        if not cfg.enabled:
            raise RiderError(403, "disabled", "Rider reports are switched off.")
        who = self.pseudonym(body.device, wall_s)
        self.reports_per_device.limit = cfg.reports_per_hour
        if not self.reports_per_device.allow(who, wall_s):
            raise RiderError(429, "rate_limited", "Thanks, you have sent a lot of reports. Try again later.")
        train = next((t for t in trains if t.trip_id == body.trip_id), None)
        if train is None:
            raise RiderError(409, "not_running", "That train is not running now.")
        sd = SOURCE_SD["rider_report"]
        if body.lat is not None and body.lon is not None and (body.accuracy_m or 0) <= 300:
            acc = body.accuracy_m or 0
            snap = self.projector.snap(body.lat, body.lon)
            if snap.offset_m > 150 + acc or abs(snap.distance_m - train.distance_m) > 2000 + acc:
                raise RiderError(422, "too_far", "You seem to be away from that train.")
        else:
            sd *= 1.3  # no usable position (often underground): trust a little less
        obs = Observation(trip_id=train.trip_id, key=f"r:{who}", source="rider_report",
                          pct=level_to_pct(body.level, bounds), sd=sd, stop_index=train.stop_index, at_ms=sim_ms)
        self.book.add(obs)
        return obs

    # ---- locations -------------------------------------------------------------------

    def ping(self, body: LocationPing, trains: list[TrainState], sim_ms: int, cfg: CrowdsourceSettings,
             wall_s: float | None = None) -> str | None:
        """Match one position to a train. Returns the trip id once the phone is matched."""
        if not cfg.enabled:
            raise RiderError(403, "disabled", "Location sharing is switched off.")
        wall_s = time.time() if wall_s is None else wall_s
        who = self.pseudonym(body.device, wall_s)
        if not self.pings_per_device.allow(who, wall_s):
            raise RiderError(429, "rate_limited", "Too many positions. Send one every few seconds.")
        if body.accuracy_m > MAX_ACCURACY_M:
            return None  # too vague to place on a track; keep the previous match for a while
        t = sim_ms / 1000
        snap = self.projector.snap(body.lat, body.lon)
        if snap.offset_m > ON_LINE_M + body.accuracy_m:
            self.tracks.pop(who, None)
            return None
        prev = self.tracks.get(who)
        track = _Track(snap.distance_m, t, wall_s)
        if prev:
            dt = t - prev.at_s
            track.direction_id = prev.direction_id
            if 2 <= dt <= TRACK_TTL_S:
                v = (snap.distance_m - prev.distance_m) / dt
                if v > MOVING_MPS:
                    track.direction_id = 1  # towards Putra Heights, distance grows
                elif v < -MOVING_MPS:
                    track.direction_id = 0  # towards Gombak
        if track.direction_id is not None:
            near = [tr for tr in trains if tr.direction_id == track.direction_id
                    and abs(tr.distance_m - snap.distance_m) <= MATCH_M + body.accuracy_m]
            best = min(near, key=lambda tr: abs(tr.distance_m - snap.distance_m), default=None)
            if best:
                track.trip_id = best.trip_id
                track.hits = prev.hits + 1 if prev and prev.trip_id == best.trip_id else 1
        self.tracks[who] = track
        # Two matches in a row before a phone counts, so a car on a road beside the viaduct
        # passing one train does not.
        return track.trip_id if track.hits >= 2 else None

    def refresh(self, trains: list[TrainState], sim_ms: int, capacity: int, cfg: CrowdsourceSettings,
                wall_s: float | None = None) -> None:
        """Turn the phones currently matched to each train into one observation per train."""
        wall_s = time.time() if wall_s is None else wall_s
        for who in [w for w, tr in self.tracks.items() if wall_s - tr.wall_s > TRACK_TTL_S]:
            del self.tracks[who]
        self.reports_per_device.sweep(wall_s)
        self.pings_per_device.sweep(wall_s)
        self.per_address.sweep(wall_s)
        by_id = {tr.trip_id: tr for tr in trains}
        counts: dict[str, int] = {}
        for tr in self.tracks.values():
            if tr.trip_id in by_id and tr.hits >= 2 and wall_s - tr.wall_s <= 120:
                counts[tr.trip_id] = counts.get(tr.trip_id, 0) + 1
        for trip_id, train in by_id.items():
            n = counts.get(trip_id, 0)
            if not cfg.enabled or n < cfg.min_devices:
                self.book.remove(trip_id, "locations")
                continue
            pct = n / cfg.penetration / capacity * 100
            sd = max(5.0, pct * (1 / n + PENETRATION_CV ** 2) ** 0.5)
            self.book.add(Observation(trip_id=trip_id, key="locations", source="rider_location", pct=pct, sd=sd,
                                      stop_index=train.stop_index, at_ms=sim_ms))
