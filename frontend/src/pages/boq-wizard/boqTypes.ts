// Shared wizard types for the BoQ Upload wizard (Module 2b onward).
// Both BoqUploadScreen and BoqHubPage import from here -- do NOT duplicate.

/**
 * Friendly display labels for all 21 parser role values.
 * Single source of truth -- SheetConfigPanel's ROLES_BY_GROUP and SheetDataGrid
 * badges both derive from here to prevent label drift.
 */
export const ROLE_LABELS: Record<string, string> = {
  sl_no: "Serial No.",
  description: "Description",
  unit: "Unit",
  qty: "Quantity",
  qty_total: "Total Quantity",
  rate_supply: "Rate (Supply)",
  rate_install: "Rate (Install)",
  rate_combined: "Rate (Combined)",
  rate_supply_by_area: "Rate Supply (per area)",
  rate_install_by_area: "Rate Install (per area)",
  rate_combined_by_area: "Rate Combined (per area)",
  amount_supply: "Amount (Supply)",
  amount_install: "Amount (Install)",
  amount_total: "Amount (Total)",
  amount_combined: "Amount (Combined)",
  amount_by_area: "Amount (per area)",
  make_model: "Make / Model",
  row_notes: "Row Notes",
  append_to_notes: "Append to Notes",
  reference_images: "Reference Images",
  ignore: "Ignore",
};

/**
 * Per-column role assignment for the column-role map shared between
 * SheetConfigPanel (editor, Slice 3d-ii+) and SheetDataGrid (annotator, Slice 3d-iii).
 * `area` is null for single-area sheets or when no area has been assigned.
 *
 * Backend blob shape (Slice 3d-ii): column_role_map: { [col]: {role, area} } objects.
 * Non-area-compatible roles always get area: null (enforced in handleSave).
 * Area-required (*_by_area) roles flag empty area in the UI; save proceeds with null.
 */
export interface ColumnRoleEntry {
  role: string;
  area: string | null;
}

export type WizardStatus =
  | ""
  | "Pending"
  | "Hidden"
  | "Reviewed"
  | "Skip"
  | "General specs"
  | "Parse failed";

/**
 * Whole-BoQ work-package map returned by get_boq_work_packages.
 * { sheet_name: [work_header, ...] }
 * Sheets with no assignments are omitted (absent key !== empty array).
 */
export type WorkPackageMap = Record<string, string[]>;

/** One row in BoQ Sheet Draft.work_packages child table (feat b14e9015). */
export interface BoQSheetWorkPackage {
  /** Frappe child-row docname. */
  name: string;
  /** Docname of the linked Work Headers record. */
  work_header: string;
}

export interface BoQSheetDraft {
  /** Frappe child-row docname. */
  name: string;
  /**
   * EXACT sheet name as stored in the DB. Frappe does NOT strip whitespace from
   * Data fields on BoQ Sheet Draft (verified via live test 2026-05-31). A sheet
   * named "  Electrical (Rev-2) " is stored and matched verbatim by the backend.
   * Use this value verbatim as React key and in any endpoint call (2b-ii).
   * Trimming is allowed only for visual display.
   */
  sheet_name: string;
  sheet_order: number;
  wizard_status: WizardStatus;
  /** Work Headers assigned to this sheet (multi-link child table, feat b14e9015). */
  work_packages?: BoQSheetWorkPackage[];
  sheet_label?: string;
  /**
   * Per-sheet parser config JSON blob (feat b14e9015; Section 1/2 written by Slice 3c).
   * Frappe JSON fields return as parsed objects via useFrappeGetDoc; string handles
   * any serialized fallback. Write via set_sheet_config (whole-blob replace --
   * always read-modify-write to preserve column_role_map and other keys).
   */
  sheet_config?: Record<string, unknown> | string | null;
}

// ── Preview response types (Slice 3b-i endpoint, feat bf1a2e64) ───────────────

/** One row in a get_sheet_preview response. */
export interface SheetPreviewRow {
  row_number: number;
  /** Keyed by Excel column letter (A, B, ...). Null represents an empty cell. */
  cells: Record<string, string | number | boolean | null>;
}

/**
 * Full response shape of the get_sheet_preview endpoint.
 * URL: /api/method/nirmaan_stack.api.boq.wizard.sheet_preview.get_sheet_preview
 */
export interface SheetPreviewResponse {
  sheet_name: string;
  start_row: number;
  end_row_requested: number;
  rows: SheetPreviewRow[];
  returned_count: number;
  /** True when the sheet has rows beyond end_row_requested. */
  has_more: boolean;
}

export interface BOQsDoc {
  name: string;
  /** Human-readable title derived from the uploaded filename. */
  boq_name: string;
  version: number | null;
  tax_treatment: "Pre-tax" | "Post-tax";
  notes: string;
  /** Docname of the linked Projects record. Present on all BoQs created via the wizard. */
  project?: string;
  /** All sheet drafts for this workbook -- returned automatically by Frappe get_doc. */
  sheet_drafts: BoQSheetDraft[];
  /**
   * Exact sheet name of the designated general-specifications sheet, "" or undefined
   * when none is set.
   *
   * IMPORTANT (M2.16): The "General specs" status badge on a card is DERIVED from
   * this pointer, never from BoQSheetDraft.wizard_status. The backend never writes
   * "General specs" to wizard_status. Do NOT write "General specs" to wizard_status
   * in frontend code either -- always read/write the pointer via this field.
   */
  general_specs_sheet?: string;
}
