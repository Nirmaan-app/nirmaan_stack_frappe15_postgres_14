# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Payment Done tab's Upload / Edit Inv (owner, 2026-10-31): `set_paid_expense_invoice`.

Admin, Accounts and HR set a Paid expense's invoice file, number and date, and nothing else. The upload arrives
unattached (an HR user may not write the expense) and is filed under the expense; any other File URL is refused.

Files are planted as raw `tabFile` rows with fake cloud URLs (`test_submit._cloud_url`): a real upload would go
to the production bucket for good. Each test purges its expenses, Files and users.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate

from nirmaan_stack.api.expenses.paid_invoice import set_paid_expense_invoice
from nirmaan_stack.api.outflow_import.test_card_import import purge_records
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, OUTSIDER, _Users
from nirmaan_stack.api.tds.test_submit import _cloud_url

NPE = "Non Project Expenses"
PE = "Project Expenses"
HR_EXECUTIVE = "Nirmaan HR Executive Profile"
HR_LEAD = "Nirmaan HR Lead Profile"
U = "Administrator"


class PaidInvoiceCase(FrappeTestCase):
	def setUp(self):
		super().setUp()
		frappe.set_user(U)
		self.users = _Users()
		self.expenses = {NPE: [], PE: []}
		self.files = []
		self.addCleanup(self._purge)

	def _purge(self):
		frappe.db.rollback()
		frappe.set_user(U)
		for doctype, names in self.expenses.items():
			try:
				if names:
					frappe.db.delete("Nirmaan Versions", {"ref_doctype": doctype, "docname": ["in", names]})
					frappe.db.commit()
			except Exception:
				frappe.db.rollback()
			purge_records(doctype, names)
		try:
			if self.files:
				frappe.db.delete("File", {"name": ["in", self.files]})
			frappe.db.commit()
		except Exception as exc:
			frappe.db.rollback()
			raise AssertionError(f"purge failed: files: {exc}") from exc
		try:
			self.users.purge()
		except Exception as exc:
			frappe.db.rollback()
			raise AssertionError(f"purge failed: users: {exc}") from exc

	def _expense(self, doctype=NPE, status="Paid", **extra):
		"""Planted raw: the row is the input, and a hand insert at Paid is refused (`guard_hand_save`)."""
		name = f"TEST-PAIDINV-{frappe.generate_hash(length=10)}"
		cols = {"name": name, "modified_by": U, "owner": U, "docstatus": 0, "idx": 0, "status": status,
				"amount": 1200.0, "description": "Paid invoice test", "type": "Petty Cash",
				"payment_date": nowdate(), **extra}
		frappe.db.sql(
			f'INSERT INTO "tab{doctype}" (creation, modified, {", ".join(cols)}) '
			f'VALUES (NOW(), NOW(), {", ".join(["%s"] * len(cols))})',
			tuple(cols.values()),
		)
		frappe.db.commit()
		self.expenses[doctype].append(name)
		return name

	def _upload(self, owner, attached_to=None):
		"""An uploaded File as the storage app leaves it: an `/api/method/...` URL, unattached unless given."""
		name = frappe.generate_hash(length=10)
		url = _cloud_url(f"paidinv-{name}.pdf")
		doctype, docname = attached_to or (None, None)
		frappe.db.sql(
			"""INSERT INTO "tabFile" (name, creation, modified, modified_by, owner, docstatus, idx, file_name,
				   file_url, is_private, is_folder, attached_to_doctype, attached_to_name)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 1, 0, %s, %s)""",
			(name, owner, owner, f"paidinv-{name}.pdf", url, doctype, docname),
		)
		frappe.db.commit()
		self.files.append(name)
		return url

	def _set(self, user, doctype, expense, url, ref="INV-77", date=None):
		frappe.set_user(user)
		try:
			return set_paid_expense_invoice(doctype, expense, url, ref, date or nowdate())
		finally:
			frappe.set_user(U)


