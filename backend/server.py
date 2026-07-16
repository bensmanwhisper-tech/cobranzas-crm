from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Response, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import csv
import logging
import uuid
import httpx
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone

from storage import init_storage, put_object, get_object, guess_mime, APP_NAME
from fx import get_rates, COUNTRY_CURRENCY


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ['DB_NAME']]

app = FastAPI(title="Cobranzas Command Center API")
api_router = APIRouter(prefix="/api")

# ---------- Utils ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def make_id() -> str:
    return str(uuid.uuid4())

VALID_COUNTRIES = {"MX", "CO", "PE", "CL"}
VALID_STATUS = {"pending", "sent", "error"}
CONTACT_ESTADOS = {"pendiente", "pagado", "sin_contacto", "parcial"}

# ---------- Models ----------
class CountryConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    country: str
    collection_url: Optional[str] = ""
    script_name: Optional[str] = ""
    csv_folder: Optional[str] = "C:\\Cobranzas\\CSV\\"
    scripts_folder: Optional[str] = "C:\\Cobranzas\\App\\backend\\scripts_subidos\\"
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
    solicitante: Optional[str] = ""       # institución que otorgó el préstamo (del CSV)
    vencimiento: Optional[str] = ""
    fecha: Optional[str] = ""
    hora: Optional[str] = ""              # hora del registro (del CSV)
    dias_mora: int = 0
    app_cliente: Optional[str] = ""
    country: str
    # Send tracking (canal técnico)
    status: str = "pending"                # pending, sent, error
    last_error: Optional[str] = ""
    sms_enviado: bool = False              # del CSV: sms ✅
    formulario_guardado: bool = False      # del CSV: formulario_guardado ✅
    # Gestión de cobranza (nuevo)
    estado: str = "pendiente"              # pendiente | pagado | sin_contacto | parcial
    monto_recuperado: float = 0.0
    medio_contacto: Optional[str] = ""     # whatsapp | sms | llamada | email | presencial
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
    kind: str  # default, friendly, formal, urgent
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
    level: str  # info, success, error, warn, system
    source: str  # Sistema, WhatsApp, SMS, User, Import
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
    channel: str = "whatsapp"  # whatsapp | sms
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

# ---------- Helpers ----------
def clean_doc(d: dict) -> dict:
    d.pop("_id", None)
    return d

async def add_log(level: str, source: str, message: str, country: Optional[str] = None):
    entry = LogEntry(level=level, source=source, message=message, country=country)
    await db.logs.insert_one(entry.model_dump())
    return entry

def render_template(body: str, contact: Dict[str, Any]) -> str:
    out = body or ""
    mapping = {
        "{nombre}": str(contact.get("nombre", "")),
        "{monto}": f"{contact.get('monto', 0)}",
        "{fecha}": str(contact.get("fecha", "")),
        "{empresa}": str(contact.get("empresa", "")),
        "{vencimiento}": str(contact.get("vencimiento", "")),
        "{telefono}": str(contact.get("telefono", "")),
        "{dias_mora}": str(contact.get("dias_mora", 0)),
        "{app_cliente}": str(contact.get("app_cliente", "")),
    }
    for k, v in mapping.items():
        out = out.replace(k, v)
    return out

# ---------- Config Endpoints ----------
@api_router.get("/config/{country}", response_model=CountryConfig)
async def get_config(country: str):
    country = country.upper()
    if country not in VALID_COUNTRIES:
        raise HTTPException(400, "Invalid country")
    doc = await db.configs.find_one({"country": country}, {"_id": 0})
    if not doc:
        cfg = CountryConfig(country=country, updated_at=now_iso())
        await db.configs.insert_one(cfg.model_dump())
        return cfg
    return CountryConfig(**doc)

@api_router.put("/config/{country}", response_model=CountryConfig)
async def update_config(country: str, cfg: CountryConfig):
    country = country.upper()
    if country not in VALID_COUNTRIES:
        raise HTTPException(400, "Invalid country")
    cfg.country = country
    cfg.updated_at = now_iso()
    doc = cfg.model_dump()
    await db.configs.update_one({"country": country}, {"$set": doc}, upsert=True)
    await add_log("success", "Sistema", f"Configuración guardada para {country}", country)
    return cfg

@api_router.get("/config", response_model=List[CountryConfig])
async def list_configs():
    docs = await db.configs.find({}, {"_id": 0}).to_list(50)
    return [CountryConfig(**d) for d in docs]

