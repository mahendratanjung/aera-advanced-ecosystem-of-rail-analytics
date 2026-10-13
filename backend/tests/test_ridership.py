import pytest

from aera_twin.ridership.assign import (
    direction_of,
    journey_class,
    journey_on_line,
    map_station,
    segments_between,
    shift_profile,
)
from aera_twin.timetable import load_line


def test_station_mapping():
    assert map_station("KJ15: KL Sentral") == ("KJ15", True)
    assert map_station("SP31: Putra Heights") == ("KJ37", True)
    assert map_station("AG03: Titiwangsa") == ("KJ13", False)
    assert map_station("SP25: Pusat Bandar Puchong") == ("KJ37", False)
    assert map_station("SP12: Cheras") == ("KJ13", False)
    assert map_station("PYL20: Ampang Park") == ("KJ9", False)
    assert map_station("A0: All Stations") == (None, False)


def test_journeys_that_never_ride_the_line_are_dropped():
    assert journey_on_line("KJ20: Taman Jaya", "KJ15: KL Sentral") == ("KJ20", "KJ15")
    assert journey_on_line("KJ20: Taman Jaya", "KG18: Bukit Bintang") == ("KJ20", "KJ14")
    assert journey_on_line("AG03: Titiwangsa", "KG18: Bukit Bintang") is None
    assert journey_on_line("AG07: Masjid Jamek", "KJ13: Masjid Jamek") is None


def test_direction_segments_and_class():
    assert direction_of(19, 14) == 0 and direction_of(0, 5) == 1
    assert list(segments_between(19, 14)) == [14, 15, 16, 17, 18]
    assert journey_class("KJ20", "KJ15") == "inbound"
    assert journey_class("KJ10", "KJ30") == "outbound"
    assert journey_class("KJ20", "KJ30") == "other"


def test_shift_profile_moves_mass_later():
    p = [0.0] * 24
    p[8] = 1.0
    assert shift_profile(p, 0)[8] == 1.0
    s = shift_profile(p, 15)
    assert s[8] == pytest.approx(0.75) and s[9] == pytest.approx(0.25)
    assert sum(shift_profile(p, 90)) == pytest.approx(1.0)


pd = pytest.importorskip("pandas")


def test_build_assigns_flow_to_the_right_segments():
    from aera_twin.ridership.build import build

    dates = pd.date_range("2026-08-03", periods=28, freq="D")  # starts on a Monday
    od = pd.DataFrame(
        [{"date": d, "origin": "KJ20: Taman Jaya", "destination": "KJ15: KL Sentral", "ridership": 1000} for d in dates]
        + [{"date": d, "origin": "A0: All Stations", "destination": "KJ15: KL Sentral", "ridership": 99999} for d in dates]
    )
    rows = []
    for d in dates[:14]:
        for h in range(24):
            for o, dest in (("Kajang", "KL Sentral"), ("KL Sentral", "Kajang"), ("Kajang", "Serdang")):
                rows.append({"date": d, "time": f"{h:02d}:00", "origin": o, "destination": dest,
                             "ridership": 100 if h == 8 else 1})
    model = build(load_line("KJ"), od, pd.DataFrame(rows), weeks=4)
    tuesday = model["load"]["1"]
    # Taman Jaya (index 19) to KL Sentral (index 14) is northbound: direction 0, segments 14..18.
    daily = [sum(tuesday["0"][s]) for s in range(36)]
    assert all(abs(daily[s] - 1000) <= 12 for s in range(14, 19))  # hourly rounding
    assert sum(daily[:14]) + sum(daily[19:]) == 0
    assert sum(sum(r) for r in tuesday["1"]) == 0
    assert abs(sum(model["board"]["1"]["0"][19]) - 1000) <= 12
    # The aggregate "All Stations" rows must never leak into the line.
    assert model["trend"]["daily"][0] == 1000
    # Inbound journeys follow the morning peak of the commuter profile.
    by_hour = [tuesday["0"][14][h] for h in range(24)]
    assert max(range(24), key=lambda h: by_hour[h]) in (8, 9)
