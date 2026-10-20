# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tax withheld from an Office Rent expense -- WHICH type, at WHAT rate, WHEN, and the record it writes
(spec #1522, #1525).

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE** (section 194-I, rent), not a Technical Data Sheet.

The half of the tax service that withholds from a `Non Project Expenses` row; `payment_tds` is the
Work Order half, and both write the one `Payment TDS Deduction` doctype (GLOSSARY "TDS withheld (on an
Office Rent expense)", `.claude/context/domain/payment-tds.md` § One tax record, two sources).

WHICH TYPE, WHICH RATE: `OFFICE_RENT_TDS`, one constant. Office Rent withholds 10% under 194-I whatever
its size; no other expense type withholds anything (owner, 2026-10-20: no Expense Type field). Its
frontend twin is `frontend/src/utils/expenses/expenseTds.OFFICE_RENT_TDS`, which only forecasts; a
parity test there reads this file. Change both or neither.

WHEN: the Work Order rule, reused as it stands -- the Expense is APPROVED FROM AN EARLIER STEP
(`payment_tds.is_approval_from_an_earlier_step`: Requested or CEO Pending -> Approved), or it is
CREATED already Approved (auto-approved under Rs 15,000, or the raiser's or an L1 reviewer's own step
clearing every approval). Coming back to Approved from Reconciliation Pending or Paid is an undo and
withholds nothing; an expense created at any other status (the bank import's Paid rows, ADR-0021)
withholds nothing. `withholds_now` is that rule; `controllers/expense_tds` asks it on insert and on
every save.

WHAT: `withhold_expense_tds` writes the record FIRST (gross = the amount as approved, 10%, the tax,
194-I, borne by the landlord, the landlord's name and PAN, the day), THEN sets the Expense's amount to
the net. ONCE: the record's `non_project_expense` is UNIQUE, so a re-save, a retry or a second call
finds it and changes nothing.

⚠️ THE APPROVAL TIERS READ THE GROSS. The amount is cut only AFTER the approval that withholds, so
`expense_decision` decides every step on the full rent: Rs 55,000 still waits at CEO Pending.

⚠️ NOTHING BACKFILLS. Office Rent expenses approved before this shipped have no record and never get
one: only a transition into Approved, or an insert at Approved, withholds.
"""

from __future__ import annotations

from dataclasses import dataclass

import frappe
from frappe.utils import flt, nowdate

from nirmaan_stack.services.expense_statuses import EXPENSE_APPROVED
from nirmaan_stack.services.outflow_import.ledgers import NON_PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.payment_tds import (
	BORNE_BY_VENDOR,
	TDS_DOCTYPE,
	TDS_SECTION_RENT,
	is_approval_from_an_earlier_step,
)


@dataclass(frozen=True)
class ExpenseTdsRule:
	"""The tax one expense type withholds, and which request answers name who it is withheld from."""

	expense_type: str
	#: Percent of the amount as approved.
	rate: float
	#: `Payment TDS Deduction.tds_section`.
	section: str
	#: The request form's answer keys (`Expense Request.source_data`) holding the deductee.
	deductee_name_key: str
	deductee_pan_key: str


#: THE rule (spec #1522): Office Rent, 10%, 194-I; the landlord, named by Office Rent's form
#: (`fixtures/expense_type.json`, pinned by `services/test_expense_tds_rule`).
OFFICE_RENT_TDS = ExpenseTdsRule(
	expense_type="Office Rent",
	rate=10.0,
	section=TDS_SECTION_RENT,
	deductee_name_key="landlord_name",
	deductee_pan_key="landlord_pan",
)

EXPENSE_TDS_RULES = (OFFICE_RENT_TDS,)


def tds_rule_for(expense_type: str | None) -> ExpenseTdsRule | None:
	"""The rule an expense of this type withholds under, or None for every type but Office Rent. Pure."""
	wanted = (expense_type or "").strip()
	return next((rule for rule in EXPENSE_TDS_RULES if rule.expense_type == wanted), None)


def withholds_now(doctype: str | None, expense_type: str | None, previous_status: str | None,
                  new_status: str | None, *, inserted: bool) -> bool:
	"""Does this save of an Expense withhold its tax? Pure.

	`inserted`: the save created the row, so it has no previous status, and only a row born Approved
	withholds. Otherwise only an approval from an earlier step does (`is_approval_from_an_earlier_step`,
	the Work Order rule). Either way, only a Non-Project Expense of a type with a rule.
	"""
	if doctype != NON_PROJECT_EXPENSE_DOCTYPE or tds_rule_for(expense_type) is None:
		return False
	if inserted:
		return (new_status or "").strip() == EXPENSE_APPROVED
	return is_approval_from_an_earlier_step(previous_status, new_status)


def existing_expense_deduction(expense: str | None) -> str | None:
	"""The tax record of this Non-Project Expense, if any. A check: the UNIQUE `non_project_expense`
	is the guarantee. None for a blank name, which would match every Work Order row."""
	if not expense:
		return None
	return frappe.db.get_value(TDS_DOCTYPE, {"non_project_expense": expense}, "name")


def withhold_expense_tds(doc, *, deductee_name: str | None = None, deductee_pan: str | None = None) -> str | None:
	"""Withhold the tax of one approved Non-Project Expense: write its record, then net its amount.

	Returns the record's name (the existing one when it was withheld before), or None when there is
	nothing to withhold: a type with no rule, a zero or a refund. Never commits.

	⚠️ THE RECORD IS WRITTEN FIRST, THEN THE AMOUNT CUT, as `payment_tds.write_deduction` does. The
	record's `gross_amount` is the only surviving copy of the full rent, so a failed insert must leave
	the amount whole.

	⚠️ `db_set`, NOT `doc.amount = ...`: this runs from the Expense's own `after_insert` / `on_update`,
	after the row is written, so an assignment would be lost. `db_set` writes the column and the
	in-memory doc and fires no save hook, so it cannot withhold a second time; the save's Version row
	still records gross -> net. `update_modified=False`: the save that approved it has just stamped it.

	⚠️ IT RAISES, unlike the Work Order route (`record_deduction_if_eligible`, which logs and swallows).
	Every caller is one approval inside its own savepoint or request (`decide_expenses` per row, the
	request intake), so a failure refuses that approval and nothing else, and an Office Rent expense is
	never Approved at the full rent with no record of its tax. Swallowing a database error would also
	leave the Postgres transaction aborted under the approval.
	"""
	rule = tds_rule_for(doc.get("type"))
	if rule is None:
		return None
	existing = existing_expense_deduction(doc.name)
	if existing:
		return existing

	# To the paisa, as the Work Order rule (`payment_tds.record_deduction`) rounds.
	gross = flt(doc.get("amount"), 2)
	tds = flt(gross * rule.rate / 100.0, 2)
	net = flt(gross - tds, 2)
	# A refund or a zero has nothing to withhold from.
	if gross <= 0 or tds <= 0 or tds >= gross:
		return None

	row = frappe.new_doc(TDS_DOCTYPE)
	row.update(
		{
			"non_project_expense": doc.name,
			"gross_amount": gross,
			"tds_percentage": rule.rate,
			"tds_amount": tds,
			"tds_section": rule.section,
			# The landlord's money is withheld: the Expense is cut to the net.
			"borne_by": BORNE_BY_VENDOR,
			"deductee_name": str(deductee_name or "").strip() or None,
			"deductee_pan": str(deductee_pan or "").strip().upper() or None,
			"payment_approved_on": nowdate(),
		}
	)
	row.insert(ignore_permissions=True)
	doc.db_set("amount", net, update_modified=False)
	return row.name