# ---------- Contacts ----------
@api_router.get("/contacts", response_model=List[Contact])
async def list_contacts(
    country: Optional[str] = None,
    status: Optional[str] = None,
    estado: Optional[str] = None,
    limit: int = 500,
):
    q: Dict[str, Any] = {}
    if country and country.upper() != "ALL":
        q["country"] = country.upper()
    if status and status != "all":
        q["status"] = status
    if estado and estado != "all":
        q["estado"] = estado
    docs = await db.contacts.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [Contact(**d) for d in docs]

@api_router.post("/contacts", response_model=Contact)
async def create_contact(payload: ContactCreate):
    if payload.country.upper() not in VALID_COUNTRIES:
        raise HTTPException(400, "Invalid country")
    contact = Contact(**payload.model_dump())
    contact.country = contact.country.upper()
    await db.contacts.insert_one(contact.model_dump())
    await add_log("info", "User", f"Contacto agregado: {contact.nombre}", contact.country)
    return contact

@api_router.patch("/contacts/{contact_id}", response_model=Contact)
async def update_contact(contact_id: str, upd: ContactUpdate):
    existing = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    patch = {k: v for k, v in upd.model_dump().items() if v is not None}
    patch["updated_at"] = now_iso()
    if patch.get("status") and patch["status"] not in VALID_STATUS:
        raise HTTPException(400, "Invalid status")
    if patch.get("estado") and patch["estado"] not in CONTACT_ESTADOS:
        raise HTTPException(400, "Invalid estado")
    await db.contacts.update_one({"id": contact_id}, {"$set": patch})
    updated = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    if patch.get("estado"):
        await add_log("info", "User", f"Estado→{patch['estado']}: {existing.get('nombre')}", existing.get("country"))
    return Contact(**updated)


# ---- Notes ----
class NoteCreate(BaseModel):
    text: str
    author: Optional[str] = "operador"


@api_router.post("/contacts/{contact_id}/notes", response_model=Contact)
async def add_note(contact_id: str, payload: NoteCreate):
    existing = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    note = ContactNote(text=payload.text, author=payload.author or "operador")
    await db.contacts.update_one(
        {"id": contact_id},
        {"$push": {"notas": note.model_dump()}, "$set": {"updated_at": now_iso()}},
    )
    await add_log("info", "User", f"Nota agregada a {existing.get('nombre')}", existing.get("country"))
    updated = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    return Contact(**updated)


@api_router.delete("/contacts/{contact_id}/notes/{note_id}", response_model=Contact)
async def delete_note(contact_id: str, note_id: str):
    await db.contacts.update_one(
        {"id": contact_id},
        {"$pull": {"notas": {"id": note_id}}, "$set": {"updated_at": now_iso()}},
    )
    updated = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    if not updated:
        raise HTTPException(404, "Not found")
    return Contact(**updated)


# ---- Reminders ----
class ReminderCreate(BaseModel):
    text: str
    due_at: Optional[str] = None


@api_router.post("/contacts/{contact_id}/reminders", response_model=Contact)
async def add_reminder(contact_id: str, payload: ReminderCreate):
    existing = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    r = ContactReminder(text=payload.text, due_at=payload.due_at)
    await db.contacts.update_one(
        {"id": contact_id},
        {"$push": {"recordatorios": r.model_dump()}, "$set": {"updated_at": now_iso()}},
    )
    await add_log("info", "User", f"Recordatorio: {existing.get('nombre')}", existing.get("country"))
    updated = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    return Contact(**updated)


