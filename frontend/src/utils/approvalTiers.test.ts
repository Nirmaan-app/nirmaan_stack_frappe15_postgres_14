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
  RAISER_LEVELS,
  initialStatusForRaiser,
  raiserLevelOf,
  raiserLandingNote,
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

// ⚠️ INVERTED 16 Sep 2026. This block used to assert the CEO lines DIFFERED —
// payments 50,000, both expense ledgers 30,000 — and 40,000 was its witness.
// The owner moved the expense line to 50,000, so 40,000 now finishes at L1
// everywhere. The assertions are inverted rather than deleted: a silent revert
// to 30,000 must fail here, not pass unnoticed.
describe("the CEO line is SHARED by all three ledgers", () => {
  it("TIER_L2_ABOVE_EXPENSES matches the Python constant", () => {
    const m = PY_SOURCE.match(/^TIER_L2_ABOVE_EXPENSES\s*=\s*([\d_.]+)/m);
    expect(m).toBeTruthy();
    expect(Number(m![1].replace(/_/g, ""))).toBe(TIER_L2_ABOVE_EXPENSES);
  });

  it("both lines are 50,000, and are still two separate names", () => {
    expect(TIER_L2_ABOVE).toBe(50_000);
    expect(TIER_L2_ABOVE_EXPENSES).toBe(50_000);
  });

  it("40,000 — the amount that moved — finishes at L1 on every ledger", () => {
    expect(requiredTier(40_000)).toBe(APPROVAL_TIERS.l1);
    expect(requiredTier(40_000, TIER_L2_ABOVE_EXPENSES)).toBe(APPROVAL_TIERS.l1);
    expect(statusAfterL1(40_000)).toBe("Approved");
    expect(statusAfterL1(40_000, TIER_L2_ABOVE_EXPENSES)).toBe("Approved");
  });

  it("60,000 still needs the CEO on every ledger", () => {
    for (const l2Above of [TIER_L2_ABOVE, TIER_L2_ABOVE_EXPENSES]) {
      expect(requiredTier(60_000, l2Above)).toBe(APPROVAL_TIERS.l1l2);
      expect(statusAfterL1(60_000, l2Above)).toBe("CEO Pending");
    }
  });

  it("the AUTO band is identical on both ledgers", () => {
    for (const amount of [0.01, 1, 14_999, 14_999.99]) {
      expect(requiredTier(amount)).toBe(APPROVAL_TIERS.auto);
      expect(requiredTier(amount, TIER_L2_ABOVE_EXPENSES)).toBe(APPROVAL_TIERS.auto);
    }
  });
});

describe("raiser level (owner, 2026-09-21)", () => {
  const CEO = "nitesh@nirmaan.app";

  it("the Python module carries the same rule", () => {
    expect(PY_SOURCE).toContain("def initial_status_for_raiser");
    expect(PY_SOURCE).toMatch(/if raiser_level == RAISER_CEO:\s*\n\s*return STATUS_APPROVED/);
    expect(PY_SOURCE).toMatch(/return STATUS_CEO_PENDING if tier == TIER_L1_L2 else STATUS_APPROVED/);
  });

  it("who counts as which level", () => {
    expect(raiserLevelOf("Nirmaan Admin Profile", CEO, CEO)).toBe(RAISER_LEVELS.ceo);
    expect(raiserLevelOf("Nirmaan Admin Profile", "someone@nirmaan.app", CEO)).toBe(RAISER_LEVELS.l1);
    expect(raiserLevelOf("Nirmaan Admin Profile", "Administrator", CEO)).toBe(RAISER_LEVELS.l1);
    // Accountants are NOT L1 here, even though the bulk endpoint admits them.
    expect(raiserLevelOf("Nirmaan Accountant Profile", "acc@nirmaan.app", CEO)).toBeNull();
    expect(raiserLevelOf("Nirmaan Procurement Executive Profile", "p@nirmaan.app", CEO)).toBeNull();
  });

  it("the table: anyone else / L1 / CEO across the three bands", () => {
    const L1 = RAISER_LEVELS.l1;
    const C = RAISER_LEVELS.ceo;
    // auto band: untouched by who raises it
    for (const lvl of [null, L1, C]) expect(initialStatusForRaiser(5_000, TIER_L2_ABOVE, lvl)).toBe("Approved");
    // 15k-50k
    expect(initialStatusForRaiser(30_000, TIER_L2_ABOVE, null)).toBe("Requested");
    expect(initialStatusForRaiser(30_000, TIER_L2_ABOVE, L1)).toBe("Approved");
    expect(initialStatusForRaiser(30_000, TIER_L2_ABOVE, C)).toBe("Approved");
    // above 50k
    expect(initialStatusForRaiser(80_000, TIER_L2_ABOVE, null)).toBe("Requested");
    expect(initialStatusForRaiser(80_000, TIER_L2_ABOVE, L1)).toBe("CEO Pending");
    expect(initialStatusForRaiser(80_000, TIER_L2_ABOVE, C)).toBe("Approved");
  });

  it("no level is exactly initialStatus", () => {
    for (const amount of [-60_000, -5, 0, 5_000, 15_000, 50_000, 50_001]) {
      expect(initialStatusForRaiser(amount, TIER_L2_ABOVE, null)).toBe(initialStatus(amount));
    }
  });

  it("the dialog note appears only when the raiser changes the landing", () => {
    expect(raiserLandingNote(5_000, TIER_L2_ABOVE, RAISER_LEVELS.l1)).toBeNull();
    expect(raiserLandingNote(30_000, TIER_L2_ABOVE, null)).toBeNull();
    expect(raiserLandingNote(30_000, TIER_L2_ABOVE, RAISER_LEVELS.l1)).toMatch(/approved as soon as/);
    expect(raiserLandingNote(80_000, TIER_L2_ABOVE, RAISER_LEVELS.l1)).toMatch(/straight to the CEO/);
    expect(raiserLandingNote(80_000, TIER_L2_ABOVE, RAISER_LEVELS.ceo)).toMatch(/CEO approval/);
  });
});
