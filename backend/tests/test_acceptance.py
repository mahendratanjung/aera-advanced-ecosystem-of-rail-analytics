"""Acceptance criteria from BRS section 14.1, exercised against the runtime and the API."""

import json

import pytest
from fastapi.testclient import TestClient

import aera_twin.runtime as runtime_mod
from aera_twin.config import Env
from aera_twin.main import create_app
from aera_twin.runtime import Twin
from aera_twin.store import Store

ENV = Env(persist=False, jwt_secret="test-secret-that-is-at-least-32-bytes", mqtt_url="", sim_start="now", gtfs_rt_url="")


class FakeTime:
    def __init__(self, ms=1_800_000_000_000):
        self.ms = ms

    def __call__(self):
        return self.ms


@pytest.fixture
def clock(monkeypatch):
    ft = FakeTime()
    monkeypatch.setattr(runtime_mod, "wall_ms", ft)
    return ft


@pytest.fixture
async def twin(clock):
    t = Twin(ENV, store=Store(persist=False))
    await t.bus.start(t.handle_message)
    t.set_source_mode("KJ20", "device", "test")
    return t


def ev(seq, sensor, direction="in", count=1):
    return json.dumps({"v": 1, "seq": seq, "ts": "2026-10-20T10:15:03.120Z", "sensor_id": sensor,
                       "type": "crossing", "direction": direction, "count": count}).encode()


def heartbeat(seq):
    return json.dumps({"v": 1, "seq": seq, "ts": "2026-10-20T10:15:10.000Z", "readings": [], "rssi": -60}).encode()


async def test_ten_gate_crossings_raise_concourse_by_ten(twin, clock):
    before = twin.engines["KJ20"].zones["concourse"].count
    for i in range(1, 11):
        clock.ms += 500
        await twin.handle_message("aera/v1/KJ20/esp32-01/event", ev(i, "gate-main"))
    assert twin.engines["KJ20"].zones["concourse"].count == before + 10
    assert twin.engines["KJ20"].zones["concourse"].source == "device"


async def test_crowding_alert_reaches_console_public_and_model(twin, clock):
    eng = twin.engines["KJ20"]
    eng.recalibrate("concourse", 200, clock.ms)
    for i in range(1, 5):
        clock.ms += 1100
        await twin.handle_message("aera/v1/KJ20/esp32-02/event", ev(i, "stairs-p1", count=50))
    assert eng.zones["platform-1"].level == "crowded"
    clock.ms += 31_000
    await twin.handle_message("aera/v1/KJ20/esp32-02/telemetry", heartbeat(10))
    await twin.tick()
    [alert] = [a for a in twin.book.list(open_only=True) if a.type == "crowding"]
    assert alert.zone_id == "platform-1" and alert.severity == "high"
    public = twin.visible_alerts(None, open_only=True)
    assert any(a["type"] == "crowding" and "Platform 1" in a["message"] for a in public)
    assert "zone_id" in public[0] and "acked_by" not in public[0]
    leds = {led["zone"]: led["level"] for led in twin.last_command["KJ20"]["leds"]}
    assert leds["platform-1"] == "crowded"
    outbound = [tp for tp, _ in twin.bus.outbound]
    assert "aera/v1/KJ20/esp32-02/cmd" in outbound


async def test_unplugged_device_goes_offline_and_zones_are_estimated(twin, clock):
    await twin.handle_message("aera/v1/KJ20/esp32-01/status", b'{"v":1,"state":"online","fw":"0.3.1"}')
    await twin.handle_message("aera/v1/KJ20/esp32-01/telemetry", heartbeat(1))
    await twin.tick()
    assert twin.store.devices["esp32-01"].status == "online"
    assert not twin.engines["KJ20"].zones["entrance"].estimated
    clock.ms += 31_000
    await twin.tick()
    assert twin.store.devices["esp32-01"].status == "offline"
    assert twin.engines["KJ20"].zones["entrance"].estimated
    assert any(a.type == "device_offline" and a.device_id == "esp32-01" for a in twin.book.list(open_only=True))


async def test_last_will_marks_offline_immediately(twin, clock):
    await twin.handle_message("aera/v1/KJ20/esp32-02/telemetry", heartbeat(1))
    await twin.tick()
    await twin.handle_message("aera/v1/KJ20/esp32-02/status", b'{"v":1,"state":"offline"}')
    assert twin.store.devices["esp32-02"].status == "offline"


async def test_abnormal_reading_raises_low_alert(twin, clock):
    await twin.handle_message("aera/v1/KJ20/esp32-01/event", ev(10, "gate-main"))
    await twin.handle_message("aera/v1/KJ20/esp32-01/event", ev(4, "gate-main"))
    [a] = [a for a in twin.book.list(open_only=True) if a.type == "abnormal"]
    assert a.severity == "low"


