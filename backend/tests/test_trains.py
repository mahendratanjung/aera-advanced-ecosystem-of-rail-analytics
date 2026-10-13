from aera_twin.gtfs.trains import build_trains


def _rapid():
    stops = [("A1", "ALPHA", 3.10, 101.70), ("A2", "BETA", 3.11, 101.70), ("A3", "GAMMA", 3.12, 101.70)]
    return {
        "routes": [{"route_id": "A", "route_short_name": "AGL", "route_long_name": "LRT A", "route_color": "e57200", "category": "LRT"},
                   {"route_id": "K", "route_short_name": "KJL", "route_long_name": "LRT KJ", "route_color": "", "category": "LRT"}],
        "stops": [{"stop_id": i, "stop_name": n, "stop_lat": str(la), "stop_lon": str(lo)} for i, n, la, lo in stops],
        "trips": [{"route_id": "A", "service_id": "MonFri", "trip_id": "a0", "trip_headsign": "Alpha to Gamma", "direction_id": "0", "shape_id": "s"},
                  {"route_id": "K", "service_id": "MonFri", "trip_id": "k0", "trip_headsign": "x", "direction_id": "0"}],
        "stop_times": [
            {"trip_id": "a0", "arrival_time": "6:00:00", "departure_time": "6:00:20", "stop_id": "A1", "stop_sequence": "1"},
            {"trip_id": "a0", "arrival_time": "6:02:00", "departure_time": "6:02:20", "stop_id": "A2", "stop_sequence": "2"},
            {"trip_id": "a0", "arrival_time": "6:04:00", "departure_time": "6:04:00", "stop_id": "A3", "stop_sequence": "3"},
            {"trip_id": "k0", "arrival_time": "6:00:00", "departure_time": "6:00:00", "stop_id": "A1", "stop_sequence": "1"},
        ],
        "shapes": [{"shape_id": "s", "shape_pt_lat": str(la), "shape_pt_lon": "101.7", "shape_pt_sequence": str(i)}
                   for i, la in enumerate([3.10, 3.105, 3.11, 3.12])],
        "frequencies": [{"trip_id": "a0", "start_time": "6:00:00", "end_time": "9:00:00", "headway_secs": "300"}],
        "calendar": [{"service_id": "MonFri", **{d: "1" for d in ("monday", "tuesday", "wednesday", "thursday", "friday")}, "saturday": "0", "sunday": "0"}],
    }


def _ktmb():
    stops = [("1", "KL SENTRAL", 3.134, 101.686), ("2", "SUBANG JAYA", 3.084, 101.587), ("3", "BDR TASEK SELATAN", 3.076, 101.711),
             ("4", "PEL KLANG SEL", 3.0, 101.39)]
    return {
        "routes": [{"route_id": "KC05_KB18", "route_long_name": "KTM Batu Caves - Pulau Sebang/Tampin"},
                   {"route_id": "KA15_KD19", "route_long_name": "KTM Tanjung Malim - Pelabuhan Klang"}],
        "stops": [{"stop_id": i, "stop_name": n, "stop_lat": str(la), "stop_lon": str(lo)} for i, n, la, lo in stops],
        "trips": [{"route_id": "KA15_KD19", "service_id": "komuter_weekday", "trip_id": "t1", "direction_id": "1"},
                  {"route_id": "KA15_KD19", "service_id": "komuter_weekday", "trip_id": "t2", "direction_id": "1"},
                  {"route_id": "KC05_KB18", "service_id": "komuter_weekday", "trip_id": "t3", "direction_id": "0"}],
        "stop_times": [
            {"trip_id": "t1", "arrival_time": "07:00:00", "departure_time": "07:00:00", "stop_id": "1", "stop_sequence": "1"},
            {"trip_id": "t1", "arrival_time": "07:20:00", "departure_time": "07:21:00", "stop_id": "2", "stop_sequence": "2"},
            {"trip_id": "t1", "arrival_time": "07:50:00", "departure_time": "07:50:00", "stop_id": "4", "stop_sequence": "3"},
            {"trip_id": "t2", "arrival_time": "08:00:00", "departure_time": "08:00:00", "stop_id": "1", "stop_sequence": "1"},
            {"trip_id": "t2", "arrival_time": "08:20:00", "departure_time": "08:21:00", "stop_id": "2", "stop_sequence": "2"},
            {"trip_id": "t2", "arrival_time": "08:50:00", "departure_time": "08:50:00", "stop_id": "4", "stop_sequence": "3"},
            {"trip_id": "t3", "arrival_time": "09:00:00", "departure_time": "09:00:00", "stop_id": "1", "stop_sequence": "1"},
            {"trip_id": "t3", "arrival_time": "09:10:00", "departure_time": "09:10:00", "stop_id": "3", "stop_sequence": "2"},
        ],
        "calendar": [{"service_id": "komuter_weekday", **{d: "1" for d in ("monday", "tuesday", "wednesday", "thursday", "friday")}, "saturday": "0", "sunday": "0"}],
        "calendar_dates": [{"service_id": "komuter_weekday", "date": "20260916", "exception_type": "2"}],
    }


def test_every_line_but_kelana_jaya_with_one_shared_format():
    net = build_trains(_rapid(), _ktmb())
    ids = [ln["id"] for ln in net["lines"]]
    assert "KJ" not in ids
    assert ids == ["AG", "K1", "K2", "E6", "E7", "SK"]
    for ln in net["lines"]:
        ds = [s["d"] for s in ln["stops"]]
        assert ds == sorted(ds), f"{ln['id']} stops in order along the track"
        assert len(ln["shape"]) == len(ln["shape_d"]) >= 2
        for p in ln["patterns"]:
            assert len(p["stops"]) == len(p["times"])
            assert all(a <= b for a, b in p["times"])


def test_rapid_line_keeps_shape_and_headways():
    ag = build_trains(_rapid(), _ktmb())["lines"][0]
    assert ag["source"] == "rapid" and ag["level"] == "elevated"
    assert len(ag["shape"]) == 4
    assert ag["frequencies"]["MonFri"] == [[0, 6 * 3600, 9 * 3600, 300]]
    assert ag["patterns"][0]["times"][1] == [120, 140]


def test_ktm_trips_share_patterns_and_keep_holiday_swaps():
    lines = {ln["id"]: ln for ln in build_trains(_rapid(), _ktmb())["lines"]}
    k2 = lines["K2"]
    assert k2["source"] == "ktmb" and k2["level"] == "ground"
    assert len(k2["patterns"]) == 1, "identical trips share a pattern"
    assert k2["trips"]["komuter_weekday"] == [[0, 7 * 3600], [0, 8 * 3600]]
    assert [s["name"] for s in k2["stops"]] == ["KL Sentral", "Subang Jaya", "Pelabuhan Klang"]
    assert k2["dates"] == {"20260916": {"add": [], "remove": ["komuter_weekday"]}}
    assert lines["K1"]["stops"][1]["name"] == "Bandar Tasik Selatan"


def test_erl_is_an_estimate_and_skypark_has_no_trains():
    lines = {ln["id"]: ln for ln in build_trains(_rapid(), _ktmb())["lines"]}
    e7 = lines["E7"]
    assert e7["source"] == "estimate" and e7["note"]
    assert (e7["stops"][0]["lat"], e7["stops"][0]["lon"]) == (3.134, 101.686), "KL Sentral from KTMB"
    assert e7["patterns"][1]["headsign"] == "KL Sentral"
    assert e7["patterns"][1]["times"][-1][0] == 41 * 60
    assert lines["SK"]["source"] == "suspended" and lines["SK"]["patterns"] == []
