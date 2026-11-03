/**
 * U1 rate-helper REGISTRY (guardrail G3: N-generic). The page evaluates EVERY registered helper over
 * a row and the panel renders one card per helper from the contract alone -- so adding a helper is a
 * registry edit, never a panel change. Two of the three registered helpers always decline; they
 * exist to PROVE the panel renders the contract generically (dead cards look like live ones).
 */
import type {
  HelperResult,
  MatchColour,
  MatchDetail,
  PreviousMatch,
  PreviouslyPricedView,
  RateHelper,
  RateHelperRowContext,
} from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";

/** "Previously priced BoQs" -- the priced-corpus helper (later). Always declines today. */
export const previouslyPricedHelper: RateHelper = {
  id: "previously_priced_boqs",
  label: "Previously priced BoQs",
  compute: () => ({ kind: "none", reason: "No priced corpus for this category yet" }),
};

/** "Qty breakdown + live data" -- the live-data helper (planned). Always declines today. */
export const qtyBreakdownHelper: RateHelper = {
  id: "qty_breakdown_live",
  label: "Qty breakdown + live data",
  compute: () => ({ kind: "none", reason: "Helper not built -- planned" }),
};

/** The STATIC registry -- the two always-declining helpers that prove the panel renders the
 * contract generically. The REAL "Pricing sheet" helper is page-built (a closure over the run's
 * extraction + the RM-1 config/master) and PREPENDED via buildHelperList (RM-3 -- the U1 stub is
 * gone). */
export const RATE_HELPERS: RateHelper[] = [previouslyPricedHelper, qtyBreakdownHelper];

/** The live helper list for the page: the real pricing-sheet helper first (when a run is loaded),
 * then the static declining ones. Pass this to buildSuggestions + the panel.
 * DEV2-B5: `previouslyPriced` (the page-built match closure, only while matching is ON) takes the stub's place; absent
 * => the static list, reference-identical to before. */
export function buildHelperList(pricingSheetHelper?: RateHelper | null, previouslyPriced?: RateHelper | null): RateHelper[] {
  const statics = previouslyPriced ? [previouslyPriced, qtyBreakdownHelper] : RATE_HELPERS;
  return pricingSheetHelper ? [pricingSheetHelper, ...statics] : statics;
}

// ── DEV2-B5 S4: THE "PREVIOUSLY PRICED" CARD (owner R-H2AI, mockup 2026-11-02 15:23; COLOURS 16:13; DISPLAY ORDER
// 11-03 11:06; G4 (a) / G13 / G14 (a)). All PURE; the card (PreviouslyPricedMatches.tsx) only renders these. ──────────

/** At most this many matches are shown, in the stored display order (green, amber, red; the judge's order within). */
export const MAX_SHOWN_MATCHES = 5;

/** The words for a colour -- tooltip and screen-reader text (colour is never the only signal). */
export const MATCH_DOT_TEXT: Record<MatchColour, string> = {
  green: "Likely the same",
  amber: "Check - a spec is stated on one side only",
  red: "Close - a spec differs",
};
/** The one-line colour key under the list (the mockup's words). */
export const MATCH_KEY_TEXT: Record<MatchColour, string> = {
  green: "Likely same",
  amber: "Check: a spec is in one row only",
  red: "Close: a spec differs",
};
export const MATCH_DOT_HEX: Record<MatchColour, string> = { green: "#2E9E5B", amber: "#E8A317", red: "#D64534" };

/** The greyed states (D3): one plain reason each. */
export const MATCH_STATE_TEXT = {
  notRun: "Matching not run yet",
  running: "Matching ...",
  none: "No earlier match found",
  failedPrefix: "Matching failed: ",
} as const;

/** DEV2-B6 PLAIN WORDING (owner 22:55 on cert 16: "...shows an error message of not being done due to som etest budget
 *  ...what is it??"): what a failed row or run SHOWS. The stored technical reason is never shown as text. */
export const MATCH_FAILURE_TEXT = {
  retry: "Couldn't check earlier BoQs for this row. Run Suggest again to retry.",
  poolNotReady: "Earlier BoQs are being prepared. Try again in a few minutes.",
  tooLong: "This row is too long to check against earlier BoQs.",
  switchedOff: "Checking earlier BoQs is switched off.",
  suggestChanged: "The suggestions changed while earlier BoQs were being checked. Run Suggest again to retry.",
} as const;

