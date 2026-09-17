# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The four rules that protect an expense settled by bank lines (ADR-0027 Q11/Q22, #1302).

ONE controller for BOTH expense doctypes. `Project Expenses` and `Non Project Expenses` differ in
their links (a project, a vendor, `payment_by`) and in nothing this module reads -- amount, status
and `payment_date` are spelled identically on both -- so a twin file would be two copies of one
rule, which is how one gets tightened and the other does not (ADR-0010 F3/B1). `hooks.py` points
both doctypes at these two functions.

THE RULES, in the order `validate` applies them:

  1. The amount may not drop below the linked total (₹5 leeway).
  2. Paid may not be set BY HAND while the linked total is short.
  3. `on_trash`: delete is refused while live slips exist.
  4. Every save re-derives Paid ⇄ Reconciliation Pending and the payment date from the links.

⚠️ EVERY RULE IS INERT UNTIL THE EXPENSE HAS LIVE `Settled` SLIPS, and that gate is the safety of
the whole change. An expense no bank line has touched -- nearly all of them -- behaves exactly as it
did before this feature existed, because `line_count == 0` returns before anything is read or
written. It is also what lets `unreconcile._revert_expense` put an expense back to Reconciliation
Pending after reversing its only slip: by then there are no live slips, so rule 4 does not fire and
overwrite the revert.

⚠️ WHY THE DOCUMENT LAYER AND NOT THE ENDPOINTS (Q22b). Mark Reconciled on the Payments tab, the old
expense pages' Mark as Paid / Edit / Delete, Desk, Data Import and the import's own settle and
unreconcile all reach an expense through `doc.save()` / `frappe.delete_doc()`. A guard in the import's
endpoints would leave every other door open. The price is that this runs one indexed aggregate on
every expense save; the `is_new()` short-circuit keeps it off inserts, which can have no slips.

