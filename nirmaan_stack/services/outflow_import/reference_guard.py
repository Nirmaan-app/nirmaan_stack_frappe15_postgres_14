# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Is this bank reference free to write onto this payment? (ADR-0020 D2)

ONE DEFINITION, TWO CALL SITES -- `settle._assert_reference_is_free` (the import) and
`api/payments/project_payments._fulfil_payment` (the manual fulfil). ⚠️ THEY MUST MOVE TOGETHER,
and the failure of missing one is asymmetric: an accountant fulfilling a payment by hand would be
refused on a UTR the import wrote thirty seconds earlier -- and the message would tell them to do
it by hand, which is what they were doing.

⚠️ `Project Payments.utr` KEEPS THE RAW BANK REFERENCE ON EVERY LEG. A decorated string --
"<utr> (part 1/6)" -- would make each value unique and remove the need for this guard entirely, and
it was rejected: `candidates._payments_by_reference` compares `upper(btrim(utr))` and the re-import
duplicate check compares the raw string, so a decorated UTR is INVISIBLE to both. Repeating the raw
reference is also what accountants already do by hand -- 39 groups covering 92 payments on the live
ledger, measured 2026-09-09.

⚠️ THE SIBLING SET IS SCOPED TO ONE `transfer_id`, and that scope is the whole safety of the
relaxation. Without it, any payment already carrying the reference would excuse any other, and the
guard would be switched off rather than narrowed.

⚠️ THE COMPARISON IS ON THE STORED VALUE AS-IS, unchanged from before -- this is not the normalised
matcher key. 226 stored values are whitespace-padded and so already invisible to it; widening the
comparison here would change a guard the owner chose to leave alone, in the same edit as relaxing
it, and the two effects would be impossible to tell apart afterwards.

⚠️ EVERY HOLDER OF THE REFERENCE MUST BE ACCOUNTED FOR, NOT JUST ONE (fixed at review, Task 4).
`frappe.db.get_value(..., "name")` with no `ORDER BY` returns ONE ARBITRARY row when several
payments already carry this reference. Before the relaxation that was harmless: any holder other
than `target_name` blocked, so every possible answer agreed. Once a sibling can excuse a holder, the
arbitrary pick starts DECIDING the verdict -- land on a sibling and the call is allowed even though
a genuine third-party collision on the same raw UTR sits unexamined in the same table; land on the
non-sibling and it is refused even though every OTHER holder is a sibling. Same data, two verdicts,
by physical row order. This is the class root `CLAUDE.md` names under "a guard must order by a
total key" -- and it is reachable today: 39 groups / 92 payments already share a bank-shaped UTR by
hand on the live ledger. The fix is to read every holder and require ALL of them to be excusable
(`target_name` itself, or a sibling) before allowing the write.
"""

import frappe

__all__ = ["reference_is_blocked", "sibling_payments_of", "assert_reference_is_free"]

PAYMENT_DOCTYPE = "Project Payments"
MATCH_DOCTYPE = "Outflow Row Match"


def reference_is_blocked(*, existing, target_name: str, siblings) -> bool:
    """PURE. `existing` is EVERY payment currently holding this reference (a set/iterable of
    names, possibly empty, possibly including `target_name` itself).

    Blocked iff at least one OTHER holder is not excusable as a sibling settled from this same
    transfer. A single arbitrary holder is not enough -- see the module docstring.
    """
    others = set(existing or ()) - {target_name}
    if not others:
        return False
    return not others.issubset(set(siblings or ()))


def sibling_payments_of(reference: str, transfer_id: str | None) -> set:
    """Payments this transfer has already settled. Empty when there is no transfer context.

    Reversed legs are excluded: a reversed payment no longer carries this transfer's money, so it
    is not a sibling and must not excuse a collision.
    """
    if not transfer_id:
        return set()
    rows = frappe.db.get_all(
        MATCH_DOCTYPE,
        filters={
            "transfer_id": transfer_id,
            "target_doctype": PAYMENT_DOCTYPE,
            "match_kind": "Settled",
        },
        pluck="target_name",
    )
    return set(rows)


def _blocking_payment(existing, target_name: str, siblings) -> str | None:
    """The holder that actually explains the refusal, for a legible message.

    Deterministic (sorted) rather than "whichever the DB handed back" -- the same failure class
    this whole fix exists to close, kept out of the message too.
    """
    others = sorted(set(existing or ()) - {target_name})
    non_sibling = [name for name in others if name not in set(siblings or ())]
    if non_sibling:
        return non_sibling[0]
    return others[0] if others else None


def assert_reference_is_free(
    reference: str,
    target_name: str,
    *,
    transfer_id: str | None = None,
    error_class=None,
    tail: str | None = None,
) -> None:
    """Throw unless this reference may be written onto this payment.

    `transfer_id=None` reproduces the pre-ADR-0020 strict rule exactly, which is what the manual
    fulfil passes: it has no transfer to check against.

    `tail` -- a caller-supplied closing sentence, appended after the neutral "already recorded on
    payment Y." (fixed at review, Task 4). An accountant fulfilling by hand has no transfer in
    front of them, so a message naming one is not guidance, it is noise; the import DOES have a
    transfer, so it says so. Each call site owns its own tail rather than one sentence trying to
    serve both audiences.
    """
    existing = frappe.db.get_all(PAYMENT_DOCTYPE, filters={"utr": reference}, pluck="name")
    siblings = sibling_payments_of(reference, transfer_id)
    if not reference_is_blocked(existing=existing, target_name=target_name, siblings=siblings):
        return
    blocking = _blocking_payment(existing, target_name, siblings)
    message = f"Bank reference {reference} is already recorded on payment {blocking}."
    if tail:
        message = f"{message} {tail}"
    if error_class:
        frappe.throw(message, error_class, title="Reference already used")
    frappe.throw(message, title="Reference already used")