@api_router.patch("/contacts/{contact_id}/reminders/{reminder_id}/toggle", response_model=Contact)
async def toggle_reminder(contact_id: str, reminder_id: str):
    existing = await db.contacts.find_one({"id": contact_id, "recordatorios.id": reminder_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    current = next((r for r in existing.get("recordatorios", []) if r["id"] == reminder_id), None)
    new_done = not (current and current.get("done", False))
    await db.contacts.update_one(
        {"id": contact_id, "recordatorios.id": reminder_id},
        {"$set": {"recordatorios.$.done": new_done, "updated_at": now_iso()}},
    )
    updated = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    return Contact(**updated)


@api_router.delete("/contacts/{contact_id}/reminders/{reminder_id}", response_model=Contact)
async def delete_reminder(contact_id: str, reminder_id: str):
    await db.contacts.update_one(
        {"id": contact_id},
        {"$pull": {"recordatorios": {"id": reminder_id}}, "$set": {"updated_at": now_iso()}},
    )
    updated = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    if not updated:
        raise HTTPException(404, "Not found")
    return Contact(**updated)


# ---- Recovered amount ----
class RecoveryPayload(BaseModel):
    monto_recuperado: float
    marcar_pagado: bool = False


@api_router.patch("/contacts/{contact_id}/recovered", response_model=Contact)
async def set_recovered(contact_id: str, payload: RecoveryPayload):
    existing = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    monto = existing.get("monto", 0.0) or 0.0
    upd = {"monto_recuperado": payload.monto_recuperado, "updated_at": now_iso()}
    if payload.marcar_pagado or payload.monto_recuperado >= monto:
        upd["estado"] = "pagado"
    elif payload.monto_recuperado > 0:
        upd["estado"] = "parcial"
    await db.contacts.update_one({"id": contact_id}, {"$set": upd})
    await add_log("success", "Recuperación", f"${payload.monto_recuperado} recuperado de {existing.get('nombre')}", existing.get("country"))
    updated = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    return Contact(**updated)

@api_router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str):
    res = await db.contacts.delete_one({"id": contact_id})
    return {"deleted": res.deleted_count}

@api_router.post("/contacts/bulk-delete")
async def bulk_delete_contacts(payload: Dict[str, List[str]]):
    ids = payload.get("ids", [])
    if not ids:
        return {"deleted": 0}
    res = await db.contacts.delete_many({"id": {"$in": ids}})
    await add_log("warn", "User", f"Se eliminaron {res.deleted_count} contactos")
    return {"deleted": res.deleted_count}

def parse_row_to_contact(r: Dict[str, str], country: str, dial_code: Optional[str] = None) -> Optional[Contact]:
    """Parse a CSV row into a Contact. Supports all known columns of the real CSV format."""
    nombre = r.get("nombre") or r.get("name") or r.get("cliente") or ""
    raw_phone = (
        r.get("telefono") or r.get("teléfono") or r.get("phone") or r.get("celular")
        or r.get("numero") or r.get("número") or ""
    )
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
        s = str(v).strip().lower()
        return s in {"✅", "true", "yes", "sí", "si", "1", "x", "ok", "checked"}

    monto = _num(r.get("monto") or r.get("amount") or "0")
    dias_mora = _int(r.get("dias_mora") or r.get("dias") or r.get("mora") or "0")
    # Aplicación / prestamista
    solicitante = (
        r.get("solicitante") or r.get("institucion") or r.get("institución") or ""
    )
    app_cliente = (
        r.get("app_cliente") or r.get("app") or r.get("aplicacion") or r.get("aplicación")
        or solicitante
    )
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
    docs = []
    for row in reader:
        try:
            r = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            c = parse_row_to_contact(r, country)
            if not c:
                errors += 1
                continue
            docs.append(c.model_dump())
            inserted += 1
        except Exception:
            errors += 1
    if docs:
        await db.contacts.insert_many(docs)
    await add_log("success", "Import", f"CSV importado: {inserted} registros, {errors} errores", country)
    return {"inserted": inserted, "errors": errors, "filename": file.filename}

@api_router.post("/contacts/seed-demo")
async def seed_demo(country: Optional[str] = None):
    """Insert demo contacts for testing."""
    demo_data = [
        ("Carlos Ramírez", "+52 55 1234 5678", 4520.50, "Grupo Aguila", "MX", 15, "Kueski"),
        ("María López", "+52 33 2345 6789", 8900.00, "Cementos MX", "MX", 45, "Nu"),
        ("José Hernández", "+52 81 3456 7890", 1250.75, "Autopartes SA", "MX", 8, "Rappi Pay"),
        ("Ana García", "+52 55 4567 8901", 15600.00, "Constructora del Norte", "MX", 60, "Kueski"),
        ("Andrés Torres", "+57 300 111 2233", 3200.00, "Bavaria SA", "CO", 22, "Nequi"),
        ("Diana Vargas", "+57 301 222 3344", 7800.90, "Ecopetrol", "CO", 90, "Daviplata"),
        ("Camilo Ruiz", "+57 310 333 4455", 2100.00, "Bancolombia", "CO", 5, "Nequi"),
        ("Rocío Mendoza", "+51 987 654 321", 5600.00, "Backus SA", "PE", 30, "Yape"),
        ("Luis Quispe", "+51 986 543 210", 12400.00, "Alicorp", "PE", 120, "Plin"),
        ("Fernanda Castillo", "+51 985 432 109", 890.00, "Interbank", "PE", 12, "Yape"),
        ("Sebastián Rojas", "+56 9 8765 4321", 6700.00, "Falabella", "CL", 18, "Mach"),
        ("Valentina Núñez", "+56 9 7654 3210", 3400.50, "Cencosud", "CL", 40, "Fpay"),
        ("Matías Pérez", "+56 9 6543 2109", 9200.00, "Copec SA", "CL", 75, "Mach"),
    ]
    inserted = 0
    for nombre, tel, monto, empresa, cty, mora, app_cli in demo_data:
        if country and country.upper() != cty:
            continue
        c = Contact(
            nombre=nombre,
            telefono=tel,
            monto=monto,
            empresa=empresa,
            vencimiento="2026-03-15",
            fecha=datetime.now().strftime("%Y-%m-%d"),
            dias_mora=mora,
            app_cliente=app_cli,
            country=cty,
        )
        await db.contacts.insert_one(c.model_dump())
        inserted += 1
    await add_log("info", "Sistema", f"Demo seed: {inserted} contactos agregados")
    return {"inserted": inserted}

# ---------- Templates ----------
DEFAULT_TEMPLATES = {
    "nivel_1": "🟢 Hola {nombre} 👋 Te escribimos con un recordatorio amistoso: tienes un saldo pendiente de {monto} con {app_cliente} y llevas {dias_mora} días. Regularicemos hoy y aprovecha nuestros descuentos y facilidades. ¡Estamos para ayudarte!",
    "nivel_2": "🟡 {nombre}, tu cuenta con {app_cliente} lleva {dias_mora} días de mora y el saldo pendiente es {monto}. Necesitamos regularizar tu situación HOY. Responde este mensaje para agendar tu acuerdo de pago.",
    "nivel_3": "🟠 ATENCIÓN {nombre}: Este es tu aviso FINAL. Tu cuenta con {app_cliente} presenta {dias_mora} días de mora y el saldo es {monto}. Es la última oportunidad antes de iniciar acciones administrativas. Contáctanos de inmediato.",
    "nivel_4": "🔴 ADVERTENCIA LEGAL. {nombre}, tu cuenta con {app_cliente} lleva {dias_mora} días de mora con saldo {monto}. Al no regularizar tu deuda, tus datos serán reportados a buró de crédito y se iniciará el proceso legal correspondiente. Regulariza ya.",
    "default": "🟢 Hola {nombre}, le recordamos que tiene un saldo pendiente de {monto} con {app_cliente}. Lleva {dias_mora} días de mora. Gracias.",
    "friendly": "🟢 Hola {nombre} 👋 Solo un recordatorio amistoso: tienes un saldo de {monto} con {app_cliente}. Llevas {dias_mora} días.",
    "formal": "🟠 Estimado(a) {nombre}: Le informamos que su cuenta con {app_cliente} presenta un saldo pendiente de {monto} y {dias_mora} días de mora.",
    "urgent": "🔴 ⚠️ URGENTE: {nombre}, su cuenta con {app_cliente} lleva {dias_mora} días de mora. Saldo: {monto}. Contáctenos de inmediato.",
}

@api_router.get("/templates/{country}", response_model=List[Template])
async def get_templates(country: str):
    country = country.upper()
    docs = await db.templates.find({"country": country}, {"_id": 0}).to_list(20)
    existing_kinds = {d["kind"] for d in docs}
    # ensure defaults exist
    for kind, body in DEFAULT_TEMPLATES.items():
        if kind not in existing_kinds:
            t = Template(country=country, kind=kind, body=body)
            await db.templates.insert_one(t.model_dump())
            docs.append(t.model_dump())
    return [Template(**d) for d in docs]

@api_router.put("/templates", response_model=Template)
async def save_template(payload: TemplateSave):
    country = payload.country.upper()
    if country not in VALID_COUNTRIES:
        raise HTTPException(400, "Invalid country")
    existing = await db.templates.find_one({"country": country, "kind": payload.kind}, {"_id": 0})
    if existing:
        await db.templates.update_one(
            {"country": country, "kind": payload.kind},
            {"$set": {"body": payload.body, "updated_at": now_iso()}},
        )
        existing["body"] = payload.body
        existing["updated_at"] = now_iso()
        await add_log("success", "User", f"Plantilla {payload.kind} guardada", country)
        return Template(**existing)
    t = Template(country=country, kind=payload.kind, body=payload.body)
    await db.templates.insert_one(t.model_dump())
    await add_log("success", "User", f"Plantilla {payload.kind} creada", country)
    return t

# ---------- Logs ----------
@api_router.get("/logs", response_model=List[LogEntry])
async def get_logs(limit: int = 100, country: Optional[str] = None):
    q: Dict[str, Any] = {}
    if country and country.upper() != "ALL":
        q["country"] = country.upper()
    docs = await db.logs.find(q, {"_id": 0}).sort("ts", -1).to_list(limit)
    return [LogEntry(**d) for d in docs]

@api_router.post("/logs", response_model=LogEntry)
async def create_log(payload: LogCreate):
    return await add_log(payload.level, payload.source, payload.message, payload.country)

@api_router.delete("/logs")
async def clear_logs():
    res = await db.logs.delete_many({})
    return {"deleted": res.deleted_count}

# ---------- Send Messages ----------
@api_router.post("/send")
async def send_messages(req: SendRequest):
    country = req.country.upper()
    if country not in VALID_COUNTRIES:
        raise HTTPException(400, "Invalid country")

    # get template
    if req.template_override:
        body_tpl = req.template_override
    else:
        t = await db.templates.find_one({"country": country, "kind": req.template_kind}, {"_id": 0})
        body_tpl = t["body"] if t else DEFAULT_TEMPLATES.get(req.template_kind, DEFAULT_TEMPLATES["default"])

    # get config for webhook
    cfg = await db.configs.find_one({"country": country}, {"_id": 0}) or {}
    webhook_url = cfg.get("whatsapp_webhook_url", "").strip()
    api_key = cfg.get("whatsapp_api_key", "").strip()

    contacts = await db.contacts.find({"id": {"$in": req.contact_ids}}, {"_id": 0}).to_list(len(req.contact_ids))
    sent = 0
    errors = 0
    results = []
    async with httpx.AsyncClient(timeout=15.0) as http:
        for c in contacts:
            rendered = render_template(body_tpl, c)
            success = False
            err_msg = ""
            if req.channel == "whatsapp" and webhook_url:
                try:
                    headers = {"Content-Type": "application/json"}
                    if api_key:
                        headers["Authorization"] = f"Bearer {api_key}"
                    payload = {
                        "phone": c["telefono"],
                        "message": rendered,
                        "country": country,
                        "contact_id": c["id"],
                    }
                    r = await http.post(webhook_url, json=payload, headers=headers)
                    if 200 <= r.status_code < 300:
                        success = True
                    else:
                        err_msg = f"HTTP {r.status_code}: {r.text[:120]}"
                except Exception as e:
                    err_msg = f"Webhook error: {str(e)[:120]}"
            else:
                # No webhook configured OR SMS channel → simulated log-only
                success = True
                err_msg = "(sin webhook — registrado como enviado)"

            new_status = "sent" if success else "error"
            await db.contacts.update_one(
                {"id": c["id"]},
                {"$set": {"status": new_status, "last_error": err_msg, "updated_at": now_iso()}},
            )
            if success:
                sent += 1
                await add_log("success", req.channel.upper(), f"→ {c['nombre']} ({c['telefono']})", country)
            else:
                errors += 1
                await add_log("error", req.channel.upper(), f"✖ {c['nombre']}: {err_msg}", country)
            results.append({"contact_id": c["id"], "success": success, "error": err_msg})

    await db.dispatches.insert_one({
        "id": make_id(),
        "ts": now_iso(),
        "country": country,
        "channel": req.channel,
        "total": len(contacts),
        "sent": sent,
        "errors": errors,
    })
    return {"total": len(contacts), "sent": sent, "errors": errors, "results": results}

# ---------- Reports ----------
@api_router.get("/reports/summary")
async def reports_summary(country: Optional[str] = None):
    country_filter = None
    if country and country.upper() != "ALL" and country.upper() in VALID_COUNTRIES:
        country_filter = country.upper()

    base_q: Dict[str, Any] = {"country": country_filter} if country_filter else {}

    total_contacts = await db.contacts.count_documents(base_q)
    pending = await db.contacts.count_documents({**base_q, "status": "pending"})
    sent = await db.contacts.count_documents({**base_q, "status": "sent"})
    errors = await db.contacts.count_documents({**base_q, "status": "error"})

    # dispatches by channel
    dispatch_match = [{"$match": {"country": country_filter}}] if country_filter else []
    channel_stats = {}
    async for doc in db.dispatches.aggregate(dispatch_match + [
        {"$group": {
            "_id": "$channel",
            "total": {"$sum": "$total"},
            "sent": {"$sum": "$sent"},
            "errors": {"$sum": "$errors"},
        }}
    ]):
        channel_stats[doc["_id"]] = {"total": doc["total"], "sent": doc["sent"], "errors": doc["errors"]}

    # money aggregates
    money = {"debt": 0.0, "recovered": 0.0}
    money_pipeline = ([{"$match": base_q}] if base_q else []) + [
        {"$group": {
            "_id": None,
            "debt": {"$sum": {"$ifNull": ["$monto", 0]}},
            "recovered": {"$sum": {"$ifNull": ["$monto_recuperado", 0]}},
        }}
    ]
    async for doc in db.contacts.aggregate(money_pipeline):
        money = {"debt": doc.get("debt", 0.0), "recovered": doc.get("recovered", 0.0)}

    sms_from_csv = await db.contacts.count_documents({**base_q, "sms_enviado": True})
    formulario_ok = await db.contacts.count_documents({**base_q, "formulario_guardado": True})

    # estado counters
    estado_counts = {"pendiente": 0, "pagado": 0, "sin_contacto": 0, "parcial": 0}
    for e in list(estado_counts.keys()):
        estado_counts[e] = await db.contacts.count_documents({**base_q, "estado": e})

    # per-country (always all 4 for cross-country comparison in reports view)
    per_country = []
    countries_to_iterate = [country_filter] if country_filter else list(VALID_COUNTRIES)
    for c in countries_to_iterate:
        total = await db.contacts.count_documents({"country": c})
        p = await db.contacts.count_documents({"country": c, "status": "pending"})
        s = await db.contacts.count_documents({"country": c, "status": "sent"})
        e = await db.contacts.count_documents({"country": c, "status": "error"})
        sms_c = await db.contacts.count_documents({"country": c, "sms_enviado": True})
        pagado_c = await db.contacts.count_documents({"country": c, "estado": "pagado"})
        parcial_c = await db.contacts.count_documents({"country": c, "estado": "parcial"})
        sin_contacto_c = await db.contacts.count_documents({"country": c, "estado": "sin_contacto"})
        m = {"debt": 0.0, "recovered": 0.0}
        async for doc in db.contacts.aggregate([
            {"$match": {"country": c}},
            {"$group": {
                "_id": None,
                "debt": {"$sum": {"$ifNull": ["$monto", 0]}},
                "recovered": {"$sum": {"$ifNull": ["$monto_recuperado", 0]}},
            }}
        ]):
            m = {"debt": doc.get("debt", 0.0), "recovered": doc.get("recovered", 0.0)}

        per_country.append({
            "country": c,
            "total": total,
            "pending": p,
            "sent": s,
            "errors": e,
            "success_rate": round((s / total) * 100, 1) if total else 0.0,
            "sms_ok": sms_c,
            "debt": m["debt"],
            "recovered": m["recovered"],
            "recovery_rate": round((m["recovered"] / m["debt"]) * 100, 1) if m["debt"] else 0.0,
            "pagado": pagado_c,
            "parcial": parcial_c,
            "sin_contacto": sin_contacto_c,
        })

    total_sent_dispatches = sum(v["sent"] for v in channel_stats.values()) or sent
    total_all = sum(v["total"] for v in channel_stats.values()) or (sent + errors)
    success_rate = round((total_sent_dispatches / total_all) * 100, 1) if total_all else 0.0
    recovery_rate = round((money["recovered"] / money["debt"]) * 100, 1) if money["debt"] else 0.0

    return {
        "country_filter": country_filter,
        "total_contacts": total_contacts,
        "pending": pending,
        "sent": sent,
        "errors": errors,
        "total_sms": channel_stats.get("sms", {}).get("sent", 0),
        "total_whatsapp": channel_stats.get("whatsapp", {}).get("sent", 0),
        "success_rate": success_rate,
        "total_debt": money["debt"],
        "total_recovered": money["recovered"],
        "recovery_rate": recovery_rate,
        "sms_from_csv": sms_from_csv,
        "formulario_guardado": formulario_ok,
        "estado_counts": estado_counts,
        "per_country": per_country,
    }

# ---------- Scripts ----------
@api_router.post("/scripts", response_model=ScriptRef)
async def register_script(payload: ScriptRegister):
    country = payload.country.upper()
    s = ScriptRef(name=payload.name, country=country)
    await db.scripts.insert_one(s.model_dump())
    await add_log("info", "Sistema", f"Script registrado: {payload.name}", country)
    return s

@api_router.get("/scripts", response_model=List[ScriptRef])
async def list_scripts(country: Optional[str] = None):
    q: Dict[str, Any] = {}
    if country:
        q["country"] = country.upper()
    docs = await db.scripts.find(q, {"_id": 0}).sort("added_at", -1).to_list(100)
    return [ScriptRef(**d) for d in docs]

@api_router.delete("/scripts/{script_id}")
async def delete_script(script_id: str):
    res = await db.scripts.delete_one({"id": script_id})
    return {"deleted": res.deleted_count}

# ---------- WhatsApp Test ----------
@api_router.post("/whatsapp/test/{country}")
async def test_whatsapp(country: str):
    country = country.upper()
    cfg = await db.configs.find_one({"country": country}, {"_id": 0}) or {}
    url = cfg.get("whatsapp_webhook_url", "").strip()
    if not url:
        await db.configs.update_one({"country": country}, {"$set": {"whatsapp_connected": False}}, upsert=True)
        return {"connected": False, "reason": "webhook_url no configurada"}
    api_key = cfg.get("whatsapp_api_key", "").strip()
    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            headers = {}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            # Try HEAD first, fallback to GET
            try:
                r = await http.head(url, headers=headers)
            except Exception:
                r = await http.get(url, headers=headers)
            connected = r.status_code < 500
    except Exception as e:
        await add_log("error", "WhatsApp", f"Test conexión falló: {str(e)[:100]}", country)
        await db.configs.update_one({"country": country}, {"$set": {"whatsapp_connected": False}}, upsert=True)
        return {"connected": False, "reason": str(e)[:120]}
    await db.configs.update_one({"country": country}, {"$set": {"whatsapp_connected": connected}}, upsert=True)
    await add_log("success" if connected else "warn", "WhatsApp",
                  f"Test conexión: {'OK' if connected else 'sin respuesta'}", country)
    return {"connected": connected, "status_code": r.status_code}

# ---------- Files (Object Storage) ----------
class FileRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=make_id)
    storage_path: str
    original_filename: str
    content_type: str
    size: int
    category: str = "other"  # csv, export, report, other
    country: Optional[str] = None
    note: Optional[str] = ""
    is_deleted: bool = False
    created_at: str = Field(default_factory=now_iso)


