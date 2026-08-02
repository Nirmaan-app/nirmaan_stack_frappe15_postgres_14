/**
 * pricingLoadState.ts -- what the pricing editor may honestly claim about its own data
 * (slice PE-SPIN-1).
 *
 * THE DEFECT THIS CLOSES. `SheetPricingPage` derived its two gating booleans from the SWR
 * payload alone:
 *
 *     pricedLoading = (data === undefined)
 *     pricedError   = (data === null)
 *
 * SWR never sets `data` to `null` on failure. `call.get` (frappe-js-sdk) resolves with the parsed
 * HTTP body and THROWS on a non-2xx, so a failure leaves `data` undefined on a first load, or
 * leaves the LAST GOOD VALUE in place on a failed revalidation, and reports itself on a separate
 * `error` field that nothing on this page read. The consequences ran in both directions:
 *
 *   - a first-load failure kept `pricedLoading` true forever -- a PERMANENT SPINNER, reported by
 *     users as "the page is stuck", which is far harder to diagnose than an error message;
 *   - a failed revalidation left stale rows on screen claiming to be current.
 *
 * And `data === null` was unreachable: Frappe wraps a whitelisted return as `{"message": ...}`, so
 * an endpoint returning None yields `{"message": null}` -- an object. The condition the old name
 * claimed ("the fetch failed") was unhandled; the condition it could actually have meant ("the
 * server returned nothing") sits one level down, on `message`.
 *
 * THE SHAPE IS BORROWED, NOT INVENTED. `bcsToggleState` (bcsColumns.ts, BCS-S2a) settled this for
 * the BCS control: absence of knowledge is not knowledge of absence, and a stale payload behind a
 * failed read is not current. This is that rule applied to the sheet fetch every gate depends on.
 *
 * WHY A MODULE AND NOT TWO MORE CONSTS. This repo has NO DOM test environment (deliberate, see
 * vitest.config.ts), so a derivation living inline in a component's JSX scope is structurally
 * untestable -- which is exactly why the old one survived unexamined for months. Pulled out here
 * it is a pure function with a unit test; what it CANNOT cover is that the page renders the right
 * thing, which stays a live check.
 *
 * USE THE FLAGS, DO NOT RE-DERIVE THEM at a call site. Re-deriving `status === "ready"` inline is
 * how the distinctions below collapse back into each other one site at a time -- the same warning
 * `bcsToggleState` carries, for the same reason.
 *
 * ── PE-SPIN-1-fix: ONE RULE, THREE FETCHES ───────────────────────────────────────────────────
 *
 * PE-SPIN-1 converted 23 GATING SITES and stopped there, which is why it missed two fetches on the
 * same page that carried the identical defect: `get_committed_sheet_grid` (the grid-only fork, whose
 * consumer held the retired `data === undefined` / `data === null` pair VERBATIM) and
 * `get_cross_boq_carry_plan` (whose `loading` boolean never went false on a failure). Surveying by
 * gating site cannot find those; surveying by FETCH can.
 *
 * That half-conversion was worse than the uniform bug, and PE-SPIN-1's own brief named the reason:
 * a page whose failure behaviour differs by WHICH fetch broke is unpredictable. So the module now
 * serves all three from ONE precedence rule (`loadStatus`), with the per-fetch WORDING as the only
 * parameter -- because "could not load this sheet's pricing rows" is a lie on a general-specs sheet,
 * which has no pricing rows. Adding a fourth fetch is a message set plus a one-line accessor.
 *
 * ⚠️ IF YOU ADD A FETCH TO THIS PAGE, ADD IT HERE TOO. Destructure its `error`, put it through one
 * of these accessors, and make every consumer of its state read the returned flags. A fetch whose
 * `error` is dropped reproduces the original defect exactly, and it will present as "the page is
 * stuck" rather than as anything pointing back to the fetch.
 */

/** The SWR signals this rule reads. Deliberately only the two that carry information. */
export interface PricingFetchSignals {
  /**
   * SWR's `data`: the whole HTTP body (`{message: ...}`), `undefined` before the first successful
   * response, and the LAST GOOD body after a failed revalidation.
   */
  data: { message?: unknown } | null | undefined;
  /** SWR's `error`. The signal the page never read; set on any thrown fetch. */
  error: unknown;
}

