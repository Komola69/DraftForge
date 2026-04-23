from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import requests
from loguru import logger

from config import LOG_LEVEL, POCKETBASE_URL
from engines.hero_stats_engine import run_hero_stats_engine
from start_pocketbase import is_pocketbase_ready, start_pocketbase


def _configure_logging() -> None:
    logger.remove()
    logger.add(sys.stdout, level=LOG_LEVEL)


def _ensure_pocketbase_running() -> None:
    if is_pocketbase_ready():
        logger.info("PocketBase already running at {}", POCKETBASE_URL)
        return

    process = start_pocketbase(background=True)
    if process is None:
        raise RuntimeError("Unable to start PocketBase. Check binary placement and credentials.")

    if not is_pocketbase_ready(timeout_seconds=2):
        raise RuntimeError("PocketBase did not become ready after startup.")

    logger.info("PocketBase started for pipeline execution")


def run_pipeline(engine: str | None = None, run_all: bool = False, dry_run: bool = False) -> dict[str, Any]:
    _configure_logging()
    _ensure_pocketbase_running()

    summary: dict[str, Any] = {"engines": []}

    if run_all or engine == "hero_stats" or (not engine and not run_all):
        logger.info("Running hero_stats engine")
        result = run_hero_stats_engine(dry_run=dry_run)
        summary["engines"].append({"name": "hero_stats", "result": result})

    logger.info("Pipeline complete: {}", summary)
    print("Overall pipeline report:", summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="DraftForge engine pipeline runner")
    parser.add_argument("--engine", choices=["hero_stats"], help="Run only a specific engine")
    parser.add_argument("--all", action="store_true", help="Run all engines in sequence")
    parser.add_argument("--dry-run", action="store_true", help="Run without writing to PocketBase")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_pipeline(engine=args.engine, run_all=args.all, dry_run=args.dry_run)
