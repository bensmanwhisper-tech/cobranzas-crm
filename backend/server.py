"""
server.py — Cobranzas Command Center API
Backend 100% local: SQLite (aiosqlite) + almacenamiento en disco.
Sin dependencias de MongoDB, Emergent Object Storage ni emergentintegrations.
"""
from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Response, Query
from starlette.middleware.cors import CORSMiddleware
import os
import io
import csv
import json
import logging
import uuid
import httpx
import aiosqlite
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from storage import init_storage, put_object, get_object, guess_mime, APP_NAME, delete_object
from fx import get_rates, COUNTRY_CURRENCY

# ============================================================
# CONFIGURACIÓN DE RUTAS
# ============================================================
ROOT_DIR = Path(__file__).parent

# Base de datos SQLite: C:\Cobranzas\App\cobranzas.db
# Puede sobreescribirse con la variable de entorno DB_PATH
_DEFAULT_DB = Path(r"C:\Cobranzas\App\cobranzas.db")
DB_PATH = Path(os.environ.get("DB_PATH", str(_DEFAULT_DB)))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# ============================================================
# SQLite — helpers
# ============================================================

async def get_db() -> aiosqlite.Connection:
    """Abre (o reutiliza) la conexión global a SQLite."""
    return _db_conn


_db_conn: aiosqlite.Connection = None  # se inicializa en startup


async def init_db(conn: aiosqlite.Connection):
    """Crea todas las tablas si no existen."""
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("PRAGMA foreign_keys=ON")

    await conn.executescript("""
    CREATE TABLE IF NOT EXISTS configs (
        country     TEXT PRIMARY KEY,
        data        TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS contacts (
        id          TEXT PRIMARY KEY,
        country     TEXT NOT NULL,
        data        TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        estado      TEXT NOT NULL DEFAULT 'pendiente'
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_country  ON contacts(country);
    CREATE INDEX IF NOT EXISTS idx_contacts_status   ON contacts(status);
    CREATE INDEX IF NOT EXISTS idx_contacts_estado   ON contacts(estado);

    CREATE TABLE IF NOT EXISTS templates (
        id          TEXT PRIMARY KEY,
        country     TEXT NOT NULL,
        kind        TEXT NOT NULL,
        body        TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE(country, kind)
    );

    CREATE TABLE IF NOT EXISTS logs (
        id          TEXT PRIMARY KEY,
        ts          TEXT NOT NULL,
        level       TEXT NOT NULL,
        source      TEXT NOT NULL,
        message     TEXT NOT NULL,
        country     TEXT
    );

    CREATE TABLE IF NOT EXISTS dispatches (
        id          TEXT PRIMARY KEY,
        ts          TEXT NOT NULL,
        country     TEXT NOT NULL,
        channel     TEXT NOT NULL,
        total       INTEGER NOT NULL DEFAULT 0,
        sent        INTEGER NOT NULL DEFAULT 0,
        errors      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS files (
        id                  TEXT PRIMARY KEY,
        storage_path        TEXT NOT NULL,
        original_filename   TEXT NOT NULL,
        content_type        TEXT NOT NULL,
        size                INTEGER NOT NULL DEFAULT 0,
        category            TEXT NOT NULL DEFAULT 'other',
        country             TEXT,
        note                TEXT DEFAULT '',
        is_deleted          INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scripts (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        country     TEXT NOT NULL,
        added_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id          TEXT PRIMARY KEY,
        contact_id  TEXT,
        phone       TEXT NOT NULL,
        direction   TEXT NOT NULL DEFAULT 'outgoing',
        body        TEXT NOT NULL,
        msg_type    TEXT NOT NULL DEFAULT 'text',
        wa_msg_id   TEXT,
        status      TEXT NOT NULL DEFAULT 'sent',
        country     TEXT,
        created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wamsg_phone   ON whatsapp_messages(phone);
    CREATE INDEX IF NOT EXISTS idx_wamsg_contact ON whatsapp_messages(contact_id);

    CREATE TABLE IF NOT EXISTS whatsapp_meta_config (
        id              TEXT PRIMARY KEY DEFAULT 'global',
        access_token    TEXT NOT NULL DEFAULT '',
        phone_number_id TEXT NOT NULL DEFAULT '',
        waba_id         TEXT NOT NULL DEFAULT '',
        verify_token    TEXT NOT NULL DEFAULT 'cobranzas_xd_webhook_2024',
        updated_at      TEXT NOT NULL DEFAULT ''
    );
    """)
    await conn.commit()


# ============================================================
# Lifespan (startup / shutdown)
# ============================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _db_conn
    _db_conn = await aiosqlite.connect(str(DB_PATH))
    _db_conn.row_factory = aiosqlite.Row
    await init_db(_db_conn)
    try:
        init_storage()
        logger.info("Storage local inicializado")
    except Exception as e:
        logger.warning(f"Storage init warning: {e}")
    logger.info(f"Base de datos SQLite: {DB_PATH}")
    yield
    await _db_conn.close()


app = FastAPI(title="Cobranzas Command Center API", lifespan=lifespan)
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# ============================================================
# Utils
# ============================================================

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def make_id() -> str:
    return str(uuid.uuid4())

VALID_COUNTRIES = {"MX", "CO", "PE", "CL"}
VALID_STATUS    = {"pending", "sent", "error"}
CONTACT_ESTADOS = {"pendiente", "pagado", "sin_contacto", "parcial"}


def row_to_dict(row) -> dict:
    return dict(row) if row else {}


async def _contact_from_row(row) -> dict:
    d = row_to_dict(row)
    data = json.loads(d.get("data", "{}"))
    data["id"]         = d["id"]
    data["country"]    = d["country"]
    data["status"]     = d["status"]
    data["estado"]     = d["estado"]
    data["created_at"] = d["created_at"]
    data["updated_at"] = d["updated_at"]
    return data


# ============================================================
# Models (idénticos al original)
# ============================================================

class CountryConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    country: str
    collection_url: Optional[str] = ""
    script_name: Optional[str] = ""
    csv_folder: Optional[str] = r"C:\Cobranzas\CSV\\"
    scripts_folder: Optional[str] = r"C:\Cobranzas\App\backend\scripts_subidos\\"
    whatsapp_webhook_url: Optional[str] = ""
    whatsapp_api_key: Optional[str] = ""
    whatsapp_phone: Optional[str] = ""
    whatsapp_connected: Optional[bool] = False
    updated_at: Optional[str] = None


class ContactNote(BaseModel):
    id: str = Field(default_factory=make_id)
    ts: str = Field(default_factory=now_iso)
    text: str
    author: Optional[str] = "operador"


class ContactReminder(BaseModel):
    id: str = Field(default_factory=make_id)
    ts: str = Field(default_factory=now_iso)
    due_at: Optional[str] = None
    text: str
    done: bool = False


class Contact(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=make_id)
    nombre: str
    telefono: str
    monto: float = 0.0
    empresa: Optional[str] = ""
    solicitante: Optional[str] = ""
    vencimiento: Optional[str] = ""
    fecha: Optional[str] = ""
    hora: Optional[str] = ""
    dias_mora: int = 0
    app_cliente: Optional[str] = ""
    country: str
    status: str = "pending"
    last_error: Optional[str] = ""
    sms_enviado: bool = False
    formulario_guardado: bool = False
    estado: str = "pendiente"
    monto_recuperado: float = 0.0
    medio_contacto: Optional[str] = ""
    notas: List[ContactNote] = Field(default_factory=list)
    recordatorios: List[ContactReminder] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class ContactCreate(BaseModel):
    nombre: str
    telefono: str
    monto: float = 0.0
    empresa: Optional[str] = ""
    solicitante: Optional[str] = ""
    vencimiento: Optional[str] = ""
    fecha: Optional[str] = ""
    hora: Optional[str] = ""
    dias_mora: int = 0
    app_cliente: Optional[str] = ""
    country: str


class ContactUpdate(BaseModel):
    nombre: Optional[str] = None
    telefono: Optional[str] = None
    monto: Optional[float] = None
    monto_recuperado: Optional[float] = None
    empresa: Optional[str] = None
    solicitante: Optional[str] = None
    vencimiento: Optional[str] = None
    fecha: Optional[str] = None
    dias_mora: Optional[int] = None
    app_cliente: Optional[str] = None
    status: Optional[str] = None
    estado: Optional[str] = None
    medio_contacto: Optional[str] = None
    sms_enviado: Optional[bool] = None
    formulario_guardado: Optional[bool] = None


class Template(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=make_id)
    country: str
    kind: str
    body: str
    updated_at: str = Field(default_factory=now_iso)


class TemplateSave(BaseModel):
    country: str
    kind: str
    body: str


class LogEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=make_id)
    ts: str = Field(default_factory=now_iso)
    level: str
    source: str
    message: str
    country: Optional[str] = None


class LogCreate(BaseModel):
    level: str
    source: str
    message: str
    country: Optional[str] = None


class SendRequest(BaseModel):
    country: str
    contact_ids: List[str]
    template_kind: str = "default"
    channel: str = "whatsapp"
    template_override: Optional[str] = None


class ScriptRegister(BaseModel):
    name: str
    country: str


class ScriptRef(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=make_id)
    name: str
    country: str
    added_at: str = Field(default_factory=now_iso)


class FileRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=make_id)
    storage_path: str
    original_filename: str
    content_type: str
    size: int
    category: str = "other"
    country: Optional[str] = None
    note: Optional[str] = ""
    is_deleted: bool = False
    created_at: str = Field(default_factory=now_iso)


class NoteCreate(BaseModel):
    text: str
    author: Optional[str] = "operador"


class ReminderCreate(BaseModel):
    text: str
    due_at: Optional[str] = None


class RecoveryPayload(BaseModel):
    monto_recuperado: float
    marcar_pagado: bool = False


# ============================================================
# Helpers internos
# ============================================================

async def add_log(level: str, source: str, message: str, country: Optional[str] = None):
    entry = LogEntry(level=level, source=source, message=message, country=country)
    db = await get_db()
    await db.execute(
        "INSERT INTO logs (id,ts,level,source,message,country) VALUES (?,?,?,?,?,?)",
        (entry.id, entry.ts, entry.level, entry.source, entry.message, entry.country),
    )
    await db.commit()
    return entry


def render_template(body: str, contact: Dict[str, Any]) -> str:
    out = body or ""
    mapping = {
        "{nombre}":     str(contact.get("nombre", "")),
        "{monto}":      f"{contact.get('monto', 0)}",
        "{fecha}":      str(contact.get("fecha", "")),
        "{empresa}":    str(contact.get("empresa", "")),
        "{vencimiento}": str(contact.get("vencimiento", "")),
        "{telefono}":   str(contact.get("telefono", "")),
        "{dias_mora}":  str(contact.get("dias_mora", 0)),
        "{app_cliente}": str(contact.get("app_cliente", "")),
    }
    for k, v in mapping.items():
        out = out.replace(k, v)
    return out


async def _get_contact_dict(contact_id: str) -> Optional[dict]:
    db = await get_db()
    async with db.execute("SELECT * FROM contacts WHERE id=?", (contact_id,)) as cur:
        row = await cur.fetchone()
    return await _contact_from_row(row) if row else None


async def _save_contact(c: Contact):
    """Inserta un contacto nuevo en SQLite."""
    db = await get_db()
    payload = c.model_dump()
    # columnas indexadas se guardan directamente; el resto en JSON
    data = {k: v for k, v in payload.items()
            if k not in ("id", "country", "status", "estado", "created_at", "updated_at")}
    await db.execute(
        """INSERT INTO contacts (id,country,data,created_at,updated_at,status,estado)
           VALUES (?,?,?,?,?,?,?)""",
        (c.id, c.country, json.dumps(data), c.created_at, c.updated_at, c.status, c.estado),
    )
    await db.commit()


async def _patch_contact(contact_id: str, patch: dict):
    """Aplica un patch parcial a un contacto existente."""
    existing = await _get_contact_dict(contact_id)
    if not existing:
        return None
    # campos de columnas directas
    direct_update = {}
    if "status" in patch:
        direct_update["status"] = patch.pop("status")
    if "estado" in patch:
        direct_update["estado"] = patch.pop("estado")
    if "updated_at" in patch:
        direct_update["updated_at"] = patch.pop("updated_at")

    # resto va a JSON
    data = {k: v for k, v in existing.items()
            if k not in ("id", "country", "status", "estado", "created_at", "updated_at")}
    data.update(patch)

    direct_update["data"] = json.dumps(data)
    direct_update.setdefault("updated_at", now_iso())

    set_clause = ", ".join(f"{k}=?" for k in direct_update)
    values = list(direct_update.values()) + [contact_id]
    db = await get_db()
    await db.execute(f"UPDATE contacts SET {set_clause} WHERE id=?", values)
    await db.commit()
    return await _get_contact_dict(contact_id)


# ============================================================
# Config
# ============================================================

@api_router.get("/config/{country}", response_model=CountryConfig)
async def get_config(country: str):
    country = country.upper()
    if country not in VALID_COUNTRIES:
        raise HTTPException(400, "Invalid country")
    db = await get_db()
    async with db.execute("SELECT data FROM configs WHERE country=?", (country,)) as cur:
        row = await cur.fetchone()
    if row:
        return CountryConfig(**{**json.loads(row["data"]), "country": country})
    cfg = CountryConfig(country=country, updated_at=now_iso())
    await db.execute("INSERT INTO configs (country,data) VALUES (?,?)",
                     (country, json.dumps(cfg.model_dump())))
    await db.commit()
    return cfg


@api_router.put("/config/{country}", response_model=CountryConfig)
async def update_config(country: str, cfg: CountryConfig):
    country = country.upper()
    if country not in VALID_COUNTRIES:
        raise HTTPException(400, "Invalid country")
    cfg.country = country
    cfg.updated_at = now_iso()
    db = await get_db()
    await db.execute(
        "INSERT INTO configs (country,data) VALUES (?,?) ON CONFLICT(country) DO UPDATE SET data=excluded.data",
        (country, json.dumps(cfg.model_dump())),
    )
    await db.commit()
    await add_log("success", "Sistema", f"Configuración guardada para {country}", country)
    return cfg


@api_router.get("/config", response_model=List[CountryConfig])
async def list_configs():
    db = await get_db()
    async with db.execute("SELECT country,data FROM configs") as cur:
        rows = await cur.fetchall()
    return [CountryConfig(**{**json.loads(r["data"]), "country": r["country"]}) for r in rows]


# ============================================================
# Contacts
# ============================================================

@api_router.get("/contacts", response_model=List[Contact])
async def list_contacts(
    country: Optional[str] = None,
    status: Optional[str] = None,
    estado: Optional[str] = None,
    limit: int = 500,
):
    where, params = [], []
    if country and country.upper() != "ALL":
        where.append("country=?"); params.append(country.upper())
    if status and status != "all":
        where.append("status=?"); params.append(status)
    if estado and estado != "all":
        where.append("estado=?"); params.append(estado)
    sql = "SELECT * FROM contacts"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    db = await get_db()
    async with db.execute(sql, params) as cur:
        rows = await cur.fetchall()
    return [Contact(**await _contact_from_row(r)) for r in rows]


@api_router.post("/contacts", response_model=Contact)
async def create_contact(payload: ContactCreate):
    if payload.country.upper() not in VALID_COUNTRIES:
        raise HTTPException(400, "Invalid country")
    contact = Contact(**payload.model_dump())
    contact.country = contact.country.upper()
    await _save_contact(contact)
    await add_log("info", "User", f"Contacto agregado: {contact.nombre}", contact.country)
    return contact


@api_router.patch("/contacts/{contact_id}", response_model=Contact)
async def update_contact(contact_id: str, upd: ContactUpdate):
    existing = await _get_contact_dict(contact_id)
    if not existing:
        raise HTTPException(404, "Not found")
    patch = {k: v for k, v in upd.model_dump().items() if v is not None}
    patch["updated_at"] = now_iso()
    if patch.get("status") and patch["status"] not in VALID_STATUS:
        raise HTTPException(400, "Invalid status")
    if patch.get("estado") and patch["estado"] not in CONTACT_ESTADOS:
        raise HTTPException(400, "Invalid estado")
    if "estado" in patch and "monto_recuperado" not in patch:
        monto = float(existing.get("monto") or 0)
        current_rec = float(existing.get("monto_recuperado") or 0)
        if patch["estado"] == "pagado":
            patch["monto_recuperado"] = monto
        elif patch["estado"] in {"pendiente", "sin_contacto"}:
            if current_rec >= monto and monto > 0:
                patch["monto_recuperado"] = 0.0
    updated = await _patch_contact(contact_id, patch)
    if patch.get("estado"):
        await add_log("info", "User", f"Estado→{patch['estado']}: {existing.get('nombre')}", existing.get("country"))
    return Contact(**updated)


@api_router.post("/contacts/{contact_id}/notes", response_model=Contact)
async def add_note(contact_id: str, payload: NoteCreate):
    existing = await _get_contact_dict(contact_id)
    if not existing:
        raise HTTPException(404, "Not found")
    note = ContactNote(text=payload.text, author=payload.author or "operador")
    notas = existing.get("notas", []) + [note.model_dump()]
    updated = await _patch_contact(contact_id, {"notas": notas})
    await add_log("info", "User", f"Nota agregada a {existing.get('nombre')}", existing.get("country"))
    return Contact(**updated)


