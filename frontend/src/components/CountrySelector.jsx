import { COUNTRIES } from "@/lib/countries";

export default function CountrySelector({ value, onChange }) {
  return (
    <div className="flex items-center gap-1 bg-[#111114] border border-white/5 rounded-lg p-1" data-testid="country-selector">
      {COUNTRIES.map((c) => {
        const active = value === c.code;
        return (
          <button
            key={c.code}
            data-testid={`country-${c.code}`}
            onClick={() => onChange(c.code)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              active ? c.glow : ""
            }`}
            style={{
              background: active ? c.bg : "transparent",
              color: active ? c.color : "#A1A1AA",
              border: active ? `1px solid ${c.border}` : "1px solid transparent",
            }}
          >
            <span className="text-base leading-none">{c.flag}</span>
            <span>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
