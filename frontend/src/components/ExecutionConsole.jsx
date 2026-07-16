import { useEffect, useRef } from "react";
import { Terminal as TIcon, Trash2 } from "lucide-react";

const COLOR = {
  success: "#34D399",
  error: "#F87171",
  warn: "#FDE047",
  info: "#60A5FA",
  system: "#A1A1AA",
};

export default function ExecutionConsole({ logs = [], onClear, embedded = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [logs]);

  return (
    <div className={`bg-black border border-white/10 rounded-lg overflow-hidden ${embedded ? "" : "min-h-[500px]"}`} data-testid="execution-console">
      <div className="px-4 py-2.5 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
          </div>
          <TIcon size={12} className="text-zinc-500 ml-2" />
          <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest">consola.log</span>
        </div>
        {onClear && (
          <button
            data-testid="clear-logs-btn"
            onClick={onClear}
            className="text-zinc-500 hover:text-red-400 text-xs flex items-center gap-1 font-mono"
            title="Limpiar logs"
          >
            <Trash2 size={11} />
            clear
          </button>
        )}
      </div>
      <div
        ref={ref}
        className={`p-4 font-mono text-[12px] leading-relaxed overflow-auto ${embedded ? "max-h-[480px]" : "max-h-[70vh]"}`}
      >
        {logs.length === 0 && (
          <div className="text-zinc-600">
            <span className="text-emerald-500">$</span> waiting for activity...
            <span className="terminal-cursor" />
          </div>
        )}
        {logs.map((l) => {
          const color = COLOR[l.level] || COLOR.info;
          const ts = new Date(l.ts).toLocaleTimeString();
          return (
            <div key={l.id} className="flex gap-2 hover:bg-white/[0.02] px-1 -mx-1 rounded" data-testid={`log-${l.id}`}>
              <span className="text-zinc-600 shrink-0">[{ts}]</span>
              <span className="text-zinc-400 shrink-0">[{l.source}]</span>
              {l.country && <span className="text-zinc-500 shrink-0">[{l.country}]</span>}
              <span style={{ color }} className="break-all">{l.message}</span>
            </div>
          );
        })}
        <div className="mt-2">
          <span className="text-emerald-500">$</span>
          <span className="terminal-cursor" />
        </div>
      </div>
    </div>
  );
}
