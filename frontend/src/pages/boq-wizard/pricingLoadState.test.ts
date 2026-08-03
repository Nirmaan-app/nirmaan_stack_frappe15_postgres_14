/**
 * pricingLoadState.test.ts -- the pricing editor's load-state rule (slice PE-SPIN-1).
 *
 * WHAT THESE TESTS ARE FOR. `SheetPricingPage` decided whether its data was loading or failed
 * by inspecting the SWR payload alone:
 *
 *     pricedLoading = (data === undefined)
 *     pricedError   = (data === null)
 *
 * SWR never sets `data` to `null` on failure. It leaves it `undefined` on a first load, or
 * RETAINS the last good value on a failed revalidation, and reports the failure on a separate
 * `error` field that nothing on the page read. So a real network failure or a 500 left
 * `pricedError` false and `pricedLoading` true FOREVER: a permanent spinner, no error, and a
 * user report of "the page is stuck" -- far harder to diagnose than an error message.
 *
 * The first test below is that bug, stated directly. Every other test exists to keep one of the
 * distinctions the fix rests on from collapsing back into another:
 *
 *   - a failed read with NO payload is not "still loading"      (the bug)
 *   - a failed read WITH a retained payload is not "fine"       (the quiet half of the bug)
 *   - "the server returned nothing" is not "the sheet is empty"
 *   - a disabled fetch is not a failure
 *
 * THE SHAPE IS BORROWED, NOT INVENTED. `bcsToggleState` (bcsColumns.ts, slice BCS-S2a) already
 * settled this argument for the BCS control: absence of knowledge is not knowledge of absence,
 * and a stale payload behind a failed read is not current. These states are that rule applied to
 * the sheet fetch itself, which is the one the whole page gates on.
 *
 * ⚠️ WHAT THESE TESTS CANNOT SEE. There is NO DOM test environment in this repo (a deliberate
 * choice recorded in vitest.config.ts). These tests pin the DERIVATION; they cannot observe that
 * the page actually renders an error instead of a spinner. That half is live-check only -- see
 * the slice record's live-check list.
 */
import { describe, expect, it } from "vitest";
import {
  activePricingLoadState,
  bcsRatesLoadState,
  carryPlanLoadState,
  gridLoadState,
  loadStatus,
  pricingLoadState,
  withStaleNote,
  type PricingFetchSignals,
} from "./pricingLoadState";

/** A payload shaped like the real one: the HTTP body, with the endpoint's return under `message`. */
const payload = { message: { rows: [], commit_version: 3 } };

/** No response yet, no failure -- SWR's first-load state. */
const pending: PricingFetchSignals = { data: undefined, error: undefined };

describe("pricingLoadState -- the defect", () => {
  it("reports a first-load failure as an error, NOT as still loading", () => {
    // THE BUG. Old rule: data === undefined -> loading, data === null -> error. A failed fetch
    // leaves data undefined and sets error, so the old rule said "loading" and never stopped.
    const state = pricingLoadState({ data: undefined, error: new Error("Network Error") });

    expect(state.status).toBe("error");
    expect(state.isFailed).toBe(true);
    expect(state.isLoading).toBe(false); // the permanent spinner
    expect(state.isUsable).toBe(false);
    expect(state.message).not.toBeNull(); // the user is told something
  });

  it("reports a FAILED REVALIDATION as stale, not as healthy", () => {
    // The quiet half. SWR keeps the last good `data` when a revalidation fails, so the old rule
    // saw a payload, called it loaded, and the failure was invisible. The page may still show
    // these rows -- but it must not claim they are current.
    const state = pricingLoadState({ data: payload, error: new Error("500") });

    expect(state.status).toBe("stale");
    expect(state.isStale).toBe(true);
    expect(state.isUsable).toBe(true); // the rows stay on screen; the session is not destroyed
    expect(state.isLoading).toBe(false);
    expect(state.isFailed).toBe(false); // it is not an empty error screen
    expect(state.message).not.toBeNull(); // ...but it says so
  });
});

