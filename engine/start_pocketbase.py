from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

import requests

from config import POCKETBASE_DATA_DIR, POCKETBASE_SERVER_DIR, POCKETBASE_URL


def find_pocketbase_binary() -> Path | None:
    candidates = [
        POCKETBASE_SERVER_DIR / "pocketbase",
        POCKETBASE_SERVER_DIR / "pocketbase.exe",
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def is_pocketbase_ready(timeout_seconds: int = 1) -> bool:
    try:
        response = requests.get(f"{POCKETBASE_URL}/api/health", timeout=timeout_seconds)
        return response.status_code == 200
    except requests.RequestException:
        return False


def start_pocketbase(background: bool = True, wait_seconds: int = 30) -> subprocess.Popen | None:
    binary = find_pocketbase_binary()
    if not binary:
        print("PocketBase binary not found.")
        print("Download PocketBase from https://pocketbase.io/docs and place the binary at:")
        print(str(POCKETBASE_SERVER_DIR / "pocketbase"))
        print("or")
        print(str(POCKETBASE_SERVER_DIR / "pocketbase.exe"))
        return None

    POCKETBASE_DATA_DIR.mkdir(parents=True, exist_ok=True)

    command = [
        str(binary),
        "serve",
        "--http=127.0.0.1:8090",
        f"--dir={POCKETBASE_DATA_DIR}",
    ]

    stdout = subprocess.DEVNULL if background else None
    stderr = subprocess.DEVNULL if background else None

    process = subprocess.Popen(command, cwd=str(POCKETBASE_SERVER_DIR), stdout=stdout, stderr=stderr)

    start = time.time()
    while time.time() - start <= wait_seconds:
        if is_pocketbase_ready():
            print("PocketBase is ready at http://127.0.0.1:8090")
            return process
        if process.poll() is not None:
            print("PocketBase process exited early.")
            return None
        time.sleep(0.5)

    print("PocketBase start timed out.")
    return None


if __name__ == "__main__":
    if is_pocketbase_ready():
        print("PocketBase is already running at http://127.0.0.1:8090")
        sys.exit(0)

    process = start_pocketbase(background=False)
    if not process:
        sys.exit(1)

    try:
        process.wait()
    except KeyboardInterrupt:
        process.terminate()
