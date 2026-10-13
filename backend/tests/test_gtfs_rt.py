"""The GTFS Realtime watcher: today's 404 from data.gov.my, and a feed once it exists."""

from datetime import datetime

import httpx
from google.transit import gtfs_realtime_pb2

from aera_twin.feeds.gtfs_rt import FeedWatcher, decode, match
from aera_twin.geo import LineProjector
from aera_twin.timetable import KL_TZ, load_line

LINE = load_line("KJ")
PROJ = LineProjector(LINE)
T = datetime(2026, 10, 12, 8, 0, tzinfo=KL_TZ).timestamp()
URL = "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-rail-kl"


def trains():
    return LINE.active_trains(T, [])


def feed_bytes(vehicles: list[tuple[str, str, int, float]]) -> bytes:
    """vehicles: (id, route_id, direction_id, distance along the line)."""
    msg = gtfs_realtime_pb2.FeedMessage()
    msg.header.gtfs_realtime_version = "2.0"
    msg.header.timestamp = int(T)
    for vid, route, direction, dist in vehicles:
        e = msg.entity.add()
        e.id = vid
        lat, lon = PROJ.point_at(dist)
        e.vehicle.position.latitude, e.vehicle.position.longitude = lat, lon
        e.vehicle.trip.route_id = route
        e.vehicle.trip.direction_id = direction
        e.vehicle.vehicle.id = vid
        e.vehicle.timestamp = int(T)
    return msg.SerializeToString()


def test_vehicles_are_snapped_and_compared_with_the_timetable():
    tr = next(t for t in trains() if t.direction_id == 1 and 2_000 < t.distance_m < 40_000)
    data = feed_bytes([("V1", "KJ", 1, tr.distance_m - 500), ("BUS", "T789", 0, 1_000)])
    vehicles = match(decode(data), LINE, PROJ, trains())
    assert [v.vehicle_id for v in vehicles] == ["V1"]  # other routes are ignored
    v = vehicles[0]
    assert v.nearest_trip_id == tr.trip_id and v.behind_s > 0  # 500 m behind the timetable: running late


async def test_watcher_reports_the_missing_rail_feed():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"status_code": 404, "details": [
            "Vehicle Position feed for prasarana (rapid-rail-kl) does not exist."]})

    changes = []
    w = FeedWatcher(URL, LINE, PROJ, trains, changes.append, transport=httpx.MockTransport(handler))
    status = await w.poll_once()
    assert status.state == "unavailable" and "does not exist" in status.detail
    assert len(changes) == 1 and w.vehicles == []


async def test_watcher_goes_live_when_the_feed_appears():
    tr = next(t for t in trains() if t.direction_id == 0)
    body = feed_bytes([("V9", "KJ", 0, tr.distance_m)])
    w = FeedWatcher(URL, LINE, PROJ, trains,
                    transport=httpx.MockTransport(lambda r: httpx.Response(200, content=body)))
    status = await w.poll_once()
    assert status.state == "live" and status.vehicles == 1 and status.last_live_ms
    bad = FeedWatcher(URL, LINE, PROJ, trains,
                      transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"\xff\xff not protobuf")))
    assert (await bad.poll_once()).state == "error"