class TestWhoMaySetIt(PaidInvoiceCase):
	def test_an_hr_executive_sets_a_paid_expenses_invoice_and_the_upload_is_filed_under_it(self):
		hr = self.users.make(HR_EXECUTIVE)
		expense = self._expense()
		url = self._upload(hr)
		self._set(hr, NPE, expense, url, ref="INV-77", date=add_days(nowdate(), -2))
		saved = frappe.db.get_value(NPE, expense, ["invoice_attachment", "invoice_ref", "invoice_date"], as_dict=True)
		self.assertEqual(saved.invoice_attachment, url)
		self.assertEqual(saved.invoice_ref, "INV-77")
		self.assertEqual(str(saved.invoice_date), add_days(nowdate(), -2))
		self.assertEqual(
			frappe.db.get_value("File", {"file_url": url}, ["attached_to_doctype", "attached_to_name", "attached_to_field"]),
			(NPE, expense, "invoice_attachment"),
		)

	def test_an_hr_lead_and_an_accountant_may_too_on_either_ledger(self):
		for profile, doctype in ((HR_LEAD, NPE), (ACCOUNTANT, PE)):
			user = self.users.make(profile)
			expense = self._expense(doctype)
			self._set(user, doctype, expense, self._upload(user))
			self.assertEqual(frappe.db.get_value(doctype, expense, "invoice_ref"), "INV-77")

	def test_anyone_else_is_refused(self):
		outsider = self.users.make(OUTSIDER)
		expense = self._expense()
		with self.assertRaises(frappe.PermissionError):
			self._set(outsider, NPE, expense, self._upload(outsider))
		self.assertFalse(frappe.db.get_value(NPE, expense, "invoice_attachment"))


class TestWhatItWrites(PaidInvoiceCase):
	def test_only_a_paid_expense(self):
		hr = self.users.make(HR_EXECUTIVE)
		expense = self._expense(status="Reconciliation Pending")
		with self.assertRaisesRegex(frappe.ValidationError, "only once it is Paid"):
			self._set(hr, NPE, expense, self._upload(hr))

	def test_the_file_number_and_date_are_required_and_the_date_not_after_today(self):
		hr = self.users.make(HR_EXECUTIVE)
		expense = self._expense()
		url = self._upload(hr)
		with self.assertRaisesRegex(frappe.ValidationError, "invoice number"):
			self._set(hr, NPE, expense, url, ref="  ")
		with self.assertRaisesRegex(frappe.ValidationError, "after today"):
			self._set(hr, NPE, expense, url, date=add_days(nowdate(), 1))
		with self.assertRaisesRegex(frappe.ValidationError, "invoice file"):
			self._set(hr, NPE, expense, "")

	def test_edit_keeps_the_file_already_on_the_expense(self):
		hr = self.users.make(HR_EXECUTIVE)
		kept = _cloud_url("paidinv-kept.pdf")
		expense = self._expense(invoice_attachment=kept, invoice_ref="OLD-1")
		self._set(hr, NPE, expense, kept, ref="NEW-2")
		self.assertEqual(frappe.db.get_value(NPE, expense, ["invoice_attachment", "invoice_ref"]), (kept, "NEW-2"))

	def test_nothing_but_the_invoice_changes(self):
		hr = self.users.make(HR_EXECUTIVE)
		expense = self._expense()
		before = frappe.db.get_value(NPE, expense, ["description", "amount", "status", "payment_date"], as_dict=True)
		self._set(hr, NPE, expense, self._upload(hr))
		after = frappe.db.get_value(NPE, expense, ["description", "amount", "status", "payment_date"], as_dict=True)
		self.assertEqual(before, after)


class TestWhichFileItTakes(PaidInvoiceCase):
	def test_another_records_file_is_refused(self):
		hr = self.users.make(HR_EXECUTIVE)
		elsewhere = self._expense()
		expense = self._expense()
		url = self._upload(hr, attached_to=(NPE, elsewhere))
		with self.assertRaisesRegex(frappe.ValidationError, "Upload it again"):
			self._set(hr, NPE, expense, url)

	def test_someone_elses_unattached_upload_is_refused(self):
		hr = self.users.make(HR_EXECUTIVE)
		other = self.users.make(HR_LEAD)
		expense = self._expense()
		with self.assertRaisesRegex(frappe.ValidationError, "Upload it again"):
			self._set(hr, NPE, expense, self._upload(other))

	def test_a_url_no_file_carries_is_refused(self):
		hr = self.users.make(HR_EXECUTIVE)
		expense = self._expense()
		with self.assertRaisesRegex(frappe.ValidationError, "Upload it again"):
			self._set(hr, NPE, expense, _cloud_url("paidinv-nowhere.pdf"))
