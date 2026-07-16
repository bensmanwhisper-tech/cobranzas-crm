import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { CheckSquare, Square, Upload, Trash2, Send, Eye, Filter, RefreshCw, Plus, Sparkles, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { COUNTRIES, findCountry, TEMPLATE_KINDS, ESTADOS, findEstado, levelForMora, findTemplateKind } from "@/lib/countries";
import { endpoints } from "@/lib/api";
import { fmtLocal, fmtUsd } from "@/lib/money";
import ClientDetail from "@/components/ClientDetail";

const STATUS_META = {
  pending: { label: "Pendiente", color: "#FDE047", bg: "rgba(250,204,21,0.12)" },
  sent: { label: "Enviado", color: "#34D399", bg: "rgba(16,185,129,0.12)" },
  error: { label: "Error", color: "#F87171", bg: "rgba(239,68,68,0.12)" },
};

export default function ContactsView({ country, onChange, embedded = false }) {
  const [contacts, setContacts] = useState([]);
  const [filterEstado, setFilterEstado] = useState("all");
  const [filterCountry, setFilterCountry] = useState(country);
  const [filterNivel, setFilterNivel] = useState("all"); // all | nivel_1..4
  const [sortMora, setSortMora] = useState("desc"); // desc | asc | null
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [templateKind, setTemplateKind] = useState("nivel_1");
  const fileRef = useRef(null);

  useEffect(() => { setFilterCountry(country); }, [country]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await endpoints.listContacts({
        country: filterCountry === "ALL" ? undefined : filterCountry,
        estado: filterEstado === "all" ? undefined : filterEstado,
      });
      setContacts(data);
    } finally {
      setLoading(false);
    }
  }, [filterCountry, filterEstado]);

  useEffect(() => { load(); }, [load]);

  // Filter by nivel + sort by mora
  const filtered = useMemo(() => {
    let arr = contacts;
    if (filterNivel !== "all") {
      arr = arr.filter((c) => levelForMora(c.dias_mora) === filterNivel);
    }
    if (sortMora) {
      arr = [...arr].sort((a, b) => {
        const av = a.dias_mora || 0;
        const bv = b.dias_mora || 0;
        return sortMora === "asc" ? av - bv : bv - av;
      });
    }
    return arr;
  }, [contacts, filterNivel, sortMora]);

  const cycleSort = () => {
    setSortMora((s) => (s === "desc" ? "asc" : s === "asc" ? null : "desc"));
  };

  const toggleAll = () => {
    if (selected.size === contacts.length) setSelected(new Set());
    else setSelected(new Set(contacts.map((c) => c.id)));
  };

  const toggleOne = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const r = await endpoints.importCsv(filterCountry === "ALL" ? country : filterCountry, file);
      toast.success(`CSV importado: ${r.inserted} contactos`, { description: r.errors ? `${r.errors} filas con errores` : undefined });
      await load();
      onChange?.();
    } catch (err) {
      toast.error("Error al importar CSV");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleSeed = async () => {
    const r = await endpoints.seedDemo(filterCountry === "ALL" ? undefined : filterCountry);
    toast.success(`${r.inserted} contactos de demo agregados`);
    await load();
    onChange?.();
  };

  const handleSend = async () => {
    if (!selected.size) { toast.warning("Selecciona contactos primero"); return; }
    const target = filterCountry === "ALL" ? country : filterCountry;
    try {
      const r = await endpoints.send({
        country: target,
        contact_ids: [...selected],
        template_kind: templateKind,
        channel: "whatsapp",
      });
      toast.success(`Envío completo: ${r.sent} enviados, ${r.errors} errores`);
      setSelected(new Set());
      await load();
      onChange?.();
    } catch {
      toast.error("Error al ejecutar envío");
    }
  };

  const handleBulkDelete = async () => {
    if (!selected.size) return;
    await endpoints.bulkDeleteContacts([...selected]);
    setSelected(new Set());
    toast.success("Contactos eliminados");
    await load();
    onChange?.();
  };

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  return (
    <div className="space-y-4" data-testid="contacts-view">
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-1">Base de datos</div>
            <h1 className="font-display font-bold text-3xl tracking-tight">Contactos</h1>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-[#101013] border border-white/5 rounded-lg">
        <div className="flex items-center gap-1 bg-[#0B0B0F] rounded-md p-1 border border-white/5">
          <button
            data-testid="filter-country-ALL"
            onClick={() => setFilterCountry("ALL")}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              filterCountry === "ALL" ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            Todos
          </button>
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              data-testid={`filter-country-${c.code}`}
              onClick={() => setFilterCountry(c.code)}
              className={`px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
                filterCountry === c.code ? "bg-white/10" : "hover:text-white"
              }`}
              style={{ color: filterCountry === c.code ? c.color : undefined }}
            >
              <span>{c.flag}</span>
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-[#0B0B0F] rounded-md p-1 border border-white/5" data-testid="nivel-filter">
          <button
            data-testid="nivel-all"
            onClick={() => setFilterNivel("all")}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              filterNivel === "all" ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"
            }`}
            title="Todos los niveles"
          >
            Nivel: Todos
          </button>
          {TEMPLATE_KINDS.map((n) => (
            <button
              key={n.key}
              data-testid={`nivel-${n.key}`}
              onClick={() => setFilterNivel(n.key)}
              className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
                filterNivel === n.key ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"
              }`}
              title={n.description}
            >
              <span>{n.icon}</span>
              <span>N{n.key.split("_")[1]}</span>
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button
          data-testid="refresh-btn"
          onClick={load}
          className="p-1.5 rounded-md bg-[#0B0B0F] border border-white/5 hover:border-white/15 text-zinc-400"
          title="Actualizar"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>

        <button
          data-testid="import-csv-btn"
          onClick={() => fileRef.current?.click()}
          className="text-xs px-3 py-1.5 rounded-md bg-[#0B0B0F] border border-white/5 hover:border-white/15 text-zinc-300 flex items-center gap-1.5"
        >
          <Upload size={13} />
          Importar CSV
        </button>
        <input
          type="file"
          accept=".csv"
          ref={fileRef}
          onChange={handleImport}
          className="hidden"
          data-testid="csv-file-input"
        />

        <button
          data-testid="add-contact-btn"
          onClick={() => setAddOpen(true)}
          className="text-xs px-3 py-1.5 rounded-md bg-[#E1FF00] text-black font-semibold hover:bg-[#EEFF66] active:scale-95 transition-transform flex items-center gap-1.5"
        >
          <Plus size={13} strokeWidth={2.5} />
          Nuevo
        </button>
      </div>

      {/* Table */}
      <div className="bg-[#101013] border border-white/5 rounded-lg overflow-hidden">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#101013]/95 backdrop-blur border-b border-white/5">
              <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500">
                <th className="py-2.5 px-3 w-10">
                  <button data-testid="select-all-btn" onClick={toggleAll} className="grid place-items-center">
                    {allSelected ? <CheckSquare size={14} className="text-[#E1FF00]" /> : <Square size={14} />}
                  </button>
                </th>
                <th className="py-2.5 px-3">Nombre</th>
                <th className="py-2.5 px-3">Teléfono</th>
                <th className="py-2.5 px-3">
                  <button
                    data-testid="sort-mora"
                    onClick={cycleSort}
                    className="flex items-center gap-1 hover:text-white transition-colors"
                    title="Ordenar por días de mora"
                  >
                    Mora
                    {sortMora === "desc" ? (
                      <ArrowDown size={11} className="text-[#E1FF00]" />
                    ) : sortMora === "asc" ? (
                      <ArrowUp size={11} className="text-[#E1FF00]" />
                    ) : (
                      <ArrowUpDown size={11} className="opacity-40" />
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-3">Nivel</th>
                <th className="py-2.5 px-3">Solicitante</th>
                <th className="py-2.5 px-3">Monto</th>
                <th className="py-2.5 px-3">Recup.</th>
                <th className="py-2.5 px-3">SMS</th>
                <th className="py-2.5 px-3">País</th>
                <th className="py-2.5 px-3">Estado</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-zinc-500 font-sans">
                    {loading ? (
                      <span className="ascii-loader" />
                    ) : (
                      <>
                        <div className="text-4xl mb-2">📭</div>
                        Sin contactos. Ve a <span className="text-emerald-400 font-semibold">WhatsApp Center</span> para cargar un CSV, o usa "Cargar demo".
                      </>
                    )}
                  </td>
                </tr>
              )}
              {filtered.map((c, i) => {
                const cty = findCountry(c.country);
                const est = findEstado(c.estado || "pendiente");
                const nivel = findTemplateKind(levelForMora(c.dias_mora));
                const isSel = selected.has(c.id);
                const mora = c.dias_mora || 0;
                const moraColor = mora > 60 ? "#F87171" : mora > 30 ? "#FDE047" : "#34D399";
                const recPct = c.monto ? Math.min(100, ((c.monto_recuperado || 0) / c.monto) * 100) : 0;
                return (
                  <tr
                    key={c.id}
                    onClick={() => setDetail(c)}
                    className={`row-hover cursor-pointer border-b border-white/[0.03] ${i % 2 === 0 ? "bg-transparent" : "bg-white/[0.015]"} ${isSel ? "bg-[#E1FF00]/[0.04]" : ""}`}
                    data-testid={`contact-row-${c.id}`}
                  >
                    <td className="py-1.5 px-3" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => toggleOne(c.id)} className="grid place-items-center">
                        {isSel ? <CheckSquare size={14} className="text-[#E1FF00]" /> : <Square size={14} className="text-zinc-500" />}
                      </button>
                    </td>
                    <td className="py-1.5 px-3 text-white font-medium font-sans">{c.nombre}</td>
                    <td className="py-1.5 px-3 text-zinc-400">{c.telefono}</td>
                    <td className="py-1.5 px-3">
                      <span
                        className="px-2 py-0.5 rounded font-sans font-bold text-xs"
                        style={{ background: `${moraColor}22`, color: moraColor }}
                      >
                        {mora}d
                      </span>
                    </td>
                    <td className="py-1.5 px-3" title={nivel.description}>
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-sans text-[10px] font-semibold border"
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          borderColor: "rgba(255,255,255,0.08)",
                        }}
                      >
                        <span className="text-sm leading-none">{nivel.icon}</span>
                        <span className="text-zinc-300 uppercase tracking-wider">N{nivel.key.split("_")[1]}</span>
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-zinc-300 font-sans max-w-[180px] truncate" title={c.solicitante || c.app_cliente}>
                      {c.solicitante || c.app_cliente ? (
                        <span className="px-1.5 py-0.5 rounded bg-white/5 text-xs font-mono truncate inline-block max-w-full">{c.solicitante || c.app_cliente}</span>
                      ) : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="py-1.5 px-3 text-white">
                      <div className="leading-tight">
                        <div>{fmtLocal(c.monto, c.country)}</div>
                        <div className="text-[10px] text-zinc-500 font-mono">≈ {fmtUsd(c.monto, c.country)}</div>
                      </div>
                    </td>
                    <td className="py-1.5 px-3">
                      {(c.monto_recuperado || 0) > 0 ? (
                        <div className="min-w-[110px]">
                          <div className="text-emerald-400 text-xs font-bold leading-tight">
                            {fmtLocal(c.monto_recuperado, c.country)}
                          </div>
                          <div className="text-[10px] text-zinc-500 font-mono">≈ {fmtUsd(c.monto_recuperado, c.country)}</div>
                          <div className="h-1 bg-white/5 rounded-full mt-0.5 overflow-hidden">
                            <div className="h-full bg-emerald-400" style={{ width: `${recPct}%` }} />
                          </div>
                        </div>
                      ) : <span className="text-zinc-600 text-xs">—</span>}
                    </td>
                    <td className="py-1.5 px-3 text-center">
                      {c.sms_enviado ? (
                        <span className="text-emerald-400 font-bold" title="SMS enviado">✓</span>
                      ) : <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="py-1.5 px-3">
                      <span
                        className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-sans font-semibold"
                        style={{ background: cty.bg, color: cty.color }}
                      >
                        {cty.flag} {c.country}
                      </span>
                    </td>
                    <td className="py-1.5 px-3">
                      <span
                        className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-sans font-semibold inline-flex items-center gap-1"
                        style={{ background: est.bg, color: est.color }}
                        title={est.label}
                      >
                        {est.icon} {est.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-white/5 text-xs text-zinc-500 flex justify-between font-mono">
          <span>
            {filtered.length} contactos · {selected.size} seleccionados
          </span>
          <span className="text-zinc-600">
            {sortMora ? (sortMora === "desc" ? "Ordenado: más morosos primero ↓" : "Ordenado: menos morosos primero ↑") : "Sin orden por mora"}
          </span>
        </div>
      </div>

      {/* Floating action bar */}
      {selected.size > 0 && (
        <div
          data-testid="floating-action-bar"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl px-2 py-2 flex items-center gap-1"
        >
          <div className="px-3 text-xs text-zinc-400 font-mono">{selected.size} seleccionado(s)</div>
          <button
            data-testid="send-bulk-btn"
            onClick={handleSend}
            className="bg-[#E1FF00] text-black px-4 py-1.5 rounded-full text-xs font-semibold hover:bg-[#EEFF66] active:scale-95 transition-transform flex items-center gap-1.5"
          >
            <Send size={12} strokeWidth={2.5} />
            Enviar
          </button>
          <button
            data-testid="bulk-delete-btn"
            onClick={handleBulkDelete}
            className="text-red-400 hover:text-red-300 px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 hover:bg-red-500/10"
          >
            <Trash2 size={12} />
            Eliminar
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-zinc-400 hover:text-white px-3 py-1.5 rounded-full text-xs"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Client detail drawer */}
      {detail && (
        <ClientDetail
          contact={detail}
          onClose={() => setDetail(null)}
          onChanged={async (c) => {
            setDetail(c);
            await load();
            onChange?.();
          }}
        />
      )}

      {/* Add contact modal */}
      {addOpen && (
        <AddContactModal
          country={filterCountry === "ALL" ? country : filterCountry}
          onClose={() => setAddOpen(false)}
          onCreated={async () => {
            setAddOpen(false);
            await load();
            onChange?.();
          }}
        />
      )}
    </div>
  );
}

function Modal({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div
        className="bg-[#101013] border border-white/10 rounded-xl max-w-lg w-full p-6"
        onClick={(e) => e.stopPropagation()}
        data-testid="modal"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-lg">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white" data-testid="modal-close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PreviewCard({ contact }) {
  const cty = findCountry(contact.country);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3 pb-3 border-b border-white/5">
        <div className="w-12 h-12 rounded-full grid place-items-center text-lg font-display font-bold" style={{ background: cty.bg, color: cty.color }}>
          {contact.nombre.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="font-semibold text-white">{contact.nombre}</div>
          <div className="text-xs text-zinc-500 font-mono">{contact.telefono}</div>
        </div>
      </div>
      {[
        ["Días de mora", `${contact.dias_mora || 0} días`],
        ["App cliente", contact.app_cliente || "—"],
        ["Empresa", contact.empresa || "—"],
        ["Monto", `$${Number(contact.monto).toLocaleString()}`],
        ["País", `${cty.flag} ${cty.label}`],
        ["Vencimiento", contact.vencimiento || "—"],
        ["Estado", contact.status],
      ].map(([k, v]) => (
        <div key={k} className="flex justify-between text-xs">
          <span className="text-zinc-500 uppercase tracking-wider">{k}</span>
          <span className="text-zinc-200 font-mono">{v}</span>
        </div>
      ))}
      {contact.last_error && (
        <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-300 font-mono">
          {contact.last_error}
        </div>
      )}
    </div>
  );
}

function AddContactModal({ country, onClose, onCreated }) {
  const [form, setForm] = useState({
    nombre: "",
    telefono: "",
    monto: "",
    empresa: "",
    vencimiento: "",
    dias_mora: "",
    app_cliente: "",
    country,
  });
  const submit = async (e) => {
    e.preventDefault();
    if (!form.nombre || !form.telefono) {
      toast.warning("Nombre y teléfono requeridos");
      return;
    }
    try {
      await endpoints.createContact({
        ...form,
        monto: parseFloat(form.monto || "0") || 0,
        dias_mora: parseInt(form.dias_mora || "0", 10) || 0,
      });
      toast.success("Contacto creado");
      onCreated();
    } catch {
      toast.error("Error al crear");
    }
  };
  return (
    <Modal onClose={onClose} title="Nuevo contacto">
      <form onSubmit={submit} className="space-y-3" data-testid="add-contact-form">
        {[
          ["nombre", "Nombre completo", true],
          ["telefono", "Teléfono (con lada)", true],
          ["dias_mora", "Días de mora", false],
          ["app_cliente", "App / Producto (Kueski, Nequi, Yape, Mach...)", false],
          ["monto", "Monto adeudado", false],
          ["empresa", "Empresa", false],
          ["vencimiento", "Fecha de vencimiento (YYYY-MM-DD)", false],
        ].map(([k, label, req]) => (
          <div key={k}>
            <label className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</label>
            <input
              data-testid={`field-${k}`}
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              required={req}
              className="mt-1 w-full bg-[#0B0B0F] border border-white/5 rounded-md px-3 py-2 text-sm outline-none focus:border-[#E1FF00]/40"
            />
          </div>
        ))}
        <div>
          <label className="text-[10px] uppercase tracking-widest text-zinc-500">País</label>
          <select
            data-testid="field-country"
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
            className="mt-1 w-full bg-[#0B0B0F] border border-white/5 rounded-md px-3 py-2 text-sm"
          >
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.label}</option>)}
          </select>
        </div>
        <button
          type="submit"
          data-testid="submit-contact-btn"
          className="w-full bg-[#E1FF00] text-black font-semibold py-2 rounded-md hover:bg-[#EEFF66] active:scale-95 transition-transform"
        >
          Crear contacto
        </button>
      </form>
    </Modal>
  );
}
