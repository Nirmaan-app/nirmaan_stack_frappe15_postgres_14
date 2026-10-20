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

AFTER IT (#1526): THE AMOUNT IS LOCKED, AND THE RECORD GOES ONLY WITH ITS EXPENSE.
`guard_withheld_amount` refuses every save that changes the amount of an Expense with a record, for
every person and every system writer, with ONE exemption: Bulk Import's single-line correction
(`BANK_AMOUNT_CORRECTION`, within the settle window), which leaves the record as it is: the gross is
never restated as net / 0.9. `delete_with_expense` deletes the record with its Expense while the tax is
on no challan, and refuses the delete once it is, naming the challan.
"""

from __future__ import annotations

from dataclasses import dataclass

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from nirmaan_stack.services.expense_statuses import EXPENSE_APPROVED
from nirmaan_stack.services.outflow_import.amounts import amounts_match, rupees
from nirmaan_stack.services.outflow_import.ledgers import NON_PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.payment_tds import (
	BORNE_BY_VENDOR,
	CHALLAN_DOCTYPE,
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


#: What a screen is served of a withheld record (`withheld_tds_of`): the full rent, the rate, the tax and
#: the section. The net is the screen's `gross_amount - tds_amount`, never the Expense's amount, which
#: Bulk Import's few-rupee correction may have moved (#1526).
WITHHELD_TDS_FIELDS = ("gross_amount", "tds_percentage", "tds_amount", "tds_section")


def withheld_tds_of(expenses) -> dict[str, dict]:
	"""Non-Project Expense name -> the tax withheld from it, `{gross_amount, tds_percentage, tds_amount,
	tds_section}`, for each of these that has a record. One query; an expense with none is absent.

	THE ONE READER of a record for the expense screens (#1527): the approval queue, the approve dialog's
	detail, the request page and the Expenses list's standing, and the edit dialog's lookup
	(`api/approvals/expense_tds`). Nothing is served before approval: the amount is still the full rent
	then, and the screens forecast from it (`frontend/src/utils/expenses/expenseTds.shownExpenseTds`).

	⚠️ READ WITHOUT THE RECORD'S PERMISSION, ON PURPOSE. `Payment TDS Deduction` is read by the
	Accountant roles (and System Manager) only, while an HR approver, Admin and the CEO see the Expense. Every caller is an
	endpoint that has already checked its caller may read the Expense (or its request), and these four
	figures are what its approver is shown of it. Do not widen the doctype's permissions instead: that
	would open the whole register, Work Order rows included.
	"""
	names = list({e for e in expenses if e})
	if not names:
		return {}
	rows = frappe.get_all(TDS_DOCTYPE, filters={"non_project_expense": ["in", names]},
	                      fields=["non_project_expense", *WITHHELD_TDS_FIELDS])
	return {
		r.non_project_expense: {
			"gross_amount": flt(r.gross_amount, 2),
			"tds_percentage": flt(r.tds_percentage),
			"tds_amount": flt(r.tds_amount, 2),
			"tds_section": r.tds_section,
		}
		for r in rows
	}


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


# ── After it: the amount is locked, the record goes only with its Expense (#1526) ─────────────

#: The `doc.flags` key of the ONE save that may move a withheld Expense's amount: Bulk Import's
#: single-line correction (`settle.link_lines_to_expense`, a 1:1 fill), which writes what the bank
#: moved. Set there and nowhere else. Even with it, a move wider than the settle window is refused.
BANK_AMOUNT_CORRECTION = "bank_amount_correction"


def guard_withheld_amount(doc) -> None:
	"""`Non Project Expenses.validate`, FIRST: refuse an amount change on an Expense whose tax was withheld.

	For every save, a person's (Desk, REST, the app's edit) or a system writer's
	(`ignore_permissions`), so an Accountant, the Accountant Lead and Admin all meet it before the
	edit rules (`expense_decision.guard_hand_save`), whose own refusals do not say why. The other
	fields stay under those rules.

	⚠️ THE RECORD'S GROSS IS THE ONLY COPY OF THE FULL RENT. An amount edit would leave the record
	describing a payment that no longer exists, and restating it (net / 0.9, as
	`payment_tds.restate_deduction_on_amount_change` does for a Work Order) would invent tax: the
	tax was withheld on the rent as approved, and may already be paid under a challan.

	THE ONE EXEMPTION: a save flagged `BANK_AMOUNT_CORRECTION`, within the settle window
	(`amounts_match`). The bank's few rupees are rounding, not a new rent, so the record stays as it
	was. `withhold_expense_tds`'s own net is a `db_set`, which runs no `validate`, so it never meets
	this.
	"""
	if doc.is_new():
		return
	before = doc.get_doc_before_save()
	if before is None or flt(before.get("amount"), 2) == flt(doc.get("amount"), 2):
		return
	record = existing_expense_deduction(doc.name)
	if not record:
		return
	if doc.flags.get(BANK_AMOUNT_CORRECTION) and amounts_match(before.get("amount"), doc.get("amount")):
		return
	frappe.throw(
		_("The tax has been withheld from {0} ({1}), so its amount stays {2}. Its other details can still "
		  "be edited.").format(doc.name, record, rupees(before.get("amount"))),
		title=_("Tax withheld"),
	)


def delete_with_expense(expense: str) -> None:
	"""`Non Project Expenses.on_trash`: delete its tax record with it, or refuse while the tax is on a challan.

	⚠️ IN `on_trash`, BECAUSE FRAPPE CHECKS LINKS AFTER IT: the record's `non_project_expense` would
	otherwise refuse the delete with a message naming a doctype few people open (as
	`controllers/project_payments.on_trash` deletes a payment's deduction).

	⚠️ ONCE THE TAX IS ON A CHALLAN THE DELETE IS REFUSED, NAMING IT. That tax was paid to the
	department against this rent; deleting the Expense would take the record out of the challan's
	used balance while the money stays paid.

	Off a challan, the record goes through the document layer (`frappe.delete_doc`): a Deleted
	Document copy stays, and the record's own `on_trash` runs the one challan rule
	(`payment_tds.recompute_challan_reconciled`) should it name one. No figure is ever subtracted.

	The row lock: `delete_doc` holds the Expense's, and this takes the record's, so a concurrent Pay
	TDS either lands first (and this refuses) or finds the record gone. Never commits.
	"""
	record = frappe.db.get_value(TDS_DOCTYPE, {"non_project_expense": expense}, ["name", "tds_challan"],
	                             as_dict=True, for_update=True)
	if not record:
		return
	if record.tds_challan:
		challan_no = frappe.db.get_value(CHALLAN_DOCTYPE, record.tds_challan, "challan_no")
		challan = f"{record.tds_challan} (challan no. {challan_no})" if challan_no else record.tds_challan
		frappe.throw(
			_("{0} cannot be deleted: its tax ({1}) has been paid under challan {2}.").format(
				expense, record.name, challan),
			title=_("Tax paid under a challan"),
		)
	frappe.delete_doc(TDS_DOCTYPE, record.name, ignore_permissions=True)
