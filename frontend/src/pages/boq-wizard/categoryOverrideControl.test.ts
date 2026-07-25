// Slice G3b unit tests for the admin category-gate override control's pure logic.
//
// The control (set/clear buttons in the pricing editor's category-gate banner) is JSX -- this project
// runs vitest in the `node` environment with NO jsdom / @testing-library (vitest.config.ts), so the
// rendering itself is covered by the manual browser cert. What IS unit-tested here is the two pure
// helpers the JSX delegates to, which are the whole of the control's decision logic:
//   - canAdminOverride(role, userId): may the current user SEE the control? (role-resolved AND admin)
//   - normalizeOverrideReason(raw): the optional-reason cap + blank->null normalisation for the POST.
// The server (set/clear_category_override, _is_nirmaan_admin, _CATEGORY_OVERRIDE_REASON_MAX_LEN) stays
// authoritative; these helpers are the client-side convenience mirror.
import { describe, it, expect } from "vitest";

import {
  canAdminOverride,
  normalizeOverrideReason,
  CATEGORY_OVERRIDE_REASON_MAX_LEN,
} from "./SheetPricingPage";

describe("canAdminOverride (G3b control visibility)", () => {
  // (a) admin SEES the control.
  it("Administrator sees the control", () => {
    // useUserData maps the Administrator user to role "Nirmaan Admin Profile"; either signal admits.
    expect(canAdminOverride("Nirmaan Admin Profile", "Administrator")).toBe(true);
  });

  it("a Nirmaan Admin Profile user sees the control", () => {
    expect(canAdminOverride("Nirmaan Admin Profile", "someadmin@nirmaan.app")).toBe(true);
  });

  // (b) non-admin sees NEITHER control (banners still render -- that is the JSX, not this helper).
  it("a non-admin role does NOT see the control", () => {
    expect(canAdminOverride("Nirmaan Estimates Executive Profile", "estim@nirmaan.app")).toBe(false);
    expect(canAdminOverride("Nirmaan Project Manager Profile", "pm@nirmaan.app")).toBe(false);
  });

  // (c) role UNRESOLVED -> no control (no flash-in before it would disappear).
  it("the Loading sentinel hides the control even for the Administrator user", () => {
    // Guards the flash: while role is resolving we must not render on the userId signal alone.
    expect(canAdminOverride("Loading", "Administrator")).toBe(false);
  });

  it("the Error sentinel hides the control", () => {
    expect(canAdminOverride("Error", "someone@nirmaan.app")).toBe(false);
  });
});

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
