import { useState, useEffect } from "react";
import { toast } from "sonner";
import { X, Save, Trash2, Bell, StickyNote, Phone, Mail, MessageCircle, Building2, User, Plus, Check } from "lucide-react";
import { ESTADOS, findEstado, MEDIOS_CONTACTO, findCountry } from "@/lib/countries";
import { endpoints } from "@/lib/api";
import { fmtLocal, fmtUsd } from "@/lib/money";

export default function ClientDetail({ contact: initial, onClose, onChanged }) {
  const [contact, setContact] = useState(initial);
  const [savingRecovery, setSavingRecovery] = useState(false);
  const [recoveryValue, setRecoveryValue] = useState(String(initial.monto_recuperado || 0));
  const [newNote, setNewNote] = useState("");
  const [newReminderText, setNewReminderText] = useState("");
  const [newReminderDate, setNewReminderDate] = useState("");
  const cty = findCountry(contact.country);
  const estado = findEstado(contact.estado || "pendiente");
  const restante = Math.max(0, (contact.monto || 0) - (contact.monto_recuperado || 0));
  const pct = contact.monto ? Math.min(100, ((contact.monto_recuperado || 0) / contact.monto) * 100) : 0;

  useEffect(() => { setContact(initial); setRecoveryValue(String(initial.monto_recuperado || 0)); }, [initial.id]);

  const persist = (c) => { setContact(c); onChanged?.(c); };

  const changeEstado = async (est) => {
    if (est === "all") return;
    const c = await endpoints.updateContact(contact.id, { estado: est });
    persist(c);
    toast.success(`Estado → ${findEstado(est).label}`);
  };

  const changeMedio = async (medio) => {
    const c = await endpoints.updateContact(contact.id, { medio_contacto: medio });
    persist(c);
    toast.success(`Medio de contacto → ${medio}`);
  };

  const saveRecovery = async () => {
    const v = parseFloat(recoveryValue) || 0;
    setSavingRecovery(true);
    try {
      const c = await endpoints.setRecovered(contact.id, v);
      persist(c);
      toast.success(`Recuperado: $${v.toLocaleString()}`);
    } finally { setSavingRecovery(false); }
  };

  const addNote = async () => {
    if (!newNote.trim()) return;
    const c = await endpoints.addNote(contact.id, newNote.trim());
    persist(c);
    setNewNote("");
    toast.success("Nota agregada");
  };

  const delNote = async (nid) => {
    const c = await endpoints.deleteNote(contact.id, nid);
    persist(c);
  };

  const addReminder = async () => {
    if (!newReminderText.trim()) return;
    const c = await endpoints.addReminder(contact.id, newReminderText.trim(), newReminderDate || null);
    persist(c);
    setNewReminderText("");
    setNewReminderDate("");
    toast.success("Recordatorio agregado");
  };

  const toggleReminder = async (rid) => {
    const c = await endpoints.toggleReminder(contact.id, rid);
    persist(c);
  };

  const delReminder = async (rid) => {
    const c = await endpoints.deleteReminder(contact.id, rid);
    persist(c);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end" onClick={onClose} data-testid="client-detail">
      <div
        className="w-full max-w-2xl h-full bg-[#101013] border-l border-white/10 shadow-2xl overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#101013]/95 backdrop-blur px-6 py-4 border-b border-white/10 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full grid place-items-center text-lg font-display font-bold shrink-0" style={{ background: cty.bg, color: cty.color }}>
              {contact.nombre.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="font-display font-bold text-xl">{contact.nombre}</div>
              <div className="text-xs text-zinc-400 font-mono">{contact.telefono} · {cty.flag} {cty.label}</div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded font-semibold" style={{ background: estado.bg, color: estado.color }}>
                  {estado.icon} {estado.label}
                </span>
                {contact.dias_mora ? (
                  <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded font-mono bg-white/5">
                    {contact.dias_mora}d mora
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1" data-testid="close-detail">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Recovery panel */}
          <Section title="Recuperación de cartera">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Kpi
                label="Adeudado"
                local={fmtLocal(contact.monto || 0, contact.country)}
                usd={fmtUsd(contact.monto || 0, contact.country)}
                color="#F87171"
                testId="kpi-debt"
              />
              <Kpi
                label="Recuperado"
                local={fmtLocal(contact.monto_recuperado || 0, contact.country)}
                usd={fmtUsd(contact.monto_recuperado || 0, contact.country)}
                color="#34D399"
                testId="kpi-recovered"
              />
              <Kpi
                label="Restante"
                local={fmtLocal(restante, contact.country)}
                usd={fmtUsd(restante, contact.country)}
                color="#FDE047"
                testId="kpi-remaining"
              />
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full transition-all duration-500 bg-gradient-to-r from-emerald-400 to-[#E1FF00]" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-[11px] text-zinc-500 font-mono mt-1.5">{pct.toFixed(1)}% recuperado</div>
            <div className="flex gap-2 mt-3">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm pointer-events-none">
                  {cty.code === "MX" ? "MX$" : cty.code === "CO" ? "COL$" : cty.code === "PE" ? "S/" : "CLP$"}
                </span>
                <input
                  data-testid="recovery-input"
                  type="number"
                  min="0"
                  value={recoveryValue}
                  onChange={(e) => setRecoveryValue(e.target.value)}
                  className="w-full bg-[#0B0B0F] border border-white/5 rounded-md pl-14 pr-3 py-2 text-sm font-mono outline-none focus:border-[#E1FF00]/40"
                  placeholder="Monto recuperado"
                />
              </div>
              <button
                data-testid="save-recovery"
                onClick={saveRecovery}
                disabled={savingRecovery}
                className="bg-[#E1FF00] text-black font-semibold text-sm px-3 py-2 rounded-md hover:bg-[#EEFF66] active:scale-95 transition-transform flex items-center gap-1.5"
              >
                <Save size={12} strokeWidth={2.5} /> Guardar
              </button>
            </div>
          </Section>

          {/* Estado */}
          <Section title="Estado de gestión">
            <div className="grid grid-cols-2 gap-2">
              {ESTADOS.filter((e) => e.key !== "all").map((e) => {
                const active = contact.estado === e.key;
                return (
                  <button
                    key={e.key}
                    data-testid={`estado-${e.key}`}
                    onClick={() => changeEstado(e.key)}
                    className="text-left px-3 py-2.5 rounded-md border transition-colors flex items-center gap-2"
                    style={{
                      background: active ? e.bg : "transparent",
                      borderColor: active ? e.color : "rgba(255,255,255,0.06)",
                      color: active ? e.color : "#D4D4D8",
                    }}
                  >
                    <span className="text-lg">{e.icon}</span>
                    <span className="text-sm font-medium">{e.label}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Medio de contacto */}
          <Section title="Medio de contacto">
            <div className="flex flex-wrap gap-2">
              {MEDIOS_CONTACTO.map((m) => {
                const active = contact.medio_contacto === m.key;
                return (
                  <button
                    key={m.key}
                    data-testid={`medio-${m.key}`}
                    onClick={() => changeMedio(m.key)}
                    className={`px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 transition-colors border ${
                      active ? "bg-[#E1FF00]/10 border-[#E1FF00]/40 text-[#E1FF00]" : "bg-[#0B0B0F] border-white/5 text-zinc-300 hover:border-white/15"
                    }`}
                  >
                    <span>{m.icon}</span> {m.label}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Notes */}
          <Section title={<span className="flex items-center gap-2"><StickyNote size={13} /> Notas ({(contact.notas || []).length})</span>}>
            <div className="flex gap-2 mb-3">
              <input
                data-testid="note-input"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addNote()}
                placeholder="Escribe una nota…"
                className="flex-1 bg-[#0B0B0F] border border-white/5 rounded-md px-3 py-2 text-sm outline-none focus:border-[#E1FF00]/40"
              />
              <button
                data-testid="add-note-btn"
                onClick={addNote}
                className="bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-md text-sm flex items-center gap-1"
              >
                <Plus size={12} /> Agregar
              </button>
            </div>
            <div className="space-y-2">
              {(contact.notas || []).length === 0 && (
                <div className="text-xs text-zinc-500 font-mono">— Sin notas —</div>
              )}
              {(contact.notas || []).slice().reverse().map((n) => (
                <div key={n.id} data-testid={`note-${n.id}`} className="bg-[#0B0B0F] border border-white/5 rounded-md p-3">
                  <div className="text-sm text-zinc-200">{n.text}</div>
                  <div className="flex justify-between items-center mt-1.5">
                    <div className="text-[10px] text-zinc-500 font-mono">
                      {new Date(n.ts).toLocaleString()} · {n.author}
                    </div>
                    <button onClick={() => delNote(n.id)} className="text-red-400 hover:text-red-300">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Reminders */}
          <Section title={<span className="flex items-center gap-2"><Bell size={13} /> Recordatorios ({(contact.recordatorios || []).length})</span>}>
            <div className="flex gap-2 mb-3">
              <input
                data-testid="reminder-input"
                value={newReminderText}
                onChange={(e) => setNewReminderText(e.target.value)}
                placeholder="Recordatorio…"
                className="flex-1 bg-[#0B0B0F] border border-white/5 rounded-md px-3 py-2 text-sm outline-none focus:border-[#E1FF00]/40"
              />
              <input
                data-testid="reminder-date"
                type="datetime-local"
                value={newReminderDate}
                onChange={(e) => setNewReminderDate(e.target.value)}
                className="bg-[#0B0B0F] border border-white/5 rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-[#E1FF00]/40"
              />
              <button
                data-testid="add-reminder-btn"
                onClick={addReminder}
                className="bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-md text-sm flex items-center gap-1"
              >
                <Plus size={12} /> Agregar
              </button>
            </div>
            <div className="space-y-2">
              {(contact.recordatorios || []).length === 0 && (
                <div className="text-xs text-zinc-500 font-mono">— Sin recordatorios —</div>
              )}
              {(contact.recordatorios || []).slice().reverse().map((r) => (
                <div
                  key={r.id}
                  data-testid={`reminder-${r.id}`}
                  className={`border rounded-md p-3 flex items-center gap-3 ${
                    r.done ? "bg-emerald-500/5 border-emerald-500/20" : "bg-[#0B0B0F] border-white/5"
                  }`}
                >
                  <button
                    onClick={() => toggleReminder(r.id)}
                    className={`w-5 h-5 rounded border-2 grid place-items-center shrink-0 ${
                      r.done ? "bg-emerald-500 border-emerald-500" : "border-white/20"
                    }`}
                  >
                    {r.done && <Check size={12} className="text-black" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${r.done ? "line-through text-zinc-500" : "text-zinc-200"}`}>{r.text}</div>
                    {r.due_at && (
                      <div className="text-[10px] text-amber-300 font-mono mt-0.5">
                        ⏰ {new Date(r.due_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <button onClick={() => delReminder(r.id)} className="text-red-400 hover:text-red-300">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </Section>

          {/* Info del CSV */}
          <Section title="Datos del registro">
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <InfoLine label="Solicitante" value={contact.solicitante || contact.app_cliente || "—"} />
              <InfoLine label="Hora" value={contact.hora || "—"} />
              <InfoLine label="Empresa" value={contact.empresa || "—"} />
              <InfoLine label="Vencimiento" value={contact.vencimiento || "—"} />
              <InfoLine label="SMS ✅" value={contact.sms_enviado ? "Sí" : "No"} accent={contact.sms_enviado ? "#34D399" : undefined} />
              <InfoLine label="Formulario" value={contact.formulario_guardado ? "Guardado" : "—"} accent={contact.formulario_guardado ? "#34D399" : undefined} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Kpi({ label, local, usd, color, testId }) {
  return (
    <div className="bg-[#0B0B0F] border border-white/5 rounded-md p-3 text-center" data-testid={testId}>
      <div className="text-[9px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="font-display font-bold text-base mt-1 truncate" style={{ color }}>{local}</div>
      <div className="text-[10px] text-zinc-500 font-mono mt-0.5">≈ {usd}</div>
    </div>
  );
}

function InfoLine({ label, value, accent }) {
  return (
    <div className="flex justify-between bg-[#0B0B0F] border border-white/5 rounded px-2.5 py-1.5">
      <span className="text-zinc-500 uppercase tracking-wider">{label}</span>
      <span className="text-zinc-200 truncate max-w-[60%]" style={{ color: accent }}>{value}</span>
    </div>
  );
}
