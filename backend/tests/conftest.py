import pytest

from aera_twin.config import Settings
from aera_twin.paths import STATIONS_DIR
from aera_twin.station import StationModel


@pytest.fixture
def station() -> StationModel:
    return StationModel.from_file(STATIONS_DIR / "KJ20.json")


@pytest.fixture
def settings() -> Settings:
    return Settings()
