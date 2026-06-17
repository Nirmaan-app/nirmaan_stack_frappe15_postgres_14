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
  amount_supply_by_area: "Amount Supply (per area)",
  amount_install_by_area: "Amount Install (per area)",
  amount_total_by_area: "Amount Total (per area)",
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
  | "Config Done"
  | "Skip"
  | "General specs"
  | "Parse failed"
  | "Parsed"
  | "Finalized";

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
  /**
   * Set to 1 by the parse worker when it marks a sheet "Parsed". Never cleared.
   * Dirty-detection contract: wizard_status="Config Done" + has_prior_parse=1 means
   * the sheet was parsed then had its config changed (parse is stale).
   */
  has_prior_parse?: 0 | 1;
  /** UTC datetime of the most recent successful parse for this sheet. Never cleared. */
  last_parsed_at?: string | null;
  /**
   * #164: 1 while this sheet is under active parse / re-parse (set at enqueue,
   * reconciled at worker start, blanket-cleared on completion). The frontend
   * parse-lock reads this to disable card actions, the spoke config panel, and
   * the review screen for the duration. Flows automatically on useFrappeGetDoc("BOQs").
   */
  parse_in_progress?: 0 | 1;
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

/**
 * Full response shape of the get_sheet_preview_full endpoint (feat 196ed765) --
 * a single-pass full-sheet read (no window). ADDITIVE: distinct from
 * SheetPreviewResponse, which stays the contract for the windowed get_sheet_preview
 * that SheetSpokePage still uses. No start_row/end_row_requested (no window).
 * URL: /api/method/nirmaan_stack.api.boq.wizard.sheet_preview.get_sheet_preview_full
 */
export interface SheetPreviewFullResponse {
  sheet_name: string;
  rows: SheetPreviewRow[];
  returned_count: number;
  /** Always false for a full read; kept for shape-compat with SheetPreviewResponse. */
  has_more: boolean;
}

/** One row in BoQ General Specs Sheet child table (Slice 2c). */
export interface BoQGeneralSpecsSheetRow {
  /** Frappe child-row docname. */
  name: string;
  /** The Excel sheet name designated as a general-specifications sheet. EXACT match. */
  source_sheet_name: string;
  /** Preamble text extracted by the parse worker. Empty until parsed. */
  preamble_text?: string;
}

/** Payload of the "boq:parse_run_done" socket event (parse_run.py _publish_parse_event). */
export interface ParseRunDonePayload {
  status: "success" | "error";
  boq_name: string;
  // success fields
  parsed_sheets?: string[];
  not_parsed_sheets?: string[];
  failed_sheets?: string[];
  // error fields
  error_code?: "missing_file" | "fetch_failed" | "no_eligible_sheets" | "parse_failed" | "internal";
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
   * General-specifications sheets for this workbook (Slice 2c, replaces the former scalar
   * general_specs_sheet field). Serializes directly on the BOQs parent via useFrappeGetDoc
   * because it is a first-level child table (not a grandchild like work_packages), so no
   * separate read endpoint is needed -- read from this array directly.
   *
   * IMPORTANT (M2.16): The "General specs" status badge on a card is DERIVED from
   * this array (set membership on source_sheet_name), never from BoQSheetDraft.wizard_status.
   * The backend never writes "General specs" to wizard_status. Do NOT write "General specs"
   * to wizard_status in frontend code either.
   */
  general_specs_sheets?: BoQGeneralSpecsSheetRow[];
  /**
   * Transient parse-job marker (Bucket-2 Slice 1, feat cb86b92b).
   * Set to 1 by run_parse after successful enqueue; cleared to 0 by
   * _publish_parse_event at the parse-run choke-point. Frontend uses
   * this to recover parseInFlight on hub mount (Bucket-2 Slice 2).
   */
  parse_in_progress?: 0 | 1;
}

// ── Review screen types (Slice B1) ─────────────────────────────────────────────

/**
 * One per-area rate cell: rate_by_area[area] is this nested object (Slice C-v2d).
 * Inner keys mirror the parser's _RATE_ROLE_TO_KIND values. All optional -- a sheet
 * may surface only one rate kind.
 */
export interface RateByAreaCell {
  supply_rate?: number | null;
  install_rate?: number | null;
  combined_rate?: number | null;
}

/**
 * One per-area amount cell: amount_by_area[area] is this nested object (field-set
 * Slice 2a). Inner keys mirror the parser's _AMOUNT_ROLE_TO_KIND values. All optional --
 * a sheet may surface only one amount kind. The storage field stays `amount_by_area`
 * (the analog of `rate_by_area`); only the per-area ROLE was renamed/split.
 */
