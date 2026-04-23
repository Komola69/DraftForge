from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup
from loguru import logger
from playwright.async_api import async_playwright

from config import HEADLESS_BROWSER, RAW_CACHE_DIR, REQUEST_TIMEOUT_SECONDS, SCRAPE_DELAY_SECONDS


HERO_NAMES = [
    "Miya", "Balmond", "Saber", "Alice", "Nana", "Tigreal", "Alucard", "Karina", "Akai", "Franco",
    "Bane", "Bruno", "Clint", "Rafaela", "Eudora", "Zilong", "Fanny", "Layla", "Minotaur", "Lolita",
    "Hayabusa", "Freya", "Gord", "Natalia", "Kagura", "Chou", "Sun", "Alpha", "Ruby", "Yi Sun-shin",
    "Moskov", "Johnson", "Cyclops", "Estes", "Hilda", "Aurora", "Lapu-Lapu", "Vexana", "Roger", "Karrie",
    "Gatotkaca", "Harley", "Irithel", "Grock", "Argus", "Odette", "Lancelot", "Diggie", "Hylos", "Zhask",
    "Helcurt", "Pharsa", "Lesley", "Jawhead", "Angela", "Gusion", "Valir", "Martis", "Uranus", "Hanabi",
    "Chang'e", "Kaja", "Selena", "Aldous", "Claude", "Vale", "Leomord", "Lunox", "Hanzo", "Belerick",
    "Kimmy", "Thamuz", "Harith", "Minsitthar", "Kadita", "Faramis", "Badang", "Khufra", "Granger", "Guinevere",
    "Esmeralda", "Terizla", "X.Borg", "Ling", "Dyrroth", "Lylia", "Baxia", "Masha", "Wanwan", "Silvanna",
    "Cecilion", "Carmilla", "Atlas", "Popol and Kupa", "Yu Zhong", "Luo Yi", "Benedetta", "Khaleed", "Barats", "Brody",
    "Yve", "Mathilda", "Paquito", "Gloo", "Beatrix", "Phoveus", "Natan", "Aulus", "Aamon", "Valentina",
    "Edith", "Floryn", "Yin", "Melissa", "Xavier", "Julian", "Fredrinn", "Joy", "Novaria", "Arlott",
    "Ixia", "Nolan", "Cici", "Chip", "Zhuxin", "Suyou", "Lukas", "Kalea", "Zetian", "Obsidia", "Sora", "Marcel",
]


def _hero_to_slug(hero_name: str) -> str:
    return hero_name.replace(" ", "_")


def _safe_file_name(hero_name: str) -> str:
    safe = hero_name.lower().replace(" ", "_").replace("'", "").replace(".", "")
    return f"{safe}.html"


def _extract_sections(full_html: str) -> tuple[str, str, str]:
    soup = BeautifulSoup(full_html, "html.parser")

    main_content = soup.select_one(".mw-parser-output")
    stats_node = main_content if main_content else soup.select_one("table.infoboxtable") or soup.select_one("aside.portable-infobox")

    skill_nodes = soup.select("h2, h3, div")
    skill_html_parts: list[str] = []
    for node in skill_nodes:
        text = node.get_text(" ", strip=True).lower()
        if any(keyword in text for keyword in ["passive", "skill", "ultimate"]):
            skill_html_parts.append(str(node))
    skills_html = "\n".join(skill_html_parts)

    bio_node = soup.select_one("#Lore")
    if bio_node:
        parent = bio_node.parent
        bio_html = str(parent) if parent else str(bio_node)
    else:
        bio_candidate = soup.find(lambda tag: tag.name in {"h2", "h3"} and "lore" in tag.get_text(" ", strip=True).lower())
        bio_html = str(bio_candidate) if bio_candidate else ""

    return str(stats_node) if stats_node else "", skills_html, bio_html


async def _collect_single(page, hero_name: str, hero_id: int) -> dict[str, Any] | None:
    RAW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = RAW_CACHE_DIR / _safe_file_name(hero_name)

    if cache_path.exists():
        raw_html = cache_path.read_text(encoding="utf-8", errors="ignore")
        stats_html, skills_html, bio_html = _extract_sections(raw_html)
        logger.info("Loaded cached HTML for {}", hero_name)
        return {
            "hero_id": hero_id,
            "hero_name": hero_name,
            "source_url": f"https://mobile-legends.fandom.com/wiki/{_hero_to_slug(hero_name)}",
            "raw_html": raw_html,
            "stats_html": stats_html,
            "skills_html": skills_html,
            "bio_html": bio_html,
        }

    source_url = f"https://mobile-legends.fandom.com/wiki/{_hero_to_slug(hero_name)}"
    try:
        await page.goto(source_url, wait_until="domcontentloaded", timeout=REQUEST_TIMEOUT_SECONDS * 1000)
        raw_html = await page.content()
        cache_path.write_text(raw_html, encoding="utf-8")
        stats_html, skills_html, bio_html = _extract_sections(raw_html)
        logger.info("Collected raw HTML for {}", hero_name)
        return {
            "hero_id": hero_id,
            "hero_name": hero_name,
            "source_url": source_url,
            "raw_html": raw_html,
            "stats_html": stats_html,
            "skills_html": skills_html,
            "bio_html": bio_html,
        }
    except Exception as exc:
        logger.error("Collector failed for {}: {}", hero_name, exc)
        return None


async def collect_hero_stats() -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    failed: list[tuple[int, str]] = []

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=HEADLESS_BROWSER)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        for hero_id, hero_name in enumerate(HERO_NAMES, start=1):
            payload = await _collect_single(page, hero_name, hero_id)
            if payload:
                results[hero_name] = payload
            else:
                failed.append((hero_id, hero_name))
            await asyncio.sleep(SCRAPE_DELAY_SECONDS)

        if failed:
            logger.warning("Retrying {} failed heroes", len(failed))
            retry_failed: list[tuple[int, str]] = []
            for hero_id, hero_name in failed:
                payload = await _collect_single(page, hero_name, hero_id)
                if payload:
                    results[hero_name] = payload
                else:
                    retry_failed.append((hero_id, hero_name))
                await asyncio.sleep(SCRAPE_DELAY_SECONDS)
            if retry_failed:
                logger.error("Collector failed after retry for {} heroes", len(retry_failed))

        await context.close()
        await browser.close()

    return results
