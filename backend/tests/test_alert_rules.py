from aera_twin.rules.alerts import AlertBook, CrowdingRule


def make(settings):
    book = AlertBook(settings)
    return book, CrowdingRule(book, settings)


def step(rule, pct, t):
    rule.observe("KJ20", "platform-1", pct, t)
    rule.evaluate("KJ20", "platform-1", "Platform 1", t)


def test_crowding_needs_the_hold_time(settings):
    book, rule = make(settings)
    step(rule, 85, 0)
    step(rule, 85, 29_000)
    assert not book.list(open_only=True)
    step(rule, 85, 30_000)
    [a] = book.list(open_only=True)
    assert a.type == "crowding" and a.severity == "high" and a.zone_id == "platform-1"
    assert a.public_message and "Platform 1" in a.public_message


def test_dip_below_crowded_restarts_the_hold(settings):
    book, rule = make(settings)
    step(rule, 85, 0)
    step(rule, 70, 20_000)
    step(rule, 85, 25_000)
    step(rule, 85, 50_000)
    assert not book.list(open_only=True)
    step(rule, 85, 55_000)
    assert len(book.list(open_only=True)) == 1


def test_clears_after_sixty_seconds_below_busy(settings):
    book, rule = make(settings)
    step(rule, 90, 0)
    step(rule, 90, 30_000)
    step(rule, 50, 40_000)
    step(rule, 50, 99_000)
    assert book.list(open_only=True)
    step(rule, 50, 100_000)
    assert not book.list(open_only=True)
    [a] = book.list()
    assert a.state == "resolved" and a.resolved_by == "system"


def test_busy_band_does_not_clear(settings):
    book, rule = make(settings)
    step(rule, 90, 0)
    step(rule, 90, 30_000)
    step(rule, 65, 40_000)
    step(rule, 65, 200_000)
    assert book.list(open_only=True)


def test_ack_and_manual_resolve_do_not_refire_until_recovered(settings):
    book, rule = make(settings)
    step(rule, 90, 0)
    step(rule, 90, 30_000)
    [a] = book.list(open_only=True)
    book.acknowledge(a.id, "op@aera.dev", 31_000)
    assert a.state == "acknowledged" and a.acked_by == "op@aera.dev"
    book.resolve(a.id, "op@aera.dev", 32_000)
    rule.on_manual_resolve(a.key)
    step(rule, 90, 100_000)
    assert not book.list(open_only=True)
    step(rule, 30, 110_000)
    step(rule, 90, 120_000)
    step(rule, 90, 150_000)
    assert len(book.list(open_only=True)) == 1


def test_same_key_is_deduplicated(settings):
    book = AlertBook(settings)
    for t in (1, 2, 3):
        book.raise_alert("device_offline:KJ20:esp32-01", station_id="KJ20", type="device_offline",
                         title="t", message="m", public_message=None, at_ms=t, device_id="esp32-01")
    [a] = book.list()
    assert a.occurrences == 3 and a.severity == "medium"
    assert a.to_dict(public=True)["message"] is None
