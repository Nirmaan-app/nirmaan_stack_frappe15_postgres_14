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
  FIXED_ROLE_DEDUPE,
} from "./ReviewTree";

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
 */
function sanitizeFilename(s: string): string {
  const cleaned = s
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_");
  return cleaned || "sheet";
}

export function buildAndDownloadReviewCsv({
  boqName,
  sheetName,
  rows,
  columnDescriptors,
}: BuildAndDownloadReviewCsvArgs): void {
  // Stable export order: row_index ascending (the tree's underlying order).
  const ordered = [...rows].sort((a, b) => a.row_index - b.row_index);

  // Depth map (reuse the tree's iterative, cycle-safe, effective-parent walk).
  const depths = computeDepths(ordered);

  // row_index -> source_row_number, to resolve parent indices to Excel rows.
  const byIdx = new Map<number, ReviewRow>(ordered.map((r) => [r.row_index, r]));
  const parentExcelRow = (parentIdx: number | null): string => {
    // -1 sentinel / null / negative => root => blank.
    if (parentIdx === null || parentIdx === undefined || parentIdx < 0) return "";
    const parent = byIdx.get(parentIdx);
    return parent ? csvCell(parent.source_row_number) : "";
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

  const dataRows = ordered.map((row) => {
    const depth = depths.get(row.row_index) ?? 0;
    return [
      sheetName, // VERBATIM -- trailing spaces intact (#152)
      csvCell(row.source_row_number),
      csvCell(row.sl_no_value),
      csvCell(row.description),
      String(depth),
      clsLabel(row.classification),
      clsLabel(row.effective_classification),
      parentExcelRow(row.parent_index),
      parentExcelRow(row.effective_parent_index),
      // Per-descriptor values: reuse the tree's walk; numbers RAW (no formatter).
      ...dataDescriptors.map((d) => csvCell(resolveDescriptorValue(row, d))),
      csvCell(row.row_notes),
      formatAppendNotes(row.append_notes_raw),
      csvCell(row.remarks),
      isEditedRow(row) ? "Yes" : "No",
      csvCell(row.edited_by),
      csvCell(row.edited_at), // verbatim server string
    ];
  });

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