@api_router.delete("/contacts/{contact_id}/notes/{note_id}", response_model=Contact)
async def delete_note(contact_id: str, note_id: str):
    existing = await _get_contact_dict(contact_id)
    if not existing:
        raise HTTPException(404, "Not found")
    notas = [n for n in existing.get("notas", []) if n["id"] != note_id]
    updated = await _patch_contact(contact_id, {"notas": notas})
    return Contact(**updated)


@api_router.post("/contacts/{contact_id}/reminders", response_model=Contact)
async def add_reminder(contact_id: str, payload: ReminderCreate):
    existing = await _get_contact_dict(contact_id)
    if not existing:
        raise HTTPException(404, "Not found")
    r = ContactReminder(text=payload.text, due_at=payload.due_at)
    recordatorios = existing.get("recordatorios", []) + [r.model_dump()]
    updated = await _patch_contact(contact_id, {"recordatorios": recordatorios})
    await add_log("info", "User", f"Recordatorio: {existing.get('nombre')}", existing.get("country"))
    return Contact(**updated)


@api_router.patch("/contacts/{contact_id}/reminders/{reminder_id}/toggle", response_model=Contact)
async def toggle_reminder(contact_id: str, reminder_id: str):
    existing = await _get_contact_dict(contact_id)
    if not existing:
        raise HTTPException(404, "Not found")
    recordatorios = existing.get("recordatorios", [])
    for r in recordatorios:
        if r["id"] == reminder_id:
            r["done"] = not r.get("done", False)
    updated = await _patch_contact(contact_id, {"recordatorios": recordatorios})
    return Contact(**updated)


@api_router.delete("/contacts/{contact_id}/reminders/{reminder_id}", response_model=Contact)
async def delete_reminder(contact_id: str, reminder_id: str):
    existing = await _get_contact_dict(contact_id)
    if not existing:
        raise HTTPException(404, "Not found")
    recordatorios = [r for r in existing.get("recordatorios", []) if r["id"] != reminder_id]
    updated = await _patch_contact(contact_id, {"recordatorios": recordatorios})
    return Contact(**updated)


@api_router.patch("/contacts/{contact_id}/recovered", response_model=Contact)
async def set_recovered(contact_id: str, payload: RecoveryPayload):
    existing = await _get_contact_dict(contact_id)
    if not existing:
        raise HTTPException(404, "Not found")
    monto = float(existing.get("monto") or 0)
    upd = {"monto_recuperado": payload.monto_recuperado, "updated_at": now_iso()}
    if payload.marcar_pagado or payload.monto_recuperado >= monto:
        upd["estado"] = "pagado"
    elif payload.monto_recuperado > 0:
        upd["estado"] = "parcial"
    updated = await _patch_contact(contact_id, upd)
    await add_log("success", "Recuperación",
                  f"${payload.monto_recuperado} recuperado de {existing.get('nombre')}",
                  existing.get("country"))
    return Contact(**updated)


@api_router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str):
    db = await get_db()
    cur = await db.execute("DELETE FROM contacts WHERE id=?", (contact_id,))
    await db.commit()
    return {"deleted": cur.rowcount}


@api_router.post("/contacts/bulk-delete")
async def bulk_delete_contacts(payload: Dict[str, List[str]]):
    ids = payload.get("ids", [])
    if not ids:
        return {"deleted": 0}
    db = await get_db()
    placeholders = ",".join("?" * len(ids))
    cur = await db.execute(f"DELETE FROM contacts WHERE id IN ({placeholders})", ids)
    await db.commit()
    await add_log("warn", "User", f"Se eliminaron {cur.rowcount} contactos")
    return {"deleted": cur.rowcount}


def parse_row_to_contact(r: Dict[str, str], country: str, dial_code: Optional[str] = None) -> Optional[Contact]:
    nombre = r.get("nombre") or r.get("name") or r.get("cliente") or ""
    raw_phone = (r.get("telefono") or r.get("teléfono") or r.get("phone") or r.get("celular")
                 or r.get("numero") or r.get("número") or "")
    if not nombre and not raw_phone:
        return None
    telefono = normalize_phone(raw_phone, dial_code) if dial_code else raw_phone

    def _num(v):
        try:
            return float(str(v).replace(",", "").replace("$", "").strip() or 0)
        except Exception:
            return 0.0

    def _int(v):
        try:
            return int(float(str(v).strip() or 0))
        except Exception:
            return 0

    def _bool_check(v):
        if v is None:
            return False
        return str(v).strip().lower() in {"✅", "true", "yes", "sí", "si", "1", "x", "ok", "checked"}

    monto = _num(r.get("monto") or r.get("amount") or "0")
    dias_mora = _int(r.get("dias_mora") or r.get("dias") or r.get("mora") or "0")
    solicitante = r.get("solicitante") or r.get("institucion") or r.get("institución") or ""
    app_cliente = r.get("app_cliente") or r.get("app") or r.get("aplicacion") or r.get("aplicación") or solicitante

    return Contact(
        nombre=nombre or "Sin nombre",
        telefono=telefono,
        monto=monto,
        empresa=r.get("empresa") or r.get("company") or "",
        solicitante=solicitante,
        vencimiento=r.get("vencimiento") or r.get("due") or "",
        fecha=r.get("fecha") or r.get("date") or "",
        hora=r.get("hora") or r.get("time") or "",
        dias_mora=dias_mora,
        app_cliente=app_cliente,
        sms_enviado=_bool_check(r.get("sms")),
        formulario_guardado=_bool_check(r.get("formulario_guardado") or r.get("formulario")),
        country=country,
    )


@api_router.post("/contacts/import")
async def import_contacts(country: str = Form(...), file: UploadFile = File(...)):
    country = country.upper()
    if country not in VALID_COUNTRIES:
        raise HTTPException(400, "Invalid country")
    content = (await file.read()).decode("utf-8-sig", errors="ignore")
    reader = csv.DictReader(io.StringIO(content))
    inserted = 0
    errors = 0
    for row in reader:
        try:
            r = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            c = parse_row_to_contact(r, country)
            if not c:
                errors += 1
                continue
            await _save_contact(c)
            inserted += 1
        except Exception:
            errors += 1
    await add_log("success", "Import", f"CSV importado: {inserted} registros, {errors} errores", country)
    return {"inserted": inserted, "errors": errors, "filename": file.filename}


@api_router.post("/contacts/seed-demo")
async def seed_demo(country: Optional[str] = None):
    demo_data = [
        ("Carlos Ramírez",     "+52 55 1234 5678",  4520.50,  "Grupo Aguila",          "MX", 15,  "Kueski"),
        ("María López",        "+52 33 2345 6789",  8900.00,  "Cementos MX",           "MX", 45,  "Nu"),
        ("José Hernández",     "+52 81 3456 7890",  1250.75,  "Autopartes SA",         "MX", 8,   "Rappi Pay"),
        ("Ana García",         "+52 55 4567 8901",  15600.00, "Constructora del Norte","MX", 60,  "Kueski"),
        ("Andrés Torres",      "+57 300 111 2233",  3200.00,  "Bavaria SA",            "CO", 22,  "Nequi"),
        ("Diana Vargas",       "+57 301 222 3344",  7800.90,  "Ecopetrol",             "CO", 90,  "Daviplata"),
        ("Camilo Ruiz",        "+57 310 333 4455",  2100.00,  "Bancolombia",           "CO", 5,   "Nequi"),
        ("Rocío Mendoza",      "+51 987 654 321",   5600.00,  "Backus SA",             "PE", 30,  "Yape"),
        ("Luis Quispe",        "+51 986 543 210",   12400.00, "Alicorp",               "PE", 120, "Plin"),
        ("Fernanda Castillo",  "+51 985 432 109",   890.00,   "Interbank",             "PE", 12,  "Yape"),
        ("Sebastián Rojas",    "+56 9 8765 4321",   6700.00,  "Falabella",             "CL", 18,  "Mach"),
        ("Valentina Núñez",    "+56 9 7654 3210",   3400.50,  "Cencosud",              "CL", 40,  "Fpay"),
        ("Matías Pérez",       "+56 9 6543 2109",   9200.00,  "Copec SA",              "CL", 75,  "Mach"),
    ]
    inserted = 0
    for nombre, tel, monto, empresa, cty, mora, app_cli in demo_data:
        if country and country.upper() != cty:
            continue
        c = Contact(nombre=nombre, telefono=tel, monto=monto, empresa=empresa,
                    vencimiento="2026-03-15", fecha=datetime.now().strftime("%Y-%m-%d"),
                    dias_mora=mora, app_cliente=app_cli, country=cty)
        await _save_contact(c)
        inserted += 1
    await add_log("info", "Sistema", f"Demo seed: {inserted} contactos agregados")
    return {"inserted": inserted}


