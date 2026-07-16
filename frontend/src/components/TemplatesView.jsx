import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { Save, Copy } from "lucide-react";
import { TEMPLATE_KINDS, TEMPLATE_VARIABLES, findCountry } from "@/lib/countries";
import { endpoints } from "@/lib/api";

export default function TemplatesView({ country, onGoWhatsApp }) {
  const [templates, setTemplates] = useState([]);
  const [active, setActive] = useState("default");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const cty = findCountry(country);

  useEffect(() => {
    endpoints.getTemplates(country).then((tpls) => {
      setTemplates(tpls);
      const t = tpls.find((x) => x.kind === active) || tpls[0];
      if (t) { setActive(t.kind); setBody(t.body); }
    });
  }, [country]); // eslint-disable-line

  useEffect(() => {
    const t = templates.find((x) => x.kind === active);
    if (t) setBody(t.body);
  }, [active, templates]);

  const insertVariable = (v) => setBody((b) => b + v);

  const save = async () => {
    setSaving(true);
    try {
      const t = await endpoints.saveTemplate({ country, kind: active, body });
      setTemplates((prev) => {
        const idx = prev.findIndex((x) => x.kind === active);
        if (idx >= 0) { const copy = [...prev]; copy[idx] = t; return copy; }
        return [...prev, t];
      });
      toast.success(`✓ Plantilla ${active} guardada para ${cty.flag} ${cty.label}`, {
        description: "Ya está disponible en WhatsApp Center · Paso 4",
        action: onGoWhatsApp ? { label: "Ir ahora →", onClick: () => onGoWhatsApp() } : undefined,
        duration: 5000,
      });
    } finally { setSaving(false); }
  };

  const sample = useMemo(() => {
    return body
      .replace("{nombre}", "Carlos Ramírez")
      .replace("{monto}", "4,520.50")
      .replace("{fecha}", "2026-02-15")
      .replace("{empresa}", "Grupo Aguila")
      .replace("{vencimiento}", "2026-03-15")
      .replace("{telefono}", "+52 55 1234 5678");
  }, [body]);

  return (
    <div className="space-y-4" data-testid="templates-view">
      <div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-1">Editor</div>
        <h1 className="font-display font-bold text-3xl tracking-tight">Plantillas de mensaje · <span style={{ color: cty.color }}>{cty.flag} {cty.label}</span></h1>
        <p className="text-zinc-400 text-sm mt-1">Usa las variables para personalizar cada mensaje. Se aplican al enviar.</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-[#101013] border border-white/5 rounded-lg p-1 w-fit">
        {TEMPLATE_KINDS.map((k) => (
          <button
            key={k.key}
            data-testid={`template-tab-${k.key}`}
            onClick={() => setActive(k.key)}
            className={`px-4 py-2 rounded-md text-sm transition-colors ${
              active === k.key ? "bg-white/5 text-white border border-white/10" : "text-zinc-400 hover:text-white"
            }`}
          >
            <span className="mr-1">{k.icon}</span> {k.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-[#101013] border border-white/5 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">Contenido del mensaje</div>
            <button
              data-testid="save-template-btn"
              onClick={save}
              disabled={saving}
              className="bg-[#E1FF00] text-black font-semibold text-xs px-3 py-1.5 rounded-md hover:bg-[#EEFF66] active:scale-95 transition-transform flex items-center gap-1.5"
            >
              <Save size={12} strokeWidth={2.5} />
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
          <textarea
            data-testid="template-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="w-full bg-[#0B0B0F] border border-white/5 rounded-md p-3 text-sm font-mono outline-none focus:border-[#E1FF00]/40 resize-y"
          />
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Variables — click para insertar</div>
            <div className="flex flex-wrap gap-2">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v}
                  data-testid={`var-${v.replace(/[{}]/g, "")}`}
                  onClick={() => insertVariable(v)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono px-2 py-1 rounded text-xs cursor-pointer transition-colors flex items-center gap-1"
                >
                  <Copy size={10} />
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-[#101013] border border-white/5 rounded-lg p-5">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">Vista previa (WhatsApp)</div>
          <div className="rounded-xl p-4" style={{ background: "linear-gradient(135deg, #0e2822, #0a1a17)" }}>
            <div className="bg-emerald-900/40 border border-emerald-500/20 rounded-lg rounded-tl-none p-3 text-sm text-emerald-50 whitespace-pre-wrap font-sans">
              {sample || <span className="text-emerald-200/40">Escribe tu mensaje...</span>}
            </div>
            <div className="text-[10px] text-emerald-200/40 mt-2 font-mono text-right">10:42 ✓✓</div>
          </div>
          <div className="mt-3 text-[11px] text-zinc-500 font-mono">
            Se sustituyen automáticamente los valores del contacto al enviar.
          </div>
        </div>
      </div>
    </div>
  );
}
