// Unit tests for the T1 reconnect-gate helper (pricing editor socket self-heal).
//
// shouldRefetchOnConnect decides whether a socket "connect" should trigger the editor's
// get_priced_rows + get_sheet_categories refetch. The gate exists to kill the continuous idle
// re-render storm: a flapping dev socket fired the old unconditional connect handlers on EVERY
// connect (incl. the initial mount one), each refetch minting new data identities -> a full
// non-memoized grid reconcile. The rule: fire ONLY on a genuine reconnect (a connect that followed
// a disconnect), skip the initial connect, and debounce to <=1 refetch per window.
import { describe, it, expect } from "vitest";

import { shouldRefetchOnConnect, RECONNECT_REFETCH_DEBOUNCE_MS } from "./SheetPricingPage";

describe("shouldRefetchOnConnect (T1 reconnect-gate)", () => {
  const NOW = 1_000_000;

  it("skips the initial connect (no disconnect seen yet) -> no load double-fetch", () => {
    expect(
      shouldRefetchOnConnect({ sawDisconnect: false, lastRefetchAt: 0 }, NOW),
    ).toBe(false);
  });

  it("fires on a genuine reconnect (a connect that followed a disconnect)", () => {
    expect(
      shouldRefetchOnConnect({ sawDisconnect: true, lastRefetchAt: 0 }, NOW),
    ).toBe(true);
  });

  it("debounces a flap within the window (reconnect too soon after the last refetch)", () => {
    expect(
      shouldRefetchOnConnect(
        { sawDisconnect: true, lastRefetchAt: NOW - (RECONNECT_REFETCH_DEBOUNCE_MS - 5_000) },
        NOW,
      ),
    ).toBe(false);
  });

  it("fires again once the debounce window has fully elapsed", () => {
    expect(
      shouldRefetchOnConnect(
        { sawDisconnect: true, lastRefetchAt: NOW - (RECONNECT_REFETCH_DEBOUNCE_MS + 1_000) },
        NOW,
      ),
    ).toBe(true);
  });

  it("treats the exact window boundary as elapsed (>=)", () => {
    expect(
      shouldRefetchOnConnect(
        { sawDisconnect: true, lastRefetchAt: NOW - RECONNECT_REFETCH_DEBOUNCE_MS },
        NOW,
      ),
    ).toBe(true);
  });
});
