# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""`set_items_tds_link`: which SKUs may become TDS Item members.

Fixtures are raw inserts inside a transaction whose commits are stubbed and which is rolled back in
`tearDown`, the same shape as `test_approve.py`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.tds.linking import (
	BILLABLE,
	LINK_FIELD,
	TDS_EXCLUDED_CATEGORIES,
	member_refusal,
	set_items_tds_link,
)
from nirmaan_stack.api.tds.test_submit import _raw


class TestMemberRefusal(FrappeTestCase):
	def test_a_billable_item_in_an_ordinary_category_is_accepted(self):
		self.assertIsNone(member_refusal("Fans", BILLABLE))

	def test_a_non_billable_or_blank_item_is_refused(self):
		for billing in ("Non-Billable", "", None):
			with self.subTest(billing=billing):
				self.assertIn("Billable", member_refusal("Fans", billing))

	def test_an_excluded_category_is_refused_even_when_billable(self):
		for category in TDS_EXCLUDED_CATEGORIES:
			with self.subTest(category=category):
				self.assertIn(category, member_refusal(category, BILLABLE))


class TestSetItemsTdsLink(FrappeTestCase):
	def setUp(self):
		self._real_commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None
		frappe.set_user("Administrator")
		self.wp = f"TEST WP {frappe.generate_hash(length=4)}"
		_raw("Procurement Packages", name=self.wp, work_package_name=self.wp)
		self.category = _raw("Category", category_name="Test Valves", work_package=self.wp)
		self.group = _raw("TDS Items", tds_item_name="Gate Valve", work_package=self.wp)

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._real_commit
		frappe.db.rollback()

	def _item(self, billing_category, category=None):
		return _raw(
			"Items",
			item_name=f"Valve {frappe.generate_hash(length=4)}",
			category=category or self.category,
			billing_category=billing_category,
		)

	def _link(self, item):
		return frappe.db.get_value("Items", item, LINK_FIELD) or ""

	def test_a_billable_item_is_linked(self):
		item = self._item(BILLABLE)

		out = set_items_tds_link([item], self.group)

		self.assertEqual((out["updated"], out["errors"]), ([item], []))
		self.assertEqual(self._link(item), self.group)

	def test_a_non_billable_item_is_refused_and_left_unlinked(self):
		item = self._item("Non-Billable")

		out = set_items_tds_link([item], self.group)

		self.assertEqual(out["updated"], [])
		self.assertEqual([e["item"] for e in out["errors"]], [item])
		self.assertIn("Billable", out["errors"][0]["reason"])
		self.assertEqual(self._link(item), "")

	def test_a_billable_hvac_junk_item_is_refused_without_blocking_the_rest(self):
		if not frappe.db.exists("Category", "HVAC Junk"):
			_raw("Category", name="HVAC Junk", category_name="HVAC Junk", work_package=self.wp)
		junk = self._item(BILLABLE, category="HVAC Junk")
		good = self._item(BILLABLE)

		out = set_items_tds_link([junk, good], self.group)

		self.assertEqual(out["updated"], [good])
		self.assertEqual([e["item"] for e in out["errors"]], [junk])
		self.assertIn("HVAC Junk", out["errors"][0]["reason"])
		self.assertEqual((self._link(junk), self._link(good)), ("", self.group))
