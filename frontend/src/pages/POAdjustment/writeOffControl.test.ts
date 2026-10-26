// D5 unit tests for the write-off control's reason handling.
//
// The dialog itself is JSX, and this project runs vitest in the `node` environment with NO
// jsdom / @testing-library (vitest.config.ts), so the rendering is covered by manual check.
// Who may SEE the control is the shared `isNirmaanAdmin` (constants/roles.test.ts). What is
// tested here is the pure helper the JSX delegates the reason to:
//   - normalizeWriteOffReason(raw): the MANDATORY-reason cap + validity, which gates submit.
//
// The server (`write_off_adjustment`, WRITE_OFF_REASON_MAX_LEN) stays authoritative.
import { describe, it, expect } from "vitest";

import { normalizeWriteOffReason } from "./data/usePOAdjustmentMutations";
import { WRITE_OFF_REASON_MAX_LEN } from "./data/poAdjustment.constants";

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
