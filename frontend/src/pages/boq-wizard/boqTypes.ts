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

/**
 * One "skip rows after header" definition (header-config redesign). The field is a structured
 * list of these instead of a single comma-list: each entry skips EITHER one row OR an inclusive
 * row range. Resolved to a flat row-number set by skipRows.resolveSkipDefinitions; the legacy
 * flat skip_top_rows_after_header list round-trips via skipRows.defsFromLegacyList.
 */
export type SkipDefinition =
  | { kind: "single"; row: number }
  | { kind: "range"; start: number; end: number };

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
  /**
   * AI-2c: 1 while this sheet is under an active AI pass (set at enqueue, cleared in the
   * _publish_ai_event choke-point on completion). Mirror of parse_in_progress. The review
   * screen reads this to disable "Run AI pass" + show the "AI pass running…" chip, and to
   * recover an in-flight pass on mount. Flows automatically on useFrappeGetDoc("BOQs").
   * NOTE: unlike parse_in_progress this does NOT make the screen read-only -- an AI pass
   * only writes the ai_* suggestion fields, never human/parser data.
   */
  ai_in_progress?: 0 | 1;
  /**
   * DUAL-AI (ADR-0003): 1 while this sheet is under an active GEMINI pass. Exact mirror of
   * ai_in_progress for the gemini_* provider (set at enqueue in run_gemini_pass, cleared in the
   * _publish_gemini_event choke-point on completion). The review screen reads this to disable
   * "Run Gemini pass" + show the "Gemini pass running…" chip, and to recover an in-flight pass on
   * mount. Flows automatically on useFrappeGetDoc("BOQs"). Like ai_in_progress (and UNLIKE
   * parse_in_progress) this does NOT make the screen read-only -- a Gemini pass only writes the
   * gemini_* suggestion fields, never human/parser data.
   */
  gemini_in_progress?: 0 | 1;
  /**
   * Per-sheet PARSE-failure stamp (Slice 1a, reactive #166). Ride the BOQs payload
   * (child-table fields on BoQ Sheet Draft) -- no separate fetch. category is one of the
   * three in-scope failures (matches the doctype Select); reason is the specific why;
   * at is when it was captured. All cleared on a successful parse. F2 reads these for the
   * "needs attention" indicator. Absent/blank/null => no recorded parse failure.
   */
  parse_failure_category?: "" | "Config stale" | "Parser error" | "Insert error" | null;
  parse_failure_reason?: string | null;
  parse_failure_at?: string | null;
  /**
   * Per-sheet COMMIT-failure stamp (Slice F1). Rides the BOQs payload like parse_failure_*.
   * No category (commit exceptions are freeform). reason is the flattened message; at is the
   * capture time. Cleared on a successful commit. Absent/null => no recorded commit failure.
   */
  commit_failure_reason?: string | null;
  commit_failure_at?: string | null;
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

/**
 * Payload of the `boq:ai_pass_done` realtime event (AI-2c, ai_assist._publish_ai_event).
 * User-targeted; room-targeted + not replayed -- a client that misses it recovers via
 * get_ai_pass_status polling. Shape: {status, boq_name, sheet_name, **kwargs} where the
 * success kwarg is `count` and the error kwarg is `error_code` ("ai_failed" | "internal").
 */
export interface AiPassDonePayload {
  status: "success" | "error";
  boq_name: string;
  sheet_name: string;
  count?: number;
  error_code?: string;
}

/**
 * Payload of the `boq:gemini_pass_done` realtime event (DUAL-AI, ADR-0003;
 * gemini_assist._publish_gemini_event). User-targeted; room-targeted + not replayed -- a
 * client that misses it recovers via get_gemini_pass_status polling. Shape:
 * {status, boq_name, sheet_name, **kwargs}. NOTE: unlike AiPassDonePayload (whose success
 * kwarg is `count`) the Gemini SUCCESS kwargs are `rows_done` + `token_total`; the ERROR
 * kwarg is `error_code` ("gemini_failed" | "internal"). Field names confirmed against
 * _publish_gemini_event / _run_gemini_pass_worker in gemini_assist.py.
 */
export interface GeminiPassDonePayload {
  status: "success" | "error";
  boq_name: string;
  sheet_name: string;
  rows_done?: number;
  token_total?: number;
  error_code?: string;
}

/**
 * Response shape of run_gemini_pass (DUAL-AI, ADR-0003). Mirror of run_ai_pass's inline
 * return type, with TWO deliberate differences (confirmed vs gemini_assist.py):
 *   - NO `cached` field -- the Gemini module has NO result cache (only the missed-socket
 *     status fallback); a re-run is always a fresh enqueue.
 *   - adds `job_id` (the enqueued job id, or null) -- run_ai_pass does not return one.
 * Pre-flight {ok:false} rejections set `error` to one of:
 *   "not_parsed" | "gemini_disabled" | "frozen" | "parsing" | "in_progress".
 * The unwrapped frappe-react-sdk `message` is this object.
 * URL: nirmaan_stack.api.boq.wizard.gemini_assist.run_gemini_pass
 */
