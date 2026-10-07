"""Occupancy engine (OCC-01 to OCC-06, section 9.6).

Every change to a zone count passes through this module, whether it came from a sensor on
the scale model, from the simulator, from the boarding rule or from an operator.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from aera_twin.config import Settings
from aera_twin.levels import level_for, percent_of
from aera_twin.station import StationModel

FLOW_WINDOW_MS = 60_000


@dataclass
class ZoneState:
    id: str
    station_id: str
    name: str
    type: str
    level_id: str
    capacity: int
    public: bool
    count: int = 0
    percent: float = 0.0
    level: str = "low"
    available: bool = True
    reason: str | None = None
    source: str = "sim"
    estimated: bool = False
    drift: int = 0
    updated_at_ms: int = 0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "station_id": self.station_id,
            "name": self.name,
            "type": self.type,
            "level_id": self.level_id,
            "capacity": self.capacity,
            "public": self.public,
            "count": self.count,
            "percent": self.percent,
            "level": self.level,
            "available": self.available,
            "reason": self.reason,
            "source": self.source,
            "estimated": self.estimated,
            "drift": self.drift,
            "updated_at_ms": self.updated_at_ms,
        }


@dataclass
class LinkState:
    id: str
    station_id: str
    name: str
    type: str
    from_zone: str
    to_zone: str
    available: bool = True
    reason: str | None = None
    flow_in: deque = field(default_factory=deque)
    flow_out: deque = field(default_factory=deque)

    def _trim(self, now_ms: int) -> None:
        for q in (self.flow_in, self.flow_out):
            while q and q[0][0] < now_ms - FLOW_WINDOW_MS:
                q.popleft()

    def flows(self, now_ms: int) -> tuple[int, int]:
        self._trim(now_ms)
        return sum(c for _, c in self.flow_in), sum(c for _, c in self.flow_out)

    def to_dict(self, now_ms: int) -> dict:
        fin, fout = self.flows(now_ms)
        return {
            "id": self.id,
            "station_id": self.station_id,
            "name": self.name,
            "type": self.type,
            "from": self.from_zone,
            "to": self.to_zone,
            "available": self.available,
            "reason": self.reason,
            "flow_in_per_min": fin,
            "flow_out_per_min": fout,
        }


class OccupancyEngine:
    def __init__(self, station: StationModel, settings: Settings):
        self.station = station
        self.settings = settings
        self.zones: dict[str, ZoneState] = {
            z.id: ZoneState(
                id=z.id, station_id=station.id, name=z.name, type=z.type, level_id=z.level,
                capacity=self._capacity(z.id, z.capacity), public=z.public,
            )
            for z in station.d.zones
        }
        self.links: dict[str, LinkState] = {
            lk.id: LinkState(
                id=lk.id, station_id=station.id, name=lk.name or lk.id, type=lk.type,
                from_zone=lk.from_, to_zone=lk.to,
            )
            for lk in station.d.links
        }
        for z in self.zones.values():
            self._recompute(z)

    def _capacity(self, zone_id: str, default: int) -> int:
        return self.settings.zone_capacity.get(f"{self.station.id}:{zone_id}", default)

    def _recompute(self, z: ZoneState) -> None:
        z.percent = percent_of(z.count, z.capacity)
        z.level = level_for(z.percent, self.settings.thresholds)

    def _add(self, zone_id: str, delta: int, source: str, at_ms: int) -> ZoneState | None:
        if zone_id == "outside":  # the pseudo zone absorbs any value (rule 2)
            return None
        z = self.zones[zone_id]
        new = z.count + delta
        if new < 0:  # rule 3: clamp at zero and record drift
            z.drift += -new
            new = 0
        z.count = new
        z.source = source
        z.updated_at_ms = at_ms
        self._recompute(z)
        return z

    def apply_crossing(
        self, link_id: str, direction: str, count: int, source: str, at_ms: int
    ) -> list[ZoneState]:
        """Rule 1: ``in`` moves people from the link's ``from`` zone to its ``to`` zone."""
        lk = self.links[link_id]
        n = count * self.settings.station(self.station.id).scale_factor
        src, dst = (lk.from_zone, lk.to_zone) if direction == "in" else (lk.to_zone, lk.from_zone)
        (lk.flow_in if direction == "in" else lk.flow_out).append((at_ms, n))
        changed = [z for z in (self._add(src, -n, source, at_ms), self._add(dst, n, source, at_ms)) if z]
        return changed

    def apply_boarding(
        self, platform_id: str, train_load: int, alight_share: float, at_ms: int
    ) -> tuple[ZoneState, int, int]:
        """Rule 5 and the boarding rule in section 13. Returns (zone, alighted, boarded)."""
        z = self.zones[platform_id]
        capacity = self.settings.train.capacity
        load = max(0, min(train_load, capacity))
        alighting = round(load * max(0.0, min(1.0, alight_share)))
        spare = capacity - (load - alighting)
        boarding = max(0, min(z.count, spare))
        self._add(platform_id, alighting - boarding, "sim", at_ms)
        return z, alighting, boarding

    def recalibrate(self, zone_id: str, count: int, at_ms: int) -> ZoneState:
        """OCC-06: an operator states the true count."""
        z = self.zones[zone_id]
        z.count = max(0, int(count))
        z.updated_at_ms = at_ms
        self._recompute(z)
        return z

    def set_zone_availability(self, zone_id: str, available: bool, reason: str | None, at_ms: int) -> ZoneState:
        z = self.zones[zone_id]
        z.available = available
        z.reason = None if available else (reason or "Closed")
        z.updated_at_ms = at_ms
        return z

    def set_link_availability(self, link_id: str, available: bool, reason: str | None) -> LinkState:
        lk = self.links[link_id]
        lk.available = available
        lk.reason = None if available else (reason or "Out of service")
        return lk

    def set_estimated(self, zone_ids: set[str], estimated: bool, at_ms: int) -> list[ZoneState]:
        changed = []
        for zid in zone_ids:
            z = self.zones[zid]
            if z.estimated != estimated:
                z.estimated = estimated
                z.updated_at_ms = at_ms
                changed.append(z)
        return changed

    def refresh(self, at_ms: int) -> list[ZoneState]:
        """Re-apply capacities and thresholds after an admin change (ADM-03)."""
        changed = []
        for zdef in self.station.d.zones:
            z = self.zones[zdef.id]
            before = (z.capacity, z.level, z.percent)
            z.capacity = self._capacity(z.id, zdef.capacity)
            self._recompute(z)
            if before != (z.capacity, z.level, z.percent):
                z.updated_at_ms = at_ms
                changed.append(z)
        return changed

    def reset(self, at_ms: int) -> list[ZoneState]:
        """End of service: every count returns to zero (section 13)."""
        for z in self.zones.values():
            z.count = 0
            z.drift = 0
            z.updated_at_ms = at_ms
            self._recompute(z)
        return list(self.zones.values())

    def totals(self) -> tuple[int, int]:
        public = [z for z in self.zones.values() if z.public]
        return sum(z.count for z in public), sum(z.capacity for z in public)