describe("pricingLoadState -- the healthy states", () => {
  it("is loading while no response and no failure has arrived", () => {
    const state = pricingLoadState(pending);

    expect(state.status).toBe("loading");
    expect(state.isLoading).toBe(true);
    expect(state.isUsable).toBe(false);
    expect(state.isFailed).toBe(false);
  });

  it("is ready on a payload with no failure, and says nothing", () => {
    const state = pricingLoadState({ data: payload, error: undefined });

    expect(state.status).toBe("ready");
    expect(state.isUsable).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.isFailed).toBe(false);
    expect(state.isStale).toBe(false);
    expect(state.message).toBeNull(); // a healthy load is SILENT
  });

  it("treats a null SWR error as no error (SWR's cleared-error shape)", () => {
    expect(pricingLoadState({ data: payload, error: null }).status).toBe("ready");
    expect(pricingLoadState({ data: undefined, error: null }).status).toBe("loading");
  });
});

describe("pricingLoadState -- the server returned nothing", () => {
  // Frappe wraps a whitelisted return as {"message": ...}. An endpoint that returns None
  // therefore produces {"message": null} -- a payload whose CONTENT is absent. The old rule's
  // `data === null` never matched this (data is the whole body, an object), so it fell through
  // as "loaded" and rendered an empty, editable grid.
  //
  // OWNER-VISIBLE DECISION: this reads as a FAILURE, not as an empty sheet. get_priced_rows is
  // annotated `-> dict` and always returns a payload for a committed sheet, so a null message
  // means something upstream went wrong -- and an empty editable grid would invite a user to
  // price a sheet whose rows we failed to read.
  it("treats a null message as empty-and-failed, never as a loaded empty sheet", () => {
    const state = pricingLoadState({ data: { message: null }, error: undefined });

    expect(state.status).toBe("empty");
    expect(state.isFailed).toBe(true);
    expect(state.isUsable).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.message).not.toBeNull();
  });

  it("gives the empty case its OWN wording, not the network-failure wording", () => {
    const empty = pricingLoadState({ data: { message: null }, error: undefined });
    const failed = pricingLoadState({ data: undefined, error: new Error("boom") });

    expect(empty.message).not.toBe(failed.message);
  });

  it("treats an absent message key the same as an explicitly null one", () => {
    expect(pricingLoadState({ data: {}, error: undefined }).status).toBe("empty");
  });

  it("treats a literal null body as empty (the old data === null branch's intent)", () => {
    // Unreachable in practice -- call.get returns the parsed body and throws on failure -- but
    // this is what the retired `data === null` check was reaching for, so it keeps its meaning.
    expect(pricingLoadState({ data: null, error: undefined }).status).toBe("empty");
  });

  it("still reports a failure when a null message arrives WITH an error", () => {
    // A payload with no content is not a payload worth keeping, so this is a hard error, not stale.
    const state = pricingLoadState({ data: { message: null }, error: new Error("boom") });

    expect(state.status).toBe("error");
    expect(state.isUsable).toBe(false);
  });
});

describe("activePricingLoadState -- which fetch is being watched", () => {
  // The page reads the LIVE fetch normally and the HISTORY fetch while browsing an earlier
  // version. The state must follow the source actually on screen, or a healthy live fetch would
  // mask a failed history fetch (and vice versa).
  const live: PricingFetchSignals = { data: payload, error: undefined };
  const historyFailed: PricingFetchSignals = { data: undefined, error: new Error("500") };

  it("watches the live fetch when not viewing history", () => {
    const state = activePricingLoadState({ viewingHistory: false, live, history: historyFailed });

    expect(state.status).toBe("ready"); // the failed history fetch is not being shown
  });

  it("watches the history fetch when viewing history", () => {
    const state = activePricingLoadState({ viewingHistory: true, live, history: historyFailed });

    expect(state.status).toBe("error"); // a healthy live fetch must NOT mask it
    expect(state.isFailed).toBe(true);
  });

  it("reports loading for a history fetch that has not started yet", () => {
    // Switching into history mode flips `viewingHistory` before the history fetch resolves; the
    // disabled-until-now fetch has no data and no error. That is loading, never a failure.
    const state = activePricingLoadState({
      viewingHistory: true,
      live,
      history: pending,
    });

    expect(state.status).toBe("loading");
    expect(state.isFailed).toBe(false);
  });
});