/**
 * What the page may claim about the active sheet fetch.
 *
 * - `loading` -- nothing has arrived and nothing has failed. A spinner is honest.
 * - `error`   -- the read failed and there is nothing usable to show. THE STATE THE OLD RULE
 *                COULD NOT REACH; it is why the spinner never stopped.
 * - `stale`   -- a payload is in hand but the most recent read FAILED. Worth showing (destroying
 *                a live editing session over one transient blip is its own harm) but it must not
 *                claim to be current.
 * - `empty`   -- a response arrived carrying no content (`message` null). Treated as a failure,
 *                not as an empty sheet: see `EMPTY_MESSAGE`.
 * - `ready`   -- a payload, no failure.
 */
export type PricingLoadStatus = "loading" | "error" | "stale" | "empty" | "ready";

export interface PricingLoadState {
  status: PricingLoadStatus;
  /** Show a spinner. */
  isLoading: boolean;
  /** Nothing usable to show -- the honest render is an error, with a retry. (`error` | `empty`) */
  isFailed: boolean;
  /** There is a payload worth rendering and gating on. (`ready` | `stale`) */
  isUsable: boolean;
  /** A payload is being shown whose latest read failed -- render it, but say so. */
  isStale: boolean;
  /** User-facing text for every non-ready state; null when ready, because a healthy load is silent. */
  message: string | null;
}

/**
 * The three wordings one fetch needs. THE ONLY THING THAT VARIES BETWEEN FETCHES (PE-SPIN-1-fix).
 *
 * The rule below is shared; the words are not, because a failure has to send the reader somewhere.
 * "Could not load this sheet's pricing rows" is actively misleading on a general-specs sheet, which
 * has no pricing rows -- so each fetch owns its own sentences and nothing else.
 */
export interface LoadStateMessages {
  /** The read failed and we hold nothing usable. */
  error: string;
  /** A response arrived carrying no content. */
  empty: string;
  /** A payload is on screen but the newest read failed. */
  stale: string;
}

/** The read failed outright and we are holding nothing. */
export const ERROR_MESSAGE =
  "Could not load this sheet's pricing rows. The server could not be reached or returned an error.";

/**
 * A response arrived with no content.
 *
 * OWNER-VISIBLE DECISION: this reads as a FAILURE, not as an empty sheet. `get_priced_rows` is
 * annotated `-> dict` and always returns a payload for a committed sheet, so a null `message`
 * means something upstream went wrong. Rendering an empty, editable grid would invite a user to
 * price a sheet whose rows we simply failed to read -- absence of knowledge presenting as
 * knowledge of absence, which is the whole failure mode this module exists to stop. It keeps its
 * OWN wording, because "the sheet may not be committed" is a real and different thing to check
 * than "the network failed", and the retired copy was describing this case all along.
 */
export const EMPTY_MESSAGE =
  "This sheet returned no pricing data. Check that it has been committed, then try again.";

/** A payload is on screen but the newest read failed. */
export const STALE_MESSAGE =
  "Showing the last data that loaded — the most recent refresh failed, so this may be out of date.";

/**
 * Build ONE fetch's five states.
 *
 * ⚠️ CALL THIS AT MODULE LOAD, NEVER PER RENDER. The returned objects are SHARED SINGLETONS, and
 * that is load-bearing: `SheetPricingPage` reads a load state beside memoized `PricingGrid` props,
 * so a fresh object per call would contribute a new reference on every render and could defeat a
 * downstream memo. Parameterizing the wording must not cost that -- hence one frozen table per
 * fetch, built once, indexed by status.
 */
export function makeLoadStates(
  messages: LoadStateMessages,
): Readonly<Record<PricingLoadStatus, PricingLoadState>> {
  return Object.freeze({
    loading: { status: "loading", isLoading: true, isFailed: false, isUsable: false, isStale: false, message: null },
    error: { status: "error", isLoading: false, isFailed: true, isUsable: false, isStale: false, message: messages.error },
    empty: { status: "empty", isLoading: false, isFailed: true, isUsable: false, isStale: false, message: messages.empty },
    stale: { status: "stale", isLoading: false, isFailed: false, isUsable: true, isStale: true, message: messages.stale },
    ready: { status: "ready", isLoading: false, isFailed: false, isUsable: true, isStale: false, message: null },
  } as const);
}

