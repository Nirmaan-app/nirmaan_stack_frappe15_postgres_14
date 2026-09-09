/**
 * exportViewerXlsx -- the committed-sheet VIEWER's .xlsx download (SheetViewPage).
 *
 * ONE workbook, ONE worksheet per committed sheet, ONE download. The page fetches each
 * sheet's `get_priced_rows` payload sequentially and hands them here already in hand; this
 * module does NO network I/O.
 *
 * ⚠️ WHY THIS IS BUILT IN THE BROWSER INSTEAD OF CALLING `export_priced_workbook`.
 * That endpoint stamps every rate and amount into the original tender workbook and is
 * whitelisted with NO role check at all. The viewer is reachable by a much wider audience
 * than the hub -- the project BoQ tab's row click is deliberately NOT gated to the wizard
 * profiles, and what a reader SEES is narrowed instead by `canSeeBoqCommercials`, which the
 * page enforces by WITHHOLDING the rate/amount descriptors so those figures never enter the
 * DOM. Wiring that endpoint to a button here would hand a reader who cannot see the Rate
 * column a file containing every rate on every sheet.
 *
 * Building from the page's own data makes the on-screen gate the EXPORT gate BY
 * CONSTRUCTION: this module writes the descriptors it is given, so a column the grid was
 * never handed cannot be written. That is the page's own principle -- "a column the grid was
 * never handed cannot leak" -- extended to the file. Pinned by test (a descriptor list with
 * no rate/amount produces a file with no rate/amount columns), so it stays true.
 *
 * ⚠️ NO BCS, DELIBERATELY, AND THIS MODULE MUST STAY FREE OF IT. `canSeeBoqCommercials` is
 * {Admin, PMO, Estimates, Billing}, but the existing internal cost workbook
 * (`export_bcs_writeback.export_priced_workbook_with_bcs`) is gated to `PRICING_ACCESS_SET`
 * = {Admin, Estimates}. Writing the cost block here would widen the audience for a
 * cost-bearing file to PMO and Billing as a side effect of adding a download button -- a
 * decision nobody made. Same shape as `export_writeback.py`, whose no-BCS property is
 * guarded by grepping its own source; a test greps this module the same way. Adding BCS is
 * an owner ruling plus a role gate, never a quiet column append.
 *
 * WHY exceljs, and why a DYNAMIC import: both verbatim from exportReviewXlsx.ts -- the npm
 * `xlsx` (SheetJS) package is abandoned with unpatched CVEs, and exceljs is ~250KB, so it
 * must stay in its own lazy chunk rather than the viewer's entry bundle. NEVER convert this
 * to a static import.
 *
 * REUSES the tree's existing helpers rather than re-deriving anything: `computeDepths` and
 * `resolveDescriptorValue` (reviewRender), `evaluateAmountCell` (PricingGrid -- the SAME
 * function the grid renders an amount through, so the file's figures cannot disagree with
 * the screen's), `sanitizeFilename` (exportReviewCsv) and `sanitizeSheetTabName`
 * (exportReviewXlsx).
 *
 * sheet_name is VERBATIM (#152) in the Sheet Name COLUMN; only the Excel TAB TITLE is
 * sanitized + de-duplicated (Excel rejects illegal chars, >31 chars, blank/duplicate
 * titles). The DATA is never altered.
 */
import { format as formatDateFn } from "date-fns";
import { evaluateAmountCell, isAmountDescriptor } from "./PricingGrid";
import { FIXED_ROLE_DEDUPE } from "./ReviewTree";
import { CLS_LABELS, computeDepths, resolveDescriptorValue } from "./reviewRender";
import { sanitizeFilename, type SheetCell } from "./exportReviewCsv";
import { sanitizeSheetTabName } from "./exportReviewXlsx";
import { ROLE_LABELS } from "./boqTypes";
import type {
  ColumnDescriptor,
  ColumnFormula,
  PricedRow,
  SheetCategoryRow,
} from "./boqTypes";

/** Excel's hard cap on a worksheet tab title (mirrors exportReviewXlsx). */
const TAB_NAME_MAX = 31;

/** One committed sheet to export: its name + the loaded get_priced_rows payload. */
export interface ViewerWorkbookSheet {
  /** Sheet name, VERBATIM (#152). Drives the tab title (sanitized) + Sheet Name column (verbatim). */
  sheetName: string;
  rows: PricedRow[];
  /**
   * ⚠️ THE PERMISSION-FILTERED descriptor list -- what the grid was handed, NOT the raw
   * payload's `column_descriptors`. A reader without commercials must be handed a list with
   * no rate/amount descriptors, exactly as the screen is. See the module docblock.
   */
  columnDescriptors: ColumnDescriptor[];
  columnFormulas: ColumnFormula[];
  /** Per-Excel-row resolved category verdicts, for the Category column. Absent -> blank. */
  categoriesByExcelRow?: Map<number, SheetCategoryRow>;
  /** category id -> human label. A missing id falls back to the id itself, never a blank. */
  categoryLabelById?: Map<string, string>;
}

export interface BuildAndDownloadViewerWorkbookArgs {
  /** BOQs docname -- used for the workbook filename only. */
  boqName: string;
  /** Sheets to export, in tab order. */
  sheets: ViewerWorkbookSheet[];
}

/** Build result: the header row + the typed cell matrix (row_index order). */
export interface ViewerSheetData {
  headers: string[];
  cells: SheetCell[][];
}

/** Column header for one descriptor -- IDENTICAL to the review export's rule, so the same
 *  column is called the same thing in both files. */
