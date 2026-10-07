"""Environment configuration and admin-editable settings (BRS section 13)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SourceMode = Literal["device", "sim", "mixed"]
Severity = Literal["high", "medium", "low"]


class Env(BaseSettings):
    """Process configuration read from the environment or ``.env``."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="AERA_", extra="ignore")

    jwt_secret: str = "dev-only-change-me"
    admin_password: str = "aera-admin"
    operator_password: str = "aera-operator"
    cors_origins: str = "http://localhost:3000"
    sim_start: str = "now"
    mqtt_url: str = ""
    ingest_token: str = ""
    persist: bool = True
    seed: int = 20261007

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


class Thresholds(BaseModel):
    """Percent of capacity at which each level starts (OCC-04)."""

    moderate: float = 40
    busy: float = 60
    crowded: float = 80

    @model_validator(mode="after")
    def _ordered(self) -> "Thresholds":
        if not (0 < self.moderate < self.busy < self.crowded <= 200):
            raise ValueError("thresholds must satisfy 0 < moderate < busy < crowded")
        return self


class AlertSettings(BaseModel):
    crowd_hold_s: float = Field(default=30, ge=0)
    crowd_clear_s: float = Field(default=60, ge=0)
    heartbeat_s: float = Field(default=30, ge=5)
    severity: dict[str, Severity] = Field(
        default_factory=lambda: {
            "crowding": "high",
            "disruption_suspend": "high",
            "disruption": "medium",
            "unavailable": "medium",
            "device_offline": "medium",
            "abnormal": "low",
        }
    )


class IngestLimits(BaseModel):
    """Plausibility limits used to reject abnormal readings (IOT-06, section 9.7)."""

    max_crossings_per_s: float = 60
    ranges: dict[str, tuple[float, float]] = Field(
        default_factory=lambda: {"temperature_c": (-10, 60), "humidity_pct": (0, 100)}
    )


class StationSettings(BaseModel):
    source_mode: SourceMode = "sim"
    scale_factor: int = Field(default=1, ge=1, le=100)
    boarding_enabled: bool = True


class TrainSettings(BaseModel):
    # Rolling stock capacity is still to be confirmed (BRS section 13).
    capacity: int = Field(default=800, ge=50)
    default_dwell_s: int = Field(default=30, ge=5)


class Settings(BaseModel):
    thresholds: Thresholds = Field(default_factory=Thresholds)
    alerts: AlertSettings = Field(default_factory=AlertSettings)
    ingest: IngestLimits = Field(default_factory=IngestLimits)
    train: TrainSettings = Field(default_factory=TrainSettings)
    stations: dict[str, StationSettings] = Field(default_factory=dict)
    # "{station_id}:{zone_id}" -> capacity override (ADM-03)
    zone_capacity: dict[str, int] = Field(default_factory=dict)

    def station(self, station_id: str) -> StationSettings:
        return self.stations.setdefault(station_id, StationSettings())
