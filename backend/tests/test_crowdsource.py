"""Crowding from riders' phones and in-train sensors, fused per train."""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from aera_twin.config import CrowdsourceSettings, Env
from aera_twin.contracts import CarCount
from aera_twin.crowdsource.fusion import Observation, ObservationBook, fuse
from aera_twin.crowdsource.riders import LocationPing, RiderDesk, RiderError, RiderReport, level_to_pct
from aera_twin.crowdsource.sensors import car_observation, find_train
from aera_twin.geo import LineProjector
from aera_twin.main import create_app
from aera_twin.timetable import KL_TZ, load_line

ENV = Env(persist=False, jwt_secret="test-secret-that-is-at-least-32-bytes", mqtt_url="", sim_start="now",
          gtfs_rt_url="")
LINE = load_line("KJ")
PROJ = LineProjector(LINE)
CFG = CrowdsourceSettings()
BOUNDS = [20, 50, 75, 95]
WALL = 1_800_000_000.0  # fixed wall clock for pseudonyms and limits
DEV = "device-0123456789abcdef"


def kl_ms(h: int, m: int, s: int = 0) -> int:
    return int(datetime(2026, 10, 12, h, m, s, tzinfo=KL_TZ).timestamp() * 1000)  # a Monday


def trains_at(ms: int):
    return LINE.active_trains(ms / 1000, [])


def obs(pct, sd=18.0, at=0, key="a", source="rider_report", trip="T"):
    return Observation(trip_id=trip, key=key, source=source, pct=pct, sd=sd, stop_index=3, at_ms=at)


# ---- geometry ---------------------------------------------------------------------------------


def test_points_snap_back_onto_the_track():
    for d in (0, 5_000, 22_222, 45_000):
        lat, lon = PROJ.point_at(d)
        snap = PROJ.snap(lat, lon)
        assert abs(snap.distance_m - d) < 5 and snap.offset_m < 5
    lat, lon = PROJ.point_at(10_000)
    assert PROJ.snap(lat + 0.01, lon).offset_m > 500  # about 1 km north of the track


# ---- fusion -----------------------------------------------------------------------------------


def test_sensors_outweigh_rider_reports_and_old_observations_fade():
    mixed = fuse([obs(90, key="r"), obs(40, sd=4, key="s", source="load_weigh")], 0, 240)
    assert mixed and abs(mixed.pct - 40) < 4 and mixed.n == 2
    assert mixed.sources == {"rider_report": 1, "load_weigh": 1}
    aged = fuse([obs(90, at=0, key="old"), obs(30, at=600_000, key="new")], 600_000, 240)
    assert aged and aged.pct < 40  # a ten-minute-old report counts for little
    assert fuse([obs(90, at=0)], 16 * 60_000, 240) is None  # too old to count at all


def test_one_wild_report_among_many_is_ignored():
    reports = [obs(p, key=str(i)) for i, p in enumerate([60, 62, 65, 58, 105])]
    fused = fuse(reports, 0, 240)
    assert fused and fused.n == 4 and 58 <= fused.pct <= 65


def test_book_replaces_by_key_and_forgets_finished_trains():
    book = ObservationBook()
    book.add(obs(30, key="r1"))
    book.add(obs(70, key="r1"))  # same rider again: replaces
    assert book.observed("T", 0).n == 1 and book.observed("T", 0).pct == 70
    book.prune(0, active_trips=set())
    assert book.summary(0) == {}


def test_levels_map_to_the_middle_of_their_band():
    assert [level_to_pct(lv, BOUNDS) for lv in range(1, 6)] == [10, 35, 62.5, 85, 105]


# ---- rider reports ----------------------------------------------------------------------------


def desk():
    return RiderDesk(LINE, PROJ, ObservationBook())


def test_rider_report_lands_on_a_running_train():
    d, t = desk(), kl_ms(8, 0)
    train = trains_at(t)[0]
    o = d.report(RiderReport(device=DEV, trip_id=train.trip_id, level=4), trains_at(t), t, CFG, BOUNDS, WALL)
    assert o.pct == 85 and o.sd > 18  # no position given: trusted a little less
    assert d.book.observed(train.trip_id, t).pct == 85
    assert DEV not in o.key  # only a pseudonym is kept


