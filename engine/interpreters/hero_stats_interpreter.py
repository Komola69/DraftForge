from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from bs4 import BeautifulSoup
from loguru import logger

from config import PATCH_VERSION


VALID_HERO_TAGS = {
    "BLINK", "DASH", "CABLE", "ANTI_DASH", "SUPPRESS", "STUN", "SILENCE", "GROUNDED",
    "HEAL", "SHIELD", "REGEN", "SHIELD_SHRED", "ANTI_HEAL", "TRUE_DAMAGE",
    "POKE", "ARTILLERY", "DIVE", "BACKLINE_ACCESS", "AOE", "SINGLE_TARGET",
    "HIGH_DEFENSE", "DAMAGE_REDUCTION", "PERCENT_HP_DMG", "PENETRATION",
    "EARLY_GAME", "LATE_GAME", "MID_GAME", "BUFF_DEPENDENT", "BURST", "SUSTAIN",
}

ROLE_MAP = {
    "tank": "tank",
    "fighter": "fighter",
    "assassin": "assassin",
    "mage": "mage",
    "marksman": "marksman",
    "support": "support",
}

LANE_MAP = {
    "exp": "exp",
    "gold": "gold",
    "mid": "mid",
    "jungle": "jungle",
    "roam": "roam",
}

SPECIALTY_TO_TAG = {
    "charge": "DIVE",
    "poke": "POKE",
    "burst": "BURST",
    "regen": "REGEN",
    "damage": "SINGLE_TARGET",
    "guard": "HIGH_DEFENSE",
    "crowd control": "STUN",
    "initiator": "DIVE",
    "finisher": "BACKLINE_ACCESS",
}

SKILL_KEYWORD_TAGS = {
    "blink": "DASH",
    "dash": "DASH",
    "suppress": "SUPPRESS",
    "true damage": "TRUE_DAMAGE",
    "stun": "STUN",
    "silence": "SILENCE",
    "shield": "SHIELD",
    "heal": "HEAL",
    "regen": "REGEN",
    "anti-heal": "ANTI_HEAL",
    "grounded": "GROUNDED",
}


