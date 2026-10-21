# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""An Office Rent expense's tax: withheld when it is approved, and what that locks (spec #1522).

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not a Technical Data Sheet.

`Non Project Expenses` only: Office Rent is a non-project type. The rules live in
`services/expense_tds`; these hooks only run them, in this order on a save:

    before_validate  the locks, BEFORE the doctype's own `validate` and its edit rules
                     (`expense_decision.guard_hand_save`), whose refusals do not say why: the amount of
                     a withheld Expense (`guard_withheld_amount`, #1526) and its type to or from Office
                     Rent once approved (`guard_tds_type_change`). `doc_events` `validate` would run
                     AFTER the doctype's method, so these sit one step earlier.
    validate         an approval that would withhold is refused while the landlord's name or PAN is
                     missing (`refuse_without_deductee`), BEFORE the save writes the row: nothing of the
                     approval lands. After the doctype's `validate`, so a new row's status is set.
    after_insert     a row created already Approved (auto-approved, or the raiser's or an L1 reviewer's
                     own step clearing every approval): it never makes a transition `on_update` could see
    on_update        an approval from an earlier step (Requested / CEO Pending -> Approved), through
                     `expense_decision.decide`, the one door that moves an expense's status
    on_trash         the tax record goes with its Expense, or the delete is refused while the tax is on
                     a challan (`expense_tds.delete_with_expense`, #1526)

Which save withholds is one rule (`services/expense_tds.withholds_now`), asked by `validate`,
`after_insert` and `on_update` alike. Frappe also runs `on_update` at the end of an insert, with no
document before the save; that one is the `after_insert`'s and is skipped.

The deductee (the landlord's name and PAN) is read from the answers of the Expense Request the row
was born from (`request_id`), under the keys the rule names. A row with no request, or whose request
does not name the landlord, is not approved (owner, 2026-10-21).

⚠️ THE ANSWERS ARE READ THROUGH `api/expense_requests/flatten`. A controller importing an `api` module
is the codebase's standing practice (most controllers here do) and no rule forbids it: ADR-0010 B4
forbids the other direction, an endpoint reaching into a controller's validator. `flat_responses` is
the one owner of the answers' shape (B2), so it is reused, not copied into `services`.

Neither save hook swallows a failure: see `expense_tds.withhold_expense_tds`.
"""

import frappe

from nirmaan_stack.api.expense_requests.flatten import flat_responses
from nirmaan_stack.services.expense_tds import (
    delete_with_expense,
    guard_tds_type_change,
    guard_withheld_amount,
    refuse_without_deductee,
    tds_rule_for,
    tds_split,
    withhold_expense_tds,
    withholds_now,
)


def before_validate(doc, method=None):
    """The locks, before the edit rules: a withheld amount, and the type to or from Office Rent."""
    guard_withheld_amount(doc)
    guard_tds_type_change(doc)


def validate(doc, method=None):
    """An approval that would withhold is refused, before anything is written, without the landlord."""
    if doc.is_new():
        previous, inserted = None, True
    else:
        before = doc.get_doc_before_save()
        if before is None:
            return
        previous, inserted = before.get("status"), False
    if not withholds_now(doc.doctype, doc.get("type"), previous, doc.get("status"), inserted=inserted):
        return
    if tds_split(doc.get("type"), doc.get("amount")) is None:
        return  # a zero or a refund withholds nothing, so it needs no landlord
    refuse_without_deductee(*_deductee(doc))


def after_insert(doc, method=None):
    """A row born Approved withholds at once."""
    if withholds_now(doc.doctype, doc.get("type"), None, doc.get("status"), inserted=True):
        _withhold(doc)


def on_update(doc, method=None):
    """An approval from an earlier step withholds; an undo back to Approved and every other save do not."""
    before = doc.get_doc_before_save()
    if before is None:
        return  # an insert: `after_insert` has decided it
    if withholds_now(doc.doctype, doc.get("type"), before.get("status"), doc.get("status"), inserted=False):
        _withhold(doc)


def on_trash(doc, method=None):
    """The tax record goes with its Expense, or the delete is refused while the tax is on a challan."""
    delete_with_expense(doc.name)


def _withhold(doc) -> None:
    name, pan = _deductee(doc)
    withhold_expense_tds(doc, deductee_name=name, deductee_pan=pan)


def _deductee(doc) -> tuple[str | None, str | None]:
    """`(name, PAN)` from the originating request's answers; `(None, None)` with no request, which the
    approval then refuses."""
    rule = tds_rule_for(doc.get("type"))
    request = doc.get("request_id")
    if rule is None or not request:
        return None, None
    answers = flat_responses(frappe.db.get_value("Expense Request", request, "source_data"))
    return answers.get(rule.deductee_name_key), answers.get(rule.deductee_pan_key)
