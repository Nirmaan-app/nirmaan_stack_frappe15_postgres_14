# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

_TEST_PROJECT = "_TEST_BOQ_PROJECT_CGS"


class TestBoQCommittedGeneralSpecs(FrappeTestCase):
    """
    Tests for the committed general-specs faithful-grid doctype (Phase 5 Slice 1).

    BoQ Committed General Specs is a STANDALONE top-level doctype (istable=0) that
    Links UP to BOQs, carries the per-sheet commit-version dimension
    (commit_version + is_current), and holds ONE child table (`rows` -> BoQ
    Committed General Specs Row) of faithful, arbitrary-width cell rows.

    This slice is SCHEMA ONLY -- the one-current-version-per-sheet invariant and
    every write to this doctype are the Phase-5 commit pipeline's job (Slice 3).
    These tests therefore assert persistence / round-trip / defaults ONLY, with
    NO enforcement.

    A shared parent BOQs row is created in setUpClass (committed); the committed
    general-specs inserts inside each test are NOT committed, so FrappeTestCase's
    tearDown rollback cleans them up.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT
        boq.boq_name = "Shared Test BoQ for Committed General Specs"
        boq.insert(ignore_permissions=True, ignore_links=True)
        cls.boq_name = boq.name
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "boq_name"):
            frappe.db.delete("BoQ Committed General Specs", {"boq": cls.boq_name})
            frappe.db.delete("BOQs", {"name": cls.boq_name})
        frappe.db.commit()
        super().tearDownClass()

    # ------------------------------------------------------------------ #
    # Helper                                                             #
    # ------------------------------------------------------------------ #

    def _make_doc(self, source_sheet_name="General Specs", rows=None, **kwargs):
        doc = frappe.new_doc("BoQ Committed General Specs")
        doc.boq = self.boq_name
        doc.source_sheet_name = source_sheet_name
        for k, v in kwargs.items():
            setattr(doc, k, v)
        for r in rows or []:
            doc.append("rows", r)
        doc.insert(ignore_permissions=True)
        return doc

    # ------------------------------------------------------------------ #
    # T1. arbitrary-width child rows round-trip faithfully               #
    # ------------------------------------------------------------------ #

    def test_arbitrary_width_rows_round_trip(self):
        rows = [
            {"row_number": 1, "row_order": 0, "cells": {"A": "Item", "B": "Qty", "C": "Unit"}},
            {"row_number": 2, "row_order": 1, "cells": {"A": "Cement", "B": 50}},
            {"row_number": 3, "row_order": 2,
             "cells": {"A": "Sand", "B": 12, "C": "cum", "D": 1500, "E": "remark"}},
        ]
        doc = self._make_doc(source_sheet_name="SOW", rows=rows)
        self.assertTrue(doc.name.startswith("BCGS-"),
                        f"autoname should start with 'BCGS-', got {doc.name!r}")

        reloaded = frappe.get_doc("BoQ Committed General Specs", doc.name)
        self.assertEqual(len(reloaded.rows), 3)

        by_num = {r.row_number: r for r in reloaded.rows}
        # widths preserved exactly (3 / 2 / 5 columns), keys + values intact
        self.assertEqual(by_num[1].cells, {"A": "Item", "B": "Qty", "C": "Unit"})
        self.assertEqual(by_num[2].cells, {"A": "Cement", "B": 50})
        self.assertEqual(by_num[3].cells,
                         {"A": "Sand", "B": 12, "C": "cum", "D": 1500, "E": "remark"})
        self.assertEqual(len(by_num[2].cells), 2)
        self.assertEqual(len(by_num[3].cells), 5)

    # ------------------------------------------------------------------ #
    # T2. row_number + row_order persist; ordering recoverable           #
    # ------------------------------------------------------------------ #

    def test_row_number_and_order_persist_and_ordering_recoverable(self):
        # sparse, deliberately out-of-sequence row_numbers; row_order is the sort key
        rows = [
            {"row_number": 7, "row_order": 2, "cells": {"A": "third"}},
            {"row_number": 3, "row_order": 0, "cells": {"A": "first"}},
            {"row_number": 5, "row_order": 1, "cells": {"A": "second"}},
        ]
        doc = self._make_doc(source_sheet_name="Notes", rows=rows)
        reloaded = frappe.get_doc("BoQ Committed General Specs", doc.name)

        ordered = sorted(reloaded.rows, key=lambda r: r.row_order)
        self.assertEqual([r.row_number for r in ordered], [3, 5, 7])
        self.assertEqual([r.cells["A"] for r in ordered], ["first", "second", "third"])

    # ------------------------------------------------------------------ #
    # T3. version fields default correctly + are settable (no enforcement)#
    # ------------------------------------------------------------------ #

    def test_version_fields_default_and_settable(self):
        # defaults: commit_version=1, is_current=1
        doc1 = self._make_doc(source_sheet_name="V1 defaults")
        reloaded1 = frappe.get_doc("BoQ Committed General Specs", doc1.name)
        self.assertEqual(reloaded1.commit_version, 1)
        self.assertEqual(reloaded1.is_current, 1)

        # settable to a superseded version with is_current=0 (schema-level only;
        # Slice 1 does NOT enforce one-current -- two is_current=1 docs would also
        # save, which is deferred to the Slice-3 pipeline by design)
        doc2 = self._make_doc(source_sheet_name="V2 superseded",
                              commit_version=2, is_current=0)
        reloaded2 = frappe.get_doc("BoQ Committed General Specs", doc2.name)
        self.assertEqual(reloaded2.commit_version, 2)
        self.assertEqual(reloaded2.is_current, 0)

    # ------------------------------------------------------------------ #
    # T4. #152 -- source_sheet_name trailing space persists VERBATIM     #
    # ------------------------------------------------------------------ #

    def test_source_sheet_name_trailing_space_verbatim(self):
        name_with_space = "Electrical "  # trailing space is intentional (#152)
        doc = self._make_doc(source_sheet_name=name_with_space)
        reloaded = frappe.get_doc("BoQ Committed General Specs", doc.name)
        self.assertEqual(reloaded.source_sheet_name, name_with_space)
        self.assertTrue(reloaded.source_sheet_name.endswith(" "),
                        "trailing space must NOT be stripped (#152)")
