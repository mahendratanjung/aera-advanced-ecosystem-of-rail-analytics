"""LOGIN-02: wrong passwords are throttled per address and email; a right one clears the count."""

from fastapi.testclient import TestClient

from aera_twin.config import Env
from aera_twin.main import create_app

ENV = Env(persist=False, jwt_secret="test-secret-that-is-at-least-32-bytes", mqtt_url="", sim_start="now", gtfs_rt_url="",
          openrouter_api_key="")


def test_five_wrong_passwords_lock_that_email_for_a_while():
    with TestClient(create_app(ENV)) as c:
        bad = {"email": "operator@aera.dev", "password": "nope"}
        for _ in range(5):
            assert c.post("/api/auth/login", json=bad).status_code == 401
        r = c.post("/api/auth/login", json={"email": "operator@aera.dev", "password": "aera-operator"})
        assert r.status_code == 429 and "Try again" in r.json()["detail"]
        # Another account from the same address is not locked.
        assert c.post("/api/auth/login", json={"email": "admin@aera.dev", "password": "aera-admin"}).status_code == 200


def test_a_right_password_clears_earlier_mistakes():
    with TestClient(create_app(ENV)) as c:
        for _ in range(4):
            c.post("/api/auth/login", json={"email": "admin@aera.dev", "password": "x"})
        assert c.post("/api/auth/login", json={"email": " admin@aera.dev ", "password": "aera-admin"}).status_code == 200
        for _ in range(4):
            assert c.post("/api/auth/login", json={"email": "admin@aera.dev", "password": "x"}).status_code == 401