class HeroStatsInterpreter:
    def __init__(self) -> None:
        pass

    @staticmethod
    def _extract_first_number(text: str) -> float:
        match = re.search(r"(\d+(?:\.\d+)?)", text)
        return float(match.group(1)) if match else 0.0

    def _find_labeled_value(self, soup: BeautifulSoup, labels: list[str]) -> str:
        # Use regex for more flexible matching
        # If label starts with \b or contains regex chars, use it as is, else escape
        compiled_patterns = []
        for label in labels:
            pattern_str = label if "\\" in label else re.escape(label)
            compiled_patterns.append(re.compile(pattern_str, re.IGNORECASE))
        
        # 1. Check pi-data items (Portable Infobox)
        for item in soup.select(".pi-data"):
            lbl = item.select_one(".pi-data-label")
            val = item.select_one(".pi-data-value")
            if lbl and val:
                lbl_text = lbl.get_text(" ", strip=True)
                if any(p.search(lbl_text) for p in compiled_patterns):
                    return val.get_text(" ", strip=True)

        # 2. Check table rows (Attribute table)
        for row in soup.find_all("tr"):
            cells = row.find_all(["td", "th"])
            if len(cells) >= 2:
                lbl_text = cells[0].get_text(" ", strip=True)
                if any(p.search(lbl_text) for p in compiled_patterns):
                    val_text = cells[1].get_text(" ", strip=True)
                    return val_text

        return ""

    def _extract_roles(self, soup: BeautifulSoup) -> list[str]:
        val = self._find_labeled_value(soup, ["role", "class"])
        roles = []
        for key, normalized in ROLE_MAP.items():
            if re.search(rf"\b{key}\b", val.lower()):
                roles.append(normalized)
        return roles

    def _extract_lanes(self, soup: BeautifulSoup, roles: list[str]) -> list[str]:
        val = self._find_labeled_value(soup, ["lane", "laning", "position"])
        lanes = []
        for key, normalized in LANE_MAP.items():
            if re.search(rf"\b{key}\b", val.lower()):
                lanes.append(normalized)

        if lanes:
            return lanes

        if "marksman" in roles:
            return ["gold"]
        if "assassin" in roles:
            return ["jungle"]
        if "mage" in roles:
            return ["mid"]
        if "support" in roles or "tank" in roles:
            return ["roam"]
        return ["exp"]

    def _extract_attack_type(self, soup: BeautifulSoup) -> str:
        val = self._find_labeled_value(soup, ["attack type", "basic attack"])
        if "ranged" in val.lower():
            return "ranged"
        return "melee"

    def _extract_primary_damage(self, roles: list[str], skill_text: str) -> str:
        low = skill_text.lower()
        if "magic damage" in low or "mage" in roles:
            return "Magic"
        return "Physical"

    def _infer_damage_type(self, text: str) -> str:
        low = text.lower()
        if "true damage" in low:
            return "True"
        if "magic damage" in low:
            return "Magic"
        if "physical damage" in low:
            return "Physical"
        return "None"

    def _extract_skills(self, soup: BeautifulSoup) -> list[dict[str, Any]]:
        headings = [
            h for h in soup.find_all(["h2", "h3", "h4"])
            if any(k in h.get_text(" ", strip=True).lower() for k in ["passive", "skill", "ultimate"])
        ]

        slots = ["passive", "skill1", "skill2", "skill3", "ultimate"]
        skills: list[dict[str, Any]] = []

        for idx, heading in enumerate(headings[:5]):
            title = heading.get_text(" ", strip=True)
            desc_parts: list[str] = []
            node = heading.find_next_sibling()
            steps = 0
            while node is not None and node.name not in {"h2", "h3", "h4"} and steps < 12:
                text = node.get_text(" ", strip=True)
                if text:
                    desc_parts.append(text)
                node = node.find_next_sibling()
                steps += 1

            description = " ".join(desc_parts).strip()
            cooldown = 0.0
            cd_match = re.search(r"(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?", description.lower())
            if cd_match:
                cooldown = float(cd_match.group(1))

            skills.append(
                {
                    "name": title or f"Skill {idx + 1}",
                    "slot": slots[idx] if idx < len(slots) else "skill3",
                    "damage_type": self._infer_damage_type(description),
                    "cooldown": cooldown,
                    "description": description,
                    "tags": [],
                }
            )

        while len(skills) < 5:
            slot = slots[len(skills)]
            skills.append(
                {
                    "name": slot,
                    "slot": slot,
                    "damage_type": "None",
                    "cooldown": 0.0,
                    "description": "",
                    "tags": [],
                }
            )

        return skills

    def _extract_specialty_tags(self, soup: BeautifulSoup, skills: list[dict[str, Any]]) -> list[str]:
        tags = set()

        val = self._find_labeled_value(soup, ["specialty", "speciality", "specialties", "specialities"])
        low_val = val.lower()
        for keyword, tag in SPECIALTY_TO_TAG.items():
            if keyword in low_val:
                tags.add(tag)

        for skill in skills:
            low_desc = skill.get("description", "").lower()
            for keyword, tag in SKILL_KEYWORD_TAGS.items():
                if keyword in low_desc:
                    tags.add(tag)

        return sorted(list(tags & VALID_HERO_TAGS))

    def interpret(self, payload: dict[str, Any]) -> dict[str, Any]:
        stats_html = payload.get("stats_html", "")
        skills_html = payload.get("skills_html", "")
        hero_name = payload.get("hero_name", "Unknown")
        hero_id = payload.get("hero_id", 0)
        source_url = payload.get("source_url", "")

        stats_soup = BeautifulSoup(stats_html, "html.parser")
        skills_soup = BeautifulSoup(skills_html, "html.parser")

        roles = self._extract_roles(stats_soup)
        lanes = self._extract_lanes(stats_soup, roles)
        skills = self._extract_skills(skills_soup)
        skill_text = " ".join(skill["description"] for skill in skills)

        base_hp = self._extract_first_number(self._find_labeled_value(stats_soup, ["base hp", r"\bhp\b"]))
        base_hp_regen = self._extract_first_number(self._find_labeled_value(stats_soup, ["hp regen"]))
        base_mana = self._extract_first_number(self._find_labeled_value(stats_soup, ["base mana", r"\bmana\b"]))
        base_mana_regen = self._extract_first_number(self._find_labeled_value(stats_soup, ["mana regen"]))
        phys_attack = self._extract_first_number(self._find_labeled_value(stats_soup, ["physical attack", "phys atk", "physical atk"]))
        magic_power = self._extract_first_number(self._find_labeled_value(stats_soup, ["magic power", "magic atk"]))
        phys_defense = self._extract_first_number(self._find_labeled_value(stats_soup, ["physical defense", "phys def", "physical def"]))
        magic_defense = self._extract_first_number(self._find_labeled_value(stats_soup, ["magic defense", "magic def"]))
        movement_speed = self._extract_first_number(self._find_labeled_value(stats_soup, ["movement speed", "move speed"]))
        attack_speed = self._extract_first_number(self._find_labeled_value(stats_soup, ["attack speed"]))

        required_samples = [base_hp, phys_attack, movement_speed, len(roles), len(lanes)]
        missing_required_count = sum(1 for value in required_samples if not value)

        if missing_required_count == 0:
            confidence = "HIGH"
        elif missing_required_count <= 2:
            confidence = "MEDIUM"
        else:
            confidence = "LOW"

        structured = {
            "hero_id": int(hero_id),
            "name": hero_name,
            "roles": roles,
            "lanes": lanes,
            "base_hp": float(base_hp),
            "base_hp_regen": float(base_hp_regen),
            "base_mana": float(base_mana),
            "base_mana_regen": float(base_mana_regen),
            "phys_attack": float(phys_attack),
            "magic_power": float(magic_power),
            "phys_defense": float(phys_defense),
            "magic_defense": float(magic_defense),
            "movement_speed": float(movement_speed),
            "attack_type": self._extract_attack_type(stats_soup),
            "attack_speed": float(attack_speed),
            "primary_damage_type": self._extract_primary_damage(roles, skill_text),
            "skills": skills,
            "specialty_tags": self._extract_specialty_tags(stats_soup, skills),
            "patch_version": PATCH_VERSION,
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "source_url": source_url,
            "data_confidence": confidence,
        }

        logger.debug("Interpreted hero {} with confidence {}", hero_name, confidence)
        return structured