export interface AmountByAreaCell {
  supply?: number | null;
  install?: number | null;
  total?: number | null;
}

/** One entry in a BoQ Review Row's edit_log JSON list. */
export interface EditLogEntry {
  field: string;
  from: unknown;
  to: unknown;
  by: string;
  at: string;
  /** Optional free-text reason captured per edit (Slice C-v1). Absent on legacy entries. */
  reason?: string;
  /** Per-area edit target (Slice C-v2d). Absent on flat-field entries. */
  area?: string;
  /** Inner rate kind for rate_by_area edits (Slice C-v2d). Absent otherwise. */
  rate_subkey?: string;
}

/**
 * One BoQ Review Row as returned by get_review_rows.
 * Includes all DB fields plus effective_classification / effective_parent_index
 * added by resolve_effective on the backend.
 * JSON list/dict fields are returned as parsed Python objects (lists/dicts, not strings).
 */
export interface ReviewRow {
  name: string;
  boq: string;
  sheet_name: string;
  source_row_number: number;
  row_index: number;
  // hierarchy
  classification: string | null;
  level: number | null;
  parent_index: number | null;
  path: string | null;
  attached_to_index: number | null;
  attached_notes: unknown[] | null;
  // classifier metadata
  promoted_from_line_item: 0 | 1;
  preamble_level_override: number | null;
  preamble_candidate_score: number | null;
  preamble_candidate_signals: unknown[] | null;
  needs_classification_review: 0 | 1;
  review_reason: string | null;
  // content
  sl_no_value: string | null;
  description: string | null;
  unit: string | null;
  make_model: string | null;
  is_rate_only: 0 | 1;
  is_synthetic: 0 | 1;
  // quantities / rates / amounts
  qty_total: number | null;
  qty_by_area: Record<string, number> | null;
  rate_supply: number | null;
  rate_install: number | null;
  rate_combined: number | null;
  // rate_by_area is NESTED (Slice C-v2d type fix): {area: {supply_rate, install_rate,
  // combined_rate}} -- NOT a flat {area: number}. resolveDescriptorValue walks the
  // extra rate_subkey hop. No static read site indexes it directly.
  rate_by_area: Record<string, RateByAreaCell> | null;
  amount_total: number | null;
  amount_supply: number | null;
  amount_install: number | null;
  // amount_by_area is NESTED (field-set Slice 2a): {area: {supply, install, total}} --
  // NOT a flat {area: number}. The storage field name is kept (analog of rate_by_area);
  // resolveDescriptorValue walks the extra amount-kind hop. No static read site indexes
  // it directly. The per-area amount EDIT path is Slice 2b.
  amount_by_area: Record<string, AmountByAreaCell> | null;
  // notes / warnings
  row_notes: string | null;
  append_notes_raw: Record<string, unknown> | null;
  validation_warnings: unknown[] | null;
  classifier_warnings: unknown[] | null;
  // human edit layer
  human_classification: string | null;
  human_parent: number | null;
  // Slice 1b-alpha: human-root override (Option B). A SEPARATE Check field, orthogonal
  // to human_parent (the -1 sentinel value space is unchanged). 1 => the human re-rooted
  // this row to top-level (effective_parent_index is null); human_parent is -1 in that
  // case (consistency invariant). 0/null => not human-rooted.
  human_is_root: number | null;
  edit_log: EditLogEntry[] | null;
  edited_by: string | null;
  edited_at: string | null;
  // human-only annotation (Slice C-v2c). A remark is NOT an edit -- it never sets
  // edited_at / edit_log and never flips the row to "Edited". Born empty (the parser
  // write path leaves it unset); written only via save_review_remark.
  remarks: string | null;
  // C-flag-dismissal: per-row "Looks OK" acknowledgment of the row's advisory flags.
  // A dismissal is NOT an edit -- it never sets edited_at / edit_log and never flips the
  // row to "Edited" (written only via dismiss_row_flags, the remark-pattern bypass). 1 =>
  // dismissed; an edit re-opens it (chokepoint clear); re-parse wipes it (Check defaults 0).
  flags_dismissed?: number;          // 0 | 1
  flags_dismissed_by?: string | null;
  flags_dismissed_at?: string | null;
  // effective values (computed by resolve_effective on backend)
  effective_classification: string | null;
  effective_parent_index: number | null;
}

/**
 * One column descriptor as returned by get_review_rows (Slice B1.1a, feat 58d2ed44).
 * Compiled from sheet_config.column_role_map on the backend. Non-display roles
 * (append_to_notes, ignore, reference_images) excluded. Sorted Excel order.
 *
 * Value resolution:
 *   row[value_field]                          -- singleton roles
 *   row[value_field][value_key]               -- qty/amount by area
 *   row[value_field][value_key][rate_subkey]  -- rate_*_by_area
 */