async def test_sim_events_are_ignored_in_device_mode(twin, clock):
    before = twin.engines["KJ20"].zones["entrance"].count
    await twin.handle_message("aera/v1/KJ20/sim-KJ20/event", ev(1, "entry-a", count=5))
    assert twin.engines["KJ20"].zones["entrance"].count == before


async def test_threshold_change_recolours(twin, clock):
    eng = twin.engines["KJ20"]
    eng.recalibrate("concourse", 130, clock.ms)  # 65 percent
    assert eng.zones["concourse"].level == "busy"
    new = twin.settings.model_copy(deep=True)
    new.thresholds.crowded = 65
    twin.update_settings(new, "admin@aera.dev")
    assert eng.zones["concourse"].level == "crowded"


async def test_scenarios_and_disruptions_change_state(twin, clock):
    twin.run_scenario("evening_peak", "admin@aera.dev")
    assert twin.scenario.id == "evening_peak"
    twin.run_scenario("train_fault", "admin@aera.dev")
    assert twin.disruptions and twin.disruptions[0].stop_id == "KJ19"
    assert any(a.type == "disruption" for a in twin.book.list(open_only=True))
    twin.run_scenario("platform_closure", "admin@aera.dev")
    assert not twin.engines["KJ20"].zones["platform-2"].available
    twin.run_scenario("reset", "admin@aera.dev")
    assert not twin.disruptions and twin.engines["KJ20"].zones["platform-2"].available
    assert all(z.count == 0 for z in twin.engines["KJ20"].zones.values())


async def test_simulator_fills_the_station(clock):
    t = Twin(ENV, store=Store(persist=False))
    await t.bus.start(t.handle_message)
    t.clock.jump_to_local_time("18:00")
    t.run_scenario("evening_peak", "test")
    for _ in range(240):
        clock.ms += 1000
        await t.tick()
    zones = t.engines["KJ20"].zones
    assert zones["entrance"].count + zones["ticketing"].count + zones["concourse"].count > 0
    assert zones["platform-1"].count + zones["platform-2"].count > 0
    assert all(z.source == "sim" for z in zones.values() if z.count)
    assert t.store.devices["sim-KJ20"].status == "online"


# ---- HTTP -------------------------------------------------------------------------------------


@pytest.fixture
def api():
    app = create_app(ENV)
    with TestClient(app) as c:
        yield c


def login(api, email, pw):
    r = api.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_public_endpoints(api):
    assert api.get("/api/health").json()["ok"]
    line = api.get("/api/lines/KJ").json()
    assert line["color"] == "#D50032" and len(line["stations"]) == 37 and line["twin_stations"] == ["KJ20"]
    stations = api.get("/api/stations").json()
    assert len(stations) == 37 and {s["source"] for s in stations} >= {"sim"}
    assert api.get("/api/stations/KJ20/definition").json()["name"] == "Taman Jaya"
    assert set(api.get("/api/stations/KJ20/next-trains").json()["directions"]) == {"0", "1"}
    assert api.get("/api/admin/overview").status_code == 401


def test_operator_flow_and_station_scoping(api):
    op = login(api, "operator@aera.dev", "aera-operator")
    other = login(api, "operator.kls@aera.dev", "aera-operator")
    admin = login(api, "admin@aera.dev", "aera-admin")

    r = api.post("/api/stations/KJ20/links/entry-a/availability", json={"available": False, "reason": "Flooding"},
                 headers=op)
    assert r.status_code == 200 and r.json()["available"] is False
    alerts = api.get("/api/alerts", headers=op).json()
    [a] = [x for x in alerts if x["type"] == "unavailable"]
    assert api.post(f"/api/alerts/{a['id']}/ack", headers=op).json()["state"] == "acknowledged"
    inc = api.post("/api/incidents", headers=op, json={"station_id": "KJ20", "zone_id": "entrance", "type": "safety",
                                                       "description": "Water at entrance A", "alert_id": a["id"]})
    assert inc.status_code == 201

    # The admin sees all three without refreshing anything special.
    assert any(i["id"] == inc.json()["id"] for i in api.get("/api/incidents", headers=admin).json())
    timeline = api.get("/api/stations/KJ20/timeline", headers=admin).json()
    assert {"alert", "incident", "action"} <= {item["kind"] for item in timeline}

    # Criterion 7: another station's operator can neither see nor change KJ20.
    assert api.post(f"/api/alerts/{a['id']}/ack", headers=other).status_code == 403
    assert api.post("/api/stations/KJ20/zones/concourse/availability", json={"available": False},
                    headers=other).status_code == 403
    assert api.get("/api/stations/KJ20/timeline", headers=other).status_code == 403
    assert api.get("/api/incidents", headers=other).json() == []
    assert api.get("/api/admin/settings", headers=op).status_code == 403


