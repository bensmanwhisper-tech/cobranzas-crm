import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, FolderOpen, Globe, Key, FileCode2, TestTube2, Plus, Trash2 } from "lucide-react";
import { findCountry } from "@/lib/countries";
import { endpoints } from "@/lib/api";

export default function ConfigView({ country, config, onSaved }) {
  const [form, setForm] = useState(null);
  const [metaForm, setMetaForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [scripts, setScripts] = useState([]);
  const [newScript, setNewScript] = useState("");
  const cty = findCountry(country);

  useEffect(() => {
    if (config) setForm(config);
    endpoints.whatsappMetaConfigGet().then(setMetaForm).catch(console.error);
  }, [config]);

  useEffect(() => {
    endpoints.listScripts(country).then(setScripts);
  }, [country]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await endpoints.saveConfig(country, form);
      if (metaForm) {
        await endpoints.whatsappMetaConfigSave(metaForm);
      }
      toast.success(`Configuración guardada para ${cty.label} y Meta`);
      onSaved?.();
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const testWA = async () => {
    if (!form?.whatsapp_webhook_url) { toast.warning("Configura el webhook primero"); return; }
    // save first, then test
    await endpoints.saveConfig(country, form);
    const r = await endpoints.testWhatsapp(country);
    if (r.connected) toast.success("✓ Webhook responde correctamente");
    else toast.error(`Sin conexión: ${r.reason || "sin respuesta"}`);
    onSaved?.();
  };

  const addScript = async () => {
    const name = newScript.trim();
    if (!name) return;
    await endpoints.registerScript({ name, country });
    setNewScript("");
    setScripts(await endpoints.listScripts(country));
    toast.success("Script registrado");
  };

  const delScript = async (id) => {
    await endpoints.deleteScript(id);
    setScripts(await endpoints.listScripts(country));
  };

  if (!form) return <div className="text-zinc-500 font-mono">cargando configuración...</div>;

  return (
    <div className="space-y-6 max-w-4xl" data-testid="config-view">
      <div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-1">País</div>
        <h1 className="font-display font-bold text-3xl tracking-tight">
          Configuración · <span style={{ color: cty.color }}>{cty.flag} {cty.label}</span>
        </h1>
        <p className="text-zinc-400 text-sm mt-1">Ajustes de rutas, scripts y conexión externa de WhatsApp.</p>
      </div>

      {/* Paths & URLs */}
      <Section title="Rutas y Collection" icon={Globe}>
        <Field
          label="URL de Collection"
          testId="field-collection-url"
          value={form.collection_url}
          onChange={(v) => setForm({ ...form, collection_url: v })}
          placeholder="https://tu-collection.com/panel"
        />
        <Field
          label="Carpeta CSV"
          testId="field-csv-folder"
          value={form.csv_folder}
          onChange={(v) => setForm({ ...form, csv_folder: v })}
          placeholder="C:\Cobranzas\CSV\"
          icon={FolderOpen}
        />
        <Field
          label="Carpeta de Scripts (.py)"
          testId="field-scripts-folder"
          value={form.scripts_folder}
          onChange={(v) => setForm({ ...form, scripts_folder: v })}
          placeholder="C:\Cobranzas\App\backend\scripts_subidos\"
          icon={FolderOpen}
        />
        <Field
          label="Script activo"
          testId="field-script-name"
          value={form.script_name}
          onChange={(v) => setForm({ ...form, script_name: v })}
          placeholder="cobranza_mx_v3.py"
          icon={FileCode2}
        />
      </Section>

      {/* WhatsApp */}
      <Section title="WhatsApp API (externa)" icon={Key} accent={cty.color}>
        <div className="text-xs text-zinc-500 mb-3 font-mono">
          El CRM enviará mensajes vía POST al webhook. Funciona con cualquier proveedor (Evolution API, WPPConnect, Twilio, WhatsApp Cloud API, tu propio bridge).
        </div>
        <Field
          label="Webhook URL (POST)"
          testId="field-wa-webhook"
          value={form.whatsapp_webhook_url}
          onChange={(v) => setForm({ ...form, whatsapp_webhook_url: v })}
          placeholder="https://tu-servidor.com/send-message"
        />
        <Field
          label="API Key / Token (opcional)"
          testId="field-wa-key"
          value={form.whatsapp_api_key}
          onChange={(v) => setForm({ ...form, whatsapp_api_key: v })}
          placeholder="sk_..."
          type="password"
        />
        <div className="pt-2 flex gap-2">
          <button
            data-testid="test-wa-btn"
            onClick={testWA}
            className="text-xs px-3 py-2 rounded-md bg-[#0B0B0F] border border-white/10 hover:border-white/20 text-zinc-200 flex items-center gap-1.5"
          >
            <TestTube2 size={13} />
            Probar conexión
          </button>
        </div>
        <div className="mt-3 p-3 bg-black/40 border border-white/5 rounded-md">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5">Payload que envía el CRM</div>
          <pre className="text-[11px] font-mono text-emerald-300 leading-relaxed">
{`POST ${form.whatsapp_webhook_url || "<webhook_url>"}
Authorization: Bearer <api_key>
Content-Type: application/json

{
  "phone":      "+52 55 1234 5678",
  "message":    "Hola Carlos, saldo pendiente...",
  "country":    "${country}",
  "contact_id": "uuid..."
}`}
          </pre>
        </div>
      </Section>

      {/* Meta Cloud API */}
      <Section title="WhatsApp Cloud API (Meta Oficial - Global)" icon={Key} accent="#06D6A0">
        <div className="text-xs text-zinc-500 mb-3 font-mono">
          Configuración global para la API oficial de WhatsApp (Meta). Estos valores aplican para todos los países.
        </div>
        <Field
          label="Access Token (Permanente)"
          testId="field-meta-token"
          value={metaForm?.access_token || ""}
          onChange={(v) => setMetaForm({ ...metaForm, access_token: v })}
          placeholder="EAAD..."
          type="password"
        />
        <Field
          label="Phone Number ID"
          testId="field-meta-phone-id"
          value={metaForm?.phone_number_id || ""}
          onChange={(v) => setMetaForm({ ...metaForm, phone_number_id: v })}
          placeholder="123456789012345"
        />
        <Field
          label="WhatsApp Business Account ID (WABA)"
          testId="field-meta-waba"
          value={metaForm?.waba_id || ""}
          onChange={(v) => setMetaForm({ ...metaForm, waba_id: v })}
          placeholder="123456789012345"
        />
        <Field
          label="Verify Token (Webhook)"
          testId="field-meta-verify-token"
          value={metaForm?.verify_token || ""}
          onChange={(v) => setMetaForm({ ...metaForm, verify_token: v })}
          placeholder="cobranzas_xd_webhook_2024"
        />
      </Section>

      {/* Scripts registry */}
      <Section title="Scripts .py registrados" icon={FileCode2}>
        <div className="flex gap-2 mb-3">
          <input
            data-testid="new-script-input"
            value={newScript}
            onChange={(e) => setNewScript(e.target.value)}
            placeholder="nombre_script.py"
            className="flex-1 bg-[#0B0B0F] border border-white/5 rounded-md px-3 py-2 text-sm outline-none focus:border-[#E1FF00]/40 font-mono"
          />
          <button
            data-testid="add-script-btn"
            onClick={addScript}
            className="bg-white/5 hover:bg-white/10 border border-white/10 text-sm px-3 py-2 rounded-md flex items-center gap-1.5"
          >
            <Plus size={13} /> Agregar
          </button>
        </div>
        <div className="space-y-1">
          {scripts.length === 0 && <div className="text-xs text-zinc-500 font-mono">— Sin scripts —</div>}
          {scripts.map((s) => (
            <div key={s.id} className="flex items-center justify-between bg-[#0B0B0F] rounded-md px-3 py-2 border border-white/5" data-testid={`script-${s.id}`}>
              <div className="flex items-center gap-2 font-mono text-xs text-zinc-300">
                <FileCode2 size={12} className="text-[#E1FF00]" />
                {s.name}
              </div>
              <button onClick={() => delScript(s.id)} className="text-red-400 hover:text-red-300">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* Save */}
      <div className="sticky bottom-4 flex justify-end">
        <button
          data-testid="save-config-btn"
          onClick={save}
          disabled={saving}
          className="glow-primary bg-[#E1FF00] text-black font-semibold px-5 py-2.5 rounded-md hover:bg-[#EEFF66] active:scale-95 transition-transform flex items-center gap-2"
        >
          <Save size={14} strokeWidth={2.5} />
          {saving ? "Guardando..." : `Guardar configuración de ${cty.label}`}
        </button>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children, accent }) {
  return (
    <div className="bg-[#101013] border border-white/5 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5 flex items-center gap-2">
        {Icon && <Icon size={14} style={{ color: accent || "#E1FF00" }} />}
        <span className="font-display font-semibold text-sm">{title}</span>
      </div>
      <div className="p-5 space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", icon: Icon, testId }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1 block">{label}</label>
      <div className="relative">
        {Icon && <Icon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />}
        <input
          data-testid={testId}
          type={type}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full bg-[#0B0B0F] border border-white/5 rounded-md py-2 text-sm outline-none focus:border-[#E1FF00]/40 font-mono ${Icon ? "pl-8 pr-3" : "px-3"}`}
        />
      </div>
    </div>
  );
}
