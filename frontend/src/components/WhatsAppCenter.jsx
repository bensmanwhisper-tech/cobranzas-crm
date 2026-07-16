import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MessageCircle, QrCode, Wifi, WifiOff, Upload, ArrowRight, ArrowLeft,
  Check, Send, Users, FileSpreadsheet, Copy, Sparkles, LogOut, RefreshCw, ChevronDown,
} from "lucide-react";
import { COUNTRIES, findCountry, TEMPLATE_KINDS, TEMPLATE_VARIABLES } from "@/lib/countries";
import { endpoints } from "@/lib/api";
import { fmtLocal, fmtUsd } from "@/lib/money";

const STEPS = [
  { key: 1, label: "Conectar", icon: Wifi },
  { key: 2, label: "Cargar CSV", icon: Upload },
  { key: 3, label: "Revisar", icon: Users },
  { key: 4, label: "Enviar", icon: Send },
];

export default function WhatsAppCenter({ defaultCountry = "MX", onChange }) {
  const [step, setStep] = useState(1);
  const [country, setCountry] = useState(defaultCountry);
  const [status, setStatus] = useState({ connected: false, phone: "", webhook_url: "", has_key: false });
  const [imported, setImported] = useState([]); // contacts loaded in the flow
  const [selected, setSelected] = useState(new Set());
  const [templates, setTemplates] = useState([]);
  const [templateKind, setTemplateKind] = useState("default");
  const [customBody, setCustomBody] = useState("");
  const [customEnabled, setCustomEnabled] = useState(false);

  const cty = findCountry(country);

  useEffect(() => {
    endpoints.whatsappStatus(country).then(setStatus).catch(() => {});
    endpoints.getTemplates(country).then((tpls) => {
      setTemplates(tpls);
      const t = tpls.find((x) => x.kind === templateKind);
      if (t) setCustomBody(t.body);
    });
  }, [country]); // eslint-disable-line

  const activeTemplateBody = useMemo(() => {
    if (customEnabled) return customBody;
    const t = templates.find((x) => x.kind === templateKind);
    return t ? t.body : "";
  }, [templates, templateKind, customEnabled, customBody]);

  const goNext = () => {
    if (step === 1 && !status.connected) { toast.warning("Conecta WhatsApp primero"); return; }
    if (step === 2 && imported.length === 0) { toast.warning("Carga un CSV para continuar"); return; }
    if (step === 3 && selected.size === 0) { toast.warning("Selecciona al menos un contacto"); return; }
    setStep((s) => Math.min(4, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  return (
    <div className="space-y-6" data-testid="whatsapp-center">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-1">Módulo dedicado</div>
          <h1 className="font-display font-bold text-3xl tracking-tight flex items-center gap-3">
            <MessageCircle size={26} className="text-emerald-400" />
            WhatsApp Center
          </h1>
          <p className="text-zinc-400 text-sm mt-1">Conecta tu WhatsApp, carga contactos por país y envía mensajes con plantillas.</p>
        </div>
        <div className="flex items-center gap-2 bg-[#101013] border border-white/5 rounded-lg p-1">
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              data-testid={`wa-country-${c.code}`}
              onClick={() => { setCountry(c.code); setStep(1); setImported([]); setSelected(new Set()); }}
              className="px-2.5 py-1 rounded-md text-xs transition-colors flex items-center gap-1"
              style={{
                background: country === c.code ? c.bg : "transparent",
                color: country === c.code ? c.color : "#A1A1AA",
                border: country === c.code ? `1px solid ${c.border}` : "1px solid transparent",
              }}
            >
              <span>{c.flag}</span>
              <span className="font-mono">{c.dial}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 bg-[#101013] border border-white/5 rounded-xl p-3">
        {STEPS.map((s, i) => {
          const active = step === s.key;
          const done = step > s.key;
          const Icon = s.icon;
          return (
            <div key={s.key} className="flex items-center gap-2 flex-1">
              <button
                data-testid={`step-${s.key}`}
                onClick={() => setStep(s.key)}
                className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-lg transition-colors border ${
                  active
                    ? "bg-[#E1FF00]/10 border-[#E1FF00]/30 text-[#E1FF00]"
                    : done
                    ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
                    : "bg-transparent border-white/5 text-zinc-500"
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full grid place-items-center text-xs font-bold ${
                    active ? "bg-[#E1FF00] text-black" : done ? "bg-emerald-500 text-black" : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {done ? <Check size={14} strokeWidth={3} /> : s.key}
                </div>
                <div className="text-left">
                  <div className="text-[10px] uppercase tracking-widest opacity-70">Paso {s.key}</div>
                  <div className="text-sm font-medium">{s.label}</div>
                </div>
              </button>
              {i < STEPS.length - 1 && <ArrowRight size={14} className="text-zinc-700 shrink-0" />}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="min-h-[400px]">
        {step === 1 && (
          <StepConnect
            country={country}
            status={status}
            onChange={async () => {
              const s = await endpoints.whatsappStatus(country);
              setStatus(s);
              onChange?.();
            }}
          />
        )}
        {step === 2 && (
          <StepUpload
            country={country}
            onLoaded={(contacts) => {
              setImported(contacts);
              setSelected(new Set(contacts.map((c) => c.id)));
              onChange?.();
            }}
          />
        )}
        {step === 3 && (
          <StepReview
            country={country}
            contacts={imported}
            selected={selected}
            setSelected={setSelected}
            onReload={async () => {
              const list = await endpoints.listContacts({ country, status: "pending" });
              setImported(list);
              setSelected(new Set(list.map((c) => c.id)));
            }}
          />
        )}
        {step === 4 && (
          <StepSend
            country={country}
            selected={selected}
            contacts={imported}
            templates={templates}
            templateKind={templateKind}
            setTemplateKind={setTemplateKind}
            customBody={customBody}
            setCustomBody={setCustomBody}
            customEnabled={customEnabled}
            setCustomEnabled={setCustomEnabled}
            activeTemplateBody={activeTemplateBody}
            onSent={() => { setImported([]); setSelected(new Set()); setStep(1); onChange?.(); }}
          />
        )}
      </div>

      {/* Nav buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-white/5">
        <button
          data-testid="wizard-back"
          onClick={goBack}
          disabled={step === 1}
          className="text-sm px-4 py-2 rounded-md bg-[#101013] border border-white/10 text-zinc-300 disabled:opacity-40 flex items-center gap-2 hover:bg-white/5"
        >
          <ArrowLeft size={14} /> Atrás
        </button>
        <div className="text-xs text-zinc-500 font-mono">
          Paso {step} de {STEPS.length}
        </div>
        {step < 4 && (
          <button
            data-testid="wizard-next"
            onClick={goNext}
            className="glow-primary text-sm px-4 py-2 rounded-md bg-[#E1FF00] text-black font-semibold flex items-center gap-2 hover:bg-[#EEFF66] active:scale-95 transition-transform"
          >
            Siguiente <ArrowRight size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Step 1: Connect ----------
function StepConnect({ country, status, onChange }) {
  const [mode, setMode] = useState("qr"); // qr | manual
  const [qrData, setQrData] = useState(null);
  const [webhookUrl, setWebhookUrl] = useState(status.webhook_url || "");
  const [apiKey, setApiKey] = useState("");
  const [phone, setPhone] = useState(status.phone || "");
  const [testing, setTesting] = useState(false);
  const cty = findCountry(country);

  useEffect(() => { setWebhookUrl(status.webhook_url || ""); setPhone(status.phone || ""); }, [status]);

  useEffect(() => {
    if (mode === "qr") {
      endpoints.whatsappQr(country).then((r) => setQrData(r.qr_data_url)).catch(() => {});
    }
  }, [mode, country, webhookUrl]);

  const connect = async () => {
    if (!webhookUrl.trim()) { toast.warning("Pega el webhook URL de tu WhatsApp"); return; }
    setTesting(true);
    try {
      await endpoints.whatsappConnect(country, {
        webhook_url: webhookUrl,
        api_key: apiKey,
        phone_number: phone,
      });
      toast.success(`✓ WhatsApp conectado para ${cty.label}`);
      onChange?.();
    } catch {
      toast.error("Error al conectar");
    } finally { setTesting(false); }
  };

  const disconnect = async () => {
    await endpoints.whatsappDisconnect(country);
    toast.info("WhatsApp desconectado");
    onChange?.();
  };

  if (status.connected) {
    return (
      <div className="bg-[#101013] border border-emerald-500/20 rounded-xl p-6" data-testid="wa-connected-panel">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 grid place-items-center">
              <Wifi size={26} className="text-emerald-400" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-emerald-400">Conectado</div>
              <div className="font-display font-bold text-2xl mt-0.5">
                WhatsApp {cty.label} <span className="text-emerald-400">•</span>
              </div>
              <div className="text-zinc-400 text-sm mt-1 font-mono">
                {status.phone || "sin número"} · webhook activo
              </div>
            </div>
          </div>
          <button
            data-testid="wa-disconnect-btn"
            onClick={disconnect}
            className="text-xs px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-300 flex items-center gap-1.5 hover:bg-red-500/20"
          >
            <LogOut size={12} /> Desconectar
          </button>
        </div>
        <div className="mt-6 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/10 text-sm text-emerald-100/70">
          <div className="flex items-center gap-2 font-medium mb-1">
            <Check size={14} className="text-emerald-400" /> Todo listo
          </div>
          Ya puedes avanzar al paso 2 y cargar tu CSV de contactos.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="wa-connect-panel">
      <div className="flex items-center gap-1 bg-[#101013] border border-white/5 rounded-md p-1 w-fit">
        {[
          { k: "qr", l: "Escanear QR", i: QrCode },
          { k: "manual", l: "Manual (Webhook)", i: Wifi },
        ].map(({ k, l, i: I }) => (
          <button
            key={k}
            data-testid={`connect-mode-${k}`}
            onClick={() => setMode(k)}
            className={`px-4 py-2 rounded text-xs flex items-center gap-2 transition-colors ${
              mode === k ? "bg-white/5 text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            <I size={12} /> {l}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {mode === "qr" && (
          <div className="bg-[#101013] border border-white/5 rounded-xl p-6 flex flex-col items-center text-center">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">Escanea con tu servicio</div>
            {qrData ? (
              <img src={qrData} alt="QR" className="w-56 h-56 rounded-lg" data-testid="wa-qr-image" />
            ) : (
              <div className="w-56 h-56 rounded-lg bg-black grid place-items-center">
                <span className="ascii-loader text-zinc-500" />
              </div>
            )}
            <div className="mt-4 text-xs text-zinc-400 font-mono">
              Compatible con Evolution API · WPPConnect · Chatwoot · N8N
            </div>
          </div>
        )}

        <div className={`bg-[#101013] border border-white/5 rounded-xl p-6 space-y-4 ${mode === "qr" ? "" : "md:col-span-2"}`}>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500">Datos de conexión</div>
          <FieldRow label="Webhook URL (POST)" testId="wa-webhook-input">
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://tu-servicio.com/send"
              className="w-full bg-[#0B0B0F] border border-white/5 rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-[#E1FF00]/40"
            />
          </FieldRow>
          <FieldRow label="Token / API Key (opcional)" testId="wa-token-input">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk_..."
              className="w-full bg-[#0B0B0F] border border-white/5 rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-[#E1FF00]/40"
            />
          </FieldRow>
          <FieldRow label="Número WhatsApp (informativo)" testId="wa-phone-input">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={`${cty.dial} 55 1234 5678`}
              className="w-full bg-[#0B0B0F] border border-white/5 rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-[#E1FF00]/40"
            />
          </FieldRow>
          <button
            data-testid="wa-connect-btn"
            onClick={connect}
            disabled={testing}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-semibold py-2.5 rounded-md flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            {testing ? "Conectando..." : <>
              <Wifi size={14} strokeWidth={2.5} />
              Conectar WhatsApp {cty.flag}
            </>}
          </button>
          <div className="text-[11px] text-zinc-500 leading-relaxed">
            El CRM hará <code className="bg-white/5 px-1 rounded">POST</code> al webhook cada vez que envíes un mensaje.
            Funciona con cualquier proveedor WhatsApp (Evolution API, WPPConnect, Twilio, WhatsApp Cloud API, tu propio bridge).
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Step 2: Upload CSV ----------
function StepUpload({ country, onLoaded }) {
  const [dialOverride, setDialOverride] = useState(findCountry(country).dial);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const cty = findCountry(country);

  useEffect(() => { setDialOverride(cty.dial); }, [country]); // eslint-disable-line

  const handle = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await endpoints.whatsappImportCsv(country, dialOverride, file);
      toast.success(`✓ ${r.inserted} contactos cargados con ${r.dial_code}`, {
        description: r.errors ? `${r.errors} filas con errores` : undefined,
      });
      // fetch just-loaded pending contacts of this country
      const list = await endpoints.listContacts({ country, status: "pending", limit: 1000 });
      onLoaded(list);
    } catch (e) {
      toast.error("Error al cargar el CSV");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="wa-upload-step">
      {/* Country code selector */}
      <div className="bg-[#101013] border border-white/5 rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">1 · Código de país</div>
        <div className="space-y-2">
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              data-testid={`dial-${c.code}`}
              onClick={() => setDialOverride(c.dial)}
              className="w-full text-left px-3 py-2.5 rounded-md border transition-colors flex items-center gap-3"
              style={{
                background: dialOverride === c.dial ? c.bg : "transparent",
                borderColor: dialOverride === c.dial ? c.border : "rgba(255,255,255,0.05)",
                color: dialOverride === c.dial ? c.color : "#D4D4D8",
              }}
            >
              <span className="text-xl">{c.flag}</span>
              <div className="flex-1">
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-[10px] uppercase tracking-widest opacity-70">{c.code}</div>
              </div>
              <span className="font-mono font-bold text-lg">{c.dial}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 p-3 rounded-md bg-black/40 border border-white/5 text-[11px] font-mono text-zinc-400">
          Se antepondrá <span className="text-[#E1FF00]">{dialOverride}</span> a cada teléfono del CSV.
        </div>
      </div>

      {/* CSV selector */}
      <div className="md:col-span-2 bg-[#101013] border border-white/5 rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">2 · Selecciona el archivo CSV</div>

        <button
          data-testid="wa-select-csv"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-xl border-2 border-dashed border-white/10 hover:border-[#E1FF00]/40 bg-[#0B0B0F] p-8 text-center transition-colors"
        >
          <FileSpreadsheet size={32} className="mx-auto text-[#E1FF00] mb-3" />
          <div className="font-display font-semibold">
            {uploading ? "Cargando..." : "Elegir archivo CSV"}
          </div>
          <div className="text-xs text-zinc-500 mt-1 font-mono">Sólo teléfonos sin código de país</div>
        </button>
        <input
          type="file"
          accept=".csv"
          ref={inputRef}
          onChange={(e) => handle(e.target.files?.[0])}
          className="hidden"
          data-testid="wa-csv-input"
        />

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="bg-black/40 border border-white/5 rounded-md p-3">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Columnas esperadas</div>
            <ul className="space-y-1 font-mono text-zinc-300">
              <li><span className="text-[#E1FF00]">nombre</span></li>
              <li><span className="text-[#E1FF00]">telefono</span> <span className="text-zinc-500">(sin código)</span></li>
              <li><span className="text-[#E1FF00]">dias_mora</span></li>
              <li><span className="text-[#E1FF00]">app_cliente</span></li>
              <li className="text-zinc-500">monto, empresa, vencimiento <span className="text-zinc-600">(opcional)</span></li>
            </ul>
          </div>
          <div className="bg-black/40 border border-white/5 rounded-md p-3">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Ejemplo de fila</div>
            <div className="font-mono text-zinc-400 text-[11px] leading-relaxed">
              Juan Pérez,5512345678,45,Kueski
              <br />
              → se guarda como <span className="text-[#E1FF00]">{dialOverride}5512345678</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Step 3: Review ----------
function StepReview({ country, contacts, selected, setSelected, onReload }) {
  const [moraFilter, setMoraFilter] = useState("all"); // all | 0-30 | 31-60 | 60+
  const [search, setSearch] = useState("");

  // Auto-load pending contacts if we entered step 3 empty
  useEffect(() => {
    if (contacts.length === 0) {
      onReload?.();
    }
    // eslint-disable-next-line
  }, []);

  const filtered = contacts.filter((c) => {
    if (search && !`${c.nombre} ${c.telefono} ${c.app_cliente || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    const m = c.dias_mora || 0;
    if (moraFilter === "0-30" && !(m <= 30)) return false;
    if (moraFilter === "31-60" && !(m > 30 && m <= 60)) return false;
    if (moraFilter === "60+" && !(m > 60)) return false;
    return true;
  });

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (filtered.every((c) => selected.has(c.id))) {
      const next = new Set(selected);
      filtered.forEach((c) => next.delete(c.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filtered.forEach((c) => next.add(c.id));
      setSelected(next);
    }
  };

  const allSelected = filtered.length && filtered.every((c) => selected.has(c.id));

  return (
    <div className="space-y-4" data-testid="wa-review-step">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          data-testid="wa-search"
          placeholder="Buscar por nombre, teléfono o app..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-[#101013] border border-white/5 rounded-md px-3 py-2 text-sm w-72 outline-none focus:border-[#E1FF00]/40"
        />
        <div className="flex items-center gap-1 bg-[#101013] border border-white/5 rounded-md p-1">
          {[
            ["all", "Todos"],
            ["0-30", "0–30d mora"],
            ["31-60", "31–60d"],
            ["60+", "60+ días"],
          ].map(([k, l]) => (
            <button
              key={k}
              data-testid={`mora-${k}`}
              onClick={() => setMoraFilter(k)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                moraFilter === k ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >{l}</button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={onReload}
          className="text-xs px-3 py-2 rounded-md bg-[#101013] border border-white/5 text-zinc-300 flex items-center gap-1.5 hover:border-white/15"
        >
          <RefreshCw size={12} /> Recargar
        </button>
        <div className="text-xs text-zinc-500 font-mono px-2">
          <span className="text-[#E1FF00] font-bold">{selected.size}</span> / {filtered.length} seleccionados
        </div>
      </div>

      <div className="bg-[#101013] border border-white/5 rounded-xl overflow-hidden">
        <div className="max-h-[500px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#101013]/95 backdrop-blur border-b border-white/5">
              <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500">
                <th className="py-2.5 px-3 w-10">
                  <input
                    data-testid="wa-select-all"
                    type="checkbox"
                    checked={!!allSelected}
                    onChange={toggleAll}
                    className="accent-[#E1FF00]"
                  />
                </th>
                <th className="py-2.5 px-3">Nombre</th>
                <th className="py-2.5 px-3">Teléfono</th>
                <th className="py-2.5 px-3">Días de mora</th>
                <th className="py-2.5 px-3">App</th>
                <th className="py-2.5 px-3">Monto</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="py-16 text-center text-zinc-500 font-sans">
                  <div className="text-3xl mb-2">📋</div>
                  {contacts.length === 0
                    ? "No hay contactos cargados. Vuelve al Paso 2 para subir un CSV."
                    : "Sin contactos que coincidan con los filtros."}
                </td></tr>
              )}
              {filtered.map((c, i) => {
                const isSel = selected.has(c.id);
                const mora = c.dias_mora || 0;
                const moraColor = mora > 60 ? "#F87171" : mora > 30 ? "#FDE047" : "#34D399";
                return (
                  <tr
                    key={c.id}
                    data-testid={`wa-contact-${c.id}`}
                    className={`row-hover border-b border-white/[0.03] ${i % 2 === 0 ? "" : "bg-white/[0.015]"} ${isSel ? "bg-[#E1FF00]/[0.04]" : ""}`}
                  >
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(c.id)}
                        className="accent-[#E1FF00]"
                      />
                    </td>
                    <td className="py-2 px-3 text-white font-medium font-sans">{c.nombre}</td>
                    <td className="py-2 px-3 text-zinc-300">{c.telefono}</td>
                    <td className="py-2 px-3">
                      <span
                        className="px-2 py-0.5 rounded font-sans font-bold text-xs"
                        style={{ background: `${moraColor}22`, color: moraColor }}
                      >
                        {mora}d
                      </span>
                    </td>
                    <td className="py-2 px-3 text-zinc-300 font-sans">
                      {c.app_cliente ? (
                        <span className="px-2 py-0.5 rounded bg-white/5 text-xs">{c.app_cliente}</span>
                      ) : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="py-2 px-3 text-zinc-300">
                      <div className="leading-tight">
                        <div>{fmtLocal(c.monto, c.country)}</div>
                        <div className="text-[10px] text-zinc-500 font-mono">≈ {fmtUsd(c.monto, c.country)}</div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- Step 4: Send ----------
function StepSend({
  country, selected, contacts, templates, templateKind, setTemplateKind,
  customBody, setCustomBody, customEnabled, setCustomEnabled, activeTemplateBody, onSent,
}) {
  const [sending, setSending] = useState(false);
  const cty = findCountry(country);
  const selectedContacts = contacts.filter((c) => selected.has(c.id));
  const first = selectedContacts[0];

  const previewText = useMemo(() => {
    if (!activeTemplateBody) return "";
    if (!first) return activeTemplateBody;
    return activeTemplateBody
      .replaceAll("{nombre}", first.nombre || "")
      .replaceAll("{monto}", `${first.monto || 0}`)
      .replaceAll("{fecha}", first.fecha || "")
      .replaceAll("{empresa}", first.empresa || "")
      .replaceAll("{vencimiento}", first.vencimiento || "")
      .replaceAll("{telefono}", first.telefono || "")
      .replaceAll("{dias_mora}", `${first.dias_mora || 0}`)
      .replaceAll("{app_cliente}", first.app_cliente || "");
  }, [activeTemplateBody, first]);

  const insertVar = (v) => setCustomBody((b) => (b || "") + v);

  const doSend = async () => {
    if (!selected.size) { toast.warning("Selecciona contactos"); return; }
    setSending(true);
    try {
      const r = await endpoints.send({
        country,
        contact_ids: [...selected],
        template_kind: templateKind,
        channel: "whatsapp",
        template_override: customEnabled ? customBody : null,
      });
      toast.success(`✓ Enviado a ${r.sent} contactos`, {
        description: r.errors ? `${r.errors} errores` : "Sin errores",
      });
      onSent?.();
    } catch {
      toast.error("Error al enviar");
    } finally { setSending(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="wa-send-step">
      {/* Templates picker */}
      <div className="lg:col-span-2 bg-[#101013] border border-white/5 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500">Plantilla</div>
          <label className="text-xs text-zinc-400 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              data-testid="custom-toggle"
              checked={customEnabled}
              onChange={(e) => {
                setCustomEnabled(e.target.checked);
                if (e.target.checked) {
                  const t = templates.find((x) => x.kind === templateKind);
                  if (t && !customBody) setCustomBody(t.body);
                }
              }}
              className="accent-[#E1FF00]"
            />
            Editar mensaje personalizado
          </label>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {TEMPLATE_KINDS.map((k) => {
            const active = templateKind === k.key;
            const tpl = templates.find((t) => t.kind === k.key);
            return (
              <button
                key={k.key}
                data-testid={`send-tpl-${k.key}`}
                onClick={() => {
                  setTemplateKind(k.key);
                  if (customEnabled && tpl) setCustomBody(tpl.body);
                }}
                className={`text-left p-3 rounded-md border transition-colors ${
                  active ? "border-[#E1FF00]/40 bg-[#E1FF00]/5" : "border-white/5 bg-[#0B0B0F] hover:border-white/15"
                }`}
              >
                <div className="text-xl">{k.icon}</div>
                <div className="text-sm font-medium mt-1">{k.label}</div>
                <div className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">
                  {tpl?.body?.slice(0, 40) || "..."}
                </div>
              </button>
            );
          })}
        </div>

        {customEnabled && (
          <div className="space-y-2" data-testid="custom-editor">
            <textarea
              value={customBody}
              onChange={(e) => setCustomBody(e.target.value)}
              rows={6}
              className="w-full bg-[#0B0B0F] border border-white/5 rounded-md p-3 text-sm font-mono outline-none focus:border-[#E1FF00]/40"
              data-testid="custom-body"
            />
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v}
                  onClick={() => insertVar(v)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono px-2 py-0.5 rounded text-xs flex items-center gap-1"
                >
                  <Copy size={9} /> {v}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* WhatsApp preview */}
        <div className="rounded-xl p-4" style={{ background: "linear-gradient(135deg, #0e2822, #0a1a17)" }}>
          <div className="text-[10px] uppercase tracking-widest text-emerald-300/50 mb-2">
            Vista previa ({first ? first.nombre : "sin contacto"})
          </div>
          <div className="bg-emerald-900/40 border border-emerald-500/20 rounded-lg rounded-tl-none p-3 text-sm text-emerald-50 whitespace-pre-wrap font-sans">
            {previewText || <span className="text-emerald-200/40">Sin mensaje...</span>}
          </div>
        </div>
      </div>

      {/* Right rail: summary + send */}
      <div className="bg-[#101013] border border-white/5 rounded-xl p-5 space-y-5 h-fit">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500">Resumen</div>
          <div className="font-display font-bold text-4xl mt-1" style={{ color: cty.color }}>{selected.size}</div>
          <div className="text-xs text-zinc-400">destinatarios · {cty.flag} {cty.label}</div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["0–30d", selectedContacts.filter((c) => (c.dias_mora || 0) <= 30).length, "#34D399"],
            ["31–60", selectedContacts.filter((c) => (c.dias_mora || 0) > 30 && (c.dias_mora || 0) <= 60).length, "#FDE047"],
            ["60+", selectedContacts.filter((c) => (c.dias_mora || 0) > 60).length, "#F87171"],
          ].map(([l, v, c]) => (
            <div key={l} className="bg-[#0B0B0F] border border-white/5 rounded-md py-2">
              <div className="font-display font-bold text-lg" style={{ color: c }}>{v}</div>
              <div className="text-[9px] uppercase tracking-widest text-zinc-500">{l}</div>
            </div>
          ))}
        </div>

        <button
          data-testid="wa-send-btn"
          onClick={doSend}
          disabled={sending || !selected.size}
          className="w-full glow-primary bg-[#E1FF00] text-black font-semibold py-3 rounded-md hover:bg-[#EEFF66] active:scale-95 transition-transform flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {sending ? "Enviando..." : <>
            <Send size={16} strokeWidth={2.5} />
            Enviar a {selected.size} contactos
          </>}
        </button>
        <div className="text-[11px] text-zinc-500 font-mono leading-relaxed">
          Los mensajes se enviarán vía webhook configurado en el paso 1.
          Cada envío queda registrado en la consola de logs.
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, testId, children }) {
  return (
    <div data-testid={testId}>
      <label className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1 block">{label}</label>
      {children}
    </div>
  );
}
