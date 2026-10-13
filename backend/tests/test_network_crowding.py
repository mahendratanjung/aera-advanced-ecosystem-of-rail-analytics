import pytest

from aera_twin.ridership.network import DAYTYPES, Graph, assign, loads_by_line, rapid_graph, rides_on, trains_per_hour


def _rapid():
    """Two lines sharing the first two platforms (like Ampang and Sri Petaling), and a third one a walk away."""
    def line(lid, ids, hw):
        stops = [{"id": i, "lat": 3.1 + n * 0.01, "lon": 101.7, "name": i} for n, i in enumerate(ids)]
        fwd = [{"id": i, "arr": n * 120, "dep": n * 120 + 20} for n, i in enumerate(ids)]
        back = [{"id": i, "arr": n * 120, "dep": n * 120 + 20} for n, i in enumerate(reversed(ids))]
        return {"id": lid, "stops": stops, "calendar": {"All": [1] * 7},
                "directions": [{"direction_id": 0, "stops": fwd}, {"direction_id": 1, "stops": back}],
                "frequencies": {"All": {"0": [[6 * 3600, 23 * 3600, hw]], "1": [[6 * 3600, 23 * 3600, hw]]}}}
    return {"lines": [line("AG", ["AG1", "AG2", "AG3"], 300), line("SP", ["SP1", "SP2", "SP9"], 300), line("KG", ["KG1", "KG2"], 240)],
            "transfers": [{"from": "AG1", "to": "SP1", "distance_m": 0, "walk_s": 120},
                          {"from": "AG2", "to": "SP2", "distance_m": 0, "walk_s": 120},
                          {"from": "AG3", "to": "KG1", "distance_m": 80, "walk_s": 200}]}


def test_trains_per_hour_keeps_the_full_rate_in_part_hours():
    tph = trains_per_hour([(6 * 3600, 9 * 3600, 300)], offset=20 * 60)
    assert tph[5] == 0
    assert tph[6] == pytest.approx(12)  # service reaches this point at 06:20, still one every 5 min
    assert tph[8] == pytest.approx(12)
    assert tph[9] == pytest.approx(12)  # the last trains pass before 09:20
    assert tph[10] == 0


def test_shared_platforms_become_one_stretch_served_by_both_lines():
    g, codes, _ = rapid_graph(_rapid())
    assert codes[("SP", 9)] == "SP9"
    lines = {ln for ln, *_ in g.serve[("AG1", "AG2")]}
    assert lines == {"AG", "SP"}


def test_journeys_are_routed_across_lines():
    g, _, _ = rapid_graph(_rapid())
    dist, prev = g.paths_from("AG1")
    legs = rides_on(g, dist, prev, "KG2")
    assert [(a, b) for a, b, _ in legs] == [("AG1", "AG2"), ("AG2", "AG3"), ("KG1", "KG2")]
    assert legs[0][2] < legs[1][2] < legs[2][2]


def test_load_is_shared_by_every_train_on_common_track():
    g, _, starts = rapid_graph(_rapid())
    from aera_twin.ridership.network import rapid_tph
    flows = {("AG1", "AG2"): [[0.0] * 24 for _ in DAYTYPES]}
    flows[("AG1", "AG2")][0][8] = 2400.0  # an hour's riders, carried by 12 AG + 12 SP trains
    out = loads_by_line(g, assign(g, flows), rapid_tph(g, starts), {"AG", "SP"})
    ag, sp = out["AG"]["AG1>AG2"][0], out["SP"]["SP1>SP2"][0]
    assert ag[8] == sp[8] == 10  # 2400 / (24 trains x 1000)
    assert ag[3] is None  # no trains at 03:00
    assert out["AG"]["AG2>AG1"][0][8] == 0


def test_graph_without_a_route_is_skipped():
    g = Graph()
    g.ride("A", "B", 60, "X", "A", "B", 0)
    load = assign(g, {("B", "A"): [[1.0] * 24 for _ in DAYTYPES]})
    assert dict(load) == {}


def test_riders_share_close_alternative_routes():
    from aera_twin.ridership.network import routes

    g = Graph()
    # Two ways from A to D: via B (10 min) and via C (12 min); a third via E is far slower.
    for (a, b, sec, line) in [("A", "B", 300, "X"), ("B", "D", 300, "X"), ("A", "C", 360, "Y"), ("C", "D", 360, "Y"),
                              ("A", "E", 1200, "Z"), ("E", "D", 1200, "Z")]:
        g.ride(a, b, sec, line, a, b, 0)
    dist, prev = g.paths_from("A")
    out = routes(g, "A", "D", dist, prev)
    shares = {legs[0][1]: share for share, legs in out}
    assert set(shares) == {"B", "C"}  # the 40-minute route is beyond the limit
    assert shares["B"] > shares["C"] > 0.2
    assert sum(shares.values()) == pytest.approx(1.0)
