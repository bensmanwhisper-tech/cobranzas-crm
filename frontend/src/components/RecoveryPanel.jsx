import { COUNTRIES, findCountry } from "@/lib/countries";
import { TrendingUp, DollarSign, MessageSquareText, Wallet } from "lucide-react";
import { fmtLocal, fmtUsd, useRates, currencyOf } from "@/lib/money";

export default function RecoveryPanel({ summary }) {
  const { rates, updated } = useRates();
  const s = summary || { per_country: [] };
  const isFiltered = !!s.country_filter;
  const activeCountry = isFiltered ? findCountry(s.country_filter) : null;

  const toUsdWith = (amount, country) => {
    const cur = currencyOf(country);
    return Number(amount || 0) / (rates[cur] || 1);
  };

  const perC = s.per_country || [];
  // If filtered → use only that country's numbers. Otherwise → global.
  const totalDebtUsd = perC.reduce((acc, p) => acc + toUsdWith(p.debt || 0, p.country), 0);
  const totalRecoveredUsd = perC.reduce((acc, p) => acc + toUsdWith(p.recovered || 0, p.country), 0);
  const rate = totalDebtUsd ? Math.round((totalRecoveredUsd / totalDebtUsd) * 1000) / 10 : 0;
  const pct = totalDebtUsd ? Math.min(100, (totalRecoveredUsd / totalDebtUsd) * 100) : 0;

  const totalDebtLocal = perC.reduce((acc, p) => acc + (p.debt || 0), 0);
  const totalRecoveredLocal = perC.reduce((acc, p) => acc + (p.recovered || 0), 0);

  return (
    <div className="space-y-4" data-testid="recovery-panel">
      <div className="bg-[#101013] border border-white/5 rounded-xl p-5 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl opacity-20"
             style={{ background: activeCountry?.color || "#34D399" }} />
        <div className="flex items-start justify-between mb-4 relative">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1 flex items-center gap-2">
              <span>Rendimiento de cartera</span>
              {activeCountry && (
                <span className="normal-case tracking-normal font-semibold" style={{ color: activeCountry.color }}>
                  · {activeCountry.flag} {activeCountry.label}
                </span>
              )}
              <span className="text-zinc-600 normal-case tracking-normal font-mono text-[9px]">
                (fx {updated ? new Date(updated).toLocaleDateString() : "…"})
              </span>
            </div>
            {activeCountry ? (
              <div className="space-y-1">
                <div className="font-display font-bold text-4xl tracking-tight">
                  <span style={{ color: "#34D399" }}>{fmtLocal(totalRecoveredLocal, activeCountry.code)}</span>
                  <span className="text-zinc-500 text-2xl font-normal ml-2">/ {fmtLocal(totalDebtLocal, activeCountry.code)}</span>
                </div>
                <div className="text-sm text-zinc-500 font-mono">
                  ≈ US$ {Math.round(totalRecoveredUsd).toLocaleString()} / US$ {Math.round(totalDebtUsd).toLocaleString()}
                </div>
              </div>
            ) : (
              <div className="font-display font-bold text-4xl tracking-tight">
                <span style={{ color: "#34D399" }}>US$ {Math.round(totalRecoveredUsd).toLocaleString()}</span>
                <span className="text-zinc-500 text-2xl font-normal ml-2">/ US$ {Math.round(totalDebtUsd).toLocaleString()}</span>
              </div>
            )}
            <div className="text-xs text-zinc-400 mt-1 font-mono">
              Recuperado · {rate}% de tasa de recuperación
            </div>
          </div>
          <div className="text-right">
            <div className="font-display font-bold text-5xl" style={{ color: activeCountry?.color || "#E1FF00" }}>{rate}%</div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">tasa recuperación</div>
          </div>
        </div>

        <div className="h-3 bg-white/5 rounded-full overflow-hidden relative">
          <div
            className="h-full transition-all duration-1000"
            style={{
              width: `${pct}%`,
              background: activeCountry
                ? `linear-gradient(90deg, ${activeCountry.color}88, ${activeCountry.color})`
                : "linear-gradient(90deg, #34D399, #E1FF00)",
            }}
          />
        </div>

        {!activeCountry && (
          <div className="grid grid-cols-4 gap-3 mt-4">
            {COUNTRIES.map((c) => {
              const pc = perC.find((x) => x.country === c.code) || {};
              const rr = pc.recovery_rate || 0;
              const rp = (pc.debt || 0) > 0 ? Math.min(100, ((pc.recovered || 0) / pc.debt) * 100) : 0;
              return (
                <div key={c.code} data-testid={`recovery-country-${c.code}`} className="bg-[#0B0B0F] border border-white/5 rounded-lg p-3 hover:border-white/15 transition-colors">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{c.flag}</span>
                    <span className="text-sm font-semibold" style={{ color: c.color }}>{c.label}</span>
                  </div>
                  <div className="font-display font-bold text-lg" style={{ color: rr >= 50 ? "#34D399" : rr >= 20 ? "#FDE047" : "#F87171" }}>
                    {rr}%
                  </div>
                  <div className="text-[11px] text-zinc-400 font-mono mt-0.5 truncate">
                    {fmtLocal(pc.recovered || 0, c.code)} / {fmtLocal(pc.debt || 0, c.code)}
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">
                    ≈ {fmtUsd(pc.recovered || 0, c.code)} / {fmtUsd(pc.debt || 0, c.code)}
                  </div>
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden mt-2">
                    <div className="h-full transition-all duration-700" style={{ width: `${rp}%`, background: c.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Estado + SMS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#101013] border border-white/5 rounded-xl p-5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-3">
            Cartera por estado {activeCountry ? `· ${activeCountry.flag} ${activeCountry.label}` : ""}
          </div>
          <div className="space-y-2">
            {[
              ["pagado", "Pagado", "#34D399"],
              ["parcial", "Parcial", "#60A5FA"],
              ["pendiente", "Pendiente", "#FDE047"],
              ["sin_contacto", "Sin contacto", "#F87171"],
            ].map(([k, l, c]) => {
              const v = (s.estado_counts || {})[k] || 0;
              const total = Object.values(s.estado_counts || {}).reduce((a, b) => a + b, 0) || 1;
              const p = (v / total) * 100;
              return (
                <div key={k} data-testid={`estado-bar-${k}`}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-zinc-300">{l}</span>
                    <span className="font-mono" style={{ color: c }}>{v}</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full transition-all duration-700" style={{ width: `${p}%`, background: c }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-[#101013] border border-white/5 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              SMS ✅ {activeCountry ? `· ${activeCountry.flag} ${activeCountry.label}` : "por país"}
            </div>
            <div className="font-display font-bold text-2xl text-[#60A5FA]">{s.sms_from_csv || 0}</div>
          </div>
          {activeCountry ? (
            <div className="bg-[#0B0B0F] border border-white/5 rounded-md p-4 text-center">
              <span className="text-4xl">{activeCountry.flag}</span>
              <div className="font-display font-bold text-4xl mt-1" style={{ color: activeCountry.color }}>
                {s.sms_from_csv || 0}
              </div>
              <div className="text-xs text-zinc-500 mt-1">SMS enviados registrados</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {COUNTRIES.map((c) => {
                const pc = perC.find((x) => x.country === c.code) || {};
                return (
                  <div key={c.code} data-testid={`sms-${c.code}`} className="bg-[#0B0B0F] border border-white/5 rounded-md p-3 flex items-center gap-3">
                    <span className="text-xl">{c.flag}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-zinc-400">{c.label}</div>
                      <div className="font-display font-bold text-xl" style={{ color: c.color }}>{pc.sms_ok || 0}</div>
                    </div>
                    <MessageSquareText size={14} className="text-zinc-600" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
