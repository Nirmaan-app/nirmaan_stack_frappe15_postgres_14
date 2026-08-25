# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Guards the migrate-wipe trap.

⚠️ THE BUG THIS EXISTS TO PREVENT, which happened for real on 2026-08-18:

`Expense Type` is listed in `hooks.py` `fixtures`, so EVERY `bench migrate` re-imports each
row from `fixtures/expense_type.json`. Frappe writes the row as the file describes it — so
any field the file does NOT carry is reset to null. When `source_format` and
`expense_category` were added to the doctype and the fixture was not regenerated, one migrate
silently destroyed all 40 request forms and every category assignment. Nothing errored.

The failure mode is the dangerous kind: invisible, delayed to deploy time, and it looks like
data loss rather than a code defect.

So: for every fixture-backed doctype in this feature, the fixture file must carry every
persisted field the doctype declares. Add a field, regenerate the fixture:

    bench --site <site> export-fixtures --app nirmaan_stack

Run:
  bench --site localhost run-tests --app nirmaan_stack \
    --module nirmaan_stack.api.expense_requests.test_fixture_completeness
"""

import json
import os

import frappe
from frappe.tests.utils import FrappeTestCase

# Fieldtypes that hold no value of their own, so a fixture legitimately omits them.
LAYOUT_FIELDTYPES = {
	"Section Break", "Column Break", "Tab Break", "HTML", "Heading", "Button", "Fold",
}

FIXTURE_DOCTYPES = ["Expense Type", "Expense Category"]


def _fixture_path(doctype: str) -> str:
	app = frappe.get_app_path("nirmaan_stack")
	return os.path.join(app, "fixtures", frappe.scrub(doctype) + ".json")


class TestFixtureCompleteness(FrappeTestCase):
	def test_these_doctypes_are_actually_fixtures(self):
		"""If a doctype stops being a fixture this guard is moot — fail loudly, don't pass
		silently on a premise that no longer holds."""
		fixtures = frappe.get_hooks("fixtures") or []
		listed = {f if isinstance(f, str) else f.get("dt") for f in fixtures}
		for dt in FIXTURE_DOCTYPES:
			self.assertIn(dt, listed,
			              f"{dt} is no longer a fixture — delete or rewrite this guard.")

	def test_fixture_carries_every_field_the_doctype_declares(self):
		for dt in FIXTURE_DOCTYPES:
			with self.subTest(doctype=dt):
				path = _fixture_path(dt)
				self.assertTrue(os.path.exists(path), f"missing fixture file: {path}")
				rows = json.load(open(path))
				self.assertTrue(rows, f"{dt} fixture is empty")

				declared = {
					f.fieldname for f in frappe.get_meta(dt).fields
					if f.fieldtype not in LAYOUT_FIELDTYPES
				}
				# A field is covered if ANY row carries the key -- a row may legitimately omit
				# it when the value is null, but the exporter must know the field exists.
				present = {k for r in rows for k in r.keys()}
				missing = declared - present
				self.assertFalse(
					missing,
					f"\n{dt}: the fixture does not carry {sorted(missing)}.\n"
					f"EVERY `bench migrate` will reset {'it' if len(missing) == 1 else 'them'} "
					f"to null on all {len(rows)} rows.\n"
					f"Fix: bench --site <site> export-fixtures --app nirmaan_stack",
				)

	def test_the_shipped_formats_are_in_the_fixture_not_only_the_database(self):
		"""A format that exists only in the DB is one migrate away from gone."""
		rows = json.load(open(_fixture_path("Expense Type")))
		with_format = [r["name"] for r in rows if (r.get("source_format") or "").strip()]
		self.assertTrue(
			with_format,
			"No format is in the fixture. Either none is authored, or someone authored one in "
			"the app and did not run export-fixtures — in which case the next migrate drops it.",
		)
		# And what the file claims must match what the database actually serves.
		for name in with_format:
			live = frappe.db.get_value("Expense Type", name, "source_format")
			self.assertTrue(live, f"{name}: fixture carries a format but the database has none")

	def test_every_categorised_type_points_at_a_category_that_ships(self):
		"""A Link whose target is not in the fixtures dangles on a fixture-seeded site."""
		types = json.load(open(_fixture_path("Expense Type")))
		cats = {r["name"] for r in json.load(open(_fixture_path("Expense Category")))}
		for r in types:
			c = r.get("expense_category")
			if c:
				self.assertIn(c, cats, f"{r['name']} -> category '{c}' is not in the fixtures")
