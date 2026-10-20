# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Withhold an Office Rent expense's tax when it is approved (spec #1522, #1525).

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not a Technical Data Sheet.

`Non Project Expenses` only: Office Rent is a non-project type. Two hooks, one rule
(`services/expense_tds.withholds_now`), as the Work Order payment's `after_insert` / `on_update` pair:

    after_insert   a row created already Approved (auto-approved, or the raiser's or an L1 reviewer's
                   own step clearing every approval): it never makes a transition `on_update` could see
    on_update      an approval from an earlier step (Requested / CEO Pending -> Approved), through
                   `expense_decision.decide`, the one door that moves an expense's status

Frappe also runs `on_update` at the end of an insert, with no document before the save; that one is
the `after_insert`'s and is skipped.

The deductee (the landlord's name and PAN) is read from the answers of the Expense Request the row
was born from (`request_id`), under the keys the rule names. A row with no request, or a request
raised before the form asked for the landlord, withholds the tax all the same, with no deductee.

Neither hook swallows a failure: see `expense_tds.withhold_expense_tds`.

`on_trash` (#1526): the tax record goes with its Expense while the tax is on no challan, and the delete
is refused once it is (`expense_tds.delete_with_expense`). The amount lock is the doctype's own
`validate` (`expense_tds.guard_withheld_amount`).
"""

import frappe

from nirmaan_stack.api.expense_requests.flatten import flat_responses
from nirmaan_stack.services.expense_tds import (
	delete_with_expense,
	tds_rule_for,
	withhold_expense_tds,
	withholds_now,
)


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
	"""`(name, PAN)` from the originating request's answers, or `(None, None)`."""
	rule = tds_rule_for(doc.get("type"))
	request = doc.get("request_id")
	if rule is None or not request:
		return None, None
	answers = flat_responses(frappe.db.get_value("Expense Request", request, "source_data"))
	return answers.get(rule.deductee_name_key), answers.get(rule.deductee_pan_key)
