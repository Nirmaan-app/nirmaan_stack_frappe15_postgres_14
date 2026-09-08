# Copyright (c) 2024, Abhishek and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.projects._project_population import apply_full_project_details
from nirmaan_stack.api.projects.add_customer_po import (
	add_customer_po_with_validation,
	delete_customer_po,
	update_customer_po_with_validation,
)
from nirmaan_stack.patches.v3_0.migrate_project_status_created_to_won import (
	execute as migrate_created_to_won,
)

TEST_CITY = "ZzMigTestCity"
POP_TEST_CITY = "ZzPopTestCity"


def _make_project(name_suffix, status):
	doc = frappe.get_doc(
		{
			"doctype": "Projects",
			"project_name": f"MigTest {name_suffix}",
			"project_city": TEST_CITY,
			"project_state": "Test State",
			"project_start_date": "2025-01-01 00:00:00",
			"project_end_date": "2025-12-31 00:00:00",
			"project_scopes": {"scopes": []},
			"status": status,
		}
	).insert(ignore_permissions=True)
	return doc.name


class TestProjects(FrappeTestCase):
	def tearDown(self):
		for name in frappe.get_all("Projects", filters={"project_city": TEST_CITY}, pluck="name"):
			frappe.delete_doc("Projects", name, ignore_permissions=True, force=True)
		frappe.db.commit()

	def test_migrate_created_to_won(self):
		"""The Created->Won migration renames Created projects and leaves others alone."""
		created_name = _make_project("created", "Created")
		wip_name = _make_project("wip", "WIP")

		migrate_created_to_won()

		self.assertEqual(frappe.db.get_value("Projects", created_name, "status"), "Won")
		self.assertEqual(frappe.db.get_value("Projects", wip_name, "status"), "WIP")
		# The retired "Created" status must no longer exist on any project.
		self.assertEqual(frappe.db.count("Projects", {"status": "Created"}), 0)


def _pick_existing(doctype, **filters):
	"""Return one existing docname for `doctype` matching filters, or None."""
	rows = frappe.get_all(doctype, filters=filters or None, pluck="name", limit=1)
	return rows[0] if rows else None


