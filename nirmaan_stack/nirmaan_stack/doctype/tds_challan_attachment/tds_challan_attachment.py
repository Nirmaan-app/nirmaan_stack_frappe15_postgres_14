# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

FINANCIAL_YEAR_PATTERN = re.compile(r"^(\d{4})-(\d{2})$")


class TDSChallanAttachment(Document):
	"""One ITNS 281 challan: the receipt for TDS deposited with the Income Tax Department.

	⚠️ "TDS" HERE MEANS **TAX DEDUCTED AT SOURCE**, AND THIS REPO ALSO USES "TDS" FOR
	**TECHNICAL DATA SHEET** (`TDS Items`, `TDS Repository`, `Project TDS Item List`,
	`Project TDS Setting`). Same three letters, unrelated concepts. This doctype belongs to
	the tax family, next to `Payment TDS Deduction`.

	DUPLICATE KEY: Amount + Bank Reference Number + BSR Code + Challan No. All four matching an
	existing row means the same challan uploaded twice. The site runs on Postgres, where string
	equality is case-sensitive, so the text parts are trimmed (and the bank reference
	upper-cased) BEFORE the lookup; otherwise "ab123 " and "AB123" would slip past each other.
	"""

	def validate(self):
		self._normalize_keys()
		self._validate_financial_year()
		self._validate_reconciled_amount()
		self._validate_duplicate()

	def _normalize_keys(self):
		self.financial_year = (self.financial_year or "").strip()
		self.bank_reference_number = (self.bank_reference_number or "").strip().upper()
		self.bsr_code = (self.bsr_code or "").strip()
		self.challan_no = (self.challan_no or "").strip()

	def _validate_financial_year(self):
		match = FINANCIAL_YEAR_PATTERN.match(self.financial_year)
		if not match or int(match.group(2)) != (int(match.group(1)) + 1) % 100:
			frappe.throw(
				_("Financial Year must look like 2025-26 (got '{0}').").format(self.financial_year)
			)

	def _validate_reconciled_amount(self):
		reconciled = flt(self.reconciled_amount, 2)
		if reconciled < 0 or reconciled > flt(self.amount, 2):
			frappe.throw(
				_("Reconciled Amount ({0}) must be between 0 and the challan Amount ({1}).").format(
					reconciled, flt(self.amount, 2)
				)
			)

	def _validate_duplicate(self):
		duplicate = frappe.db.get_value(
			self.doctype,
			{
				"amount": flt(self.amount, 2),
				"bank_reference_number": self.bank_reference_number,
				"bsr_code": self.bsr_code,
				"challan_no": self.challan_no,
				"name": ["!=", self.name or ""],
			},
			"name",
		)
		if duplicate:
			frappe.throw(
				_(
					"This challan is already recorded as {0} (same Amount, Bank Reference Number, "
					"BSR Code and Challan No)."
				).format(duplicate),
				frappe.DuplicateEntryError,
			)
