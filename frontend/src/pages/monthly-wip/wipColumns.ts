import { WipCompliance } from "./useMonthlyWIPData";


// --------------------------------------------------------------------------- //
// Column model — the single source of truth for the numeric columns. The header
// (two-tier), the body cells, sorting and the group dividers all derive from it,
// so a column is added/renamed/reordered in ONE place.
// --------------------------------------------------------------------------- //

/** Month-scoped, day-based fields (present on both a project row AND its stints). */
export type ComplianceField = keyof WipCompliance;
/** Lifetime, project-level fields (present only on the project row). */
export type LifetimeField = "dispatched_po" | "total_dn" | "missing_dn" | "total_dc" | "missing_dc";
export type NumericField = ComplianceField | LifetimeField;

export type SortKey = "project_name" | NumericField;

/** What one unit of the column counts. Drives the coloured chip in the help dialog —
 *  the single most load-bearing thing in it, because a `documents` column sitting
 *  beside a `POs` column is exactly what reads as a subtraction and is not one. */
export type ColumnUnit = "days" | "reports" | "documents" | "POs";

export interface NumericColumn {
  key: NumericField;
  label: string;
  /** First column of a group — draws the left divider. */
  groupStart?: boolean;
  /** Bold — the "base" figure of its group (Active Days, Dispatched POs). */
  emphasize?: boolean;
  /** Lifetime & project-level — stint sub-rows render "—" instead of a value. */
  lifetime?: boolean;
  /** A "missing" gap column — a non-zero value is shown red (0 stays muted). */
  danger?: boolean;

  // --- help-dialog metadata (WipFormulaDialog reads these) ------------------ //
  /** What one unit is. */
  unit: ColumnUnit;
  /** The doctype(s) the figure is read from. */
  source: string;
  /** Every filter applied, in the order the query applies them. */
  conditions: string[];
  /** The rule in one line. */
  formula: string;
  /** Optional footnote — a cross-reference or a caveat worth stating outright. */
  note?: string;
  /** Makes a non-zero cell a deep link into the project's DN > DC report with this
   *  status pre-selected. Lives on the column model so the link, the header, the cell
   *  and the help dialog all still derive from ONE array — a separate key->status map
   *  is free to drift the moment a column is renamed or reordered. */
  linkStatus?: "pending_dn" | "no_dc_update";
}

const LIVE_PO_STATUSES = "Dispatched, Partially Dispatched, Partially Delivered, Delivered";

