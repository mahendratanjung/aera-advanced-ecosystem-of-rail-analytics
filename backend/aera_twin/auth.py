"""Development authentication with three roles (section 5).

Passengers need no account. Operators and admins sign in and receive a signed token. The
persistence step swaps this for Supabase Auth while keeping the same role checks.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time

import jwt
from fastapi import Depends, HTTPException, Request, status

from aera_twin.store import Store, User

TOKEN_TTL_S = 12 * 3600
ALGO = "HS256"
ITERATIONS = 120_000


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return f"pbkdf2${ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except ValueError:
        return False


def issue_token(user: User, secret: str) -> str:
    now = int(time.time())
    claims = {"sub": user.id, "role": user.role, "station_id": user.station_id, "iat": now,
              "exp": now + TOKEN_TTL_S}
    return jwt.encode(claims, secret, algorithm=ALGO)


def user_from_token(token: str | None, store: Store, secret: str) -> User | None:
    if not token:
        return None
    try:
        claims = jwt.decode(token, secret, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    user = store.users.get(claims.get("sub", ""))
    return user if user and user.active else None


def seed_users(store: Store, admin_password: str, operator_password: str, hero_station: str | None) -> bool:
    """Create the dev accounts on first start. Returns True when something was added."""
    if store.users:
        return False
    seeds = [
        ("admin@aera.dev", "AERA Admin", "admin", None, admin_password),
        ("operator@aera.dev", "Station Operator", "operator", hero_station, operator_password),
        ("operator.kls@aera.dev", "KL Sentral Operator", "operator", "KJ15", operator_password),
    ]
    for email, name, role, station, pw in seeds:
        u = User(email=email, display_name=name, role=role, station_id=station, password_hash=hash_password(pw))
        store.users[u.id] = u
    return True


# ---- FastAPI dependencies -----------------------------------------------------------------


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    return header[7:] if header.lower().startswith("bearer ") else None


def current_user(request: Request) -> User | None:
    twin = request.app.state.twin
    return user_from_token(_bearer(request), twin.store, twin.env.jwt_secret)


def require_user(user: User | None = Depends(current_user)) -> User:
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    return user


def can_access_station(user: User | None, station_id: str) -> bool:
    """OPS-02: operators see only their assigned station."""
    if not user:
        return False
    return user.role == "admin" or user.station_id == station_id


def ensure_station(user: User, station_id: str) -> None:
    if not can_access_station(user, station_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This station is not assigned to you")
