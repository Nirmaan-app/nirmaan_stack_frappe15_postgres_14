# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What counts as money that has LEFT THE BANK, across all three money-out ledgers.

PURE MODULE -- no `frappe`, no database, no request context.

WHY THIS EXISTS
---------------
`status == "Paid"` has been the definition of settled spend in roughly THIRTY-SIX places:
`services/finance.get_total_paid`, `amount_paid` on Procurement Orders and Service Requests,
`services/payment_tds` (whose `total_tds` mirrors `amount_paid` by design), the CEO-hold
cashflow gap and its frontend mirror, the 30-day payment dashboard, both outflow reports,
project aggregates, the vendor ledger, sidebar counts, the outflow-import ledgers -- plus SIX
Desk Query Reports whose SQL is stored in the DATABASE, where no code grep can find them.

The owner ruled on 2026-09-15 that `Paid` now means **RECONCILED**, and inserted a new status
BEFORE it:

    Requested -> CEO Pending -> Approved -> Reconciliation Pending -> Paid

So money leaves the bank at `Approved -> Reconciliation Pending`, and a record sits in that
new status for as long as reconciliation takes. **Every one of those ~36 sites must count BOTH
statuses, or the system under-reports money it has already spent -- silently, with nothing on
screen looking wrong.**

THE DEVICE
----------
One constant, bound everywhere. From the day the call sites move over, **a literal `"Paid"` in
a money filter is a defect**, and a grep for it is the standing review check.

⚠️ THE TRIGGERS ARE THE OTHER HALF, AND THEY ARE EASY TO FORGET. Adding the new status to the
SUMS while leaving the doc-event triggers watching for `Paid` means `Procurement Orders.amount_paid`
and the CEO-hold gap stop updating at fulfilment and wait for reconciliation -- days later, or
never. Every spot check still looks right. `is_settlement_transition` exists so a trigger can ask
the question the same way a sum does.

WHAT IS *NOT* SETTLED, AND WHY IT MATTERS
-----------------------------------------
`services/finance.get_total_pending` lists `Requested / CEO Pending / Approved / Rejected`.
**`Reconciliation Pending` must NOT be added to it** -- that money is SPENT, not pending, and
counting it in both places double-counts it against `get_total_paid`. `is_pending` below is the
positive statement of that, so the two sets can be seen not to overlap.

WHY THIS IS SAFE TO SHIP BEFORE THE STATUS EXISTS
-------------------------------------------------
At go-live ZERO rows are in `Reconciliation Pending` -- all 10,840 settled rows stay `Paid`, and
there is **no migration of status values at all**. So every rollup must return a figure IDENTICAL
to today, to the rupee, the moment the call sites bind this constant. Any difference is a bug in
the edit, not a consequence of the design. That is what makes the ~36-site audit provable rather
than hoped for.

The frontend mirror is `frontend/src/utils/settlement.ts`. THIS FILE IS THE AUTHORITY.
"""

from __future__ import annotations

from typing import Iterable, Optional

# ── The status values ───────────────────────────────────────────────────────────────────
STATUS_REQUESTED = "Requested"
STATUS_CEO_PENDING = "CEO Pending"
STATUS_APPROVED = "Approved"
#: Money has LEFT the bank; the bank statement has not confirmed it yet.
STATUS_RECONCILIATION_PENDING = "Reconciliation Pending"
#: Terminal. Money left the bank AND the statement confirmed it.
STATUS_PAID = "Paid"
STATUS_REJECTED = "Rejected"

#: ⭐ THE CONSTANT. Money that has left the bank. Bind this; never write a literal.
SETTLED_STATUSES = (STATUS_RECONCILIATION_PENDING, STATUS_PAID)

#: Sanctioned, but the money has NOT moved. Deliberately disjoint from SETTLED_STATUSES --
#: mirrors `finance.get_total_pending`, which must never gain the reconciliation status.
PENDING_STATUSES = (STATUS_REQUESTED, STATUS_CEO_PENDING, STATUS_APPROVED, STATUS_REJECTED)

#: The lifecycle in order, for display and for ordering a status column.
STATUS_SEQUENCE = (
    STATUS_REQUESTED,
    STATUS_CEO_PENDING,
    STATUS_APPROVED,
    STATUS_RECONCILIATION_PENDING,
    STATUS_PAID,
)

#: Owner's vocabulary, 11/09/2026. One label per status, composed nowhere else.
STATUS_LABELS = {
    STATUS_REQUESTED: "Payment Pending Approval",
    STATUS_CEO_PENDING: "Payment Pending CEO Approval",
    STATUS_APPROVED: "Payment need to paid",
    STATUS_RECONCILIATION_PENDING: "Payment Done / Reconciliation Pending",
    STATUS_PAID: "Payment Done / Reconciliation Done",
    STATUS_REJECTED: "Rejected",
}


def _clean(status: Optional[str]) -> str:
    """Trim and tolerate None. Status is a `Data` field on Project Payments -- free text."""
    return (status or "").strip()


def is_settled(status: Optional[str]) -> bool:
    """Has the money left the bank?

    TRUE for both `Reconciliation Pending` and `Paid`. This is the question every financial
    rollup is actually asking, and the one that `== "Paid"` used to answer correctly and no
    longer does.
    """
    return _clean(status) in SETTLED_STATUSES


def is_pending(status: Optional[str]) -> bool:
    """Sanctioned or in flight, but the money has NOT moved."""
    return _clean(status) in PENDING_STATUSES


def is_settlement_transition(old_status: Optional[str], new_status: Optional[str]) -> bool:
    """Did this save move the record ACROSS the money-out boundary, in either direction?

    ⚠️ USE THIS IN DOC-EVENT HOOKS, NOT an equality test against a status. The hooks that
    recompute `amount_paid` and re-evaluate the CEO-hold gap currently fire on entering or
    leaving `Paid`; under the new lifecycle the money-out event is `Approved ->
    Reconciliation Pending`, and `Reconciliation Pending -> Paid` moves no money at all and
    must NOT re-trigger them.

    Both directions matter: a settled row moving back (to `Rejected`, say) has to LOWER the
    parent's paid total, which is why this is not simply "did it become settled".
    """
    return is_settled(old_status) != is_settled(new_status)


def settled_filter(fieldname: str = "status") -> list:
    """A Frappe list filter for settled rows: `["status", "in", (...)]`.

    Convenience so a call site cannot typo the operator or half-apply the set.
    """
    return [fieldname, "in", list(SETTLED_STATUSES)]


def status_label(status: Optional[str]) -> str:
    """The owner's display label. Unknown values pass through unchanged rather than blanking."""
    cleaned = _clean(status)
    return STATUS_LABELS.get(cleaned, cleaned)


def any_settled(statuses: Iterable[Optional[str]]) -> bool:
    """Whether any status in the iterable is settled."""
    return any(is_settled(s) for s in statuses)
