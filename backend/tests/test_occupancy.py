from aera_twin.engine.occupancy import OccupancyEngine


def test_inward_crossings_fill_the_concourse(station, settings):
    eng = OccupancyEngine(station, settings)
    eng.recalibrate("ticketing", 20, 0)
    for i in range(10):
        eng.apply_crossing("gate-main", "in", 1, "device", i)
    assert eng.zones["concourse"].count == 10
    assert eng.zones["ticketing"].count == 10
    assert eng.zones["concourse"].source == "device"


def test_scale_factor_multiplies_each_crossing(station, settings):
    settings.station("KJ20").scale_factor = 5
    eng = OccupancyEngine(station, settings)
    for i in range(10):
        eng.apply_crossing("entry-a", "in", 1, "device", i)
    assert eng.zones["entrance"].count == 50


def test_outside_absorbs_and_out_direction_reverses(station, settings):
    eng = OccupancyEngine(station, settings)
    eng.apply_crossing("entry-a", "in", 3, "sim", 1)
    changed = eng.apply_crossing("entry-a", "out", 1, "sim", 2)
    assert [z.id for z in changed] == ["entrance"]
    assert eng.zones["entrance"].count == 2


def test_count_clamps_at_zero_and_records_drift(station, settings):
    eng = OccupancyEngine(station, settings)
    eng.apply_crossing("gate-main", "out", 4, "device", 1)
    assert eng.zones["concourse"].count == 0
    assert eng.zones["ticketing"].count == 4
    assert eng.zones["concourse"].drift == 4


def test_levels_follow_thresholds(station, settings):
    eng = OccupancyEngine(station, settings)
    cap = eng.zones["concourse"].capacity  # 200
    for count, level in [(79, "low"), (80, "moderate"), (120, "busy"), (160, "crowded")]:
        z = eng.recalibrate("concourse", count, 1)
        assert z.level == level, count
    assert eng.zones["concourse"].percent == 80.0 and cap == 200


def test_threshold_and_capacity_changes_recolour(station, settings):
    eng = OccupancyEngine(station, settings)
    eng.recalibrate("concourse", 150, 1)
    assert eng.zones["concourse"].level == "busy"
    settings.thresholds.crowded = 70
    settings.zone_capacity["KJ20:concourse"] = 400
    changed = eng.refresh(2)
    assert eng.zones["concourse"].capacity == 400
    assert eng.zones["concourse"].level == "low"
    assert any(z.id == "concourse" for z in changed)


def test_boarding_rule(station, settings):
    settings.train.capacity = 800
    eng = OccupancyEngine(station, settings)
    eng.recalibrate("platform-1", 100, 0)
    z, alighted, boarded = eng.apply_boarding("platform-1", train_load=600, alight_share=0.25, at_ms=1)
    assert alighted == 150
    assert boarded == 100  # lesser of platform count and spare capacity (350)
    assert z.count == 150


def test_boarding_limited_by_spare_capacity(station, settings):
    settings.train.capacity = 800
    eng = OccupancyEngine(station, settings)
    eng.recalibrate("platform-2", 240, 0)
    _, alighted, boarded = eng.apply_boarding("platform-2", train_load=780, alight_share=0.0, at_ms=1)
    assert (alighted, boarded) == (0, 20)
    assert eng.zones["platform-2"].count == 220


def test_end_of_service_reset(station, settings):
    eng = OccupancyEngine(station, settings)
    eng.apply_crossing("entry-a", "in", 7, "sim", 1)
    eng.reset(2)
    assert all(z.count == 0 for z in eng.zones.values())


def test_flow_rates_cover_last_minute(station, settings):
    eng = OccupancyEngine(station, settings)
    eng.apply_crossing("gate-main", "in", 2, "sim", 0)
    eng.apply_crossing("gate-main", "in", 3, "sim", 30_000)
    eng.apply_crossing("gate-main", "out", 1, "sim", 50_000)
    assert eng.links["gate-main"].flows(70_000) == (3, 1)
