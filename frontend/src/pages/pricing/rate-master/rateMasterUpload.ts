// SLICE 6 -- the upload half of the Rate Master round trip. PURE helpers + the wording, in one
// place, so the surface and its tests share one definition.
//
// ⚠️ THIS IS THE ONLY WRITE PATH INTO THE LIVE CATALOG FROM AN EDITED FILE, so the shape of the
// interaction is the safety feature: UPLOAD -> PREVIEW -> CONFIRM -> APPLY, and the file is NEVER
// applied on arrival. The server owns every decision -- the client's job is to make the decision
// legible before someone confirms it.
//
// THE EXPANSION RULE (owner-ruled) lives on the server as `change.major`, and this module only
// GROUPS by it. Expanded by default: every new item, and any rate move of 10% or more IN EITHER
// DIRECTION. ₹26,100 for ₹2,610 is invisible in a count, and ₹261 for ₹2,610 quotes catastrophically
// low -- so it is the ABSOLUTE move that matters, not the sign. Everything else collapses behind a
// count. ⚠️ COLLAPSED IS NOT HIDDEN: the collapsing is about attention, not access, so the collapsed
// rows ride the same payload and open with one click.

/** One column that moved on one row. `pct` is null where a percentage is meaningless. */
export interface UploadField {
  space: "fixed" | "attribute" | "rate";
  column: string;
  old: string;
  new: string;
  pct: number | null;
  /**
   * The server's per-field verdict (F-21). RATE-space fields only -- a percentage, and therefore
   * this verdict, is meaningless on a `kind` rename or an attribute edit, so it is absent there.
   * The dialog RENDERS this; it must never recompute the threshold from `pct`.
   */
  major?: boolean;
}

/**
 * SLICE 1c -- what the SPEC READER made of a new or changed row of an opted-in category: the derived
 * attributes it read, or the exact reason it could not. Server-computed (`csv_importer.build_plan`);
 * absent on every other row. The dialog renders it, never recomputes it.
 */
export interface UploadSpec {
  status: "ok" | "not_understood" | "confirmed";
  reason: string | null;
  read: Record<string, string | number>;
  /** SLICE 1d: the text the verdict is about -- BOTH halves, even when only one changed. */
  text?: { item_name: string; item_detail: string };
  /**
   * SLICE 1d: when the exact read refused -- the server's best match (deterministic rules), or null
   * with `no_suggestion_reason`. `decision` echoes what the client sent on an apply; absent on a preview.
   */
  suggestion?: { attributes: Record<string, string | number>; label: string; notes: string[]; fingerprint: string } | null;
  no_suggestion_reason?: string | null;
  decision?: "accept" | "reject" | null;
}

export interface UploadChange {
  row: number;
  kind: "add" | "update";
  item_uid: string | null;
  name: string | null;
  label: string;
  major: boolean;
  fields: UploadField[];
  spec?: UploadSpec;
}

export interface UploadError {
  row: number;
  column: string;
  message: string;
}

export interface UploadCounts {
  rates_changed: number;
  items_added: number;
  unchanged: number;
  other_changed: number;
  errors: number;
}

export interface UploadPlan {
  discipline: string;
  mode: "category" | "all";
  /** SLICE 1e: which format the server detected (by content, never by name). */
  format?: RateFileFormat;
  encoding: string;
  row_count: number;
  /** SLICE 1e: `ignored` names the system columns an OLD file still carried -- read past, never applied. */
  columns: { attributes: string[]; rates: string[]; fixed: string[]; ignored?: string[] };
  counts: UploadCounts;
  errors: UploadError[];
  changes: UploadChange[];
  digest: string;
}

export interface UploadResult {
  applied: number;
  items_added: number;
  items_replaced: number;
  snapshot: string | null;
  snapshot_version: number | null;
  batch: string | null;
}

/**
 * A File -> the base64 the endpoints take.
 *
 * ⚠️ BASE64, NOT TEXT, and the reason is the whole encoding story: reading the file as text forces
 * a decode in the browser, which would silently pick UTF-8 and mangle a cp1252 file Excel produced
 * when the user chose plain "CSV" rather than "CSV UTF-8". Sending the BYTES lets the server report
 * which encoding it actually read -- surfacing the problem instead of guessing at it.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      // readAsDataURL yields `data:<type>;base64,<payload>` -- take the payload.
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** The changes shown open, and the ones folded behind a count. PURE. */
export function splitChanges(changes: UploadChange[]): {
  expanded: UploadChange[];
  collapsed: UploadChange[];
} {
  const expanded: UploadChange[] = [];
  const collapsed: UploadChange[] = [];
  for (const c of changes) (c.major ? expanded : collapsed).push(c);
  return { expanded, collapsed };
}

/**
 * The headline chips, in the owner's order: rates changed - items added - rows unchanged - errors.
 *
 * ⚠️ `other changes` is a FIFTH chip and it appears ONLY when it is non-zero. A row that moved in
 * some way OTHER than a rate (an attribute Excel rewrote, a renamed kind) is none of the four named
 * numbers, and folding it into one of them would mislabel it -- an honest extra count beats a wrong
 * one. It stays out of sight on the ordinary rate-edit upload, which is every upload that has only
 * the four.
 */
