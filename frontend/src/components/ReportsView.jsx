import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";
import { findCountry } from "@/lib/countries";
import { Download } from "lucide-react";
import { toast } from "sonner";

export default function ReportsView({ summary }) {
  const s = summary || { per_country: [] };
  const data = (s.per_country || []).map((r) => ({
    ...r,
    fill: findCountry(r.country).color,
    label: `${findCountry(r.country).flag} ${r.country}`,
  }));

  const exportCsv = () => {
    const header = "pais,total,pendientes,enviados,errores,tasa_exito\n";
    const rows = data.map((d) => `${d.country},${d.total},${d.pending},${d.sent},${d.errors},${d.success_rate}`).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `reporte_cobranzas_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Reporte exportado");
  };

  return (
    <div className="space-y-6" data-testid="reports-view">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-1">Analítica</div>
          <h1 className="font-display font-bold text-3xl tracking-tight">Reportes y estadísticas</h1>
        </div>
        <button
          data-testid="export-report-btn"
          onClick={exportCsv}
          className="text-xs px-3 py-2 rounded-md bg-[#0B0B0F] border border-white/5 hover:border-white/15 text-zinc-300 flex items-center gap-1.5"
        >
          <Download size={13} />
          Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { l: "Total SMS", v: s.total_sms ?? 0, c: "#60A5FA" },
          { l: "Total WhatsApp", v: s.total_whatsapp ?? 0, c: "#34D399" },
          { l: "Tasa Éxito", v: `${s.success_rate ?? 0}%`, c: "#E1FF00" },
          { l: "Clientes", v: s.total_contacts ?? 0, c: "#F87171" },
        ].map((x) => (
          <div key={x.l} className="bg-[#101013] border border-white/5 rounded-xl p-5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">{x.l}</div>
            <div className="font-display font-bold text-3xl" style={{ color: x.c }}>{x.v}</div>
          </div>
        ))}
      </div>

      <div className="bg-[#101013] border border-white/5 rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-4">Rendimiento por país · Enviados</div>
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <BarChart data={data} barSize={40}>
              <XAxis dataKey="label" stroke="#71717A" fontSize={12} tickLine={false} />
              <YAxis stroke="#71717A" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                contentStyle={{ background: "#18181B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#FAFAFA" }}
              />
              <Bar dataKey="sent" radius={[6, 6, 0, 0]}>
                {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.map((d) => (
          <div key={d.country} className="bg-[#101013] border border-white/5 rounded-xl p-5" data-testid={`report-country-${d.country}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{findCountry(d.country).flag}</span>
                <div>
                  <div className="font-display font-semibold text-lg" style={{ color: d.fill }}>{findCountry(d.country).label}</div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-widest">Rendimiento</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-display font-bold text-2xl text-white">{d.success_rate}%</div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-widest">éxito</div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                ["Total", d.total, "#FAFAFA"],
                ["Pend.", d.pending, "#FDE047"],
                ["Enviados", d.sent, "#34D399"],
                ["Errores", d.errors, "#F87171"],
              ].map(([l, v, c]) => (
                <div key={l} className="bg-[#0B0B0F] rounded-md py-2 border border-white/5">
                  <div className="font-display font-bold text-lg" style={{ color: c }}>{v}</div>
                  <div className="text-[9px] uppercase tracking-widest text-zinc-500">{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${d.success_rate}%`, background: d.fill }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
