import { Users, Send, AlertCircle, TrendingUp } from "lucide-react";

const Card = ({ label, value, sub, icon: Icon, accent = "#E1FF00", testId }) => (
  <div
    data-testid={testId}
    className="relative bg-[#101013] border border-white/5 rounded-xl p-5 overflow-hidden hover:border-white/10 transition-colors"
  >
    <div className="flex items-start justify-between">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">{label}</div>
        <div className="font-display font-bold text-4xl tracking-tight text-white leading-none">{value ?? "—"}</div>
        {sub && <div className="text-xs text-zinc-500 mt-2 font-mono">{sub}</div>}
      </div>
      <div
        className="w-9 h-9 rounded-md grid place-items-center"
        style={{ background: `${accent}22`, color: accent }}
      >
        <Icon size={16} strokeWidth={2} />
      </div>
    </div>
    <div
      className="absolute -bottom-6 -right-6 w-24 h-24 rounded-full opacity-20 blur-3xl"
      style={{ background: accent }}
    />
  </div>
);

export default function StatsCards({ summary }) {
  const s = summary || {};
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="stats-cards">
      <Card
        label="Total Contactos"
        value={s.total_contacts ?? 0}
        sub="registrados"
        icon={Users}
        accent="#E1FF00"
        testId="stat-total"
      />
      <Card
        label="Pendientes"
        value={s.pending ?? 0}
        sub="en cola"
        icon={AlertCircle}
        accent="#FDE047"
        testId="stat-pending"
      />
      <Card
        label="Enviados"
        value={s.sent ?? 0}
        sub={`${s.total_whatsapp ?? 0} WA · ${s.total_sms ?? 0} SMS`}
        icon={Send}
        accent="#34D399"
        testId="stat-sent"
      />
      <Card
        label="Tasa Éxito"
        value={`${s.success_rate ?? 0}%`}
        sub={`${s.errors ?? 0} errores`}
        icon={TrendingUp}
        accent="#60A5FA"
        testId="stat-success"
      />
    </div>
  );
}
