"""Durable records: settings, users, devices, incidents and the audit log.

Delivery 1 keeps these in memory and snapshots them to ``var/state.json`` so a restart keeps
configuration. The Supabase adapter replaces this class in the persistence step (§11.7).
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field

from aera_twin.config import Settings
from aera_twin.paths import VAR_DIR

log = logging.getLogger(__name__)

Role = Literal["operator", "admin"]


class User(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    email: str
    display_name: str
    role: Role
    station_id: str | None = None
    password_hash: str
    active: bool = True

    def public(self) -> dict:
        return self.model_dump(exclude={"password_hash"})


class Device(BaseModel):
    id: str
    station_id: str
    name: str
    kind: Literal["esp32", "sim", "other"] = "esp32"
    position: str | None = None
    retired: bool = False
    registered_at_ms: int = 0
    # Live health, kept here so the admin list survives restarts.
    status: Literal["online", "offline", "unknown"] = "unknown"
    reported_state: Literal["online", "offline"] | None = None
    last_seen_ms: int | None = None
    rssi: int | None = None
    firmware: str | None = None
    uptime_s: int | None = None
    ever_online: bool = False

    @property
    def is_sim(self) -> bool:
        return self.kind == "sim"


class Incident(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    station_id: str
    zone_id: str | None = None
    type: Literal["crowding", "equipment", "safety", "medical", "security", "service", "other"]
    description: str = Field(min_length=1, max_length=2000)
    alert_id: str | None = None
    created_by: str
    created_at_ms: int


class AuditEntry(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    actor: str
    action: str
    target: str
    station_id: str | None = None
    before: Any = None
    after: Any = None
    ts_ms: int


class Store:
    def __init__(self, persist: bool = True, path=None):
        self.persist = persist
        self.path = path or VAR_DIR / "state.json"
        self.settings = Settings()
        self.users: dict[str, User] = {}
        self.devices: dict[str, Device] = {}
        self.incidents: list[Incident] = []
        self.audit: list[AuditEntry] = []

    def load(self) -> None:
        if not (self.persist and self.path.exists()):
            return
        try:
            raw = json.loads(self.path.read_text())
            self.settings = Settings.model_validate(raw.get("settings", {}))
            self.users = {u["id"]: User.model_validate(u) for u in raw.get("users", [])}
            self.devices = {d["id"]: Device.model_validate(d) for d in raw.get("devices", [])}
            self.incidents = [Incident.model_validate(i) for i in raw.get("incidents", [])]
            self.audit = [AuditEntry.model_validate(a) for a in raw.get("audit", [])]
        except Exception:  # a corrupt snapshot must never stop the twin from starting
            log.exception("could not read %s, starting from defaults", self.path)

    def save(self) -> None:
        if not self.persist:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "settings": self.settings.model_dump(),
            "users": [u.model_dump() for u in self.users.values()],
            "devices": [d.model_dump() for d in self.devices.values()],
            "incidents": [i.model_dump() for i in self.incidents[-2000:]],
            "audit": [a.model_dump() for a in self.audit[-5000:]],
        }
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1))
        os.replace(tmp, self.path)

    def user_by_email(self, email: str) -> User | None:
        email = email.strip().lower()
        return next((u for u in self.users.values() if u.email == email), None)

    def record(self, actor: str, action: str, target: str, at_ms: int, *, station_id: str | None = None,
               before: Any = None, after: Any = None) -> AuditEntry:
        entry = AuditEntry(actor=actor, action=action, target=target, station_id=station_id,
                           before=before, after=after, ts_ms=at_ms)
        self.audit.append(entry)
        return entry
