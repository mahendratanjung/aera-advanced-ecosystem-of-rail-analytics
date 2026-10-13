from aera_twin.gtfs.network import build_network, line_code


def _feed():
    stops = [
        ("A1", "ALPHA", 3.1000, 101.7000, "A"), ("A2", "MIDDLE - SPONSOR", 3.1100, 101.7000, "A"),
        ("B1", "MIDDLE", 3.1101, 101.7010, "B"), ("B2", "FAR AWAY", 3.2000, 101.7010, "B"),
    ]
    return {
        "routes": [
            {"route_id": "A", "route_short_name": "AAL", "route_long_name": "LRT A", "route_color": "ff0000",
             "category": "LRT", "route_type": "1"},
            {"route_id": "B", "route_short_name": "BRT", "route_long_name": "BRT B", "route_color": "",
             "category": "", "route_type": "0"},
        ],
        "stops": [{"stop_id": i, "stop_name": n, "stop_lat": str(la), "stop_lon": str(lo), "route_id": r}
                  for i, n, la, lo, r in stops],
        "trips": [
            {"route_id": "A", "service_id": "MonFri", "trip_id": "a0", "trip_headsign": "From Alpha to Middle",
             "direction_id": "0"},
            {"route_id": "B", "service_id": "MonFri", "trip_id": "b0", "trip_headsign": "Far Away",
             "direction_id": "0"},
        ],
        "stop_times": [
            {"trip_id": "a0", "arrival_time": "6:00:00", "departure_time": "6:00:20", "stop_id": "A1", "stop_sequence": "1"},
            {"trip_id": "a0", "arrival_time": "6:03:00", "departure_time": "6:03:20", "stop_id": "A2", "stop_sequence": "2"},
            {"trip_id": "b0", "arrival_time": "7:00:00", "departure_time": "7:00:00", "stop_id": "B1", "stop_sequence": "1"},
            {"trip_id": "b0", "arrival_time": "7:20:00", "departure_time": "7:20:00", "stop_id": "B2", "stop_sequence": "2"},
        ],
        "frequencies": [{"trip_id": "a0", "start_time": "6:00:00", "end_time": "9:00:00", "headway_secs": "240"}],
        "calendar": [{"service_id": "MonFri", "monday": "1", "tuesday": "1", "wednesday": "1", "thursday": "1",
                      "friday": "1", "saturday": "0", "sunday": "0"}],
    }


def test_line_codes_follow_signage():
    assert line_code({"route_id": "KJ", "route_short_name": "KJL"}) == "KJ"
    assert line_code({"route_id": "BRT", "route_short_name": "BRT"}) == "BRT"


def test_network_keeps_run_times_headways_and_names():
    net = build_network(_feed())
    a = next(ln for ln in net["lines"] if ln["id"] == "AA")
    assert [s["name"] for s in a["stops"]] == ["Alpha", "Middle"]
    assert a["directions"][0]["stops"][1] == {"id": "A2", "arr": 180, "dep": 200}
    assert a["directions"][0]["headsign"] == "Middle"
    assert a["frequencies"]["MonFri"]["0"] == [[21600, 32400, 240]]
    assert a["calendar"]["MonFri"] == [1, 1, 1, 1, 1, 0, 0]


def test_transfers_join_nearby_stops_of_other_lines_only():
    net = build_network(_feed())
    pairs = {(t["from"], t["to"]) for t in net["transfers"]}
    assert pairs == {("A2", "B1")}
    t = net["transfers"][0]
    assert 100 < t["distance_m"] < 200 and t["walk_s"] > 120
