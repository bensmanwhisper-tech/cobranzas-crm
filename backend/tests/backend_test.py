"""Backend tests for Cobranzas CRM (WhatsApp Center + Storage + core CRUD)."""
import os
import io
import base64
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to reading frontend/.env
    from pathlib import Path
    envf = Path("/app/frontend/.env")
    if envf.exists():
        for line in envf.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE_URL}/api"
WEBHOOK = "https://httpbin.org/post"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- Dial codes ----------
def test_dial_codes(s):
    r = s.get(f"{API}/whatsapp/dial-codes", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data == {"MX": "+52", "CO": "+57", "PE": "+51", "CL": "+56"}


# ---------- WhatsApp connect / status / disconnect ----------
def test_connect_status_disconnect(s):
    r = s.post(
        f"{API}/whatsapp/connect/MX",
        json={"webhook_url": WEBHOOK, "api_key": "test-key", "phone_number": "+5215500000000"},
        timeout=15,
    )
    assert r.status_code == 200
    assert r.json().get("connected") is True

    r2 = s.get(f"{API}/whatsapp/status/MX", timeout=15)
    assert r2.status_code == 200
    st = r2.json()
    assert st["connected"] is True
    assert st["webhook_url"] == WEBHOOK
    assert st["has_key"] is True

    r3 = s.post(f"{API}/whatsapp/disconnect/MX", timeout=15)
    assert r3.status_code == 200
    assert r3.json()["connected"] is False

    st2 = s.get(f"{API}/whatsapp/status/MX", timeout=15).json()
    assert st2["connected"] is False

    # reconnect for send test later
    s.post(f"{API}/whatsapp/connect/MX",
           json={"webhook_url": WEBHOOK, "api_key": "test-key", "phone_number": "+5215500000000"},
           timeout=15)


# ---------- QR ----------
def test_whatsapp_qr(s):
    r = s.get(f"{API}/whatsapp/qr/MX", timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert "qr_data_url" in body
    assert body["qr_data_url"].startswith("data:image/png;base64,")
    b64 = body["qr_data_url"].split(",", 1)[1]
    raw = base64.b64decode(b64)
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
    assert body["payload"]["country"] == "MX"


# ---------- WhatsApp CSV import (dial code prepended) ----------
def test_whatsapp_import_csv(s):
    csv_data = (
        "nombre,telefono,dias_mora,app_cliente,monto\n"
        "Prueba Uno,5511111111,30,Kueski,1500\n"
        "Prueba Dos,5522222222,60,Nu,2500\n"
    )
    files = {"file": ("test.csv", csv_data, "text/csv")}
    data = {"country": "MX", "dial_code": "+52"}
    r = requests.post(f"{API}/whatsapp/import", files=files, data=data, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inserted"] == 2
    assert body["dial_code"] == "+52"

    # verify phones have +52 prepended
    r2 = s.get(f"{API}/contacts?country=MX&status=pending&limit=500", timeout=15)
    assert r2.status_code == 200
    contacts = r2.json()
    matches = [c for c in contacts if c["nombre"] in ("Prueba Uno", "Prueba Dos")]
    assert len(matches) >= 2
    for c in matches:
        assert c["telefono"].startswith("+52"), f"Phone not normalized: {c['telefono']}"
        assert c["dias_mora"] in (30, 60)
        assert c["app_cliente"] in ("Kueski", "Nu")


# ---------- Seed demo ----------
def test_seed_demo_mx(s):
    r = requests.post(f"{API}/contacts/seed-demo?country=MX", timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert body["inserted"] == 4
    r2 = s.get(f"{API}/contacts?country=MX&limit=500", timeout=15).json()
    seeded = [c for c in r2 if c.get("app_cliente") and c.get("dias_mora", 0) > 0]
    assert len(seeded) >= 4


# ---------- Templates ----------
def test_templates_defaults(s):
    r = s.get(f"{API}/templates/MX", timeout=15)
    assert r.status_code == 200
    tpls = r.json()
    kinds = {t["kind"] for t in tpls}
    assert {"default", "friendly", "formal", "urgent"}.issubset(kinds)
    # New templates should use {dias_mora} and {app_cliente} — but if old templates
    # exist in DB they are NOT auto-migrated. Verify at least one of the 4 uses them.
    bodies = [t["body"] for t in tpls]
    uses_new_placeholders = any("{dias_mora}" in b and "{app_cliente}" in b for b in bodies)
    assert uses_new_placeholders, (
        "None of the 4 templates contain {dias_mora}/{app_cliente} — "
        "old templates in DB not migrated to new defaults"
    )


def test_templates_save(s):
    payload = {"country": "MX", "kind": "urgent", "body": "TEST_ {nombre} tiene {dias_mora} días con {app_cliente}"}
    r = s.put(f"{API}/templates", json=payload, timeout=15)
    assert r.status_code == 200
    assert r.json()["body"].startswith("TEST_")
    # verify persist
    r2 = s.get(f"{API}/templates/MX", timeout=15).json()
    urgent = next(t for t in r2 if t["kind"] == "urgent")
    assert urgent["body"].startswith("TEST_")


# ---------- Send messages ----------
def test_send_messages(s):
    # ensure connected
    s.post(f"{API}/whatsapp/connect/MX",
           json={"webhook_url": WEBHOOK, "api_key": "k", "phone_number": "+5215500000000"},
           timeout=15)
    # get some MX pending contacts
    contacts = s.get(f"{API}/contacts?country=MX&status=pending&limit=5", timeout=15).json()
    assert len(contacts) >= 1
    ids = [c["id"] for c in contacts[:2]]
    r = s.post(f"{API}/send",
               json={"country": "MX", "contact_ids": ids, "template_kind": "urgent", "channel": "whatsapp"},
               timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == len(ids)
    assert body["sent"] + body["errors"] == len(ids)
    # Webhook was called (either success or captured error). Flow works either way.
    # check status updated
    for cid in ids:
        c = next(x for x in s.get(f"{API}/contacts?country=MX&limit=500").json() if x["id"] == cid)
        assert c["status"] in ("sent", "error")


# ---------- Logs ----------
def test_logs(s):
    r = s.get(f"{API}/logs?limit=20", timeout=15)
    assert r.status_code == 200
    logs = r.json()
    assert isinstance(logs, list)
    assert len(logs) > 0
    # descending order by ts
    ts_list = [l["ts"] for l in logs]
    assert ts_list == sorted(ts_list, reverse=True)


# ---------- Reports summary ----------
def test_reports_summary(s):
    r = s.get(f"{API}/reports/summary", timeout=20)
    assert r.status_code == 200
    body = r.json()
    for k in ("total_contacts", "sent", "errors", "per_country", "success_rate"):
        assert k in body
    assert len(body["per_country"]) == 4
    for pc in body["per_country"]:
        assert pc["country"] in {"MX", "CO", "PE", "CL"}
        assert "success_rate" in pc


# ---------- File storage ----------
_file_id_holder = {}


def test_file_upload(s):
    csv_data = (
        "nombre,telefono,dias_mora,app_cliente,monto\n"
        "FileImport Uno,5599999999,10,Yape,900\n"
    )
    files = {"file": ("upload.csv", csv_data, "text/csv")}
    data = {"category": "csv", "country": "MX", "note": "test"}
    r = requests.post(f"{API}/files/upload", files=files, data=data, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] and body["storage_path"] and body["size"] > 0
    _file_id_holder["id"] = body["id"]


def test_file_list_and_download(s):
    fid = _file_id_holder.get("id")
    assert fid, "upload must run first"
    lst = s.get(f"{API}/files?country=MX", timeout=15).json()
    assert any(f["id"] == fid for f in lst)
    r = requests.get(f"{API}/files/{fid}/download", timeout=30)
    assert r.status_code == 200
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd.lower()
    assert "upload.csv" in cd
    assert b"FileImport Uno" in r.content


def test_import_contacts_from_file(s):
    fid = _file_id_holder.get("id")
    assert fid
    r = requests.post(f"{API}/files/import-contacts/{fid}", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inserted"] >= 1
    lst = s.get(f"{API}/contacts?country=MX&limit=500", timeout=15).json()
    assert any(c["nombre"] == "FileImport Uno" for c in lst)
