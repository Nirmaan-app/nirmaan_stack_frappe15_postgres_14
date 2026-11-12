/**
 * Pure rules of the Estimates tab (F4): which rows a sheet grid shows, how Line Item View groups them, how
 * Estimate Items adds materials up, and the form's checks. The server is the enforcement boundary for every
 * save rule (`services/estimations/rules.py`); the form's checks here only give feedback before the round trip.
 */
import type { EstimateEntry, EstimateItemRow, SheetRow } from "./estimateTypes";

/** Row type label, as the BOQ sheet viewer shows it. */
export function rowTypeLabel(classification: string | null | undefined): string {
  switch (classification) {
    case "line_item":
      return "Item";
    case "preamble":
      return "Preamble";
    case "note":
      return "Note";
    case "spacer":
      return "Spacer";
    case "subtotal_marker":
    case "subtotal":
      return "Subtotal";
    default:
      return classification ? classification.replace(/_/g, " ") : "";
  }
}

/** True for a row that takes a material estimate (decision F: line items only). */
export const isLineItem = (row: Pick<SheetRow, "classification">): boolean => row.classification === "line_item";

/** Which non-item rows the BOQ View grid shows. */
export interface GridFilter {
  showNotes: boolean;
  showSubtotals: boolean;
  showSpacers: boolean;
  /** Case-insensitive text matched against the description; headings always stay. */
  search: string;
}

/** A sheet row ready to draw: its parent's Excel row resolved. */
export interface GridRow extends SheetRow {
  parentExcelRow: number | null;
}

/** The rows the BOQ View grid draws, in sheet order. */
export function gridRows(rows: SheetRow[], filter: GridFilter): GridRow[] {
  const byIndex = new Map(rows.map((r) => [r.row_index, r]));
  const needle = filter.search.trim().toLowerCase();
  return rows
    .filter((r) => {
      const label = rowTypeLabel(r.classification);
      if (label === "Note" && !filter.showNotes) return false;
      if (label === "Subtotal" && !filter.showSubtotals) return false;
      if (label === "Spacer" && !filter.showSpacers) return false;
      if (needle && label !== "Preamble" && !(r.description || "").toLowerCase().includes(needle)) return false;
      return true;
    })
    .map((r) => ({
      ...r,
      parentExcelRow:
        r.effective_parent_index != null ? byIndex.get(r.effective_parent_index)?.source_row_number ?? null : null,
    }));
}

/** One block of Line Item View: a heading and the line items under it. */
export interface LineGroup {
  heading: SheetRow | null;
  lines: SheetRow[];
}

/**
 * Line Item View's groups: each line item under the nearest heading above it, in sheet order. `keep` decides
 * which line items stay (search and the Estimated filter); a heading left with no line item is dropped.
 */
export function lineGroups(rows: SheetRow[], keep: (row: SheetRow) => boolean): LineGroup[] {
  const groups: LineGroup[] = [];
  let current: LineGroup = { heading: null, lines: [] };
  for (const row of rows) {
    if (row.classification === "preamble") {
      if (current.lines.length) groups.push(current);
      current = { heading: row, lines: [] };
    } else if (isLineItem(row) && keep(row)) {
      current.lines.push(row);
    }
  }
  if (current.lines.length) groups.push(current);
  return groups;
}

/** One line of Estimate Items → Material totals. */
export interface MaterialTotal {
  key: string;
  item_type: EstimateItemRow["item_type"];
  item_id: string | null;
  item_name: string;
  make: string;
  category: string;
  unit: string;
  quantity: number;
  lines: number;
}

const clean = (v: string | null | undefined) => (v || "").trim();

/**
 * Material totals: the same Items record + make + unit added up across lines; a custom item grouped by name +
 * unit, ignoring case and surrounding spaces. Never adds across different units.
 */
export function materialTotals(entries: EstimateEntry[], type: "all" | "Normal" | "Custom" = "all"): MaterialTotal[] {
  const totals = new Map<string, MaterialTotal & { nodes: Set<string> }>();
  for (const entry of entries) {
    for (const item of entry.items) {
      if (type !== "all" && item.item_type !== type) continue;
      const unit = clean(item.unit);
      const key =
        item.item_type === "Normal"
          ? `N|${clean(item.item_id)}|${clean(item.make)}|${unit.toLowerCase()}`
          : `C|${clean(item.item_name).toLowerCase()}|${unit.toLowerCase()}`;
      let total = totals.get(key);
      if (!total) {
        total = {
          key, item_type: item.item_type, item_id: item.item_id ?? null, item_name: clean(item.item_name),
          make: clean(item.make), category: clean(item.category), unit, quantity: 0, lines: 0, nodes: new Set(),
        };
        totals.set(key, total);
      }
      total.quantity += Number(item.quantity) || 0;
      total.nodes.add(entry.boq_node);
      total.lines = total.nodes.size;
    }
  }
  return [...totals.values()]
    .map(({ nodes: _nodes, ...rest }) => rest)
    .sort((a, b) => a.item_name.localeCompare(b.item_name) || a.unit.localeCompare(b.unit));
}

/** Units counted in whole pieces (decision H; mirrors `rules.WHOLE_NUMBER_UNITS`). */
export const WHOLE_NUMBER_UNITS = ["nos", "set"] as const;

/** The form's check of one row before saving, or null. Mirrors `rules.item_row_problem` for quick feedback. */
export function itemRowProblem(row: EstimateItemRow): string | null {
  if (row.item_type === "Normal" && !clean(row.item_id)) return "Pick an item from the Items list.";
  if (row.item_type === "Custom") {
    if (!clean(row.item_name)) return "Type the custom item's name.";
    if (!clean(row.unit)) return "Choose the custom item's unit.";
    if (!clean(row.category)) return "Choose the custom item's category.";
  }
  const qty = Number(row.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return "Enter a quantity above 0.";
  if ((WHOLE_NUMBER_UNITS as readonly string[]).includes(clean(row.unit).toLowerCase()) && !Number.isInteger(qty)) {
    return `${clean(row.unit)} is counted in whole numbers. Enter a quantity without decimals.`;
  }
  return null;
}

/** The form's duplicate check (decision G), naming the item, or null. Mirrors `rules.duplicate_problem`. */
export function duplicateProblem(rows: EstimateItemRow[]): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const key =
      row.item_type === "Normal"
        ? `N|${clean(row.item_id)}|${clean(row.make)}`
        : `C|${clean(row.item_name).toLowerCase()}|${clean(row.unit).toLowerCase()}`;
    if (seen.has(key)) {
      const name = clean(row.item_name) || clean(row.item_id);
      return row.item_type === "Normal"
        ? `"${name}" is in this estimate twice with the same make. Change one make, or merge the quantities.`
        : `The custom item "${name}" is in this estimate twice. Merge the quantities into one row.`;
    }
    seen.add(key);
  }
  return null;
}

/** Project statuses on which estimates are read-only (decision I; mirrors `rules.READ_ONLY_PROJECT_STATUSES`). */
export const READ_ONLY_PROJECT_STATUSES = ["Completed", "Handover"] as const;

/** True when estimates on a project in this status may be changed. */
export const projectAllowsEstimateEdits = (status: string | null | undefined): boolean =>
  !(READ_ONLY_PROJECT_STATUSES as readonly string[]).includes(clean(status));
