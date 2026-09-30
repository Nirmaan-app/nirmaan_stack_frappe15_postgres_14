# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`get_invoice_gst_release`: what the invoice approval screen says about GST (ADR-0030).

"This approval opens up ₹X of GST" -- X is how much approving the invoice raises
min(GST Invoiced, Work Order GST). Driven through the real endpoint and the real
approval endpoint, against Work Orders whose `gst_invoiced` is kept by the doc events.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate

from nirmaan_stack.api.invoices.gst_release import get_invoice_gst_release
from nirmaan_stack.api.invoices.test_document_amount_fields import _raw

# A GST-on Work Order of base 100000: total 118000, own GST 18000.
WO_TOTAL = 118000


class TestInvoiceGstRelease(FrappeTestCase):
	def setUp(self):
		self.SR = _raw("Service Requests", total_amount=WO_TOTAL, gst="true", amount_paid=0)

	def _approve(self, invoice_name):
		"""Drive the real approval endpoint with its commit neutralised, so the
		FrappeTestCase transaction still rolls back."""
		from nirmaan_stack.api.invoices import approve_vendor_invoice as mod
		real_commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None
		try:
			return mod.approve_vendor_invoice(invoice_name, "Approved")
		finally:
			frappe.db.commit = real_commit

	def _pending(self, gst, parent=None, doctype="Service Requests"):
		d = frappe.get_doc({
			"doctype": "Vendor Invoices",
			"document_type": doctype,
			"document_name": parent or self.SR,
			"invoice_no": "T-" + frappe.generate_hash(length=8),
			"invoice_date": nowdate(),
			"invoice_amount": gst / 0.18 * 1.18,
			"invoice_base_amount": gst / 0.18,
			"invoice_gst_amount": gst,
			"status": "Pending",
		})
		d.insert(ignore_permissions=True)
		return d

	def test_a_first_invoice_opens_up_all_its_gst(self):
		vi = self._pending(5000)
		r = get_invoice_gst_release(vi.name)
		self.assertTrue(r["applies"])
		self.assertAlmostEqual(r["invoice_gst"], 5000)
		self.assertAlmostEqual(r["gst_invoiced"], 0)
		self.assertAlmostEqual(r["work_order_gst"], 18000)
		self.assertAlmostEqual(r["opens_up"], 5000)

	def test_counts_what_earlier_approvals_already_opened(self):
		first = self._pending(15000)
		self._approve(first.name)
		second = self._pending(5000)
		r = get_invoice_gst_release(second.name)
		self.assertAlmostEqual(r["gst_invoiced"], 15000)
		# only 3000 of the Work Order's own 18000 GST is left to open up
		self.assertAlmostEqual(r["opens_up"], 3000)

	def test_over_stated_gst_is_capped_at_the_work_order_gst(self):
		vi = self._pending(25000)
		self.assertAlmostEqual(get_invoice_gst_release(vi.name)["opens_up"], 18000)

	def test_a_gst_off_work_order_does_not_apply(self):
		off = _raw("Service Requests", total_amount=100000, gst="false", amount_paid=0)
		vi = self._pending(5000, parent=off)
		r = get_invoice_gst_release(vi.name)
		self.assertFalse(r["applies"])
		self.assertEqual(r["opens_up"], 0)

	def test_a_purchase_order_invoice_does_not_apply(self):
		po = _raw("Procurement Orders", total_amount=118000, amount_paid=0)
		vi = self._pending(5000, parent=po, doctype="Procurement Orders")
		self.assertFalse(get_invoice_gst_release(vi.name)["applies"])

	def test_an_invoice_already_decided_does_not_apply(self):
		vi = self._pending(5000)
		self._approve(vi.name)
		self.assertFalse(get_invoice_gst_release(vi.name)["applies"])

	def test_a_user_without_read_permission_is_refused(self):
		vi = self._pending(5000)
		frappe.set_user("Guest")
		try:
			with self.assertRaises(frappe.PermissionError):
				get_invoice_gst_release(vi.name)
		finally:
			frappe.set_user("Administrator")
