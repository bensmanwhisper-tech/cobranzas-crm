"""Tests for bug fix: PATCH /api/contacts/{id} auto-syncs monto_recuperado when estado changes."""
import os
import pytest
import requests

def _load_base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        # Load from frontend/.env
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    assert url, "REACT_APP_BACKEND_URL not configured"
    return url.rstrip("/")


BASE_URL = _load_base_url()
API = f"{BASE_URL}/api"


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _create_contact(client, nombre="TEST_estado_sync", monto=1000.0, country="CL", estado="pendiente"):
    r = client.post(f"{API}/contacts", json={
        "nombre": nombre, "telefono": "+56900000000", "monto": monto,
        "country": country, "estado": estado
    })
    assert r.status_code == 200, r.text
    return r.json()


def _cleanup(client, cid):
    try:
        client.delete(f"{API}/contacts/{cid}")
    except Exception:
        pass


class TestEstadoPagadoAutoSync:
    def test_marking_pagado_sets_monto_recuperado_to_monto(self, api_client):
        c = _create_contact(api_client, nombre="TEST_pagado1", monto=1500.0)
        try:
            assert c["monto_recuperado"] == 0.0
            r = api_client.patch(f"{API}/contacts/{c['id']}", json={"estado": "pagado"})
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["estado"] == "pagado"
            assert data["monto_recuperado"] == 1500.0
            # verify persistence
            g = api_client.get(f"{API}/contacts?country=CL").json()
            match = [x for x in g if x["id"] == c["id"]][0]
            assert match["monto_recuperado"] == 1500.0
        finally:
            _cleanup(api_client, c["id"])

    def test_explicit_monto_recuperado_is_respected(self, api_client):
        c = _create_contact(api_client, nombre="TEST_pagado_explicit", monto=1000.0)
        try:
            r = api_client.patch(f"{API}/contacts/{c['id']}",
                                 json={"estado": "pagado", "monto_recuperado": 500})
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["estado"] == "pagado"
            assert data["monto_recuperado"] == 500.0
        finally:
            _cleanup(api_client, c["id"])

    def test_regress_to_pendiente_resets_monto_recuperado(self, api_client):
        c = _create_contact(api_client, nombre="TEST_regress_pendiente", monto=800.0)
        try:
            r1 = api_client.patch(f"{API}/contacts/{c['id']}", json={"estado": "pagado"})
            assert r1.json()["monto_recuperado"] == 800.0
            r2 = api_client.patch(f"{API}/contacts/{c['id']}", json={"estado": "pendiente"})
            assert r2.status_code == 200
            assert r2.json()["estado"] == "pendiente"
            assert r2.json()["monto_recuperado"] == 0.0
        finally:
            _cleanup(api_client, c["id"])

    def test_regress_to_sin_contacto_resets_monto_recuperado(self, api_client):
        c = _create_contact(api_client, nombre="TEST_regress_sc", monto=600.0)
        try:
            api_client.patch(f"{API}/contacts/{c['id']}", json={"estado": "pagado"})
            r = api_client.patch(f"{API}/contacts/{c['id']}", json={"estado": "sin_contacto"})
            assert r.status_code == 200
            assert r.json()["estado"] == "sin_contacto"
            assert r.json()["monto_recuperado"] == 0.0
        finally:
            _cleanup(api_client, c["id"])

    def test_parcial_does_not_change_monto_recuperado(self, api_client):
        c = _create_contact(api_client, nombre="TEST_parcial", monto=1000.0)
        try:
            # set some partial recovered via dedicated endpoint
            rp = api_client.patch(f"{API}/contacts/{c['id']}/recovered",
                                  json={"monto_recuperado": 300})
            assert rp.status_code == 200
            assert rp.json()["monto_recuperado"] == 300.0
            # now PATCH estado=parcial without touching monto_recuperado
            r = api_client.patch(f"{API}/contacts/{c['id']}", json={"estado": "parcial"})
            assert r.status_code == 200
            assert r.json()["estado"] == "parcial"
            assert r.json()["monto_recuperado"] == 300.0
        finally:
            _cleanup(api_client, c["id"])

    def test_reports_summary_reflects_pagado(self, api_client):
        # baseline
        base = api_client.get(f"{API}/reports/summary?country=CL").json()
        base_recovered = float(base.get("total_recovered") or 0)
        c = _create_contact(api_client, nombre="TEST_report_sync", monto=2000.0, country="CL")
        try:
            api_client.patch(f"{API}/contacts/{c['id']}", json={"estado": "pagado"})
            after = api_client.get(f"{API}/reports/summary?country=CL").json()
            after_recovered = float(after.get("total_recovered") or 0)
            assert after_recovered >= base_recovered + 2000.0 - 0.01, \
                f"expected +2000, got base={base_recovered} after={after_recovered}"
            assert float(after.get("recovery_rate") or 0) > 0
        finally:
            _cleanup(api_client, c["id"])


class TestExistingEndpointsRegression:
    def test_recovered_endpoint_still_works(self, api_client):
        c = _create_contact(api_client, nombre="TEST_recovered_ep", monto=1000.0)
        try:
            r = api_client.patch(f"{API}/contacts/{c['id']}/recovered",
                                 json={"monto_recuperado": 1000, "marcar_pagado": True})
            assert r.status_code == 200
            assert r.json()["estado"] == "pagado"
            assert r.json()["monto_recuperado"] == 1000.0
        finally:
            _cleanup(api_client, c["id"])

    def test_notes_endpoint(self, api_client):
        c = _create_contact(api_client, nombre="TEST_notes", monto=100.0)
        try:
            r = api_client.post(f"{API}/contacts/{c['id']}/notes",
                                json={"text": "TEST note", "author": "tester"})
            assert r.status_code == 200
            notas = r.json().get("notas", [])
            assert any(n.get("text") == "TEST note" for n in notas)
        finally:
            _cleanup(api_client, c["id"])

    def test_reminders_endpoint(self, api_client):
        c = _create_contact(api_client, nombre="TEST_rem", monto=100.0)
        try:
            r = api_client.post(f"{API}/contacts/{c['id']}/reminders",
                                json={"text": "TEST rem", "due_at": "2026-12-31T10:00:00Z"})
            assert r.status_code == 200
        finally:
            _cleanup(api_client, c["id"])

    def test_filter_by_estado(self, api_client):
        c = _create_contact(api_client, nombre="TEST_filter", monto=100.0)
        try:
            api_client.patch(f"{API}/contacts/{c['id']}", json={"estado": "pagado"})
            r = api_client.get(f"{API}/contacts?estado=pagado")
            assert r.status_code == 200
            ids = [x["id"] for x in r.json()]
            assert c["id"] in ids
        finally:
            _cleanup(api_client, c["id"])

    def test_whatsapp_import_endpoint(self, api_client):
        # Endpoint is POST; just verify it exists and doesn't 404/500 on empty payload
        r = api_client.post(f"{API}/whatsapp/import", json={})
        assert r.status_code in (200, 400, 422)