export interface ColumnDescriptor {
  col: string;                 // Excel column letter (column_role_map key)
  role: string;                // raw ColumnRole string
  area: string | null;         // area name for by-area roles, else null
  value_field: string;         // top-level ReviewRow field to read
  value_key: string | null;    // dict key within value_field for by-area fields
  rate_subkey: string | null;  // inner key within rate_by_area[area], else null
}

/**
 * One advisory flag as returned by get_review_rows (Slice B2a single-source).
 * Computed by the backend _compute_advisory_flags helper.
 * type: "priced_preamble_no_children" | "zero_amount_line_item" | "orphan" | "parser"
 */
export interface AdvisoryFlag {
  type: string;
  row_index: number;
  source_row_number: number;
  reason: string;
}

/** Response shape of get_review_rows. */
export interface GetReviewRowsResponse {
  rows: ReviewRow[];
  work_packages: string[];
  column_descriptors: ColumnDescriptor[];
  flags: AdvisoryFlag[];
}

/**
 * Response shape of save_review_edit (Slice C-v1 added `edited_at` for the
 * save-status anchor; Slice C-v2 reads it on a resolved save).
 * NOTE: the endpoint REJECTS (frappe.throw -> HTTP 417) on validation failure
 * rather than returning ok:false, so callers catch the thrown error.
 */
export interface SaveReviewEditResponse {
  ok: boolean;
  row_index: number;
  field: string;
  from: unknown;
  to: unknown;
  edited_at: string;
  effective: Record<string, unknown>;
  /** Per-area target echo (Slice C-v2d). null on the flat-field path. */
  area?: string | null;
  rate_subkey?: string | null;
}

// ── Structural break types (from check_structural_integrity / get_structural_breaks) ──

export interface StructuralBreakOrphan {
  type: "orphan";
  row_index: number;
  source_row_number: number;
  reason: string;
}

export interface StructuralBreakLineItemAsParent {
  type: "line_item_as_parent";
  row_index: number;
  source_row_number: number;
  parent_row_index: number;
  reason: string;
}

export interface StructuralBreakCycle {
  type: "cycle";
  row_index: number;
  source_row_number: number;
  reason: string;
}

export type StructuralBreak =
  | StructuralBreakOrphan
  | StructuralBreakLineItemAsParent
  | StructuralBreakCycle;

/** Response shape of get_structural_breaks. */
export interface GetStructuralBreaksResponse {
  breaks: StructuralBreak[];
}

// ── Finalized marking (Slice D1; renamed A1) ──────────────────────────────────

/**
 * Response shape of mark_sheet_parsed_check_done.
 *  - ok:false + breaks  -> structural issues found; caller escalates to a warn dialog
 *    and may re-POST with confirm:true.
 *  - ok:true + status + overridden -> the sheet is now "Finalized"
 *    (overridden true iff breaks existed but were confirmed past).
 */
export interface MarkParsedCheckDoneResponse {
  ok: boolean;
  breaks?: StructuralBreak[];
  status?: string;
  overridden?: boolean;
}

/** Response shape of unmark_sheet_parsed_check_done (reverts to "Parsed"). */
export interface UnmarkParsedCheckDoneResponse {
  ok: boolean;
  status: string;
}

// ── Commit UI types (Phase 5 Slice 4b) ────────────────────────────────────────

/**
 * One commit-eligible sheet from get_committable_sheets (the READ-ONLY gate).
 * disposition tells the commit pipeline which write path the sheet uses; the UI
 * shows it as an optional hint. Eligibility ≠ committed-state (see below).
 */
export interface CommittableSheet {
  sheet_name: string;
  disposition: "general_specs" | "finalized";
}

/** Response shape of get_committable_sheets. */
export interface GetCommittableSheetsResponse {
  committable_sheets: CommittableSheet[];
}

/**
 * One sheet's CURRENT committed-state from get_committed_state (Slice 4a),
 * sourced from the BoQ Committed Sheet Grid is_current=1 row. sheet_name is the
 * source_sheet_name VERBATIM (#152) -- join to drafts byte-for-byte, no trim.
 * NOT a BoQSheetDraft field and NOT a WizardStatus value -- committed-ness is a
 * SEPARATE marker shown alongside the status pill.
 */
export interface CommittedSheetState {
  sheet_name: string;
  committed_at: string | null;
  commit_version: number;
}

/** Response shape of get_committed_state (Phase 5 Slice 4a endpoint). */
export interface GetCommittedStateResponse {
  committed_state: CommittedSheetState[];
}