// ── PE-SPIN-1-fix: the two fetches PE-SPIN-1 did not reach ────────────────────────────────────
//
// PE-SPIN-1 surveyed by GATING SITE and converted 23 of them, which is why it missed these: they
// belong to DIFFERENT FETCHES on the same page. Two more reads carried the identical defect --
//
//   - get_committed_sheet_grid (the grid-only fork: general specs, Make Lists). Its consumer read
//     `isInitLoading={gridData === undefined}` / `initError={gridData === null ? ... : null}`,
//     the retired convention VERBATIM, so a failed grid load spun forever;
//   - get_cross_boq_carry_plan, feeding `loading: carryPlanData === undefined` into
//     carryButtonState, so a failed plan fetch pinned the carry button in its loading state.
//
// That outcome is worse than the uniform bug, and PE-SPIN-1's own brief said so by name: a page
// whose failure behaviour differs by WHICH fetch broke is unpredictable. These tests exist to keep
// all three fetches on ONE rule.
describe("gridLoadState -- survivor 1, the grid-only sheet", () => {
  it("reports a first-load failure as an error, NOT as still loading", () => {
    // THE SURVIVING BUG, stated directly. `gridData === undefined` was the whole loading test, so
    // a thrown fetch (data stays undefined, error is set) span forever on a general-specs sheet.
    const state = gridLoadState({ data: undefined, error: new Error("Network Error") });

    expect(state.status).toBe("error");
    expect(state.isFailed).toBe(true);
    expect(state.isLoading).toBe(false); // the permanent spinner, on the second fetch
    expect(state.message).not.toBeNull();
  });

  it("describes ITS OWN fetch, not the sheet's pricing rows", () => {
    // Wording is why this is a message SET and not a shared constant: a grid-only sheet has no
    // pricing rows to fail to load, so the sheet fetch's wording would misdirect the reader.
    const grid = gridLoadState({ data: undefined, error: new Error("boom") });
    const sheet = pricingLoadState({ data: undefined, error: new Error("boom") });

    expect(grid.message).not.toBe(sheet.message);
    expect(grid.message).not.toMatch(/pricing rows/);
  });

  it("keeps the empty case worded apart from the network-failure case", () => {
    const empty = gridLoadState({ data: { message: null }, error: undefined });
    const failed = gridLoadState({ data: undefined, error: new Error("boom") });

    expect(empty.status).toBe("empty");
    expect(empty.isFailed).toBe(true);
    expect(empty.message).not.toBe(failed.message);
  });

  it("keeps a retained grid on screen after a failed refresh, flagged stale", () => {
    const state = gridLoadState({ data: { message: { rows: [{}] } }, error: new Error("500") });

    expect(state.status).toBe("stale");
    expect(state.isUsable).toBe(true); // the reference grid stays readable
    expect(state.isFailed).toBe(false);
    expect(state.message).not.toBeNull();
  });
});

describe("carryPlanLoadState -- survivor 2, the carry button", () => {
  it("stops claiming to be loading once the plan fetch has FAILED", () => {
    // THE SURVIVING BUG. `loading: carryPlanData === undefined` never went false on a failure, so
    // "Checking what can be carried from the original…" was the button's permanent state.
    const state = carryPlanLoadState({ data: undefined, error: new Error("500") });

    expect(state.isLoading).toBe(false);
    expect(state.isFailed).toBe(true);
    expect(state.message).not.toBeNull(); // ...and there is something honest to say instead
  });

  it("describes ITS OWN fetch", () => {
    const carry = carryPlanLoadState({ data: undefined, error: new Error("boom") });
    const sheet = pricingLoadState({ data: undefined, error: new Error("boom") });

    expect(carry.message).not.toBe(sheet.message);
  });

  it("reports a DISABLED fetch as loading, never as a failure", () => {
    // Off a revision the swrKey is null, so the fetch never runs: no data, no error. The button is
    // hidden in that case, but the state must not read as a failure -- a disabled fetch has not
    // failed, and treating it as one would put an error tooltip on a hidden control.
    const state = carryPlanLoadState(pending);

    expect(state.status).toBe("loading");
    expect(state.isFailed).toBe(false);
  });
});

