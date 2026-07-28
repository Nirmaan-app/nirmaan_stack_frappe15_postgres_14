/**
 * U1 page-side PURE model: turn the grid's rows + descriptors + the page's category map into the
 * suggestion state the button produces and the badges read. No React, no persistence -- unit-tested.
 *
 * PricingGrid does NOT import this module (it receives the built RowSuggestions entry + a callback as
 * props); this module imports PricingGrid's leaf predicates (isRateDescriptor / isRateEditableRow),
 * so the one-way dependency (model -> grid, page -> both) holds and the memo shield is intact.
 */
import type { ColumnDescriptor, PricedRow, SheetCategoryRow } from "../boqTypes";
import { isRateDescriptor, isRateEditableRow } from "../PricingGrid";
import type { RateHelperRowContext, RowSuggestions } from "./rateHelperTypes";
import { suggestionCountForKind } from "./rateHelperRegistry";

/** Scalar rate value_field -> rate-kind token (mirrors the grid's / backend's spelling). Per-area
 * rate descriptors already carry the kind in `rate_subkey` (supply_rate/install_rate/combined_rate). */
const SCALAR_RATE_FIELD_TO_KIND: Record<string, string> = {
  rate_supply: "supply_rate",
  rate_install: "install_rate",
  rate_combined: "combined_rate",
};

/** The rate-kind of a rate descriptor, or null if it is not a kind we recognise. */
export function rateKindOfDescriptor(d: ColumnDescriptor): string | null {
  if (d.value_field === "rate_by_area") return d.rate_subkey ?? null;
  return SCALAR_RATE_FIELD_TO_KIND[d.value_field] ?? null;
}

/** The distinct rate-kinds present across a set of rate descriptors (order-preserving). */
export function rateKindsOf(rateDescriptors: ColumnDescriptor[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of rateDescriptors) {
    const k = rateKindOfDescriptor(d);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** Build the helper row-context for one grid row from the page's data (no fetch). */
export function buildRowContext(
  row: PricedRow,
  rateKinds: string[],
  category: SheetCategoryRow | undefined,
): RateHelperRowContext {
  const cat = (category?.effective_category_id ?? "").trim();
  return {
    excelRow: row.source_row_number,
    description: row.description ?? "",
    nodeType: (row.node_type ?? "").trim(),
    category: cat === "" ? null : cat,
    // U1: SheetCategoryRow does not carry the resolved discipline (the adapter drops it); the stub
    // keys only on category. The contract keeps `discipline` for U2's real helper.
    discipline: null,
    rateKinds,
  };
}

/**
 * Evaluate registered helpers over every RATE-EDITABLE row and produce the page-owned
 * suggestionsByExcelRow Map: for each rate cell whose kind has at least one helper suggestion, mark
 * that cell "badge". Rows with no rate-editable cells, non-editable rows, and cells whose kind no
 * helper suggests for are simply absent. Pure.
 */
export function buildSuggestions(
  rows: PricedRow[],
  descriptors: ColumnDescriptor[],
  override: boolean,
  categoriesByExcelRow: Map<number, SheetCategoryRow>,
): Map<number, RowSuggestions> {
  const rateDescriptors = descriptors.filter(isRateDescriptor);
  const kinds = rateKindsOf(rateDescriptors);
  const out = new Map<number, RowSuggestions>();
  for (const row of rows) {
    if (!isRateEditableRow(row, override)) continue;
    const ctx = buildRowContext(row, kinds, categoriesByExcelRow.get(row.source_row_number));
    const byCol: RowSuggestions["byCol"] = {};
    for (const d of rateDescriptors) {
      const kind = rateKindOfDescriptor(d);
      if (!kind) continue;
      const count = suggestionCountForKind(ctx, kind);
      if (count > 0) byCol[d.col] = { count, used: false };
    }
    if (Object.keys(byCol).length > 0) out.set(row.source_row_number, { byCol });
  }
  return out;
}

/** Return a NEW Map with (excelRow, col) marked "used" (chip -> check). Immutable: only the one
 * changed row's entry is rebuilt, so the row comparator re-renders exactly that row. */
export function markSuggestionUsed(
  map: Map<number, RowSuggestions>,
  excelRow: number,
  col: string,
): Map<number, RowSuggestions> {
  const entry = map.get(excelRow);
  const cell = entry?.byCol[col];
  if (!entry || !cell || cell.used) return map;
  const next = new Map(map);
  next.set(excelRow, { byCol: { ...entry.byCol, [col]: { ...cell, used: true } } });
  return next;
}
