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
    # Ask AERA (OpenRouter). Leave the key empty to show the advisor's cards without a chatbot.
    openrouter_api_key: str = ""
    openrouter_model: str = "openrouter/free"
    # GTFS Realtime vehicle positions for the line. data.gov.my has none for Rapid Rail yet
    # (Oct 2026); the watcher keeps checking and shows trains from it once it exists.
    # Empty turns the watcher off.
    gtfs_rt_url: str = "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-rail-kl"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


class Thresholds(BaseModel):
    """Percent of capacity at which each level starts (OCC-04)."""

    moderate: float = 40
    busy: float = 60
    crowded: float = 80

    @model_validator(mode="after")
    def _ordered(self) -> Thresholds:
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


class CrowdsourceSettings(BaseModel):
    """Crowding from riders' phones and train sensors (aera_twin.crowdsource)."""

    enabled: bool = True
    # Share of riders whose phone shares its location. Calibrate it by comparing phones
    # counted per day with data.gov.my gate counts for the same day.
    penetration: float = Field(default=0.02, gt=0, le=1)
    # Never publish a location count for a train with fewer phones than this (k-anonymity).
    min_devices: int = Field(default=3, ge=2, le=50)
    # An observation counts half as much after this long.
    half_life_s: int = Field(default=240, ge=30, le=3600)
    reports_per_hour: int = Field(default=12, ge=1, le=120)


def _crowd_levels_ok(v: list[float]) -> list[float]:
    if len(v) != 4 or not all(a < b for a, b in zip([0, *v], v)) or v[-1] > 200:
        raise ValueError("crowd_levels needs four rising percentages above 0, the last at most 200")
    return v


class Settings(BaseModel):
    thresholds: Thresholds = Field(default_factory=Thresholds)
    # In-train crowding: where Comfortable, Busy, Crowded and Packed start, in percent of
    # capacity (ADM-03). The browser's lib/crowd/levels.ts holds the same defaults.
    crowd_levels: list[float] = Field(default_factory=lambda: [20, 50, 75, 95])
    alerts: AlertSettings = Field(default_factory=AlertSettings)
    ingest: IngestLimits = Field(default_factory=IngestLimits)
    train: TrainSettings = Field(default_factory=TrainSettings)
    crowdsource: CrowdsourceSettings = Field(default_factory=CrowdsourceSettings)
    stations: dict[str, StationSettings] = Field(default_factory=dict)
    # "{station_id}:{zone_id}" -> capacity override (ADM-03)
    zone_capacity: dict[str, int] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_crowd(self) -> Settings:
        _crowd_levels_ok(self.crowd_levels)
        return self

    def station(self, station_id: str) -> StationSettings:
        return self.stations.setdefault(station_id, StationSettings())