# ============================================================
# Templates
# ============================================================

DEFAULT_TEMPLATES = {
    "nivel_1":  "🟢 Hola {nombre} 👋 Te escribimos con un recordatorio amistoso: tienes un saldo pendiente de {monto} con {app_cliente} y llevas {dias_mora} días. Regularicemos hoy y aprovecha nuestros descuentos y facilidades. ¡Estamos para ayudarte!",
    "nivel_2":  "🟡 {nombre}, tu cuenta con {app_cliente} lleva {dias_mora} días de mora y el saldo pendiente es {monto}. Necesitamos regularizar tu situación HOY. Responde este mensaje para agendar tu acuerdo de pago.",
    "nivel_3":  "🟠 ATENCIÓN {nombre}: Este es tu aviso FINAL. Tu cuenta con {app_cliente} presenta {dias_mora} días de mora y el saldo es {monto}. Es la última oportunidad antes de iniciar acciones administrativas. Contáctanos de inmediato.",
    "nivel_4":  "🔴 ADVERTENCIA LEGAL. {nombre}, tu cuenta con {app_cliente} lleva {dias_mora} días de mora con saldo {monto}. Al no regularizar tu deuda, tus datos serán reportados a buró de crédito y se iniciará el proceso legal correspondiente. Regulariza ya.",
    "default":  "🟢 Hola {nombre}, le recordamos que tiene un saldo pendiente de {monto} con {app_cliente}. Lleva {dias_mora} días de mora. Gracias.",
    "friendly": "🟢 Hola {nombre} 👋 Solo un recordatorio amistoso: tienes un saldo de {monto} con {app_cliente}. Llevas {dias_mora} días.",
    "formal":   "🟠 Estimado(a) {nombre}: Le informamos que su cuenta con {app_cliente} presenta un saldo pendiente de {monto} y {dias_mora} días de mora.",
    "urgent":   "🔴 ⚠️ URGENTE: {nombre}, su cuenta con {app_cliente} lleva {dias_mora} días de mora. Saldo: {monto}. Contáctenos de inmediato.",
}


@api_router.get("/templates/{country}", response_model=List[Template])
async def get_templates(country: str):
    country = country.upper()
    db = await get_db()
    async with db.execute("SELECT * FROM templates WHERE country=?", (country,)) as cur:
        rows = await cur.fetchall()
    existing = {r["kind"]: r for r in rows}
    result = []
    for kind, body in DEFAULT_TEMPLATES.items():
        if kind not in existing:
            t = Template(country=country, kind=kind, body=body)
            await db.execute(
                "INSERT INTO templates (id,country,kind,body,updated_at) VALUES (?,?,?,?,?)",
                (t.id, t.country, t.kind, t.body, t.updated_at),
            )
            result.append(t)
        else:
            r = existing[kind]
            result.append(Template(id=r["id"], country=r["country"],
                                   kind=r["kind"], body=r["body"], updated_at=r["updated_at"]))
    await db.commit()
    return result


@api_router.put("/templates", response_model=Template)
async def save_template(payload: TemplateSave):
    country = payload.country.upper()
    if country not in VALID_COUNTRIES:
        raise HTTPException(400, "Invalid country")
    db = await get_db()
    ts = now_iso()
    await db.execute(
        """INSERT INTO templates (id,country,kind,body,updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(country,kind) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at""",
        (make_id(), country, payload.kind, payload.body, ts),
    )
    await db.commit()
    async with db.execute("SELECT * FROM templates WHERE country=? AND kind=?", (country, payload.kind)) as cur:
        row = await cur.fetchone()
    await add_log("success", "User", f"Plantilla {payload.kind} guardada", country)
    return Template(id=row["id"], country=row["country"], kind=row["kind"],
                    body=row["body"], updated_at=row["updated_at"])


# ============================================================
# Logs
# ============================================================

@api_router.get("/logs", response_model=List[LogEntry])
async def get_logs(limit: int = 100, country: Optional[str] = None):
    db = await get_db()
    if country and country.upper() != "ALL":
        async with db.execute(
            "SELECT * FROM logs WHERE country=? ORDER BY ts DESC LIMIT ?",
            (country.upper(), limit)
        ) as cur:
            rows = await cur.fetchall()
    else:
        async with db.execute("SELECT * FROM logs ORDER BY ts DESC LIMIT ?", (limit,)) as cur:
            rows = await cur.fetchall()
    return [LogEntry(**dict(r)) for r in rows]


@api_router.post("/logs", response_model=LogEntry)
async def create_log(payload: LogCreate):
    return await add_log(payload.level, payload.source, payload.message, payload.country)


@api_router.delete("/logs")
async def clear_logs():
    db = await get_db()
    cur = await db.execute("DELETE FROM logs")
    await db.commit()
    return {"deleted": cur.rowcount}


# ============================================================
# Send Messages
# ============================================================

@api_router.post("/send")
async def send_messages(req: SendRequest):
    country = req.country.upper()
    if country not in VALID_COUNTRIES:
        raise HTTPException(400, "Invalid country")

    if req.template_override:
        body_tpl = req.template_override
    else:
        db = await get_db()
        async with db.execute("SELECT body FROM templates WHERE country=? AND kind=?",
                              (country, req.template_kind)) as cur:
            row = await cur.fetchone()
        body_tpl = row["body"] if row else DEFAULT_TEMPLATES.get(req.template_kind, DEFAULT_TEMPLATES["default"])

    cfg_row = None
    db = await get_db()
    async with db.execute("SELECT data FROM configs WHERE country=?", (country,)) as cur:
        cfg_row = await cur.fetchone()
    cfg = json.loads(cfg_row["data"]) if cfg_row else {}
    webhook_url = cfg.get("whatsapp_webhook_url", "").strip()
    api_key     = cfg.get("whatsapp_api_key", "").strip()

    placeholders = ",".join("?" * len(req.contact_ids))
    async with db.execute(f"SELECT * FROM contacts WHERE id IN ({placeholders})", req.contact_ids) as cur:
        rows = await cur.fetchall()
    contacts = [await _contact_from_row(r) for r in rows]

    sent = 0; errors = 0; results = []
    async with httpx.AsyncClient(timeout=15.0) as http:
        for c in contacts:
            rendered = render_template(body_tpl, c)
            success = False; err_msg = ""
            if req.channel == "whatsapp" and webhook_url:
                try:
                    headers = {"Content-Type": "application/json"}
                    if api_key:
                        headers["Authorization"] = f"Bearer {api_key}"
                    r = await http.post(webhook_url, json={
                        "phone": c["telefono"], "message": rendered,
                        "country": country, "contact_id": c["id"],
                    }, headers=headers)
                    success = 200 <= r.status_code < 300
                    if not success:
                        err_msg = f"HTTP {r.status_code}: {r.text[:120]}"
                except Exception as e:
                    err_msg = f"Webhook error: {str(e)[:120]}"
            else:
                success = True
                err_msg = "(sin webhook — registrado como enviado)"

            new_status = "sent" if success else "error"
            await _patch_contact(c["id"], {"status": new_status, "last_error": err_msg})
            if success:
                sent += 1
                await add_log("success", req.channel.upper(), f"→ {c['nombre']} ({c['telefono']})", country)
            else:
                errors += 1
                await add_log("error", req.channel.upper(), f"✖ {c['nombre']}: {err_msg}", country)
            results.append({"contact_id": c["id"], "success": success, "error": err_msg})

    await db.execute(
        "INSERT INTO dispatches (id,ts,country,channel,total,sent,errors) VALUES (?,?,?,?,?,?,?)",
        (make_id(), now_iso(), country, req.channel, len(contacts), sent, errors),
    )
    await db.commit()
    return {"total": len(contacts), "sent": sent, "errors": errors, "results": results}


# ============================================================
# Reports
# ============================================================

