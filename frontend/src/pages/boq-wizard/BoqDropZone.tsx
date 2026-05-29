import { useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBoqWizardStore } from "@/zustand/useBoqWizardStore";

const ACCEPTED_EXTS = new Set([".xlsx", ".xlsm"]);
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BoqDropZone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { droppedFile, setDroppedFile, clearFile } = useBoqWizardStore();

  function acceptFile(file: File) {
    const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    // Error D — wrong extension
    if (!ACCEPTED_EXTS.has(ext)) {
      setError(`"${ext}" is not supported. Please upload an .xlsx or .xlsm file.`);
      return;
    }
    // Error H — file too large
    if (file.size > MAX_BYTES) {
      setError(`File is too large (${fmtBytes(file.size)}). Maximum allowed size is 25 MB.`);
      return;
    }
    setError(null);
    setDroppedFile({ name: file.name, size: file.size });
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) acceptFile(f);
    // Reset so the same file can be re-selected after Replace.
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) acceptFile(f);
  }

  // ── File tile (after a valid file is dropped / selected) ────────────────
  if (droppedFile) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-background p-4">
          <FileSpreadsheet className="mt-0.5 h-7 w-7 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{droppedFile.name}</p>
            <p className="text-xs text-muted-foreground">{fmtBytes(droppedFile.size)}</p>
          </div>
        </div>
        <button
          type="button"
          className="text-sm text-primary underline-offset-4 hover:underline"
          onClick={() => {
            clearFile();
            setError(null);
            inputRef.current?.click();
          }}
        >
          Replace file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={onInputChange}
        />
      </div>
    );
  }

  // ── Empty / drag-drop affordance ─────────────────────────────────────────
  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        )}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <div className="text-center">
          <p className="font-medium text-foreground">Drop your BoQ here</p>
          <p className="mt-1 text-sm text-muted-foreground">or click to browse</p>
          <p className="mt-2 text-xs text-muted-foreground">.xlsx or .xlsm · max 25 MB</p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm"
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}
