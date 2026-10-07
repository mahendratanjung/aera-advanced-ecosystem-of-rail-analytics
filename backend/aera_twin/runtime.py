"""The twin service runtime: the loop in section 8.5.

1. A message arrives from the scale model or the simulator.
2. It is validated and applied to the zones on either side of the link.
3. The new state is broadcast to every browser.
4. Browsers animate the change (ripple, recolour).
5. Rules check thresholds and raise alerts.
6. A command goes back to the model for its LEDs and display.

The runtime is the single writer of twin state (section 11.3.2).
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime

from aera_twin.auth import can_access_station, seed_users
from aera_twin.bus import make_bus
from aera_twin.config import Env, Settings, SourceMode
from aera_twin.contracts import CrossingEvent, Status, SwitchEvent, Telemetry, TrainEvent
from aera_twin.engine.occupancy import OccupancyEngine, ZoneState
from aera_twin.history import ZoneHistory
from aera_twin.ingest.validator import IngestResult, Validator, is_sim_device
from aera_twin.levels import level_for, percent_of
from aera_twin.realtime import Hub
from aera_twin.rules.alerts import Alert, AlertBook, CrowdingRule
from aera_twin.simclock import SimClock, wall_ms
from aera_twin.simulator.hero import StationSimulator, iso
from aera_twin.simulator.network import summary as network_summary
from aera_twin.simulator.scenarios import SCENARIOS, Scenario
from aera_twin.station import StationModel, load_stations
from aera_twin.store import Device, Incident, Store, User
from aera_twin.timetable import KL_TZ, Disruption, Line, load_line, local_hour

log = logging.getLogger(__name__)
TICK_S = 1.0
LEVEL_WORDS = {"low": "clear", "moderate": "moderate", "busy": "busy", "crowded": "crowded"}


class Twin:
    def __init__(self, env: Env, store: Store | None = None, stations: dict[str, StationModel] | None = None):
        self.env = env
        self.store = store or Store(persist=env.persist)
        self.store.load()
        self.stations = stations if stations is not None else load_stations()
        line_ids = {st.d.line_id for st in self.stations.values()} or {"KJ"}
        self.lines: dict[str, Line] = {lid: load_line(lid) for lid in line_ids}
        self.line = self.lines["KJ"] if "KJ" in self.lines else next(iter(self.lines.values()))
        seed_users(self.store, env.admin_password, env.operator_password, next(iter(self.stations), None))

        self.clock = SimClock()
        if env.sim_start and env.sim_start != "now":
            self.clock.jump_to_local_time(env.sim_start)
        self.disruptions: list[Disruption] = []
        self.scenario: Scenario = SCENARIOS["normal"]
        self.scenario_started_ms = wall_ms()

        self.engines = {sid: OccupancyEngine(st, self.settings) for sid, st in self.stations.items()}
        self.simulators = {sid: StationSimulator(st, env.seed) for sid, st in self.stations.items()}
        self.validator = Validator(self.stations, self.settings)
        self.book = AlertBook(self.settings)
        self.crowding = CrowdingRule(self.book, self.settings)
        self.history = ZoneHistory()
        self.hub = Hub()
        self.bus = make_bus(env.mqtt_url)
        self.environment: dict[str, dict] = {}
        self.platform_trains: dict[str, dict[str, bool]] = {}
        self.boarded_trips: dict[str, set[str]] = {sid: set() for sid in self.stations}
        self.last_command: dict[str, dict] = {}
        self._last_cmd_sig: dict[str, str] = {}
        self._reset_day: dict[str, int] = {}
        self._task: asyncio.Task | None = None
        self._last_tick_ms = wall_ms()
        self._tick_n = 0
        self.book.listeners.append(self._on_alert)
        self._seed_devices()
        self.store.save()

    @property
    def settings(self) -> Settings:
        return self.store.settings

    # ---- lifecycle ---------------------------------------------------------------------

    async def start(self) -> None:
        await self.bus.start(self.handle_message)
        now = wall_ms()
        for sim in self.simulators.values():
            topic, payload = sim.status(now)
            await self.bus.publish(topic, payload, retain=True)
        self._task = asyncio.create_task(self._loop())
        log.info("twin running with %d twin station(s), bus=%s", len(self.stations), self.bus.name)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        await self.bus.stop()
        self.store.save()

    async def _loop(self) -> None:
        while True:
            started = time.monotonic()
            try:
                await self.tick()
            except Exception:
                log.exception("tick failed")
            await asyncio.sleep(max(0.05, TICK_S - (time.monotonic() - started)))

    # ---- devices -----------------------------------------------------------------------

    def _seed_devices(self) -> None:
        now = wall_ms()
        for sid, st in self.stations.items():
            for dev_id, sensors in st.devices.items():
                if dev_id not in self.store.devices:
                    self.store.devices[dev_id] = Device(
                        id=dev_id, station_id=sid, name=f"Scale model controller {dev_id}",
                        position=", ".join(s.sensor_id for s in sensors), registered_at_ms=now)
            sim_id = self.simulators[sid].device_id
            self.store.devices.setdefault(sim_id, Device(
                id=sim_id, station_id=sid, name=f"Simulator for {st.d.name}", kind="sim",
                position="all sensors", registered_at_ms=now))
        for d in self.store.devices.values():
            d.status = "unknown" if not d.is_sim else d.status

    def device_dict(self, d: Device) -> dict:
        return d.model_dump()

    def _device_online(self, dev_id: str) -> bool:
        d = self.store.devices.get(dev_id)
        return bool(d and d.status == "online")

    def _touch_device(self, r: IngestResult, now: int) -> Device:
        d = self.store.devices.get(r.device_id)
        if d is None:  # unknown hardware is visible to admins but never trusted for counts
            d = Device(id=r.device_id, station_id=r.station_id, name=r.device_id,
                       kind="sim" if is_sim_device(r.device_id) else "other", registered_at_ms=now)
            self.store.devices[d.id] = d
        d.last_seen_ms = now
        return d

    def _set_device_status(self, d: Device, status: str, now: int) -> None:
        if d.status == status:
            return
        d.status = status
        st = self.stations.get(d.station_id)
        if status == "online":
            d.ever_online = True
            self.book.clear(f"device_offline:{d.station_id}:{d.id}", now)
        elif d.ever_online and not d.retired:
            self.book.raise_alert(
                f"device_offline:{d.station_id}:{d.id}", station_id=d.station_id, type="device_offline",
                device_id=d.id, at_ms=now, title=f"{d.name} offline",
                message=f"No heartbeat from {d.id} within {self.settings.alerts.heartbeat_s:g} s. "
                        "Dependent zones are running on estimated data.",
                public_message=None)
        if st:
            self._refresh_estimated(st.id, now)
        self.hub.broadcast({"type": "device", "device": self.device_dict(d)})

    def _refresh_estimated(self, station_id: str, now: int) -> None:
        st = self.stations[station_id]
        mode = self.settings.station(station_id).source_mode
        estimated: set[str] = set()
        if mode == "device":
            for dev_id in st.devices:
                d = self.store.devices.get(dev_id)
                if not d or d.retired or d.status != "online":
                    estimated |= st.zones_for_device(dev_id)
        eng = self.engines[station_id]
        changed = eng.set_estimated(estimated, True, now) + eng.set_estimated(set(eng.zones) - estimated, False, now)
        self._broadcast_zones(station_id, changed)

    def _check_health(self, now: int) -> None:
        window = self.settings.alerts.heartbeat_s * 1000
        for d in self.store.devices.values():
            if d.retired:
                continue
            fresh = d.last_seen_ms is not None and now - d.last_seen_ms <= window
            online = fresh and d.reported_state != "offline"
            if online:
                self._set_device_status(d, "online", now)
            elif d.status == "online" or (d.status == "unknown" and d.ever_online):
                self._set_device_status(d, "offline", now)

    def covered_by_sim(self, station_id: str) -> set[str]:
        """Sensors the simulator should drive under the station's source mode (section 9.8)."""
        st = self.stations[station_id]
        mode = self.settings.station(station_id).source_mode
        crossing = {s.sensor_id: s.device_id for s in st.d.sensors if s.kind == "crossing"}
        if mode == "sim":
            return set(crossing)
        if mode == "mixed":
            return {sid for sid, dev in crossing.items() if not self._device_online(dev)}
        return set()

    # ---- inbound messages --------------------------------------------------------------

    async def handle_message(self, topic: str, payload: bytes) -> None:
        now = wall_ms()
        r = self.validator.validate(topic, payload, now)
        if r.station_id in self.stations and r.device_id and r.reason != "malformed":
            d = self._touch_device(r, now)
        else:
            d = None
        if not r.accepted:
            if r.abnormal and d is not None:
                self.book.raise_alert(
                    f"abnormal:{r.station_id}:{r.device_id}", station_id=r.station_id, type="abnormal",
                    device_id=r.device_id, at_ms=now, title=f"Abnormal data from {r.device_id}",
                    message=f"Rejected: {r.reason} ({r.detail}).", public_message=None)
            return
        assert d is not None
        msg = r.message
        if isinstance(msg, Status):
            d.reported_state = msg.state
            d.firmware = msg.fw or d.firmware
            self._set_device_status(d, msg.state, now)
        elif isinstance(msg, Telemetry):
            d.rssi = msg.rssi if msg.rssi is not None else d.rssi
            d.uptime_s = msg.uptime_s if msg.uptime_s is not None else d.uptime_s
            if msg.readings:
                env = self.environment.setdefault(r.station_id, {})
                for reading in msg.readings:
                    env[reading.type] = {"value": reading.value, "sensor_id": reading.sensor_id,
                                         "source": r.source, "ts_ms": now}
                self.hub.broadcast({"type": "environment", "station_id": r.station_id, "readings": env})
        if not isinstance(msg, Status) and d.status != "online" and d.reported_state != "offline":
            self._set_device_status(d, "online", now)  # any accepted message proves the device is alive
        if isinstance(msg, CrossingEvent):
            self._apply_crossing(r, msg, now)
        elif isinstance(msg, SwitchEvent):
            sensor = self.stations[r.station_id].sensors[msg.sensor_id]
            actor = f"device:{r.device_id}"
            if sensor.link:
                self.set_link_availability(r.station_id, sensor.link, msg.state, "Reported out of service by sensor", actor)
            elif sensor.zone:
                self.set_zone_availability(r.station_id, sensor.zone, msg.state, "Reported closed by sensor", actor)
        elif isinstance(msg, TrainEvent):
            sensor = self.stations[r.station_id].sensors[msg.sensor_id]
            self.platform_trains.setdefault(r.station_id, {})[sensor.zone or ""] = msg.present
            self.hub.broadcast({"type": "platform_train", "station_id": r.station_id, "zone_id": sensor.zone,
                                "present": msg.present, "source": r.source})

    def _apply_crossing(self, r: IngestResult, msg: CrossingEvent, now: int) -> None:
        st = self.stations[r.station_id]
        sensor = st.sensors[msg.sensor_id]
        mode = self.settings.station(r.station_id).source_mode
        if r.source == "sim" and msg.sensor_id not in self.covered_by_sim(r.station_id):
            self.validator.rejected["source_mode"] += 1
            return
        if r.source == "device" and mode == "sim":
            self.validator.rejected["source_mode"] += 1
            return
        eng = self.engines[r.station_id]
        changed = eng.apply_crossing(sensor.link, msg.direction, msg.count, r.source, now)  # type: ignore[arg-type]
        for z in changed:
            self.crowding.observe(r.station_id, z.id, z.percent, now)
        self._broadcast_zones(r.station_id, changed)
        self.hub.broadcast({
            "type": "sensor_event", "station_id": r.station_id, "sensor_id": msg.sensor_id,
            "link_id": sensor.link, "device_id": r.device_id, "direction": msg.direction, "count": msg.count,
            "source": r.source, "device_ts": msg.ts.isoformat(), "received_ms": now,
        })

    # ---- tick ---------------------------------------------------------------------------

    async def tick(self) -> None:
        now = wall_ms()
        real_dt = max(0.0, (now - self._last_tick_ms) / 1000)
        self._last_tick_ms = now
        self._tick_n += 1
        sim_ms = self.clock.now_ms(now)
        speed = 0.0 if self.clock.paused else self.clock.speed

        self._check_health(now)
        self._expire_disruptions(sim_ms)

        for sid, sim in self.simulators.items():
            msgs = sim.tick(self.engines[sid], now, sim_ms, real_dt, speed, self.scenario.demand_mult,
                            self.covered_by_sim(sid))
            for topic, payload in msgs:
                await self.bus.publish(topic, payload)

        for sid in self.stations:
            self._boarding(sid, sim_ms, now)
            self._end_of_service(sid, sim_ms, now)
            eng = self.engines[sid]
            for z in eng.zones.values():
                self.crowding.observe(sid, z.id, z.percent, now)
                self.crowding.evaluate(sid, z.id, z.name, now)
                self.history.observe(f"{sid}:{z.id}", z.count, z.level, now)
            await self._publish_commands(sid, sim_ms, now)

        if self._tick_n % 5 == 0:
            self.hub.broadcast({"type": "stations", "stations": self.station_summaries(sim_ms)})
            for sid, eng in self.engines.items():
                self.hub.broadcast({"type": "links", "station_id": sid,
                                    "links": [lk.to_dict(now) for lk in eng.links.values()]})
        if self._tick_n % 30 == 0:
            self.hub.broadcast({"type": "clock", "clock": self.clock.to_dict()})
            self.store.save()

    def _boarding(self, station_id: str, sim_ms: int, now: int) -> None:
        """Apply the boarding rule once for each train dwelling at a twin platform (SIM-05)."""
        st = self.stations[station_id]
        s_set = self.settings.station(station_id)
        if not s_set.boarding_enabled or s_set.source_mode == "device" or self.clock.paused:
            return
        line = self.lines.get(st.d.line_id)
        if not line:
            return
        t = sim_ms / 1000
        seen = self.boarded_trips[station_id]
        for d, rows in line.next_departures(st.d.stop_id, t, self.disruptions, limit=1, horizon_s=0).items():
            for row in rows:
                if not row["at_platform"] or row["trip_id"] in seen:
                    continue
                seen.add(row["trip_id"])
                platform = st.platform_for_direction(d)
                if not platform or not self.engines[station_id].zones[platform.id].available:
                    continue
                load = round(self.settings.train.capacity * row["load_pct"] / 100)
                z, alighted, boarded = self.engines[station_id].apply_boarding(
                    platform.id, load, self.scenario.alight_share, now)
                self.simulators[station_id].on_alighting(platform.id, alighted)
                self.crowding.observe(station_id, z.id, z.percent, now)
                self._broadcast_zones(station_id, [z])
                self.hub.broadcast({"type": "boarding", "station_id": station_id, "zone_id": platform.id,
                                    "trip_id": row["trip_id"], "alighted": alighted, "boarded": boarded})
        if len(seen) > 500:
            self.boarded_trips[station_id] = set(sorted(seen)[-200:])

    def _end_of_service(self, station_id: str, sim_ms: int, now: int) -> None:
        hour = local_hour(sim_ms / 1000)
        if not (1.5 <= hour < 5.0):
            return
        day = int((sim_ms / 1000 + 8 * 3600) // 86400)
        if self._reset_day.get(station_id) == day:
            return
        self._reset_day[station_id] = day
        changed = self.engines[station_id].reset(now)
        self.simulators[station_id].reset()
        self._broadcast_zones(station_id, changed)

    def _expire_disruptions(self, sim_ms: int) -> None:
        for d in list(self.disruptions):
            if d.end_ms is not None and sim_ms >= d.end_ms + 3 * 3600 * 1000:
                self.disruptions.remove(d)
            elif d.end_ms is not None and sim_ms >= d.end_ms:
                self.book.clear(f"disruption:{d.id}", wall_ms())

    # ---- commands to the model (IOT-08) ----------------------------------------------

    def build_command(self, station_id: str, sim_ms: int) -> dict:
        st = self.stations[station_id]
        eng = self.engines[station_id]
        leds = [{"zone": z.id, "level": "nodata" if z.estimated else ("off" if not z.available else z.level)}
                for z in eng.zones.values()]
        nxt = self.line.next_departures(st.d.stop_id, sim_ms / 1000, self.disruptions, limit=1)
        upcoming = [rows[0] for rows in nxt.values() if rows]
        if upcoming:
            first = min(upcoming, key=lambda r: r["arrival"])
            mins = max(0, round((first["arrival"] - sim_ms / 1000) / 60))
            line1 = "Train arriving" if mins == 0 else f"Next train {mins} min"
        else:
            line1 = "No trains"
        worst = max((z for z in eng.zones.values() if z.type == "platform"), key=lambda z: z.percent, default=None)
        line2 = f"{worst.name[:12]} {LEVEL_WORDS[worst.level]}" if worst else ""
        return {"v": 1, "ts": iso(wall_ms()), "leds": leds, "display": {"line1": line1[:21], "line2": line2[:21]}}

    async def _publish_commands(self, station_id: str, sim_ms: int, now: int) -> None:
        cmd = self.build_command(station_id, sim_ms)
        sig = repr((cmd["leds"], cmd["display"]))
        if sig == self._last_cmd_sig.get(station_id) and self._tick_n % 30:
            return
        self._last_cmd_sig[station_id] = sig
        self.last_command[station_id] = {**cmd, "sent_ms": now}
        for d in self.store.devices.values():
            if d.station_id == station_id and not d.is_sim and not d.retired:
                await self.bus.publish(f"aera/v1/{station_id}/{d.id}/cmd", cmd, retain=True)
        self.hub.broadcast({"type": "command", "station_id": station_id, "command": self.last_command[station_id]},
                           audience="staff", station_id=station_id)

    # ---- broadcast helpers ---------------------------------------------------------------

    def _broadcast_zones(self, station_id: str, zones: list[ZoneState]) -> None:
        if zones:
            self.hub.broadcast({"type": "zones", "station_id": station_id, "zones": [z.to_dict() for z in zones]})

    def _on_alert(self, a: Alert) -> None:
        self.hub.broadcast(
            {"type": "alert", "alert": a.to_dict()}, audience="staff", station_id=a.station_id,
            public=lambda: {"type": "alert", "alert": a.to_dict(public=True)} if a.public_message else None,
        )

    # ---- read models ---------------------------------------------------------------------

    def station_summaries(self, sim_ms: int | None = None) -> list[dict]:
        sim_ms = sim_ms if sim_ms is not None else self.clock.now_ms()
        out = []
        for s in self.line.stations:
            if s["id"] in self.engines:
                eng = self.engines[s["id"]]
                count, cap = eng.totals()
                pct = percent_of(count, cap)
                mode = self.settings.station(s["id"]).source_mode
                out.append({"id": s["id"], "percent": pct, "level": level_for(pct, self.settings.thresholds),
                            "source": {"device": "device", "sim": "sim", "mixed": "mixed"}[mode],
                            "has_twin": True, "count": count, "capacity": cap})
            else:
                out.append(network_summary(s["id"], sim_ms / 1000, self.scenario.demand_mult, self.disruptions,
                                           self.settings.thresholds))
        return out

    def twin_state(self, station_id: str) -> dict:
        now = wall_ms()
        eng = self.engines[station_id]
        st = self.stations[station_id]
        covered = self.covered_by_sim(station_id)
        sensors = []
        for s in st.d.sensors:
            dev = self.store.devices.get(s.device_id)
            if s.sensor_id in covered:
                state = "sim"
            elif dev and dev.status == "online" and not dev.retired:
                state = "live"
            else:
                state = "offline"
            sensors.append({"sensor_id": s.sensor_id, "device_id": s.device_id, "kind": s.kind,
                            "link": s.link, "zone": s.zone, "state": state})
        return {
            "station_id": station_id,
            "source_mode": self.settings.station(station_id).source_mode,
            "scale_factor": self.settings.station(station_id).scale_factor,
            "zones": [z.to_dict() for z in eng.zones.values()],
            "links": [lk.to_dict(now) for lk in eng.links.values()],
            "sensors": sensors,
            "environment": self.environment.get(station_id, {}),
        }

    def sim_state(self) -> dict:
        return {
            "clock": self.clock.to_dict(),
            "scenario": {"id": self.scenario.id, "name": self.scenario.name, "started_ms": self.scenario_started_ms,
                         "demand_mult": self.scenario.demand_mult},
            "disruptions": [d.model_dump() for d in self.disruptions],
        }

    def public_settings(self) -> dict:
        s = self.settings
        return {"thresholds": s.thresholds.model_dump(), "train_capacity": s.train.capacity,
                "heartbeat_s": s.alerts.heartbeat_s}

    def visible_alerts(self, user: User | None, open_only: bool = False) -> list[dict]:
        out = []
        for a in self.book.list(open_only=open_only):
            if can_access_station(user, a.station_id):
                out.append(a.to_dict())
            elif a.public_message and a.is_open:
                out.append(a.to_dict(public=True))
        return out

    def visible_incidents(self, user: User | None, station_id: str | None = None) -> list[dict]:
        return [i.model_dump() for i in reversed(self.store.incidents)
                if can_access_station(user, i.station_id) and (station_id is None or i.station_id == station_id)][:200]

    def snapshot(self, user: User | None) -> dict:
        staff = user is not None
        snap = {
            "type": "snapshot",
            "server_now_ms": wall_ms(),
            "sim": self.sim_state(),
            "settings": self.public_settings(),
            "stations": self.station_summaries(),
            "twins": {sid: self.twin_state(sid) for sid in self.stations},
            "devices": [self.device_dict(d) for d in self.store.devices.values()],
            "alerts": self.visible_alerts(user, open_only=not staff),
            "user": user.public() if user else None,
            "bus": {"name": self.bus.name, "connected": self.bus.connected},
        }
        if staff:
            snap["incidents"] = self.visible_incidents(user)
            snap["commands"] = {sid: c for sid, c in self.last_command.items() if can_access_station(user, sid)}
        if user and user.role == "admin":
            snap["ingest"] = self.validator.stats()
        return snap

    # ---- operator actions ----------------------------------------------------------------

    def _audit(self, actor: str, action: str, target: str, station_id: str | None = None, before=None, after=None) -> None:
        entry = self.store.record(actor, action, target, wall_ms(), station_id=station_id, before=before, after=after)
        self.hub.broadcast({"type": "audit", "entry": entry.model_dump()}, audience="staff", station_id=station_id)
        self.store.save()

    def acknowledge_alert(self, alert_id: str, user: User) -> Alert:
        a = self.book.acknowledge(alert_id, user.email, wall_ms())
        self._audit(user.email, "alert.acknowledge", alert_id, a.station_id)
        return a

    def resolve_alert(self, alert_id: str, user: User) -> Alert:
        a = self.book.resolve(alert_id, user.email, wall_ms())
        if a.type == "crowding":
            self.crowding.on_manual_resolve(a.key)
        self._audit(user.email, "alert.resolve", alert_id, a.station_id)
        return a

    def log_incident(self, incident: Incident) -> Incident:
        self.store.incidents.append(incident)
        self.hub.broadcast({"type": "incident", "incident": incident.model_dump()},
                           audience="staff", station_id=incident.station_id)
        self._audit(incident.created_by, "incident.create", incident.id, incident.station_id,
                    after={"type": incident.type, "zone_id": incident.zone_id})
        return incident

    def set_zone_availability(self, station_id: str, zone_id: str, available: bool, reason: str | None, actor: str) -> ZoneState:
        eng = self.engines[station_id]
        before = eng.zones[zone_id].available
        z = eng.set_zone_availability(zone_id, available, reason, wall_ms())
        key = f"unavailable:{station_id}:zone:{zone_id}"
        if available:
            self.book.clear(key, wall_ms(), by=actor)
        else:
            self.book.raise_alert(key, station_id=station_id, type="unavailable", zone_id=zone_id, at_ms=wall_ms(),
                                  title=f"{z.name} unavailable", message=f"{z.name} marked unavailable: {z.reason}",
                                  public_message=f"{z.name} is closed. {z.reason}. Please follow staff directions.")
        self._broadcast_zones(station_id, [z])
        if before != available:
            self._audit(actor, "zone.availability", zone_id, station_id, before=before, after=available)
        return z

    def set_link_availability(self, station_id: str, link_id: str, available: bool, reason: str | None, actor: str) -> dict:
        eng = self.engines[station_id]
        before = eng.links[link_id].available
        lk = eng.set_link_availability(link_id, available, reason)
        key = f"unavailable:{station_id}:link:{link_id}"
        if available:
            self.book.clear(key, wall_ms(), by=actor)
        else:
            self.book.raise_alert(key, station_id=station_id, type="unavailable", link_id=link_id, at_ms=wall_ms(),
                                  title=f"{lk.name} unavailable", message=f"{lk.name} marked unavailable: {lk.reason}",
                                  public_message=f"{lk.name} is out of service. Please use another route.")
        data = lk.to_dict(wall_ms())
        self.hub.broadcast({"type": "links", "station_id": station_id, "links": [data]})
        if before != available:
            self._audit(actor, "link.availability", link_id, station_id, before=before, after=available)
        return data

    def recalibrate(self, station_id: str, zone_id: str, count: int, actor: str, note: str | None = None) -> ZoneState:
        eng = self.engines[station_id]
        before = eng.zones[zone_id].count
        z = eng.recalibrate(zone_id, count, wall_ms())
        self.crowding.observe(station_id, zone_id, z.percent, wall_ms())
        self._broadcast_zones(station_id, [z])
        self._audit(actor, "zone.recalibrate", zone_id, station_id, before=before, after={"count": count, "note": note})
        return z

    # ---- admin actions -------------------------------------------------------------------

    def update_settings(self, new: Settings, actor: str) -> Settings:
        before = self.settings.model_dump()
        self.store.settings = new
        for eng in self.engines.values():
            eng.settings = new
        self.validator.settings = new
        self.book.settings = new
        self.crowding.settings = new
        now = wall_ms()
        for sid, eng in self.engines.items():
            self._broadcast_zones(sid, eng.refresh(now))
            self._refresh_estimated(sid, now)
        self.hub.broadcast({"type": "settings", "settings": self.public_settings()})
        self._audit(actor, "settings.update", "settings", before=before, after=new.model_dump())
        return new

    def set_source_mode(self, station_id: str, mode: SourceMode, actor: str) -> None:
        s = self.settings.station(station_id)
        before = s.source_mode
        s.source_mode = mode
        self._refresh_estimated(station_id, wall_ms())
        self.hub.broadcast({"type": "twin", "twin": self.twin_state(station_id)})
        self.hub.broadcast({"type": "stations", "stations": self.station_summaries()})
        self._audit(actor, "station.source_mode", station_id, station_id, before=before, after=mode)

    def broadcast_sim(self) -> None:
        self.hub.broadcast({"type": "sim", "sim": self.sim_state()})

    def clock_action(self, actor: str, *, speed: float | None = None, paused: bool | None = None,
                     jump_to: str | None = None, jump_ms: int | None = None) -> dict:
        if jump_to:
            self.clock.jump_to_local_time(jump_to)
        if jump_ms is not None:
            self.clock.jump(jump_ms)
        if speed is not None:
            self.clock.set_speed(speed)
        if paused is True and not self.clock.paused:
            self.clock.pause()
        elif paused is False and self.clock.paused:
            self.clock.resume()
        self.broadcast_sim()
        self._audit(actor, "sim.clock", "clock", after={"speed": speed, "paused": paused, "jump_to": jump_to, "jump_ms": jump_ms})
        return self.sim_state()

    def add_disruption(self, d: Disruption, actor: str) -> Disruption:
        self.disruptions.append(d)
        stop = {s["id"]: s["name"] for s in self.line.stations}
        a_name = stop.get(d.stop_id, d.stop_id)
        if d.kind == "surge":
            msg = f"Trains from {a_name} are much busier than usual. Expect very crowded carriages."
        elif d.kind == "delay":
            msg = f"Trains are delayed by about {max(1, round(d.delay_s / 60))} min at {a_name}."
        elif d.kind == "hold":
            msg = f"A train is being held at {a_name}. Expect delays."
        else:
            msg = f"Service between {a_name} and {stop.get(d.to_stop_id or '', d.to_stop_id)} is suspended."
        twin_station = next(iter(self.stations), d.stop_id)
        self.book.raise_alert(
            f"disruption:{d.id}", station_id=twin_station, type="disruption",
            severity_key="disruption_suspend" if d.kind == "suspend" else "disruption",
            at_ms=wall_ms(), title=f"{'Crowd surge' if d.kind == 'surge' else 'Train ' + d.kind} at {a_name}",
            message=d.note or msg, public_message=msg)
        self.broadcast_sim()
        self._audit(actor, "sim.disruption.add", d.id, after=d.model_dump())
        return d

    def remove_disruption(self, disruption_id: str, actor: str) -> None:
        self.disruptions = [d for d in self.disruptions if d.id != disruption_id]
        self.book.clear(f"disruption:{disruption_id}", wall_ms(), by=actor)
        self.broadcast_sim()
        self._audit(actor, "sim.disruption.remove", disruption_id)

    def run_scenario(self, scenario_id: str, actor: str) -> dict:
        sc = SCENARIOS[scenario_id]
        now = wall_ms()
        if sc.reset:
            for d in list(self.disruptions):
                self.remove_disruption(d.id, actor)
            for sid, eng in self.engines.items():
                for z in eng.zones.values():
                    if not z.available:
                        self.set_zone_availability(sid, z.id, True, None, actor)
                for lk in eng.links.values():
                    if not lk.available:
                        self.set_link_availability(sid, lk.id, True, None, actor)
                self._broadcast_zones(sid, eng.reset(now))
                self.simulators[sid].reset()
            self.scenario = SCENARIOS["normal"]
        else:
            self.scenario = sc
            if sc.jump_to:
                self.clock.jump_to_local_time(sc.jump_to)
            if sc.speed:
                self.clock.set_speed(sc.speed)
            sim_ms = self.clock.now_ms()
            for tpl in sc.disruptions:
                dur = tpl.get("duration_min")
                self.add_disruption(Disruption(
                    id=uuid.uuid4().hex[:8], kind=tpl["kind"], stop_id=tpl["stop_id"],
                    to_stop_id=tpl.get("to_stop_id"), direction_id=tpl.get("direction_id"),
                    delay_s=tpl.get("delay_s", 0), multiplier=tpl.get("multiplier", 1.0), start_ms=sim_ms,
                    end_ms=sim_ms + dur * 60_000 if dur else None, note=tpl.get("note", "")), actor)
            for sid in self.stations:
                for zone_id, reason in sc.close_zones:
                    if zone_id in self.engines[sid].zones:
                        self.set_zone_availability(sid, zone_id, False, reason, actor)
                for link_id, reason in sc.close_links:
                    if link_id in self.engines[sid].links:
                        self.set_link_availability(sid, link_id, False, reason, actor)
        self.scenario_started_ms = now
        self.broadcast_sim()
        self.hub.broadcast({"type": "stations", "stations": self.station_summaries()})
        self._audit(actor, "sim.scenario", scenario_id)
        return self.sim_state()

    def local_time(self) -> str:
        return datetime.fromtimestamp(self.clock.now_ms() / 1000, KL_TZ).strftime("%Y-%m-%d %H:%M:%S")