export interface RunGeminiPassResponse {
  ok: boolean;
  error?: string;
  enqueued?: boolean;
  job_id?: string | null;
}

/**
 * Response shape of get_gemini_pass_status (DUAL-AI, ADR-0003). Mirror of the Claude-side
 * AiStatusResponse: EITHER the cached terminal GeminiPassDonePayload, OR the idle shape
 * carrying the live gemini_in_progress flag (note: gemini_in_progress, NOT ai_in_progress).
 * URL: nirmaan_stack.api.boq.wizard.gemini_assist.get_gemini_pass_status
 */
export type GeminiStatusResponse =
  | GeminiPassDonePayload
  | { status: "idle_or_unknown"; gemini_in_progress: 0 | 1 };

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
  // AI suggestion layer (AI-1 / AI-2d). Written by the AI pass (run_ai_pass worker)
  // + the accept/reject endpoint; never by the parser or human edit layer. Applied by
  // resolve_effective ONLY when ai_suggestion_status === "Accepted" and no human override
  // (the four-layer chain: human_is_root > human_parent > ai_suggested_is_root >
  // ai_suggested_parent > parser). -1 sentinel on ai_suggested_parent = "no parent-index
  // suggestion" (root is carried by ai_suggested_is_root, AI-2d). AI-3a surfaces these
  // read-only (badges + status + tint); the accept/reject flow is AI-3b.
  ai_suggested_classification?: string | null;
  ai_classification_confidence?: "High" | "Medium" | "Low" | null;
  ai_suggested_parent?: number | null;
  ai_parent_confidence?: "High" | "Medium" | "Low" | null;
  ai_suggested_is_root?: 0 | 1;
  ai_suggested_level?: number | null;
  ai_explanation?: string | null;
  ai_suggestion_status?: "Pending" | "Accepted" | "Rejected" | null;
  // AI-3c-2b: true when an AI acceptance on this row can still be reverted (the backend
  // captured a pre-accept snapshot on accept; cleared by a later classification/parent edit
  // or by finalize). Computed by get_review_rows from ai_accept_snapshot; the raw blob is
  // never shipped. Drives the Revert AI change button (enabled iff revert_available && !readOnly).
  revert_available?: boolean;
  // R3a (ADR-0006): true when the row is NOT at the parser baseline -- it carries a standing
  // change, i.e. an accepted AI suggestion (either provider's *_suggestion_status === "Accepted")
  // OR a manual human_* override. Computed by get_review_rows. AI Apply (Claude or Gemini) is
  // DISABLED while this is true (apply must never silently overwrite a standing decision); the
  // unified "Revert to parser" affordance is shown whenever it is true and restores the row (and
  // any children a restructure moved) to the parser baseline, after which AI Apply re-enables.
  has_override?: boolean;

  // ── DUAL-AI (ADR-0003) -- GEMINI suggestion layer. ADDITIVE-ONLY. ───────────────
  // EXACT mirror of the ai_* block above for the second provider (Gemini), same optionality
  // and union types. Written by the Gemini pass (run_gemini_pass worker) + the
  // accept/reject/revert gemini endpoints; never by the parser or the human edit layer.
  // resolve_effective is CLAUDE-ONLY -- it does NOT read or echo any gemini_* field, so these
  // are surfaced purely from get_review_rows's explicit fetch list (read-only display +
  // the symmetric accept/reject/revert flow). -1 sentinel on gemini_suggested_parent =
  // "no parent-index suggestion" (root is carried by gemini_suggested_is_root). The status
  // badge is SOURCE-TAGGED ("Accepted · Gemini") when gemini_suggestion_status === "Accepted";
  // only one of ai_suggestion_status / gemini_suggestion_status can be "Accepted" at a time.
  gemini_suggested_classification?: string | null;
  gemini_classification_confidence?: "High" | "Medium" | "Low" | null;
  gemini_suggested_parent?: number | null;
  gemini_parent_confidence?: "High" | "Medium" | "Low" | null;
  gemini_suggested_is_root?: 0 | 1;
  gemini_suggested_level?: number | null;
  gemini_explanation?: string | null;
  gemini_suggestion_status?: "Pending" | "Accepted" | "Rejected" | null;
  // DUAL-AI mirror of revert_available: true when a Gemini acceptance on this row can still be
  // reverted (the backend captured gemini_accept_snapshot on accept; cleared by a later
  // classification/parent edit, a Claude accept routed through the chokepoint, or finalize).
  // Computed by get_review_rows from gemini_accept_snapshot; the raw blob is never shipped.
  // Drives the Revert Gemini change button (enabled iff gemini_revert_available && !readOnly).
  gemini_revert_available?: boolean;
  // The audit-only "winning" Source for this row (parser/claude/gemini/manual), set ENTIRELY by
  // the shared write chokepoint (_apply_and_save_row_edit) from the edit reason string. MINIMUM
  // UI FOOTPRINT (LOCKED, ADR-0003 sec 8A): NO dedicated column/badge/widget/filter -- the
  // winning Source is conveyed SOLELY by the source-tagged status badge (Accepted·Claude /
  // Accepted·Gemini; manual reads "Edited"; untouched reads "Original"/parser).
  chosen_source?: "parser" | "claude" | "gemini" | "manual";
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
 * type: "orphan" | "parser" | "classifier_warning"
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
  // DUAL-AI (ADR-0003): the Gemini enable flag, surfaced top-level by get_review_rows from
  // Document AI Settings.boq_ai_enabled (read perm-bypassing, fails closed to false). The
  // frontend gates the Gemini column + accept block on this. NOTE: there is NO `ai_enabled`
  // sibling in this response -- Claude's enable lives in a separate settings home and is read
  // elsewhere; only gemini_enabled rides this payload.
  gemini_enabled?: boolean;
}

