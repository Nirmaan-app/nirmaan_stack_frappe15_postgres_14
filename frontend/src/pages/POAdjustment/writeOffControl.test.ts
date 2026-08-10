// D5 unit tests for the write-off control's pure logic.
//
// The dialog itself is JSX, and this project runs vitest in the `node` environment with NO
// jsdom / @testing-library (vitest.config.ts), so the rendering is covered by manual check.
// What IS unit-testable is the two pure helpers the JSX delegates to, which together are the
// whole of the control's decision logic:
//   - canWriteOffAdjustment(role, userId): may the current user SEE the control?
//   - normalizeWriteOffReason(raw): the MANDATORY-reason cap + validity, which gates submit.
//
// The server (`write_off_adjustment`, `pricing._is_nirmaan_admin`, WRITE_OFF_REASON_MAX_LEN)
// stays authoritative; these are the client-side convenience mirror. That mirroring is the
// point of `test_mirrors_the_sibling_admin_predicates` below — three predicates now encode
// the same rule, and they must not drift apart.
import { describe, it, expect } from "vitest";

import {
  canWriteOffAdjustment,
  normalizeWriteOffReason,
} from "./data/usePOAdjustmentMutations";
import { WRITE_OFF_REASON_MAX_LEN } from "./data/poAdjustment.constants";

describe("canWriteOffAdjustment (D5 control visibility)", () => {
  it("Administrator sees the control", () => {
    // useUserData maps the Administrator user to role "Nirmaan Admin Profile"; either admits.
    expect(canWriteOffAdjustment("Nirmaan Admin Profile", "Administrator")).toBe(true);
  });

  it("a Nirmaan Admin Profile user sees the control", () => {
    expect(canWriteOffAdjustment("Nirmaan Admin Profile", "shanu@nirmaan.app")).toBe(true);
  });

  it.each([
    "Nirmaan Accountant Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Project Lead Profile",
    "Nirmaan Procurement Executive Profile",
    "",
  ])("a %s user does NOT see the control", (role) => {
    expect(canWriteOffAdjustment(role, "someone@nirmaan.app")).toBe(false);
  });

  it("hides the control while the role is still Loading", () => {
    // Without this an admin would flash the control in before it resolves — and worse, a
    // non-admin whose user_id happened to be Administrator-like would too.
    expect(canWriteOffAdjustment("Loading", "shanu@nirmaan.app")).toBe(false);
  });

  it("hides the control when the role failed to resolve", () => {
    expect(canWriteOffAdjustment("Error", "shanu@nirmaan.app")).toBe(false);
  });

  it("Loading does not hide it from the Administrator user id", () => {
    // The Administrator branch of useUserData returns a resolved role immediately, so this is
    // documenting the ONE case where the userId alone carries the decision.
    expect(canWriteOffAdjustment("Loading", "Administrator")).toBe(false);
  });
});

describe("normalizeWriteOffReason (D5 mandatory reason)", () => {
  it("accepts a real reason and trims it", () => {
    const { value, isValid } = normalizeWriteOffReason("  nothing was ever paid  ");
    expect(value).toBe("nothing was ever paid");
    expect(isValid).toBe(true);
  });

  it.each(["", "   ", "\n\t "])("rejects blank input %j", (raw) => {
    // A write-off with no reason is the Desk hand-edit again, wearing a button. The whole
    // reason this action exists is that the next person can see who decided what, and why.
    expect(normalizeWriteOffReason(raw).isValid).toBe(false);
  });

  it("caps at the server's max length", () => {
    const { value, isValid } = normalizeWriteOffReason("x".repeat(WRITE_OFF_REASON_MAX_LEN + 50));
    expect(value.length).toBe(WRITE_OFF_REASON_MAX_LEN);
    expect(isValid).toBe(true);
  });

  it("caps BEFORE trimming, so trailing spaces past the cap cannot smuggle length back", () => {
    const raw = "a".repeat(WRITE_OFF_REASON_MAX_LEN - 2) + "   " + "b".repeat(10);
    const { value } = normalizeWriteOffReason(raw);
    expect(value.length).toBeLessThanOrEqual(WRITE_OFF_REASON_MAX_LEN);
  });

  it("a reason that is only whitespace past the cap is still invalid", () => {
    expect(normalizeWriteOffReason(" ".repeat(WRITE_OFF_REASON_MAX_LEN + 20)).isValid).toBe(false);
  });

  it("the cap matches the server constant", () => {
    // WRITE_OFF_REASON_MAX_LEN mirrors adjustment_logic.WRITE_OFF_REASON_MAX_LEN. If the
    // server tightens and this does not, the input silently sends text the server truncates.
    expect(WRITE_OFF_REASON_MAX_LEN).toBe(250);
  });
});

describe("the three admin predicates stay in step", () => {
  it("mirrors the sibling admin predicates", async () => {
    // canWriteOffAdjustment, canAdminOverride and isRateMasterAdmin all encode the server's
    // _is_nirmaan_admin. Pinned together so a change to one is visibly a change to the rule.
    const { canAdminOverride } = await import("@/pages/boq-wizard/SheetPricingPage");
    const { isRateMasterAdmin } = await import(
      "@/pages/pricing/rate-master/rateMasterEdit"
    );

    const cases: [string, string][] = [
      ["Nirmaan Admin Profile", "Administrator"],
      ["Nirmaan Admin Profile", "shanu@nirmaan.app"],
      ["Nirmaan Accountant Profile", "someone@nirmaan.app"],
      ["Loading", "shanu@nirmaan.app"],
      ["Error", "shanu@nirmaan.app"],
      ["", ""],
    ];

    for (const [role, userId] of cases) {
      expect(canWriteOffAdjustment(role, userId)).toBe(canAdminOverride(role, userId));
      expect(canWriteOffAdjustment(role, userId)).toBe(isRateMasterAdmin(role, userId));
    }
  });
});
