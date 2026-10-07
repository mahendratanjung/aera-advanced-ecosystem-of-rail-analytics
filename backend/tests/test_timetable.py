from datetime import datetime

from aera_twin.simclock import SimClock
from aera_twin.timetable import KL_TZ, Disruption, demand, load_line

LINE = load_line("KJ")


def kl(h, m=0, day=20):  # 20 Oct 2026 is a Tuesday
    return datetime(2026, 10, day, h, m, tzinfo=KL_TZ).timestamp()


def test_peak_has_more_trains_than_off_peak():
    peak = LINE.active_trains(kl(18), [])
    off = LINE.active_trains(kl(10, 30), [])
    assert len(peak) > len(off) > 10
    assert {t.direction_id for t in peak} == {0, 1}


def test_no_trains_in_the_small_hours():
    assert LINE.active_trains(kl(3), []) == []


def test_positions_are_deterministic_and_on_the_line():
    a = LINE.active_trains(kl(8, 13), [])
    b = LINE.active_trains(kl(8, 13), [])
    assert [(t.trip_id, t.distance_m) for t in a] == [(t.trip_id, t.distance_m) for t in b]
    end = LINE.stations[-1]["distance_m"]
    assert all(0 <= t.distance_m <= end for t in a)


def test_next_departures_at_hero_station():
    nxt = LINE.next_departures("KJ20", kl(17, 50), [])
    for d in (0, 1):
        assert 1 <= len(nxt[d]) <= 3
        assert all(r["arrival"] >= kl(17, 50) - 60 for r in nxt[d])
        gaps = [b["arrival"] - a["arrival"] for a, b in zip(nxt[d], nxt[d][1:])]
        assert all(g == 240 for g in gaps)


def test_delay_pushes_later_stops():
    t = kl(9, 30)
    base = LINE.next_departures("KJ20", t, [])[0][0]
    d = Disruption(id="d1", kind="delay", stop_id="KJ21", direction_id=0, delay_s=300,
                   start_ms=int((t - 3600) * 1000))
    delayed = LINE.next_departures("KJ20", t, [d])[0]
    match = next(r for r in delayed if r["trip_id"] == base["trip_id"])
    assert match["delay_s"] == 300


def test_hold_keeps_trains_at_the_station_until_it_ends():
    t = kl(11)
    hold = Disruption(id="h", kind="hold", stop_id="KJ15", direction_id=None,
                      start_ms=int((t - 900) * 1000), end_ms=int((t + 600) * 1000))
    at_kls = [s for s in LINE.active_trains(t, [hold])
              if s.status == "held" and LINE.stations[[x["id"] for x in LINE.stations].index("KJ15")]["distance_m"] == s.distance_m]
    assert at_kls, "expected trains held at KL Sentral"


def test_suspension_holds_at_section_entry():
    t = kl(12)
    sus = Disruption(id="s", kind="suspend", stop_id="KJ13", to_stop_id="KJ10",
                     start_ms=int((t - 1200) * 1000))
    states = LINE.active_trains(t, [sus])
    lo, hi = LINE.distance["KJ13"], LINE.distance["KJ10"]
    inside = [s for s in states if min(lo, hi) < s.distance_m < max(lo, hi)]
    assert not inside, "no train should be inside a suspended section after it has cleared"


def test_demand_curve_peaks():
    assert demand(8) > 0.9 and demand(18.25) > 0.85
    assert demand(11) < 0.5 and demand(3) == 0


def test_sim_clock_speed_pause_and_jump():
    c = SimClock(sim_ms=1_000_000, speed=1.0, real_ms=0)
    assert c.now_ms(1000) == 1_001_000
    c.set_speed(10, real_ms=1000)
    assert c.now_ms(2000) == 1_011_000
    c.pause(real_ms=2000)
    assert c.now_ms(9000) == 1_011_000
    c.resume(real_ms=9000)
    assert c.now_ms(10000) == 1_021_000
    c.jump_to_local_time("17:30", real_ms=10000)
    assert datetime.fromtimestamp(c.now_ms(10000) / 1000, KL_TZ).strftime("%H:%M") == "17:30"


def test_open_ended_hold_does_not_produce_nan():
    t = kl(12)
    hold = Disruption(id="h", kind="hold", stop_id="KJ19", direction_id=1, start_ms=int((t - 600) * 1000))
    nxt = LINE.next_departures("KJ20", t, [hold])
    assert all(r["arrival"] < float("inf") for r in nxt[1])
    assert LINE.active_trains(t, [hold])
