/**
 * The BoQ upload and the template seed as a background operation (#1665, ADR 0047): both post the workbook to
 * `upload_file`, which starts the parse through `services/background_ops`, and both screens follow it with
 * `useBackgroundOperation`. This reads what that operation's view means for an upload screen.
 */
import { isRecord, type OpView } from "@/utils/backgroundOps/operationFollower";

import { readBoqWorkerOutcome } from "@/utils/boq/boqWorkerOutcome";

export const UPLOAD_METHOD = "nirmaan_stack.api.boq.wizard.upload_file.upload_file";

/**
 * The upload screen's lifecycle.
 *   idle           - no upload started
 *   uploading      - the workbook is being posted
 *   queued         - the parse waits in the queue
 *   parsing        - the parse is running
 *   done           - parsed; the BOQs row exists
 *   error-E        - the workbook could not be read (error_code "corrupted")
 *   error-F        - no sheets (error_code "zero_sheets")
 *   error-internal - the upload or its parse failed (the server's words in `error`)
 */
export type UploadStatus =
  | "idle"
  | "uploading"
  | "queued"
  | "parsing"
  | "done"
  | "error-E"
  | "error-F"
  | "error-internal";

export interface UploadOutcome {
  status: UploadStatus;
  /** The BOQs row the parse made, once done. */
  boqName: string | null;
  /** The server's words, for error-internal. */
  error: string | null;
}

/** What an upload started with, kept as the operation's context so a reload still names the file. */
export interface UploadedFile {
  name: string;
  size: number;
}


const CODES: Record<string, UploadStatus> = { corrupted: "error-E", zero_sheets: "error-F" };

/** The upload screen's state for the operation's view. */
export function uploadOutcome(view: OpView): UploadOutcome {
  const outcome = (status: UploadStatus, boqName: string | null = null, error: string | null = null) =>
    ({ status, boqName, error });
  switch (view.phase) {
    case "idle": return outcome("idle");
    case "starting": return outcome("uploading");
    case "queued": return outcome("queued");
    case "running": return outcome("parsing");
    case "failed":
    case "lost": return outcome("error-internal", null, view.error);
    case "finished": {
      const made = readBoqWorkerOutcome(view.result);
      return made.ok ? outcome("done", made.boqName) : outcome(CODES[made.errorCode ?? ""] ?? "error-internal");
    }
  }
}

/** The file an upload operation's context names, or null. */
export function uploadedFileOf(context: unknown): UploadedFile | null {
  return isRecord(context) && typeof context.name === "string" && typeof context.size === "number"
    ? { name: context.name, size: context.size }
    : null;
}
