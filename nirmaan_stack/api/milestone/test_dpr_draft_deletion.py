"""Tests for `get_dpr_draft_deletion`, the DPR editor's "who deleted this draft" lookup.

Run with:
    bench --site localhost run-tests --module nirmaan_stack.api.milestone.test_dpr_draft_deletion

Every report is created with a `report_zone` unique to this suite, and its Deleted Document rows are
removed in `_purge`, so the live site keeps no residue.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.milestone.dpr_draft_deletion import DPR_DOCTYPE, get_dpr_draft_deletion

TEST_ZONE = "__test_dpr_draft_deletion__"


def _make_report(status="Draft"):
	"""Insert one Project Progress Reports row in the test zone and return its name."""
	doc = frappe.get_doc(
		{
			"doctype": DPR_DOCTYPE,
			"project": "__no_such_project__",
			"report_date": frappe.utils.today(),
			"report_zone": TEST_ZONE,
			"report_status": status,
		}
	)
	doc.insert(ignore_permissions=True, ignore_links=True)
	return doc.name


def _purge():
	"""Remove every report and Deleted Document row this suite created. Rolls back first, so it
	still runs after a test left the transaction aborted."""
	frappe.db.rollback()
	failures = []
	try:
		for name in frappe.get_all(DPR_DOCTYPE, filters={"report_zone": TEST_ZONE}, pluck="name"):
			frappe.delete_doc(DPR_DOCTYPE, name, force=True, ignore_permissions=True, delete_permanently=True)
		frappe.db.commit()
	except Exception as e:
		frappe.db.rollback()
		failures.append(f"reports: {e}")
	try:
		frappe.db.delete(
			"Deleted Document",
			{"deleted_doctype": DPR_DOCTYPE, "data": ["like", f"%{TEST_ZONE}%"]},
		)
		frappe.db.commit()
	except Exception as e:
		frappe.db.rollback()
		failures.append(f"deleted documents: {e}")
	if failures:
		raise AssertionError("test_dpr_draft_deletion clean-up failed: " + "; ".join(failures))


class TestGetDprDraftDeletion(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_purge()

	def tearDown(self):
		_purge()

	def test_existing_draft_reports_exists(self):
		name = _make_report("Draft")
		self.assertEqual(get_dpr_draft_deletion(name), {"exists": True, "report_status": "Draft"})

	def test_submitted_report_reports_completed(self):
		name = _make_report("Completed")
		self.assertEqual(get_dpr_draft_deletion(name), {"exists": True, "report_status": "Completed"})

	def test_deleted_draft_names_the_deleter(self):
		name = _make_report("Draft")
		frappe.delete_doc(DPR_DOCTYPE, name, ignore_permissions=True)

		result = get_dpr_draft_deletion(name)

		self.assertFalse(result["exists"])
		self.assertEqual(result["deleted_by"], frappe.utils.get_fullname(frappe.session.user))
		self.assertIsNotNone(result["deleted_at"])

	def test_permanent_delete_has_no_deleter(self):
		name = _make_report("Draft")
		frappe.delete_doc(DPR_DOCTYPE, name, ignore_permissions=True, delete_permanently=True)

		self.assertEqual(
			get_dpr_draft_deletion(name), {"exists": False, "deleted_by": None, "deleted_at": None}
		)

	def test_blank_name_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			get_dpr_draft_deletion("")
