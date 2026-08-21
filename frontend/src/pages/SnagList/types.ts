/**
 * Snag List — the SHARED contract between the import wizard, the tracking tab and
 * the backend (`nirmaan_stack/api/snags/`).
 *
 * This file is the single source of truth for the wire shapes. Backend endpoint
 * payloads MUST match these types exactly. Do not redeclare any of these shapes
 * inside a component — import them from here (ADR-0010 F2: one typed accessor).
 *
 * Glossary for every term used here: root `CONTEXT.md` § Snag tracking.
 * Design of record: `frontend/.claude/plans/snag-list-plan.md`.
 */

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

/** The four Snag Statuses. Order is display order. `Pending` is the import default. */
export const SNAG_STATUSES = ["Pending", "WIP", "Completed", "Not Applicable"] as const;
export type SnagStatus = (typeof SNAG_STATUSES)[number];

/** Which columns an import maps. Values are Excel column LETTERS ("B", "C", ...). */
export interface SnagColumnMapping {
  area: string | null;
  category: string | null;
  /** The only mapping that is REQUIRED — row detection keys on it. */
  description: string;
  /** An Excel column LETTER. Its text lands in `ProjectSnag.remark` (singular — ADR-0018). */
  remarks: string | null;
}

/** Why the parser declined to read a row as a Snag. Never widened silently. */
export type SkipReason =
  | "blank"
  | "repeated_header"
  | "summary_block"
  | "no_description"
  /** At or above the header row the user declared. Only reachable once a header row is resolved. */
  | "above_header";

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  blank: "Blank row",
  repeated_header: "Repeated header row",
  summary_block: "Summary / tally block",
  no_description: "No description",
  above_header: "Above the header row",
};

// ---------------------------------------------------------------------------
// Doctype rows (as read back from Frappe)
// ---------------------------------------------------------------------------

export interface ProjectSnag {
  name: string;
  project: string;
  batch: string | null;
  area: string;
  category: string;
  description: string;
  status: SnagStatus;
  /**
   * THE one free-text field. Arrives holding the imported text and is overwritten by whoever
   * next changes the Snag's Status. SINGULAR on purpose — `SnagColumnMapping.remarks` (plural)
   * is an Excel COLUMN LETTER, and the two sit a few lines apart in the parser. See ADR-0018.
   */
  remark: string | null;
  /**
   * The Excel row this Snag came from. A Frappe `Int`, so an unset one reads back as
   * **0, never null** — a Manual Snag has `source_row === 0`. Test falsiness, never `=== null`.
   */
  source_row: number;
  status_changed_by: string | null;
  status_changed_on: string | null;
  creation: string;
  modified: string;
}

export interface ProjectSnagBatch {
  name: string;
  project: string;
  batch_name: string;
  source_sheet: string | null;
  source_file: string | null;
  uploaded_by: string | null;
  uploaded_on: string | null;
  snag_count: number;
  /** JSON string of the SnagColumnMapping used at import. Audit only. */
  column_mapping: string | null;
}

// ---------------------------------------------------------------------------
// Endpoint: inspect_workbook  (step 1 — upload)
// POST multipart: file, project
// ---------------------------------------------------------------------------

export interface WorkbookColumn {
  /** Excel column letter. */
  letter: string;
  /** Header cell text at the guessed header row; "" when that cell is blank. */
  label: string;
}

export interface WorkbookSheet {
  name: string;
  is_empty: boolean;
  row_count: number;
  /** 1-based Excel row the parser believes is the header. null when it cannot tell. */
  header_row: number | null;
  columns: WorkbookColumn[];
  /** Auto-guess from header text. The user confirms or overrides it. */
  mapping_guess: SnagColumnMapping | null;
}

export interface InspectWorkbookResponse {
  /** Frappe File url — passed back to every later call so the file is read once. */
  file_url: string;
  file_name: string;
  sheets: WorkbookSheet[];
}

