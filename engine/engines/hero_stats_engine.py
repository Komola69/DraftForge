from __future__ import annotations

import asyncio
import time
from typing import Any

from loguru import logger

from collectors.hero_stats_collector import collect_hero_stats
from interpreters.hero_stats_interpreter import HeroStatsInterpreter
from validators.hero_stats_validator import HeroStatsValidator
from pocketbase.client import PocketBaseClient
from pocketbase.schema import ensure_heroes_collection


def run_hero_stats_engine(dry_run: bool = False) -> dict[str, Any]:
    logger.info("Starting Hero Stats Engine")
    start_time = time.time()

    pb_client = PocketBaseClient()
    if not dry_run:
        ensure_heroes_collection(pb_client)

    # 1. Collect
    hero_payloads = asyncio.run(collect_hero_stats())
    
    interpreter = HeroStatsInterpreter()
    validator = HeroStatsValidator()

    summary = {
        "total_heroes_processed": len(hero_payloads),
        "successfully_written": 0,
        "written_with_low_confidence": 0,
        "failed_completely": 0,
        "blocked_by_cloudflare": 0,
        "rejected_by_validator": 0,
        "time_taken_seconds": 0,
    }

    for hero_name, payload in hero_payloads.items():
        # Blocked check
        if "<title>Just a moment...</title>" in payload.get("raw_html", ""):
            logger.warning("Hero {} was blocked by Cloudflare challenge. Skipping.", hero_name)
            summary["blocked_by_cloudflare"] += 1
            summary["failed_completely"] += 1
            continue

        # 2. Interpret
        try:
            structured_data = interpreter.interpret(payload)
            
            # 3. Validate
            validated_data, report, is_valid = validator.validate(structured_data)

            if not is_valid:
                logger.error("Hero {} failed critical validation: {}. Skipping write.", hero_name, report)
                summary["rejected_by_validator"] += 1
                summary["failed_completely"] += 1
                continue

            # 4. Write
            if not dry_run:
                pb_client.upsert("heroes", validated_data, "name")
                summary["successfully_written"] += 1
                if validated_data["data_confidence"] == "LOW":
                    summary["written_with_low_confidence"] += 1
            else:
                logger.info("[DRY-RUN] Would have written {} to PocketBase", hero_name)
                summary["successfully_written"] += 1

        except Exception as exc:
            logger.error("Engine failed for {}: {}", hero_name, exc)
            summary["failed_completely"] += 1

    summary["time_taken_seconds"] = round(time.time() - start_time, 2)
    
    logger.info("Hero Stats Engine Summary: {}", summary)
    print("\n--- ENGINE 1 SUMMARY ---")
    print(f"TOTAL HEROES: {summary['total_heroes_processed']}")
    print(f"SUCCESSFUL: {summary['successfully_written']}")
    print(f"BLOCKED: {summary['blocked_by_cloudflare']}")
    print(f"REJECTED: {summary['rejected_by_validator']}")
    print(f"FAILED TOTAL: {summary['failed_completely']}")
    print(f"TIME: {summary['time_taken_seconds']}s")

    return summary
