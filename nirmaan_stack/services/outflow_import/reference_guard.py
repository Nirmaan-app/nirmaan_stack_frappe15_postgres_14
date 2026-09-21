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

⚠️ ONE CHEQUE, SEVERAL PAYMENTS -- THE SECOND, AND ONLY OTHER, SIBLING SET (owner, 2026-09-19). A cheque
may cover several payments, and it clears as ONE bank line, so every payment written on it carries the
same reference -- the cheque number, or the clearing line's UTR. `cheque_siblings_of` excuses exactly the
other payments whose `cheque_no` is this payment's, and only when this payment is itself a cheque. It is
computed HERE, from the target, rather than passed in by a caller, so the import and the manual fulfil
cannot disagree about it. Scoped as tightly as the transfer set: a payment holding the reference that is
not on the same cheque still blocks, and an online payment has no cheque siblings at all.

⚠️ THE EXACT COMPARISON IS ON THE STORED VALUE AS-IS, unchanged from before -- this is not the normalised
matcher key. (Since #1259 a CONTAINMENT check runs beside it and does normalise both sides, so a padded
stored UTR now blocks through that path -- see the next paragraph. That widening is the owner's #1252
ruling "refusing a reference already on another payment also refuses when a stored `utr` contains the
typed reference (same eligibility rules)", which supersedes the paragraph below for containment.) 226 stored values are whitespace-padded and so already invisible to it; widening the
comparison here would change a guard the owner chose to leave alone, in the same edit as relaxing
it, and the two effects would be impossible to tell apart afterwards.

⚠️ A HOLDER IS ALSO A PAYMENT WHOSE STORED `utr` CONTAINS THE REFERENCE (#1259). An ICICI settle stores
the whole bank narration, so the reference a person types (`600219693408`) sits INSIDE another
payment's `utr` and an exact compare alone cannot see it. Containment uses the ICICI contains-guard's
token rules (`contains_guard.reference_is_inside`: an eligible token is 6+ characters with a digit,
not a `BULD` batch id, from a reference not starting `DUMMY-`), so a short or junk reference refuses
nothing new. The exact compare above stays as it was; containment is added beside it, and the SQL is
only a pre-filter -- every contained holder is confirmed by the pure predicate.

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

from nirmaan_stack.services.cheque_payments import MODE_CHEQUE
from nirmaan_stack.services.outflow_import.contains_guard import (
    reference_is_inside,
    reference_tokens,
)

__all__ = ["reference_is_blocked", "sibling_payments_of", "cheque_siblings_of", "assert_reference_is_free"]

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


def cheque_siblings_of(target_name: str) -> set:
    """The other payments written on the same cheque as this one. Empty unless it is a cheque.

    See the module docstring: one cheque clears as one bank line, so these legitimately share its
    reference. Keyed on the cheque number as stored (the doctype trims it on save).
    """
    row = frappe.db.get_value(PAYMENT_DOCTYPE, target_name, ["mode_of_payment", "cheque_no"], as_dict=True)
    if not row or (row.mode_of_payment or "").strip() != MODE_CHEQUE or not (row.cheque_no or "").strip():
        return set()
    rows = frappe.db.get_all(
        PAYMENT_DOCTYPE,
        filters={"mode_of_payment": MODE_CHEQUE, "cheque_no": row.cheque_no.strip(), "name": ["!=", target_name]},
        pluck="name",
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


def _holders_of(reference: str) -> list:
    """Every payment holding this reference: its `utr` EQUALS it as stored, or CONTAINS it (#1259).

    Sorted by name, so the verdict and the message never depend on physical row order.
    """
    exact = frappe.db.get_all(PAYMENT_DOCTYPE, filters={"utr": reference}, pluck="name")
    tokens = sorted(reference_tokens(reference))
    contained = []
    if tokens:
        # A pre-filter: `strpos` on the normalised `utr`, one explicit placeholder per token, and
        # `reference_is_inside` confirms every row it returns. ⚠️ KNOWN LIMIT, the same one
        # `candidates.load_recorded_by_contains` records: PostgreSQL's `\s` misses non-ASCII whitespace
        # Python strips, so a stored `utr` split by a non-breaking space inside the token is not found.
        clauses = " OR ".join(["strpos(upper(regexp_replace(utr, '\\s', '', 'g')), %s) > 0"] * len(tokens))
        rows = frappe.db.sql(
            f"""SELECT name, utr FROM "tab{PAYMENT_DOCTYPE}"
                WHERE utr IS NOT NULL AND btrim(utr) <> '' AND ({clauses})""",
            tokens,
            as_dict=True,
        )
        contained = [r["name"] for r in rows if reference_is_inside(reference, r["utr"])]
    return sorted(set(exact) | set(contained))


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
    existing = _holders_of(reference)
    siblings = sibling_payments_of(reference, transfer_id) | cheque_siblings_of(target_name)
    if not reference_is_blocked(existing=existing, target_name=target_name, siblings=siblings):
        return
    blocking = _blocking_payment(existing, target_name, siblings)
    message = f"Bank reference {reference} is already recorded on payment {blocking}."
    if tail:
        message = f"{message} {tail}"
    if error_class:
        frappe.throw(message, error_class, title="Reference already used")
    frappe.throw(message, title="Reference already used")