class TestApplyFullProjectDetails(FrappeTestCase):
	"""
	B3 (Slice 6) coverage for the extracted population helper
	`apply_full_project_details`. Exercises Address creation, the
	`project_wp_category_makes` child table (both the "category with makes" and
	"category with no makes" branches), and the `project_work_header_entries`
	child table when milestone tracking is enabled.
	"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		# Resolve real fixtures so the helper's `frappe.db.exists` guards pass and
		# rows are actually appended (the helper silently skips unknown masters).
		cls.wp = _pick_existing("Procurement Packages")
		# A category whose work_package matches the chosen procurement package keeps
		# the payload realistic; the helper itself does not enforce that linkage.
		cls.cat_with_makes = _pick_existing("Category", work_package=cls.wp) or _pick_existing("Category")
		cls.cat_no_makes = (
			frappe.get_all(
				"Category",
				filters={"name": ["!=", cls.cat_with_makes]},
				pluck="name",
				limit=1,
			)
			or [cls.cat_with_makes]
		)[0]
		cls.make = _pick_existing("Makelist")
		cls.work_header = _pick_existing("Work Headers")

	def tearDown(self):
		# Clean up projects created by these tests.
		for name in frappe.get_all("Projects", filters={"project_city": POP_TEST_CITY}, pluck="name"):
			frappe.delete_doc("Projects", name, ignore_permissions=True, force=True)
		# Clean up Address docs created via the helper (titled by project_name).
		for name in frappe.get_all(
			"Address", filters={"address_title": ["like", "PopTest%"]}, pluck="name"
		):
			frappe.delete_doc("Address", name, ignore_permissions=True, force=True)
		frappe.db.commit()

	def _base_values(self, name_suffix, enable_milestones=False):
		return {
			"project_name": f"PopTest {name_suffix}",
			"customer": None,
			"project_type": None,
			"project_value": "1000",
			"project_value_gst": "1180",
			"carpet_area": "500",
			"project_gst": None,
			"project_start_date": "2025-01-01T00:00:00.000Z",
			"project_end_date": "2025-12-31T00:00:00.000Z",
			"project_city": POP_TEST_CITY,
			"project_state": "Test State",
			"address_line_1": "Line 1",
			"address_line_2": "Line 2",
			"pin": "560001",
			"email": "poptest@example.com",
			"phone": "9999999999",
			"project_scopes": {"scopes": []},
			"enable_project_milestone_tracking": enable_milestones,
			"project_work_packages": {
				"work_packages": [
					{
						"work_package_name": self.wp,
						"category_list": {
							"list": [
								# Branch A: category WITH makes
								{
									"name": self.cat_with_makes,
									"makes": [{"label": self.make, "value": self.make}],
								},
								# Branch B: category WITH NO makes
								{
									"name": self.cat_no_makes,
									"makes": [],
								},
							]
						},
					}
				]
			},
			"project_work_header_entries": [],
		}

	def _save_project(self, values, status="Won"):
		project_doc = frappe.new_doc("Projects")
		apply_full_project_details(project_doc, values)
		project_doc.status = status
		project_doc.save(ignore_permissions=True)
		frappe.db.commit()
		return project_doc

	def test_address_doc_created_with_expected_fields(self):
		"""The helper creates a linked Shipping Address with the payload's fields."""
		values = self._base_values("address")
		project_doc = self._save_project(values)

		self.assertTrue(project_doc.project_address)
		address = frappe.get_doc("Address", project_doc.project_address)
		self.assertEqual(address.address_title, values["project_name"])
		self.assertEqual(address.address_type, "Shipping")
		self.assertEqual(address.address_line1, "Line 1")
		self.assertEqual(address.address_line2, "Line 2")
		self.assertEqual(address.city, POP_TEST_CITY)
		self.assertEqual(address.state, "Test State")
		self.assertEqual(address.country, "India")
		self.assertEqual(address.pincode, "560001")
		self.assertEqual(address.email_id, "poptest@example.com")
		self.assertEqual(address.phone, "9999999999")
		# Status is the caller's responsibility; helper must not touch it.
		self.assertEqual(project_doc.status, "Won")

	def test_wp_category_makes_population_both_branches(self):
		"""
		`project_wp_category_makes` gets one row for the category WITH a make and
		one row (make=None) for the category WITH NO makes.
		"""
		values = self._base_values("wpcm")
		project_doc = self._save_project(values)

		rows = project_doc.project_wp_category_makes
		# 1 row for the make + 1 row for the no-makes category = 2 rows.
		self.assertEqual(len(rows), 2)

		# Branch A: category with makes -> a row carrying the make.
		with_make = [r for r in rows if r.category == self.cat_with_makes]
		self.assertEqual(len(with_make), 1)
		self.assertEqual(with_make[0].procurement_package, self.wp)
		self.assertEqual(with_make[0].make, self.make)

		# Branch B: category with no makes -> a row with make unset.
		no_make = [r for r in rows if r.category == self.cat_no_makes]
		self.assertEqual(len(no_make), 1)
		self.assertEqual(no_make[0].procurement_package, self.wp)
		self.assertFalse(no_make[0].make)

		# Legacy JSON field must be cleared by the helper.
		self.assertFalse(project_doc.project_work_packages)

	def test_work_header_entries_populated_when_tracking_enabled(self):
		"""When milestone tracking is enabled, enabled work headers become rows."""
		if not self.work_header:
			self.skipTest("No Work Headers fixture available in this site.")

		values = self._base_values("wh", enable_milestones=True)
		values["project_work_header_entries"] = [
			{"work_header_name": self.work_header, "enabled": True}
		]
		project_doc = self._save_project(values)

		self.assertTrue(project_doc.enable_project_milestone_tracking)
		entries = project_doc.project_work_header_entries
		self.assertEqual(len(entries), 1)
		self.assertEqual(entries[0].project_work_header_name, self.work_header)
		self.assertTrue(entries[0].enabled)

	def test_no_work_header_entries_when_tracking_disabled(self):
		"""With tracking disabled, no work-header rows are appended even if sent."""
		if not self.work_header:
			self.skipTest("No Work Headers fixture available in this site.")

		values = self._base_values("whoff", enable_milestones=False)
		values["project_work_header_entries"] = [
			{"work_header_name": self.work_header, "enabled": True}
		]
		project_doc = self._save_project(values)

		self.assertFalse(project_doc.enable_project_milestone_tracking)
		self.assertEqual(len(project_doc.project_work_header_entries), 0)


