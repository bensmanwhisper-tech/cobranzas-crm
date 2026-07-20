"""
storage.py — Almacenamiento LOCAL en disco.
Reemplaza el Object Storage de Emergent por una carpeta en el sistema de archivos.
Guarda los archivos en:  C:\\Cobranzas\\Archivos\\  (configurable con STORAGE_DIR)
"""
import os
import mimetypes
import logging
from pathlib import Path
from typing import Tuple

logger = logging.getLogger(__name__)

# Carpeta raíz donde se guardan todos los archivos subidos.
# Puede sobreescribirse con la variable de entorno STORAGE_DIR.
APP_NAME = "cobranzas-xd"
_DEFAULT_STORAGE_DIR = Path(r"C:\Cobranzas\Archivos")


def _base_dir() -> Path:
    custom = os.environ.get("STORAGE_DIR", "").strip()
    base = Path(custom) if custom else _DEFAULT_STORAGE_DIR
    base.mkdir(parents=True, exist_ok=True)
    return base


def init_storage() -> str:
    """Compatibilidad con el API anterior — en disco no hay sesión que iniciar."""
    d = _base_dir()
    logger.info(f"Storage local inicializado en: {d}")
    return str(d)


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Guarda 'data' en disco bajo la ruta relativa 'path'."""
    full = _base_dir() / path.lstrip("/\\")
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(data)
    logger.info(f"Archivo guardado: {full} ({len(data)} bytes)")
    return {"path": path, "size": len(data), "content_type": content_type}


def get_object(path: str) -> Tuple[bytes, str]:
    """Lee y devuelve (bytes, content_type) del archivo en 'path'."""
    full = _base_dir() / path.lstrip("/\\")
    if not full.exists():
        raise FileNotFoundError(f"Archivo no encontrado en disco: {full}")
    data = full.read_bytes()
    content_type = guess_mime(full.name)
    return data, content_type


def delete_object(path: str) -> bool:
    """Elimina el archivo del disco. Devuelve True si existía."""
    full = _base_dir() / path.lstrip("/\\")
    if full.exists():
        full.unlink()
        return True
    return False


MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif",
    "webp": "image/webp", "pdf": "application/pdf", "json": "application/json",
    "csv": "text/csv", "txt": "text/plain",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel", "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "py": "text/x-python", "zip": "application/zip", "mp4": "video/mp4",
    "mp3": "audio/mpeg", "wav": "audio/wav",
}


def guess_mime(filename: str, fallback: str = "application/octet-stream") -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return MIME_TYPES.get(ext, fallback)
