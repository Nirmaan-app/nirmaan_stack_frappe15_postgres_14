/**
 * Typed shapes of the Estimates tab's backend reads (`nirmaan_stack.api.estimations.boq_view`) and of the
 * existing sheet-rows read it reuses (`api.boq.wizard.pricing.get_priced_rows`). The one place these are typed (F2).
 */

/** One committed data sheet of a Selected BOQ, with its estimate counts. */
export interface EstimateSheetSummary {
  /** BoQ Sheet docname (the current version). */
  name: string;
  /** The sheet's name, verbatim (may carry leading or trailing spaces; never trimmed). */
  sheet_name: string;
  line_items: number;
  estimated: number;
  /** Estimates a re-commit left on an older version of this sheet. */
  older: number;
}

/** One Selected BOQ of the project. */
export interface EstimateBoqSummary {
  name: string;
  boq_name: string;
  sheets: EstimateSheetSummary[];
}

/** `get_estimates_overview` reply. */
export interface EstimatesOverview {
  boqs: EstimateBoqSummary[];
}

/** One material on a line's estimate (a `BOQ Line Estimate Item` row). */
export interface EstimateItemRow {
  /** Child row name; absent on a row added in the form and not yet saved. */
  name?: string;
  item_type: "Normal" | "Custom";
  item_id?: string | null;
  item_name?: string | null;
  unit?: string | null;
  quantity: number;
  category?: string | null;
  procurement_package?: string | null;
  make?: string | null;
  comment?: string | null;
}

/** The BOQ line item an estimate belongs to, as `get_estimates` describes it. */
export interface EstimateLine {
  /** Null only for an estimate whose line item and sheet were both deleted (state `line_missing`). */
  sheet_name: string | null;
  excel_row: number | null;
  sl_no: string | null;
  description: string | null;
  unit: string | null;
  qty: number | null;
  is_current: boolean;
}

/** One estimate with its items. */
/**
 * Where an older-version estimate that still needs a person stands (server `rules.older_states`; history -- estimates
 * already copied forward, or replaced by a newer version's -- is left out by the server): `can_copy` = its line is
 * unchanged but it was not copied yet (Re-attach copies it); `changed` = its line changed (Add to a line, or Remove);
 * `line_missing` = its line item was deleted from the BOQ (Add to a line, or Remove).
 */
export type OlderState = "can_copy" | "changed" | "line_missing";

export interface EstimateEntry {
  name: string;
  modified: string;
  boq_node: string;
  item_count: number;
  line: EstimateLine;
  items: EstimateItemRow[];
  /** Older entries only. */
  state?: OlderState;
  /** Older entries only: commit version of the sheet it was left on. */
  version?: number | null;
}

/** `get_estimates` reply: on current line items, and left on an older version by a re-commit. */
export interface EstimatesReply {
  current: EstimateEntry[];
  older: EstimateEntry[];
}

/** The fields of a `get_priced_rows` row the Estimates grid reads. */
export interface SheetRow {
  /** BOQ Nodes docname: the line item's id. */
  name: string;
  row_index: number;
  effective_parent_index: number | null;
  source_row_number: number | null;
  classification: string | null;
  node_type?: string | null;
  sl_no_value: string | null;
  description: string | null;
  unit: string | null;
  qty_total: number | null;
  rate_supply: number | null;
  rate_install: number | null;
  amount_total: number | null;
}

/** `get_priced_rows` reply, the part the grid reads. */
export interface SheetRowsReply {
  rows: SheetRow[];
}

/** `save_estimate` reply. */
export type SaveEstimateReply = { name: string; modified: string; item_count: number } | { deleted: true };

/** `reattach_estimates` reply: estimates copied to the new version. `failed`: copies a save rule refused (the others were still copied). */
export interface ReattachReply {
  copied: number;
  unmatched: { estimate: string; excel_row: number | null; description: string | null }[];
  failed: { estimate: string; excel_row: number | null; description: string | null; reason: string }[];
}

/** `settle_older` reply: older estimates marked settled (kept on their version as history, no longer listed). */
export interface SettleOlderReply {
  settled: number;
}