@api_router.get("/reports/summary")
async def reports_summary(country: Optional[str] = None):
    country_filter = None
    if country and country.upper() != "ALL" and country.upper() in VALID_COUNTRIES:
        country_filter = country.upper()

    db = await get_db()

    async def count(table, where="", params=()):
        sql = f"SELECT COUNT(*) as n FROM {table}"
        if where:
            sql += " WHERE " + where
        async with db.execute(sql, params) as cur:
            row = await cur.fetchone()
        return row["n"] if row else 0

    async def money(extra_where="", params=()):
        where = "1=1"
        if extra_where:
            where += " AND " + extra_where
        sql = f"""SELECT COALESCE(SUM(json_extract(data,'$.monto')),0) as debt,
                         COALESCE(SUM(json_extract(data,'$.monto_recuperado')),0) as recovered
                  FROM contacts WHERE {where}"""
        async with db.execute(sql, params) as cur:
            row = await cur.fetchone()
        return {"debt": row["debt"] or 0.0, "recovered": row["recovered"] or 0.0} if row else {"debt": 0.0, "recovered": 0.0}

    cf_where  = "country=?" if country_filter else "1=1"
    cf_params = (country_filter,) if country_filter else ()

    total_contacts = await count("contacts", cf_where, cf_params)
    pending_n  = await count("contacts", f"{cf_where} AND status='pending'", cf_params)
    sent_n     = await count("contacts", f"{cf_where} AND status='sent'",    cf_params)
    errors_n   = await count("contacts", f"{cf_where} AND status='error'",   cf_params)
    sms_ok_n   = await count("contacts", f"{cf_where} AND json_extract(data,'$.sms_enviado')=1", cf_params)
    form_ok_n  = await count("contacts", f"{cf_where} AND json_extract(data,'$.formulario_guardado')=1", cf_params)

    estado_counts = {}
    for e in ("pendiente", "pagado", "sin_contacto", "parcial"):
        estado_counts[e] = await count("contacts", f"{cf_where} AND estado=?", (*cf_params, e))

    m = await money(cf_where.replace("1=1", "").strip(" AND"), cf_params)

    # dispatches by channel
    sql_disp = "SELECT channel, SUM(total) as t, SUM(sent) as s, SUM(errors) as e FROM dispatches"
    if country_filter:
        sql_disp += " WHERE country=?"
    sql_disp += " GROUP BY channel"
    channel_stats = {}
    async with db.execute(sql_disp, cf_params) as cur:
        for row in await cur.fetchall():
            channel_stats[row["channel"]] = {"total": row["t"], "sent": row["s"], "errors": row["e"]}

    per_country = []
    for c in ([country_filter] if country_filter else list(VALID_COUNTRIES)):
        tot = await count("contacts", "country=?", (c,))
        p   = await count("contacts", "country=? AND status='pending'", (c,))
        s   = await count("contacts", "country=? AND status='sent'",    (c,))
        e   = await count("contacts", "country=? AND status='error'",   (c,))
        sms = await count("contacts", "country=? AND json_extract(data,'$.sms_enviado')=1", (c,))
        pag = await count("contacts", "country=? AND estado='pagado'", (c,))
        par = await count("contacts", "country=? AND estado='parcial'", (c,))
        sin = await count("contacts", "country=? AND estado='sin_contacto'", (c,))
        mc  = await money("country=?", (c,))
        per_country.append({
            "country": c, "total": tot, "pending": p, "sent": s, "errors": e,
            "success_rate": round((s / tot) * 100, 1) if tot else 0.0,
            "sms_ok": sms, "debt": mc["debt"], "recovered": mc["recovered"],
            "recovery_rate": round((mc["recovered"] / mc["debt"]) * 100, 1) if mc["debt"] else 0.0,
            "pagado": pag, "parcial": par, "sin_contacto": sin,
        })

    total_sent_d = sum(v["sent"] for v in channel_stats.values()) or sent_n
    total_all_d  = sum(v["total"] for v in channel_stats.values()) or (sent_n + errors_n)
    success_rate  = round((total_sent_d / total_all_d) * 100, 1) if total_all_d else 0.0
    recovery_rate = round((m["recovered"] / m["debt"]) * 100, 1) if m["debt"] else 0.0

    return {
        "country_filter": country_filter, "total_contacts": total_contacts,
        "pending": pending_n, "sent": sent_n, "errors": errors_n,
        "total_sms": channel_stats.get("sms", {}).get("sent", 0),
        "total_whatsapp": channel_stats.get("whatsapp", {}).get("sent", 0),
        "success_rate": success_rate, "total_debt": m["debt"], "total_recovered": m["recovered"],
        "recovery_rate": recovery_rate, "sms_from_csv": sms_ok_n, "formulario_guardado": form_ok_n,
        "estado_counts": estado_counts, "per_country": per_country,
    }


@api_router.get("/reports/timeseries")
async def reports_timeseries(period: str = "day", days: int = 30, country: Optional[str] = None):
    from datetime import timedelta
    if period not in ("day", "week", "month"):
        period = "day"
    days = max(1, min(days, 365))
    now = datetime.now(timezone.utc)
    since_iso = (now - timedelta(days=days)).isoformat()
    country_filter = country.upper() if country and country.upper() in VALID_COUNTRIES else None

    def bucket_key(v):
        try:
            dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
            if period == "day":   return dt.strftime("%Y-%m-%d")
            if period == "week":
                iso = dt.isocalendar()
                return f"{iso[0]}-W{iso[1]:02d}"
            return dt.strftime("%Y-%m")
        except Exception:
            return None

    db = await get_db()
    buckets: Dict[str, Dict] = {}

    sql_d = "SELECT ts, sent, errors FROM dispatches WHERE ts>=?"
    p_d   = [since_iso]
    if country_filter:
        sql_d += " AND country=?"; p_d.append(country_filter)
    async with db.execute(sql_d, p_d) as cur:
        for row in await cur.fetchall():
            k = bucket_key(row["ts"])
            if not k: continue
            b = buckets.setdefault(k, {"bucket": k, "sent": 0, "errors": 0, "recovered": 0.0})
            b["sent"]   += row["sent"]
            b["errors"] += row["errors"]

    sql_c = """SELECT updated_at, json_extract(data,'$.monto_recuperado') as mr, country
               FROM contacts WHERE updated_at>=? AND json_extract(data,'$.monto_recuperado')>0"""
    p_c = [since_iso]
    if country_filter:
        sql_c += " AND country=?"; p_c.append(country_filter)
    async with db.execute(sql_c, p_c) as cur:
        for row in await cur.fetchall():
            k = bucket_key(row["updated_at"])
            if not k: continue
            b = buckets.setdefault(k, {"bucket": k, "sent": 0, "errors": 0, "recovered": 0.0})
            b["recovered"] += float(row["mr"] or 0)

    series = sorted(buckets.values(), key=lambda x: x["bucket"])
    recent = [b["recovered"] for b in series[-7:]]
    daily_avg = sum(recent) / len(recent) if recent else 0.0

    return {"period": period, "days": days, "country": country_filter, "series": series,
            "projection_30d_recovered": daily_avg * 30, "avg_daily_recovered": daily_avg}


# ============================================================
# Scripts
# ============================================================

@api_router.post("/scripts", response_model=ScriptRef)
async def register_script(payload: ScriptRegister):
    country = payload.country.upper()
    s = ScriptRef(name=payload.name, country=country)
    db = await get_db()
    await db.execute("INSERT INTO scripts (id,name,country,added_at) VALUES (?,?,?,?)",
                     (s.id, s.name, s.country, s.added_at))
    await db.commit()
    await add_log("info", "Sistema", f"Script registrado: {payload.name}", country)
    return s


@api_router.get("/scripts", response_model=List[ScriptRef])
async def list_scripts(country: Optional[str] = None):
    db = await get_db()
    if country:
        async with db.execute("SELECT * FROM scripts WHERE country=? ORDER BY added_at DESC LIMIT 100",
                              (country.upper(),)) as cur:
            rows = await cur.fetchall()
    else:
        async with db.execute("SELECT * FROM scripts ORDER BY added_at DESC LIMIT 100") as cur:
            rows = await cur.fetchall()
    return [ScriptRef(**dict(r)) for r in rows]


@api_router.delete("/scripts/{script_id}")
async def delete_script(script_id: str):
    db = await get_db()
    cur = await db.execute("DELETE FROM scripts WHERE id=?", (script_id,))
    await db.commit()
    return {"deleted": cur.rowcount}


# ============================================================
# WhatsApp
# ============================================================

COUNTRY_DIAL_CODES = {"MX": "+52", "CO": "+57", "PE": "+51", "CL": "+56"}


def normalize_phone(raw: str, dial_code: str) -> str:
    if not raw:
        return ""
    digits = "".join(ch for ch in str(raw) if ch.isdigit() or ch == "+")
    if digits.startswith("+"):
        return digits
    return f"{dial_code}{digits.lstrip('0')}"


