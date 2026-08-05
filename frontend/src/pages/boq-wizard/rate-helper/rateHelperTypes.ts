/**
 * U1 rate-helper chassis -- the TYPED HELPER CONTRACT (guardrail G3: N-generic).
 *
 * A rate helper receives a row context (durable excel_row + the resolved category/discipline the
 * page already holds in categoriesByExcelRow + the rate-kinds present on the row) and returns either
 * a Suggestion (values per rate-kind + a one-line basis + STRUCTURED workings) or a NoSuggestion
 * (a reason). The panel renders ONLY this contract -- zero helper-specific rendering -- so a new
 * helper is a registry entry, never a panel change.
 *
 * NOTHING here persists (guardrail G2): the whole chassis is synchronous + frontend-only in U1.
 */

/** The rate-kind token, mirroring the grid's descriptor kind (rate_supply/install/combined ->
 * "supply_rate" | "install_rate" | "combined_rate"). Kept as a string so the contract stays
 * N-generic over whatever kinds a sheet's rate columns carry. */
export type RateKind = string;

/** One editable attribute in a helper's workings. `options` present => a select; absent => free text.
 * Editing an attribute re-runs the helper's compute (panel-session only). RM-3: choice/number attrs
 * carry the AI `confidence` and a `corroborated` tick (regex agreed) for display -- never gating. */
export interface WorkingsAttribute {
  id: string;
  label: string;
  options?: string[];
  value: string;
  /** AI confidence 0..1 for the EXTRACTED value (absent for a manually-added attr). */
  confidence?: number;
  /** The regex corroborator agreed with the AI value (display-only tick). */
  corroborated?: boolean;
  /** EA-4a-r: greyed + non-editable because an allow_none controller is set to "None" (positive absence). */
  disabled?: boolean;
  /** EA-4a-r: this def may itself be "None" (positive absence). For a NUMBER def the panel renders a "None"
   * checkbox beside the numeric input (a choice def carries None as its top option instead). */
  allowNone?: boolean;
  /** U2: the extraction filled this value from a CONFIG DEFAULT -- the row text gave no positive
   * identification. The panel tints it amber so the pricer can see, and correct, every defaulted value
   * before using the rate. A human override CLEARS this (the helper drops the mark on recompute), so the
   * highlight can never outlive the correction. */
  defaulted?: boolean;
}

/**
 * U2 -- the two per-attribute HIGHLIGHT predicates, pure so they are unit-testable in the node env
 * (component render is not). They encode a THREE-WAY distinction that must not be collapsed:
 *
 *   BLANK              value === ""      the AI could not read it / a manual row -> RED border, needs filling
 *   DEFAULTED          defaulted === true  filled from a config default, not read -> AMBER, worth checking
 *   POSITIVELY ABSENT  value === "None" (NONE_SENTINEL) or `disabled` (its controller is None)
 *                                       -> NEITHER highlight. This is a DECISION, not a gap; flagging it
 *                                          as missing would be wrong.
 */
export function isAttrBlank(a: Pick<WorkingsAttribute, "value" | "disabled">): boolean {
  return !a.disabled && a.value === "";
}
export function isAttrDefaulted(a: Pick<WorkingsAttribute, "disabled" | "defaulted">): boolean {
  return !a.disabled && a.defaulted === true;
}

/** One row's AI-extracted attributes from a suggestion run (RM-3). The value is null when the AI
 * could not determine it (honest partial); confidence is per-attribute; corroborated is the
 * display-only regex-agreement tick. */
export interface ExtractedAttr {
  value: string | number | null;
  confidence: number;
  corroborated?: boolean;
  /** EA-4a: the server filled this from the category config's `extraction_defaults` because the row text
   * gave no positive identification. It ALWAYS arrived on the wire; U2 declares it so the helper can carry
   * it onto the per-attribute contract instead of reading it through an undeclared cast. */
  defaulted?: boolean;
}
export interface ExtractionRow {
  excelRow: number;
  description?: string;
  attributes: Record<string, ExtractedAttr>;
}

/** One LABELLED group of workings (RM-3a). Lets a helper split a suggestion into visually distinct
 * blocks (e.g. Cable vs Termination) that the panel renders each as its OWN section (header + own
 * derivation + own final values). DISPLAY-ONLY: the applied value still comes from Suggestion.values,
 * never a group's finals. */
