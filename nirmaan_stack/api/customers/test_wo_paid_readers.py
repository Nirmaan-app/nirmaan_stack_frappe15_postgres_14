# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The server-side screens that read a Work Order's stored Amount Paid show the vendor's TDS in it (#1511).

ADR-0034 Amendment A: a WO's Amount Paid is its Paid payments plus the TDS withheld from the vendor, less
Received refunds. These readers take the stored figure as it is, so they change with #1509 and add no
tax of their own:

    the customer page   Total Amount Paid, Total Amount Due   (`customer_financials`)
    the GST Hold card   each WO's Amount Paid                 (`vendor_fy_limit.get_vendor_fy_wo_total`)

    WO V   ordinary, Rs 10,000 gross paid: Rs 9,800 to the vendor, Rs 200 withheld -> Amount Paid 10,000
    WO C   Misc only, Rs 800 paid whole, Rs 16 paid by the company on top         -> Amount Paid 800

Driven through the real doors (`ceo_approve_payment`, a payment save to Paid); the readers are called
through their whitelisted endpoints.

⚠️ RUNS AGAINST THE SITE DATABASE. Everything is `TEST-TWO-*`, purged by `TaxedWorkOrderFixture`; the
scratch customer is purged here.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.customers.customer_financials import get_customer_financial_details_api
from nirmaan_stack.api.service_requests.vendor_fy_limit import get_vendor_fy_wo_total
from nirmaan_stack.services.test_amount_paid_tds import AmountPaidFixture
from nirmaan_stack.services.test_tds_borne_by import MISC, MISC_AND_ELECTRICAL


class TestReadersOfTheStoredAmountPaid(AmountPaidFixture):
	def setUp(self):
		super().setUp()
		self.vendor_wo = self._wo(MISC_AND_ELECTRICAL, total=50000)
		self.company_wo = self._wo(MISC, total=5000)
		self._paid(self.vendor_wo, 10000)
		self._paid(self.company_wo, 800)

	def test_the_customer_page_counts_the_tax_withheld_from_the_vendor_as_paid(self):
		customer = self._customer_of(self.project)

		totals = get_customer_financial_details_api(customer)["totals"]

		self.assertEqual(flt(totals["total_amount_paid"], 2), 10800.0)
		self.assertEqual(flt(totals["total_amount_due"], 2), 44200.0)

	def test_the_gst_hold_card_shows_each_work_orders_stored_amount_paid(self):
		card = get_vendor_fy_wo_total(self.vendor)

		paid = {wo.name: flt(wo.amount_paid, 2) for wo in card["work_orders"]}
		self.assertEqual(paid, {self.vendor_wo: 10000.0, self.company_wo: 800.0})

	def _customer_of(self, project):
		name = self.fx._name("CUST")
		frappe.db.sql(
			"""INSERT INTO "tabCustomers" (name, creation, modified, modified_by, owner, docstatus, idx,
			       company_name)
			   VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s)""",
			(name, name),
		)
		frappe.db.set_value("Projects", project, "customer", name, update_modified=False)
		frappe.db.commit()
		self.addCleanup(self._purge_customer, name)
		return name

	def _purge_customer(self, name):
		frappe.db.rollback()
		frappe.db.delete("Customers", {"name": name})
		frappe.db.commit()