export const NUMERIC_COLUMNS: NumericColumn[] = [
  {
    key: "active_working_days", label: "Active Days", groupStart: true, emphasize: true,
    unit: "days",
    source: "Projects — status timeline rebuilt from Frappe's Version history",
    conditions: [
      "project status is WIP or Handover",
      "day falls inside the selected month",
      "Sundays excluded",
    ],
    formula: "count of active working days",
    note: "Projects.status is free text with no stored start date, so the timeline is derived from the recorded status transitions.",
  },
  {
    key: "total_dpr_days", label: "Total DPR",
    unit: "days",
    source: "Project Progress Reports",
    conditions: ["report_date inside the selected month", "report belongs to this project"],
    formula: "active working days that have at least one report",
  },
  {
    key: "missing_dpr_days", label: "Missing DPR", danger: true,
    unit: "days",
    source: "derived — no query of its own",
    conditions: [],
    formula: "Active Days − Total DPR",
    note: "Active Days = Total DPR + Missing DPR, always. This is the one group that does add up across.",
  },
  {
    key: "expected_inventory", label: "Expected", groupStart: true,
    unit: "reports",
    source: "derived from the active-day set",
    conditions: ["active day", "falls on a Monday"],
    formula: "count of active Mondays — one inventory expected per active week",
  },
  {
    key: "actual_inventory", label: "Actual",
    unit: "documents",
    source: "Remaining Items Report",
    conditions: ["report_date inside the selected month", "report belongs to this project"],
    formula: "COUNT of report documents",
    note: "Counts documents on any weekday, not Mondays covered — so it can exceed Expected.",
  },
  {
    key: "missing_inventory", label: "Missing", danger: true,
    unit: "reports",
    source: "derived — no query of its own",
    conditions: [],
    formula: "max(0, Expected − Actual)",
    note: "Clamped at 0 because Actual is an unbounded document count and routinely exceeds Expected.",
  },

  // MIND THE UNITS: "Disp PO" is a PO count, "Total DN" / "Total DC" are DOCUMENT
  // counts, and "Missing DN" / "Missing DC" are PO counts again — so the columns do
  // NOT subtract across the row. See useMonthlyWIPData.ts for the full rationale.
  {
    key: "dispatched_po", label: "Disp PO", groupStart: true, emphasize: true, lifetime: true,
    unit: "POs",
    source: "Procurement Orders",
    conditions: [
      `status is one of: ${LIVE_PO_STATUSES}`,
      "PO belongs to this project",
      "no date filter — lifetime",
    ],
    formula: "COUNT of purchase orders, Billable and Non-Billable",
    note: "Counts both, like Total DN. Hover the cell for the split. Missing DN and Missing DC below remain Billable-only, so this is a LARGER denominator than those two are measured against.",
  },
  {
    key: "total_dn", label: "Total DN", lifetime: true,
    unit: "documents",
    source: "Delivery Notes",
    conditions: [
      "is_return = 0 — a return is not a delivery",
      "note belongs to this project",
      "no date filter — lifetime",
    ],
    formula: "COUNT of delivery note documents, Billable and Non-Billable",
    note: "The ONE column in this block that is not Billable-only — a Non-Billable PO still receives goods. Hover the cell for the split. One PO can carry several notes, so this normally exceeds Disp PO.",
  },
  {
    key: "missing_dn", label: "Missing DN", lifetime: true, danger: true,
    // The report's "Pending DN" card is the same rule — both count POs with a
    // dispatched item not yet fully received.
    linkStatus: "pending_dn",
    unit: "POs",
    source: "Procurement Orders + Purchase Order Item",
    conditions: [
      "billing_status is not 'Non-Billable'",
      `status is one of: ${LIVE_PO_STATUSES}`,
      "status is NOT 'Delivered' — a fully delivered PO owes nothing",
    ],
    formula:
      "count POs having at least one item where category ≠ 'Additional Charges' AND is_dispatched = 1 AND received_quantity < quantity (2.5% tolerance on fractional quantities, exact on whole numbers)",
    note: "Compares ORDERED against RECEIVED on the PO's own items — it never looks at Delivery Note documents. Same number as the project's \"DN Pending\" tile.",
  },
  {
    key: "total_dc", label: "Total DC", groupStart: true, lifetime: true,
    unit: "documents",
    source: "PO Delivery Documents",
    conditions: [
      "type = 'Delivery Challan' — Material Inspection Reports excluded",
      "parent_doctype = 'Procurement Orders' — ITM-parented challans excluded",
      "the challan's parent PO (parent_docname) is Billable",
      "challan belongs to this project",
      "no date filter — lifetime",
    ],
    formula: "COUNT of challan documents",
    note: "Placeholder (stub) challans ARE counted here, but are ignored by Missing DC.",
  },
  {
    key: "missing_dc", label: "Missing DC", lifetime: true, danger: true,
    // The report's "No DC Update" card is the same rule — delivered, no challan.
    linkStatus: "no_dc_update",
    unit: "POs",
    source: "Procurement Orders + Purchase Order Item + PO Delivery Documents",
    conditions: [
      "billing_status is not 'Non-Billable'",
      `status is one of: ${LIVE_PO_STATUSES}`,
      "the PO has NO non-stub Delivery Challan",
    ],
    formula:
      "count POs having at least one item where category ≠ 'Additional Charges' AND received_quantity > 0",
    note: "Any one challan clears the whole PO — a challan covering only part of the delivery still counts as filed. Same number as the project's \"DC Pending\" tile.",
  },
];

export interface ColumnGroup {
  label: string;
  span: number;
}
export const COLUMN_GROUPS: ColumnGroup[] = [
  { label: "Project", span: 3 },
  { label: "DPR · Daily (excl. Sun)", span: 3 },
  { label: "Inventory · Weekly (Mon)", span: 3 },
  // NOT "(Billable)" any more: Disp PO and Missing DN are Billable-only but Total DN
  // counts both, so a blanket suffix on the group would be false for one of the three.
  // The per-column truth lives in the info dialog and the Total DN hover.
  { label: "Delivery Notes", span: 3 },
  { label: "Delivery Challans (Billable)", span: 2 },
];