export function headlineCounts(counts: UploadCounts): Array<{
  key: string;
  label: string;
  value: number;
  tone: "neutral" | "warn" | "error";
}> {
  const out: Array<{ key: string; label: string; value: number; tone: "neutral" | "warn" | "error" }> = [
    { key: "rates_changed", label: "rates changed", value: counts.rates_changed, tone: "warn" },
    { key: "items_added", label: "items added", value: counts.items_added, tone: "warn" },
  ];
  if (counts.other_changed > 0) {
    out.push({ key: "other_changed", label: "other changes", value: counts.other_changed, tone: "warn" });
  }
  out.push({ key: "unchanged", label: "rows unchanged", value: counts.unchanged, tone: "neutral" });
  out.push({ key: "errors", label: "errors", value: counts.errors, tone: "error" });
  return out;
}

/** Nothing to do -- a valid file that asks for no change at all. */
export function planIsNoOp(plan: UploadPlan): boolean {
  return plan.errors.length === 0 && plan.changes.length === 0;
}

/** Whether Apply may be offered at all. Errors block absolutely -- the apply is all-or-nothing. */
export function canApply(plan: UploadPlan | null): boolean {
  return !!plan && plan.errors.length === 0 && plan.changes.length > 0;
}

/** `+12.4%` / `-10%` / "" when a percentage does not exist for this move. PURE. */
export function formatPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "";
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/** How a cell reads when it is empty -- an em-dash, so "cleared" never looks like a rendering bug. */
export function cellText(value: string): string {
  return value === "" ? "—" : value;
}

/**
 * A one-line summary of what a change does, for the collapsed list. Names the columns rather than
 * the values: the row is one click from showing both.
 */
export function changeSummary(change: UploadChange): string {
  if (change.kind === "add") return "new item";
  const cols = change.fields.map((f) => f.column);
  if (cols.length <= 3) return cols.join(", ");
  return `${cols.slice(0, 3).join(", ")} +${cols.length - 3} more`;
}

/**
 * THE WORDING, in one place -- the same discipline `DOWNLOAD_COPY` follows, so the two halves of the
 * round trip cannot drift apart.
 */
/**
 * SLICE 1e -- the two rate-file formats (owner X-a): EXCEL BY DEFAULT, CSV as the second option. The
 * server builds the same columns and values either way; Excel is the default because a CSV carries no
 * cell types and Excel rewrote "1:6" as a time on the owner's own upload. The upload accepts both,
 * detected by CONTENT on the server -- the accept list below only steers the file picker.
 */
export type RateFileFormat = "xlsx" | "csv";
export const DEFAULT_RATE_FILE_FORMAT: RateFileFormat = "xlsx";
export const RATE_FILE_FORMATS: ReadonlyArray<{ id: RateFileFormat; label: string }> = [
  { id: "xlsx", label: "Excel" },
  { id: "csv", label: "CSV" },
];
export const UPLOAD_ACCEPT =
  ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
/** The browser-side fallback name when the server sends none; the server's `filename` wins. */
export function rateFileFallbackName(categoryId: string | null, fmt: RateFileFormat): string {
  return `rate_master_${categoryId ?? "all"}.${fmt}`;
}
export const FORMAT_COPY = {
  label: "Format",
  hint: "Excel keeps text such as 1:6 exactly as typed; CSV is the plain-text option.",
} as const;
/**
 * The cp1252 warning is about a CSV DECODE -- a workbook is not decoded, so it never applies to one.
 * Found live at the 1e cert: the first .xlsx preview showed "read as xlsx, not UTF-8".
 */
export function showEncodingWarning(plan: Pick<UploadPlan, "encoding" | "format">): boolean {
  return plan.format !== "xlsx" && plan.encoding !== "utf-8";
}

export const UPLOAD_COPY = {
  group: "Upload an edited file",
  hint: "Choose the Excel or CSV file you edited. Nothing is applied until you confirm.",
  choose: "Choose file",
  previewing: "Reading...",
  applying: "Applying...",
  apply: "Confirm and apply",
  cancel: "Cancel",
  title: "Review this upload",
  /** The one rule a user needs in order to add a row -- repeated here, beside the upload. */
  newRowHint: "A row with a blank item_uid is added as a new item.",
  /** ⚠️ THE SAFETY PROPERTY, said out loud. It is the reason a partial file is safe to upload. */
  absentHint: "Items that are not in this file are left untouched.",
  expandedHint:
    "Shown in full: every new item, every rate change of 10% or more in either direction, and every row " +
    "the spec reader must ask about or flags.",
  collapsedLabel: (n: number) => `${n} smaller change${n === 1 ? "" : "s"}`,
  noOp: "This file matches the catalog exactly. There is nothing to apply.",
  errorsTitle: (n: number) => `${n} problem${n === 1 ? "" : "s"} — nothing will be applied`,
  errorsHint:
    "The upload is all-or-nothing, so every problem has to be fixed before any of it can land.",
  /** ⚠️ Said plainly, because it is the reason the confirm is safe to click. */
  snapshotNote: "A snapshot of the current catalog is saved first, so this can be rolled back.",
  encodingWarn: (enc: string) =>
    `This file was read as ${enc}, not UTF-8. Accented characters and special dashes may already ` +
    `have been changed by the spreadsheet. Check them below before applying.`,
} as const;
