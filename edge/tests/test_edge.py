"""Edge sender and smoother, without hardware or network."""

import json

from aera_edge.camera_counter import in_roi, parse_roi
from aera_edge.sender import Sender
from aera_edge.smoothing import CountSmoother


class FakeNet:
    def __init__(self):
        self.status = 202
        self.sent: list[dict] = []
        self.headers: dict = {}

    def __call__(self, url, body, headers):
        if self.status is None:
            raise OSError("network down")
        self.sent.append(json.loads(body))
        self.headers = headers
        return self.status


def make(net, now):
    return Sender("http://twin:8000/", "cam-1", token="secret", post=net, clock=lambda: now[0])


def test_readings_follow_the_contract():
    net, now = FakeNet(), [1_800_000_000.0]
    s = make(net, now)
    assert s.url == "http://twin:8000/api/ingest/train/cam-1"
    msg = s.reading(car=2, method="camera", count=40, station_id="KJ10", direction_id=1)
    assert msg["v"] == 1 and msg["seq"] == 1 and msg["ts"].endswith("+00:00") and "trip_id" not in msg
    assert s.send(msg) and net.headers["X-Ingest-Token"] == "secret"


def test_offline_readings_wait_in_order_and_stale_ones_are_dropped():
    net, now = FakeNet(), [1000.0]
    s = make(net, now)
    net.status = None  # in the tunnel
    assert not s.send(s.reading(car=1, method="door_counter", count=10, trip_id="T"))
    now[0] += 30
    assert not s.send(s.reading(car=1, method="door_counter", count=12, trip_id="T"))
    net.status = 202
    now[0] += 5
    assert s.flush() and [m["count"] for m in net.sent] == [10, 12]
    net.status, net.sent = None, []
    s.send(s.reading(car=1, method="door_counter", count=20, trip_id="T"))
    now[0] += 300  # five minutes later the reading is no use to riders
    net.status = 202
    assert s.flush() and net.sent == []


def test_rejected_readings_are_not_retried():
    net, now = FakeNet(), [0.0]
    s = make(net, now)
    net.status = 401
    assert s.send(s.reading(car=1, method="camera", count=1, trip_id="T")) and s.rejected == 1


def test_smoother_reports_steady_medians():
    sm = CountSmoother(window=5, min_change=3, every_s=30)
    out = [sm.add(c, t) for t, c in enumerate([10, 30, 11, 9, 10, 12, 10, 11])]
    assert out[:4] == [None] * 4 and out[4] == 10  # the 30 (a double detection) is ignored
    assert all(v is None for v in out[5:])  # small wobble is not resent
    assert sm.add(25, 40) == 11  # nothing new for 30 s: send again anyway


def test_region_of_interest():
    assert parse_roi("0,0.1,1,1") == (0.0, 0.1, 1.0, 1.0)
    assert in_roi((0, 0, 100, 100), (0, 0, 0.5, 0.5), 400, 400)
    assert not in_roi((300, 300, 400, 400), (0, 0, 0.5, 0.5), 400, 400)