def test_admin_settings_and_sim_controls(api):
    admin = login(api, "admin@aera.dev", "aera-admin")
    s = api.get("/api/admin/settings", headers=admin).json()
    s["thresholds"]["crowded"] = 75
    assert api.put("/api/admin/settings", json=s, headers=admin).json()["thresholds"]["crowded"] == 75
    s["thresholds"]["busy"] = 90
    assert api.put("/api/admin/settings", json=s, headers=admin).status_code == 422
    r = api.post("/api/admin/sim/clock", json={"jump_to": "08:00", "speed": 10}, headers=admin).json()
    assert r["clock"]["speed"] == 10
    d = api.post("/api/admin/sim/disruptions", headers=admin,
                 json={"kind": "delay", "stop_id": "KJ15", "delay_s": 300, "duration_min": 20}).json()
    assert api.delete(f"/api/admin/sim/disruptions/{d['id']}", headers=admin).json()["disruptions"] == []
    assert api.post("/api/admin/sim/scenarios/evening_peak", headers=admin).json()["scenario"]["id"] == "evening_peak"
    created = api.post("/api/admin/users", headers=admin, json={
        "email": "new.op@aera.dev", "display_name": "New", "role": "operator", "station_id": "KJ20",
        "password": "long-enough-pw"})
    assert created.status_code == 201
    assert api.post("/api/admin/devices", headers=admin, json={"id": "esp32-03", "station_id": "KJ20",
                                                              "name": "Spare"}).status_code == 201
    assert api.post("/api/admin/devices/esp32-03/retire", headers=admin).json()["retired"] is True


def test_http_ingest_bridge_and_websocket(api):
    admin = login(api, "admin@aera.dev", "aera-admin")
    api.put("/api/admin/stations/KJ20/source-mode", json={"mode": "device"}, headers=admin)
    with api.websocket_connect("/api/ws") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot" and "incidents" not in snap and snap["user"] is None
        r = api.post("/api/ingest/KJ20/esp32-01/event", content=ev(1, "gate-main"))
        assert r.json() == {"accepted": True}
        for _ in range(50):
            msg = ws.receive_json()
            if msg["type"] == "sensor_event":
                assert msg["sensor_id"] == "gate-main" and msg["source"] == "device"
                break
        else:
            pytest.fail("no sensor_event broadcast")
    assert api.post("/api/ingest/KJ20/esp32-01/event", content=b"{}").json() == {"accepted": False}


def test_crowding_model_and_surge(api):
    model = api.get("/api/lines/KJ/model").json()
    assert model["capacity"] == 800 and len(model["stations"]) == 37
    assert len(model["load"]["0"]["1"]) == 36 and len(model["load"]["0"]["1"][0]) == 24
    assert api.get("/api/lines/XX/model").status_code == 404
    scenarios = {s["id"] for s in api.get("/api/scenarios").json()}
    assert "event_surge" in scenarios and "platform_closure" not in scenarios
    admin = login(api, "admin@aera.dev", "aera-admin")
    sim = api.post("/api/admin/sim/scenarios/event_surge", headers=admin).json()
    [d] = sim["disruptions"]
    assert d["kind"] == "surge" and d["multiplier"] == 3.0 and d["stop_id"] == "KJ10"
    alerts = api.get("/api/alerts").json()
    assert any("KLCC" in (a["message"] or "") for a in alerts)


def test_operators_publish_notices_and_add_trains(api):
    r = api.post("/api/control/notices", json={"text": "Lifts at KLCC are closed"})
    assert r.status_code == 401
    tok = api.post("/api/auth/login", json={"email": "operator@aera.dev", "password": "aera-operator"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    n = api.post("/api/control/notices", json={"text": "Lifts at KLCC are closed", "duration_min": 30}, headers=h).json()
    assert [x["id"] for x in api.get("/api/sim").json()["notices"]] == [n["id"]]
    d = api.post("/api/control/trains", json={"direction_id": 1, "in_min": 2}, headers=h).json()
    assert d["kind"] == "insert" and d["stop_id"] == "KJ1"
    assert api.delete(f"/api/control/notices/{n['id']}", headers=h).json()["notices"] == []


def test_admin_moves_crowding_levels_and_riders_get_them(api):
    tok = api.post("/api/auth/login", json={"email": "admin@aera.dev", "password": "aera-admin"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    s = api.get("/api/admin/settings", headers=h).json()
    assert s["crowd_levels"] == [20, 50, 75, 95]
    bad = api.put("/api/admin/settings", json={**s, "crowd_levels": [50, 20, 75, 95]}, headers=h)
    assert bad.status_code == 422
    ok = api.put("/api/admin/settings", json={**s, "crowd_levels": [25, 55, 80, 100]}, headers=h)
    assert ok.status_code == 200 and ok.json()["crowd_levels"] == [25, 55, 80, 100]