export interface WorkingsGroup {
  /** Section header shown above the block (e.g. "Cable -- per Mtr"). */
  label: string;
  /** Derivation lines for THIS group, one string per line. */
  derivation: string[];
  /** This group's OWN final values (display-only), keyed by the helper's output/label name. */
  finals: Record<string, number>;
  /** Optional group-scoped matched-row line(s). */
  matchedRows?: string[];
  /** Optional group-scoped attributes (unused this slice; SHARED attrs live on WorkingsSection). */
  attributes?: WorkingsAttribute[];
}

/** The STRUCTURED workings a Suggestion carries -- rendered generically by the panel. */
export interface WorkingsSection {
  /** Editable attributes; a change re-runs compute with the edited values. */
  attributes: WorkingsAttribute[];
  /** The matched-row line(s) -- what the helper matched against (human-readable). */
  matchedRows: string[];
  /** Derivation lines -- how the value was reached, one string per line. */
  derivation: string[];
  /** The final computed value per rate-kind (the panel pre-fills the final-value field from this). */
  finalValues: Partial<Record<RateKind, number>>;
  /** RM-3a: when present (>= 1), the panel renders these LABELLED groups (each its own block) INSTEAD
   * of the flat matchedRows/derivation; the shared `attributes` above still render ONCE above the
   * groups. ABSENT => flat rendering, byte-identical to pre-RM-3a -- so single-group suggestions stay
   * backward-shaped (the pricing-sheet helper omits `sections` on termination rows). */
  sections?: WorkingsGroup[];
}

/** A helper produced a suggestion. */
export interface Suggestion {
  kind: "suggestion";
  /** Suggested value per rate-kind. A kind absent here => this helper has no COMPUTED value for
   * that kind yet (e.g. a partial extraction missing an attribute). */
  values: Partial<Record<RateKind, number>>;
  /** The rate-kinds this helper CAN price for the row (even when the current value is missing due
   * to a partial extraction) -- so a partial row still BADGES (the pricer opens the panel to
   * complete it). Absent => fall back to `values` for badge counting (the two dead helpers). */
  producibleKinds?: RateKind[];
  /** One-line basis (what the suggestion rests on). */
  basis: string;
  workings: WorkingsSection;
}

/** A helper declined -- with an honest reason (rendered greyed). */
export interface NoSuggestion {
  kind: "none";
  reason: string;
}

export type HelperResult = Suggestion | NoSuggestion;

/** The per-row context handed to every helper. Sourced from the page's existing data (the grid row +
 * categoriesByExcelRow) -- no new fetch. */
export interface RateHelperRowContext {
  /** Durable Excel row number (source_row_number) -- the identity, never a window index. */
  excelRow: number;
  description: string;
  nodeType: string;
  /** Resolved effective category id for the row (from categoriesByExcelRow), or null. */
  category: string | null;
  /** Resolved discipline for the row (from categoriesByExcelRow), or null. */
  discipline: string | null;
  /** The rate-kinds present on this row's rate cells (derived from the row's rate descriptors). */
  rateKinds: RateKind[];
}

/** A registered rate helper. `compute` is PURE + synchronous.
 * `attrOverrides` lets the panel re-run the helper with edited attribute values (live recompute);
 * the first call (no overrides) returns the helper's default suggestion + default attributes. */
export interface RateHelper {
  id: string;
  label: string;
  compute(ctx: RateHelperRowContext, attrOverrides?: Record<string, string>): HelperResult;
}

export function isSuggestion(r: HelperResult): r is Suggestion {
  return r.kind === "suggestion";
}

/** Per rate-cell badge state (page-session only, never persisted). `count` = how many helpers
 * suggest a value for this cell's kind (the chip number); `used` = a suggested value has been
 * applied to this cell this session (chip -> check). */
export interface SuggestionCell {
  count: number;
  used: boolean;
}

/** A row's badge state, keyed by the rate cell's Excel column letter. This is the ONLY per-row
 * value the grid receives for the feature -- compared BY VALUE in the row comparator (P1 memo
 * shield), so a rebuild of the whole Map only re-renders the rows whose entry actually changed. */
export interface RowSuggestions {
  byCol: Record<string, SuggestionCell>;
}

/** Value-equality for a row's RowSuggestions entry (the row comparator uses this so an unchanged
 * row bails even when the page rebuilds the Map). Two absent entries are equal. */
export function rowSuggestionsEqual(a?: RowSuggestions, b?: RowSuggestions): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a.byCol);
  const bk = Object.keys(b.byCol);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const ca = a.byCol[k];
    const cb = b.byCol[k];
    if (!cb || ca.count !== cb.count || ca.used !== cb.used) return false;
  }
  return true;
}
