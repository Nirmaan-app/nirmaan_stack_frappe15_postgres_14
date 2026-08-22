/**
 * Snag import wizard -- STEP 1: upload.
 *
 * The ONLY raw `fetch` in this wizard: `inspect_workbook` is multipart/form-data, which
 * `useFrappePostCall` cannot express. Every other call here goes through the SDK.
 */

import { useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import type { InspectWorkbookResponse } from "../types";
import { validateUploadFile } from "./importState";
import { getFrappeError } from "@/utils/frappeErrors";

const INSPECT_ENDPOINT =
  "/api/method/nirmaan_stack.api.snags.import_wizard.inspect_workbook";

export interface UploadStepProps {
  projectId: string;
  /** The file already accepted in a previous visit to this step, if any. */
  fileName: string | null;
  onInspected: (file: File, response: InspectWorkbookResponse) => void;
}

export function UploadStep({ projectId, fileName, onInspected }: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function inspect(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("project", projectId);

      const res = await fetch(INSPECT_ENDPOINT, {
        method: "POST",
        headers: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "X-Frappe-CSRF-Token": (window as any).frappe?.csrf_token ?? "",
        },
        body: fd,
      });

      const json = (await res.json().catch(() => null)) as
        | { message?: InspectWorkbookResponse; exc_type?: string; _server_messages?: string }
        | null;

      if (!res.ok || !json?.message) {
        setError(
          serverMessage(json) ??
            "We couldn't read this workbook. Try opening it in Excel and using Save As → .xlsx, then upload again.",
        );
        return;
      }
      if (!json.message.sheets?.length) {
        setError("This workbook contains no readable worksheets.");
        return;
      }
      onInspected(file, json.message);
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function accept(file: File) {
    const problem = validateUploadFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    void inspect(file);
  }

  if (busy) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-background p-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">Reading workbook…</p>
        <p className="text-xs text-muted-foreground">Nothing is saved yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a snag list workbook"
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30",
        )}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) accept(f);
        }}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <div className="text-center">
          <p className="font-medium text-foreground">Drop the snag list here</p>
          <p className="mt-1 text-sm text-muted-foreground">or click to browse</p>
          <p className="mt-2 text-xs text-muted-foreground">.xlsx or .xlsm · max 25 MB</p>
        </div>
      </div>

      {fileName && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-muted-foreground">
            Currently loaded: <span className="font-medium text-foreground">{fileName}</span>
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">Could not read the file</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) accept(f);
          // Reset so the SAME file can be re-picked after an error.
          e.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * Pull a message out of a raw Frappe HTTP error body. This step posts multipart with a bare
 * `fetch` (the SDK cannot), so the body arrives unparsed — but the UNWRAPPING is the app-wide
 * `getFrappeError`, not a local copy (ADR-0010 rule F2).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serverMessage(json: any): string | null {
  if (!json) return null;
  if (!json._server_messages && !json.exception && !json.message) return null;
  const text = getFrappeError(json);
  return text && text !== "Something went wrong." ? text : null;
}