/**
 * A committed row as returned by get_priced_rows (Phase 5 pricing-overlay read) -- a
 * ReviewRow with the overlay's PRICED MARKERS merged in. The overlay
 * (pricing.py get_priced_rows) stamps the saved rate into rate_by_area[area][kind] / the
 * scalar rate field IN PLACE (so the existing rate fields already carry the price), and
 * ADDS these marker fields, driven by the pricing layer's is_filled flag -- NEVER a
 * zero-check (a committed 0.0 rate can be a valid priced value). All optional: an absent
 * marker => the cell is un-priced.
 *
 * Extends ReviewRow so the ReviewRow-typed reviewRender helpers (computeDepths,
 * resolveDescriptorValue, ClassificationPill) accept a PricedRow without retyping.
 */
export interface PricedRow extends ReviewRow {
  /** The PRICEABILITY axis (Slice 3e): "Preamble" / "Line Item" = priceable; "Other" =
   *  non-priceable. Surfaced by get_priced_rows so the grid's per-row priceability gate
   *  keys on the SAME field the server guard uses. Optional (an old/absent payload -> the
   *  helper treats it as non-priceable). */
  node_type?: "Preamble" | "Line Item" | "Other" | null;
  /** Per-area priced markers: priced_by_area[areaName][rateKind] === true => that
   *  per-area rate cell carries a saved price. (rateKind: supply_rate/install_rate/combined_rate.) */
  priced_by_area?: Record<string, Record<string, boolean>> | null;
  /** Scalar rate priced markers (one per scalar rate field). true => priced. */
  priced_rate_supply?: boolean;
  priced_rate_install?: boolean;
  priced_rate_combined?: boolean;
  /**
   * Slice 4a: the current per-ROW remark merged by get_priced_rows (null/absent = none).
   * A remark is annotation, NOT a price -- it never affects the priced markers.
   */
  remark?: string | null;
  /**
   * Slice 4a: the current per-CELL colors for this row, keyed by Excel col_letter
   * (the value is a ColorToken). ABSENT (or missing key) => that cell has no color.
   * A color is pure visual annotation rendered on a SEPARATE channel (a left border),
   * never the emerald/amber priced background the system owns.
   */
  color_by_cell?: Record<string, string>;
}

/**
 * The 8 stable color TOKENS for the per-cell highlight (Slice 4a). Stored as tokens
 * (NOT hex) by BoQ Cell Color; the frontend maps token -> swatch / border class. MUST
 * stay in sync with the Select options on the BoQ Cell Color doctype.
 */
