import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { endpoints } from "@/lib/api";
import { toast } from "sonner";

export default function WhatsAppIndicator({ country, config, onRefresh }) {
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(!!config?.whatsapp_connected);

  useEffect(() => {
    setConnected(!!config?.whatsapp_connected);
  }, [config]);

  const runTest = async () => {
    if (!config?.whatsapp_webhook_url) {
      toast.warning("Configura el Webhook de WhatsApp primero");
      return;
    }
    setTesting(true);
    try {
      const r = await endpoints.testWhatsapp(country);
      setConnected(r.connected);
      toast[r.connected ? "success" : "error"](
        r.connected ? "WhatsApp conectado" : `Sin conexión: ${r.reason || "error"}`
      );
      onRefresh?.();
    } catch {
      toast.error("Test fallido");
    } finally {
      setTesting(false);
    }
  };

  return (
    <button
      data-testid="whatsapp-indicator"
      onClick={runTest}
      className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#111114] border border-white/5 hover:border-white/10 transition-colors text-xs"
    >
      {testing ? (
        <Loader2 size={14} className="animate-spin text-zinc-400" />
      ) : connected ? (
        <>
          <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
          <CheckCircle2 size={14} className="text-emerald-400" />
        </>
      ) : (
        <>
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <XCircle size={14} className="text-red-400" />
        </>
      )}
      <span className={connected ? "text-emerald-300" : "text-zinc-400"}>
        {connected ? "WA Conectado" : "WA Desconectado"}
      </span>
    </button>
  );
}
