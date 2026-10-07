"""Alert rules (ALT-01 to ALT-05, section 13).

The book holds every alert. Rules call ``raise_alert`` with a stable key, so the same
condition never produces two open alerts, and ``clear`` resolves by key.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Callable

from aera_twin.config import Settings

OPEN = ("active", "acknowledged")


@dataclass
class Alert:
    id: str
    key: str
    station_id: str
    type: str
    severity: str
    title: str
    message: str
    public_message: str | None
    started_at_ms: int
    zone_id: str | None = None
    link_id: str | None = None
    device_id: str | None = None
    state: str = "active"
    occurrences: int = 1
    acked_by: str | None = None
    acked_at_ms: int | None = None
    resolved_by: str | None = None
    resolved_at_ms: int | None = None
    updated_at_ms: int = 0

    @property
    def is_open(self) -> bool:
        return self.state in OPEN

    def to_dict(self, public: bool = False) -> dict:
        if public:
            return {
                "id": self.id,
                "station_id": self.station_id,
                "type": self.type,
                "severity": self.severity,
                "state": self.state,
                "message": self.public_message,
                "zone_id": self.zone_id,
                "link_id": self.link_id,
                "started_at_ms": self.started_at_ms,
                "resolved_at_ms": self.resolved_at_ms,
            }
        return {k: v for k, v in self.__dict__.items()}


Listener = Callable[[Alert], None]


class AlertBook:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.alerts: dict[str, Alert] = {}
        self._open_by_key: dict[str, str] = {}
        self.listeners: list[Listener] = []

    def _emit(self, a: Alert) -> None:
        for fn in self.listeners:
            fn(a)

    def open_for(self, key: str) -> Alert | None:
        aid = self._open_by_key.get(key)
        return self.alerts.get(aid) if aid else None

    def raise_alert(
        self, key: str, *, station_id: str, type: str, title: str, message: str,
        public_message: str | None, at_ms: int, severity_key: str | None = None,
        zone_id: str | None = None, link_id: str | None = None, device_id: str | None = None,
    ) -> Alert:
        existing = self.open_for(key)
        if existing:
            existing.occurrences += 1
            existing.updated_at_ms = at_ms
            self._emit(existing)
            return existing
        a = Alert(
            id=uuid.uuid4().hex[:12], key=key, station_id=station_id, type=type,
            severity=self.settings.alerts.severity.get(severity_key or type, "medium"),
            title=title, message=message, public_message=public_message, started_at_ms=at_ms,
            zone_id=zone_id, link_id=link_id, device_id=device_id, updated_at_ms=at_ms,
        )
        self.alerts[a.id] = a
        self._open_by_key[key] = a.id
        self._emit(a)
        return a

    def clear(self, key: str, at_ms: int, by: str = "system") -> Alert | None:
        a = self.open_for(key)
        if a:
            self._resolve(a, at_ms, by)
        return a

    def _resolve(self, a: Alert, at_ms: int, by: str) -> None:
        a.state = "resolved"
        a.resolved_by = by
        a.resolved_at_ms = at_ms
        a.updated_at_ms = at_ms
        self._open_by_key.pop(a.key, None)
        self._emit(a)

    def acknowledge(self, alert_id: str, by: str, at_ms: int) -> Alert:
        a = self.alerts[alert_id]
        if a.state == "active":
            a.state = "acknowledged"
            a.acked_by = by
            a.acked_at_ms = at_ms
            a.updated_at_ms = at_ms
            self._emit(a)
        return a

    def resolve(self, alert_id: str, by: str, at_ms: int) -> Alert:
        a = self.alerts[alert_id]
        if a.is_open:
            self._resolve(a, at_ms, by)
        return a

    def list(self, station_id: str | None = None, open_only: bool = False, limit: int = 200) -> list[Alert]:
        items = [
            a for a in self.alerts.values()
            if (station_id is None or a.station_id == station_id) and (not open_only or a.is_open)
        ]
        items.sort(key=lambda a: a.started_at_ms, reverse=True)
        return items[:limit]


@dataclass
class _ZoneWatch:
    above_since: int | None = None
    below_since: int | None = None
    armed: bool = True


@dataclass
class CrowdingRule:
    """ALT-01: crowded for the hold time raises, below busy for the clear time resolves."""

    book: AlertBook
    settings: Settings
    watches: dict[str, _ZoneWatch] = field(default_factory=dict)

    @staticmethod
    def key(station_id: str, zone_id: str) -> str:
        return f"crowding:{station_id}:{zone_id}"

    def observe(self, station_id: str, zone_id: str, percent: float, at_ms: int) -> None:
        t = self.settings.thresholds
        w = self.watches.setdefault(self.key(station_id, zone_id), _ZoneWatch())
        if percent >= t.crowded:
            w.above_since = w.above_since if w.above_since is not None else at_ms
            w.below_since = None
        else:
            w.above_since = None
            w.armed = True  # a manually resolved alert may fire again after the zone recovers
            if percent < t.busy:
                w.below_since = w.below_since if w.below_since is not None else at_ms
            else:
                w.below_since = None

    def evaluate(self, station_id: str, zone_id: str, zone_name: str, at_ms: int) -> None:
        key = self.key(station_id, zone_id)
        w = self.watches.get(key)
        if not w:
            return
        a = self.settings.alerts
        open_alert = self.book.open_for(key)
        if open_alert is None:
            if w.armed and w.above_since is not None and at_ms - w.above_since >= a.crowd_hold_s * 1000:
                self.book.raise_alert(
                    key, station_id=station_id, type="crowding", zone_id=zone_id, at_ms=at_ms,
                    title=f"{zone_name} crowded",
                    message=f"{zone_name} has been at or above {self.settings.thresholds.crowded:g}% "
                            f"for {a.crowd_hold_s:g} seconds.",
                    public_message=f"{zone_name} is very crowded right now. "
                                   "Allow extra time or wait for the next train.",
                )
                w.armed = False
        elif w.below_since is not None and at_ms - w.below_since >= a.crowd_clear_s * 1000:
            self.book.clear(key, at_ms)

    def on_manual_resolve(self, key: str) -> None:
        if key in self.watches:
            self.watches[key].armed = False