@api_router.post("/files/upload", response_model=FileRecord)
async def upload_file(
    file: UploadFile = File(...),
    category: str = Form("other"),
    country: Optional[str] = Form(None),
    note: Optional[str] = Form(""),
):
    data = await file.read()
    ext = (file.filename or "file").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    path = f"{APP_NAME}/uploads/{(country or 'global').upper()}/{uuid.uuid4()}.{ext}"
    content_type = file.content_type or guess_mime(file.filename or "")
    try:
        result = put_object(path, data, content_type)
    except Exception as e:
        await add_log("error", "Storage", f"Upload failed: {str(e)[:150]}", country)
        raise HTTPException(500, f"Storage error: {str(e)[:200]}")

    rec = FileRecord(
        storage_path=result["path"],
        original_filename=file.filename or "archivo",
        content_type=content_type,
        size=result.get("size", len(data)),
        category=category,
        country=(country or None) and country.upper(),
        note=note or "",
    )
    await db.files.insert_one(rec.model_dump())
    await add_log("success", "Storage", f"Archivo subido: {rec.original_filename} ({rec.size} bytes)", rec.country)
    return rec


@api_router.get("/files", response_model=List[FileRecord])
async def list_files(country: Optional[str] = None, category: Optional[str] = None, limit: int = 200):
    q: Dict[str, Any] = {"is_deleted": False}
    if country and country.upper() != "ALL":
        q["country"] = country.upper()
    if category and category != "all":
        q["category"] = category
    docs = await db.files.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [FileRecord(**d) for d in docs]


