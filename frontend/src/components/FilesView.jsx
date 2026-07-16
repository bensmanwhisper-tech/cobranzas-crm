import { useEffect, useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Upload, Download, Trash2, FileText, FileSpreadsheet, FileImage, File as FileIcon, HardDrive, Sparkles, DatabaseZap } from "lucide-react";
import { COUNTRIES, findCountry } from "@/lib/countries";
import { endpoints } from "@/lib/api";

const CATEGORIES = [
  { key: "all", label: "Todos" },
  { key: "csv", label: "CSV" },
  { key: "export", label: "Exports" },
  { key: "report", label: "Reportes" },
  { key: "other", label: "Otros" },
];

function iconFor(name = "") {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["csv", "xls", "xlsx"].includes(ext)) return FileSpreadsheet;
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return FileImage;
  if (["pdf", "doc", "docx", "txt"].includes(ext)) return FileText;
  return FileIcon;
}

function humanSize(n) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export default function FilesView({ country, onChange }) {
  const [files, setFiles] = useState([]);
  const [filterCountry, setFilterCountry] = useState(country);
  const [filterCategory, setFilterCategory] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [category, setCategory] = useState("csv");
  const inputRef = useRef(null);

  useEffect(() => { setFilterCountry(country); }, [country]);

  const load = useCallback(async () => {
    const data = await endpoints.listFiles({
      country: filterCountry === "ALL" ? undefined : filterCountry,
      category: filterCategory === "all" ? undefined : filterCategory,
    });
    setFiles(data);
  }, [filterCountry, filterCategory]);

  useEffect(() => { load(); }, [load]);

  const doUpload = async (fileList) => {
    if (!fileList?.length) return;
    setUploading(true);
    try {
      for (const f of fileList) {
        await endpoints.uploadFile(f, {
          category,
          country: filterCountry === "ALL" ? country : filterCountry,
        });
      }
      toast.success(`${fileList.length} archivo(s) subido(s)`);
      await load();
      onChange?.();
    } catch (e) {
      toast.error("Error al subir archivo");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    doUpload([...e.dataTransfer.files]);
  };

  const handleDelete = async (id) => {
    await endpoints.deleteFile(id);
    toast.success("Archivo eliminado");
    await load();
  };

  const handleImportContacts = async (f) => {
    try {
      const r = await endpoints.importContactsFromFile(f.id);
      toast.success(`Importados ${r.inserted} contactos`, {
        description: r.errors ? `${r.errors} filas con error` : undefined,
      });
      onChange?.();
    } catch {
      toast.error("Error al importar");
    }
  };

  return (
    <div className="space-y-4" data-testid="files-view">
      <div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-1">Almacenamiento</div>
        <h1 className="font-display font-bold text-3xl tracking-tight flex items-center gap-3">
          Archivos <HardDrive className="text-[#E1FF00]" size={26} />
        </h1>
        <p className="text-zinc-400 text-sm mt-1">Sube CSVs, exports, reportes y archivos de trabajo. Se guardan en el object storage de Emergent.</p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        data-testid="dropzone"
        className={`cursor-pointer rounded-xl border-2 border-dashed transition-colors p-8 text-center ${
          dragOver ? "border-[#E1FF00] bg-[#E1FF00]/5" : "border-white/10 bg-[#101013] hover:border-white/20"
        }`}
      >
        <Upload size={28} className={`mx-auto mb-2 ${uploading ? "animate-bounce text-[#E1FF00]" : "text-zinc-500"}`} />
        <div className="font-display font-semibold text-lg">
          {uploading ? "Subiendo..." : "Arrastra archivos aquí o haz clic para subir"}
        </div>
        <div className="text-xs text-zinc-500 mt-1 font-mono">
          CSV · Excel · PDF · Imágenes — cualquier archivo. Máx 100MB.
        </div>
        <input
          type="file"
          multiple
          ref={inputRef}
          onChange={(e) => doUpload([...(e.target.files || [])])}
          className="hidden"
          data-testid="file-upload-input"
        />
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-[#101013] rounded-md p-1 border border-white/5">
          <button
            data-testid="files-country-ALL"
            onClick={() => setFilterCountry("ALL")}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              filterCountry === "ALL" ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            Todos los países
          </button>
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              data-testid={`files-country-${c.code}`}
              onClick={() => setFilterCountry(c.code)}
              className="px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1"
              style={{
                background: filterCountry === c.code ? c.bg : "transparent",
                color: filterCountry === c.code ? c.color : "#A1A1AA",
              }}
            >
              <span>{c.flag}</span> {c.code}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-[#101013] rounded-md p-1 border border-white/5">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              data-testid={`files-cat-${c.key}`}
              onClick={() => setFilterCategory(c.key)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                filterCategory === c.key ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <label className="text-xs text-zinc-500 flex items-center gap-2">
          Categoría al subir:
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            data-testid="upload-category"
            className="bg-[#0B0B0F] border border-white/5 text-xs rounded-md px-2 py-1 text-zinc-300 outline-none"
          >
            <option value="csv">CSV</option>
            <option value="export">Export</option>
            <option value="report">Reporte</option>
            <option value="other">Otro</option>
          </select>
        </label>
      </div>

      {/* File grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {files.length === 0 && (
          <div className="col-span-full text-center py-16 text-zinc-500 bg-[#101013] border border-white/5 rounded-xl">
            <div className="text-4xl mb-2">🗂</div>
            Sin archivos. Sube tu primer CSV o export.
          </div>
        )}
        {files.map((f) => {
          const Icon = iconFor(f.original_filename);
          const cty = f.country ? findCountry(f.country) : null;
          const isCsv = /\.csv$/i.test(f.original_filename);
          return (
            <div
              key={f.id}
              data-testid={`file-${f.id}`}
              className="bg-[#101013] border border-white/5 hover:border-white/15 rounded-xl p-4 transition-colors group"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="w-10 h-10 rounded-md bg-white/5 grid place-items-center">
                  <Icon size={18} className="text-[#E1FF00]" />
                </div>
                <div className="flex items-center gap-1">
                  {cty && (
                    <span
                      className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
                      style={{ background: cty.bg, color: cty.color }}
                    >
                      {cty.flag} {cty.code}
                    </span>
                  )}
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-mono text-zinc-400 bg-white/5">
                    {f.category}
                  </span>
                </div>
              </div>
              <div className="font-medium text-sm text-white truncate" title={f.original_filename}>
                {f.original_filename}
              </div>
              <div className="text-[11px] text-zinc-500 font-mono mt-1">
                {humanSize(f.size)} · {new Date(f.created_at).toLocaleString()}
              </div>
              {f.note && <div className="text-xs text-zinc-400 mt-2 italic">{f.note}</div>}
              <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2 opacity-70 group-hover:opacity-100 transition-opacity">
                <a
                  href={endpoints.fileDownloadUrl(f.id)}
                  target="_blank"
                  rel="noreferrer"
                  data-testid={`download-${f.id}`}
                  className="text-xs px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 flex items-center gap-1.5"
                >
                  <Download size={11} /> Bajar
                </a>
                {isCsv && (
                  <button
                    data-testid={`import-${f.id}`}
                    onClick={() => handleImportContacts(f)}
                    className="text-xs px-2.5 py-1 rounded bg-[#E1FF00]/10 border border-[#E1FF00]/30 text-[#E1FF00] flex items-center gap-1.5 hover:bg-[#E1FF00]/20"
                  >
                    <DatabaseZap size={11} /> Importar
                  </button>
                )}
                <div className="flex-1" />
                <button
                  data-testid={`delete-${f.id}`}
                  onClick={() => handleDelete(f.id)}
                  className="text-xs p-1.5 rounded text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
