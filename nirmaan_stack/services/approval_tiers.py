# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which approvals an amount needs, across all three money-out ledgers.

PURE MODULE -- no `frappe`, no database, no request context. Callable from a plain unittest
with no bench, no site and no fixtures. That is the point: this is the rule that decides
whether money needs one signature, two, or none, and it must be verifiable without standing
up an application.

THE RULE (owner note, 11/09/2026)
---------------------------------
    amount < 15,000          -> DIRECT APPROVE. Created already `Approved`; no human sees it.
    15,000 <= amount <= 50,000 -> L1 ONLY. Admin / Accountant Lead signs and that FINISHES it.
    amount > 50,000          -> L1, THEN L2 (CEO). Both are required.
    amount <= 0              -> the full path regardless of size (see the refund rule below).

⚠️ THE EDGES ARE THE RULE, NOT A DETAIL. The note reads "Below 15000", "15000 to 50000",
"Above 50000", so exactly Rs 15,000 needs L1 and exactly Rs 50,000 stops at L1. Written as
`<` and `<=` below, deliberately.

⚠️ THIS REVERSES THE EXPENSE RULE OF 2026-09-04, WHICH WAS `<= 10000` (INCLUSIVE). That ruling
made exactly Rs 10,000 auto-approve. The new lower edge is EXCLUSIVE at a different number, so
the old ruling is superseded rather than contradicted -- but anything written against "exactly
the limit auto-approves" is stale, including the note still standing in
`frontend/src/utils/expenseApproval.ts` until that module is retired.

⚠️ A REFUND / CREDIT (amount <= 0) ALWAYS TAKES THE FULL PATH. It is "less than 15,000" on a
plain reading of the number, and auto-approving it would let money move back with no review.
The lower bound is therefore `0 < amount`, not `amount < 15000` alone -- this preserves the
existing behaviour on both payments (`0 < amount < PAYMENT_AUTO_APPROVAL_THRESHOLD`) and
expenses (`0 < flt(self.amount) <= AUTO_APPROVE_LIMIT`), which both already guarded it.

WHAT THIS REPLACES
------------------
Three thresholds that are about to disagree with each other:

    api/payments/project_payments.py      PAYMENT_AUTO_APPROVAL_THRESHOLD = 10001.0
    doctype/project_expenses.py           AUTO_APPROVE_LIMIT = 10000
    doctype/non_project_expenses.py       AUTO_APPROVE_LIMIT = 10000

They are NOT deleted by this module landing -- Phase 1 adds the rule and wires nothing. The
call sites move over in Phases 4 and 5, and the constants go with them.

⚠️ `PO_REVISION_AUTO_APPROVAL_THRESHOLD = 5000` (api/po_revisions/revision_logic.py) is a
DIFFERENT THING -- the size of a PO amendment, not a payment -- and is deliberately untouched.

⚠️ AMOUNT MUST BE NUMERIC BEFORE IT REACHES HERE, AND ONE CALLER CANNOT ASSUME THAT.
`Project Expenses.amount` is a `Data` field -- Postgres `character varying` -- while the other
two ledgers store `Currency`/numeric. A raw string compare puts "9000" above "50000", so a
project expense would be routed to the CEO on the strength of its first character. `_as_number`
below coerces defensively; the call site must still not pass a raw string it never looked at.

