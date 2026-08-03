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
}

/** One row's AI-extracted attributes from a suggestion run (RM-3). The value is null when the AI
 * could not determine it (honest partial); confidence is per-attribute; corroborated is the
 * display-only regex-agreement tick. */
export interface ExtractedAttr {
  value: string | number | null;
  confidence: number;
  corroborated?: boolean;
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
