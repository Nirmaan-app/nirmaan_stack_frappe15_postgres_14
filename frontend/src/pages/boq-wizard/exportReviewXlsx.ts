/**
 * exportReviewXlsx -- wizard-local XLSX workbook writer for the BoQ hub (Slice D2b).
 *
 * Builds ONE .xlsx workbook with one worksheet (tab) per selected "Parsed Check
 * Done" sheet, then triggers a browser download. FRONTEND-ONLY -- the caller
 * (ExportWorkbookDialog) fetches each sheet's rows via get_review_rows and hands
 * them here already in hand; this module does no network I/O.
 *
 * WHY exceljs (not the npm `xlsx` package):
 *   The npm `xlsx` (SheetJS) package on the public registry is abandoned and
 *   carries two unpatched high-severity CVEs (prototype pollution + ReDoS).
 *   exceljs is maintained and writes a real .xlsx with typed numeric cells.
 *
 * WHY a DYNAMIC import:
 *   exceljs is heavy (~250 KB+). A static import would pull it into the hub's
 *   entry bundle and slow every hub load for a feature most users never invoke.
 *   `await import("exceljs")` keeps it in its OWN lazy chunk, fetched only when
 *   an export actually runs. NEVER convert this to a static import.
 *
 * REUSES exportReviewCsv's buildReviewSheet (the SINGLE source of truth for the
 * column set + typed cells) and sanitizeFilename -- so each xlsx tab is column-
 * for-column identical to the per-sheet CSV, numbers land as real numbers, and
 * the workbook filename follows the same rule. The tree's helpers therefore stay
 * the one place column logic lives.
 *
 * sheet_name is VERBATIM (#152) in the Sheet Name COLUMN inside each tab; only the
 * Excel TAB TITLE is sanitized + de-duplicated (Excel rejects illegal chars,
 * >31-char, and blank/duplicate tab titles -- the DATA is never altered).
 */
import { format as formatDateFn } from "date-fns";
import type { ReviewRow, ColumnDescriptor } from "./boqTypes";
import { buildReviewSheet, sanitizeFilename } from "./exportReviewCsv";

/** One sheet to export: its name + the loaded get_review_rows payload. */
export interface ReviewWorkbookSheet {
  /** Sheet name, VERBATIM (#152). Drives the tab title (sanitized) + Sheet Name column (verbatim). */
  sheetName: string;
  rows: ReviewRow[];
  columnDescriptors: ColumnDescriptor[];
}

export interface BuildAndDownloadReviewWorkbookArgs {
  /** BOQs docname -- used for the workbook filename only. */
  boqName: string;
  /** Sheets to export, in tab order. */
  sheets: ReviewWorkbookSheet[];
}

const TAB_NAME_MAX = 31; // Excel hard cap on a worksheet tab title.

/**
 * Sanitize ONE sheet name into a legal Excel tab title (tab title ONLY -- never
 * the data). Excel forbids the characters : \ / ? * [ ] in a tab name, caps it at
 * 31 chars, and rejects leading/trailing whitespace or an empty title. Trailing-
 * space sheet names are PROVEN in the corpus ("Electrical ", "HVAC "), so the
 * trim is load-bearing. Exported for unit-reuse / testing.
 */
export function sanitizeSheetTabName(name: string): string {
  let t = name.replace(/[\\/?*[\]:]/g, "_").trim();
  if (t.length > TAB_NAME_MAX) t = t.slice(0, TAB_NAME_MAX).trim();
  return t || "Sheet";
}

/**
 * De-duplicate a sanitized tab title against the names already used in this
 * workbook. On collision, append " (2)", " (3)", ... truncating the base so the
 * suffixed title still fits 31 chars. Two distinct verbatim sheet names that
 * collapse to the same sanitized title get distinct tabs this way.
 */
function dedupeTabName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const suffix = ` (${n})`;
    const trimmed = base.slice(0, TAB_NAME_MAX - suffix.length).trim() || "Sheet";
    const candidate = `${trimmed}${suffix}`.slice(0, TAB_NAME_MAX);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    n += 1;
  }
}

/**
 * Build + download a multi-tab .xlsx of the given review sheets. One worksheet
 * per entry (in order); each worksheet = a bold header row + the typed cell
 * matrix from buildReviewSheet (numbers land as real Excel numbers, empty -> blank).
 */
export async function buildAndDownloadReviewWorkbook({
  boqName,
  sheets,
}: BuildAndDownloadReviewWorkbookArgs): Promise<void> {
  // DYNAMIC import -- exceljs lives in its own lazy chunk, never the hub bundle.
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  const usedTabNames = new Set<string>();
  for (const sheet of sheets) {
    const { headers, cells } = buildReviewSheet({
      sheetName: sheet.sheetName,
      rows: sheet.rows,
      columnDescriptors: sheet.columnDescriptors,
    });

    const tabName = dedupeTabName(sanitizeSheetTabName(sheet.sheetName), usedTabNames);
    const ws = workbook.addWorksheet(tabName);

    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true };
    // Typed cells: numbers as numbers, null as an empty cell.
    ws.addRows(cells);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = formatDateFn(new Date(), "yyyyMMdd_HHmmss");
  // Bare basename -> .xlsx appended exactly once (no double-extension trap).
  const basename = `${sanitizeFilename(boqName)}_review_${timestamp}`;
  link.href = url;
  link.setAttribute("download", `${basename}.xlsx`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