# =================================================================================== #
# Project Value / Project Value with GST
#
# Two modes, decided by `manual_project_value`:
#   0 (default) -> DERIVED: before_save sums the Customer PO child rows.
#   1           -> MANUAL:  a human typed both values; before_save leaves them alone,
#                           and validate refuses a blank/zero pair.
#
# Both fields are declared **Data** (varchar), so the DB hands them back as STRINGS
# while the recompute produces a FLOAT. Assigning unconditionally therefore made
# Frappe's version diff log a phantom "71100000.0 -> 71100000" change on EVERY save of
# EVERY derived project, whatever was actually edited. `_set_derived_value` assigns only
# when the NUMBER moved, which is what these suites pin — alongside the create / edit /
# mode-flip / Customer-PO-add-edit-delete paths that feed it.
# =================================================================================== #

VALUE_TEST_CITY = "ZzProjValueTestCity"


def _po_row(number, exctax, inctax, date="2025-01-01"):
	return {
		"customer_po_number": number,
		"customer_po_value_exctax": exctax,
		"customer_po_value_inctax": inctax,
		"customer_po_creation_date": date,
	}


def _unique_po_number(tag):
	"""PO numbers are checked for duplicates GLOBALLY by the add endpoint, and these
	suites run against the live site — so every fixture PO number must be unique."""
	return f"ZZPO-{tag}-{frappe.generate_hash(length=8)}"


def _new_project(suffix, po_rows=None, manual=False, value=None, value_gst=None):
	"""Insert a Projects fixture. `po_rows` are Customer PO child rows."""
	payload = {
		"doctype": "Projects",
		"project_name": f"ProjValueTest {suffix}",
		"project_city": VALUE_TEST_CITY,
		"project_state": "Test State",
		"project_start_date": "2025-01-01 00:00:00",
		"project_end_date": "2025-12-31 00:00:00",
		"project_scopes": {"scopes": []},
		"status": "WIP",
		"customer_po_details": po_rows or [],
	}
	if manual:
		payload["manual_project_value"] = 1
	if value is not None:
		payload["project_value"] = value
	if value_gst is not None:
		payload["project_value_gst"] = value_gst
	return frappe.get_doc(payload).insert(ignore_permissions=True)


def _values(project):
	"""The two fields as stored (STRINGS — the column is Data) plus their numbers."""
	row = frappe.db.get_value(
		"Projects", project, ["project_value", "project_value_gst"], as_dict=True
	)
	return row.project_value, row.project_value_gst


def _numbers(project):
	raw, raw_gst = _values(project)
	return flt(raw), flt(raw_gst)


def _changed_fields(project):
	"""Field names recorded in the MOST RECENT Version row for `project`."""
	import json

	rows = frappe.db.sql(
		'''SELECT data FROM "tabVersion"
		   WHERE ref_doctype = 'Projects' AND docname = %s
		   ORDER BY creation DESC LIMIT 1''',
		(project,),
	)
	if not rows:
		return set()
	return {c[0] for c in (json.loads(rows[0][0] or "{}").get("changed") or [])}


class _ProjectValueTestCase(FrappeTestCase):
	def tearDown(self):
		for name in frappe.get_all(
			"Projects", filters={"project_city": VALUE_TEST_CITY}, pluck="name"
		):
			frappe.delete_doc("Projects", name, ignore_permissions=True, force=True)
		frappe.db.commit()


# --- 1. Creation ------------------------------------------------------------------ #