@api_router.post("/whatsapp/test/{country}")
async def test_whatsapp(country: str):
    country = country.upper()
    db = await get_db()
    async with db.execute("SELECT data FROM configs WHERE country=?", (country,)) as cur:
        row = await cur.fetchone()
    cfg = json.loads(row["data"]) if row else {}
    url = cfg.get("whatsapp_webhook_url", "").strip()
    if not url:
        return {"connected": False, "reason": "webhook_url no configurada"}
    api_key = cfg.get("whatsapp_api_key", "").strip()
    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            try:
                r = await http.head(url, headers=headers)
            except Exception:
                r = await http.get(url, headers=headers)
            connected = r.status_code < 500
    except Exception as e:
        await add_log("error", "WhatsApp", f"Test conexión falló: {str(e)[:100]}", country)
        return {"connected": False, "reason": str(e)[:120]}
    await db.execute("INSERT INTO configs (country,data) VALUES (?,?) ON CONFLICT(country) DO UPDATE SET data=json_patch(data,?)",
                     (country, json.dumps({"whatsapp_connected": connected}), json.dumps({"whatsapp_connected": connected})))
    await db.commit()
    await add_log("success" if connected else "warn", "WhatsApp",
                  f"Test conexión: {'OK' if connected else 'sin respuesta'}", country)
    return {"connected": connected, "status_code": r.status_code}


@api_router.post("/whatsapp/import")
async def whatsapp_import_csv(country: str = Form(...), dial_code: Optional[str] = Form(None),
                               file: UploadFile = File(...)):
    country = country.upper()
    if country not in VALID_COUNTRIES:
        raise HTTPException(400, "País inválido")
    code = (dial_code or COUNTRY_DIAL_CODES.get(country) or "+52").strip()
    if not code.startswith("+"):
        code = "+" + code
    content = (await file.read()).decode("utf-8-sig", errors="ignore")
    reader = csv.DictReader(io.StringIO(content))
    inserted = 0; errors = 0
    for row in reader:
        try:
            r = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            c = parse_row_to_contact(r, country, dial_code=code)
            if not c:
                errors += 1; continue
            await _save_contact(c)
            inserted += 1
        except Exception:
            errors += 1
    await add_log("success", "WhatsApp", f"CSV cargado con código {code}: {inserted} contactos", country)
    return {"inserted": inserted, "errors": errors, "dial_code": code, "country": country}


@api_router.get("/whatsapp/dial-codes")
async def get_dial_codes():
    return COUNTRY_DIAL_CODES


@api_router.get("/whatsapp/qr/{country}")
async def whatsapp_qr(country: str):
    country = country.upper()
    evo_url = "http://localhost:8080"
    evo_key = "B6D711FCDE4D4FD59365415B5E45B4C1"
    headers = {"apikey": evo_key, "Content-Type": "application/json"}
    instance_name = f"cobranzas_{country.lower()}"

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            # 1. Intentar crear la instancia
            payload = {
                "instanceName": instance_name,
                "qrcode": True,
                "integration": "WHATSAPP-BAILEYS"
            }
            r = await client.post(f"{evo_url}/instance/create", json=payload, headers=headers)
            if r.status_code in (200, 201):
                # Set Webhook automatically
                wh_payload = {
                    "enabled": True,
                    "url": f"http://host.docker.internal:8001/api/whatsapp/evolution/webhook",
                    "webhookByEvents": False,
                    "events": ["MESSAGES_UPSERT"]
                }
                await client.post(f"{evo_url}/webhook/set/{instance_name}", json=wh_payload, headers=headers)
                
                data = r.json()
                if "qrcode" in data and data["qrcode"].get("base64"):
                    return {"qr_data_url": data["qrcode"]["base64"]}
            
            # 2. Si ya existe, pedir conectar para obtener el QR
            r2 = await client.get(f"{evo_url}/instance/connect/{instance_name}", headers=headers)
            if r2.status_code == 200:
                data = r2.json()
                if "base64" in data:
                    return {"qr_data_url": data["base64"]}
            
            return {"qr_data_url": "", "error": "No se pudo generar QR de Evolution API"}
        except Exception as e:
            return {"qr_data_url": "", "error": f"Error conectando a Evolution API: {e}"}


@api_router.post("/whatsapp/evolution/webhook")
async def whatsapp_evolution_webhook(payload: dict):
    """
    Recibe eventos desde Evolution API (ej. MESSAGES_UPSERT)
    """
    event = payload.get("event")
    if event == "messages.upsert":
        data = payload.get("data", {})
        msg_key = data.get("key", {})
        if msg_key.get("fromMe"):
            return {"status": "ignored"} # Ignore outgoing messages (we save them when we send)
        
        phone = msg_key.get("remoteJid", "").split("@")[0]
        wa_msg_id = msg_key.get("id")
        
        msg_content = data.get("message", {})
        text = ""
        if "conversation" in msg_content:
            text = msg_content["conversation"]
        elif "extendedTextMessage" in msg_content:
            text = msg_content["extendedTextMessage"].get("text", "")
        
        if not text:
            return {"status": "ignored_non_text"}

        instance_name = payload.get("instance", "")
        country = instance_name.split("_")[-1].upper() if "_" in instance_name else "GLOBAL"

        # Search for contact_id if this phone exists in our db
        db = await get_db()
        async with db.execute("SELECT id FROM contacts WHERE data LIKE ?", (f"%{phone}%",)) as cur:
            row = await cur.fetchone()
        contact_id = row["id"] if row else ""

        # Insert message
        msg_id = make_id()
        await db.execute(
            """INSERT INTO whatsapp_messages (id, contact_id, phone, direction, body, msg_type, wa_msg_id, status, country, created_at)
               VALUES (?, ?, ?, 'incoming', ?, 'text', ?, 'received', ?, ?)""",
            (msg_id, contact_id, phone, text, wa_msg_id, country, now_iso()),
        )
        await db.commit()
        await add_log("info", "WhatsApp", f"Mensaje recibido de {phone}", country)

    return {"status": "ok"}


@api_router.get("/whatsapp/status/{country}")
async def whatsapp_status(country: str):
    country = country.upper()
    evo_url = "http://localhost:8080"
    evo_key = "B6D711FCDE4D4FD59365415B5E45B4C1"
    headers = {"apikey": evo_key}
    instance_name = f"cobranzas_{country.lower()}"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{evo_url}/instance/connectionState/{instance_name}", headers=headers)
            if r.status_code == 200:
                state = r.json().get("instance", {}).get("state", "close")
                if state == "open":
                    return {"connected": True, "state": "Conectado", "phone": "Evolution API"}
                elif state == "connecting":
                    return {"connected": False, "state": "Conectando..."}
            
            return {"connected": False, "state": "Desconectado"}
    except Exception:
        return {"connected": False, "state": "Error de conexión con Evolution API"}


@api_router.post("/whatsapp/disconnect/{country}")
async def whatsapp_disconnect(country: str):
    country = country.upper()
    evo_url = "http://localhost:8080"
    evo_key = "B6D711FCDE4D4FD59365415B5E45B4C1"
    headers = {"apikey": evo_key}
    instance_name = f"cobranzas_{country.lower()}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.delete(f"{evo_url}/instance/logout/{instance_name}", headers=headers)
    except Exception:
        pass

    await add_log("warn", "WhatsApp", "Desconectado (Evolution API)", country)
    return {"connected": False}


# ============================================================
# Files (almacenamiento local)
# ============================================================

@api_router.post("/files/upload", response_model=FileRecord)
async def upload_file(file: UploadFile = File(...), category: str = Form("other"),
                      country: Optional[str] = Form(None), note: Optional[str] = Form("")):
    data = await file.read()
    ext = (file.filename or "file").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    path = f"{APP_NAME}/uploads/{(country or 'global').upper()}/{uuid.uuid4()}.{ext}"
    content_type = file.content_type or guess_mime(file.filename or "")
    try:
        result = put_object(path, data, content_type)
    except Exception as e:
        await add_log("error", "Storage", f"Upload failed: {str(e)[:150]}", country)
        raise HTTPException(500, f"Storage error: {str(e)[:200]}")
    rec = FileRecord(storage_path=result["path"], original_filename=file.filename or "archivo",
                     content_type=content_type, size=result.get("size", len(data)),
                     category=category, country=(country.upper() if country else None), note=note or "")
    db = await get_db()
    await db.execute(
        "INSERT INTO files (id,storage_path,original_filename,content_type,size,category,country,note,is_deleted,created_at) VALUES (?,?,?,?,?,?,?,?,0,?)",
        (rec.id, rec.storage_path, rec.original_filename, rec.content_type, rec.size,
         rec.category, rec.country, rec.note, rec.created_at),
    )
    await db.commit()
    await add_log("success", "Storage", f"Archivo subido: {rec.original_filename} ({rec.size} bytes)", rec.country)
    return rec


@api_router.get("/files", response_model=List[FileRecord])
async def list_files(country: Optional[str] = None, category: Optional[str] = None, limit: int = 200):
    where, params = ["is_deleted=0"], []
    if country and country.upper() != "ALL":
        where.append("country=?"); params.append(country.upper())
    if category and category != "all":
        where.append("category=?"); params.append(category)
    sql = "SELECT * FROM files WHERE " + " AND ".join(where) + " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    db = await get_db()
    async with db.execute(sql, params) as cur:
        rows = await cur.fetchall()
    return [FileRecord(**{**dict(r), "is_deleted": bool(r["is_deleted"])}) for r in rows]