def test_rider_reports_are_checked():
    d, t = desk(), kl_ms(8, 0)
    trains = trains_at(t)
    train = trains[0]
    with pytest.raises(RiderError) as e:
        d.report(RiderReport(device=DEV, trip_id="KJ-0-1", level=3), trains, t, CFG, BOUNDS, WALL)
    assert e.value.status == 409
    far_lat, far_lon = PROJ.point_at((train.distance_m + 20_000) % PROJ.length_m)
    with pytest.raises(RiderError) as e:
        d.report(RiderReport(device=DEV, trip_id=train.trip_id, level=3, lat=far_lat, lon=far_lon, accuracy_m=20),
                 trains, t, CFG, BOUNDS, WALL)
    assert e.value.code == "too_far"
    cfg = CrowdsourceSettings(reports_per_hour=2)
    d2 = desk()
    for _ in range(2):
        d2.report(RiderReport(device=DEV, trip_id=train.trip_id, level=3), trains, t, cfg, BOUNDS, WALL)
    with pytest.raises(RiderError) as e:
        d2.report(RiderReport(device=DEV, trip_id=train.trip_id, level=3), trains, t, cfg, BOUNDS, WALL)
    assert e.value.status == 429


def test_pseudonyms_change_every_day():
    d = desk()
    assert d.pseudonym(DEV, WALL) == d.pseudonym(DEV, WALL + 60)
    assert d.pseudonym(DEV, WALL) != d.pseudonym(DEV, WALL + 86_400)


# ---- rider locations --------------------------------------------------------------------------


def moving_train(start_ms: int):
    """A direction-1 train that keeps moving for the next 40 s, with its distance at 0, 20 and 40 s."""
    for k in range(0, 600, 5):
        t = start_ms + k * 1000
        for tr in trains_at(t):
            if tr.direction_id != 1:
                continue
            path = [next((x for x in trains_at(t + s * 1000) if x.trip_id == tr.trip_id), None) for s in (0, 20, 40)]
            if all(path) and path[1].distance_m - path[0].distance_m > 100 and path[2].distance_m - path[1].distance_m > 100:
                return t, tr.trip_id, [p.distance_m for p in path]
    raise AssertionError("no moving train found")


def ride(d: RiderDesk, device: str, t0: int, dists: list[float], cfg=CFG):
    out = None
    for i, dist in enumerate(dists):
        lat, lon = PROJ.point_at(dist + 30)
        ms = t0 + i * 20_000
        out = d.ping(LocationPing(device=device, lat=lat, lon=lon, accuracy_m=15), trains_at(ms), ms, cfg, WALL + i * 20)
    return out


def test_phones_riding_a_train_are_counted_once_enough_share():
    d = desk()
    t0, trip_id, dists = moving_train(kl_ms(8, 0))
    assert ride(d, DEV, t0, dists) == trip_id  # matched after two consistent fixes
    end = t0 + 40_000
    d.refresh(trains_at(end), end, 800, CFG, WALL + 40)
    assert d.book.observed(trip_id, end) is None  # one phone is never published (k-anonymity)
    for i in (1, 2):
        ride(d, f"device-{i:016d}", t0, dists)
    d.refresh(trains_at(end), end, 800, CFG, WALL + 40)
    o = d.book.observed(trip_id, end)
    assert o and o.sources == {"rider_location": 1} and o.pct == pytest.approx(3 / 0.02 / 800 * 100)


def test_phones_that_are_not_on_a_train_are_not_counted():
    d = desk()
    t0, _, dists = moving_train(kl_ms(8, 0))
    # standing still on the line (a platform)
    assert ride(d, DEV, t0, [dists[0]] * 3) is None
    # a kilometre from the track
    lat, lon = PROJ.point_at(dists[0])
    assert d.ping(LocationPing(device=DEV, lat=lat + 0.01, lon=lon, accuracy_m=10), trains_at(t0), t0, CFG, WALL) is None
    assert DEV not in d.tracks


