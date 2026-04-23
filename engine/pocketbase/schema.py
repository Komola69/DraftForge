
from __future__ import annotations

from loguru import logger

from pocketbase.client import PocketBaseClient

HEROES_COLLECTION_NAME = "heroes"

# PocketBase v0.23+ Schema Format
HEROES_COLLECTION_SCHEMA = {
    "name": HEROES_COLLECTION_NAME,
    "type": "base",
    "fields": [
        {"name": "hero_id", "type": "number", "required": True, "unique": True},
        {"name": "name", "type": "text", "required": True, "unique": True},
        {"name": "roles", "type": "json", "required": True},
        {"name": "lanes", "type": "json", "required": True},
        {"name": "base_hp", "type": "number", "required": True},
        {"name": "base_hp_regen", "type": "number", "required": False},
        {"name": "base_mana", "type": "number", "required": False},
        {"name": "base_mana_regen", "type": "number", "required": False},
        {"name": "phys_attack", "type": "number", "required": True},
        {"name": "magic_power", "type": "number", "required": False},
        {"name": "phys_defense", "type": "number", "required": False},
        {"name": "magic_defense", "type": "number", "required": False},
        {"name": "movement_speed", "type": "number", "required": True},
        {"name": "attack_type", "type": "text", "required": True},
        {"name": "attack_speed", "type": "number", "required": False},
        {"name": "primary_damage_type", "type": "text", "required": True},
        {"name": "skills", "type": "json", "required": True},
        {"name": "specialty_tags", "type": "json", "required": True},
        {"name": "patch_version", "type": "text", "required": True},
        {"name": "last_updated", "type": "date", "required": True},
        {"name": "source_url", "type": "text", "required": True},
        {"name": "data_confidence", "type": "text", "required": True},
    ],
}

def ensure_heroes_collection(client: PocketBaseClient) -> None:
    try:
        response = client.admin_request("GET", f"/api/collections/{HEROES_COLLECTION_NAME}")
        existing = response.json()
        collection_id = existing["id"]
        
        # Merge existing system fields if necessary, or just overwrite non-system fields
        # In v0.23+, it's often safer to just send the fields we want to ensure
        client.admin_request("PATCH", f"/api/collections/{collection_id}", json_body=HEROES_COLLECTION_SCHEMA)
        logger.info("Updated PocketBase collection schema: {}", HEROES_COLLECTION_NAME)
    except Exception as e:
        logger.info("Collection does not exist or error fetching: {}. Attempting to create...", e)
        client.admin_request("POST", "/api/collections", json_body=HEROES_COLLECTION_SCHEMA)
        logger.info("Created PocketBase collection schema: {}", HEROES_COLLECTION_NAME)
