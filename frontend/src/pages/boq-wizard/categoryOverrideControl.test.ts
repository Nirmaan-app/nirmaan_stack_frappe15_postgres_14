// Slice G3b unit tests for the admin category-gate override control's pure logic.
//
// The control (set/clear buttons in the pricing editor's category-gate banner) is JSX -- this project
// runs vitest in the `node` environment with NO jsdom / @testing-library (vitest.config.ts), so the
// rendering itself is covered by the manual browser cert. Who may SEE the control is the shared
// `isNirmaanAdmin` (constants/roles.test.ts). What IS unit-tested here is the pure helper the JSX
// delegates the reason to:
//   - normalizeOverrideReason(raw): the optional-reason cap + blank->null normalisation for the POST.
// The server (set/clear_category_override, _is_nirmaan_admin, _CATEGORY_OVERRIDE_REASON_MAX_LEN) stays
// authoritative; these helpers are the client-side convenience mirror.
import { describe, it, expect } from "vitest";

import {
  normalizeOverrideReason,
  CATEGORY_OVERRIDE_REASON_MAX_LEN,
} from "./SheetPricingPage";

describe("normalizeOverrideReason (G3b optional-reason normalisation)", () => {
  // (d) blank reason is VALID -> null (server stores NULL).
  it("maps an empty string to null", () => {
    expect(normalizeOverrideReason("")).toBe(null);
  });

  it("maps a whitespace-only reason to null", () => {
    expect(normalizeOverrideReason("   ")).toBe(null);
  });

  it("passes a normal reason through, trimmed", () => {
    expect(normalizeOverrideReason("  awaiting HVAC engine  ")).toBe("awaiting HVAC engine");
  });

  // (d) over-long reason is capped client-side (belt to the input maxLength suspenders).
  it("caps an over-long reason to the max length", () => {
    const tooLong = "x".repeat(CATEGORY_OVERRIDE_REASON_MAX_LEN + 50);
    const out = normalizeOverrideReason(tooLong);
    expect(out).not.toBeNull();
    expect((out as string).length).toBe(CATEGORY_OVERRIDE_REASON_MAX_LEN);
  });

  it("caps BEFORE trimming so trailing spaces past the cap cannot smuggle length back", () => {
    // slice(0, MAX) then trim: an input that is MAX real chars + trailing spaces stays at MAX.
    const out = normalizeOverrideReason("y".repeat(CATEGORY_OVERRIDE_REASON_MAX_LEN) + "     ");
    expect((out as string).length).toBe(CATEGORY_OVERRIDE_REASON_MAX_LEN);
  });

  it("keeps the client cap in lockstep with the server constant (250)", () => {
    expect(CATEGORY_OVERRIDE_REASON_MAX_LEN).toBe(250);
  });
});