# ---- in-train sensors -------------------------------------------------------------------------


def test_car_count_contract():
    base = {"v": 1, "seq": 1, "ts": "2026-10-12T08:00:00+08:00", "method": "camera", "car": 2}
    CarCount(**base, count=120, trip_id="KJ-1-1")
    CarCount(**base, load_pct=60, station_id="KJ10", direction_id=1)
    with pytest.raises(ValidationError):
        CarCount(**base, count=120, load_pct=60, trip_id="KJ-1-1")
    with pytest.raises(ValidationError):
        CarCount(**base, count=120, station_id="KJ10")  # direction missing


def test_sensor_finds_its_train_from_the_station():
    t = kl_ms(8, 0)
    trains = trains_at(t)
    tr = next(x for x in trains if x.direction_id == 1 and x.stop_index > 0)
    station = LINE.directions[1]["stops"][tr.stop_index]["station_id"]
    msg = CarCount(v=1, seq=1, ts="2026-10-12T08:00:00+08:00", method="camera", car=2, count=150,
                   station_id=station, direction_id=1)
    found = find_train(msg, LINE, trains)
    assert found and found.trip_id == tr.trip_id
    o = car_observation(msg, "cam-1", found, 800, t)
    assert o.pct == 75 and o.sd == 8 and o.source == "camera"


# ---- API --------------------------------------------------------------------------------------


@pytest.fixture
def api():
    with TestClient(create_app(ENV)) as c:
        tw = c.app.state.twin
        tw.clock.jump(kl_ms(8, 0))
        tw.clock.pause()
        yield c


def test_api_report_sensor_and_observed(api):
    tw = api.app.state.twin
    train = tw.active_trains()[0]
    r = api.post("/api/crowd/reports", json={"device": DEV, "trip_id": train.trip_id, "level": 5})
    assert r.status_code == 201, r.text
    assert r.json()["observed"]["pct"] == 105
    r = api.post("/api/crowd/reports", json={"device": DEV, "trip_id": "KJ-1-0", "level": 5})
    assert r.status_code == 409 and r.json()["code"] == "not_running"
    assert api.post("/api/crowd/reports", json={"device": "short", "trip_id": train.trip_id, "level": 5}).status_code == 422

    reading = {"v": 1, "seq": 1, "ts": "2026-10-12T08:00:00+08:00", "method": "load_weigh", "car": 1,
               "load_pct": 50, "trip_id": train.trip_id}
    assert api.post("/api/ingest/train/lw-1", json=reading).json() == {"accepted": True}
    assert api.post("/api/ingest/train/lw-1", content=b"not json").json() == {"accepted": False}
    observed = api.get("/api/crowd/observed").json()["trips"][train.trip_id]
    assert observed["n"] == 2 and 50 <= observed["pct"] < 60  # the load-weigh reading dominates

    lat, lon = PROJ.point_at(train.distance_m)
    r = api.post("/api/crowd/pings", json={"device": DEV, "lat": lat, "lon": lon, "accuracy_m": 10})
    assert r.status_code == 202 and r.json() == {"on_train": None}  # one fix is not enough
    assert api.get("/api/live/feed").json() == {"feed": None, "vehicles": []}


async def test_train_sensor_over_mqtt_topic():
    from aera_twin.runtime import Twin
    from aera_twin.store import Store

    tw = Twin(ENV, store=Store(persist=False))
    tw.clock.jump(kl_ms(8, 0))
    tw.clock.pause()
    train = tw.active_trains()[0]
    payload = (b'{"v":1,"seq":1,"ts":"2026-10-12T08:00:00+08:00","method":"door_counter","car":3,'
               b'"count":100,"trip_id":"' + train.trip_id.encode() + b'"}')
    await tw.handle_message("aera/v1/train/door-7/count", payload)
    assert tw.observations.observed(train.trip_id, tw.clock.now_ms()).sources == {"door_counter": 1}
