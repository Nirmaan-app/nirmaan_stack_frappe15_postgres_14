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
"""

import frappe

__all__ = ["reference_is_blocked", "sibling_payments_of", "assert_reference_is_free"]

PAYMENT_DOCTYPE = "Project Payments"
MATCH_DOCTYPE = "Outflow Row Match"


def reference_is_blocked(*, existing: str | None, target_name: str, siblings) -> bool:
    """PURE. `existing` is the payment already holding the reference, or None."""
    if not existing or existing == target_name:
        return False
    return existing not in set(siblings or ())


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


def assert_reference_is_free(
    reference: str, target_name: str, *, transfer_id: str | None = None, error_class=None
) -> None:
    """Throw unless this reference may be written onto this payment.

    `transfer_id=None` reproduces the pre-ADR-0020 strict rule exactly, which is what the manual
    fulfil passes: it has no transfer to check against.
    """
    existing = frappe.db.get_value(PAYMENT_DOCTYPE, {"utr": reference}, "name")
    siblings = sibling_payments_of(reference, transfer_id)
    if not reference_is_blocked(existing=existing, target_name=target_name, siblings=siblings):
        return
    message = (
        f"Bank reference {reference} is already recorded on payment {existing}, which was not "
        f"settled from this transfer."
    )
    if error_class:
        frappe.throw(message, error_class, title="Reference already used")
    frappe.throw(message, title="Reference already used")