// ---------------------------------------------------------------------------
// Endpoint: parse_preview  (step 2 — one call per ticked sheet, on mapping change)
// POST: { project, file_url, sheet_name, mapping }
// Writes NOTHING.
// ---------------------------------------------------------------------------

export interface ParsedSnagRow {
  /** 1-based Excel row. The stable identity of a preview row, and the tick key. */
  source_row: number;
  area: string;
  category: string;
  description: string;
  /** From the mapped remarks COLUMN. Lands in `ProjectSnag.remark`. */
  remark: string;
  /** True when this row matches an existing Snag in the project (area + description). */
  is_duplicate: boolean;
  /**
   * `null` = the parser accepted this row (ticked by default).
   * Non-null = WHY it was skipped. The row still appears in the ONE merged preview table,
   * unticked, showing this reason — that is what makes a parser mistake recoverable.
   */
  skipped_reason: SkipReason | null;
  /**
   * `false` = this row can NEVER become a Snag (no description — the one required field), so it
   * renders greyed and un-tickable. Offering a tick that the import must then refuse is the exact
   * silent-drop shape this contract exists to prevent.
   */
  tickable: boolean;
  /**
   * First non-empty cell on the row, truncated. The only thing worth showing for a skipped row
   * whose MAPPED cells are all empty (a blank or summary-block row). "" for a normal row.
   */
  preview_text: string;
}

export interface ParsePreviewResponse {
  sheet_name: string;
  /**
   * The header row the parse ACTUALLY used — the caller's override, or the auto-guess when it sent
   * none. Rows at or above it are excluded from the data region.
   */
  header_row: number | null;
  /**
   * Columns RECOMPUTED for that header row. Labels are literally that row's cells, so an override
   * changes them — the mapping selects must re-render from THIS list, not the one `inspect_workbook`
   * returned. Carrying them here is why no second "re-inspect" endpoint is needed.
   */
  columns: WorkbookColumn[];
  /** Re-guessed against the recomputed columns. The client RESETS the mapping to this on override. */
  mapping_guess: SnagColumnMapping | null;
  /** EVERY row — accepted and skipped, in Excel row order. One table, one array. */
  rows: ParsedSnagRow[];
  accepted_count: number;
  skipped_count: number;
  /** Distinct values over ACCEPTED rows only — surfaces typos before ingest. */
  distinct_areas: Array<{ value: string; count: number }>;
  distinct_categories: Array<{ value: string; count: number }>;
  duplicate_count: number;
}

// ---------------------------------------------------------------------------
// Endpoint: ingest_batches  (step 3 — confirm)
// POST: { project, file_url, file_name, batches: SheetIngestRequest[] }
// One Batch per entry. Per-sheet failure isolation.
// ---------------------------------------------------------------------------

export interface SheetIngestRequest {
  sheet_name: string;
  batch_name: string;
  mapping: SnagColumnMapping;
  /** The header row the user settled on. MUST match what the preview was computed with. */
  header_row: number | null;
  /** source_row numbers the user left TICKED. The server re-parses and filters to these. */
  accepted_rows: number[];
}

export interface SheetIngestResult {
  sheet_name: string;
  ok: boolean;
  /** Set when ok. */
  batch?: string;
  batch_name?: string;
  imported?: number;
  /**
   * Ticked rows the import REFUSED because they have no description (the one required field).
   * Always present on an ok result, INCLUDING 0 — a silent drop is the exact defect this counts.
   */
  refused_no_description?: number;
  /** Set when !ok — shown loudly, never swallowed. */
  error?: string;
}

export interface IngestBatchesResponse {
  results: SheetIngestResult[];
  total_imported: number;
  failed_count: number;
}

// ---------------------------------------------------------------------------
// Endpoint: delete_batch / update status
// ---------------------------------------------------------------------------

export interface DeleteBatchPreview {
  batch: string;
  batch_name: string;
  snag_count: number;
  /** How many are no longer Pending — shown in the confirm dialog. */
  worked_count: number;
}

export interface SnagStatsSummary {
  total: number;
  by_status: Record<SnagStatus, number>;
}
