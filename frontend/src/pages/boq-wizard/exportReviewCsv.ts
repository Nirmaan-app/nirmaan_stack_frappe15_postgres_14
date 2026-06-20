/**
 * exportReviewCsv -- wizard-local CSV writer for the BoQ review screen (Slice D2).
 *
 * Builds a per-sheet CSV of the review data (parsed values + human corrections +
 * provenance) and triggers a browser download. FRONTEND-ONLY -- no backend call.
 *
 * WHY a wizard-local writer (not src/utils/exportToCsv.ts):
 *   The shared exportToCsv is TanStack-Table-coupled (its signature takes
 *   ColumnDef[] and reads column meta) with 15 callers; the review screen renders
 *   a hand-built <table> driven by column_descriptors, not a TanStack table, so
 *   the shared util is the wrong shape. Recon 2026-06-12 + owner decision: build a
 *   local writer instead, leave the shared util (and its 8 baseline tsc errors)
 *   untouched.
 *
 * Design decisions (owner-locked):
 *   - Per-area values get ONE COLUMN PER AREA PER ROLE (matching the tree's
 *     descriptor columns exactly) -- never a JSON dict in a cell.
 *   - Numbers are written RAW (String(val)) -- the display formatter's thousands
 *     separators would break Excel's numeric parsing.
 *   - The export is STATUS-INDEPENDENT (a frozen/"Parsed Check Done" sheet exports
 *     too -- that is the prime use) and VIEW-INDEPENDENT (filters / collapse /
 *     search state never affect it -- it is the sheet's data, not the current view).
 *   - REUSES ReviewTree's resolveDescriptorValue / computeDepths / CLS_LABELS /
 *     FIXED_ROLE_DEDUPE and boqTypes' ROLE_LABELS -- the tree and the CSV cannot drift.
 *
 * sheet_name is VERBATIM (trailing spaces intact, #152) in the CSV body; only the
 * download FILENAME is sanitized.
 */
import { unparse } from "papaparse";
import { format as formatDateFn } from "date-fns";
import type { ReviewRow, ColumnDescriptor } from "./boqTypes";
import { ROLE_LABELS } from "./boqTypes";
import {
  resolveDescriptorValue,
  computeDepths,
  CLS_LABELS,
} from "./reviewRender";
import { FIXED_ROLE_DEDUPE } from "./ReviewTree";

export interface BuildAndDownloadReviewCsvArgs {
  /** BOQs docname -- used for the filename only. */
  boqName: string;
  /** Sheet name, VERBATIM (trailing spaces intact). Body uses it as-is; filename sanitizes. */
  sheetName: string;
  /** All review rows for this sheet (the loaded get_review_rows payload). */
  rows: ReviewRow[];
  /** Column descriptors for this sheet (Excel-column order), from get_review_rows. */
  columnDescriptors: ColumnDescriptor[];
}

/** Classification value -> the tree's human-readable label; raw value as fallback. */
function clsLabel(cls: string | null): string {
  if (!cls) return "";
  return CLS_LABELS[cls] ?? cls;
}

/**
 * Descriptor column header, mirroring ReviewTree's header construction VERBATIM
 * (ReviewTree.tsx ~:1169): "{col} -- {ROLE_LABELS[role] ?? role}{ . area}".
 */
