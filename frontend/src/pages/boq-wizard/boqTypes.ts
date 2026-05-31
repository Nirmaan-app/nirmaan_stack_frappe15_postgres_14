// Shared wizard types for the BoQ Upload wizard (Module 2b onward).
// Both BoqUploadScreen and BoqHubPage import from here -- do NOT duplicate.

export type WizardStatus =
  | ""
  | "Pending"
  | "Hidden"
  | "Reviewed"
  | "Skip"
  | "General specs"
  | "Parse failed";

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
}

export interface BOQsDoc {
  name: string;
  /** Human-readable title derived from the uploaded filename. */
  boq_name: string;
  version: number | null;
  tax_treatment: "Pre-tax" | "Post-tax";
  notes: string;
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