class TestProjectValueOnCreate(_ProjectValueTestCase):
	def test_derived_from_a_single_customer_po(self):
		p = _new_project("create-one", [_po_row(_unique_po_number("c1"), 71100000, 83898000)])
		self.assertEqual(_numbers(p.name), (71100000.0, 83898000.0))

	def test_derived_sums_every_customer_po(self):
		p = _new_project(
			"create-many",
			[
				_po_row(_unique_po_number("c2a"), 1000000, 1180000),
				_po_row(_unique_po_number("c2b"), 2500000, 2950000),
				_po_row(_unique_po_number("c2c"), 400000, 472000),
			],
		)
		self.assertEqual(_numbers(p.name), (3900000.0, 4602000.0))

	def test_no_customer_po_rows_gives_zero(self):
		"""Historical behaviour, kept deliberately: no PO rows -> the value is 0, not blank."""
		p = _new_project("create-none")
		self.assertEqual(_numbers(p.name), (0.0, 0.0))
		raw, raw_gst = _values(p.name)
		self.assertIsNotNone(raw, "a derived project must be populated, never left NULL")
		self.assertIsNotNone(raw_gst)

	def test_manual_mode_keeps_the_typed_values(self):
		"""Manual mode must survive even when Customer PO rows disagree with it."""
		p = _new_project(
			"create-manual",
			[_po_row(_unique_po_number("c4"), 1000000, 1180000)],
			manual=True,
			value=5000000,
			value_gst=5900000,
		)
		self.assertEqual(
			_numbers(p.name),
			(5000000.0, 5900000.0),
			"the PO sum (1000000) must NOT overwrite a manually entered value",
		)

	def test_manual_mode_without_values_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			_new_project("create-manual-blank", manual=True)

	def test_manual_mode_with_only_one_value_is_rejected(self):
		"""Both halves are required — an ex-GST figure with no incl-GST twin is not a value."""
		with self.assertRaises(frappe.ValidationError):
			_new_project("create-manual-half", manual=True, value=5000000)
		with self.assertRaises(frappe.ValidationError):
			_new_project("create-manual-half2", manual=True, value_gst=5900000)

	def test_manual_mode_with_zero_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			_new_project("create-manual-zero", manual=True, value=0, value_gst=0)

	def test_decimal_amounts_are_exact(self):
		p = _new_project(
			"create-decimal",
			[
				_po_row(_unique_po_number("c8a"), 1234.56, 1456.78),
				_po_row(_unique_po_number("c8b"), 2345.67, 2767.89),
			],
		)
		value, value_gst = _numbers(p.name)
		self.assertAlmostEqual(value, 3580.23, places=2)
		self.assertAlmostEqual(value_gst, 4224.67, places=2)


# --- 2. Editing + mode flips ------------------------------------------------------- #


class TestProjectValueOnEdit(_ProjectValueTestCase):
	def test_unrelated_edit_leaves_the_values_untouched(self):
		p = _new_project("edit-unrelated", [_po_row(_unique_po_number("e1"), 71100000, 83898000)])
		before = _values(p.name)

		doc = frappe.get_doc("Projects", p.name)
		doc.project_state = "Edited State"
		doc.save(ignore_permissions=True)

		self.assertEqual(_values(p.name), before, "not even the stored STRING may change")

	def test_repeated_saves_do_not_drift(self):
		"""Float repr round-trips, so ten saves must not walk the stored value."""
		p = _new_project("edit-drift", [_po_row(_unique_po_number("e2"), 1234.56, 1456.78)])
		before = _values(p.name)

		for i in range(10):
			doc = frappe.get_doc("Projects", p.name)
			doc.project_state = f"State {i}"
			doc.save(ignore_permissions=True)

		self.assertEqual(_values(p.name), before)

	def test_switching_derived_to_manual_keeps_the_typed_values(self):
		p = _new_project("edit-to-manual", [_po_row(_unique_po_number("e3"), 1000000, 1180000)])

		doc = frappe.get_doc("Projects", p.name)
		doc.manual_project_value = 1
		doc.project_value = 7777777
		doc.project_value_gst = 9177777
		doc.save(ignore_permissions=True)

		self.assertEqual(_numbers(p.name), (7777777.0, 9177777.0))

	def test_switching_manual_back_to_derived_recomputes_from_pos(self):
		p = _new_project(
			"edit-to-derived",
			[_po_row(_unique_po_number("e4"), 1000000, 1180000)],
			manual=True,
			value=7777777,
			value_gst=9177777,
		)
		self.assertEqual(_numbers(p.name), (7777777.0, 9177777.0))

		doc = frappe.get_doc("Projects", p.name)
		doc.manual_project_value = 0
		doc.save(ignore_permissions=True)

		self.assertEqual(
			_numbers(p.name), (1000000.0, 1180000.0), "leaving manual mode re-derives from the POs"
		)

	def test_editing_a_manual_value_is_saved(self):
		p = _new_project("edit-manual", manual=True, value=5000000, value_gst=5900000)

		doc = frappe.get_doc("Projects", p.name)
		doc.project_value = 6000000
		doc.project_value_gst = 7080000
		doc.save(ignore_permissions=True)

		self.assertEqual(_numbers(p.name), (6000000.0, 7080000.0))

	def test_blanking_a_manual_value_is_rejected(self):
		p = _new_project("edit-manual-blank", manual=True, value=5000000, value_gst=5900000)

		doc = frappe.get_doc("Projects", p.name)
		doc.project_value = 0
		with self.assertRaises(frappe.ValidationError):
			doc.save(ignore_permissions=True)

		self.assertEqual(_numbers(p.name), (5000000.0, 5900000.0), "the rejected save changed nothing")

	def test_a_stale_value_is_repaired_by_the_next_save(self):
		"""The skip is numeric, not blanket: a value that disagrees with the POs is fixed."""
		p = _new_project("edit-repair", [_po_row(_unique_po_number("e7"), 1000000, 1180000)])
		frappe.db.set_value(
			"Projects", p.name, {"project_value": "999", "project_value_gst": "999"},
			update_modified=False,
		)

		doc = frappe.get_doc("Projects", p.name)
		doc.project_state = "Nudge"
		doc.save(ignore_permissions=True)

		self.assertEqual(_numbers(p.name), (1000000.0, 1180000.0))


