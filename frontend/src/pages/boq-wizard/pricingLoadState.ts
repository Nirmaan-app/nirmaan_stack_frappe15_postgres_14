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

const STATES: Record<PricingLoadStatus, PricingLoadState> = {
  loading: { status: "loading", isLoading: true, isFailed: false, isUsable: false, isStale: false, message: null },
  error: { status: "error", isLoading: false, isFailed: true, isUsable: false, isStale: false, message: ERROR_MESSAGE },
  empty: { status: "empty", isLoading: false, isFailed: true, isUsable: false, isStale: false, message: EMPTY_MESSAGE },
  stale: { status: "stale", isLoading: false, isFailed: false, isUsable: true, isStale: true, message: STALE_MESSAGE },
  ready: { status: "ready", isLoading: false, isFailed: false, isUsable: true, isStale: false, message: null },
};

/**
 * The rule, in precedence order. Each step is a distinction the old two-const derivation lost.
 *
 * Note the order of the first two: a failure is judged against whether we hold anything WORTH
 * showing, so a failed revalidation over real content degrades to `stale` while a failure over
 * nothing (or over an empty payload) is a hard `error`.
 */
export function pricingLoadState(signals: PricingFetchSignals): PricingLoadState {
  // `message` absent or null == no content, whatever the envelope looked like.
  const hasContent = signals.data != null && signals.data.message != null;
  // SWR clears `error` to undefined; a null is treated the same. Anything else is a failure.
  const failed = signals.error != null;

  if (failed) return hasContent ? STATES.stale : STATES.error;
  if (signals.data === undefined) return STATES.loading;
  if (!hasContent) return STATES.empty;
  return STATES.ready;
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