// ── BCS-S4: survivor 3, and it is the BCS arc's OWN defect ───────────────────────────────────
//
// `get_sheet_bcs_rates` was the fourth fetch on this page and the only one still degrading via
// `?? []`. An empty rate map is not "no answer yet" to the cost block -- it renders as the
// ANSWER "nothing on this sheet has been costed": every cost box blank, every Total Amount and
// % Profit blank, and (until this slice) every box still editable. A fully costed sheet and a
// sheet nobody has touched were pixel-identical behind a failed read.
//
// That is worse than the permanent spinner PE-SPIN-1 closed. A spinner is visibly unfinished; this
// was finished-looking and wrong, so the honest reactions to it are to re-enter two hundred
// figures over the top of costs that already exist, or to report the data as lost.
describe("bcsRatesLoadState -- survivor 3, the cost rows", () => {
  it("reports a first-load failure as an error, NOT as an uncosted sheet", () => {
    // THE BUG, stated directly. The page read `bcsRatesData?.message?.rows ?? []`, so a thrown
    // fetch produced an empty Map and the cost columns rendered as though nothing was costed.
    const state = bcsRatesLoadState({ data: undefined, error: new Error("Network Error") });

    expect(state.status).toBe("error");
    expect(state.isFailed).toBe(true);
    expect(state.isUsable).toBe(false); // <- the page hangs the whole cost block off this
    expect(state.isLoading).toBe(false);
    expect(state.message).not.toBeNull();
  });

  it("is NOT usable while the first read is still in flight", () => {
    // The same rule one moment earlier. `isUsable` is what the page gates the cost block on, so a
    // pending read must not open it either -- blank cost boxes for 200ms then filling in is the
    // identical lie in miniature.
    const state = bcsRatesLoadState(pending);

    expect(state.isLoading).toBe(true);
    expect(state.isUsable).toBe(false);
    expect(state.isFailed).toBe(false); // ...but a fetch that has not run has not failed
  });

  it("describes ITS OWN fetch -- the costs, not the sheet's pricing rows", () => {
    const bcs = bcsRatesLoadState({ data: undefined, error: new Error("boom") });
    const sheet = pricingLoadState({ data: undefined, error: new Error("boom") });

    expect(bcs.message).not.toBe(sheet.message);
    expect(bcs.message).not.toMatch(/pricing rows/);
    expect(bcs.message).toMatch(/cost/i);
  });

  it("keeps the empty case worded apart from the network-failure case", () => {
    const empty = bcsRatesLoadState({ data: { message: null }, error: undefined });
    const failed = bcsRatesLoadState({ data: undefined, error: new Error("boom") });

    expect(empty.status).toBe("empty");
    expect(empty.isFailed).toBe(true);
    expect(empty.message).not.toBe(failed.message);
  });

  it("treats a payload carrying ZERO cost rows as READY, not as empty", () => {
    // The distinction the `?? []` degrade destroyed, from the other side: a genuinely uncosted
    // sheet answers `{rows: []}`, which is a real answer and must render the (blank) cost block
    // normally. `empty` is reserved for a null `message` -- no answer at all.
    const state = bcsRatesLoadState({ data: { message: { rows: [] } }, error: undefined });

    expect(state.status).toBe("ready");
    expect(state.isUsable).toBe(true);
    expect(state.message).toBeNull();
  });

  it("keeps retained costs on screen after a failed refresh, flagged stale", () => {
    // Same trade as the sheet and the grid: blanking a live costing session over one transient
    // blip is its own harm, so the last good costs stay -- but they must not claim to be current.
    const state = bcsRatesLoadState({
      data: { message: { rows: [{ excel_row: 4 }] } },
      error: new Error("500"),
    });

    expect(state.status).toBe("stale");
    expect(state.isUsable).toBe(true);
    expect(state.isFailed).toBe(false);
    expect(state.message).not.toBeNull();
  });
});

