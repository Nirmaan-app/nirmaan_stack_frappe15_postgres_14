# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class PaymentTDSDeduction(Document):
	"""One tax deduction withheld from one Project Payment.

	Deliberately bare. Naming is the JSON's `autoname`, and every rule about WHEN a row is
	created, at what rate and for which ledger lives in `services/payment_tds.py` — the
	repo's residence rule (ADR-0010 B1) puts a calculation the business names in a service
	module, not in a doctype controller.

	⚠️ "TDS" HERE MEANS **TAX DEDUCTED AT SOURCE**, AND THIS REPO ALSO USES "TDS" FOR
	**TECHNICAL DATA SHEET** (`TDS Items`, `TDS Repository`, `Project TDS Item List`,
	`Project TDS Setting`). Same three letters, unrelated concepts, different owners — a grep
	for `TDS` lands on both and they must never be reconciled with each other. The same warning
	already sits on `Vendors.tds_deduction_percentage`, which is this doctype's rate source.
	"""

	pass
