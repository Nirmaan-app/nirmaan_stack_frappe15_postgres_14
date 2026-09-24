// src/utils/approvalTiers.ts
//
// Frontend MIRROR of `nirmaan_stack/services/approval_tiers.py`.
// THE PYTHON FILE IS THE AUTHORITY. This exists only so the UI can TELL the user which
// path their payment or expense is about to take -- which approvals it needs, and what
// their own click will do. `approvalTiers.test.ts` reads the Python source and fails if
// the two ever disagree.
//
// THE RULE (owner note, 11/09/2026)
//     amount < 15,000            -> AUTO.   Created `Approved`; no human sees it.
//     15,000 <= amount <= 50,000 -> L1.     One signature FINISHES it.
//     amount > 50,000            -> L1+L2.  L1 forwards, the CEO approves.
//     amount <= 0                -> NOT auto. Banded by SIZE like any other amount.
//
// ⚠️ THE EDGES ARE THE RULE. "Below 15000" / "15000 to <l2>" / "Above <l2>" -- so exactly
// 15,000 needs L1, and exactly 50,000 stops AT L1. This REVERSES the expense ruling of
// 2026-09-04 (`<= 10000`, inclusive), which still stands documented in `expenseApproval.ts`
// until that module is retired. Do not "fix" one to match the other.
//
// ⚠️ THE SIGN DOES ONE THING ONLY: IT BLOCKS AUTO-APPROVAL (owner, 2026-09-15). That is
// exactly what it did before -- both ledgers guarded auto-approval with `0 < amount` and
// the sign had no other effect. A -₹500 refund therefore takes L1; a -₹60,000 one takes
// both gates. An earlier revision forced every refund to L1+L2 and the owner reversed it.

import { parseNumber } from "./parseNumber";

/** Strictly BELOW this needs no human at all. */
export const TIER_AUTO_APPROVE_BELOW = 15000;
/** Strictly ABOVE this needs the CEO on top of L1. */
// ⚠️ ALL THREE LEDGERS NOW SHARE BOTH LINES (owner, 16 Sep 2026): auto below 15,000,
// L1 only from 15,000 to 50,000, CEO above 50,000. This REVERSES the per-ledger split
// of 15 Sep, which held the expense CEO line at 30,000 -- an expense between 30,000
// and 50,000 now FINISHES AT L1 instead of going to the CEO.
export const TIER_L2_ABOVE = 50000;
/**
 * The expense ledgers' CEO line. Kept as its own name even though it now equals
 * `TIER_L2_ABOVE`, so a future divergence is one line rather than a hunt through every
 * expense call site. Mirrors `TIER_L2_ABOVE_EXPENSES` in the Python module, which is the
 * authority; `approvalTiers.test.ts` reads the Python source and pins the two together.
 */
export const TIER_L2_ABOVE_EXPENSES = 50000;

export const APPROVAL_TIERS = {
  auto: "auto",
  l1: "l1",
  l1l2: "l1_l2",
} as const;

export type ApprovalTier = (typeof APPROVAL_TIERS)[keyof typeof APPROVAL_TIERS];

/** Short chip copy for the Tier column. */
export const TIER_LABELS: Record<ApprovalTier, string> = {
  auto: "AUTO",
  l1: "L1",
  l1_l2: "L1+L2",
};

/** What the approver's click will actually do -- the reason the Tier column exists. */
export const TIER_ACTION_HINTS: Record<ApprovalTier, string> = {
  auto: "Approved on creation — no approval needed",
  l1: "Your approval finishes this",
  l1_l2: "Your approval forwards this to the CEO",
};

/**
 * Which approvals this amount needs.
 *
 * ⚠️ `parseNumber` is load-bearing, not tidiness. `Project Expenses.amount` is a `Data`
 * column, so an amount arrives as a STRING -- and a raw string compare puts "9000" above
 * "50000", routing a ₹9,000 expense to the CEO. Anything unreadable parses to 0, which
 * falls into the `<= 0` branch: L1, and never auto. Not-auto is the property that matters --
 * guessing a tier wrong costs a signature, guessing AUTO wrong lets money out unreviewed.
 */
