"""HTTP and WebSocket API (section 11.6).

Public endpoints expose only passenger-safe data. Operator endpoints are scoped to the
operator's station (OPS-02). Admin endpoints require the admin role.
"""

from __future__ import annotations

import hmac
import uuid
from dataclasses import asdict
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Request, WebSocket, status
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from aera_twin.assistant import AskBody, Assistant, AssistantError
from aera_twin.auth import (
    current_user,
    ensure_station,
    hash_password,
    issue_token,
    require_admin,
    require_user,
    user_from_token,
    verify_password,
)
from aera_twin.config import Settings, SourceMode
from aera_twin.crowdsource.riders import DEVICE_PATTERN, LocationPing, RiderError, RiderReport
from aera_twin.paths import DATA_DIR, NETWORK_DIR
from aera_twin.realtime import Client
from aera_twin.runtime import Twin
from aera_twin.simclock import wall_ms
from aera_twin.simulator.scenarios import SCENARIOS
from aera_twin.store import Device, Incident, User
from aera_twin.timetable import Disruption

router = APIRouter(prefix="/api")


def twin(request: Request) -> Twin:
    return request.app.state.twin


def _station(t: Twin, station_id: str):
    if station_id not in t.stations:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No twin for station {station_id}")
    return t.stations[station_id]


# ---- public ---------------------------------------------------------------------------------


@router.get("/health")
def health(t: Twin = Depends(twin)):
    return {"ok": True, "bus": t.bus.name, "bus_connected": t.bus.connected, "sim_time": t.local_time(),
            "realtime_clients": len(t.hub.clients)}


@router.get("/lines")
def lines(t: Twin = Depends(twin)):
    return [{k: ln.data[k] for k in ("id", "name", "short_name", "color", "text_color")} for ln in t.lines.values()]


@router.get("/lines/{line_id}")
def line(line_id: str, t: Twin = Depends(twin)):
    if line_id not in t.lines:
        raise HTTPException(404, "Unknown line")
    data = dict(t.lines[line_id].data)
    data["twin_stations"] = [sid for sid, st in t.stations.items() if st.d.line_id == line_id]
    return data