function descriptorHeader(d: ColumnDescriptor): string {
  return `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
}

/**
 * append_notes_raw flatten. Verified client-side shape (2026-06-12) is a
 * dict[str, str] -- keys are the source column's header label, values the note
 * text (parser classifier.py). The §8 spec anticipated array/string; we handle
 * all three defensively. Dict -> "key: value" pairs joined " | " (flat, no JSON
 * blob, preserves which column each note came from). null/empty -> "".
 */
function formatAppendNotes(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .filter((x) => x !== null && x !== undefined && String(x) !== "")
      .map((x) => String(x))
      .join(" | ");
  }
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== null && val !== undefined && String(val) !== "")
      .map(([k, val]) => `${k}: ${String(val)}`)
      .join(" | ");
  }
  return String(v);
}

/**
 * Edited predicate -- IDENTICAL to ReviewTree's Status-column rule
 * (edited_at set OR edit_log non-empty). A remark-only / dismissed-only row is
 * NOT edited (those paths never stamp edited_at / edit_log).
 */
function isEditedRow(row: ReviewRow): boolean {
  return (
    row.edited_at !== null ||
    (Array.isArray(row.edit_log) && row.edit_log.length > 0)
  );
}

/** Generic cell coercion: null/undefined -> ""; everything else -> String(). */
function csvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

/**
 * Filename-only sanitizer: trim, replace filesystem-illegal characters and
 * whitespace runs with "_". Never applied to CSV body values.
 *
 * Exported (Slice D2b) for reuse by exportReviewXlsx.ts -- the workbook writer
 * builds its download filename with the SAME rule. (This is the FILENAME
 * sanitizer; the Excel TAB-NAME sanitizer is a separate, stricter helper in
 * exportReviewXlsx.ts -- different rule set: 31-char cap + dedupe.)
 */
export function sanitizeFilename(s: string): string {
  const cleaned = s
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_");
  return cleaned || "sheet";
}

/**
 * A single typed cell. RAW TYPED (Slice D2b): a numeric value stays a JS number
 * (so the xlsx writer lands it as a real Excel number); text stays string; an
 * empty/absent value is null. The CSV writer stringifies each cell via csvCell.
 */
export type SheetCell = string | number | null;

export interface BuildReviewSheetArgs {
  /** Sheet name, VERBATIM (trailing spaces intact, #152) -- the Sheet Name cell. */
  sheetName: string;
  /** All review rows for this sheet (the loaded get_review_rows payload). */
  rows: ReviewRow[];
  /** Column descriptors for this sheet (Excel-column order), from get_review_rows. */
  columnDescriptors: ColumnDescriptor[];
}

/** Build result: the header row + the typed cell matrix (row_index order). */
export interface ReviewSheetData {
  headers: string[];
  cells: SheetCell[][];
}

/**
 * Build the review-sheet header row + typed cell matrix for one sheet (Slice D2b
 * extraction). The SINGLE source of truth for BOTH the CSV writer and the xlsx
 * workbook writer, so the two outputs can never drift in column set, order, or
 * value resolution.
 *
 * CELLS ARE RAW TYPED: numeric descriptor values, the Excel-row number, the
 * parent Excel-row numbers, and the depth stay JS numbers; text stays string;
 * empty -> null. The CSV layer maps every cell through csvCell (so the .csv is
 * BYTE-IDENTICAL to Slice D2 -- csvCell(null)="" and csvCell(n)=String(n) reproduce
 * the prior per-cell strings exactly); the xlsx layer writes numbers as numbers.
 */
export function buildReviewSheet({
  sheetName,
  rows,
  columnDescriptors,
}: BuildReviewSheetArgs): ReviewSheetData {
  // Stable export order: row_index ascending (the tree's underlying order).
  const ordered = [...rows].sort((a, b) => a.row_index - b.row_index);

  // Depth map (reuse the tree's iterative, cycle-safe, effective-parent walk).
  const depths = computeDepths(ordered);

  // row_index -> source_row_number, to resolve parent indices to Excel rows.
  const byIdx = new Map<number, ReviewRow>(ordered.map((r) => [r.row_index, r]));
  // Typed parent Excel-row: the parent's numeric source_row_number, or null for
  // a root/missing parent (-1 sentinel / null / negative). csvCell(null)="" keeps
  // the CSV blank-for-root behaviour byte-identical.
  const parentExcelRow = (parentIdx: number | null | undefined): number | null => {
    if (parentIdx === null || parentIdx === undefined || parentIdx < 0) return null;
    const parent = byIdx.get(parentIdx);
    return parent ? (parent.source_row_number ?? null) : null;
  };

  // Data columns: descriptor-driven, EXCLUDING sl_no/description roles (those are
  // the dedicated Sl.No/Description fixed columns -- same dedupe the tree applies,
  // so no column is duplicated). Excel-column order preserved from the payload.
  const dataDescriptors = columnDescriptors.filter(
    (d) => !FIXED_ROLE_DEDUPE.has(d.role),
  );

  const headers = [
    "Sheet Name",
    "Excel Row",
    "Sl.No",
    "Description",
    "Level",
    "Classification (Original)",
    "Classification (Final)",
    "Parent Excel Row (Original)",
    "Parent Excel Row (Final)",
    ...dataDescriptors.map(descriptorHeader),
    "Row Notes",
    "Append Notes",
    "Remarks",
    "Edited",
    "Edited By",
    "Edited At",
  ];

  // Text -> typed cell: null/undefined -> null; else string as-is (a numeric-looking
  // Sl.No like "1.2" stays text). csvCell(textCell(v)) === the old csvCell(v).
  const textCell = (v: unknown): SheetCell =>
    v === null || v === undefined ? null : String(v);
  // Label (classification / append-notes) -> typed cell: "" collapses to null;
  // csvCell(null)="" so the CSV is unchanged. Keeps empty xlsx cells truly empty.
  const labelCell = (s: string): SheetCell => (s === "" ? null : s);
  // Descriptor value -> typed cell: number stays numeric (raw, no formatter);
  // else stringified; empty -> null. Matches the old csvCell(resolve...) bytes.
  const descriptorCell = (v: unknown): SheetCell =>
    v === null || v === undefined ? null : typeof v === "number" ? v : String(v);

  const cells: SheetCell[][] = ordered.map((row) => {
    const depth = depths.get(row.row_index) ?? 0;
    return [
      sheetName, // VERBATIM -- trailing spaces intact (#152)
      row.source_row_number ?? null, // numeric Excel row
      textCell(row.sl_no_value),
      textCell(row.description),
      depth, // numeric effective depth
      labelCell(clsLabel(row.classification)),
      labelCell(clsLabel(row.effective_classification)),
      parentExcelRow(row.parent_index),
      parentExcelRow(row.effective_parent_index),
      // Per-descriptor values: reuse the tree's walk; numbers RAW (no formatter).
      ...dataDescriptors.map((d) => descriptorCell(resolveDescriptorValue(row, d))),
      textCell(row.row_notes),
      labelCell(formatAppendNotes(row.append_notes_raw)),
      textCell(row.remarks),
      isEditedRow(row) ? "Yes" : "No",
      textCell(row.edited_by),
      textCell(row.edited_at), // verbatim server string
    ];
  });

  return { headers, cells };
}

export function buildAndDownloadReviewCsv({
  boqName,
  sheetName,
  rows,
  columnDescriptors,
}: BuildAndDownloadReviewCsvArgs): void {
  // Build the typed matrix, then stringify every cell for CSV. csvCell maps
  // null -> "" and numbers via String() -- BYTE-IDENTICAL to Slice D2 output.
  const { headers, cells } = buildReviewSheet({ sheetName, rows, columnDescriptors });
  const dataRows = cells.map((row) => row.map(csvCell));

  const csv = unparse([headers, ...dataRows]);

  // UTF-8 BOM so Excel renders rupee signs / non-ASCII correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = formatDateFn(new Date(), "yyyyMMdd_HHmmss");
  // Bare basename -> .csv extension appended exactly once (no double-extension trap).
  const basename = `${sanitizeFilename(boqName)}_${sanitizeFilename(sheetName)}_review_${timestamp}`;
  link.href = url;
  link.setAttribute("download", `${basename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
