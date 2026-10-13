"""FastAPI entrypoint.

    uv run uvicorn aera_twin.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from aera_twin.api.routes import router
from aera_twin.assistant import Assistant
from aera_twin.config import Env
from aera_twin.runtime import Twin

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("aera_twin")


def create_app(env: Env | None = None) -> FastAPI:
    env = env or Env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if env.jwt_secret == "dev-only-change-me":
            log.warning("AERA_JWT_SECRET is the development default. Set it before sharing this service.")
        if not env.ingest_token:
            log.warning("AERA_INGEST_TOKEN is empty: any device can send sensor readings. Set it before deploying.")
        twin = Twin(env)
        app.state.twin = twin
        await twin.start()
        yield
        await twin.stop()

    app = FastAPI(title="AERA twin service", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=env.cors_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.assistant = Assistant(env.openrouter_api_key, env.openrouter_model)
    app.include_router(router)
    return app


app = create_app()
