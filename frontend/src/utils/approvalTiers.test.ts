import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  APPROVAL_TIERS,
  TIER_AUTO_APPROVE_BELOW,
  TIER_L2_ABOVE,
  TIER_L2_ABOVE_EXPENSES,
  TIER_ACTION_HINTS,
  TIER_LABELS,
  initialStatus,
  isAutoApproved,
  needsCEO,
  requiredTier,
  statusAfterL1,
} from "./approvalTiers";

// The Python module is the authority; this mirror exists only to describe the outcome to
// the user. The PARITY block below reads that file so the two cannot drift silently --
// which is what `expenseApproval.test.ts` claims to do in its header but never actually did.
const PY_SOURCE = readFileSync(
  resolve(__dirname, "../../../nirmaan_stack/services/approval_tiers.py"),
  "utf-8"
);

describe("parity with approval_tiers.py", () => {
  it("reads the real Python module", () => {
    expect(PY_SOURCE).toContain("def required_tier");
  });

  it("TIER_AUTO_APPROVE_BELOW matches the Python constant", () => {
    const m = PY_SOURCE.match(/^TIER_AUTO_APPROVE_BELOW\s*=\s*([\d_.]+)/m);
    expect(m, "constant not found in approval_tiers.py").toBeTruthy();
    expect(Number(m![1].replace(/_/g, ""))).toBe(TIER_AUTO_APPROVE_BELOW);
  });

  it("TIER_L2_ABOVE matches the Python constant", () => {
    const m = PY_SOURCE.match(/^TIER_L2_ABOVE\s*=\s*([\d_.]+)/m);
    expect(m, "constant not found in approval_tiers.py").toBeTruthy();
    expect(Number(m![1].replace(/_/g, ""))).toBe(TIER_L2_ABOVE);
  });

  it("the lower edge is EXCLUSIVE in both (`value < TIER_AUTO_APPROVE_BELOW`)", () => {
    expect(PY_SOURCE).toMatch(/if\s+value\s*<\s*TIER_AUTO_APPROVE_BELOW/);
    expect(requiredTier(TIER_AUTO_APPROVE_BELOW)).not.toBe(APPROVAL_TIERS.auto);
  });

  it("the upper edge is INCLUSIVE in both (`value <= TIER_L2_ABOVE`)", () => {
    expect(PY_SOURCE).toMatch(/if\s+value\s*<=\s*l2_above/);
    expect(requiredTier(TIER_L2_ABOVE)).toBe(APPROVAL_TIERS.l1);
  });

  it("the sign only blocks auto-approval in both", () => {
    expect(PY_SOURCE).toMatch(/if\s+value\s*<=\s*0:/);
    expect(PY_SOURCE).toMatch(/return TIER_L1_L2 if value < -l2_above else TIER_L1/);
    expect(requiredTier(-1)).toBe(APPROVAL_TIERS.l1);
    expect(requiredTier(-60_000)).toBe(APPROVAL_TIERS.l1l2);
  });
});

describe("bands", () => {
  it("well inside each band", () => {
    expect(requiredTier(1)).toBe(APPROVAL_TIERS.auto);
    expect(requiredTier(9_999)).toBe(APPROVAL_TIERS.auto);
    expect(requiredTier(50_000)).toBe(APPROVAL_TIERS.l1);
    expect(requiredTier(100_000)).toBe(APPROVAL_TIERS.l1l2);
  });

  it("exactly 15,000 needs L1 — the edge REVERSES the 2026-09-04 expense ruling", () => {
    expect(requiredTier(14_999.99)).toBe(APPROVAL_TIERS.auto);
    expect(requiredTier(15_000)).toBe(APPROVAL_TIERS.l1);
  });

  it("exactly 50,000 stops AT L1", () => {
    expect(requiredTier(49_999.99)).toBe(APPROVAL_TIERS.l1);
    expect(requiredTier(50_000)).toBe(APPROVAL_TIERS.l1);
    expect(requiredTier(50_000.01)).toBe(APPROVAL_TIERS.l1l2);
  });
});

