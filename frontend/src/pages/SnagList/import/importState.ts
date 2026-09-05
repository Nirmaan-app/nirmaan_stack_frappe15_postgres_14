/**
 * Snag import wizard -- PURE state helpers.
 *
 * Everything in here is a plain in/out function with no React and no network, so the
 * wizard's rules (batch-name default, mapping validity, the ticked-row set, the ingest
 * payload) are testable without a DOM (frontend/CLAUDE.md: there is no DOM test env).
 *
 * `TabState` is LOCAL to this folder -- it is wizard-editing state, not a wire shape, so
 * it deliberately does NOT live in `src/pages/SnagList/types.ts` (which is the shared
 * frontend<->backend contract and is read-only to this folder).
 */

import type {
  ParsePreviewResponse,
  SheetIngestRequest,
  SnagColumnMapping,
  WorkbookColumn,
  WorkbookSheet,
} from "../types";

/**
 * Radix `SelectItem` forbids an empty-string value (it reserves "" for clearing), so an
 * unmapped column is carried through the control as this sentinel and converted back to
 * `null` (or `""` for the required Description) at the edge. It NEVER reaches the wire.
 */
export const MAPPING_NONE = "__none__";

/** Debounce before a mapping edit re-fetches that tab's preview. */
export const PREVIEW_DEBOUNCE_MS = 300;

export const ACCEPTED_EXTS = [".xlsx", ".xlsm"] as const;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Per-sheet wizard state. One of these per TICKED sheet, owned by the dialog. */
export interface TabState {
  /** Editable, pre-filled `<file name without extension> — <sheet name>`. */
  batchName: string;
  mapping: SnagColumnMapping;
  /**
   * The header row this tab is parsing with. Seeded from the inspect guess, then editable
   * (R2 change 2). It is part of `mappingSignature`, so editing it invalidates the preview
   * exactly like a mapping edit does -- see that function's note.
   */
  headerRow: number | null;
  /**
   * The columns the mapping selects render from. Seeded from `inspect_workbook`, then
   * OVERWRITTEN by every `get_sheet_columns` response (R3.1) -- and, harmlessly, by every
   * `parse_preview` response, whose `columns` are recomputed for the same header row.
   * `inspect.sheets[i].columns` goes stale the moment the user overrides the header row, so
   * nothing may read it after that point.
   *
   * ⚠️ `get_sheet_columns` is the AUTHORITATIVE source, not `parse_preview`. `parse_preview`
   * hard-refuses without a mapped Description, so it can never be the call that hands you the
   * columns you need IN ORDER to pick one -- that circularity was the R3.1 deadlock.
   */
  columns: WorkbookColumn[];
  /** A `get_sheet_columns` call is in flight for the current header row. */
  columnsLoading: boolean;
  /** Why the columns re-read failed. The previous columns are kept on screen. */
  columnsError: string | null;
  preview: ParsePreviewResponse | null;
  previewLoading: boolean;
  previewError: string | null;
  /**
   * True when the last header-row override RESET the mapping to a fresh auto-guess
   * (owner decision Q8a). Rendered as a brief note -- a silent reset reads as a bug.
   * Cleared as soon as the user edits the mapping by hand.
   */
  mappingReguessed: boolean;
  /**
   * True when the last header-row override found NO auto-guess and the previous mapping was
   * therefore KEPT (R3, see `SnagImportDialog.fetchColumns`). Emptying the mapping in this
   * case is what wedged the deadlock's path (B), and it costs the user their picks for no
   * gain: a stale letter is already caught by `unknownMappedRoles` + the per-field error.
   * Rendered as a note, and cleared as soon as the user edits the mapping by hand.
   */
  mappingKeptNoGuess: boolean;
  /**
   * source_row numbers the user has left TICKED. Spans BOTH the accepted rows (ticked by
   * default) and any re-ticked skipped rows -- one set, because ingest takes one list.
   */
  ticked: ReadonlySet<number>;
}

// ---------------------------------------------------------------------------
// File / naming
// ---------------------------------------------------------------------------

export function fileBaseName(fileName: string): string {
  const cut = fileName.lastIndexOf(".");
  return cut > 0 ? fileName.slice(0, cut) : fileName;
}

/** Q23: auto-fill so the lazy path still produces a meaningful batch name. */
export function defaultBatchName(fileName: string, sheetName: string): string {
  return `${fileBaseName(fileName)} — ${sheetName.trim()}`;
}