@api_router.get("/files/{file_id}/download")
async def download_file(file_id: str):
    db = await get_db()
    async with db.execute("SELECT * FROM files WHERE id=? AND is_deleted=0", (file_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Archivo no encontrado")
    try:
        data, ctype = get_object(row["storage_path"])
    except Exception as e:
        raise HTTPException(500, f"Storage error: {str(e)[:200]}")
    return Response(content=data, media_type=row["content_type"] or ctype,
                    headers={"Content-Disposition": f'attachment; filename="{row["original_filename"]}"'})


@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str):
    db = await get_db()
    async with db.execute("SELECT * FROM files WHERE id=? AND is_deleted=0", (file_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    await db.execute("UPDATE files SET is_deleted=1 WHERE id=?", (file_id,))
    await db.commit()
    try:
        delete_object(row["storage_path"])
    except Exception:
        pass
    await add_log("warn", "Storage", f"Archivo eliminado: {row['original_filename']}", row["country"])
    return {"deleted": True}


@api_router.post("/files/import-contacts/{file_id}")
async def import_contacts_from_file(file_id: str):
    db = await get_db()
    async with db.execute("SELECT * FROM files WHERE id=? AND is_deleted=0", (file_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Archivo no encontrado")
    country = (row["country"] or "MX").upper()
    if country not in VALID_COUNTRIES:
        country = "MX"
    try:
        data, _ = get_object(row["storage_path"])
    except Exception as e:
        raise HTTPException(500, f"Storage error: {str(e)[:200]}")
    content = data.decode("utf-8-sig", errors="ignore")
    reader = csv.DictReader(io.StringIO(content))
    inserted = 0; errors = 0
    for r_row in reader:
        try:
            r = {k.strip().lower(): (v or "").strip() for k, v in r_row.items() if k}
            c = parse_row_to_contact(r, country)
            if not c:
                errors += 1; continue
            await _save_contact(c)
            inserted += 1
        except Exception:
            errors += 1
    await add_log("success", "Import", f"Contactos importados desde {row['original_filename']}: {inserted}", country)
    return {"inserted": inserted, "errors": errors}


# ============================================================
# FX
# ============================================================

@api_router.get("/fx/rates")
async def fx_rates(force: bool = False):
    return {**get_rates(force=force), "country_currency": COUNTRY_CURRENCY}


# ============================================================
# WhatsApp Cloud API (Meta) — Real Integration
# ============================================================

META_GRAPH_URL = "https://graph.facebook.com/v21.0"


class MetaConfigPayload(BaseModel):
    access_token: str = ""
    phone_number_id: str = ""
    waba_id: str = ""
    verify_token: str = "cobranzas_xd_webhook_2024"


class MetaSendPayload(BaseModel):
    phone: str
    message: str
    contact_id: Optional[str] = None
    country: Optional[str] = None


class MetaTemplateSendPayload(BaseModel):
    phone: str
    template_name: str = "hello_world"
    language_code: str = "es"
    components: Optional[List[Dict[str, Any]]] = None
    contact_id: Optional[str] = None
    country: Optional[str] = None


async def _get_meta_config() -> dict:
    db = await get_db()
    async with db.execute("SELECT * FROM whatsapp_meta_config WHERE id='global'") as cur:
        row = await cur.fetchone()
    if row:
        return dict(row)
    return {"access_token": "", "phone_number_id": "", "waba_id": "", "verify_token": "cobranzas_xd_webhook_2024"}


def _normalize_phone_for_meta(phone: str) -> str:
    """Meta requires phone in format like 5215512345678 (no + or spaces)."""
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    return digits


@api_router.post("/whatsapp/meta/config")
async def save_meta_config(payload: MetaConfigPayload):
    db = await get_db()
    ts = now_iso()
    await db.execute(
        """INSERT INTO whatsapp_meta_config (id, access_token, phone_number_id, waba_id, verify_token, updated_at)
           VALUES ('global', ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             access_token=excluded.access_token,
             phone_number_id=excluded.phone_number_id,
             waba_id=excluded.waba_id,
             verify_token=excluded.verify_token,
             updated_at=excluded.updated_at""",
        (payload.access_token, payload.phone_number_id, payload.waba_id, payload.verify_token, ts),
    )
    await db.commit()
    await add_log("success", "WhatsApp Meta", "Credenciales de Meta guardadas")
    return {"saved": True, "updated_at": ts}


@api_router.get("/whatsapp/meta/config")
async def get_meta_config():
    cfg = await _get_meta_config()
    # Mask the token for security
    token = cfg.get("access_token", "")
    masked = f"{token[:8]}...{token[-4:]}" if len(token) > 12 else ("***" if token else "")
    return {
        "phone_number_id": cfg.get("phone_number_id", ""),
        "waba_id": cfg.get("waba_id", ""),
        "access_token_masked": masked,
        "has_token": bool(token),
        "verify_token": cfg.get("verify_token", ""),
        "updated_at": cfg.get("updated_at", ""),
    }


@api_router.post("/whatsapp/meta/test")
async def test_meta_connection():
    cfg = await _get_meta_config()
    token = cfg.get("access_token", "").strip()
    phone_id = cfg.get("phone_number_id", "").strip()
    if not token or not phone_id:
        return {"connected": False, "reason": "Falta access_token o phone_number_id"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            r = await http.get(
                f"{META_GRAPH_URL}/{phone_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if r.status_code == 200:
                data = r.json()
                await add_log("success", "WhatsApp Meta", f"Conexión OK — Phone: {data.get('display_phone_number', phone_id)}")
                return {"connected": True, "phone_info": data}
            else:
                err = r.json().get("error", {}).get("message", r.text[:200])
                await add_log("error", "WhatsApp Meta", f"Error: {err}")
                return {"connected": False, "reason": err, "status_code": r.status_code}
    except Exception as e:
        await add_log("error", "WhatsApp Meta", f"Excepción: {str(e)[:150]}")
        return {"connected": False, "reason": str(e)[:200]}


@api_router.post("/whatsapp/meta/send")
async def meta_send_message(payload: MetaSendPayload):
    """Envía un mensaje de texto libre vía Evolution API."""
    country = payload.country.lower() if payload.country else "default"
    instance_name = f"cobranzas_{country}"
    evo_url = "http://localhost:8080"
    evo_key = "B6D711FCDE4D4FD59365415B5E45B4C1"

    to_phone = payload.phone.replace("+", "").replace(" ", "")
    if not to_phone:
        raise HTTPException(400, "Número de teléfono inválido")

    body = {
        "number": to_phone,
        "options": {
            "delay": 1000,
            "presence": "composing"
        },
        "textMessage": {
            "text": payload.message
        }
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            r = await http.post(
                f"{evo_url}/message/sendText/{instance_name}",
                headers={
                    "apikey": evo_key,
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp_data = r.json()

            if r.status_code in (200, 201):
                wa_msg_id = resp_data.get("key", {}).get("id", "")

                # Save to local history
                msg_id = make_id()
                db = await get_db()
                await db.execute(
                    """INSERT INTO whatsapp_messages (id, contact_id, phone, direction, body, msg_type, wa_msg_id, status, country, created_at)
                       VALUES (?, ?, ?, 'outgoing', ?, 'text', ?, 'sent', ?, ?)""",
                    (msg_id, payload.contact_id or "", payload.phone, payload.message, wa_msg_id, payload.country or "", now_iso()),
                )
                await db.commit()

                await add_log("success", "Evolution API", f"→ Mensaje enviado a {payload.phone}", payload.country)
                return {"success": True, "wa_msg_id": wa_msg_id, "msg_id": msg_id}
            else:
                err_msg = resp_data.get("response", {}).get("message", r.text[:200])
                await add_log("error", "Evolution API", f"✖ {payload.phone}: {err_msg}", payload.country)
                return {"success": False, "error": err_msg, "status_code": r.status_code}
    except Exception as e:
        await add_log("error", "Evolution API", f"Excepción enviando a {payload.phone}: {str(e)[:150]}", payload.country)
        return {"success": False, "error": str(e)[:200]}



@api_router.post("/whatsapp/meta/send-template")
async def meta_send_template(payload: MetaTemplateSendPayload):
    """Envía un mensaje de plantilla (template message) vía WhatsApp Cloud API de Meta."""
    cfg = await _get_meta_config()
    token = cfg.get("access_token", "").strip()
    phone_id = cfg.get("phone_number_id", "").strip()
    if not token or not phone_id:
        raise HTTPException(400, "Credenciales de Meta no configuradas.")

    to_phone = _normalize_phone_for_meta(payload.phone)
    if not to_phone:
        raise HTTPException(400, "Número de teléfono inválido")

    template_obj = {
        "name": payload.template_name,
        "language": {"code": payload.language_code},
    }
    if payload.components:
        template_obj["components"] = payload.components

    body = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "template",
        "template": template_obj,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            r = await http.post(
                f"{META_GRAPH_URL}/{phone_id}/messages",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp_data = r.json()

            if r.status_code in (200, 201):
                wa_msg_id = ""
                if "messages" in resp_data and resp_data["messages"]:
                    wa_msg_id = resp_data["messages"][0].get("id", "")

                msg_id = make_id()
                db = await get_db()
                await db.execute(
                    """INSERT INTO whatsapp_messages (id, contact_id, phone, direction, body, msg_type, wa_msg_id, status, country, created_at)
                       VALUES (?, ?, ?, 'outgoing', ?, 'template', ?, 'sent', ?, ?)""",
                    (msg_id, payload.contact_id or "", payload.phone,
                     f"[Template: {payload.template_name}]", wa_msg_id, payload.country or "", now_iso()),
                )
                await db.commit()

                await add_log("success", "WhatsApp Meta", f"→ Template '{payload.template_name}' a {payload.phone}", payload.country)
                return {"success": True, "wa_msg_id": wa_msg_id, "msg_id": msg_id}
            else:
                err_msg = resp_data.get("error", {}).get("message", r.text[:200])
                await add_log("error", "WhatsApp Meta", f"✖ Template error {payload.phone}: {err_msg}", payload.country)
                return {"success": False, "error": err_msg, "status_code": r.status_code}
    except Exception as e:
        await add_log("error", "WhatsApp Meta", f"Excepción template a {payload.phone}: {str(e)[:150]}", payload.country)
        return {"success": False, "error": str(e)[:200]}


# ============================================================
# Messages History (local)
# ============================================================

@api_router.get("/messages")
async def get_messages(contact_id: Optional[str] = None, phone: Optional[str] = None, limit: int = 100):
    db = await get_db()
    if contact_id:
        async with db.execute(
            "SELECT * FROM whatsapp_messages WHERE contact_id=? ORDER BY created_at ASC LIMIT ?",
            (contact_id, limit)
        ) as cur:
            rows = await cur.fetchall()
    elif phone:
        cleaned = phone.strip()
        async with db.execute(
            "SELECT * FROM whatsapp_messages WHERE phone=? ORDER BY created_at ASC LIMIT ?",
            (cleaned, limit)
        ) as cur:
            rows = await cur.fetchall()
    else:
        async with db.execute(
            "SELECT * FROM whatsapp_messages ORDER BY created_at DESC LIMIT ?",
            (limit,)
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


class MessageCreate(BaseModel):
    contact_id: Optional[str] = None
    phone: str
    direction: str = "outgoing"
    body: str
    msg_type: str = "text"
    wa_msg_id: Optional[str] = None
    country: Optional[str] = None


@api_router.post("/messages")
async def create_message(payload: MessageCreate):
    msg_id = make_id()
    db = await get_db()
    await db.execute(
        """INSERT INTO whatsapp_messages (id, contact_id, phone, direction, body, msg_type, wa_msg_id, status, country, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)""",
        (msg_id, payload.contact_id or "", payload.phone, payload.direction,
         payload.body, payload.msg_type, payload.wa_msg_id or "", payload.country or "", now_iso()),
    )
    await db.commit()
    return {"id": msg_id, "created": True}


@api_router.get("/messages/conversations")
async def get_conversations(country: Optional[str] = None, limit: int = 50):
    """Returns a list of unique phone numbers with their latest message and contact info."""
    db = await get_db()

    # Get latest message per phone
    sql = """
        SELECT m.phone, m.body as last_message, m.direction as last_direction,
               m.created_at as last_message_at, m.country,
               COUNT(*) as message_count
        FROM whatsapp_messages m
    """
    params = []
    if country and country.upper() != "ALL":
        sql += " WHERE m.country = ?"
        params.append(country.upper())
    sql += " GROUP BY m.phone ORDER BY MAX(m.created_at) DESC LIMIT ?"
    params.append(limit)

    async with db.execute(sql, params) as cur:
        rows = await cur.fetchall()

    conversations = []
    for r in rows:
        row_dict = dict(r)
        # Try to find the contact by phone
        phone = row_dict["phone"]
        async with db.execute(
            "SELECT id, data, country FROM contacts WHERE json_extract(data, '$.telefono') = ? LIMIT 1",
            (phone,)
        ) as c_cur:
            contact_row = await c_cur.fetchone()

        contact_info = None
        if contact_row:
            c_data = json.loads(contact_row["data"])
            contact_info = {
                "id": contact_row["id"],
                "nombre": c_data.get("nombre", ""),
                "monto": c_data.get("monto", 0),
                "dias_mora": c_data.get("dias_mora", 0),
                "app_cliente": c_data.get("app_cliente", ""),
            }

        row_dict["contact"] = contact_info
        conversations.append(row_dict)

    return conversations


# ============================================================
# WhatsApp Webhook (receptor de mensajes entrantes de Meta)
# ============================================================

@api_router.get("/whatsapp/webhook")
async def whatsapp_webhook_verify(
    hub_mode: Optional[str] = Query(None, alias="hub.mode"),
    hub_token: Optional[str] = Query(None, alias="hub.verify_token"),
    hub_challenge: Optional[str] = Query(None, alias="hub.challenge"),
):
    """Verificación del webhook de Meta. Meta envía un GET con un challenge."""
    cfg = await _get_meta_config()
    verify_token = cfg.get("verify_token", "cobranzas_xd_webhook_2024")

    if hub_mode == "subscribe" and hub_token == verify_token:
        logger.info(f"Webhook verificado con challenge: {hub_challenge}")
        return Response(content=hub_challenge or "", media_type="text/plain")
    raise HTTPException(403, "Verificación fallida")


@api_router.post("/whatsapp/webhook")
async def whatsapp_webhook_receive(request_body: Dict[str, Any]):
    """Recibe notificaciones de Meta cuando un cliente envía un mensaje."""
    try:
        entry = request_body.get("entry", [])
        for e in entry:
            changes = e.get("changes", [])
            for change in changes:
                value = change.get("value", {})
                messages = value.get("messages", [])
                contacts_meta = value.get("contacts", [])

                for msg in messages:
                    from_phone = msg.get("from", "")
                    msg_body = ""
                    msg_type = msg.get("type", "text")

                    if msg_type == "text":
                        msg_body = msg.get("text", {}).get("body", "")
                    elif msg_type == "image":
                        msg_body = "[Imagen recibida]"
                    elif msg_type == "audio":
                        msg_body = "[Audio recibido]"
                    elif msg_type == "document":
                        msg_body = "[Documento recibido]"
                    elif msg_type == "video":
                        msg_body = "[Video recibido]"
                    elif msg_type == "location":
                        msg_body = "[Ubicación recibida]"
                    else:
                        msg_body = f"[{msg_type}]"

                    wa_msg_id = msg.get("id", "")

                    # Find contact name from Meta's contacts array
                    contact_name = ""
                    if contacts_meta:
                        contact_name = contacts_meta[0].get("profile", {}).get("name", "")

                    # Normalize phone for lookup
                    phone_with_plus = f"+{from_phone}" if not from_phone.startswith("+") else from_phone

                    # Try to find existing contact
                    db = await get_db()
                    contact_id = ""
                    async with db.execute(
                        "SELECT id FROM contacts WHERE json_extract(data, '$.telefono') LIKE ? LIMIT 1",
                        (f"%{from_phone[-10:]}%",)
                    ) as cur:
                        row = await cur.fetchone()
                    if row:
                        contact_id = row["id"]

                    # Save incoming message
                    msg_id = make_id()
                    await db.execute(
                        """INSERT INTO whatsapp_messages (id, contact_id, phone, direction, body, msg_type, wa_msg_id, status, country, created_at)
                           VALUES (?, ?, ?, 'incoming', ?, ?, ?, 'received', '', ?)""",
                        (msg_id, contact_id, phone_with_plus, msg_body, msg_type, wa_msg_id, now_iso()),
                    )
                    await db.commit()

                    await add_log("info", "WhatsApp Webhook",
                                  f"← Mensaje de {contact_name or phone_with_plus}: {msg_body[:80]}")

    except Exception as e:
        logger.error(f"Webhook processing error: {e}")
        await add_log("error", "WhatsApp Webhook", f"Error procesando webhook: {str(e)[:150]}")

    # Meta expects a 200 response always
    return {"status": "ok"}


# ============================================================
# Root
# ============================================================

@api_router.get("/")
async def root():
    return {"status": "ok", "service": "Cobranzas Command Center", "db": str(DB_PATH)}


app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True,
                   allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
