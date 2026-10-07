from aera_twin.ingest.validator import Validator, parse_topic

T = "aera/v1/KJ20/esp32-01/event"


def ev(seq, sensor="gate-main", count=1, direction="in"):
    return {"v": 1, "seq": seq, "ts": "2026-10-20T10:15:03.120Z", "sensor_id": sensor,
            "type": "crossing", "direction": direction, "count": count}


def make(station, settings):
    return Validator({"KJ20": station}, settings)


def test_topic_parsing():
    assert parse_topic(T) == ("KJ20", "esp32-01", "event")
    assert parse_topic("aera/v2/KJ20/x/event") is None
    assert parse_topic("aera/v1/KJ20/x/other") is None


def test_accepts_contract_example(station, settings):
    v = make(station, settings)
    r = v.validate(T, ev(1042), 0)
    assert r.accepted and r.source == "device" and r.message.count == 1


def test_duplicates_and_backwards_sequences_are_rejected(station, settings):
    v = make(station, settings)
    assert v.validate(T, ev(5), 0).accepted
    dup = v.validate(T, ev(5), 10)
    assert not dup.accepted and dup.reason == "duplicate" and not dup.abnormal
    back = v.validate(T, ev(3), 20)
    assert back.reason == "seq_backwards" and back.abnormal
    assert v.stats()["rejected"] == {"duplicate": 1, "seq_backwards": 1}


def test_status_online_resets_sequence(station, settings):
    v = make(station, settings)
    v.validate(T, ev(100), 0)
    assert v.validate("aera/v1/KJ20/esp32-01/status", {"v": 1, "state": "online", "fw": "0.3.1"}, 1).accepted
    assert v.validate(T, ev(1), 2).accepted


def test_malformed_payloads(station, settings):
    v = make(station, settings)
    assert v.validate(T, b"not json", 0).reason == "malformed"
    assert v.validate(T, {**ev(1), "direction": "sideways"}, 0).reason == "malformed"
    assert v.validate(T, {**ev(1), "extra": 1}, 0).reason == "malformed"
    assert v.validate("aera/v1/NOPE/esp32-01/event", ev(1), 0).reason == "unknown_station"


def test_sensor_must_belong_to_device_unless_simulated(station, settings):
    v = make(station, settings)
    assert v.validate(T, ev(1, sensor="stairs-p1"), 0).reason == "unknown_sensor"
    sim = v.validate("aera/v1/KJ20/sim-KJ20/event", ev(1, sensor="stairs-p1"), 0)
    assert sim.accepted and sim.source == "sim"


def test_implausible_rate_is_abnormal(station, settings):
    settings.ingest.max_crossings_per_s = 10
    v = make(station, settings)
    assert v.validate(T, ev(1, count=6), 0).accepted
    r = v.validate(T, ev(2, count=6), 500)
    assert r.reason == "rate" and r.abnormal
    assert v.validate(T, ev(3, count=6), 1600).accepted


def test_out_of_range_telemetry(station, settings):
    v = make(station, settings)
    topic = "aera/v1/KJ20/esp32-01/telemetry"
    ok = {"v": 1, "seq": 1, "ts": "2026-10-20T10:15:10.000Z",
          "readings": [{"sensor_id": "env-concourse", "type": "temperature_c", "value": 27.4}],
          "rssi": -58, "uptime_s": 5321}
    assert v.validate(topic, ok, 0).accepted
    bad = {**ok, "seq": 2, "readings": [{"sensor_id": "env-concourse", "type": "humidity_pct", "value": 140}]}
    assert v.validate(topic, bad, 1).reason == "out_of_range"
