import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBoqWizardStore } from "@/zustand/useBoqWizardStore";

const ACCEPTED_EXTS = new Set([".xlsx", ".xlsm"]);
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const TAKING_LONG_MS = 30_000;

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BoqDropZone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [takingLong, setTakingLong] = useState(false);

  const {
    droppedFile,
    uploadStatus,
    selectedProjectId,
    setDroppedFile,
    setUploadStatus,
    setJobId,
    resetUpload,
  } = useBoqWizardStore();

  // 30-second soft "taking longer" message -- fires during parsing, not a timeout.
  useEffect(() => {
    if (uploadStatus !== "parsing") {
      setTakingLong(false);
      return;
    }
    const t = setTimeout(() => setTakingLong(true), TAKING_LONG_MS);
    return () => clearTimeout(t);
  }, [uploadStatus]);

  async function triggerUpload(file: File): Promise<void> {
    setUploadStatus("uploading");
    setLocalError(null);
    try {
      const fd = new FormData();
      fd.append("project_id", selectedProjectId);
      fd.append("file", file, file.name);

      const res = await fetch(
        "/api/method/nirmaan_stack.api.boq.wizard.upload_file",
        {
          method: "POST",
          headers: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "X-Frappe-CSRF-Token": (window as any).frappe?.csrf_token ?? "",
          },
          body: fd,
        }
      );

      if (!res.ok) {
        setLocalError("Upload failed. Please try again.");
        resetUpload();
        return;
      }

      const json = await res.json() as { message?: { job_id?: string } };
      const jobId = json?.message?.job_id ?? null;
      setJobId(jobId);
      setUploadStatus("parsing");
    } catch {
      setLocalError("Upload failed. Check your connection and try again.");
      resetUpload();
    }
  }

  function acceptFile(file: File) {
    const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    // Error D -- wrong extension
    if (!ACCEPTED_EXTS.has(ext)) {
      setLocalError(`"${ext}" is not supported. Please upload an .xlsx or .xlsm file.`);
      return;
    }
    // Error H -- file too large
    if (file.size > MAX_BYTES) {
      setLocalError(`File is too large (${fmtBytes(file.size)}). Maximum allowed size is 25 MB.`);
      return;
    }
    setLocalError(null);
    setDroppedFile({ name: file.name, size: file.size });
    void triggerUpload(file);
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

  // ── Uploading spinner ──────────────────────────────────────────────────────
  if (uploadStatus === "uploading") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-background p-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">Uploading file...</p>
      </div>
    );
  }

  // ── Parsing spinner ────────────────────────────────────────────────────────
  if (uploadStatus === "parsing") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-background p-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">Parsing BoQ...</p>
        {takingLong && (
          <p className="text-xs text-muted-foreground text-center max-w-xs">
            This is taking a little longer than usual. Large workbooks can take up to a minute.
          </p>
        )}
      </div>
    );
  }

  // ── Error E -- corrupted workbook ──────────────────────────────────────────
  if (uploadStatus === "error-E") {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">File could not be read</p>
          <p className="mt-1 text-muted-foreground">
            The file appears to be corrupted or is not a valid Excel workbook.
          </p>
        </div>
        <button
          type="button"
          className="text-sm text-primary underline-offset-4 hover:underline"
          onClick={() => { resetUpload(); setLocalError(null); setTakingLong(false); }}
        >
          Try a different file
        </button>
      </div>
    );
  }

  // ── Error F -- zero sheets ─────────────────────────────────────────────────
  if (uploadStatus === "error-F") {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">No sheets found</p>
          <p className="mt-1 text-muted-foreground">
            The workbook contains no visible sheets. Please check the file and try again.
          </p>
        </div>
        <button
          type="button"
          className="text-sm text-primary underline-offset-4 hover:underline"
          onClick={() => { resetUpload(); setLocalError(null); setTakingLong(false); }}
        >
          Try a different file
        </button>
      </div>
    );
  }

  // ── Error internal ─────────────────────────────────────────────────────────
  if (uploadStatus === "error-internal") {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Parsing failed</p>
          <p className="mt-1 text-muted-foreground">
            An unexpected error occurred while processing the file. Please try again.
          </p>
        </div>
        <button
          type="button"
          className="text-sm text-primary underline-offset-4 hover:underline"
          onClick={() => { resetUpload(); setLocalError(null); setTakingLong(false); }}
        >
          Try a different file
        </button>
      </div>
    );
  }

  // ── File tile (valid file present; idle or done) ───────────────────────────
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
        {localError && (
          <p className="text-sm text-destructive">{localError}</p>
        )}
        <button
          type="button"
          className="text-sm text-primary underline-offset-4 hover:underline"
          onClick={() => {
            resetUpload();
            setLocalError(null);
            setTakingLong(false);
            // defer click until re-render has mounted the idle-state input
            setTimeout(() => inputRef.current?.click(), 0);
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

  // ── Empty / drag-drop affordance ───────────────────────────────────────────
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

      {localError && (
        <p className="text-sm text-destructive">{localError}</p>
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
