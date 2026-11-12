"""PgStore against a real Postgres (§11.7). Runs only when AERA_TEST_DATABASE_URL points at a
database that has db/schema.sql and db/backend_role.sql applied, e.g.
AERA_TEST_DATABASE_URL=postgresql://aera_backend:localtest@localhost/aera_test"""

import os

import pytest

from aera_twin.auth import seed_users
from aera_twin.store_pg import PgStore

DSN = os.environ.get("AERA_TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="AERA_TEST_DATABASE_URL not set")


@pytest.fixture
def clean():
    import psycopg

    with psycopg.connect(DSN) as conn:
        conn.execute("truncate aera.settings, aera.users, aera.devices, aera.incidents, aera.audit_log")
    yield


def test_records_survive_a_restart(clean):
    from aera_twin.store import Incident

    a = PgStore(DSN)
    a.load()
    seed_users(a, "admin-pass", "operator-pass", "KJ20")
    a.settings.thresholds.busy = 61
    a.record("admin@aera.dev", "settings.update", "thresholds", 1_000, before={"busy": 60}, after={"busy": 61})
    a.incidents.append(Incident(station_id="KJ20", type="safety", description="Spill on platform 2",
                                created_by="operator@aera.dev", created_at_ms=2_000))
    a.save()
    a.flush()

    b = PgStore(DSN)
    b.load()
    assert {u.email for u in b.users.values()} == {u.email for u in a.users.values()}
    assert b.user_by_email("admin@aera.dev").password_hash == a.user_by_email("admin@aera.dev").password_hash
    assert b.settings.thresholds.busy == 61
    assert [(e.action, e.after) for e in b.audit] == [("settings.update", {"busy": 61})]
    assert [i.description for i in b.incidents] == ["Spill on platform 2"]


def test_only_changes_are_written_and_removals_apply(clean):
    a = PgStore(DSN)
    a.load()
    seed_users(a, "x", "y", "KJ20")
    a.save()
    a.flush()
    victim = next(u for u in a.users.values() if u.role == "operator")
    del a.users[victim.id]
    a.save()
    a.flush()
    b = PgStore(DSN)
    b.load()
    assert victim.id not in b.users
    assert len(b.users) == len(a.users)


def test_unreachable_database_does_not_stop_start_up():
    s = PgStore("postgresql://nobody:nothing@127.0.0.1:1/none")
    s.load()  # logs and starts from defaults
    assert s.users == {}