# --- 3. Customer PO add / edit / delete (through the real endpoints) ---------------- #


class TestProjectValueOnCustomerPoChanges(_ProjectValueTestCase):
	def test_adding_a_po_raises_both_values(self):
		p = _new_project("po-add", [_po_row(_unique_po_number("p1a"), 1000000, 1180000)])

		add_customer_po_with_validation(
			p.name, _po_row(_unique_po_number("p1b"), 500000, 590000)
		)

		self.assertEqual(_numbers(p.name), (1500000.0, 1770000.0))

	def test_adding_the_first_po_replaces_the_zero(self):
		p = _new_project("po-add-first")
		self.assertEqual(_numbers(p.name), (0.0, 0.0))

		add_customer_po_with_validation(
			p.name, _po_row(_unique_po_number("p2"), 2000000, 2360000)
		)

		self.assertEqual(_numbers(p.name), (2000000.0, 2360000.0))

	def test_a_duplicate_po_number_is_refused_and_changes_nothing(self):
		number = _unique_po_number("p3")
		p = _new_project("po-add-dup", [_po_row(number, 1000000, 1180000)])

		result = add_customer_po_with_validation(p.name, _po_row(number, 500000, 590000))

		self.assertEqual(result.get("status"), "Duplicate")
		self.assertEqual(_numbers(p.name), (1000000.0, 1180000.0))

	def test_adding_a_po_to_a_manual_project_leaves_the_value_alone(self):
		p = _new_project(
			"po-add-manual", manual=True, value=5000000, value_gst=5900000
		)

		add_customer_po_with_validation(
			p.name, _po_row(_unique_po_number("p4"), 1000000, 1180000)
		)

		self.assertEqual(
			_numbers(p.name), (5000000.0, 5900000.0), "manual mode records the PO but keeps the value"
		)
		self.assertEqual(len(frappe.get_doc("Projects", p.name).customer_po_details), 1)

	def test_override_manual_value_switches_the_project_to_po_driven(self):
		p = _new_project("po-add-override", manual=True, value=5000000, value_gst=5900000)

		add_customer_po_with_validation(
			p.name, _po_row(_unique_po_number("p5"), 1000000, 1180000), override_manual_value=1
		)

		self.assertEqual(frappe.db.get_value("Projects", p.name, "manual_project_value"), 0)
		self.assertEqual(_numbers(p.name), (1000000.0, 1180000.0))

	def test_editing_a_po_amount_updates_both_values(self):
		p = _new_project("po-edit", [_po_row(_unique_po_number("p6"), 1000000, 1180000)])
		row = frappe.get_doc("Projects", p.name).customer_po_details[0]

		update_customer_po_with_validation(
			p.name,
			{
				"name": row.name,
				"customer_po_number": row.customer_po_number,
				"customer_po_value_exctax": 3000000,
				"customer_po_value_inctax": 3540000,
				"customer_po_creation_date": "2025-01-01",
			},
		)

		self.assertEqual(_numbers(p.name), (3000000.0, 3540000.0))

	def test_deleting_a_po_lowers_both_values(self):
		p = _new_project(
			"po-delete",
			[
				_po_row(_unique_po_number("p7a"), 1000000, 1180000),
				_po_row(_unique_po_number("p7b"), 500000, 590000),
			],
		)
		row = frappe.get_doc("Projects", p.name).customer_po_details[0]

		delete_customer_po(p.name, row.name)

		self.assertEqual(_numbers(p.name), (500000.0, 590000.0))

	def test_deleting_the_last_po_zeroes_the_values(self):
		p = _new_project("po-delete-last", [_po_row(_unique_po_number("p8"), 1000000, 1180000)])
		row = frappe.get_doc("Projects", p.name).customer_po_details[0]

		delete_customer_po(p.name, row.name)

		self.assertEqual(_numbers(p.name), (0.0, 0.0))