@api_router.get("/files/{file_id}/download")
async def download_file(file_id: str):
    rec = await db.files.find_one({"id": file_id, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Archivo no encontrado")
    try:
        data, ctype = get_object(rec["storage_path"])
    except Exception as e:
        raise HTTPException(500, f"Storage error: {str(e)[:200]}")
    return Response(
        content=data,
        media_type=rec.get("content_type") or ctype,
        headers={
            "Content-Disposition": f'attachment; filename="{rec["original_filename"]}"',
        },
    )


@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str):
    rec = await db.files.find_one({"id": file_id, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    await db.files.update_one({"id": file_id}, {"$set": {"is_deleted": True}})
    await add_log("warn", "Storage", f"Archivo eliminado: {rec['original_filename']}", rec.get("country"))
    return {"deleted": True}


@api_router.post("/files/import-contacts/{file_id}")
async def import_contacts_from_file(file_id: str):
    """Import contacts from a previously uploaded CSV file."""
    rec = await db.files.find_one({"id": file_id, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Archivo no encontrado")
    country = (rec.get("country") or "MX").upper()
    if country not in VALID_COUNTRIES:
        country = "MX"
    try:
        data, _ = get_object(rec["storage_path"])
    except Exception as e:
        raise HTTPException(500, f"Storage error: {str(e)[:200]}")

    content = data.decode("utf-8-sig", errors="ignore")
    reader = csv.DictReader(io.StringIO(content))
    inserted = 0
    errors = 0
    docs = []
    for row in reader:
        try:
            r = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            c = parse_row_to_contact(r, country)
            if not c:
                errors += 1
                continue
            docs.append(c.model_dump())
            inserted += 1
        except Exception:
            errors += 1
    if docs:
        await db.contacts.insert_many(docs)
    await add_log("success", "Import", f"Contactos importados desde {rec['original_filename']}: {inserted}", country)
    return {"inserted": inserted, "errors": errors}


COUNTRY_DIAL_CODES = {
    "MX": "+52",
    "CO": "+57",
    "PE": "+51",
    "CL": "+56",
}


def normalize_phone(raw: str, dial_code: str) -> str:
    """Normalize a phone: remove separators, strip leading zeros, prepend country code."""
    if not raw:
        return ""
    digits = "".join(ch for ch in str(raw) if ch.isdigit() or ch == "+")
    if digits.startswith("+"):
        return digits
    # remove any leading zeros
    digits = digits.lstrip("0")
    return f"{dial_code}{digits}"


@api_router.post("/whatsapp/import")
async def whatsapp_import_csv(
    country: str = Form(...),
    dial_code: Optional[str] = Form(None),
    file: UploadFile = File(...),
):
    """Import a CSV of phones (without country code) → prepend dial code and store as contacts."""
    country = country.upper()
    if country not in VALID_COUNTRIES:
        raise HTTPException(400, "País inválido")
    code = (dial_code or COUNTRY_DIAL_CODES.get(country) or "+52").strip()
    if not code.startswith("+"):
        code = "+" + code

    content = (await file.read()).decode("utf-8-sig", errors="ignore")
    reader = csv.DictReader(io.StringIO(content))
    inserted = 0
    errors = 0
    contacts = []
    for row in reader:
        try:
            r = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            c = parse_row_to_contact(r, country, dial_code=code)
            if not c:
                errors += 1
                continue
            contacts.append(c.model_dump())
            inserted += 1
        except Exception:
            errors += 1
    if contacts:
        await db.contacts.insert_many(contacts)
    await add_log("success", "WhatsApp", f"CSV cargado con código {code}: {inserted} contactos", country)
    return {"inserted": inserted, "errors": errors, "dial_code": code, "country": country}


@api_router.get("/whatsapp/dial-codes")
async def get_dial_codes():
    return COUNTRY_DIAL_CODES


@api_router.get("/whatsapp/qr/{country}")
async def whatsapp_qr(country: str):
    """Generate a QR code encoding the webhook connection info for this country.
    User scans it with their WhatsApp automation service (Evolution API, WPPConnect, etc.)."""
    import qrcode
    import base64
    country = country.upper()
    cfg = await db.configs.find_one({"country": country}, {"_id": 0}) or {}
    payload = {
        "app": "cobranzas-xd",
        "country": country,
        "webhook": cfg.get("whatsapp_webhook_url", ""),
        "token": cfg.get("whatsapp_api_key", ""),
        "ts": now_iso(),
    }
    import json as _json
    text = _json.dumps(payload)
    qr = qrcode.QRCode(version=4, box_size=8, border=2)
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#E1FF00", back_color="#0A0A0F")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return {"qr_data_url": f"data:image/png;base64,{b64}", "payload": payload}


@api_router.post("/whatsapp/connect/{country}")
async def whatsapp_connect(country: str, payload: Dict[str, Any]):
    """Mark WhatsApp as connected. Accepts { webhook_url, api_key, phone_number }."""
    country = country.upper()
    if country not in VALID_COUNTRIES:
        raise HTTPException(400, "País inválido")
    update = {
        "whatsapp_webhook_url": payload.get("webhook_url", "").strip(),
        "whatsapp_api_key": payload.get("api_key", "").strip(),
        "whatsapp_phone": payload.get("phone_number", "").strip(),
        "whatsapp_connected": True,
        "updated_at": now_iso(),
        "country": country,
    }
    await db.configs.update_one({"country": country}, {"$set": update}, upsert=True)
    await add_log("success", "WhatsApp", f"Conectado: {update.get('whatsapp_phone') or 'sin número'}", country)
    return {"connected": True, **update}


@api_router.post("/whatsapp/disconnect/{country}")
async def whatsapp_disconnect(country: str):
    country = country.upper()
    await db.configs.update_one({"country": country}, {"$set": {"whatsapp_connected": False}}, upsert=True)
    await add_log("warn", "WhatsApp", "Desconectado", country)
    return {"connected": False}


@api_router.get("/whatsapp/status/{country}")
async def whatsapp_status(country: str):
    country = country.upper()
    cfg = await db.configs.find_one({"country": country}, {"_id": 0}) or {}
    return {
        "connected": bool(cfg.get("whatsapp_connected", False)),
        "phone": cfg.get("whatsapp_phone", ""),
        "webhook_url": cfg.get("whatsapp_webhook_url", ""),
        "has_key": bool(cfg.get("whatsapp_api_key", "")),
    }


@api_router.get("/fx/rates")
async def fx_rates(force: bool = False):
    return {**get_rates(force=force), "country_currency": COUNTRY_CURRENCY}


@api_router.get("/")
async def root():
    return {"status": "ok", "service": "Cobranzas Command Center"}

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_init_storage():
    try:
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.warning(f"Object storage init deferred: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    mongo_client.close()
