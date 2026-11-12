"""Postgres persistence (Supabase) for the durable records: settings, users, devices,
incidents and the audit log (§11.7).

Used when ``AERA_DATABASE_URL`` is set; otherwise :class:`~aera_twin.store.Store` keeps its
JSON snapshot in ``var/state.json`` (local development and tests). The twin keeps working from
memory as before: ``load`` reads every table once at start-up, and ``save`` hands a snapshot to
a background thread that writes only the rows that changed, so a slow or briefly unreachable
database never holds up the one-second simulation tick.

The tables live in their own ``aera`` schema (``backend/db/schema.sql``), which Supabase does not
expose through its public REST API, and the service connects as its own ``aera_backend`` role.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any

from aera_twin.config import Settings
from aera_twin.store import AuditEntry, Device, Incident, Store, User

log = logging.getLogger(__name__)

# Rows kept in memory and written, as in the JSON store.
MAX_INCIDENTS = 2000
MAX_AUDIT = 5000


def _dump(v: Any) -> str:
    return json.dumps(v, sort_keys=True, default=str)


class PgStore(Store):
    """Same interface as :class:`Store`, backed by Postgres."""

    def __init__(self, dsn: str, persist: bool = True):
        super().__init__(persist=persist)
        self.dsn = dsn
        # What the database holds, as JSON per row, so a save writes only what changed.
        self._written: dict[str, dict[str, str]] = {"settings": {}, "users": {}, "devices": {}}
        self._appended: dict[str, set[str]] = {"incidents": set(), "audit": set()}
        # One pending snapshot at most (only the newest matters) and one writer thread.
        self._cv = threading.Condition()
        self._pending: dict | None = None
        self._busy = False
        self._worker: threading.Thread | None = None

    # ------------------------------------------------------------------ connection

    def _connect(self):
        import psycopg  # imported here so the JSON store and tests do not need the driver

        # Supabase's pooler (Supavisor) in session mode; prepared statements are fine there,
        # but a short connect timeout keeps a dead database from stalling start-up.
        return psycopg.connect(self.dsn, connect_timeout=10, autocommit=False)

    # ------------------------------------------------------------------ load

    def load(self) -> None:
        if not self.persist:
            return
        try:
            with self._connect() as conn, conn.cursor() as cur:
                cur.execute("select data from aera.settings where id = 1")
                row = cur.fetchone()
                if row:
                    self.settings = Settings.model_validate(row[0])
                    self._written["settings"]["1"] = _dump(self.settings.model_dump())
                cur.execute("select id, email, display_name, role, station_id, password_hash, active from aera.users")
                for r in cur.fetchall():
                    u = User(id=r[0], email=r[1], display_name=r[2], role=r[3], station_id=r[4], password_hash=r[5], active=r[6])
                    self.users[u.id] = u
                    self._written["users"][u.id] = _dump(u.model_dump())
                cur.execute("select data from aera.devices")
                for (data,) in cur.fetchall():
                    d = Device.model_validate(data)
                    self.devices[d.id] = d
                    self._written["devices"][d.id] = _dump(d.model_dump())
                cur.execute(
                    "select id, station_id, zone_id, type, description, alert_id, created_by, created_at_ms "
                    "from aera.incidents order by created_at_ms desc limit %s", (MAX_INCIDENTS,))
                self.incidents = [
                    Incident(id=r[0], station_id=r[1], zone_id=r[2], type=r[3], description=r[4], alert_id=r[5],
                             created_by=r[6], created_at_ms=r[7])
                    for r in reversed(cur.fetchall())
                ]
                cur.execute(
                    "select id, actor, action, target, station_id, before, after, ts_ms "
                    "from aera.audit_log order by ts_ms desc limit %s", (MAX_AUDIT,))
                self.audit = [
                    AuditEntry(id=r[0], actor=r[1], action=r[2], target=r[3], station_id=r[4], before=r[5], after=r[6], ts_ms=r[7])
                    for r in reversed(cur.fetchall())
                ]
            self._appended["incidents"] = {i.id for i in self.incidents}
            self._appended["audit"] = {a.id for a in self.audit}
            log.info("loaded %d users, %d incidents, %d audit entries from Postgres",
                     len(self.users), len(self.incidents), len(self.audit))
        except Exception:  # like the JSON store: a database problem must not stop the twin starting
            log.exception("could not read from Postgres, starting from defaults")

    # ------------------------------------------------------------------ save

    def save(self) -> None:
        if not self.persist:
            return
        snapshot = {
            "settings": {"1": self.settings.model_dump()},
            "users": {u.id: u.model_dump() for u in self.users.values()},
            "devices": {d.id: d.model_dump() for d in self.devices.values()},
            "incidents": [i.model_dump() for i in self.incidents[-MAX_INCIDENTS:]],
            "audit": [a.model_dump() for a in self.audit[-MAX_AUDIT:]],
        }
        with self._cv:
            self._pending = snapshot  # replaces one still waiting
            self._cv.notify()
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._run, name="aera-pg-writer", daemon=True)
                self._worker.start()

    def flush(self, timeout: float = 15.0) -> None:
        """Write anything pending now and wait for a write in progress (shutdown and tests)."""
        with self._cv:
            snapshot, self._pending = self._pending, None
            if snapshot is not None:
                self._busy = True
        if snapshot is not None:
            try:
                self._write(snapshot)
            except Exception:
                log.exception("could not write to Postgres")
            finally:
                with self._cv:
                    self._busy = False
                    self._cv.notify_all()
        with self._cv:
            self._cv.wait_for(lambda: not self._busy, timeout=timeout)

    def _run(self) -> None:
        while True:
            with self._cv:
                if not self._cv.wait_for(lambda: self._pending is not None, timeout=60):
                    return  # idle a minute: the next save starts a new thread
                snapshot, self._pending = self._pending, None
                self._busy = True
            try:
                self._write(snapshot)
            except Exception:
                log.exception("could not write to Postgres; will retry with the next save")
            finally:
                with self._cv:
                    self._busy = False
                    self._cv.notify_all()

    def _write(self, snap: dict) -> None:
        changed = {
            kind: {k: v for k, v in snap[kind].items() if self._written[kind].get(k) != _dump(v)}
            for kind in ("settings", "users", "devices")
        }
        gone_users = set(self._written["users"]) - set(snap["users"])
        gone_devices = set(self._written["devices"]) - set(snap["devices"])
        new_incidents = [i for i in snap["incidents"] if i["id"] not in self._appended["incidents"]]
        new_audit = [a for a in snap["audit"] if a["id"] not in self._appended["audit"]]
        if not (any(changed.values()) or gone_users or gone_devices or new_incidents or new_audit):
            return
        from psycopg.types.json import Jsonb

        with self._connect() as conn, conn.cursor() as cur:
            for v in changed["settings"].values():
                cur.execute("insert into aera.settings (id, data) values (1, %s) "
                            "on conflict (id) do update set data = excluded.data, updated_at = now()", (Jsonb(v),))
            for u in changed["users"].values():
                cur.execute(
                    "insert into aera.users (id, email, display_name, role, station_id, password_hash, active) "
                    "values (%(id)s, %(email)s, %(display_name)s, %(role)s, %(station_id)s, %(password_hash)s, %(active)s) "
                    "on conflict (id) do update set email = excluded.email, display_name = excluded.display_name, "
                    "role = excluded.role, station_id = excluded.station_id, password_hash = excluded.password_hash, "
                    "active = excluded.active, updated_at = now()", u)
            for uid in gone_users:
                cur.execute("delete from aera.users where id = %s", (uid,))
            for d in changed["devices"].values():
                cur.execute("insert into aera.devices (id, data) values (%s, %s) "
                            "on conflict (id) do update set data = excluded.data, updated_at = now()", (d["id"], Jsonb(d)))
            for did in gone_devices:
                cur.execute("delete from aera.devices where id = %s", (did,))
            for i in new_incidents:
                cur.execute(
                    "insert into aera.incidents (id, station_id, zone_id, type, description, alert_id, created_by, created_at_ms) "
                    "values (%(id)s, %(station_id)s, %(zone_id)s, %(type)s, %(description)s, %(alert_id)s, %(created_by)s, %(created_at_ms)s) "
                    "on conflict (id) do nothing", i)
            for a in new_audit:
                cur.execute(
                    "insert into aera.audit_log (id, actor, action, target, station_id, before, after, ts_ms) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict (id) do nothing",
                    (a["id"], a["actor"], a["action"], a["target"], a["station_id"], Jsonb(a["before"]), Jsonb(a["after"]), a["ts_ms"]))
            conn.commit()
        for kind in ("settings", "users", "devices"):
            for k, v in changed[kind].items():
                self._written[kind][k] = _dump(v)
        for uid in gone_users:
            self._written["users"].pop(uid, None)
        for did in gone_devices:
            self._written["devices"].pop(did, None)
        self._appended["incidents"].update(i["id"] for i in new_incidents)
        self._appended["audit"].update(a["id"] for a in new_audit)