// ── BCS-S4: the state that was built and never shown ─────────────────────────────────────────
//
// `CARRY_PLAN_STATES.stale` existed from PE-SPIN-1-fix and NOTHING read `carryPlanLoad.isStale`.
// It is reachable -- a failed REVALIDATION leaves `data.message` populated with `error` set, so
// `isFailed` is false and the carry button presented plan data of unknown age with no indication
// whatever. The sheet and grid fetches each got a stale strip for exactly this case; the carry
// fetch, whose only surface is a tooltip, got nothing.
//
// `withStaleNote` is the missing surface: it composes a fetch's stale wording onto whatever text a
// control already shows, so a stale state can be SURFACED anywhere a strip does not fit.
describe("withStaleNote -- surfacing a stale fetch on a control that has only a title", () => {
  const staleSignals: PricingFetchSignals = {
    data: { message: { sheets: [{}] } },
    error: new Error("500"),
  };

  it("appends the fetch's stale wording to a title when the read is stale", () => {
    const load = carryPlanLoadState(staleSignals);
    const title = withStaleNote("Copy the original BoQ's rates into this sheet", load);

    expect(load.isStale).toBe(true);
    expect(title).toContain("Copy the original BoQ's rates into this sheet");
    expect(title).toContain(load.message!); // the state finally reaches a surface
  });

  it("returns the title UNCHANGED when the fetch is healthy", () => {
    // A healthy load is silent -- exactly as the module's `ready` state carries a null message.
    const load = carryPlanLoadState({ data: { message: { sheets: [] } }, error: undefined });

    expect(withStaleNote("Carry", load)).toBe("Carry");
  });

  it("returns the title UNCHANGED when the fetch has hard-failed", () => {
    // A hard failure has its own voiced message and its own surface (the disabled reason). Adding
    // the stale sentence there would say "this may be out of date" about data we do not hold.
    const load = carryPlanLoadState({ data: undefined, error: new Error("500") });

    expect(load.isFailed).toBe(true);
    expect(withStaleNote("Carry", load)).toBe("Carry");
  });

  it("carries the stale note alone when the control has no title of its own", () => {
    const load = carryPlanLoadState(staleSignals);

    expect(withStaleNote(null, load)).toBe(load.message);
    expect(withStaleNote("", load)).toBe(load.message);
  });

  it("returns null for a healthy fetch with no title, so no empty tooltip is rendered", () => {
    const load = carryPlanLoadState({ data: { message: { sheets: [] } }, error: undefined });

    expect(withStaleNote(null, load)).toBeNull();
  });
});

describe("all four fetches share ONE rule", () => {
  // The POINT of this slice: the precedence rule has a single implementation and the message set is
  // the only thing that varies. If a future edit gives one fetch its own logic, this fails -- which
  // is the drift that produced two survivors in the first place.
  const cases: Array<[string, PricingFetchSignals]> = [
    ["first-load failure", { data: undefined, error: new Error("x") }],
    ["failed revalidation", { data: { message: { a: 1 } }, error: new Error("x") }],
    ["pending", pending],
    ["ready", { data: { message: { a: 1 } }, error: undefined }],
    ["null message", { data: { message: null }, error: undefined }],
    ["absent message key", { data: {}, error: undefined }],
  ];

  it.each(cases)("agrees on the status for a %s", (_label, signals) => {
    const expected = loadStatus(signals);

    expect(pricingLoadState(signals).status).toBe(expected);
    expect(gridLoadState(signals).status).toBe(expected);
    expect(carryPlanLoadState(signals).status).toBe(expected);
    expect(bcsRatesLoadState(signals).status).toBe(expected);
  });

  it("returns SHARED SINGLETONS per fetch, so a state never churns a downstream memo", () => {
    // PE-SPIN-1 relied on this: the returned object is reference-stable per status, so it can be
    // read beside memoized grid props without contributing a fresh object every render. Building a
    // message set per call would have quietly destroyed that -- hence one frozen table per fetch,
    // built at module load.
    const a = gridLoadState({ data: undefined, error: new Error("1") });
    const b = gridLoadState({ data: undefined, error: new Error("2") });
    expect(a).toBe(b);

    const c = carryPlanLoadState(pending);
    const d = carryPlanLoadState({ data: undefined, error: null });
    expect(c).toBe(d);
  });

  it("gives each fetch its OWN singletons, so no wording can leak between them", () => {
    expect(gridLoadState(pending)).not.toBe(carryPlanLoadState(pending));
    expect(bcsRatesLoadState(pending)).not.toBe(gridLoadState(pending));
    expect(bcsRatesLoadState(pending)).not.toBe(pricingLoadState(pending));
  });
});
