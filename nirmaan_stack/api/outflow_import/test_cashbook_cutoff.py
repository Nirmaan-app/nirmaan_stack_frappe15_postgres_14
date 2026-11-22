# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Statement lines dated before 1 Apr 2026 are left out, counted on the preview and kept on the import (#1707).

The upload seam, driven as `test_cashbook_import.TestRepeatsAreNotSaved` drives it: the real preview endpoint, the
staging `confirm_cashbook_import` calls (a real confirm would enqueue the worker), and a refused confirm through the
real endpoint, which throws before anything is written. The plan's own rule is in
`services/outflow_import/test_cashbook_cutoff`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.review import list_imports
from nirmaan_stack.api.outflow_import import test_cashbook_import as cashbook_import_tests
from nirmaan_stack.api.outflow_import.test_cashbook_import import FIXTURE
from nirmaan_stack.services.outflow_import.parser import parse_statement

# The fixture's first two lines are Wallet Spends of 1 Aug 2026; the tests move them to 31 Mar 2026.
MARCH = '"31/03/2026"'
AUGUST_1 = '"01/08/2026"'
ONLY_MARCH_MESSAGE = (
    "Not imported. All {n} lines in 'cashbook.xlsx' are dated before 1 Apr 2026, and the Cashbook import leaves "
    "those out. Nothing was created."
)


def _counts():
    return tuple(frappe.db.count(doctype) for doctype in ("File", "Outflow Import Batch", "Outflow Import Row"))


class TestTheUploadLeavesOutEarlierLines(FrappeTestCase):
    def setUp(self):
        super().setUp()
        lines = FIXTURE.read_text().splitlines()
        self.header, self.data, self.footer = lines[0], lines[1:12], lines[12:]
        self.march_ids = [line.split('","')[15] for line in self.data[:2]]
        self.mixed = self._file([line.replace(AUGUST_1, MARCH, 1) for line in self.data[:2]] + self.data[2:])
        self.only_new = self._file(self.data[2:])

    # The same helpers `TestRepeatsAreNotSaved` drives the endpoints with.
    _file = cashbook_import_tests.TestRepeatsAreNotSaved._file
    _post = cashbook_import_tests.TestRepeatsAreNotSaved._post
    _stage = cashbook_import_tests.TestRepeatsAreNotSaved._stage

    def test_the_preview_counts_the_earlier_lines_and_creates_only_the_rest(self):
        mixed = self._post(cb.preview_cashbook_statement, self.mixed)
        only_new = self._post(cb.preview_cashbook_statement, self.only_new)
        self.assertEqual(mixed["before_cutoff"], 2)
        self.assertEqual(mixed["before_cutoff_note"], "2 lines before 1 Apr 2026 left out")
        self.assertEqual(mixed["creating"], only_new["creating"])
        self.assertEqual(mixed["total_value"], only_new["total_value"])
        listed = [row["transfer_id"] for group in mixed["groups"] for row in group["rows"]]
        listed += [row["transfer_id"] for row in mixed["skipped"]]
        self.assertFalse(set(self.march_ids) & set(listed))
        self.assertFalse(mixed["refused"])

    def test_the_import_keeps_the_count_and_stores_no_earlier_line(self):
        batch = self._stage(self.mixed)
        self.assertEqual(frappe.db.get_value("Outflow Import Batch", batch, "lines_before_cutoff"), 2)
        stored = frappe.get_all("Outflow Import Row", filters={"import_batch": batch}, pluck="transfer_id")
        self.assertFalse(set(self.march_ids) & set(stored))
        self.assertEqual(len(stored), len(parse_statement(self.only_new, source="Cashbook").rows))

    def test_the_import_list_reads_the_count_and_its_note(self):
        batch = self._stage(self.mixed)
        (listed,) = [row for row in list_imports(sources='["Cashbook"]', month="2026-08") if row["name"] == batch]
        self.assertEqual(listed["lines_before_cutoff"], 2)
        self.assertEqual(listed["before_cutoff_note"], "2 lines before 1 Apr 2026 left out")

    def test_a_statement_of_only_earlier_lines_is_refused_and_says_why(self):
        only_march = self._file([line.replace(AUGUST_1, MARCH, 1) for line in self.data[:2]])
        message = ONLY_MARCH_MESSAGE.format(n=2)

        preview = self._post(cb.preview_cashbook_statement, only_march)
        self.assertEqual((preview["refused"], preview["creating"]), (True, 0))
        self.assertEqual(preview["before_cutoff_message"], message)

        before = _counts()
        with self.assertRaises(frappe.ValidationError) as caught:
            self._post(cb.confirm_cashbook_import, only_march)
        self.assertEqual(str(caught.exception), message)
        self.assertEqual(_counts(), before)

    # #1715, owner decision 1 (2026-11-19): the import period starts and ends at kept lines. The mixed file's lines
    # run 31 Mar to 4 Aug 2026; its kept lines run 2 Aug to 4 Aug.
    def test_the_preview_shows_the_period_of_the_kept_lines(self):
        mixed = self._post(cb.preview_cashbook_statement, self.mixed)
        self.assertEqual((mixed["period_from"], mixed["period_to"]), ("2026-08-02", "2026-08-04"))

    def test_the_import_stores_the_period_of_the_kept_lines(self):
        batch = self._stage(self.mixed)
        period = frappe.db.get_value("Outflow Import Batch", batch, ["period_from", "period_to"])
        self.assertEqual(tuple(str(day) for day in period), ("2026-08-02", "2026-08-04"))

    def test_the_preview_says_or_with_no_date_when_a_line_has_none(self):
        """Owner, 2026-11-18 (#1707): an undated line is left out, and the preview's note says so. The confirm result
        already did; the preview missed it (owner, 2026-11-19)."""
        undated = self._file([self.data[0].replace(AUGUST_1, '""', 1)] + self.data[2:])
        preview = self._post(cb.preview_cashbook_statement, undated)
        self.assertEqual(preview["before_cutoff_note"], "1 line before 1 Apr 2026 or with no date left out")
