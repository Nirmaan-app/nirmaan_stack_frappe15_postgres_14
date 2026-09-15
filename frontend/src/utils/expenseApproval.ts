// src/utils/expenseApproval.ts
//
// ⚠️ THIS MODULE NO LONGER OWNS A RULE. IT OWNS COPY.
//
// It used to hold its own threshold — `EXPENSE_AUTO_APPROVE_LIMIT = 10000`, inclusive —
// mirroring an `AUTO_APPROVE_LIMIT` that lived in both expense doctype controllers. Those
// controllers have since moved onto the centralized `services/approval_tiers.py`, whose
// auto line is **15,000 EXCLUSIVE**, and this file did not move with them.
//
// THAT DRIFT WAS LIVE AND USER-VISIBLE. For any amount from ₹10,001 to ₹14,999 the backend
// auto-approved the expense while this module told the button to say "Send for Approval".
// The expense was already Approved before the user finished reading the label. Nothing
// errored, nothing looked broken — the button simply described a path the record did not
// take. That is the failure mode a duplicated threshold always has, and it is why the
// number is gone from this file rather than corrected in it.
//
// The rule now comes from ONE place: `approvalTiers.ts`, itself a mirror of the Python
// module and pinned to it by `approvalTiers.test.ts` reading the Python source. What stays
// here is what the user READS — button labels and toast text — which is genuinely local and
// has no business in a file that mirrors a backend predicate.
//
// ⚠️ SO: NEVER REINTRODUCE A NUMBER HERE. Import the predicate. If a label needs to name
// the threshold, name `TIER_AUTO_APPROVE_BELOW` — do not retype its value.
//
// TWO EDGES THE COPY MUST HONOUR, both changed by the move:
//   - The lower edge is now EXCLUSIVE. Exactly ₹15,000 needs L1, so the toast says
//     "below ₹15,000" and must NEVER say "₹15,000 or less" — that was true of the OLD
//     inclusive ₹10,000 rule and is false of this one.
//   - A REFUND (negative amount, which Non-Project Expenses explicitly supports) is still
//     NOT auto-approved, despite being "less than 15,000". The sign blocks auto-approval
//     and nothing else; `requiredTier` bands it by size from there.

import { formatToRoundedIndianRupee } from "./FormatPrice";
import { TIER_AUTO_APPROVE_BELOW, isAutoApproved } from "./approvalTiers";

/** Button copy for the two paths a newly created expense can take. */
export const EXPENSE_SUBMIT_LABELS = {
  /** Auto-approved on save -- no approver involved. */
  autoApproved: "Raise Expense",
  /** Enters the workflow at `Requested` and waits for an approver. */
  needsApproval: "Send for Approval",
} as const;

/**
 * Whether an amount will be auto-approved at create time.
 *
 * A THIN DELEGATION, deliberately — kept as a named export only so the two create dialogs
 * and this file's copy read in expense language. It adds NOTHING to `isAutoApproved`; the
 * moment it does, the drift this module was rewritten to end starts again.
 *
 * Blank / non-numeric input parses to 0, which fails the `> 0` guard and therefore reports
 * "needs approval" — the safe default while the user is still typing.
 */
export const isAutoApprovedExpenseAmount = (
  amount: string | number | undefined | null
): boolean => isAutoApproved(amount);

/**
 * The create-dialog submit-button label for the given amount.
 * Used by `NewProjectExpenseDialog` and `NewNonProjectExpense`.
 *
 * Deliberately BINARY, though the underlying rule has three tiers. The label answers "what
 * does THIS CLICK do" — save it, or send it — and both L1 and L1+L2 send it. Which
 * approvals it then needs is the approver's business, and it is what the Tier column on the
 * approval queue is for.
 */
export const getExpenseSubmitLabel = (
  amount: string | number | undefined | null
): string =>
  isAutoApprovedExpenseAmount(amount)
    ? EXPENSE_SUBMIT_LABELS.autoApproved
    : EXPENSE_SUBMIT_LABELS.needsApproval;

/** Toast copy for the two paths a newly created expense can have taken. */
export const EXPENSE_CREATED_TOASTS = {
  autoApproved: {
    title: "Auto-approved",
    // "below", not "or less" — see the edges note in the module header.
    description: `Recorded and approved — expenses below ${formatToRoundedIndianRupee(
      TIER_AUTO_APPROVE_BELOW
    )} skip the approval step.`,
  },
  needsApproval: {
    title: "Sent for approval",
    description: "Recorded at Requested — an approver has to approve it before it can be marked Paid.",
  },
} as const;

/**
 * The create toast, naming the path the expense ACTUALLY took.
 *
 * Prefers the `status` on the doc the server just returned, because the server IS the rule.
 * This is the reason the ₹10,001–₹14,999 drift never reached the TOAST even while it was
 * reaching the button: a toast that merely re-ran the client predicate would have kept
 * claiming "sent for approval" about records the server had already approved. Keep this
 * preference — the amount is only the fallback for when the create call returns no status.
 */
export const getExpenseCreatedToast = (
  createdStatus: string | null | undefined,
  amount: string | number | null | undefined
): { title: string; description: string } => {
  const autoApproved = createdStatus
    ? createdStatus === "Approved"
    : isAutoApprovedExpenseAmount(amount);
  return autoApproved
    ? EXPENSE_CREATED_TOASTS.autoApproved
    : EXPENSE_CREATED_TOASTS.needsApproval;
};
