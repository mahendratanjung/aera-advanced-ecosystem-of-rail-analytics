"""Schedule-driven train simulation (SIM-02, SIM-04, SIM-05).

Train positions are a pure function of the line file, the simulation clock and the list of
active disruptions. ``frontend/lib/sim/trains.ts`` implements the same algorithm, so every
browser and this service agree on where each train is. Keep the two in step.

All times here are epoch seconds unless the name says ``_ms``.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from aera_twin.paths import LINES_DIR

KL_OFFSET_S = 8 * 3600
KL_TZ = timezone(timedelta(seconds=KL_OFFSET_S))
DAY_S = 86400
INF = math.inf


class Disruption(BaseModel):
    id: str
    # insert: an extra train leaves the first stop of direction_id at start_ms (an operator
    # what-if). It adds a trip; it does not delay any.
    kind: Literal["delay", "hold", "suspend", "surge", "insert"]
    stop_id: str
    to_stop_id: str | None = None
    direction_id: int | None = None
    delay_s: int = Field(default=0, ge=0, le=6 * 3600)
    # surge only: extra passengers boarding at stop_id, as a multiple of the usual number.
    # It changes crowding, not train times, so timeline() ignores it.
    multiplier: float = Field(default=1.0, ge=1.0, le=6.0)
    start_ms: int
    end_ms: int | None = None
    note: str = ""


@dataclass(frozen=True)
class Trip:
    id: str
    direction_id: int
    start: int  # epoch seconds of departure from the first stop


@dataclass
class TrainState:
    trip_id: str
    direction_id: int
    status: Literal["dwelling", "moving", "held"]
    stop_index: int
    next_index: int | None
    distance_m: float
    load_pct: float


class Line:
    def __init__(self, data: dict):
        self.data = data
        self.id: str = data["id"]
        self.stations: list[dict] = data["stations"]
        self.station_ids = [s["id"] for s in self.stations]
        self.distance = {s["id"]: s["distance_m"] for s in self.stations}
        self.directions = {d["direction_id"]: d for d in data["directions"]}
        self.frequencies: dict[str, dict[str, list[dict]]] = data["frequencies"]
        self.calendar: dict[str, list[int]] = data["calendar"]
        self.duration = {
            d: dd["stops"][-1]["dep"] for d, dd in self.directions.items()
        }
        self.stop_index = {
            d: {s["station_id"]: i for i, s in enumerate(dd["stops"])} for d, dd in self.directions.items()
        }

    @classmethod
    def load(cls, line_id: str, path: Path | None = None) -> Line:
        p = path or LINES_DIR / f"{line_id}.json"
        return cls(json.loads(p.read_text()))

    # ---- calendar ------------------------------------------------------------------

    @staticmethod
    def service_day_start(t: float) -> int:
        """Epoch seconds of local midnight for the KL date containing t."""
        return int((t + KL_OFFSET_S) // DAY_S * DAY_S - KL_OFFSET_S)

    def services_on(self, day_start: int) -> list[str]:
        weekday = datetime.fromtimestamp(day_start + 1, KL_TZ).weekday()
        return [sid for sid, days in self.calendar.items() if days[weekday]]

    def trips_between(self, direction_id: int, t_from: float, t_to: float,
                      disruptions: list[Disruption] | tuple = ()) -> list[Trip]:
        """Trips whose first departure lies in [t_from, t_to], with any inserted extra trains."""
        out: list[Trip] = []
        for d in disruptions:
            t0 = d.start_ms // 1000
            if d.kind == "insert" and d.direction_id == direction_id and t_from <= t0 <= t_to:
                out.append(Trip(f"{self.id}-{direction_id}-x{t0}", direction_id, int(t0)))
        day = self.service_day_start(t_from) - DAY_S
        last_day = self.service_day_start(t_to)
        while day <= last_day:
            for sid in self.services_on(day):
                for w in self.frequencies.get(sid, {}).get(str(direction_id), []):
                    first = day + w["start"]
                    end = day + w["end"]
                    h = w["headway"]
                    k0 = max(0, math.ceil((t_from - first) / h))
                    t0 = first + k0 * h
                    while t0 < end and t0 <= t_to:
                        out.append(Trip(f"{self.id}-{direction_id}-{t0}", direction_id, int(t0)))
                        t0 += h
            day += DAY_S
        out.sort(key=lambda tr: tr.start)
        return out

    # ---- disruptions ---------------------------------------------------------------

    def _suspend_entry(self, d: Disruption, direction_id: int) -> str | None:
        idx = self.stop_index[direction_id]
        a, b = d.stop_id, d.to_stop_id or d.stop_id
        if a not in idx or b not in idx:
            return None
        return a if idx[a] <= idx[b] else b

    def timeline(self, trip: Trip, disruptions: list[Disruption]) -> list[tuple[float, float]]:
        """Arrival and departure per stop after applying disruptions in order along the route."""
        stops = self.directions[trip.direction_id]["stops"]
        relevant = [d for d in disruptions if d.direction_id in (None, trip.direction_id)]
        out: list[tuple[float, float]] = []
        shift = 0.0
        for s in stops:
            arr = trip.start + s["arr"] + shift
            dep = trip.start + s["dep"] + shift
            for d in relevant:
                start = d.start_ms / 1000
                end = INF if d.end_ms is None else d.end_ms / 1000
                if d.kind == "delay" and d.stop_id == s["station_id"]:
                    if start <= dep < end:
                        dep += d.delay_s
                elif d.kind == "hold" and d.stop_id == s["station_id"]:
                    if start <= dep and end > arr:
                        dep = max(dep, end)
                elif d.kind == "suspend" and self._suspend_entry(d, trip.direction_id) == s["station_id"]:
                    if start <= dep < end:
                        dep = max(dep, end)
            shift = dep - (trip.start + s["dep"])  # lateness so far; stays inf after an open-ended hold
            out.append((arr, dep))
        return out

    def _lookback(self, t: float, disruptions: list[Disruption]) -> float:
        extra = 0.0
        for d in disruptions:
            start = d.start_ms / 1000
            if start > t:
                continue
            extra += d.delay_s
            if d.kind in ("hold", "suspend"):
                end = t if d.end_ms is None else min(t, d.end_ms / 1000)
                extra += max(0.0, end - start)
        return max(self.duration.values()) + extra + 60

    # ---- positions -----------------------------------------------------------------

    def state_at(self, trip: Trip, times: list[tuple[float, float]], t: float) -> TrainState | None:
        if t < times[0][0] or t > times[-1][1]:
            return None
        stops = self.directions[trip.direction_id]["stops"]
        n = len(stops)
        lo, hi = 0, n - 1
        while lo < hi:  # last stop whose arrival <= t
            mid = (lo + hi + 1) // 2
            if times[mid][0] <= t:
                lo = mid
            else:
                hi = mid - 1
        i = lo
        arr, dep = times[i]
        sid = stops[i]["station_id"]
        load = train_load_pct(trip, i, n, t)
        if t <= dep or i == n - 1:
            status = "held" if t > arr + (stops[i]["dep"] - stops[i]["arr"]) + 1 else "dwelling"
            return TrainState(trip.id, trip.direction_id, status, i, i + 1 if i < n - 1 else None,
                              self.distance[sid], load)
        nxt = stops[i + 1]["station_id"]
        span = times[i + 1][0] - dep
        f = 1.0 if span <= 0 else (t - dep) / span
        f = f * f * (3 - 2 * f)  # ease into and out of stations
        dist = self.distance[sid] + (self.distance[nxt] - self.distance[sid]) * f
        return TrainState(trip.id, trip.direction_id, "moving", i, i + 1, dist, load)

    def active_trains(self, t: float, disruptions: list[Disruption]) -> list[TrainState]:
        out = []
        lb = self._lookback(t, disruptions)
        for d in self.directions:
            for trip in self.trips_between(d, t - lb, t, disruptions):
                st = self.state_at(trip, self.timeline(trip, disruptions), t)
                if st:
                    out.append(st)
        return out

    def next_departures(
        self, station_id: str, t: float, disruptions: list[Disruption], limit: int = 3, horizon_s: int = 7200
    ) -> dict[int, list[dict]]:
        """Next trains calling at a station per direction (NET-05, PAX-02)."""
        result: dict[int, list[dict]] = {}
        lb = self._lookback(t, disruptions)
        for d, dd in self.directions.items():
            idx = self.stop_index[d].get(station_id)
            rows: list[dict] = []
            if idx is None or idx == len(dd["stops"]) - 1:
                result[d] = rows
                continue
            for trip in self.trips_between(d, t - lb, t + horizon_s, disruptions):
                times = self.timeline(trip, disruptions)
                arr, dep = times[idx]
                if dep < t or arr == INF:
                    continue
                nominal = trip.start + dd["stops"][idx]["arr"]
                rows.append({
                    "trip_id": trip.id,
                    "direction_id": d,
                    "headsign": dd["headsign"],
                    "arrival": arr,
                    "departure": dep,
                    "delay_s": round(arr - nominal),
                    "at_platform": arr <= t <= dep,
                    "load_pct": train_load_pct(trip, idx, len(dd["stops"]), arr),
                })
            rows.sort(key=lambda r: r["arrival"])
            result[d] = rows[:limit]
        return result


# ---- shared demand model ---------------------------------------------------------------


def local_hour(t: float) -> float:
    return ((t + KL_OFFSET_S) % DAY_S) / 3600


def demand(hour: float) -> float:
    """Relative passenger demand by Kuala Lumpur time of day, 0 to about 1."""
    if hour < 5.75 or hour > 23.75:
        return 0.0

    def g(mu: float, sigma: float) -> float:
        return math.exp(-0.5 * ((hour - mu) / sigma) ** 2)

    return min(1.0, 0.12 + 0.88 * g(8.0, 0.9) + 0.8 * g(18.25, 1.0) + 0.25 * g(13.0, 1.6))


def train_load_pct(trip: Trip, stop_index: int, n_stops: int, t: float) -> float:
    """Simulated load of a train, labelled as simulated wherever it is shown (SIM-05)."""
    p = stop_index / max(1, n_stops - 1)
    profile = math.sin(math.pi * p) ** 0.8
    jitter = ((trip.start // 60) * 7919 % 1000) / 1000
    base = 0.1 + 0.85 * demand(local_hour(t))
    return round(max(3.0, min(115.0, base * (0.35 + 0.65 * profile) * (0.9 + 0.2 * jitter) * 100)), 1)


@lru_cache(maxsize=8)
def load_line(line_id: str) -> Line:
    return Line.load(line_id)