@router.get("/lines/{line_id}/model")
def line_model(line_id: str):
    """Typical-week crowding model built from data.gov.my ridership (see aera_twin.ridership)."""
    path = DATA_DIR / "models" / f"{line_id}.json"
    if not path.exists():
        raise HTTPException(404, "No crowding model for this line. Run the ridership build.")
    return FileResponse(path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600"})


@router.get("/network")
def network():
    """Every Rapid Rail line with run times and estimated transfers, for the route advisor."""
    path = NETWORK_DIR / "rapid.json"
    if not path.exists():
        raise HTTPException(404, "No network file. Run npm run import:network.")
    return FileResponse(path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600"})


@router.get("/network/model")
def network_model():
    """Typical-week crowding on every other line (NETC-01), from data.gov.my ridership."""
    path = DATA_DIR / "models" / "network.json"
    if not path.exists():
        raise HTTPException(404, "No network crowding model. Run npm run model:network.")
    return FileResponse(path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600"})


@router.get("/network/trains")
def network_trains():
    """Timetables for every line except the Kelana Jaya Line, for the trains on both maps (TRAINS-01)."""
    path = NETWORK_DIR / "trains.json"
    if not path.exists():
        raise HTTPException(404, "No trains file. Run npm run import:trains.")
    return FileResponse(path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600"})


@router.get("/stations")
def stations(t: Twin = Depends(twin)):
    return t.station_summaries()


@router.get("/stations/{station_id}/definition")
def definition(station_id: str, t: Twin = Depends(twin)):
    return _station(t, station_id).raw


@router.get("/stations/{station_id}/twin")
def twin_state(station_id: str, t: Twin = Depends(twin)):
    _station(t, station_id)
    return t.twin_state(station_id)


@router.get("/stations/{station_id}/next-trains")
def next_trains(station_id: str, limit: int = 3, t: Twin = Depends(twin)):
    rows = t.line.next_departures(station_id, t.clock.now_ms() / 1000, t.disruptions, limit=max(1, min(limit, 6)))
    return {"station_id": station_id, "source": "sim", "directions": rows}


@router.get("/sim")
def sim(t: Twin = Depends(twin)):
    return t.sim_state()


@router.get("/alerts")
def alerts(open_only: bool = True, user: User | None = Depends(current_user), t: Twin = Depends(twin)):
    return t.visible_alerts(user, open_only=open_only)


@router.get("/scenarios")
def scenarios():
    return [{"id": s.id, "name": s.name, "description": s.description} for s in SCENARIOS.values() if not s.hidden]


def assistant(request: Request) -> Assistant:
    return request.app.state.assistant


@router.get("/assistant")
def assistant_status(a: Assistant = Depends(assistant)):
    """ASK-04: whether the chatbot is set up, so the browser can show the advisor alone."""
    return {"enabled": a.enabled, "model": a.model if a.enabled else None}


@router.post("/assistant")
async def ask(body: AskBody, request: Request, a: Assistant = Depends(assistant)):
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    key = forwarded or (request.client.host if request.client else "unknown")
    try:
        return await a.ask(body, key)
    except AssistantError as e:
        return JSONResponse({"detail": e.message, "code": e.code}, status_code=e.status)


@router.websocket("/ws")
async def ws(websocket: WebSocket, token: str | None = None):
    t: Twin = websocket.app.state.twin
    user = user_from_token(token, t.store, t.env.jwt_secret)
    await websocket.accept()
    await t.hub.serve(Client(websocket, user), t.snapshot(user))


# ---- auth -------------------------------------------------------------------------------------


class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/auth/login")
def login(body: LoginBody, t: Twin = Depends(twin)):
    u = t.store.user_by_email(body.email)
    if not u or not u.active or not verify_password(body.password, u.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect")
    return {"token": issue_token(u, t.env.jwt_secret), "user": u.public()}


@router.get("/auth/me")
def me(user: User = Depends(require_user)):
    return user.public()


# ---- operator ---------------------------------------------------------------------------------


@router.post("/alerts/{alert_id}/ack")
def ack(alert_id: str, user: User = Depends(require_user), t: Twin = Depends(twin)):
    a = t.book.alerts.get(alert_id) or _404("alert")
    ensure_station(user, a.station_id)
    return t.acknowledge_alert(alert_id, user).to_dict()


@router.post("/alerts/{alert_id}/resolve")
def resolve(alert_id: str, user: User = Depends(require_user), t: Twin = Depends(twin)):
    a = t.book.alerts.get(alert_id) or _404("alert")
    ensure_station(user, a.station_id)
    return t.resolve_alert(alert_id, user).to_dict()


class IncidentBody(BaseModel):
    station_id: str
    zone_id: str | None = None
    type: Literal["crowding", "equipment", "safety", "medical", "security", "service", "other"]
    description: str = Field(min_length=1, max_length=2000)
    alert_id: str | None = None


@router.get("/incidents")
def incidents(station_id: str | None = None, user: User = Depends(require_user), t: Twin = Depends(twin)):
    return t.visible_incidents(user, station_id)


@router.post("/incidents", status_code=201)
def create_incident(body: IncidentBody, user: User = Depends(require_user), t: Twin = Depends(twin)):
    ensure_station(user, body.station_id)
    if body.zone_id and body.station_id in t.stations and body.zone_id not in t.stations[body.station_id].zones:
        raise HTTPException(422, "Unknown zone")
    inc = Incident(**body.model_dump(), created_by=user.email, created_at_ms=wall_ms())
    return t.log_incident(inc).model_dump()


class AvailabilityBody(BaseModel):
    available: bool
    reason: str | None = Field(default=None, max_length=200)


@router.post("/stations/{station_id}/zones/{zone_id}/availability")
def zone_availability(station_id: str, zone_id: str, body: AvailabilityBody,
                      user: User = Depends(require_user), t: Twin = Depends(twin)):
    ensure_station(user, station_id)
    if zone_id not in _station(t, station_id).zones:
        _404("zone")
    return t.set_zone_availability(station_id, zone_id, body.available, body.reason, user.email).to_dict()


@router.post("/stations/{station_id}/links/{link_id}/availability")
def link_availability(station_id: str, link_id: str, body: AvailabilityBody,
                      user: User = Depends(require_user), t: Twin = Depends(twin)):
    ensure_station(user, station_id)
    if link_id not in _station(t, station_id).links:
        _404("link")
    return t.set_link_availability(station_id, link_id, body.available, body.reason, user.email)


class RecalibrateBody(BaseModel):
    count: int = Field(ge=0, le=100_000)
    note: str | None = Field(default=None, max_length=300)


@router.post("/stations/{station_id}/zones/{zone_id}/recalibrate")
def recalibrate(station_id: str, zone_id: str, body: RecalibrateBody,
                user: User = Depends(require_user), t: Twin = Depends(twin)):
    ensure_station(user, station_id)
    if zone_id not in _station(t, station_id).zones:
        _404("zone")
    return t.recalibrate(station_id, zone_id, body.count, user.email, body.note).to_dict()


@router.get("/stations/{station_id}/timeline")
def timeline(station_id: str, user: User = Depends(require_user), t: Twin = Depends(twin)):
    """OPS-04: alerts, incidents and operator actions for one station, newest first."""
    ensure_station(user, station_id)
    items = []
    for a in t.book.list(station_id):
        items.append({"kind": "alert", "ts_ms": a.started_at_ms, "data": a.to_dict()})
        if a.resolved_at_ms:
            items.append({"kind": "alert_resolved", "ts_ms": a.resolved_at_ms, "data": a.to_dict()})
    for i in t.store.incidents:
        if i.station_id == station_id:
            items.append({"kind": "incident", "ts_ms": i.created_at_ms, "data": i.model_dump()})
    for e in t.store.audit:
        if e.station_id == station_id:
            items.append({"kind": "action", "ts_ms": e.ts_ms, "data": e.model_dump()})
    items.sort(key=lambda x: x["ts_ms"], reverse=True)
    return items[:300]


@router.get("/stations/{station_id}/history")
def history(station_id: str, zone_id: str | None = None, minutes: int = 120,
            user: User = Depends(require_user), t: Twin = Depends(twin)):
    ensure_station(user, station_id)
    st = _station(t, station_id)
    since = wall_ms() - max(1, min(minutes, 1440)) * 60_000
    zones = [zone_id] if zone_id else list(st.zones)
    return {z: t.history.get(f"{station_id}:{z}", since) for z in zones}


# ---- admin ------------------------------------------------------------------------------------


@router.get("/admin/overview")
def overview(_: User = Depends(require_admin), t: Twin = Depends(twin)):
    devices = [d for d in t.store.devices.values() if not d.retired]
    stations = t.station_summaries()
    return {
        "devices": {"total": len(devices), "online": sum(d.status == "online" for d in devices),
                    "offline": sum(d.status == "offline" for d in devices)},
        "alerts": {"open": len(t.book.list(open_only=True)),
                   "high": sum(a.severity == "high" for a in t.book.list(open_only=True))},
        "network": {"stations": len(stations),
                    "busy_or_worse": sum(s["level"] in ("busy", "crowded") for s in stations),
                    "avg_percent": round(sum(s["percent"] for s in stations) / max(1, len(stations)), 1)},
        "ingest": t.validator.stats(),
        "bus": {"name": t.bus.name, "connected": t.bus.connected},
        "realtime_clients": len(t.hub.clients),
        "sim_time": t.local_time(),
    }


@router.get("/admin/settings")
def get_settings(_: User = Depends(require_admin), t: Twin = Depends(twin)):
    return t.settings.model_dump()


@router.put("/admin/settings")
def put_settings(body: Settings, user: User = Depends(require_admin), t: Twin = Depends(twin)):
    return t.update_settings(body, user.email).model_dump()


class SourceModeBody(BaseModel):
    mode: SourceMode


@router.put("/admin/stations/{station_id}/source-mode")
def source_mode(station_id: str, body: SourceModeBody, user: User = Depends(require_admin), t: Twin = Depends(twin)):
    _station(t, station_id)
    t.set_source_mode(station_id, body.mode, user.email)
    return t.twin_state(station_id)


@router.get("/admin/users")
def users(_: User = Depends(require_admin), t: Twin = Depends(twin)):
    return [u.public() for u in t.store.users.values()]


class UserBody(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    display_name: str = Field(min_length=1, max_length=100)
    role: Literal["operator", "admin"]
    station_id: str | None = None
    password: str | None = Field(default=None, min_length=8, max_length=200)
    active: bool = True


def _check_user_body(body: UserBody, t: Twin) -> None:
    if body.role == "operator" and not body.station_id:
        raise HTTPException(422, "Operators need an assigned station")
    if body.station_id and body.station_id not in t.line.distance:
        raise HTTPException(422, "Unknown station")


@router.post("/admin/users", status_code=201)
def create_user(body: UserBody, admin: User = Depends(require_admin), t: Twin = Depends(twin)):
    _check_user_body(body, t)
    if not body.password:
        raise HTTPException(422, "Password is required for a new user")
    if t.store.user_by_email(body.email):
        raise HTTPException(409, "A user with this email already exists")
    u = User(email=body.email.strip().lower(), display_name=body.display_name, role=body.role,
             station_id=body.station_id if body.role == "operator" else None,
             password_hash=hash_password(body.password), active=body.active)
    t.store.users[u.id] = u
    t._audit(admin.email, "user.create", u.email, after=u.public())
    return u.public()


@router.put("/admin/users/{user_id}")
def update_user(user_id: str, body: UserBody, admin: User = Depends(require_admin), t: Twin = Depends(twin)):
    _check_user_body(body, t)
    u = t.store.users.get(user_id) or _404("user")
    if u.id == admin.id and (body.role != "admin" or not body.active):
        raise HTTPException(422, "You cannot remove your own admin access")
    before = u.public()
    u.email = body.email.strip().lower()
    u.display_name = body.display_name
    u.role = body.role
    u.station_id = body.station_id if body.role == "operator" else None
    u.active = body.active
    if body.password:
        u.password_hash = hash_password(body.password)
    t._audit(admin.email, "user.update", u.email, before=before, after=u.public())
    return u.public()


@router.get("/admin/devices")
def devices(_: User = Depends(require_admin), t: Twin = Depends(twin)):
    return {"devices": [d.model_dump() for d in t.store.devices.values()],
            "ingest": t.validator.stats(),
            "commands": t.last_command,
            "outbound": [{"topic": tp, "payload": p} for tp, p in list(t.bus.outbound)[-20:]]}


class DeviceBody(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_.-]{2,40}$")
    station_id: str
    name: str = Field(min_length=1, max_length=100)
    position: str | None = Field(default=None, max_length=200)


@router.post("/admin/devices", status_code=201)
def register_device(body: DeviceBody, admin: User = Depends(require_admin), t: Twin = Depends(twin)):
    """IOT-10: register a device and assign it to a station and sensor position."""
    if body.id.startswith("sim-"):
        raise HTTPException(422, "Device ids starting with sim- are reserved for the simulator")
    existing = t.store.devices.get(body.id)
    if existing and not existing.retired:
        raise HTTPException(409, "Device already registered")
    _station(t, body.station_id)
    d = Device(id=body.id, station_id=body.station_id, name=body.name, position=body.position,
               registered_at_ms=wall_ms())
    t.store.devices[d.id] = d
    t._audit(admin.email, "device.register", d.id, body.station_id, after=d.model_dump())
    t.hub.broadcast({"type": "device", "device": d.model_dump()})
    return d.model_dump()


@router.post("/admin/devices/{device_id}/retire")
def retire_device(device_id: str, admin: User = Depends(require_admin), t: Twin = Depends(twin)):
    d = t.store.devices.get(device_id) or _404("device")
    d.retired = True
    d.status = "offline"
    t.book.clear(f"device_offline:{d.station_id}:{d.id}", wall_ms(), by=admin.email)
    t._audit(admin.email, "device.retire", d.id, d.station_id)
    t.hub.broadcast({"type": "device", "device": d.model_dump()})
    return d.model_dump()


class ClockBody(BaseModel):
    speed: float | None = Field(default=None, ge=0.25, le=120)
    paused: bool | None = None
    jump_to: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    jump_ms: int | None = None


@router.post("/admin/sim/clock")
def clock(body: ClockBody, user: User = Depends(require_admin), t: Twin = Depends(twin)):
    return t.clock_action(user.email, **body.model_dump())


class DisruptionBody(BaseModel):
    kind: Literal["delay", "hold", "suspend", "surge"]
    stop_id: str
    to_stop_id: str | None = None
    direction_id: Literal[0, 1] | None = None
    delay_s: int = Field(default=0, ge=0, le=3 * 3600)
    multiplier: float = Field(default=2.0, ge=1.1, le=6.0)
    duration_min: int | None = Field(default=None, ge=1, le=600)
    note: str = Field(default="", max_length=200)


@router.post("/admin/sim/disruptions", status_code=201)
def add_disruption(body: DisruptionBody, user: User = Depends(require_admin), t: Twin = Depends(twin)):
    for sid in filter(None, (body.stop_id, body.to_stop_id)):
        if sid not in t.line.distance:
            raise HTTPException(422, f"Unknown stop {sid}")
    if body.kind == "suspend" and not body.to_stop_id:
        raise HTTPException(422, "A suspension needs to_stop_id")
    if body.kind == "delay" and body.delay_s <= 0:
        raise HTTPException(422, "A delay needs delay_s")
    now = t.clock.now_ms()
    d = Disruption(id=uuid.uuid4().hex[:8], kind=body.kind, stop_id=body.stop_id, to_stop_id=body.to_stop_id,
                   direction_id=body.direction_id, delay_s=body.delay_s,
                   multiplier=body.multiplier if body.kind == "surge" else 1.0, start_ms=now,
                   end_ms=now + body.duration_min * 60_000 if body.duration_min else None, note=body.note)
    return t.add_disruption(d, user.email).model_dump()


@router.delete("/admin/sim/disruptions/{disruption_id}")
def remove_disruption(disruption_id: str, user: User = Depends(require_admin), t: Twin = Depends(twin)):
    t.remove_disruption(disruption_id, user.email)
    return t.sim_state()


@router.post("/admin/sim/scenarios/{scenario_id}")
def scenario(scenario_id: str, user: User = Depends(require_admin), t: Twin = Depends(twin)):
    if scenario_id not in SCENARIOS:
        _404("scenario")
    return t.run_scenario(scenario_id, user.email)


# ---- line control (operators and admins) ------------------------------------------------------


class NoticeBody(BaseModel):
    text: str = Field(min_length=3, max_length=240)
    severity: Literal["info", "warning"] = "info"
    duration_min: int | None = Field(default=None, ge=5, le=600)


@router.post("/control/notices", status_code=201)
def add_notice(body: NoticeBody, user: User = Depends(require_user), t: Twin = Depends(twin)):
    """ALT-07/ALT-08, ROLE-03: a plain-language notice to riders on every screen."""
    return t.add_notice(body.text, body.severity, body.duration_min, user.email)


@router.delete("/control/notices/{notice_id}")
def remove_notice(notice_id: str, user: User = Depends(require_user), t: Twin = Depends(twin)):
    t.remove_notice(notice_id, user.email)
    return t.sim_state()


class InsertBody(BaseModel):
    direction_id: Literal[0, 1]
    in_min: int = Field(default=0, ge=0, le=60)


@router.post("/control/trains", status_code=201)
def insert_train(body: InsertBody, user: User = Depends(require_user), t: Twin = Depends(twin)):
    """ROLE-04: what-if, send an extra train from the terminal to relieve crowding."""
    first = t.line.directions[body.direction_id]["stops"][0]["station_id"]
    start = t.clock.now_ms() + body.in_min * 60_000
    d = Disruption(id=uuid.uuid4().hex[:8], kind="insert", stop_id=first, direction_id=body.direction_id,
                   start_ms=start, end_ms=None, note="Extra train")
    return t.add_disruption(d, user.email).model_dump()


@router.get("/admin/audit")
def audit(limit: int = 200, _: User = Depends(require_admin), t: Twin = Depends(twin)):
    return [e.model_dump() for e in reversed(t.store.audit[-max(1, min(limit, 1000)):])]


# ---- crowding from riders and live feeds ---------------------------------------------------------


def _rider_limit(request: Request, t: Twin) -> None:
    """Per-address cap across reports and pings. Run uvicorn with --proxy-headers behind a proxy."""
    if not t.riders.per_address.allow(request.client.host if request.client else "unknown"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests from this address")


def _rider_error(e: RiderError) -> JSONResponse:
    return JSONResponse({"detail": e.message, "code": e.code}, status_code=e.status)


@router.get("/crowd/observed")
def crowd_observed(t: Twin = Depends(twin)):
    """Crowding observed on each train by riders and sensors, fused (see aera_twin.crowdsource)."""
    return {"trips": t.observations.summary(t.clock.now_ms())}


@router.post("/crowd/reports", status_code=201)
def crowd_report(body: RiderReport, request: Request, t: Twin = Depends(twin)):
    _rider_limit(request, t)
    try:
        return t.rider_report(body)
    except RiderError as e:
        return _rider_error(e)


@router.post("/crowd/pings", status_code=202)
def crowd_ping(body: LocationPing, request: Request, t: Twin = Depends(twin)):
    """One opt-in position from a rider's phone. Only a distance along the line is kept."""
    _rider_limit(request, t)
    try:
        return t.rider_ping(body)
    except RiderError as e:
        return _rider_error(e)


@router.get("/live/feed")
def live_feed(t: Twin = Depends(twin)):
    """Whether the operator publishes live train positions, and the trains from it if so."""
    if not t.feed:
        return {"feed": None, "vehicles": []}
    return {"feed": t.feed.status.to_dict(), "vehicles": [asdict(v) for v in t.feed.vehicles]}


# ---- HTTP ingest bridge -------------------------------------------------------------------------


def _check_ingest_token(request: Request, t: Twin) -> None:
    sent = request.headers.get("x-ingest-token", "")
    if t.env.ingest_token and not hmac.compare_digest(sent.encode(), t.env.ingest_token.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bad ingest token")


@router.post("/ingest/{station_id}/{device_id}/{kind}", status_code=202)
async def ingest(station_id: str, device_id: str, kind: Literal["event", "telemetry", "status"],
                 request: Request, t: Twin = Depends(twin)):
    """Same contract as MQTT, for bench testing a device without a broker."""
    _check_ingest_token(request, t)
    if device_id.startswith("sim-"):
        raise HTTPException(422, "sim- device ids are reserved for the simulator")
    body = await request.body()
    before = t.validator.stats()["rejected_total"]
    await t.handle_message(f"aera/v1/{station_id}/{device_id}/{kind}", body)
    rejected = t.validator.stats()["rejected_total"] > before
    return {"accepted": not rejected}


MAX_SENSOR_BODY = 4096


@router.post("/ingest/train/{device_id}", status_code=202)
async def ingest_train(device_id: Annotated[str, Path(min_length=1, max_length=64, pattern=DEVICE_PATTERN)],
                       request: Request, t: Twin = Depends(twin)):
    """An in-train sensor reading (contracts.CarCount), same as MQTT aera/v1/train/{device}/count."""
    _check_ingest_token(request, t)
    body = await request.body()
    if len(body) > MAX_SENSOR_BODY:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Reading too large")
    return {"accepted": t.apply_car_count(device_id, body)}


def _404(what: str):
    raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown {what}")
