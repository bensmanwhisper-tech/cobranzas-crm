"""Tests for bug fix (dias_mora/solicitante/sms from CSV) and new endpoints:
notes, reminders, recovered, estado filter, medio_contacto, enriched reports."""
import os
import io
import pytest
import requests
from pathlib import Path

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    envf = Path("/app/frontend/.env")
    if envf.exists():
        for line in envf.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
API = f"{BASE_URL}/api"

REAL_CSV_URL = "https://customer-assets-rejwkqb3.emergentagent.net/job_client-flow-pro-3/artifacts/rh5984ip_informe_final_2026-07-15.csv"


@pytest.fixture(scope="module")
def real_csv_bytes():
    p = Path("/tmp/informe.csv")
    if p.exists():
        return p.read_bytes()
    r = requests.get(REAL_CSV_URL, timeout=30)
    assert r.status_code == 200
    p.write_bytes(r.content)
    return r.content


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    return sess


# ---- BUG FIX: /api/contacts/import must populate dias_mora, solicitante, sms_enviado ----
def test_bug_fix_contacts_import_real_csv(s, real_csv_bytes):
    files = {"file": ("informe.csv", real_csv_bytes, "text/csv")}
    data = {"country": "CL"}
    r = requests.post(f"{API}/contacts/import", files=files, data=data, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inserted"] >= 10, f"Expected many rows, got {body}"

    # Fetch back CL contacts and verify fields
    lst = s.get(f"{API}/contacts?country=CL&limit=500", timeout=20).json()
    # Filter to freshly imported ones by unique name: VICTOR MANUEL
    victor = [c for c in lst if c["nombre"] == "VICTOR MANUEL"]
    assert len(victor) >= 1, "Bug: VICTOR MANUEL not imported"
    v = victor[0]
    assert v["dias_mora"] == 8, f"BUG: dias_mora not populated! got {v['dias_mora']}"
    assert v["solicitante"], "BUG: solicitante empty"
    assert "Rico" in v["solicitante"] or "50005" in v["solicitante"]
    assert v["sms_enviado"] is True, f"BUG: sms_enviado not True from ✅! got {v['sms_enviado']}"
    assert v["formulario_guardado"] is True
    assert v["hora"] == "14:23:04", f"BUG: hora not preserved! got {v['hora']}"
    assert v["monto"] == 184080.0


def test_bug_fix_whatsapp_import_real_csv(s, real_csv_bytes):
    files = {"file": ("informe2.csv", real_csv_bytes, "text/csv")}
    data = {"country": "CL", "dial_code": "+56"}
    r = requests.post(f"{API}/whatsapp/import", files=files, data=data, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inserted"] >= 10
    assert body["dial_code"] == "+56"

    lst = s.get(f"{API}/contacts?country=CL&limit=500", timeout=20).json()
    # find any contact with +56 prefix and dias_mora > 0 and sms_enviado
    matched = [c for c in lst if c["telefono"].startswith("+56") and c.get("sms_enviado") is True and c["dias_mora"] > 0 and c.get("solicitante")]
    assert len(matched) >= 5, f"Bug: whatsapp import not extracting all CSV fields; matched={len(matched)}"


# ---- Fixtures for a fresh test contact ----
@pytest.fixture(scope="module")
def test_contact_id(s):
    payload = {
        "nombre": "TEST_notes_reminders",
        "telefono": "+56999999999",
        "monto": 1000.0,
        "country": "CL",
    }
    r = s.post(f"{API}/contacts", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    yield cid
    s.delete(f"{API}/contacts/{cid}", timeout=15)


# ---- Notes ----
def test_add_and_delete_note(s, test_contact_id):
    r = s.post(f"{API}/contacts/{test_contact_id}/notes",
               json={"text": "Primera nota", "author": "op1"}, timeout=15)
    assert r.status_code == 200, r.text
    c = r.json()
    assert len(c["notas"]) == 1
    assert c["notas"][0]["text"] == "Primera nota"
    assert c["notas"][0]["author"] == "op1"
    note_id = c["notas"][0]["id"]

    # add second
    r2 = s.post(f"{API}/contacts/{test_contact_id}/notes",
                json={"text": "Segunda"}, timeout=15)
    assert len(r2.json()["notas"]) == 2

    # delete first
    r3 = s.delete(f"{API}/contacts/{test_contact_id}/notes/{note_id}", timeout=15)
    assert r3.status_code == 200
    assert len(r3.json()["notas"]) == 1
    assert r3.json()["notas"][0]["text"] == "Segunda"


# ---- Reminders ----
def test_reminder_lifecycle(s, test_contact_id):
    r = s.post(f"{API}/contacts/{test_contact_id}/reminders",
               json={"text": "Llamar mañana", "due_at": "2026-02-01T10:00:00Z"}, timeout=15)
    assert r.status_code == 200
    c = r.json()
    assert len(c["recordatorios"]) == 1
    rem = c["recordatorios"][0]
    assert rem["text"] == "Llamar mañana"
    assert rem["done"] is False
    rid = rem["id"]

    # toggle
    r2 = s.patch(f"{API}/contacts/{test_contact_id}/reminders/{rid}/toggle", timeout=15)
    assert r2.status_code == 200
    toggled = next(x for x in r2.json()["recordatorios"] if x["id"] == rid)
    assert toggled["done"] is True

    # toggle again
    r3 = s.patch(f"{API}/contacts/{test_contact_id}/reminders/{rid}/toggle", timeout=15)
    toggled2 = next(x for x in r3.json()["recordatorios"] if x["id"] == rid)
    assert toggled2["done"] is False

    # delete
    r4 = s.delete(f"{API}/contacts/{test_contact_id}/reminders/{rid}", timeout=15)
    assert r4.status_code == 200
    assert len(r4.json()["recordatorios"]) == 0


# ---- Recovered amount ----
def test_recovered_partial(s):
    # Create fresh contact
    payload = {"nombre": "TEST_partial", "telefono": "+56911111", "monto": 1000.0, "country": "CL"}
    cid = s.post(f"{API}/contacts", json=payload, timeout=15).json()["id"]
    try:
        r = s.patch(f"{API}/contacts/{cid}/recovered", json={"monto_recuperado": 300.0}, timeout=15)
        assert r.status_code == 200
        c = r.json()
        assert c["monto_recuperado"] == 300.0
        assert c["estado"] == "parcial", f"Expected parcial, got {c['estado']}"
    finally:
        s.delete(f"{API}/contacts/{cid}")


def test_recovered_pagado(s):
    payload = {"nombre": "TEST_pagado", "telefono": "+56922222", "monto": 500.0, "country": "CL"}
    cid = s.post(f"{API}/contacts", json=payload, timeout=15).json()["id"]
    try:
        r = s.patch(f"{API}/contacts/{cid}/recovered", json={"monto_recuperado": 500.0}, timeout=15)
        assert r.status_code == 200
        assert r.json()["estado"] == "pagado"
    finally:
        s.delete(f"{API}/contacts/{cid}")


def test_recovered_zero_keeps_state(s):
    payload = {"nombre": "TEST_zero", "telefono": "+56933333", "monto": 500.0, "country": "CL"}
    cid = s.post(f"{API}/contacts", json=payload, timeout=15).json()["id"]
    try:
        r = s.patch(f"{API}/contacts/{cid}/recovered", json={"monto_recuperado": 0.0}, timeout=15)
        assert r.status_code == 200
        c = r.json()
        # 0 recovered → estado stays 'pendiente' (not parcial, not pagado)
        # NOTE: current code: >= monto (0>=500 false), >0 false → no estado change
        assert c["estado"] == "pendiente", f"Zero should keep pendiente, got {c['estado']}"
        assert c["monto_recuperado"] == 0.0
    finally:
        s.delete(f"{API}/contacts/{cid}")


# ---- Estado change via PATCH /contacts/{id} ----
def test_patch_estado_valid(s):
    payload = {"nombre": "TEST_estado", "telefono": "+56944444", "monto": 100.0, "country": "CL"}
    cid = s.post(f"{API}/contacts", json=payload, timeout=15).json()["id"]
    try:
        for estado in ("pagado", "parcial", "sin_contacto", "pendiente"):
            r = s.patch(f"{API}/contacts/{cid}", json={"estado": estado}, timeout=15)
            assert r.status_code == 200
            assert r.json()["estado"] == estado
    finally:
        s.delete(f"{API}/contacts/{cid}")


def test_patch_estado_invalid(s):
    payload = {"nombre": "TEST_estado_bad", "telefono": "+56955555", "monto": 100.0, "country": "CL"}
    cid = s.post(f"{API}/contacts", json=payload, timeout=15).json()["id"]
    try:
        r = s.patch(f"{API}/contacts/{cid}", json={"estado": "inexistente"}, timeout=15)
        assert r.status_code == 400
    finally:
        s.delete(f"{API}/contacts/{cid}")


def test_patch_medio_contacto(s):
    payload = {"nombre": "TEST_medio", "telefono": "+56966666", "monto": 100.0, "country": "CL"}
    cid = s.post(f"{API}/contacts", json=payload, timeout=15).json()["id"]
    try:
        r = s.patch(f"{API}/contacts/{cid}", json={"medio_contacto": "whatsapp"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["medio_contacto"] == "whatsapp"
    finally:
        s.delete(f"{API}/contacts/{cid}")


# ---- Filter by estado ----
def test_list_filter_by_estado(s):
    # Ensure at least one 'parcial' exists
    p = {"nombre": "TEST_filter_parcial", "telefono": "+56977777", "monto": 1000.0, "country": "CL"}
    cid = s.post(f"{API}/contacts", json=p, timeout=15).json()["id"]
    s.patch(f"{API}/contacts/{cid}/recovered", json={"monto_recuperado": 100.0})
    try:
        r = s.get(f"{API}/contacts?estado=parcial&limit=500", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert all(c["estado"] == "parcial" for c in data)
        assert any(c["id"] == cid for c in data)
    finally:
        s.delete(f"{API}/contacts/{cid}")


# ---- Enriched reports summary ----
def test_reports_summary_enriched(s):
    r = s.get(f"{API}/reports/summary", timeout=30)
    assert r.status_code == 200
    body = r.json()
    for k in ("total_debt", "total_recovered", "recovery_rate",
              "sms_from_csv", "formulario_guardado", "estado_counts", "per_country"):
        assert k in body, f"Missing key {k}"
    ec = body["estado_counts"]
    for e in ("pendiente", "pagado", "sin_contacto", "parcial"):
        assert e in ec
        assert isinstance(ec[e], int)
    # per_country enriched
    for pc in body["per_country"]:
        for k in ("debt", "recovered", "recovery_rate", "sms_ok"):
            assert k in pc, f"per_country missing {k}"
    # After importing CSV with ✅, sms_from_csv should be > 0
    assert body["sms_from_csv"] > 0, "sms_from_csv should count contacts with ✅"
    assert body["total_debt"] > 0