/** PURE. A stored failure reason (a row's no_verdict, or the run's halt reason) -> the plain words shown, and the
 *  technical reason kept for the hover title. Every reason maps; an UNKNOWN one gets the first wording, never raw text.
 *    "pool not ready: ..." (match_run.job_pool)                                  -> poolNotReady
 *    "not sent: too_large (...)" (the size guard: the request is over the limit)  -> tooLong
 *    "Historical matching is switched off (match_enabled)."                       -> switchedOff
 *    "The Suggest run this match follows is no longer the sheet's active ..."     -> suggestChanged
 *    everything else -- "not sent", "not sent: caller_refused (...)", "the call failed: ...", every reply that could
 *    not be read (cut at max_tokens, refused, no / bad JSON, verdicts or order not covering the candidates, unknown
 *    verdicts), "The call runner stopped: ...", "The match run stopped unexpectedly.", "stale - worker gone",
 *    "the match run stopped", and any reason not listed                           -> retry */
export function plainMatchFailure(reason: string | null | undefined): { words: string; detail: string } {
  const detail = String(reason ?? "").trim();
  const r = detail.toLowerCase();
  let words: string = MATCH_FAILURE_TEXT.retry;
  if (r.startsWith("pool not ready")) words = MATCH_FAILURE_TEXT.poolNotReady;
  else if (r.includes("too_large")) words = MATCH_FAILURE_TEXT.tooLong;
  else if (r.includes("historical matching is switched off")) words = MATCH_FAILURE_TEXT.switchedOff;
  else if (r.includes("is no longer the sheet's active")) words = MATCH_FAILURE_TEXT.suggestChanged;
  return { words, detail };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** G13: the TOTAL rate = supply + install where the row was priced split, else its combined rate; null when none. */
export function matchTotal(m: PreviousMatch): number | null {
  const s = num(m.supply_rate);
  const i = num(m.install_rate);
  if (s !== null || i !== null) return (s ?? 0) + (i ?? 0);
  return num(m.total_rate);
}

const UNIT_WORDS: Record<string, string> = {
  no: "nos", nos: "nos", number: "nos", numbers: "nos", each: "nos", ea: "nos", pc: "nos", pcs: "nos", unit: "nos", units: "nos",
  set: "set", sets: "set",
  m: "m", mt: "m", mtr: "m", mtrs: "m", meter: "m", meters: "m", metre: "m", metres: "m", rm: "m", rmt: "m", rmtr: "m", rmtrs: "m", lm: "m",
  mts: "m", rmts: "m", lmt: "m", rmeter: "m", rmetre: "m",
  sqm: "sqm", sqmt: "sqm", sqmtr: "sqm", m2: "sqm", sqft: "sqft", cum: "cum", m3: "cum", kg: "kg", kgs: "kg",
  ls: "ls", lumpsum: "ls", lot: "ls", job: "ls",
};
/** A unit's comparable form: lower case, letters and digits only, common spellings folded ("Nos." = "No" = "Each"). */
export function normUnit(u: string | null | undefined): string {
  const k = String(u ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return UNIT_WORDS[k] ?? k;
}
/** G13: a match in a DIFFERENT unit is flagged and left out of the range. Unknown on either side -> not flagged. */
export function isOtherUnit(m: PreviousMatch, rowUnit: string | null | undefined): boolean {
  const a = normUnit(rowUnit);
  const b = normUnit(m.unit);
  return a !== "" && b !== "" && a !== b;
}
export const isNotAMatch = (m: PreviousMatch): boolean => m.flag?.action === "not_a_match";

/** The shown matches: the stored order kept (it IS the display order), at most MAX_SHOWN_MATCHES. */
export function shownMatches(matches: readonly PreviousMatch[] | null | undefined): PreviousMatch[] {
  return (matches ?? []).slice(0, MAX_SHOWN_MATCHES);
}

/** The rate range over the shown matches, leaving out not-a-match and other-unit ones (and any with no total).
 *  `left` = how many shown matches are left out of it. */
export function matchRange(
  view: Pick<PreviouslyPricedView, "matches" | "rowUnit">,
): { lo: number; hi: number; count: number; left: number } | null {
  const shown = shownMatches(view.matches);
  const totals = shown
    .filter((m) => !isNotAMatch(m) && !isOtherUnit(m, view.rowUnit))
    .map(matchTotal)
    .filter((v): v is number => v !== null);
  if (totals.length === 0) return null;
  return { lo: Math.min(...totals), hi: Math.max(...totals), count: totals.length, left: shown.length - totals.length };
}
export function formatRs(v: number): string {
  return `Rs ${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
/** "Rs a – b" (min - max); one figure when they are equal or there is one match; "–" when none is left in the range. */
export function rangeText(r: ReturnType<typeof matchRange>): string {
  if (!r) return "–";
  return r.lo === r.hi ? formatRs(r.lo) : `${formatRs(r.lo)} – ${formatRs(r.hi)}`;
}

/** The match run as the page fetched it (get_match_results.run). */
export interface MatchRunData {
  name: string;
  status: string;
  commit_version: number | null;
  rows: { excel_row: number; status?: string; no_verdict?: string | null; matches?: PreviousMatch[] }[];
}
export interface PreviouslyPricedInput {
  /** The sheet's ACTIVE match run, only when it is at the sheet's current committed version (else null). */
  run: MatchRunData | null;
  running: boolean;
  /** The last match phase's failure reason, shown when it failed and there is no current run. */
  failedReason: string | null;
  boq: string;
  sheetName: string;
  unitByExcelRow: ReadonlyMap<number, string>;
  actions: {
    canMark: boolean;
    canOpenBoqs: boolean;
    loadDetail: (m: PreviousMatch, excelRow: number) => Promise<MatchDetail>;
    onMark: (m: PreviousMatch, excelRow: number, reason: string | null, note: string | null) => Promise<void>;
    onUndo: (m: PreviousMatch, excelRow: number) => Promise<void>;
  };
}

/** PURE. The card's outcome for one row: a greyed reason (D3), or the matches -- a NoSuggestion carrying `matches`,
 *  so never a value to Use and never a badge (G4 (a)). */
export function previouslyPricedResult(input: PreviouslyPricedInput, excelRow: number): HelperResult {
  if (input.running) return { kind: "none", reason: MATCH_STATE_TEXT.running };
  if (!input.run) {
    if (!input.failedReason) return { kind: "none", reason: MATCH_STATE_TEXT.notRun };
    const f = plainMatchFailure(input.failedReason);
    return { kind: "none", reason: f.words, detail: f.detail };
  }
  const row = input.run.rows.find((r) => Number(r.excel_row) === excelRow);
  if (row?.status === "no verdict" && row.no_verdict) {
    const f = plainMatchFailure(row.no_verdict);
    return { kind: "none", reason: f.words, detail: f.detail };
  }
  const matches = shownMatches(row?.matches);
  if (matches.length === 0) return { kind: "none", reason: MATCH_STATE_TEXT.none };
  return {
    kind: "none",
    reason: "",
    matches: {
      matchRun: input.run.name,
      boq: input.boq,
      sheetName: input.sheetName,
      excelRow,
      rowUnit: input.unitByExcelRow.get(excelRow) ?? null,
      matches,
      canMark: input.actions.canMark,
      canOpenBoqs: input.actions.canOpenBoqs,
      loadDetail: (m) => input.actions.loadDetail(m, excelRow),
      onMark: (m, reason, note) => input.actions.onMark(m, excelRow, reason, note),
      onUndo: (m) => input.actions.onUndo(m, excelRow),
    },
  };
}

/** The page-built "Previously priced BoQs" helper: a closure over the sheet's match results, keyed by excelRow. */
export function makePreviouslyPricedHelper(input: PreviouslyPricedInput): RateHelper {
  return {
    id: previouslyPricedHelper.id,
    label: previouslyPricedHelper.label,
    compute: (ctx) => previouslyPricedResult(input, ctx.excelRow),
  };
}

export interface HelperEvaluation {
  helper: RateHelper;
  result: HelperResult;
}

/** Run every helper over a row context. Pure. `attrOverridesByHelper` lets a single helper be
 * re-run with edited attributes (panel live recompute) while the others stay at their defaults. */
export function resolveRateHelpers(
  ctx: RateHelperRowContext,
  attrOverridesByHelper?: Record<string, Record<string, string>>,
  helpers: RateHelper[] = RATE_HELPERS,
): HelperEvaluation[] {
  return helpers.map((helper) => ({
    helper,
    result: helper.compute(ctx, attrOverridesByHelper?.[helper.id]),
  }));
}

/** The count of helpers that suggest a value for `kind` on this row -- drives the badge count chip.
 * A helper counts only when it returns a Suggestion whose `values[kind]` is a number. */
export function suggestionCountForKind(
  ctx: RateHelperRowContext,
  kind: string,
  helpers: RateHelper[] = RATE_HELPERS,
): number {
  return suggestionCountsByKind(ctx, [kind], helpers)[kind];
}

/** `suggestionCountForKind` for several kinds from ONE compute of each helper: the compute never reads the
 * kind asked about, so a row with supply + install + combined cells is priced once, not three times. */
export function suggestionCountsByKind(
  ctx: RateHelperRowContext,
  kinds: readonly string[],
  helpers: RateHelper[] = RATE_HELPERS,
): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(kinds.map((k) => [k, 0]));
  for (const { result } of resolveRateHelpers(ctx, undefined, helpers)) {
    if (!isSuggestion(result)) continue;
    for (const kind of kinds) {
      // Badge a kind if the helper has a COMPUTED value for it OR declares it producible (a partial
      // extraction still badges so the pricer can open the panel to complete it -- RM-3).
      if (typeof result.values[kind] === "number" || (result.producibleKinds?.includes(kind) ?? false)) {
        counts[kind] += 1;
      }
    }
  }
  return counts;
}