/** The sheet fetch (`get_priced_rows` / `get_version_priced_rows`) -- PE-SPIN-1's original set. */
const SHEET_STATES = makeLoadStates({
  error: ERROR_MESSAGE,
  empty: EMPTY_MESSAGE,
  stale: STALE_MESSAGE,
});

/**
 * The faithful committed grid (`get_committed_sheet_grid`) -- the GRID-ONLY fork: general specs and
 * Make Lists, which commit a cell grid and zero nodes. PE-SPIN-1-fix, survivor 1.
 *
 * Its consumer carried the retired convention verbatim (`gridData === undefined` -> spinner,
 * `gridData === null` -> error), so its error branch was unreachable for exactly the reason
 * PE-SPIN-1 established and a failed load span forever on those sheets.
 */
const GRID_STATES = makeLoadStates({
  error: "Could not load this sheet's grid. The server could not be reached or returned an error.",
  empty: "This sheet returned no grid data. Check that it has been committed, then try again.",
  stale:
    "Showing the last grid that loaded — the most recent refresh failed, so this may be out of date.",
});

/**
 * The cross-BoQ carry plan (`get_cross_boq_carry_plan`) -- PE-SPIN-1-fix, survivor 2.
 *
 * `carryButtonState` takes a `loading` boolean that was `carryPlanData === undefined`, so a failed
 * plan fetch pinned the carry button on "Checking what can be carried…" for the rest of the
 * session. These messages are TOOLTIP copy (the button's `title`), so they are written short.
 */
const CARRY_PLAN_STATES = makeLoadStates({
  error: "Couldn't check what can be carried from the original — the server could not be reached.",
  empty: "Couldn't check what can be carried from the original — the server returned nothing.",
  stale: "This may be out of date — the last check of the original failed.",
});

/**
 * The rule, in precedence order. Each step is a distinction the old two-const derivation lost.
 *
 * Note the order of the first two: a failure is judged against whether we hold anything WORTH
 * showing, so a failed revalidation over real content degrades to `stale` while a failure over
 * nothing (or over an empty payload) is a hard `error`.
 *
 * ⚠️ PE-SPIN-1-fix: this is the ONE implementation, shared by all three fetches on the page. It is
 * exported so a test can assert the three agree -- drift between fetches is precisely what left two
 * survivors after PE-SPIN-1, and a second copy of this precedence would let it happen again.
 */
export function loadStatus(signals: PricingFetchSignals): PricingLoadStatus {
  // `message` absent or null == no content, whatever the envelope looked like.
  const hasContent = signals.data != null && signals.data.message != null;
  // SWR clears `error` to undefined; a null is treated the same. Anything else is a failure.
  const failed = signals.error != null;

  if (failed) return hasContent ? "stale" : "error";
  if (signals.data === undefined) return "loading";
  if (!hasContent) return "empty";
  return "ready";
}

/** The active SHEET fetch's state (the page's primary read). */
export function pricingLoadState(signals: PricingFetchSignals): PricingLoadState {
  return SHEET_STATES[loadStatus(signals)];
}

/** The faithful committed GRID fetch's state (grid-only sheets). PE-SPIN-1-fix, survivor 1. */
export function gridLoadState(signals: PricingFetchSignals): PricingLoadState {
  return GRID_STATES[loadStatus(signals)];
}

/** The cross-BoQ CARRY PLAN fetch's state. PE-SPIN-1-fix, survivor 2. */
export function carryPlanLoadState(signals: PricingFetchSignals): PricingLoadState {
  return CARRY_PLAN_STATES[loadStatus(signals)];
}

/**
 * The state of the fetch actually ON SCREEN.
 *
 * The page reads the live fetch normally and the history fetch while browsing an earlier version.
 * Watching the wrong one lets a healthy live fetch mask a failed history fetch, which is the same
 * class of lie as the original defect. A history fetch that has not started yet (disabled swrKey:
 * no data, no error) is loading, never a failure.
 */
export function activePricingLoadState(args: {
  viewingHistory: boolean;
  live: PricingFetchSignals;
  history: PricingFetchSignals;
}): PricingLoadState {
  return pricingLoadState(args.viewingHistory ? args.history : args.live);
}
