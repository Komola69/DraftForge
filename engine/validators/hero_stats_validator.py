from __future__ import annotations

from typing import Any

from loguru import logger


VALID_ROLES = {"tank", "fighter", "assassin", "mage", "marksman", "support"}
VALID_LANES = {"exp", "gold", "mid", "jungle", "roam"}
VALID_TAGS = {
    "BLINK", "DASH", "CABLE", "ANTI_DASH", "SUPPRESS", "STUN", "SILENCE", "GROUNDED",
    "HEAL", "SHIELD", "REGEN", "SHIELD_SHRED", "ANTI_HEAL", "TRUE_DAMAGE",
    "POKE", "ARTILLERY", "DIVE", "BACKLINE_ACCESS", "AOE", "SINGLE_TARGET",
    "HIGH_DEFENSE", "DAMAGE_REDUCTION", "PERCENT_HP_DMG", "PENETRATION",
    "EARLY_GAME", "LATE_GAME", "MID_GAME", "BUFF_DEPENDENT", "BURST", "SUSTAIN",
}

REQUIRED_FIELDS = {
    "hero_id": int,
    "name": str,
    "roles": list,
    "lanes": list,
    "base_hp": (int, float),
    "phys_attack": (int, float),
    "movement_speed": (int, float),
    "attack_type": str,
    "primary_damage_type": str,
    "skills": list,
    "specialty_tags": list,
    "patch_version": str,
    "last_updated": str,
    "source_url": str,
    "data_confidence": str,
}


class HeroStatsValidator:
    def validate(self, hero: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        report: dict[str, Any] = {
            "missing_fields": [],
            "invalid_types": [],
            "invalid_values": [],
            "warnings": [],
        }

        for field, expected_type in REQUIRED_FIELDS.items():
            if field not in hero:
                report["missing_fields"].append(field)
                continue
            if not isinstance(hero[field], expected_type):
                report["invalid_types"].append({"field": field, "expected": str(expected_type), "actual": str(type(hero[field]))})

        roles = [str(r).lower() for r in hero.get("roles", [])]
        if any(role not in VALID_ROLES for role in roles):
            report["invalid_values"].append("roles contain unsupported values")

        lanes = [str(l).lower() for l in hero.get("lanes", [])]
        if any(lane not in VALID_LANES for lane in lanes):
            report["invalid_values"].append("lanes contain unsupported values")

        tags = hero.get("specialty_tags", [])
        if any(tag not in VALID_TAGS for tag in tags):
            report["invalid_values"].append("specialty_tags contain unsupported values")

        base_hp = float(hero.get("base_hp", 0) or 0)
        movement_speed = float(hero.get("movement_speed", 0) or 0)
        phys_attack = float(hero.get("phys_attack", 0) or 0)

        if base_hp and not (1000 <= base_hp <= 10000):
            report["warnings"].append(f"base_hp out of expected range: {base_hp}")
        if movement_speed and not (200 <= movement_speed <= 320):
            report["warnings"].append(f"movement_speed out of expected range: {movement_speed}")
        if phys_attack and not (50 <= phys_attack <= 300):
            report["warnings"].append(f"phys_attack out of expected range: {phys_attack}")

        has_validation_failure = bool(report["missing_fields"] or report["invalid_types"] or report["invalid_values"])
        has_warning = bool(report["warnings"])

        if has_validation_failure or has_warning:
            hero["data_confidence"] = "LOW"
            logger.warning("Validation issues for {}: {}", hero.get("name", "unknown"), report)

        return hero, report
