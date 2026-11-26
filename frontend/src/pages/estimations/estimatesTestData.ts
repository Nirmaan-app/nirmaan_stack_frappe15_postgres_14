/**
 * Made-up rows and estimates shared by the Estimates tab's tests. Not a test file itself (no `.test.`), so vitest
 * never runs it. Every name is invented.
 */
import type {
  EstimateBoqSummary, EstimateEntry, EstimateItemRow, OlderState, SheetRow,
} from "@/utils/estimations/estimateTypes";

export const sheetRow = (over: Partial<SheetRow> & Pick<SheetRow, "name" | "row_index">): SheetRow => ({
  effective_parent_index: null, source_row_number: null, classification: "line_item", sl_no_value: null,
  description: "", unit: null, qty_total: null, rate_supply: null, rate_install: null, amount_total: null, ...over,
});

/**
 * A sheet with two top-level headings: H1 holds two line items; H2 holds a sub-heading (SH) holding one more.
 *   H1 (row 9)  ├ L1 (row 10)  └ L2 (row 11)
 *   H2 (row 12) └ SH (row 13) └ L3 (row 14)
 */
export const SHEET_ROWS: SheetRow[] = [
  sheetRow({ name: "H1", row_index: 0, source_row_number: 9, classification: "preamble", description: "MADE-UP SYSTEM" }),
  sheetRow({ name: "L1", row_index: 1, source_row_number: 10, effective_parent_index: 0, description: "Made-up plenum",
    unit: "Sqm", qty_total: 12 }),
  sheetRow({ name: "L2", row_index: 2, source_row_number: 11, effective_parent_index: 0, description: "Made-up diffuser",
    unit: "Nos", qty_total: 4 }),
  sheetRow({ name: "H2", row_index: 3, source_row_number: 12, classification: "preamble", description: "MADE-UP DUCTS" }),
  sheetRow({ name: "SH", row_index: 4, source_row_number: 13, classification: "preamble", effective_parent_index: 3,
    description: "Made-up sub heading" }),
  sheetRow({ name: "L3", row_index: 5, source_row_number: 14, effective_parent_index: 4, description: "Made-up sheet metal",
    unit: "Kg", qty_total: 300 }),
];

export const normalItem = (over: Partial<EstimateItemRow> = {}): EstimateItemRow => ({
  item_type: "Normal", item_id: "ITEM-PANEL", item_name: "Made-up panel", unit: "sqm", category: "Made-up Boards",
  make: null, quantity: 3, ...over,
});

export const customItem = (over: Partial<EstimateItemRow> = {}): EstimateItemRow => ({
  item_type: "Custom", item_id: null, item_name: "Made-up clip", unit: "NOS", category: "Made-up Fixings",
  make: null, quantity: 2, ...over,
});

export const estimate = (node: string, items: EstimateItemRow[], over: Partial<EstimateEntry> = {}): EstimateEntry => ({
  name: `E-${node}`, modified: "2026-11-12 10:00:00.000000", boq_node: node, item_count: items.length, items,
  line: { sheet_name: "Made-up sheet", excel_row: 10, sl_no: null, description: "Made-up plenum", unit: "Sqm", qty: 12,
    is_current: true },
  ...over,
});

export const olderEstimate = (name: string, state: OlderState, excelRow: number, items: EstimateItemRow[]): EstimateEntry =>
  estimate(`OLD-${name}`, items, {
    name, state, version: 0,
    line: { sheet_name: "Made-up sheet", excel_row: excelRow, sl_no: null, description: `Made-up older line ${excelRow}`,
      unit: "Sqm", qty: 5, is_current: false },
  });

export const BOQS: EstimateBoqSummary[] = [
  { name: "BOQ-A", boq_name: "Made-up BOQ A", sheets: [
    { name: "SH-A1", sheet_name: "Made-up sheet", line_items: 3, estimated: 2, older: 0 },
    { name: "SH-A2", sheet_name: "Made-up sheet B", line_items: 5, estimated: 0, older: 1 },
  ] },
  { name: "BOQ-B", boq_name: "Made-up BOQ B", sheets: [
    { name: "SH-B1", sheet_name: "Made-up other sheet", line_items: 7, estimated: 7, older: 0 },
  ] },
];
