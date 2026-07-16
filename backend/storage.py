"""Object storage helper — Emergent object store."""
import os
import requests
import logging
from typing import Tuple

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "cobranzas-xd"

logger = logging.getLogger(__name__)
_storage_key: str | None = None


def _get_emergent_key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY", "")


def init_storage() -> str:
    """Init once, cache session key globally."""
    global _storage_key
    if _storage_key:
        return _storage_key
    emergent_key = _get_emergent_key()
    if not emergent_key:
        raise RuntimeError("EMERGENT_LLM_KEY no configurada")
    r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": emergent_key}, timeout=30)
    r.raise_for_status()
    _storage_key = r.json()["storage_key"]
    logger.info("Object storage initialized")
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if r.status_code == 403:
        # refresh key and retry once
        global _storage_key
        _storage_key = None
        key = init_storage()
        r = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    r.raise_for_status()
    return r.json()


def get_object(path: str) -> Tuple[bytes, str]:
    key = init_storage()
    r = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    if r.status_code == 403:
        global _storage_key
        _storage_key = None
        key = init_storage()
        r = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif",
    "webp": "image/webp", "pdf": "application/pdf", "json": "application/json",
    "csv": "text/csv", "txt": "text/plain", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel", "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "py": "text/x-python", "zip": "application/zip", "mp4": "video/mp4",
    "mp3": "audio/mpeg", "wav": "audio/wav",
}


def guess_mime(filename: str, fallback: str = "application/octet-stream") -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return MIME_TYPES.get(ext, fallback)
