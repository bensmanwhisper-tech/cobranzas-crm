import { useEffect, useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import { LayoutGrid, Users, MessageSquareText, BarChart3, Terminal, Settings, Radio, Sparkles, HardDrive, MessageCircle } from "lucide-react";
import { COUNTRIES, findCountry } from "@/lib/countries";
import { endpoints } from "@/lib/api";
import CountrySelector from "@/components/CountrySelector";
import StatsCards from "@/components/StatsCards";
import ContactsView from "@/components/ContactsView";
import TemplatesView from "@/components/TemplatesView";
import ReportsView from "@/components/ReportsView";
import ConfigView from "@/components/ConfigView";
import ExecutionConsole from "@/components/ExecutionConsole";
import WhatsAppIndicator from "@/components/WhatsAppIndicator";
import FilesView from "@/components/FilesView";
import WhatsAppCenter from "@/components/WhatsAppCenter";
import RecoveryPanel from "@/components/RecoveryPanel";

const NAV = [
  { key: "dashboard", label: "Panel", icon: LayoutGrid },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, highlight: true },
  { key: "contacts", label: "Contactos", icon: Users },
  { key: "templates", label: "Plantillas", icon: MessageSquareText },
  { key: "files", label: "Archivos", icon: HardDrive },
  { key: "reports", label: "Reportes", icon: BarChart3 },
  { key: "config", label: "Configuración", icon: Settings },
  { key: "logs", label: "Consola", icon: Terminal },
];

export default function Dashboard() {
  const [country, setCountry] = useState("MX");
  const [tab, setTab] = useState("dashboard");
  const [summary, setSummary] = useState(null);
  const [logs, setLogs] = useState([]);
  const [config, setConfig] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const bump = useCallback(() => setRefreshTick((t) => t + 1), []);

  const loadSummary = useCallback(async () => {
    try {
      const s = await endpoints.reportsSummary();
      setSummary(s);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const l = await endpoints.getLogs({ limit: 60 });
      setLogs(l);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadConfig = useCallback(async (c) => {
    try {
      const cfg = await endpoints.getConfig(c);
      setConfig(cfg);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    loadLogs();
  }, [loadSummary, loadLogs, refreshTick]);

  useEffect(() => {
    loadConfig(country);
  }, [country, loadConfig, refreshTick]);

  // Poll logs every 5s
  useEffect(() => {
    const t = setInterval(loadLogs, 5000);
    return () => clearInterval(t);
  }, [loadLogs]);

  const activeCountry = useMemo(() => findCountry(country), [country]);

  const startFullProcess = async () => {
    if (!config?.whatsapp_webhook_url) {
      toast.warning("Configura primero el Webhook de WhatsApp para este país", {
        description: "Ve a Configuración → WhatsApp",
      });
      setTab("config");
      return;
    }
    toast.success(`Proceso iniciado para ${activeCountry.label}`, {
      description: "Selecciona contactos pendientes y envía desde la pestaña Contactos.",
    });
    setTab("contacts");
  };

  return (
    <div className="min-h-screen flex" data-testid="dashboard-root">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-white/5 bg-[#0B0B0F] flex flex-col">
        <div className="p-5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-[#E1FF00] text-black grid place-items-center font-black">
              <Sparkles size={18} strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-display font-bold tracking-tight text-lg leading-none">COBRANZAS<span className="text-[#E1FF00]">.XD</span></div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mt-1">Command Center · v3.0</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ key, label, icon: Icon, highlight }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                data-testid={`nav-${key}`}
                onClick={() => setTab(key)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-white/5 text-white border border-white/10"
                    : highlight
                    ? "text-emerald-300 hover:bg-emerald-500/5 hover:text-emerald-200 border border-emerald-500/10"
                    : "text-zinc-400 hover:bg-white/[0.03] hover:text-white border border-transparent"
                }`}
              >
                <Icon size={16} strokeWidth={active ? 2.2 : 1.8} className={active ? "text-[#E1FF00]" : highlight ? "text-emerald-400" : ""} />
                <span className="font-medium">{label}</span>
                {highlight && !active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/5">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">País activo</div>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-md border"
            style={{ borderColor: activeCountry.border, background: activeCountry.bg }}
          >
            <span className="text-lg">{activeCountry.flag}</span>
            <div>
              <div className="text-sm font-semibold" style={{ color: activeCountry.color }}>{activeCountry.label}</div>
              <div className="text-[10px] text-zinc-400 uppercase tracking-wider">{activeCountry.code}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-16 border-b border-white/5 bg-[#0B0B0F]/80 backdrop-blur-xl px-6 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-4 min-w-0">
            <CountrySelector value={country} onChange={setCountry} />
          </div>
          <div className="flex items-center gap-3">
            <WhatsAppIndicator country={country} config={config} onRefresh={() => loadConfig(country)} />
            <button
              data-testid="start-process-btn"
              onClick={startFullProcess}
              className="glow-primary bg-[#E1FF00] text-black text-sm font-semibold px-4 py-2 rounded-md hover:bg-[#EEFF66] active:scale-95 transition-transform flex items-center gap-2"
            >
              <Radio size={14} strokeWidth={2.5} />
              Iniciar Proceso
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6" data-testid="main-content">
          {tab === "dashboard" && (
            <div className="space-y-6" data-testid="tab-dashboard">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-1">Panel general</div>
                <h1 className="font-display font-bold text-3xl tracking-tight">
                  Buenos días, operador. <span className="text-zinc-500">Hoy es tu día.</span>
                </h1>
                <p className="text-zinc-400 text-sm mt-1">Vista consolidada de operaciones a través de los 4 países.</p>
              </div>
              <StatsCards summary={summary} />
              <RecoveryPanel summary={summary} />
              <div>
                <ContactsView
                  country={country}
                  onChange={bump}
                  embedded
                />
              </div>
            </div>
          )}

          {tab === "whatsapp" && (
            <div data-testid="tab-whatsapp">
              <WhatsAppCenter defaultCountry={country} onChange={bump} />
            </div>
          )}

          {tab === "contacts" && (
            <div data-testid="tab-contacts">
              <ContactsView country={country} onChange={bump} />
            </div>
          )}

          {tab === "templates" && (
            <div data-testid="tab-templates">
              <TemplatesView country={country} />
            </div>
          )}

          {tab === "files" && (
            <div data-testid="tab-files">
              <FilesView country={country} onChange={bump} />
            </div>
          )}

          {tab === "reports" && (
            <div data-testid="tab-reports">
              <ReportsView summary={summary} />
            </div>
          )}

          {tab === "config" && (
            <div data-testid="tab-config">
              <ConfigView country={country} config={config} onSaved={bump} />
            </div>
          )}

          {tab === "logs" && (
            <div data-testid="tab-logs">
              <ExecutionConsole logs={logs} onClear={() => endpoints.clearLogs().then(loadLogs)} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