export const requiredTier = (
  amount: string | number | null | undefined,
  l2Above: number = TIER_L2_ABOVE
): ApprovalTier => {
  const value = parseNumber(amount);
  // The sign blocks AUTO only; magnitude decides the tier. Mirrors the Python branch
  // `return TIER_L1_L2 if value < -TIER_L2_ABOVE else TIER_L1`.
  if (value <= 0)
    return value < -l2Above ? APPROVAL_TIERS.l1l2 : APPROVAL_TIERS.l1;
  if (value < TIER_AUTO_APPROVE_BELOW) return APPROVAL_TIERS.auto;
  if (value <= l2Above) return APPROVAL_TIERS.l1;
  return APPROVAL_TIERS.l1l2;
};

/** The status a NEW record is created at. */
export const initialStatus = (
  amount: string | number | null | undefined,
  l2Above: number = TIER_L2_ABOVE
): "Approved" | "Requested" =>
  requiredTier(amount, l2Above) === APPROVAL_TIERS.auto ? "Approved" : "Requested";

/**
 * Where an L1 approval LANDS a record.
 *
 * ⚠️ The behaviour change for payments: today L1 always forwards to the CEO; under this
 * rule a 15k–50k approval is FINAL, and ~912 payments a year stop reaching them.
 */
export const statusAfterL1 = (
  amount: string | number | null | undefined,
  l2Above: number = TIER_L2_ABOVE
): "CEO Pending" | "Approved" =>
  requiredTier(amount, l2Above) === APPROVAL_TIERS.l1l2 ? "CEO Pending" : "Approved";

/** Whether this amount skips approval entirely. */
export const isAutoApproved = (
  amount: string | number | null | undefined
): boolean => requiredTier(amount) === APPROVAL_TIERS.auto;

/** Whether L2 is required on top of L1. */
export const needsCEO = (
  amount: string | number | null | undefined,
  l2Above: number = TIER_L2_ABOVE
): boolean => requiredTier(amount, l2Above) === APPROVAL_TIERS.l1l2;

// ── Who raised it (owner, 2026-09-21) — mirrors `initial_status_for_raiser` ─────────────────
//
//     raised by            15,000 - 50,000        above 50,000
//     anyone else          Requested (-> L1)      Requested (-> L1 -> CEO)
//     an L1 approver       Approved               CEO Pending   (L1 cleared)
//     the CEO              Approved               Approved      (L1 and CEO cleared)
//
// L1 = the Admin profile (`Administrator` arrives here as it, via `useUserData`); the CEO is
// `CEO_AUTHORIZED_USER`. THE SERVER DECIDES (`services/approval_raiser.py`); this only lets a
// request dialog say where the record will land before it is created.

export const RAISER_LEVELS = { l1: "l1", ceo: "ceo" } as const;
export type RaiserLevel = (typeof RAISER_LEVELS)[keyof typeof RAISER_LEVELS];

export const raiserLevelOf = (
  role: string | null | undefined,
  userId: string | null | undefined,
  ceoUser: string
): RaiserLevel | null => {
  if (userId && userId === ceoUser) return RAISER_LEVELS.ceo;
  if (userId === "Administrator" || role === "Nirmaan Admin Profile") return RAISER_LEVELS.l1;
  return null;
};

/** The status a NEW record is created at, given who raises it. `null` level = `initialStatus`. */
export const initialStatusForRaiser = (
  amount: string | number | null | undefined,
  l2Above: number = TIER_L2_ABOVE,
  level: RaiserLevel | null = null
): "Approved" | "CEO Pending" | "Requested" => {
  const tier = requiredTier(amount, l2Above);
  if (tier === APPROVAL_TIERS.auto) return "Approved";
  if (level === RAISER_LEVELS.ceo) return "Approved";
  if (level === RAISER_LEVELS.l1) return tier === APPROVAL_TIERS.l1l2 ? "CEO Pending" : "Approved";
  return "Requested";
};

/**
 * One line for a request dialog when the raiser's level changes where the record lands, else
 * null (the ordinary path needs no explanation). Never shown in the auto band.
 */
export const raiserLandingNote = (
  amount: string | number | null | undefined,
  l2Above: number = TIER_L2_ABOVE,
  level: RaiserLevel | null = null
): string | null => {
  if (!level || requiredTier(amount, l2Above) === APPROVAL_TIERS.auto) return null;
  const status = initialStatusForRaiser(amount, l2Above, level);
  if (status === "Approved") {
    return level === RAISER_LEVELS.ceo
      ? "You hold the CEO approval, so this is approved as soon as you request it."
      : "You hold L1 approval, so this is approved as soon as you request it.";
  }
  return "You hold L1 approval, so this skips L1 and goes straight to the CEO.";
};