⚠️ NO BYPASS FLAG FOR THE IMPORT (ADR-0027, Consequences). The import's own writes satisfy these
rules by construction -- the slips are inserted BEFORE the expense is saved, so the save sees its own
linked total, and `settle._derive_status_and_save` sets exactly what rule 4 would derive. A flag
would have made that agreement untested, and it is the agreement that proves the rules are right.
"""

import frappe

from nirmaan_stack.services.outflow_import.expense_links import (
    amount_below_links_refusal,
    delete_while_linked_refusal,
    derive_expense_status,
    load_expense_links,
    paid_while_short_refusal,
)
from nirmaan_stack.services.outflow_import.ledgers import PAID


def validate(doc, method=None):
    """Rules 1, 2 and 4, on every save of an expense that has live bank lines."""
    if doc.is_new():
        # A row that does not exist yet cannot be the target of a slip.
        return
    links = load_expense_links(doc.doctype, doc.name)
    if not links.line_count:
        return

    refusal = amount_below_links_refusal(doc.name, doc.amount, links)
    if refusal:
        frappe.throw(refusal, title="Amount is below its bank lines")

    if _is_arriving_at_paid(doc):
        refusal = paid_while_short_refusal(doc.name, doc.amount, links)
        if refusal:
            frappe.throw(refusal, title="Not fully linked yet")

    _apply_derived_status(doc, links)


def on_trash(doc, method=None):
    """Rule 3. Refuse the delete while any slip is still live.

    ⚠️ IT SITS BESIDE `delete_doc_versions.generate_versions`, NOT INSTEAD OF IT, and FIRST in the
    `hooks.py` list so a refused delete never mints a version row for a document that is still there.

    ⚠️ THE ROW IS ALREADY LOCKED WHEN THIS RUNS, AND THIS RULE DEPENDS ON THAT -- it does not take a
    lock of its own. `frappe.model.delete_doc.delete_doc` does
    `frappe.db.get_value(doctype, name, for_update=True, wait=False)` -- a `SELECT ... FOR UPDATE
    NOWAIT` -- BEFORE it loads the document and runs `on_trash`. So a concurrent
    `link_rows_to_expense` (which takes the same row lock in `settle._lock_settleable_expense`)
    either blocks until this delete commits, or already holds the lock and makes the delete fail
    fast. WITHOUT that, the count read here would be stale by the time the `DELETE` ran and the
    expense could go with live slips pointing at it -- the exact orphan this rule exists to prevent.
    Re-reading under an explicit lock here would be a second lock on a row this transaction already
    holds; if this rule is ever moved off `delete_doc`, it needs its own.
    """
    links = load_expense_links(doc.doctype, doc.name)
    refusal = delete_while_linked_refusal(doc.name, links)
    if refusal:
        frappe.throw(refusal, title="Bank lines are linked")


def _is_arriving_at_paid(doc) -> bool:
    """Whether THIS save is the one putting the expense into Paid.

    ⚠️ THE DISTINCTION IS LOAD-BEARING, AND CONFUSING IT BREAKS RULE 4. An expense that is ALREADY
    Paid and whose amount is then raised must FLIP to Reconciliation Pending (Q8 -- fixing an amount
    is an ordinary edit); if rule 2 fired on it instead, that edit would be refused and the only way
    out would be to unreconcile the whole run. So rule 2 asks about a TRANSITION, not a state.

    ⚠️ `get_doc_before_save()` IS LOADED BY `check_if_latest`, NOT BY `run_before_save_methods`.
    `Document._validate` calls `check_if_latest()` -> `load_doc_before_save(raise_exception=True)` and
    only then `run_before_save_methods()` -> `validate`, so `before` is always populated here on an
    existing document -- but ONLY on a path that goes through `Document._save`. **Naming the real
    caller is the point of this note**: a future reader moving this rule to a hook that runs outside
    `_save`, or invoking `run_method("validate")` directly, would get `before is None`, which makes
    this function always true and turns rule 2 into a refusal of exactly the Q8 raise-the-amount edit
    rule 4 exists to permit. (`load_doc_before_save` reads `for_update=True`, so that same call is
    also what serialises a Desk save against `settle._lock_settleable_expense`.)
    """
    if (doc.status or "").strip() != PAID:
        return False
    before = doc.get_doc_before_save()
    return before is None or (before.status or "").strip() != PAID


def _apply_derived_status(doc, links) -> None:
    """Rule 4. The links decide the status and the payment date -- always, on every save.

    ⚠️ UNCONDITIONAL, NOT ONLY BETWEEN THE TWO STATUSES IT NAMES. A status the links contradict --
    an expense with live bank lines saved as Rejected -- is exactly the state this rule exists to
    make unreachable (story 25: "its status always matches its lines").

    ⚠️ IT REWRITES `payment_date`, NOT ONLY `status`, AND THAT IS THE SPECIFIED BEHAVIOUR (#1302
    rule 4: "every save re-works-out Paid <-> Reconciliation Pending **and the payment date**"). The
    consequence is worth stating because it is SILENT: a person correcting a settled expense's date
    by hand -- in Desk or on the old expense pages -- sees the save succeed and the field revert to
    the latest linked line's date in the same transaction. The date belongs to the bank lines here,
    so it is re-derived rather than refused; pinned by
    `test_expense_document_rules.test_a_hand_edited_payment_date_is_re_derived_from_the_lines`.

    ⚠️ A PAID EXPENSE WHOSE LINES CARRY NO DATE KEEPS THE DATE IT HAS. `latest_line_date` is read
    from the import rows behind the slips; if those rows were purged the aggregate returns `None`,
    and blanking a settled expense's payment date on an unrelated save would destroy a fact rather
    than re-derive one. Reconciliation Pending always clears it -- there, the absence IS the fact.
    """
    verdict = derive_expense_status(doc.amount, links)
    doc.status = verdict.status
    if verdict.status != PAID:
        doc.payment_date = None
    elif verdict.payment_date:
        doc.payment_date = verdict.payment_date
