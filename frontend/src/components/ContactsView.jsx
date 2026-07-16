import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { CheckSquare, Square, Upload, Trash2, Send, Eye, Filter, RefreshCw, Plus, Sparkles } from "lucide-react";
import { COUNTRIES, findCountry, TEMPLATE_KINDS } from "@/lib/countries";
import { endpoints } from "@/lib/api";

const STATUS_META = {
  pending: { label: "Pendiente", color: "#FDE047", bg: "rgba(250,204,21,0.12)" },
  sent: { label: "Enviado", color: "#34D399", bg: "rgba(16,185,129,0.12)" },
  error: { label: "Error", color: "#F87171", bg: "rgba(239,68,68,0.12)" },
};

export default function ContactsView({ country, onChange, embedded = false }) {
  const [contacts, setContacts] = useState([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCountry, setFilterCountry] = useState(country);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [templateKind, setTemplateKind] = useState("default");
  const fileRef = useRef(null);

  useEffect(() => { setFilterCountry(country); }, [country]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await endpoints.listContacts({
        country: filterCountry === "ALL" ? undefined : filterCountry,
        status: filterStatus === "all" ? undefined : filterStatus,
      });
      setContacts(data);
    } finally {
      setLoading(false);
    }
  }, [filterCountry, filterStatus]);

  useEffect(() => { load(); }, [load]);

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

  const filtered = contacts;
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
          {["all", "pending", "sent", "error"].map((s) => (
            <button
              key={s}
              data-testid={`filter-status-${s}`}
              onClick={() => setFilterStatus(s)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                filterStatus === s ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              {s === "all" ? "Todos" : STATUS_META[s].label + "s"}
            </button>
          ))}
        </div>

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

        <div className="flex-1" />

        <select
          data-testid="template-kind-select"
          value={templateKind}
          onChange={(e) => setTemplateKind(e.target.value)}
          className="bg-[#0B0B0F] border border-white/5 text-xs rounded-md px-2 py-1.5 text-zinc-300 outline-none focus:border-white/20"
        >
          {TEMPLATE_KINDS.map((t) => (
            <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
          ))}
        </select>

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
          data-testid="seed-demo-btn"
          onClick={handleSeed}
          className="text-xs px-3 py-1.5 rounded-md bg-[#0B0B0F] border border-white/5 hover:border-white/15 text-zinc-300 flex items-center gap-1.5"
        >
          <Sparkles size={13} className="text-[#E1FF00]" />
          Cargar demo
        </button>

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
                <th className="py-2.5 px-3">Monto</th>
                <th className="py-2.5 px-3">Empresa</th>
                <th className="py-2.5 px-3">País</th>
                <th className="py-2.5 px-3">Estado</th>
                <th className="py-2.5 px-3">Vence</th>
                <th className="py-2.5 px-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-zinc-500 font-sans">
                    {loading ? (
                      <span className="ascii-loader" />
                    ) : (
                      <>
                        <div className="text-4xl mb-2">📭</div>
                        Sin contactos. Importa un CSV o carga la demo.
                      </>
                    )}
                  </td>
                </tr>
              )}
              {filtered.map((c, i) => {
                const cty = findCountry(c.country);
                const st = STATUS_META[c.status] || STATUS_META.pending;
                const isSel = selected.has(c.id);
                return (
                  <tr
                    key={c.id}
                    className={`row-hover border-b border-white/[0.03] ${i % 2 === 0 ? "bg-transparent" : "bg-white/[0.015]"} ${isSel ? "bg-[#E1FF00]/[0.04]" : ""}`}
                    data-testid={`contact-row-${c.id}`}
                  >
                    <td className="py-1.5 px-3">
                      <button onClick={() => toggleOne(c.id)} className="grid place-items-center">
                        {isSel ? <CheckSquare size={14} className="text-[#E1FF00]" /> : <Square size={14} className="text-zinc-500" />}
                      </button>
                    </td>
                    <td className="py-1.5 px-3 text-white font-medium font-sans">{c.nombre}</td>
                    <td className="py-1.5 px-3 text-zinc-400">{c.telefono}</td>
                    <td className="py-1.5 px-3 text-white">${Number(c.monto).toLocaleString()}</td>
                    <td className="py-1.5 px-3 text-zinc-400 font-sans">{c.empresa || "—"}</td>
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
                        style={{ background: st.bg, color: st.color }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />
                        {st.label}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-zinc-400 font-mono text-xs">{c.vencimiento || "—"}</td>
                    <td className="py-1.5 px-3">
                      <button
                        onClick={() => setPreview(c)}
                        data-testid={`preview-${c.id}`}
                        className="text-zinc-500 hover:text-white"
                        title="Vista previa"
                      >
                        <Eye size={13} />
                      </button>
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
          <span className="text-zinc-600">Ordenados por fecha ↓</span>
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

      {/* Preview modal */}
      {preview && (
        <Modal onClose={() => setPreview(null)} title="Vista previa del contacto">
          <PreviewCard contact={preview} />
        </Modal>
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
        ["Empresa", contact.empresa || "—"],
        ["Monto", `$${Number(contact.monto).toLocaleString()}`],
        ["País", `${cty.flag} ${cty.label}`],
        ["Vencimiento", contact.vencimiento || "—"],
        ["Fecha", contact.fecha || "—"],
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
