export const COUNTRIES = [
  { code: "MX", label: "México", flag: "🇲🇽", dial: "+52", color: "#34D399", bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.35)", glow: "glow-mx" },
  { code: "CO", label: "Colombia", flag: "🇨🇴", dial: "+57", color: "#FDE047", bg: "rgba(250,204,21,0.15)", border: "rgba(250,204,21,0.35)", glow: "glow-co" },
  { code: "PE", label: "Perú", flag: "🇵🇪", dial: "+51", color: "#F87171", bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.35)", glow: "glow-pe" },
  { code: "CL", label: "Chile", flag: "🇨🇱", dial: "+56", color: "#60A5FA", bg: "rgba(59,130,246,0.15)", border: "rgba(59,130,246,0.35)", glow: "glow-cl" },
];

export const findCountry = (code) => COUNTRIES.find((c) => c.code === code) || COUNTRIES[0];

export const TEMPLATE_KINDS = [
  { key: "nivel_1", label: "Nivel 1 · Amigable", icon: "🟢", moraMin: 0, moraMax: 9, description: "5-9 días · Cobrar con descuento o facilidades" },
  { key: "nivel_2", label: "Nivel 2 · Directo", icon: "🟡", moraMin: 9, moraMax: 20, description: "9-20 días · Exigir pago o acuerdo de pago" },
  { key: "nivel_3", label: "Nivel 3 · Firme", icon: "🟠", moraMin: 20, moraMax: 35, description: "20-35 días · Última oportunidad antes de acciones" },
  { key: "nivel_4", label: "Nivel 4 · Fuerte", icon: "🔴", moraMin: 35, moraMax: 9999, description: "35+ días · Advertencia legal / buró" },
];

export function levelForMora(dias) {
  const d = Number(dias || 0);
  if (d >= 35) return "nivel_4";
  if (d >= 20) return "nivel_3";
  if (d >= 9) return "nivel_2";
  return "nivel_1";
}

export const findTemplateKind = (k) => TEMPLATE_KINDS.find((t) => t.key === k) || TEMPLATE_KINDS[0];

export const TEMPLATE_VARIABLES = [
  "{nombre}",
  "{monto}",
  "{fecha}",
  "{empresa}",
  "{vencimiento}",
  "{telefono}",
  "{dias_mora}",
  "{app_cliente}",
];

export const ESTADOS = [
  { key: "all", label: "Todos", color: "#A1A1AA", bg: "rgba(161,161,170,0.12)", icon: "📇" },
  { key: "pendiente", label: "Pendiente por pagar", color: "#FDE047", bg: "rgba(250,204,21,0.15)", icon: "⏳" },
  { key: "pagado", label: "Pagado", color: "#34D399", bg: "rgba(16,185,129,0.15)", icon: "✓" },
  { key: "parcial", label: "Pago parcial", color: "#60A5FA", bg: "rgba(59,130,246,0.15)", icon: "◐" },
  { key: "sin_contacto", label: "Sin contacto", color: "#F87171", bg: "rgba(239,68,68,0.15)", icon: "✕" },
];

export const findEstado = (k) => ESTADOS.find((e) => e.key === k) || ESTADOS[0];

export const MEDIOS_CONTACTO = [
  { key: "whatsapp", label: "WhatsApp", icon: "💬" },
  { key: "sms", label: "SMS", icon: "📱" },
  { key: "llamada", label: "Llamada", icon: "📞" },
  { key: "email", label: "Email", icon: "📧" },
  { key: "presencial", label: "Presencial", icon: "🏢" },
  { key: "otro", label: "Otro", icon: "•" },
];
