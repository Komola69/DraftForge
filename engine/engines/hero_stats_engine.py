from __future__ import annotations

import asyncio
import time
from typing import Any

from loguru import logger

from collectors.hero_stats_collector import collect_hero_stats
from interpreters.hero_stats_interpreter import HeroStatsInterpreter
from pocketbase.client import PocketBaseClient
from pocketbase.schema import ensure_heroes_collection
from validators.hero_stats_validator import HeroStatsValidator


def run_hero_stats_engine(dry_run: bool = False) -> dict[str, Any]:
    start_time = time.time()

    pb_client = None
    if not dry_run:
        pb_client = PocketBaseClient()
        ensure_heroes_collection(pb_client)

    collector_payload = asyncio.run(collect_hero_stats())

    interpreter = HeroStatsInterpreter()
    validator = HeroStatsValidator()

    total = len(collector_payload)
    success_written = 0
    low_confidence = 0
    failed = 0

    for hero_name, raw_payload in collector_payload.items():
        try:
            structured = interpreter.interpret(raw_payload)
            validated, report = validator.validate(structured)

            if validated.get("data_confidence") == "LOW":
                low_confidence += 1

            if dry_run:
                logger.info("Dry-run: validated hero {}", hero_name)
                success_written += 1
                continue

            assert pb_client is not None
            pb_client.upsert("heroes", validated, "name")
            success_written += 1
            logger.debug("Validation report for {}: {}", hero_name, report)
        except Exception as exc:
            failed += 1
            logger.error("Engine failed for {}: {}", hero_name, exc)

    duration = round(time.time() - start_time, 2)
    summary = {
        "total_heroes_processed": total,
        "successfully_written": success_written,
        "written_with_low_confidence": low_confidence,
        "failed_completely": failed,
        "time_taken_seconds": duration,
    }

    logger.info("Hero Stats Engine Summary: {}", summary)
    print("Total heroes processed:", summary["total_heroes_processed"])
    print("Successfully written:", summary["successfully_written"])
    print("Written with LOW confidence:", summary["written_with_low_confidence"])
    print("Failed completely:", summary["failed_completely"])
    print("Time taken:", summary["time_taken_seconds"], "seconds")

    return summary
