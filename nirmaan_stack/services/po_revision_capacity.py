"""Can a PO absorb a decrease? — the pure decision behind the D1 revision gate.

WHY THIS EXISTS

When an approved revision REDUCES a PO's value, `_auto_absorb_created_terms` shrinks the
PO's unpaid payment terms to soak up the reduction. It can only touch terms in
`term_status == "Created"`. A term in `Requested` / `CEO Pending` / `Approved` is UNPAID but
untouchable — there is a live payment request riding on it.

Nothing checked whether that capacity existed. So a decrease that landed on a mid-approval
term was absorbed by NOTHING, and the leftover was written into the PO's adjustment ledger
as a negative `remaining_impact` — which reads as "we overpaid this vendor" and HARD-LOCKS
the PO's payments.

That is how PO/246/00103/26-27 came to claim ₹4,130 of overpaid credit on a PO where
`amount_paid` was ₹0:

    15-Jul 16:48  PO created. ONE payment term, 100%, ₹24,780
    15-Jul 20:01  that term goes to CEO Pending (payment request in approval)
    16-Jul 15:15  revision cuts qty 6 -> 5. diff = -4,130
                  the only term is CEO Pending, so the reducible set is EMPTY
                  -> absorbed ₹0, adjustment records -4,130, PO locked

The term's percentage was rewritten 100 -> 120 (= 24,780 / 20,650) and left there, which is
the fingerprint: the term kept the old PO's value while the PO shrank underneath it.

THE RULE — and note what it deliberately does NOT do

Blocked ONLY when the shortfall is CAUSED by a mid-approval term. A shortfall with no
mid-approval term means the money genuinely went out and the PO really is overpaid; that is
the legitimate path this whole system was built for and it must stay untouched. Getting this
backwards would block real overpayment handling, which is a worse bug than the one being
fixed.

Pure by construction (ADR-0010 B1): no `frappe.db`, no request context, no imports from
`api/`. The caller loads the terms and voices the refusal; this module only decides.
"""

from dataclasses import dataclass
from typing import Any, Iterable, Sequence

# The ONLY status `_auto_absorb_created_terms` is able to reduce. Shared with it so the gate
# and the executor can never disagree about what "capacity" means — if this widens, both the
# check and the absorption widen together, which is the point of it being one name.
REDUCIBLE_TERM_STATUSES = frozenset({"Created"})

# Unpaid, but carrying a live payment request. Ordered, not a set, so a refusal message lists
# them the same way every time.
MID_APPROVAL_TERM_STATUSES = ("Requested", "CEO Pending", "Approved")

# Matches the tolerance used throughout the revision/adjustment code.
TOLERANCE = 0.01


@dataclass(frozen=True)
class BlockingTerm:
    """A term that is holding value the decrease needed, and cannot be touched."""

    label: str
    amount: float
    term_status: str
    project_payment: str | None


@dataclass(frozen=True)
class DecreaseAssessment:
    decrease: float
    capacity: float
    shortfall: float
    blocking_terms: tuple[BlockingTerm, ...]

    @property
    def is_blocked(self) -> bool:
        return bool(self.blocking_terms)


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _get(term: Any, key: str) -> Any:
    """Terms arrive as Frappe child docs OR plain dicts; read both without caring."""
    if isinstance(term, dict):
        return term.get(key)
    return getattr(term, key, None)


def _status(term: Any) -> str:
    return (_get(term, "term_status") or "").strip()


def assess_decrease(terms: Iterable[Any], decrease: float) -> DecreaseAssessment:
    """Decide whether a PO can absorb `decrease` (a POSITIVE magnitude).

    Returns an assessment whose `is_blocked` is True ONLY when the PO cannot absorb the
    decrease AND the reason is one or more mid-approval terms.
    """
    decrease = abs(_num(decrease))
    term_list: Sequence[Any] = list(terms or [])

    capacity = sum(
        _num(_get(t, "amount"))
        for t in term_list
        if _status(t) in REDUCIBLE_TERM_STATUSES
    )
    shortfall = decrease - capacity

    if decrease <= TOLERANCE or shortfall <= TOLERANCE:
        return DecreaseAssessment(decrease, capacity, max(0.0, shortfall), ())

    blocking = tuple(
        BlockingTerm(
            label=_get(t, "label") or "",
            amount=_num(_get(t, "amount")),
            term_status=_status(t),
            project_payment=_get(t, "project_payment") or None,
        )
        for t in term_list
        if _status(t) in MID_APPROVAL_TERM_STATUSES
    )

    # No mid-approval term => the shortfall is a REAL overpayment. Not this gate's business.
    return DecreaseAssessment(decrease, capacity, shortfall, blocking)
