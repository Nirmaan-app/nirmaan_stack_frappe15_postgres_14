import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBoqWizardStore } from "@/zustand/useBoqWizardStore";
import type { UploadedFile, UploadStatus } from "./boqUploadOperation";

const ACCEPTED_EXTS = new Set([".xlsx", ".xlsm"]);
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const TAKING_LONG_MS = 30_000;

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface BoqDropZoneProps {
  /** The upload's state, from its background operation (BoqUploadScreen follows it). */
  status: UploadStatus;
  /** The server's words for error-internal. */
  error: string | null;
  /** Start the upload: the workbook's form data and the file it names. */
  onUpload: (form: FormData, file: UploadedFile) => void;
  /** Forget the upload (Try a different file / Replace file). */
  onReset: () => void;
}

export function BoqDropZone({ status: uploadStatus, error, onUpload, onReset }: BoqDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // In Revise mode a file dropped BEFORE an original is picked is HELD here (order-independence,
  // ADR-0014 D1) and uploaded once the original is selected -- source_boq must ride the POST.
  const pendingFileRef = useRef<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [takingLong, setTakingLong] = useState(false);

  const {
    droppedFile,
    revisionMode,
    sourceBoq,
    setDroppedFile,
    resetUpload,
  } = useBoqWizardStore();

  // Upload may start only when the entry is unambiguous: a New upload always may; a Revise
  // upload waits for an original to be picked (so source_boq is present in the POST).
  const readyToUpload = revisionMode !== "revise" || !!sourceBoq;

  // 30-second soft "taking longer" message -- counts from when the parse starts running (never the
  // time in the queue); not a timeout.
  useEffect(() => {
    if (uploadStatus !== "parsing") {
      setTakingLong(false);
      return;
    }
    const t = setTimeout(() => setTakingLong(true), TAKING_LONG_MS);
    return () => clearTimeout(t);
  }, [uploadStatus]);

  // Deferred upload (order-independence): once the entry becomes unambiguous -- New, or Revise
  // with an original picked -- upload any file that was dropped earlier and held.
  useEffect(() => {
    if (readyToUpload && pendingFileRef.current && uploadStatus === "idle") {
      const held = pendingFileRef.current;
      pendingFileRef.current = null;
      triggerUpload(held);
    }
    // triggerUpload reads fresh state via getState(); safe to exclude from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyToUpload, uploadStatus]);

  function triggerUpload(file: File): void {
    // Read fresh state at call time -- this can fire from an effect after the original is
    // picked, so a render-time closure could be stale.
    const {
      selectedProjectId: projectId,
      revisionMode: mode,
      sourceBoq: src,
    } = useBoqWizardStore.getState();
    setLocalError(null);
    const fd = new FormData();
    fd.append("project_id", projectId);
    fd.append("file", file, file.name);
    // A revision carries source_boq -> the picked original (ADR-0014 D1/D2).
    if (mode === "revise" && src) fd.append("source_boq", src);
    // A refused or failed start ends the operation failed, shown as error-internal with the server's words.
    onUpload(fd, { name: file.name, size: file.size });
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
    if (readyToUpload) {
      pendingFileRef.current = null;
      triggerUpload(file);
    } else {
      // Revise mode, no original picked yet: hold the file. The effect below uploads it
      // as soon as an original is selected (D1: file-drop and pick are order-independent).
      pendingFileRef.current = file;
    }
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

  function startOver() {
    pendingFileRef.current = null;
    resetUpload();
    onReset();
    setLocalError(null);
    setTakingLong(false);
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

  // ── Waiting in the queue ───────────────────────────────────────────────────
  if (uploadStatus === "queued") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-background p-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">Waiting in the queue...</p>
        <p className="text-xs text-muted-foreground text-center max-w-xs">
          Parsing starts as soon as the server is free.
        </p>
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
          {/*
            Copy rule: do NOT say "corrupted". The measured cases were valid
            workbooks Excel opens fine, written slightly out-of-spec by a non-Excel
            tool -- calling them corrupted is both wrong and sounds unrecoverable,
            so users stopped rather than trying the one thing that works. The two
            known defects are now auto-repaired server-side, so anything reaching
            this screen is unknown AND logged; re-saving from Excel is the correct
            first move for the user while we read the traceback.
          */}
          <p className="mt-1 text-muted-foreground">
            We couldn&apos;t open this workbook. It may use a format Excel accepts but
            our reader doesn&apos;t. Try opening it in Excel and using{" "}
            <span className="font-medium">Save As &rarr; .xlsx</span>, then upload again.
          </p>
        </div>
        <button
          type="button"
          className="text-sm text-primary underline-offset-4 hover:underline"
          onClick={startOver}
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
          onClick={startOver}
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
          <p className="font-medium text-destructive">Upload failed</p>
          <p className="mt-1 text-muted-foreground">
            {error ?? "An unexpected error occurred while processing the file. Please try again."}
          </p>
        </div>
        <button
          type="button"
          className="text-sm text-primary underline-offset-4 hover:underline"
          onClick={startOver}
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
        {/* Revise mode, file held pending an original pick (D1 order-independence). */}
        {!readyToUpload && uploadStatus === "idle" && (
          <p className="text-xs text-muted-foreground">
            Select the BoQ to revise to start uploading.
          </p>
        )}
        {localError && (
          <p className="text-sm text-destructive">{localError}</p>
        )}
        <button
          type="button"
          className="text-sm text-primary underline-offset-4 hover:underline"
          onClick={() => {
            startOver();
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