export function fileExtensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** null = accepted. Otherwise the reason the file is refused, ready to render. */
export function validateUploadFile(file: { name: string; size: number }): string | null {
  const ext = fileExtensionOf(file.name);
  if (!(ACCEPTED_EXTS as readonly string[]).includes(ext)) {
    return `"${ext || file.name}" is not supported. Upload an .xlsx or .xlsm file.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `File is too large (${formatBytes(file.size)}). Maximum allowed size is 25 MB.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

/**
 * Longest header text a dropdown option shows. The header row is user-declarable, so a DATA
 * row can be declared as the header -- and then a "label" is a whole sentence ("Detector cables
 * are hanging and not properly laid..."), which blows the dropdown out and hides the one part
 * that identifies the column. Full text still reaches the user through the `title` (R3 change 2).
 */
export const COLUMN_LABEL_MAX_CHARS = 20;

/**
 * Truncate to `max` INCLUDING the ellipsis, so the rendered string never exceeds `max`.
 * Trailing whitespace is trimmed before the ellipsis so "word …" never renders.
 */
export function truncateColumnLabel(
  text: string,
  max: number = COLUMN_LABEL_MAX_CHARS,
): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * "B — Area / Location", or a bare letter when that header cell is blank.
 *
 * The LETTER PREFIX is never truncated -- it is the only part that identifies the column, and
 * it is what the user matches against the sheet. Only the header text is clipped; pair this
 * with `columnOptionTitle` so the full text is one hover away.
 */
export function columnOptionLabel(col: WorkbookColumn): string {
  const label = truncateColumnLabel(col.label);
  return label ? `${col.letter} — ${label}` : `${col.letter} — (no header)`;
}

/** The UNtruncated form of `columnOptionLabel`, for a `title` / tooltip. */
export function columnOptionTitle(col: WorkbookColumn): string {
  const label = col.label.trim();
  return label ? `${col.letter} — ${label}` : `${col.letter} — (no header)`;
}

export const EMPTY_MAPPING: SnagColumnMapping = {
  serial: null,
  area: null,
  category: null,
  description: "",
  remarks: null,
};

export function initialMapping(guess: SnagColumnMapping | null): SnagColumnMapping {
  if (!guess) return { ...EMPTY_MAPPING };
  return {
    serial: guess.serial ?? null,
    area: guess.area ?? null,
    category: guess.category ?? null,
    description: guess.description ?? "",
    remarks: guess.remarks ?? null,
  };
}

/** The five mapping roles, in the order the fields render (sheet order: S.No first). */
export const MAPPING_ROLES = ["serial", "area", "category", "description", "remarks"] as const;
export type MappingRole = (typeof MAPPING_ROLES)[number];

export function isKnownColumn(
  columns: readonly WorkbookColumn[] | undefined,
  letter: string | null | undefined,
): boolean {
  if (!letter) return false;
  return (columns ?? []).some((c) => c.letter === letter);
}

/**
 * Roles mapped to a column LETTER that is not in `columns`.
 *
 * This is reachable the moment the header row is overridden: the recomputed column list can
 * be shorter (or the sheet re-read), leaving a stored letter with no matching `SelectItem`.
 * Radix then renders the PLACEHOLDER for that unmatched value, so the screen reads
 * "(not mapped)" while the wire still carries a real letter -- a silent mismatch between what
 * the user approved and what the server parses. Every consumer treats these as errors.
 */
export function unknownMappedRoles(
  mapping: SnagColumnMapping | undefined,
  columns: readonly WorkbookColumn[] | undefined,
): MappingRole[] {
  if (!mapping) return [];
  return MAPPING_ROLES.filter((role) => {
    const letter = mapping[role];
    if (!letter) return false; // unmapped is not "unknown"
    return !isKnownColumn(columns, letter);
  });
}

/**
 * Description is the only REQUIRED mapping -- row detection keys on it -- and it must name a
 * column that actually EXISTS in the sheet as currently read (see `unknownMappedRoles`).
 */
export function isMappingValid(
  mapping: SnagColumnMapping | undefined,
  columns: readonly WorkbookColumn[] | undefined,
): boolean {
  if (!mapping) return false;
  const description = mapping.description.trim();
  if (description === "") return false;
  return isKnownColumn(columns, description);
}

/**
 * Stable identity of a PARSE REQUEST. Drives the debounced re-fetch: a preview is stale
 * exactly when its sheet's signature no longer matches the one the request was issued with.
 *
 * `headerRow` is part of it and MUST stay part of it. It is the ONLY preview-invalidation key
 * in the wizard, so a header-row override that did not change the signature would (a) never
 * refresh the preview and (b) let the in-flight guard in `SnagImportDialog` accept a response
 * computed for the OLD header row as though it answered the new one.
 */
export function mappingSignature(
  mapping: SnagColumnMapping | undefined,
  headerRow: number | null | undefined,
): string {
  if (!mapping) return "";
  return [
    // `serial` belongs here like every other role: the preview renders the S.No column
    // straight off the mapping, so a signature blind to it would leave the old column's
    // values on screen under a new mapping.
    mapping.serial ?? "",
    mapping.area ?? "",
    mapping.category ?? "",
    mapping.description ?? "",
    mapping.remarks ?? "",
    headerRow == null ? "" : String(headerRow),
  ].join("|");
}

/**
 * Stable identity of a COLUMNS request (`get_sheet_columns`). The header row is its only
 * input -- deliberately NOT the mapping, which is the whole point of that endpoint (R3.1).
 *
 * It is the staleness key for that fetch: a response is accepted only while it still matches
 * the tab's current header row, so a slow reply for row 8 can never overwrite the columns of a
 * newer row 12.
 */
export function headerRowSignature(headerRow: number | null | undefined): string {
  return headerRow == null ? "" : String(headerRow);
}

/**
 * The header-row input's text -> the stored value. Blank / non-numeric / non-positive all
 * mean "no header row declared" (null), which is what the auto-guess also returns when it
 * cannot tell. Excel rows are 1-based, so 0 is never meaningful.
 */
export function parseHeaderRowInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/** Stored header row -> the input's text. */
export function headerRowInputValue(headerRow: number | null): string {
  return headerRow == null ? "" : String(headerRow);
}

/** Select value -> stored value for the three optional roles. */
export function selectToOptional(value: string): string | null {
  return value === MAPPING_NONE ? null : value;
}

/** Select value -> stored value for the required Description role. */
export function selectToRequired(value: string): string {
  return value === MAPPING_NONE ? "" : value;
}

/** Stored value -> Select value (Radix cannot hold ""). */
export function optionalToSelect(value: string | null): string {
  return value ? value : MAPPING_NONE;
}

// ---------------------------------------------------------------------------
// Sheet picking
// ---------------------------------------------------------------------------

/** Pre-tick every non-empty sheet (a header-less sheet is tickable -- it just warns). */
export function initialSheetSelection(sheets: WorkbookSheet[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const s of sheets) out[s.name] = !s.is_empty;
  return out;
}

export function tickedSheetNames(
  sheets: WorkbookSheet[],
  selection: Record<string, boolean>,
): string[] {
  return sheets.filter((s) => !s.is_empty && selection[s.name]).map((s) => s.name);
}

// ---------------------------------------------------------------------------
// Tab state
// ---------------------------------------------------------------------------

export function createTabState(sheet: WorkbookSheet, fileName: string): TabState {
  return {
    batchName: defaultBatchName(fileName, sheet.name),
    mapping: initialMapping(sheet.mapping_guess),
    headerRow: sheet.header_row,
    columns: sheet.columns,
    columnsLoading: false,
    columnsError: null,
    preview: null,
    previewLoading: false,
    previewError: null,
    mappingReguessed: false,
    mappingKeptNoGuess: false,
    ticked: new Set<number>(),
  };
}

/**
 * Create state for newly ticked sheets and DROP state for sheets no longer ticked, while
 * preserving everything a still-ticked sheet already had (batch name, mapping, ticks).
 * Called from the Continue handler -- a user action, never an effect.
 */
export function reconcileTabStates(
  previous: Record<string, TabState>,
  sheets: WorkbookSheet[],
  ticked: string[],
  fileName: string,
): Record<string, TabState> {
  const byName = new Map(sheets.map((s) => [s.name, s]));
  const next: Record<string, TabState> = {};
  for (const name of ticked) {
    const existing = previous[name];
    if (existing) {
      next[name] = existing;
      continue;
    }
    const sheet = byName.get(name);
    if (sheet) next[name] = createTabState(sheet, fileName);
  }
  return next;
}

/**
 * A fresh preview reseeds the ticks: rows the parser ACCEPTED (`skipped_reason === null`)
 * ON, everything it skipped OFF.
 *
 * ⚠️ ADR-0019: `tickable` is deliberately NOT consulted. It used to be checked here
 * belt-and-braces because the server refused a description-less row; nothing is refused any
 * more. It still cannot change this set in practice (such a row is skipped `no_description`,
 * so it is off either way) -- but reading it here would re-establish the flag as a gate, which
 * is exactly what the ADR removes. A skipped row still defaults to UNTICKED; only the user
 * turns it on.
 */
export function seedTicksFromPreview(preview: ParsePreviewResponse): Set<number> {
  const out = new Set<number>();
  for (const r of preview.rows) {
    if (r.skipped_reason === null) out.add(r.source_row);
  }
  return out;
}

/**
 * Every row in the merged table, in Excel order.
 *
 * ⚠️ ADR-0019: this is now the ONE row list. There is no `tickableRowNums` any more -- "Select
 * all", the ticked numerator and the "N of M" denominator all walk THIS list, because a human
 * tick is authoritative and every row can take one.
 */
export function allRowNums(preview: ParsePreviewResponse | null): number[] {
  return preview ? preview.rows.map((r) => r.source_row) : [];
}

/**
 * How many rows have no description -- INFORMATION, never a gate (ADR-0019). Such a row still
 * imports when ticked, with its description falling back to `preview_text` (or left blank).
 */
export function noDescriptionRowCount(preview: ParsePreviewResponse | null): number {
  return preview ? preview.rows.filter((r) => !r.tickable).length : 0;
}

export function toggleTick(current: ReadonlySet<number>, row: number): Set<number> {
  const next = new Set(current);
  if (next.has(row)) next.delete(row);
  else next.add(row);
  return next;
}

/** Add or remove a whole block of rows (the one Select all / Select none pair). */
export function setTicks(
  current: ReadonlySet<number>,
  rows: number[],
  ticked: boolean,
): Set<number> {
  const next = new Set(current);
  for (const r of rows) {
    if (ticked) next.add(r);
    else next.delete(r);
  }
  return next;
}

/** How many of `rows` are currently ticked -- drives the tri-state header checkbox. */
export function countTicked(current: ReadonlySet<number>, rows: number[]): number {
  let n = 0;
  for (const r of rows) if (current.has(r)) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

export function buildIngestBatches(
  ticked: string[],
  states: Record<string, TabState>,
  fileName: string,
): SheetIngestRequest[] {
  return ticked.map((name) => {
    const st = states[name];
    return {
      sheet_name: name,
      batch_name: st.batchName.trim() || defaultBatchName(fileName, name),
      mapping: st.mapping,
      // The header row the PREVIEW was computed with, not the input's live value: the server
      // re-parses, and a different header row would parse a different region than the one the
      // user just approved on screen. They only diverge for the debounce window.
      header_row: st.preview ? st.preview.header_row : st.headerRow,
      accepted_rows: [...st.ticked].sort((a, b) => a - b),
    };
  });
}

export interface ConfirmGate {
  ok: boolean;
  /** Rendered inline above the footer when !ok. Empty when ok. */
  message: string;
  totalRows: number;
}

/**
 * A sheet that yields nothing is NOT a block (plan §4: per-sheet failure isolation -- it
 * reports its reason and the others still import). An unmapped Description IS a block, and
 * so is a run with no ticked row anywhere: there would be nothing to send.
 */
export function evaluateConfirmGate(
  ticked: string[],
  states: Record<string, TabState>,
): ConfirmGate {
  const unmapped = ticked.filter(
    (n) => !isMappingValid(states[n]?.mapping, states[n]?.columns),
  );
  let totalRows = 0;
  for (const n of ticked) totalRows += states[n]?.ticked.size ?? 0;

  if (ticked.length === 0) {
    return { ok: false, message: "No sheets selected.", totalRows: 0 };
  }
  if (unmapped.length > 0) {
    return {
      ok: false,
      message:
        unmapped.length === 1
          ? `"${unmapped[0]}" has no valid Description column mapped. Description is required.`
          : `${unmapped.length} sheets have no valid Description column mapped: ${unmapped
              .map((n) => `"${n}"`)
              .join(", ")}.`,
      totalRows,
    };
  }
  // A letter left over from an earlier header row. Blocked, not tolerated: the select shows
  // "(not mapped)" for it while the wire would carry the letter.
  const stale = ticked.filter(
    (n) => unknownMappedRoles(states[n]?.mapping, states[n]?.columns).length > 0,
  );
  if (stale.length > 0) {
    return {
      ok: false,
      message:
        stale.length === 1
          ? `"${stale[0]}" maps a column that is not in this sheet. Re-check the column mapping.`
          : `${stale.length} sheets map a column that is not in the sheet: ${stale
              .map((n) => `"${n}"`)
              .join(", ")}.`,
      totalRows,
    };
  }
  if (totalRows === 0) {
    return {
      ok: false,
      message: "Nothing to import — no rows are ticked on any sheet.",
      totalRows: 0,
    };
  }
  return { ok: true, message: "", totalRows };
}

/** Best-effort message out of an unknown throw. Errors render inline, never as a toast. */
export function errorText(err: unknown, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  const anyErr = err as { message?: string; exception?: string; _server_messages?: string };
  if (anyErr.exception) return anyErr.exception;
  if (anyErr.message) return anyErr.message;
  return fallback;
}