function descriptorHeader(d: ColumnDescriptor): string {
  return `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
}

/** Absent-vs-zero: null/undefined -> null (a blank cell); 0 stays the number 0. A real 0 is
 *  a claim the sheet makes and must not render as absence. */
function numOrNull(v: number | null | undefined): SheetCell {
  return v === null || v === undefined ? null : v;
}

/** Text -> typed cell: null/undefined/"" -> null (truly empty in Excel); else string. */
function textCell(v: unknown): SheetCell {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === "" ? null : s;
}

/** Descriptor value -> typed cell: a number stays a NUMBER (so Excel gets a real numeric
 *  cell, not text); everything else stringifies; empty -> null. */
function descriptorCell(v: unknown): SheetCell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = String(v);
  return s === "" ? null : s;
}

/**
 * Build one worksheet's header row + typed cell matrix from a committed sheet's payload.
 *
 * PURE -- no React, no network, no exceljs. This is the single source of truth for the
 * viewer export's column set and value resolution, and is what the unit tests pin.
 *
 * ⚠️ AMOUNT COLUMNS GO THROUGH `evaluateAmountCell`, the same function PricingGrid renders
 * an amount through, called with NO drafts (`{}`) because the viewer is read-only and has
 * none. A second implementation here could compute a different number from the same
 * formulas, and the file would quietly disagree with the screen it was downloaded from.
 * A formula that cannot resolve (`not_yet` / `broken`) writes a BLANK, never a 0 -- the grid
 * blanks it for the same reason, and a 0 would assert a total the sheet does not have.
 *
 * ROWS ARE THE WHOLE SHEET, in row_index order -- never the filtered/collapsed view. A
 * downloaded file outlives the filters that made it, and a partial file that looks complete
 * is the failure mode; the Summary panel on the same page follows this rule too.
 */
export function buildViewerSheet({
  sheetName,
  rows,
  columnDescriptors,
  columnFormulas,
  categoriesByExcelRow,
  categoryLabelById,
}: ViewerWorkbookSheet): ViewerSheetData {
  // Stable export order: row_index ascending (the tree's underlying order).
  const ordered = [...rows].sort((a, b) => a.row_index - b.row_index);
  const depths = computeDepths(ordered);
  const byIdx = new Map<number, PricedRow>(ordered.map((r) => [r.row_index, r]));

  // Parent as an EXCEL row number (what a reader sees in the grid's Parent column), not the
  // internal row_index. A root (-1 sentinel / null / negative) is blank.
  const parentExcelRow = (parentIdx: number | null | undefined): SheetCell => {
    if (parentIdx === null || parentIdx === undefined || parentIdx < 0) return null;
    const parent = byIdx.get(parentIdx);
    return parent ? numOrNull(parent.source_row_number) : null;
  };

  // Data columns: descriptor-driven, EXCLUDING the sl_no/description roles, which have their
  // own fixed columns -- the same dedupe the grid applies, so nothing is duplicated. Excel
  // column order is preserved from the payload.
  const dataDescriptors = columnDescriptors.filter((d) => !FIXED_ROLE_DEDUPE.has(d.role));

  const headers = [
    "Sheet Name",
    "Excel Row",
    "Sl.No",
    "Parent Excel Row",
    "Depth",
    "Row Type",
    "Description",
    "Category",
    ...dataDescriptors.map(descriptorHeader),
    "Remarks",
  ];

  const cells: SheetCell[][] = ordered.map((row) => {
    const cat = categoriesByExcelRow?.get(row.source_row_number);
    // The cell shows the human-readable LABEL, exactly as the grid's Category column does;
    // an id with no catalog entry falls back to the id rather than vanishing.
    const catId = cat?.effective_category_id ?? null;
    const catLabel = catId ? (categoryLabelById?.get(catId) ?? catId) : null;

    return [
      sheetName, // VERBATIM (#152)
      numOrNull(row.source_row_number),
      textCell(row.sl_no_value),
      parentExcelRow(row.effective_parent_index),
      numOrNull(depths.get(row.row_index)),
      textCell(
        row.effective_classification
          ? (CLS_LABELS[row.effective_classification] ?? row.effective_classification)
          : null,
      ),
      textCell(row.description),
      textCell(catLabel),
      ...dataDescriptors.map((d) => {
        if (isAmountDescriptor(d)) {
          // No drafts on a read-only page -- `{}` is the whole story, not a placeholder.
          const cell = evaluateAmountCell(d, row, columnDescriptors, columnFormulas, {});
          return cell.kind === "value" ? numOrNull(cell.value) : null;
        }
        return descriptorCell(resolveDescriptorValue(row, d));
      }),
      textCell(row.remark),
    ];
  });

  return { headers, cells };
}

/**
 * De-duplicate a sanitized tab title against the titles already used in this workbook.
 * Verbatim in behaviour from exportReviewXlsx's private helper -- two distinct sheet names
 * that sanitize to the same title still get distinct tabs.
 */
function dedupeTabName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  for (;;) {
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
 * Build + download ONE multi-tab .xlsx of the given committed sheets -- one worksheet per
 * entry, in order, each a bold header row plus the typed cell matrix (numbers land as real
 * Excel numbers, null as a blank cell).
 */
export async function buildAndDownloadViewerWorkbook({
  boqName,
  sheets,
}: BuildAndDownloadViewerWorkbookArgs): Promise<void> {
  // DYNAMIC import -- exceljs lives in its own lazy chunk, never the viewer bundle.
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  const usedTabNames = new Set<string>();
  for (const sheet of sheets) {
    const { headers, cells } = buildViewerSheet(sheet);
    const tabName = dedupeTabName(sanitizeSheetTabName(sheet.sheetName), usedTabNames);
    const ws = workbook.addWorksheet(tabName);
    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true };
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
  const basename = `${sanitizeFilename(boqName)}_sheets_${timestamp}`;
  link.href = url;
  link.setAttribute("download", `${basename}.xlsx`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
