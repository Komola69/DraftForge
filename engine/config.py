from pathlib import Path
import os

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"

if ENV_PATH.exists():
    load_dotenv(ENV_PATH)

POCKETBASE_URL = "http://127.0.0.1:8090"
POCKETBASE_ADMIN_EMAIL = os.getenv("POCKETBASE_ADMIN_EMAIL", "")
POCKETBASE_ADMIN_PASSWORD = os.getenv("POCKETBASE_ADMIN_PASSWORD", "")

SCRAPE_DELAY_SECONDS = 2
REQUEST_TIMEOUT_SECONDS = 60
HEADLESS_BROWSER = True
PATCH_VERSION = "1.9.44"
LOG_LEVEL = "INFO"

RAW_CACHE_DIR = BASE_DIR / "cache" / "raw" / "heroes"
POCKETBASE_SERVER_DIR = BASE_DIR / "pocketbase_server"
POCKETBASE_DATA_DIR = POCKETBASE_SERVER_DIR / "pb_data"
