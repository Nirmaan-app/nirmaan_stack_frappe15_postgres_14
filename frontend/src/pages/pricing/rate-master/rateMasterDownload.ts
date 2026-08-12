// SLICE 5 -- the two download surfaces of the Rate Master.
//
// TWO FILES THAT MUST NEVER BE CONFUSED:
//   * the CSV  is for EDITING -- a pricer changes rates and adds SKUs in Excel and uploads it back.
//   * the ASSET is for BOOTSTRAP AND BACKUP -- a loader-ready snapshot of the whole catalog. It is
//     not usefully editable by hand, and nothing reads an edited one.
// The Data Viewer groups them under two separate headings for exactly that reason; see
// DOWNLOAD_COPY below, which is the single source of the wording so the two surfaces cannot drift.
//
// Both endpoints return the base64-in-JSON download triple that export_priced_workbook established
// and slice 4's asset export follows, so this one decoder serves both.

/** The server's download triple, identical for the CSV and the asset endpoints. */
export interface DownloadPayload {
  filename: string;
  content_type: string;
  content_base64: string;
}

/**
 * base64 -> Blob -> browser download. PURE apart from the DOM click, and deliberately tolerant of a
 * missing filename so a malformed response cannot produce a file called "undefined".
 *
 * `atob` yields a binary string; it must be widened byte-by-byte before Blob, or any non-ASCII
 * character (the catalog carries `®` and a U+2010 hyphen) is mangled on the way out.
 */
export function downloadBase64(payload: DownloadPayload, fallbackName: string): void {
  const binary = atob(payload.content_base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const blob = new Blob([bytes], { type: payload.content_type || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", payload.filename || fallbackName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * THE WORDING, in one place. The two groups are labelled by PURPOSE rather than by format, because
 * a user choosing between "CSV" and "JSON" is choosing a file extension, not an intention -- and the
 * failure mode this guards against is someone downloading the backup, editing it, and finding
 * nothing reads it back.
 */
export const DOWNLOAD_COPY = {
  editGroup: "Download to edit",
  editHint: "Edit rates or add items in Excel, then upload the file back.",
  editThisCategory: "This category",
  editAllCategories: "All categories",
  backupGroup: "Download a backup",
  backupHint: "A full snapshot of the catalog for restore. Not for editing.",
  backupAsset: "Asset file",
  /** Shown once under the edit group: the one rule a user has to know to add a row. */
  newRowHint: "To add an item, fill a new row and leave item_uid blank.",
} as const;

/**
 * The REAL message out of a Frappe error, for the download panel.
 *
 * WHY THIS EXISTS: the panel first shipped rendering `(e as {message?})?.message ?? "..."`, which on
 * a Frappe failure is empty or generic -- so a stale-worker `AttributeError: module ... has no
 * attribute 'export_rate_master_csv'` reached the screen as the entirely uninformative "There was an
 * error.", and the cause had to be dug out of the network tab. A download either produces a file or
 * explains itself; "there was an error" does neither.
 *
 * Frappe puts the useful text in `_server_messages` (a JSON array of JSON strings) or `exception`,
 * NOT in `message` -- the same shape the pricing module already parses on its save path. Order is
 * most-specific first, and the raw `exception` keeps its class prefix stripped so the sentence reads
 * as a sentence.
 *
 * PURE, so it is unit-testable without a server or a DOM.
 */
export function downloadErrorMessage(err: unknown): string {
  const e = (err ?? {}) as {
    message?: string;
    exception?: string;
    _server_messages?: string;
  };

  // 1. _server_messages -- what frappe.throw() put there, i.e. our own wording.
  if (typeof e._server_messages === "string" && e._server_messages) {
    try {
      const parsed: unknown = JSON.parse(e._server_messages);
      if (Array.isArray(parsed) && parsed.length) {
        const texts = parsed
          .map((entry) => {
            if (typeof entry !== "string") return "";
            try {
              const inner = JSON.parse(entry) as { message?: string };
              return typeof inner?.message === "string" ? inner.message : entry;
            } catch {
              return entry; // a plain string entry is already the message
            }
          })
          .filter(Boolean);
        if (texts.length) return texts.join(" ");
      }
    } catch {
      /* fall through to the next source rather than masking it */
    }
  }

  // 2. exception -- "frappe.exceptions.ValidationError: <text>"; keep only the text.
  if (typeof e.exception === "string" && e.exception.trim()) {
    const stripped = e.exception.replace(/^[\w.]*(?:Error|Exception):\s*/, "").trim();
    if (stripped) return stripped;
  }

  // 3. whatever message there is.
  if (typeof e.message === "string" && e.message.trim()) return e.message.trim();

  return "Download failed.";
}
