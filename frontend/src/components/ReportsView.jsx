import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip, CartesianGrid, Legend } from "recharts";
import { COUNTRIES, findCountry } from "@/lib/countries";
import { Download, TrendingUp, Wallet, Send, Users, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { endpoints } from "@/lib/api";
import { fmtLocal, fmtUsd, useRates, currencyOf } from "@/lib/money";

const PERIODS = [
  { key: "day", label: "Diario", days: 30 },
  { key: "week", label: "Semanal", days: 84 },
  { key: "month", label: "Mensual", days: 365 },
];

export default function ReportsView() {
  const { rates, updated } = useRates();
  const [globalSummary, setGlobalSummary] = useState(null);
  const [period, setPeriod] = useState("day");
  const [ts, setTs] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [gs, series] = await Promise.all([
        endpoints.reportsSummary(), // no country → global
        endpoints.reportsTimeseries({ period, days: PERIODS.find((p) => p.key === period).days }),
      ]);
      setGlobalSummary(gs);
      setTs(series);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [period]); // eslint-disable-line

  const toUsdWith = (amount, country) => {
    const cur = currencyOf(country);
    return Number(amount || 0) / (rates[cur] || 1);
  };

  const perC = globalSummary?.per_country || [];
  const totalDebtUsd = perC.reduce((acc, p) => acc + toUsdWith(p.debt || 0, p.country), 0);
  const totalRecoveredUsd = perC.reduce((acc, p) => acc + toUsdWith(p.recovered || 0, p.country), 0);
  const globalRate = totalDebtUsd ? Math.round((totalRecoveredUsd / totalDebtUsd) * 1000) / 10 : 0;

  // Timeseries chart data
  const chartData = useMemo(() => {
    if (!ts?.series) return [];
    return ts.series.map((b) => {
      const row = { bucket: b.bucket, sent: b.sent, errors: b.errors };
      // per-country USD recovered
      let totalUsd = 0;
      COUNTRIES.forEach((c) => {
        const amt = (b.recovered_by_country || {})[c.code] || 0;
        const usd = toUsdWith(amt, c.code);
        row[c.code] = Math.round(usd);
        totalUsd += usd;
      });
      row.recovered_usd = Math.round(totalUsd);
      return row;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ts, rates]);

  const projectionUsd = useMemo(() => {
    if (!ts?.series || !ts.series.length) return 0;
    const recent = ts.series.slice(-7);
    let sumUsd = 0;
    recent.forEach((b) => {
      COUNTRIES.forEach((c) => {
        const amt = (b.recovered_by_country || {})[c.code] || 0;
        sumUsd += toUsdWith(amt, c.code);
      });
    });
    const avg = recent.length ? sumUsd / recent.length : 0;
    // scale: for weekly period each bucket is a week (multiply by ~4.3 weeks) — we normalize as "per 30 days"
    if (period === "week") return avg * 4.3;
    if (period === "month") return avg;
    return avg * 30; // day → 30 days
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ts, rates, period]);

  const exportCsv = () => {
    const header = "pais,total,pendientes,enviados,errores,tasa_exito,deuda_local,recuperado_local,tasa_recuperacion,sms_ok\n";
    const rows = perC.map((d) =>
      `${d.country},${d.total},${d.pending},${d.sent},${d.errors},${d.success_rate},${d.debt},${d.recovered},${d.recovery_rate},${d.sms_ok}`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `reporte_cobranzas_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Reporte exportado");
  };

  return (
    <div className="space-y-6" data-testid="reports-view">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-1">Analítica global</div>
          <h1 className="font-display font-bold text-3xl tracking-tight">Reportes · Vista consolidada</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Rendimiento simultáneo de los 4 países, con series temporales y proyección a 30 días. FX: {updated ? new Date(updated).toLocaleDateString() : "…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period tabs */}
          <div className="flex items-center gap-1 bg-[#101013] border border-white/5 rounded-md p-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                data-testid={`period-${p.key}`}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 rounded text-xs transition-colors flex items-center gap-1.5 ${
                  period === p.key ? "bg-[#E1FF00] text-black font-semibold" : "text-zinc-400 hover:text-white"
                }`}
              >
                <CalendarDays size={12} />
                {p.label}
              </button>
            ))}
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
      </div>

      {/* Global KPIs in USD */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi
          icon={Wallet}
          label="Deuda total (USD)"
          value={`US$ ${Math.round(totalDebtUsd).toLocaleString()}`}
          color="#F87171"
          sub="4 países consolidados"
        />
        <Kpi
          icon={TrendingUp}
          label="Recuperado (USD)"
          value={`US$ ${Math.round(totalRecoveredUsd).toLocaleString()}`}
          color="#34D399"
          sub={`${globalRate}% de la cartera`}
        />
        <Kpi
          icon={Send}
          label="Mensajes enviados"
          value={((globalSummary?.total_whatsapp || 0) + (globalSummary?.total_sms || 0)).toLocaleString()}
          color="#60A5FA"
          sub={`${globalSummary?.success_rate || 0}% éxito`}
        />
        <Kpi
          icon={Users}
          label="Clientes activos"
          value={globalSummary?.total_contacts || 0}
          color="#E1FF00"
          sub={`${globalSummary?.pending || 0} pendientes`}
        />
      </div>

      {/* Projection */}
      <div className="bg-[#101013] border border-white/5 rounded-xl p-5 relative overflow-hidden" data-testid="projection-card">
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full blur-3xl opacity-20 bg-[#E1FF00]" />
        <div className="relative">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">Proyección a 30 días</div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="font-display font-bold text-4xl tracking-tight" style={{ color: "#E1FF00" }}>
                US$ {Math.round(projectionUsd).toLocaleString()}
              </div>
              <div className="text-xs text-zinc-400 mt-1">
                Estimado basado en el rendimiento de los últimos 7 buckets ({period === "day" ? "días" : period === "week" ? "semanas" : "meses"})
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500">Promedio {period === "day" ? "diario" : period === "week" ? "semanal" : "mensual"}</div>
              <div className="font-display font-bold text-xl text-zinc-200">
                US$ {Math.round(projectionUsd / (period === "day" ? 30 : period === "week" ? 4.3 : 1)).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recovery timeseries chart */}
      <div className="bg-[#101013] border border-white/5 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Recuperación por país (USD) · {period === "day" ? "últimos 30 días" : period === "week" ? "últimas 12 semanas" : "últimos 12 meses"}</div>
          {loading && <span className="ascii-loader text-zinc-500 text-xs" />}
        </div>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="bucket" stroke="#71717A" fontSize={11} tickLine={false} />
              <YAxis stroke="#71717A" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: "#18181B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#FAFAFA" }}
                formatter={(v, name) => [`US$ ${Number(v).toLocaleString()}`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {COUNTRIES.map((c) => (
                <Line
                  key={c.code}
                  type="monotone"
                  dataKey={c.code}
                  name={`${c.flag} ${c.label}`}
                  stroke={c.color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: c.color }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bar chart — sent per country */}
      <div className="bg-[#101013] border border-white/5 rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-4">Mensajes enviados por país (buckets)</div>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="bucket" stroke="#71717A" fontSize={11} tickLine={false} />
              <YAxis stroke="#71717A" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                contentStyle={{ background: "#18181B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="sent" name="Enviados" fill="#34D399" radius={[6, 6, 0, 0]} />
              <Bar dataKey="errors" name="Errores" fill="#F87171" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per country panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {perC.map((d) => (
          <div key={d.country} data-testid={`report-country-${d.country}`} className="bg-[#101013] border border-white/5 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{findCountry(d.country).flag}</span>
                <div>
                  <div className="font-display font-semibold text-lg" style={{ color: findCountry(d.country).color }}>{findCountry(d.country).label}</div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-widest">Rendimiento</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-display font-bold text-2xl text-white">{d.recovery_rate}%</div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-widest">recuperación</div>
              </div>
            </div>
            <div className="text-xs text-zinc-400 space-y-1 mb-3 font-mono">
              <div className="flex justify-between">
                <span>Deuda</span>
                <span className="text-zinc-200">{fmtLocal(d.debt, d.country)} <span className="text-zinc-600">≈ {fmtUsd(d.debt, d.country)}</span></span>
              </div>
              <div className="flex justify-between">
                <span>Recuperado</span>
                <span className="text-emerald-400">{fmtLocal(d.recovered, d.country)} <span className="text-zinc-600">≈ {fmtUsd(d.recovered, d.country)}</span></span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                ["Total", d.total, "#FAFAFA"],
                ["Pend.", d.pending, "#FDE047"],
                ["Env.", d.sent, "#34D399"],
                ["Err.", d.errors, "#F87171"],
              ].map(([l, v, c]) => (
                <div key={l} className="bg-[#0B0B0F] rounded-md py-2 border border-white/5">
                  <div className="font-display font-bold text-lg" style={{ color: c }}>{v}</div>
                  <div className="text-[9px] uppercase tracking-widest text-zinc-500">{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${d.recovery_rate}%`, background: findCountry(d.country).color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, color, sub }) {
  return (
    <div className="bg-[#101013] border border-white/5 rounded-xl p-5 relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">{label}</div>
          <div className="font-display font-bold text-3xl tracking-tight truncate" style={{ color }}>{value}</div>
          {sub && <div className="text-xs text-zinc-500 mt-1 font-mono">{sub}</div>}
        </div>
        <div className="w-9 h-9 rounded-md grid place-items-center shrink-0" style={{ background: `${color}22`, color }}>
          <Icon size={16} />
        </div>
      </div>
      <div className="absolute -bottom-6 -right-6 w-24 h-24 rounded-full opacity-20 blur-3xl" style={{ background: color }} />
    </div>
  );
}
