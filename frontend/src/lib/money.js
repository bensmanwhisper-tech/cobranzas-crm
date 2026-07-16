import { useEffect, useState } from "react";
import { endpoints } from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";

const COUNTRY_CURRENCY = { MX: "MXN", CO: "COP", PE: "PEN", CL: "CLP" };

// Fallback rates (approx) — only used until backend fetch resolves
const DEFAULT_RATES = { MXN: 18.5, COP: 4100, PEN: 3.75, CLP: 960, USD: 1 };

let _rates = DEFAULT_RATES;
let _updated = "";
const _subs = new Set();

async function fetchRates() {
  try {
    const r = await endpoints.fxRates();
    _rates = { ...DEFAULT_RATES, ...(r.rates || {}) };
    _updated = r.updated || "";
    _subs.forEach((cb) => cb(_rates));
  } catch { /* keep fallback */ }
}
// initial fetch + refresh every hour
if (typeof window !== "undefined") {
  fetchRates();
  setInterval(fetchRates, 60 * 60 * 1000);
}

export function useRates() {
  const [rates, setRates] = useState(_rates);
  const [updated, setUpdated] = useState(_updated);
  useEffect(() => {
    const cb = (r) => { setRates({ ...r }); setUpdated(_updated); };
    _subs.add(cb);
    return () => _subs.delete(cb);
  }, []);
  return { rates, updated };
}

export function currencyOf(country) {
  return COUNTRY_CURRENCY[country] || "USD";
}

export function symbolOf(currency) {
  return { MXN: "MX$", COP: "COL$", PEN: "S/", CLP: "CLP$", USD: "US$" }[currency] || "$";
}

export function fmtLocal(amount, country) {
  const cur = currencyOf(country);
  const sym = symbolOf(cur);
  const val = Number(amount || 0);
  return `${sym} ${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function toUsd(amount, country) {
  const cur = currencyOf(country);
  const rate = _rates[cur] || 1;
  if (!rate) return 0;
  return Number(amount || 0) / rate;
}

export function fmtUsd(amount, country) {
  const usd = toUsd(amount, country);
  if (usd >= 1000) return `US$ ${usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (usd >= 1) return `US$ ${usd.toFixed(2)}`;
  return `US$ ${usd.toFixed(3)}`;
}

export function fmtLocalUsd(amount, country, opts = {}) {
  const local = fmtLocal(amount, country);
  const usd = fmtUsd(amount, country);
  const sep = opts.sep || " · ";
  return `${local}${sep}${usd}`;
}