The frontend mirror is `frontend/src/utils/approvalTiers.ts`, pinned to this file by
`test_approval_tiers.py` + `approvalTiers.test.ts`. THIS FILE IS THE AUTHORITY.
"""

from __future__ import annotations

# ── The two thresholds ──────────────────────────────────────────────────────────────────
# Strictly BELOW this needs no human at all.
TIER_AUTO_APPROVE_BELOW = 15000.0
# Strictly ABOVE this needs the CEO on top of L1.
#
# ⚠️ ALL THREE LEDGERS NOW SHARE BOTH LINES (owner, 16 Sep 2026): auto below
# 15,000, L1 only from 15,000 to 50,000, CEO above 50,000.
#
#     Project Payments       < 15,000 auto | 15,000-50,000 L1 only | > 50,000 CEO
#     Project / Non-Project  < 15,000 auto | 15,000-50,000 L1 only | > 50,000 CEO
#       Expenses
#
# ⚠️ THIS REVERSES THE PER-LEDGER SPLIT OF 15 Sep 2026, which put the expense CEO
# line at 30,000 while payments sat at 50,000. An expense between 30,000 and
# 50,000 used to need the CEO and now FINISHES AT L1 -- so anything written
# against "expenses go to the CEO above 30,000" is stale, wherever it stands.
TIER_L2_ABOVE = 50000.0
# The expense ledgers' CEO line. Deliberately KEPT as its own name even though it
# now equals the payments line: the owner has already moved this number once, and
# a named seam makes the next divergence a one-line change instead of a hunt
# through every expense call site. Every expense caller still passes it EXPLICITLY.
TIER_L2_ABOVE_EXPENSES = 50000.0

# ── The three answers ───────────────────────────────────────────────────────────────────
TIER_AUTO = "auto"
TIER_L1 = "l1"
TIER_L1_L2 = "l1_l2"

# ── The statuses this module can name ───────────────────────────────────────────────────
# Kept as plain strings rather than imported, so the module stays free of every other import.
STATUS_REQUESTED = "Requested"
STATUS_CEO_PENDING = "CEO Pending"
STATUS_APPROVED = "Approved"


def _as_number(amount) -> float:
    """Coerce to float, treating anything unreadable as 0.

    0 fails the `0 < amount` guard, so an unparseable amount takes the FULL approval path.
    That is the safe direction: the failure mode of guessing wrong here is an extra
    signature, never an unreviewed payment.
    """
    if amount is None:
        return 0.0
    try:
        return float(amount)
    except (TypeError, ValueError):
        return 0.0


def required_tier(amount, l2_above: float = TIER_L2_ABOVE) -> str:
    """`TIER_AUTO` | `TIER_L1` | `TIER_L1_L2` for this amount.

    `l2_above` is the CEO line, which differs per ledger -- see the constants.
    """
    value = _as_number(amount)
    if value <= 0:
        # ⚠️ THE SIGN DOES ONE THING ONLY: IT BLOCKS AUTO-APPROVAL (owner, 2026-09-15).
        #
        # That is exactly what it did before this module existed -- both ledgers guarded
        # auto-approval with `0 < amount`, and the sign had no other effect. Beyond that
        # a refund is banded BY ITS SIZE, like any other amount: a small one takes L1, a
        # large one takes both gates.
        #
        # ⚠️ An earlier revision of this file forced EVERY non-positive amount to L1+L2 on
        # the argument that it preserved payment behaviour (today every non-auto payment
        # reaches the CEO, because the lead gate always forwards). The owner reversed it:
        # that reasoning generalised one ledger's routing into a rule about sign, and it
        # would have sent a Rs 500 refund to the CEO.
        #
        # An unreadable amount lands here too (`_as_number` returns 0.0) and takes L1 --
        # not auto, which is the property that matters.
        return TIER_L1_L2 if value < -l2_above else TIER_L1
    if value < TIER_AUTO_APPROVE_BELOW:
        return TIER_AUTO
    if value <= l2_above:
        return TIER_L1
    return TIER_L1_L2


def initial_status(amount, l2_above: float = TIER_L2_ABOVE) -> str:
    """The status a NEW record is created at.

    `Approved` only for the auto band; everything else starts at `Requested` and waits.
    """
    return STATUS_APPROVED if required_tier(amount, l2_above) == TIER_AUTO else STATUS_REQUESTED


def status_after_l1(amount, l2_above: float = TIER_L2_ABOVE) -> str:
    """Where an L1 approval LANDS a record.

    ⚠️ THIS IS THE ONE THAT CHANGES BEHAVIOUR FOR PAYMENTS. Today every payment above the
    auto line goes `Requested -> CEO Pending -> Approved`, so L1 always forwards. Under this
    rule an L1 signature on a 15k-50k payment FINISHES the approval, and roughly 912 payments
    a year (Rs 2.65 Cr, measured) stop reaching the CEO.

    ⚠️ The bulk approve endpoint currently holds ONE target status for a whole batch
    (`_ModeConfig.approve_target_status`). It has to become per-row against this function,
    and the SR-tax-withholding gate that compares against that same constant has to move with
    it -- or a bulk-approved 15k-50k payment lands at `Approved` with no deduction, no error,
    and nothing on screen looking wrong.
    """
    return STATUS_CEO_PENDING if required_tier(amount, l2_above) == TIER_L1_L2 else STATUS_APPROVED


def is_auto_approved(amount) -> bool:
    """Whether this amount skips approval entirely. Sets `auto_approved` at the call site.

    Takes no `l2_above`: the AUTO line is 15,000 on every ledger, and the CEO line
    cannot change whether something auto-approves.
    """
    return required_tier(amount) == TIER_AUTO


def needs_ceo(amount, l2_above: float = TIER_L2_ABOVE) -> bool:
    """Whether L2 is required on top of L1."""
    return required_tier(amount, l2_above) == TIER_L1_L2
