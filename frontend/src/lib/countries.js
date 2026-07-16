export const COUNTRIES = [
  { code: "MX", label: "México", flag: "🇲🇽", dial: "+52", color: "#34D399", bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.35)", glow: "glow-mx" },
  { code: "CO", label: "Colombia", flag: "🇨🇴", dial: "+57", color: "#FDE047", bg: "rgba(250,204,21,0.15)", border: "rgba(250,204,21,0.35)", glow: "glow-co" },
  { code: "PE", label: "Perú", flag: "🇵🇪", dial: "+51", color: "#F87171", bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.35)", glow: "glow-pe" },
  { code: "CL", label: "Chile", flag: "🇨🇱", dial: "+56", color: "#60A5FA", bg: "rgba(59,130,246,0.15)", border: "rgba(59,130,246,0.35)", glow: "glow-cl" },
];

export const findCountry = (code) => COUNTRIES.find((c) => c.code === code) || COUNTRIES[0];

export const TEMPLATE_KINDS = [
  { key: "default", label: "Por defecto", icon: "🌐" },
  { key: "friendly", label: "Amigable", icon: "😊" },
  { key: "formal", label: "Formal", icon: "📌" },
  { key: "urgent", label: "Urgente", icon: "⚠️" },
];

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
