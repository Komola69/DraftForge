from __future__ import annotations

from typing import Any

import requests
from loguru import logger

from config import (
    POCKETBASE_ADMIN_EMAIL,
    POCKETBASE_ADMIN_PASSWORD,
    POCKETBASE_URL,
    REQUEST_TIMEOUT_SECONDS,
)


class PocketBaseClient:
    def __init__(self) -> None:
        self.base_url = POCKETBASE_URL.rstrip("/")
        self.token = ""
        self._authenticate_admin()

    def _authenticate_admin(self) -> None:
        if not POCKETBASE_ADMIN_EMAIL or not POCKETBASE_ADMIN_PASSWORD:
            raise RuntimeError(
                "PocketBase admin credentials are missing. Set POCKETBASE_ADMIN_EMAIL and "
                "POCKETBASE_ADMIN_PASSWORD in engine/.env"
            )

        payload = {
            "identity": POCKETBASE_ADMIN_EMAIL,
            "password": POCKETBASE_ADMIN_PASSWORD,
        }

        auth_endpoints = [
            "/api/admins/auth-with-password",
            "/api/collections/_superusers/auth-with-password",
        ]

        last_error = None
        for endpoint in auth_endpoints:
            try:
                response = requests.post(
                    f"{self.base_url}{endpoint}",
                    json=payload,
                    timeout=REQUEST_TIMEOUT_SECONDS,
                )
                if response.status_code >= 400:
                    last_error = RuntimeError(
                        f"Auth failed on {endpoint}: {response.status_code} {response.text}"
                    )
                    continue
                body = response.json()
                self.token = body.get("token", "")
                if not self.token:
                    last_error = RuntimeError(f"Auth response did not include token on {endpoint}")
                    continue
                logger.info("PocketBase admin authenticated via {}", endpoint)
                return
            except requests.RequestException as exc:
                last_error = exc

        raise RuntimeError(f"PocketBase authentication failed: {last_error}")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def admin_request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> requests.Response:
        url = f"{self.base_url}{path}"
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=self._headers(),
                json=json_body,
                params=params,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            logger.error("PocketBase request error {} {}: {}", method, path, exc)
            raise

        if response.status_code >= 400:
            logger.error("PocketBase error {} {} -> {} {}", method, path, response.status_code, response.text)
            response.raise_for_status()

        return response

    def get_all(self, collection: str) -> list[dict[str, Any]]:
        response = self.admin_request(
            "GET",
            f"/api/collections/{collection}/records",
            params={"perPage": 500},
        )
        records = response.json().get("items", [])
        logger.info("Fetched {} records from {}", len(records), collection)
        return records

    def get_by_field(self, collection: str, field: str, value: Any) -> list[dict[str, Any]]:
        value_str = str(value).replace("'", "\\'")
        response = self.admin_request(
            "GET",
            f"/api/collections/{collection}/records",
            params={"filter": f"{field} = '{value_str}'", "perPage": 50},
        )
        records = response.json().get("items", [])
        logger.info("Fetched {} records from {} where {}={}", len(records), collection, field, value)
        return records

    def upsert(self, collection: str, data: dict[str, Any], unique_field: str) -> dict[str, Any]:
        if unique_field not in data:
            raise ValueError(f"unique_field '{unique_field}' missing in payload for {collection}")

        existing = self.get_by_field(collection, unique_field, data[unique_field])
        if existing:
            record_id = existing[0]["id"]
            response = self.admin_request(
                "PATCH",
                f"/api/collections/{collection}/records/{record_id}",
                json_body=data,
            )
            logger.info("Updated {} record {} by {}={}", collection, record_id, unique_field, data[unique_field])
            return response.json()

        response = self.admin_request(
            "POST",
            f"/api/collections/{collection}/records",
            json_body=data,
        )
        logger.info("Inserted {} record by {}={}", collection, unique_field, data[unique_field])
        return response.json()

    def delete(self, collection: str, record_id: str) -> None:
        self.admin_request("DELETE", f"/api/collections/{collection}/records/{record_id}")
        logger.info("Deleted {} record {}", collection, record_id)