# --- 4. The audit trail (the phantom-diff fix) -------------------------------------- #


class TestProjectValueAuditTrail(_ProjectValueTestCase):
	"""`_set_derived_value` exists so the Version log stops claiming a change that never
	happened. `ignore_version` defaults to `frappe.flags.in_test`, so every save whose
	diff is inspected here MUST pass `ignore_version=False` — otherwise no Version row is
	written at all and these assertions pass vacuously.
	"""

	def test_an_unrelated_save_logs_no_project_value_change(self):
		p = _new_project("audit-phantom", [_po_row(_unique_po_number("a1"), 71100000, 83898000)])
		frappe.db.commit()

		doc = frappe.get_doc("Projects", p.name)
		doc.project_state = "Edited State"
		doc.save(ignore_permissions=True, ignore_version=False)
		frappe.db.commit()

		changed = _changed_fields(p.name)
		self.assertIn("project_state", changed, "the real edit must still be recorded")
		self.assertNotIn("project_value", changed)
		self.assertNotIn("project_value_gst", changed)

	def test_a_status_change_logs_only_the_status(self):
		"""The shape the CEO Hold flow hits: a status-only save must read as status-only."""
		p = _new_project("audit-status", [_po_row(_unique_po_number("a2"), 71100000, 83898000)])
		frappe.db.commit()

		doc = frappe.get_doc("Projects", p.name)
		doc.status = "Handover"
		doc.save(ignore_permissions=True, ignore_version=False)
		frappe.db.commit()

		changed = _changed_fields(p.name)
		self.assertIn("status", changed)
		self.assertNotIn("project_value", changed)
		self.assertNotIn("project_value_gst", changed)

	def test_a_real_po_change_is_still_logged(self):
		p = _new_project("audit-real", [_po_row(_unique_po_number("a3"), 71100000, 83898000)])
		frappe.db.commit()

		doc = frappe.get_doc("Projects", p.name)
		doc.customer_po_details[0].customer_po_value_exctax = 80000000
		doc.save(ignore_permissions=True, ignore_version=False)
		frappe.db.commit()

		changed = _changed_fields(p.name)
		self.assertEqual(flt(frappe.db.get_value("Projects", p.name, "project_value")), 80000000.0)
		self.assertIn("project_value", changed)
		self.assertNotIn(
			"project_value_gst", changed, "the untouched twin must stay out of the log"
		)

	def test_a_manual_value_edit_is_still_logged(self):
		p = _new_project("audit-manual", manual=True, value=5000000, value_gst=5900000)
		frappe.db.commit()

		doc = frappe.get_doc("Projects", p.name)
		doc.project_value = 6000000
		doc.save(ignore_permissions=True, ignore_version=False)
		frappe.db.commit()

		self.assertIn("project_value", _changed_fields(p.name))