describe("refunds and unreadable input", () => {
  it("the sign ONLY blocks auto-approval — size decides the tier", () => {
    for (const amount of [-1, -500, -14_999, -50_000]) {
      expect(requiredTier(amount), `amount ${amount}`).toBe(APPROVAL_TIERS.l1);
    }
    for (const amount of [-50_000.01, -60_000]) {
      expect(requiredTier(amount), `amount ${amount}`).toBe(APPROVAL_TIERS.l1l2);
    }
  });

  it("a refund is NEVER auto-approved, at any size", () => {
    for (const amount of [-1, -500, -14_999, -60_000]) {
      expect(isAutoApproved(amount), `amount ${amount}`).toBe(false);
    }
  });

  it("zero is never auto-approved", () => {
    expect(isAutoApproved(0)).toBe(false);
  });

  it("unreadable amounts are never auto-approved", () => {
    for (const amount of [null, undefined, "", "abc"]) {
      expect(requiredTier(amount), `amount ${String(amount)}`).toBe(APPROVAL_TIERS.l1);
      expect(isAutoApproved(amount)).toBe(false);
    }
  });
});

describe("numeric strings — Project Expenses.amount is a varchar column", () => {
  it("bands by VALUE, not by characters", () => {
    // A raw string compare would put "9000" above "50000".
    expect(requiredTier("9000")).toBe(APPROVAL_TIERS.auto);
    expect(requiredTier("50000")).toBe(APPROVAL_TIERS.l1);
    expect(requiredTier("60000")).toBe(APPROVAL_TIERS.l1l2);
  });

  it("a string and its number agree", () => {
    expect(requiredTier("9000")).toBe(requiredTier(9000));
    expect(requiredTier("50000")).toBe(requiredTier(50000));
  });
});

describe("statuses", () => {
  it("initialStatus is Approved only for the auto band", () => {
    expect(initialStatus(5_000)).toBe("Approved");
    expect(initialStatus(15_000)).toBe("Requested");
    expect(initialStatus(-100)).toBe("Requested");
    expect(initialStatus(-60_000)).toBe("Requested");
  });

  it("L1 FINISHES the middle band and FORWARDS the top", () => {
    expect(statusAfterL1(15_000)).toBe("Approved");
    expect(statusAfterL1(50_000)).toBe("Approved");
    expect(statusAfterL1(50_000.01)).toBe("CEO Pending");
  });

  it("predicates agree with requiredTier", () => {
    for (const amount of [-5, 0, 1, 14_999, 15_000, 50_000, 50_001]) {
      const tier = requiredTier(amount);
      expect(isAutoApproved(amount)).toBe(tier === APPROVAL_TIERS.auto);
      expect(needsCEO(amount)).toBe(tier === APPROVAL_TIERS.l1l2);
    }
  });
});

describe("copy", () => {
  it("every tier has a label and an action hint", () => {
    for (const tier of Object.values(APPROVAL_TIERS)) {
      expect(TIER_LABELS[tier]).toBeTruthy();
      expect(TIER_ACTION_HINTS[tier]).toBeTruthy();
    }
  });

  it("the hints say what the click DOES — the reason the Tier column exists", () => {
    expect(TIER_ACTION_HINTS.l1).toMatch(/finishes/i);
    expect(TIER_ACTION_HINTS.l1_l2).toMatch(/CEO/);
  });
});

describe("the CEO line is PER-LEDGER", () => {
  it("TIER_L2_ABOVE_EXPENSES matches the Python constant", () => {
    const m = PY_SOURCE.match(/^TIER_L2_ABOVE_EXPENSES\s*=\s*([\d_.]+)/m);
    expect(m).toBeTruthy();
    expect(Number(m![1].replace(/_/g, ""))).toBe(TIER_L2_ABOVE_EXPENSES);
  });

  it("40,000 is L1 for payments but L1+L2 for expenses", () => {
    expect(requiredTier(40_000)).toBe(APPROVAL_TIERS.l1);
    expect(requiredTier(40_000, TIER_L2_ABOVE_EXPENSES)).toBe(APPROVAL_TIERS.l1l2);
    expect(statusAfterL1(40_000)).toBe("Approved");
    expect(statusAfterL1(40_000, TIER_L2_ABOVE_EXPENSES)).toBe("CEO Pending");
  });

  it("the AUTO band is identical on both ledgers", () => {
    for (const amount of [0.01, 1, 14_999, 14_999.99]) {
      expect(requiredTier(amount)).toBe(APPROVAL_TIERS.auto);
      expect(requiredTier(amount, TIER_L2_ABOVE_EXPENSES)).toBe(APPROVAL_TIERS.auto);
    }
  });
});
