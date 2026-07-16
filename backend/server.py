from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
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
    whatsapp_connected: Optional[bool] = False
    updated_at: Optional[str] = None

class Contact(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=make_id)
    nombre: str
    telefono: str
    monto: float = 0.0
    empresa: Optional[str] = ""
    vencimiento: Optional[str] = ""
    fecha: Optional[str] = ""
    country: str
    status: str = "pending"  # pending, sent, error
    last_error: Optional[str] = ""
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)

class ContactCreate(BaseModel):
    nombre: str
    telefono: str
    monto: float = 0.0
    empresa: Optional[str] = ""
    vencimiento: Optional[str] = ""
    fecha: Optional[str] = ""
    country: str

class ContactUpdate(BaseModel):
    nombre: Optional[str] = None
    telefono: Optional[str] = None
    monto: Optional[float] = None
    empresa: Optional[str] = None
    vencimiento: Optional[str] = None
    fecha: Optional[str] = None
    status: Optional[str] = None

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
async def list_contacts(country: Optional[str] = None, status: Optional[str] = None, limit: int = 500):
    q: Dict[str, Any] = {}
    if country and country.upper() != "ALL":
        q["country"] = country.upper()
    if status and status != "all":
        q["status"] = status
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
    await db.contacts.update_one({"id": contact_id}, {"$set": patch})
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
            # normalize keys (lowercase, no spaces)
            r = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            nombre = r.get("nombre") or r.get("name") or r.get("cliente") or ""
            telefono = r.get("telefono") or r.get("teléfono") or r.get("phone") or r.get("celular") or ""
            monto_raw = r.get("monto") or r.get("amount") or "0"
            try:
                monto = float(str(monto_raw).replace(",", "").replace("$", "").strip() or 0)
            except Exception:
                monto = 0.0
            if not nombre and not telefono:
                errors += 1
                continue
            c = Contact(
                nombre=nombre or "Sin nombre",
                telefono=telefono,
                monto=monto,
                empresa=r.get("empresa") or r.get("company") or "",
                vencimiento=r.get("vencimiento") or r.get("due") or "",
                fecha=r.get("fecha") or r.get("date") or "",
                country=country,
            )
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
        ("Carlos Ramírez", "+52 55 1234 5678", 4520.50, "Grupo Aguila", "MX"),
        ("María López", "+52 33 2345 6789", 8900.00, "Cementos MX", "MX"),
        ("José Hernández", "+52 81 3456 7890", 1250.75, "Autopartes SA", "MX"),
        ("Ana García", "+52 55 4567 8901", 15600.00, "Constructora del Norte", "MX"),
        ("Andrés Torres", "+57 300 111 2233", 3200.00, "Bavaria SA", "CO"),
        ("Diana Vargas", "+57 301 222 3344", 7800.90, "Ecopetrol", "CO"),
        ("Camilo Ruiz", "+57 310 333 4455", 2100.00, "Bancolombia", "CO"),
        ("Rocío Mendoza", "+51 987 654 321", 5600.00, "Backus SA", "PE"),
        ("Luis Quispe", "+51 986 543 210", 12400.00, "Alicorp", "PE"),
        ("Fernanda Castillo", "+51 985 432 109", 890.00, "Interbank", "PE"),
        ("Sebastián Rojas", "+56 9 8765 4321", 6700.00, "Falabella", "CL"),
        ("Valentina Núñez", "+56 9 7654 3210", 3400.50, "Cencosud", "CL"),
        ("Matías Pérez", "+56 9 6543 2109", 9200.00, "Copec SA", "CL"),
    ]
    inserted = 0
    for nombre, tel, monto, empresa, cty in demo_data:
        if country and country.upper() != cty:
            continue
        c = Contact(
            nombre=nombre,
            telefono=tel,
            monto=monto,
            empresa=empresa,
            vencimiento="2026-03-15",
            fecha=datetime.now().strftime("%Y-%m-%d"),
            country=cty,
        )
        await db.contacts.insert_one(c.model_dump())
        inserted += 1
    await add_log("info", "Sistema", f"Demo seed: {inserted} contactos agregados")
    return {"inserted": inserted}

# ---------- Templates ----------
DEFAULT_TEMPLATES = {
    "default": "Hola {nombre}, le recordamos que tiene un saldo pendiente de ${monto} con {empresa}. Fecha de vencimiento: {vencimiento}. Gracias.",
    "friendly": "Hola {nombre} 👋 Solo un recordatorio amistoso: tienes un saldo de ${monto} con {empresa}. Vence el {vencimiento}. ¡Cualquier duda, escríbenos!",
    "formal": "Estimado(a) {nombre}: Le informamos que su cuenta presenta un saldo pendiente de ${monto} con {empresa}, con fecha de vencimiento {vencimiento}. Favor de regularizar.",
    "urgent": "⚠️ URGENTE: {nombre}, su cuenta con {empresa} vence HOY ({vencimiento}). Saldo: ${monto}. Contáctenos de inmediato para evitar cargos adicionales.",
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
async def reports_summary():
    total_contacts = await db.contacts.count_documents({})
    pending = await db.contacts.count_documents({"status": "pending"})
    sent = await db.contacts.count_documents({"status": "sent"})
    errors = await db.contacts.count_documents({"status": "error"})

    # dispatches by channel
    pipeline_channel = [
        {"$group": {
            "_id": "$channel",
            "total": {"$sum": "$total"},
            "sent": {"$sum": "$sent"},
            "errors": {"$sum": "$errors"},
        }},
    ]
    channel_stats = {}
    async for doc in db.dispatches.aggregate(pipeline_channel):
        channel_stats[doc["_id"]] = {"total": doc["total"], "sent": doc["sent"], "errors": doc["errors"]}

    # per-country
    per_country = []
    for c in VALID_COUNTRIES:
        total = await db.contacts.count_documents({"country": c})
        p = await db.contacts.count_documents({"country": c, "status": "pending"})
        s = await db.contacts.count_documents({"country": c, "status": "sent"})
        e = await db.contacts.count_documents({"country": c, "status": "error"})
        per_country.append({
            "country": c,
            "total": total,
            "pending": p,
            "sent": s,
            "errors": e,
            "success_rate": round((s / total) * 100, 1) if total else 0.0,
        })

    total_sent_dispatches = sum(v["sent"] for v in channel_stats.values()) or sent
    total_all = sum(v["total"] for v in channel_stats.values()) or (sent + errors)
    success_rate = round((total_sent_dispatches / total_all) * 100, 1) if total_all else 0.0

    return {
        "total_contacts": total_contacts,
        "pending": pending,
        "sent": sent,
        "errors": errors,
        "total_sms": channel_stats.get("sms", {}).get("sent", 0),
        "total_whatsapp": channel_stats.get("whatsapp", {}).get("sent", 0),
        "success_rate": success_rate,
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

@app.on_event("shutdown")
async def shutdown_db_client():
    mongo_client.close()