export const COLOR_TOKENS = [
  "red", "orange", "yellow", "green", "blue", "purple", "pink", "grey",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/**
 * Per-ROW remark save args the PricingGrid hands up to the page's onSaveRemark (Slice 4a).
 * The grid supplies the row identity; the page fills boq_name / sheet_name /
 * committed_version, then POSTs save_row_remark. A blank `remark` clears.
 */
export interface RemarkSaveArgs {
  /** row.source_row_number (the Excel row). */
  excelRow: number;
  /** the note text; "" clears the remark. */
  remark: string;
  /** row.description -- the copy-forward MATCH GUARD (optional, sent when present). */
  description?: string;
}

/**
 * Per-CELL color save args (Slice 4a). The grid hands up an ARRAY (one entry per cell --
 * a single pick is one entry, an apply-to-row is N entries); the page POSTs each via
 * save_cell_color then mutate()s once. A blank `color` clears that cell.
 */
export interface ColorSaveArgs {
  /** row.source_row_number (the Excel row). */
  excelRow: number;
  /** the descriptor's col (Excel column letter). */
  colLetter: string;
  /** a ColorToken; "" clears the cell's color. */
  color: string;
  /** row.description -- the copy-forward MATCH GUARD (optional, sent when present). */
  description?: string;
}

/**
 * Single-editor pricing lock state (slice A backend: pricing_lock.read_lock_info).
 * Present on get_priced_rows when the committed sheet+version is locked; `null` when free.
 * A lock is acquired on the holder's FIRST save_cell_price and goes stale 5 min after the
 * last edit. Slice B consumes this to gate the grid + show the holder's name.
 */
export interface LockInfo {
  /** The holder's User id (email). */
  locked_by_user: string;
  /** The holder's display full name (server-resolved). */
  locked_by_name: string;
  /** True when the session user IS the holder. */
  is_locked_by_me: boolean;
  /** ISO datetime of the holder's last edit (drives staleness). */
  last_edit_at: string | null;
  /** True when now - last_edit_at > 5 min (the lock is acquirable by another user). */
  is_stale: boolean;
}

// ── Amount-formula types (Formula Builder F1 storage / F2 evaluator) ───────────
//
// The wire shape of a stored amount formula (BoQ Cell Amount Formula). The frontend
// deserializes a saved formula record / a get_priced_rows column_formulas entry straight
// into these types -- the FIELD NAMES MATCH the backend doctype + token-tree shape exactly
// (value_field/value_key/rate_subkey, op/operands/ref). The pure evaluator (amountFormula.ts,
// F2) consumes these; the grid wiring (F4) produces the operand lookup + maps the result.

/**
 * One leaf operand reference in a formula token tree. Addresses a qty / rate / amount column
 * the way ColumnDescriptor / resolveDescriptorValue do (value_field -> value_key -> rate_subkey).
 * For a DEFAULT (area-wildcard) formula, an area-bound operand carries value_key === null
 * ("bind to the area being computed"); for an OVERRIDE / scalar, value_key is concrete / null.
 */
export interface AmountFormulaRef {
  value_field: string;
  value_key: string | null;
  rate_subkey: string | null;
}

/** An operator node: a product (`*`) or sum (`+`) of its (non-empty) operands. */
export interface AmountFormulaOperatorNode {
  op: "+" | "*";
  operands: AmountFormulaNode[];
}

/** A leaf node: a single operand reference. */
export interface AmountFormulaLeafNode {
  ref: AmountFormulaRef;
}

/**
 * One node of an amount-formula token tree. EITHER an operator node OR a leaf ref -- never a
 * numeric literal (literals are barred). Brackets are implicit in the nesting (the tree IS the
 * precedence).
 */
export type AmountFormulaNode = AmountFormulaOperatorNode | AmountFormulaLeafNode;

/**
 * One per-COLUMN amount formula, as delivered by get_priced_rows.column_formulas (and the
 * standalone get_sheet_amount_formulas read). Identity = (target_value_field, target_value_key,
 * target_rate_subkey). target_value_key === null = the area-WILDCARD logical-column DEFAULT (or
 * a scalar column); a concrete area string = a PER-AREA OVERRIDE (the discriminator is the
 * nullability -- no extra field). target_col is a re-resolve guard, not identity. `formula` is
 * the parsed token tree (null only defensively -- a current record always carries one).
 */
export interface ColumnFormula {
  target_value_field: string;
  target_value_key: string | null;
  target_rate_subkey: string | null;
  target_col: string | null;
  formula: AmountFormulaNode | null;
}

/**
 * Per-COLUMN amount-formula save args the AmountFormulaBuilder (F3) hands up to the page's
 * onSaveFormula (which POSTs save_amount_formula). The builder supplies the target column
 * identity + the parsed tree; the page fills boq / sheet / committed_version. `targetValueKey`
 * is the DEFAULT-vs-OVERRIDE discriminator: null = the area-wildcard default (or a scalar
 * column); a concrete area = a per-area override. `formula` null = the CLEAR path (the F1
 * blank-formula clear). targetCol / description are stored guards (not identity).
 */
export interface AmountFormulaSaveArgs {
  targetValueField: string;
  targetValueKey: string | null;
  targetRateSubkey: string | null;
  targetCol: string | null;
  description?: string;
  formula: AmountFormulaNode | null;
}

/**
 * Response shape of get_priced_rows (Phase 5 pricing-overlay read). DISTINCT from
 * GetReviewRowsResponse: no work_packages / flags; adds commit_version + the single-editor
 * lock fields (slice A): `editable` (precomputed gate -- false only when held fresh by
 * another user) + `lock_info` (the holder details, or null when free); and the F1
 * `column_formulas` (per-COLUMN amount formulas, never per-row).
 */
export interface GetPricedRowsResponse {
  rows: PricedRow[];
  column_descriptors: ColumnDescriptor[];
  /** The committed commit_version these prices price (null when nothing is committed). */
  commit_version: number | null;
  /** Precomputed gate: true if FREE / locked-by-me / stale; false only when held fresh by another. */
  editable: boolean;
  /** The current lock holder details, or null when the sheet+version is free. */
  lock_info: LockInfo | null;
  /** F1: per-COLUMN amount formulas for this committed version ([] when none / uncommitted). */
  column_formulas: ColumnFormula[];
  /**
   * Slice 4b-ACKNOWLEDGE: the current "reviewed / looks OK" dismissals for this committed
   * version, delivered as a SHEET-LEVEL list (NOT merged per-row, like column_formulas). The
   * strip filter turns it into an O(1) membership set keyed "<flag_kind>:<excel_row>" (the
   * strip's own list key). [] when none / uncommitted.
   */
  dismissals: DismissalRef[];
  /**
   * Cluster B: the current per-CELL formula-vs-document reconciliation choices for this
   * committed version, a flat PER-CELL list (carries col_letter, unlike dismissals). The grid
   * cue + the rollup build an O(1) map keyed "<excel_row>:<col_letter>". [] when none /
   * uncommitted. A cell NOT in this list is "unset" -> the document value wins (D1).
   */
  reconciliation_choices: ReconciliationChoiceRef[];
  /**
   * Deliberate per-sheet read-only lock (the lock/unlock slice). A SEPARATE key from `editable`
   * (the concurrency verdict): the page ORs the two into its `locked` boolean but keeps the
   * reason DISTINCT (a deliberate-lock teal banner vs the amber concurrency banner). false for an
   * uncommitted / grid-only sheet. Toggled by lock_sheet / unlock_sheet; persisted on BoQ Sheet,
   * cross-user; re-commit starts a fresh version UNLOCKED (the lock never carries forward).
   */
  is_locked: boolean;
}

// ── Slice 4b-A: the computed review-flag layer (Cluster A) ───────────────────────
// Pure DISPLAY-only types. The flag DERIVATION lives in priceability.ts (which imports
// PricingGrid's leaf predicates -> these types must live HERE so PricingGrid can consume
// RowReviewFlags as a prop WITHOUT importing priceability, which would be a cycle).

/**
 * A pricing AREA key: a concrete per-area name, or `null` -- the SCALAR sentinel for a
 * scalar (value_key === null) rate/qty column. The one key space the shared qty-bearing /
 * fully-priced predicates iterate over.
 */
export type AreaKey = string | null;

/**
 * The computed review-flag kinds (Slice 4b-A). All DERIVED on the fly from the delivered
 * row + descriptors + column_formulas -- never a stored field. broken / not_yet fire ONLY on
 * a PRICEABLE LINE and ONLY for a QTY-BEARING area's amount cell (option-(i), symmetric with
 * needs_rate -- a cert fix):
 *   needs_rate -- a priceable line with a qty-bearing area whose rate is not filled.
 *   qty_anomaly -- qty on a NON-priceable row type (the inverse guardrail).
 *   broken     -- a priceable qty-bearing amount cell's formula can't resolve (cycle / dangling).
 *   not_yet    -- a priceable qty-bearing amount cell's formula needs a not-yet-entered operand.
 *   divergence -- (Cluster B) a committed (document) amount and the formula-computed amount
 *                 DIFFER for the same amount cell AND the user has NOT yet chosen which wins
 *                 (an UNRESOLVED divergence; a resolved one drops from the active strip). Fires
 *                 ONLY when the formula yields a real number (kind === "value").
 * (The 4b-A `wont_compute` kind was removed before push -- superseded by the forthcoming
 * mandatory amount-formula-declaration gate. The `incomplete_subtotal` kind was also removed:
 * the per-subtotal review-STRIP entries were noise; the incomplete signal now surfaces as ONE
 * quiet panel-level message in SummaryPanel, read from RollupNode.incomplete, NOT the strip.)
 */
export type ReviewFlagKind =
  | "needs_rate"
  | "qty_anomaly"
  | "broken"
  | "not_yet"
  | "divergence";

/**
 * The per-row computed flags (Slice 4b-A). Booleans drive the in-grid markers + the count;
 * the detail arrays (areas / cols) drive the per-cell aim + the review-strip text. PURE --
 * computed by priceability.computeRowFlags.
 */
export interface RowReviewFlags {
  /** Priceable line with >=1 qty-bearing area not fully filled. */
  needsRate: boolean;
  /** The specific qty-bearing areas (AreaKey) on this row whose rate is not filled. */
  needsRateAreas: AreaKey[];
  /** Non-priceable row type carrying a non-zero qty (any area). */
  qtyAnomaly: boolean;
  /** An amount cell evaluates to {blank, broken} (saved-state). */
  broken: boolean;
  brokenCols: string[];
  /** An amount cell evaluates to {blank, not_yet} (saved-state). */
  notYet: boolean;
  notYetCols: string[];
}

/**
 * One entry in the unified review-list strip (Slice 4b-A extends the 4a remark feed in
 * place -- a SINGLE list, no fork). `kind` is "remark" (4a) or any computed flag kind; each
 * entry click-jumps to the row via the grid's scrollToRow handle.
 */
export interface ReviewEntry {
  kind: "remark" | ReviewFlagKind;
  /** the row's source_row_number (Excel row) -- the scrollToRow target. */
  excelRow: number;
  description: string;
  /** the human-readable line shown in the strip. */
  text: string;
}

/**
 * Slice 4b-ACKNOWLEDGE: one current "reviewed / looks OK" dismissal, as delivered by
 * get_priced_rows.dismissals. Identity = (excel_row, flag_kind). `flag_kind` is the SAME
 * value space as ReviewEntry["kind"] (the four computed flags PLUS "remark"), so a dismissal
 * matches an entry on the composite key "<flag_kind>:<excel_row>" (the strip's list key). NO
 * per-area dimension (a ReviewEntry folds its per-area detail into ONE entry per row per kind).
 */
export interface DismissalRef {
  excel_row: number;
  flag_kind: ReviewEntry["kind"];
}

/**
 * Slice 4b-ACKNOWLEDGE: the args the page sends to save_cell_dismissal. The strip hands up an
 * entry's (excelRow, kind) + the desired state; the page fills boq_name / sheet_name /
 * committed_version + description, then POSTs. `dismissed` false un-dismisses (re-shows).
 */
export interface DismissalSaveArgs {
  excelRow: number;
  flagKind: ReviewEntry["kind"];
  dismissed: boolean;
  /** row.description -- the copy-forward MATCH GUARD (optional, sent when present). */
  description?: string;
}

// ── Reconciliation-choice types (Cluster B: formula-vs-document per-cell choice) ──

/**
 * The two stored reconciliation choice tokens. MUST stay in sync with the Select options on
 * the BoQ Cell Reconciliation Choice doctype + the backend _CHOICE_TOKENS. "unset" is NOT a
 * token -- it is the ABSENCE of a current choice record (the default), and per the locked
 * design D1 the DOCUMENT value wins while unset.
 */
export type ReconChoice = "keep_document" | "take_formula";

/**
 * One current per-CELL reconciliation choice, as delivered by
 * get_priced_rows.reconciliation_choices. Identity = (excel_row, col_letter) within the
 * committed version. PER-CELL -- it carries col_letter (unlike the per-ROW DismissalRef),
 * because a divergence + its resolution is specific to one amount column.
 */
export interface ReconciliationChoiceRef {
  excel_row: number;
  col_letter: string;
  choice: ReconChoice;
}

/**
 * The args the grid hands up to the page's onSaveReconChoice (-> save_cell_reconciliation_choice).
 * The grid supplies the cell identity; the page fills boq_name / sheet_name / committed_version +
 * description, then POSTs. `choice` null CLEARS (revert to unset -> the document value wins).
 */
export interface ReconChoiceSaveArgs {
  excelRow: number;
  colLetter: string;
  choice: ReconChoice | null;
  /** row.description -- the copy-forward MATCH GUARD (optional, sent when present). */
  description?: string;
}

/** The live priced-count readout (Slice 4b-A): N of M priceable lines fully priced. */
export interface PricedLineCount {
  /** N -- priceable lines that are FULLY priced (every qty-bearing area's rate filled). */
  priced: number;
  /** M -- priceable lines (priceable type AND qty-bearing in >=1 area). */
  total: number;
}

/**
 * Per-cell save args the PricingGrid hands up to the page's onSaveRate (Phase 5 Slice 3b).
 * The grid supplies the cell IDENTITY (from the row + the rate descriptor); the page fills
 * boq_name / sheet_name / committed_version + the typed rate, then POSTs save_cell_price.
 */
export interface RateCellSaveArgs {
  /** row.source_row_number (the Excel row -- NOT row_index). */
  excelRow: number;
  /** the rate descriptor's col (Excel column letter). */
  colLetter: string;
  /** per-area: the descriptor's value_key (= area); scalar: omitted. */
  area?: string;
  /** descriptor rate_subkey verbatim (per-area) / derived token (scalar). Guard field, NOT key. */
  rateKind: string;
  /** row.description -- the copy-forward MATCH GUARD (always sent). */
  description: string;
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

// `orphan` is NO LONGER emitted as a structural break (it is a soft advisory flag only);
// this interface is retained for documentation/back-compat but is intentionally NOT in the
// StructuralBreak union below.
export interface StructuralBreakOrphan {
  type: "orphan";
  row_index: number;
  source_row_number: number;
  reason: string;
}

// S2 hard gate: the two shared commit-validator breaks (#7 / #8), replacing the retired
// `line_item_as_parent`. `parent_row_index` is the row's effective_parent_index from the
// errored plan entry; typed `number | null` defensively (in practice always a real int when
// either error fires, since the validator only emits these when an in-plan parent exists).
export interface StructuralBreakPreambleParentLevel {
  type: "preamble_parent_level";
  row_index: number;
  source_row_number: number;
  parent_row_index: number | null;
  reason: string;
}

export interface StructuralBreakLineItemParentNotPreamble {
  type: "line_item_parent_not_preamble";
  row_index: number;
  source_row_number: number;
  parent_row_index: number | null;
  reason: string;
}

export interface StructuralBreakCycle {
  type: "cycle";
  row_index: number;
  source_row_number: number;
  reason: string;
}

export type StructuralBreak =
  | StructuralBreakPreambleParentLevel
  | StructuralBreakLineItemParentNotPreamble
  | StructuralBreakCycle;

/** Response shape of get_structural_breaks. */
export interface GetStructuralBreaksResponse {
  breaks: StructuralBreak[];
  // Slice B2a addition: the endpoint also returns advisory flags alongside breaks (the same
  // shape get_review_rows surfaces). R4's warnings panel reads `breaks` from this endpoint;
  // advisory flags come from get_review_rows on the page, but the field is declared here for
  // completeness with the backend contract.
  flags?: AdvisoryFlag[];
}

// ── Finalized marking (Slice D1; renamed A1) ──────────────────────────────────

/**
 * Response shape of mark_sheet_parsed_check_done (S2: now a FULLY HARD gate).
 *  - ok:false + breaks  -> structural breaks (#7 / #8 / cycle) exist; the sheet is NOT
 *    finalized. There is NO override: the Finalize button is disabled whenever breaks
 *    exist, so the caller only surfaces an error + refreshes the breaks panel. Re-POSTing
 *    never bypasses a break -- `confirm` is retained server-side for HTTP back-compat but
 *    is inert.
 *  - ok:true + status   -> the sheet is now "Finalized" (only ever when breaks is empty).
 */
export interface MarkParsedCheckDoneResponse {
  ok: boolean;
  breaks?: StructuralBreak[];
  status?: string;
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
  /**
   * Workbook tab order (committed BoQ Sheet.sheet_order; Slice 3d). null when no
   * current committed BoQ Sheet matches (defensive -- in practice every committed
   * sheet carries one). Drives the in-editor sheet-tab strip order.
   */
  sheet_order: number | null;
  /**
   * The commit-time disposition discriminator (general-specs grid view): "grid_only"
   * (a faithful grid, ZERO nodes -- general specs) or "grid_and_nodes" (a node-based
   * priceable data sheet -- finalized). Drives the pricing editor's read-only
   * faithful-grid fork for grid-only sheets.
   */
  sheet_disposition: "grid_only" | "grid_and_nodes";
  /**
   * Slice 5b (ADDITIVE). The committed BoQ Sheet.last_exported_at -- when this sheet's
   * priced workbook was last downloaded. null when never exported.
   */
  last_exported_at?: string | null;
  /**
   * Slice 5b (ADDITIVE). True iff a rate/color/remark on the sheet's CURRENT committed
   * version was written AFTER last_exported_at (or content exists and it was never
   * exported). Drives the per-sheet "priced since last export" staleness chip.
   */
  pricing_changed_since_export?: boolean;
  /**
   * Deliberate per-sheet read-only lock (the lock/unlock slice, ADDITIVE). true when this
   * committed sheet is locked. Rides the SAME is_current=1 BoQ Sheet lookup last_exported_at
   * uses. For a future hub lock indicator; the editor reads its own is_locked from get_priced_rows.
   */
  is_locked?: boolean;
}

/** Response shape of get_committed_state (Phase 5 Slice 4a endpoint; 5b additive fields). */
export interface GetCommittedStateResponse {
  committed_state: CommittedSheetState[];
}

/**
 * One committed version of a sheet, from get_sheet_versions (Phase 5 version-view). The version
 * SOURCE-OF-TRUTH is the committed grid tier, so this covers grid-only and node versions alike.
 * Drives the read-only version-history dropdown. `last_change_at` is the max priced/colored/
 * remarked_at on that version, or null when the version was committed but NEVER priced (a COMMON
 * case -- the dropdown then falls back to committed_at with a "never priced" affordance).
 */
export interface SheetVersionRow {
  commit_version: number;
  is_current: boolean;
  committed_at: string | null;
  sheet_disposition: "grid_only" | "grid_and_nodes";
  last_change_at: string | null;
}

/** Response shape of get_sheet_versions (Phase 5 version-view; versions sorted version-desc). */
export interface GetSheetVersionsResponse {
  versions: SheetVersionRow[];
}

/**
 * One classified copy-forward plan row (Phase 5 version-view slice 2). outcome: 1 = HARD SKIP
 * (never written, shown with `reason`), 2 = clean copy (dest empty), 3 = conflict (dest already
 * has a rate -> the user picks overwrite/keep). `skip_reason` (outcome 1 only) is one of
 * "non_match" | "no_rate_column" | "non_priceable". `target_col_letter` is the RE-RESOLVED current
 * column (null on a skip). `current_rate` is the existing current rate (outcome 3 only).
 */
export interface CopyForwardPlanRow {
  excel_row: number;
  description: string | null;
  source_rate: number | null;
  area: string | null;
  rate_kind: string;
  outcome: 1 | 2 | 3;
  skip_reason: "non_match" | "no_rate_column" | "non_priceable" | null;
  target_col_letter: string | null;
  current_rate: number | null;
  reason: string | null;
}

/** Response shape of get_copy_forward_plan (Phase 5 version-view slice 2). */
export interface GetCopyForwardPlanResponse {
  plan: CopyForwardPlanRow[];
  from_version: number;
  current_version: number;
  /** False when the current version still has amount columns without a declared formula (apply blocked). */
  current_formulas_complete: boolean;
  counts: {
    clean: number;
    conflict: number;
    non_match: number;
    no_rate_column: number;
    non_priceable: number;
  };
}

/** One user decision posted to apply_copy_forward. Presence = "copy this cell"; `overwrite` matters only for a conflict. */
export interface CopyForwardDecision {
  excel_row: number;
  area: string | null;
  rate_kind: string;
  overwrite?: boolean;
}

/** Response shape of apply_copy_forward (Phase 5 version-view slice 2). */
export interface ApplyCopyForwardResponse {
  ok: boolean;
  copied: number;
  conflicts_overwritten: number;
  conflicts_kept: number;
  skipped: {
    non_match: number;
    no_rate_column: number;
    non_priceable: number;
    invalid: number;
  };
}

/**
 * Response shape of export_priced_workbook (Phase 5 Slice 5a endpoint; consumed by 5b).
 * content_base64 is the stamped .xlsx bytes; the frontend decodes -> Blob -> download.
 */
export interface ExportPricedWorkbookResponse {
  filename: string;
  content_type: string;
  content_base64: string;
  exported_sheets: string[];
  /** {sheetName: [colLetter, ...]} -- rate columns left untouched because they hold formulas. */
  skipped_formula_columns: Record<string, string[]>;
  /** {sheetName: colLetter} -- where a "Nirmaan Remarks" column was appended. */
  remark_columns: Record<string, string>;
  last_exported_at: string;
}

/**
 * Response shape of get_committed_sheet_grid (pricing.py) -- the FAITHFUL committed cell
 * grid for one (boq, sheet, committed_version) + its column-config snapshot. Drives the
 * pricing editor's READ-ONLY general-specs view via SheetDataGrid. Rows reuse
 * SheetPreviewRow (the committed grid row shape). The config maps may be EMPTY ({} / [])
 * for a general-specs sheet -- the grid rows are returned regardless (SheetDataGrid then
 * falls back to raw Excel column letters).
 */
export interface CommittedSheetGridResponse {
  rows: SheetPreviewRow[];
  column_role_map: Record<string, ColumnRoleEntry>;
  column_headers: Record<string, string>;
  area_dimensions: string[];
  header_row: number | null;
  header_row_count: number;
}

// ── Stale-config signal (Slice 1b get_stale_sheets; consumed by F2) ────────────

/**
 * One sheet whose saved config no longer validates, from get_stale_sheets (Slice 1b).
 * Computed LIVE (no stored field) -- reason only, NO timestamp. sheet_name is VERBATIM
 * (#152) -- join to drafts byte-for-byte, no trim. F2 reads this as one of the three
 * "needs attention" signals (alongside the draft's parse_failure_* / commit_failure_*).
 */
export interface StaleSheet {
  sheet_name: string;
  reason: string;
}

/** Response shape of get_stale_sheets (Slice 1b endpoint). */
export interface GetStaleSheetsResponse {
  stale_sheets: StaleSheet[];
}

/**
 * One sheet that committed successfully, from the commit_boq envelope (Slice 5
 * backend, feat 09714041). The backend entry carries more keys (disposition,
 * grid_name, boq_sheet_name, row_count, node_count, froze_prior, ...); the
 * results modal reads only sheet_name + commit_version. DISTINCT from
 * CommittedSheetState (the get_committed_state read) -- this is the commit RESULT.
 */
export interface CommittedSheetResult {
  sheet_name: string;
  commit_version: number;
  disposition?: string;
  row_count?: number;
  node_count?: number;
}

/** One sheet that FAILED to commit, from the commit_boq envelope (Slice 5 backend).
 * commit_boq no longer throws on a per-sheet failure -- it rolls that sheet back and
 * reports it here (reason is a non-empty renderable string). */
export interface FailedSheetResult {
  sheet_name: string;
  reason: string;
}

/**
 * Response shape of commit_boq (Phase 5 Slice 5 backend). committed[] + failed[]
 * together describe the outcome; MIXED (some of each) is normal. failed is [] on
 * full success (the key is always present). A whole-call precondition failure
 * (gate re-check / missing boq / empty subset / file fetch) still THROWS instead.
 */
export interface CommitBoqResponse {
  boq_name: string;
  committed: CommittedSheetResult[];
  failed: FailedSheetResult[];
}

// ── Commit-preflight types (commit-validation slice) ───────────────────────────

/**
 * One validation finding from commit_preflight (FROZEN contract; owned by
 * api/boq/wizard/commit_validation.py). `kind` is "error" (blocking) or "warning"
 * (advisory, "Looks OK"-acknowledged in the dialog). `message` is plain-English and
 * pre-formatted by the backend ("Row {n} · \"{desc}\" — {what is wrong}") -- render it
 * verbatim. `group_key` de-dupes / keys a finding (the dialog prefixes it with the
 * VERBATIM sheet_name #152 to build the local ack key -- ack is NOT persisted). `count`
 * is 1 unless rows are folded into one finding (e.g. an undeclared-area group).
 */
export interface PreflightFinding {
  kind: "error" | "warning";
  code: string;
  sheet_name: string;
  source_row_number: number | null;
  description: string | null;
  message: string;
  what_to_do: string;
  group_key: string;
  count: number;
}

/**
 * One per_sheet entry of the commit_preflight response. A general-specs sheet
 * (disposition "general_specs") always carries errors=[] / warnings=[] (no node tree).
 * sheet_name is VERBATIM (#152) -- join to the ticked set byte-for-byte, never trim.
 */
export interface SheetPreflight {
  sheet_name: string;
  disposition: "general_specs" | "finalized";
  errors: PreflightFinding[];
  warnings: PreflightFinding[];
}

/** Response shape of commit_preflight (commit_validation.commit_preflight). FROZEN. */
export interface PreflightResponse {
  per_sheet: SheetPreflight[];
}
