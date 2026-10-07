from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVICE_DIR.parent
DATA_DIR = REPO_ROOT / "data"
LINES_DIR = DATA_DIR / "lines"
STATIONS_DIR = DATA_DIR / "stations"
CONTRACTS_DIR = REPO_ROOT / "packages" / "contracts"
VAR_DIR = SERVICE_DIR / "var"
