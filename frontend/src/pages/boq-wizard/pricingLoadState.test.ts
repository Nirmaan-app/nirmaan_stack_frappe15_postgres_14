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
  pricingLoadState,
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
