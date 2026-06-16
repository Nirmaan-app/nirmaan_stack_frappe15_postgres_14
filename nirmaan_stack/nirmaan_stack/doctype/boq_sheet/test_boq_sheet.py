# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import json

import frappe
from frappe.tests.utils import FrappeTestCase

_TEST_PROJECT = "_TEST_BOQ_PROJECT_SHEET"


class TestBoQSheet(FrappeTestCase):
    """
    Tests for the committed BoQ Sheet doctype (Phase 4 P4-1 sheet tier).

    BoQ Sheet is a STANDALONE top-level doctype (istable=0) that Links UP to
    BOQs and carries the full render config plus a sheet->many work-header set
    (reusing the existing "BoQ Sheet Work Package" child).

    A shared parent BOQs row and two shared Work Headers are created in
    setUpClass (committed); BoQ Sheet inserts inside each test are NOT
    committed, so FrappeTestCase's tearDown rollback cleans them up.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT
        boq.boq_name = "Shared Test BoQ for Sheet"
        boq.insert(ignore_permissions=True, ignore_links=True)
        cls.boq_name = boq.name

        # Two real Work Headers so the child Link (reqd) resolves cleanly.
        cls.wh_names = []
        for label in ("_TEST_WH_SHEET_ALPHA", "_TEST_WH_SHEET_BETA"):
            if not frappe.db.exists("Work Headers", label):
                wh = frappe.new_doc("Work Headers")
                wh.work_header_name = label
                wh.insert(ignore_permissions=True)
            cls.wh_names.append(label)

        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "boq_name"):
            frappe.db.delete("BoQ Sheet", {"boq": cls.boq_name})
            frappe.db.delete("BOQs", {"name": cls.boq_name})
        for label in getattr(cls, "wh_names", []):
            frappe.db.delete("Work Headers", {"name": label})
        frappe.db.commit()
        super().tearDownClass()

    # ------------------------------------------------------------------ #
    # Helper                                                             #
    # ------------------------------------------------------------------ #

    def _make_sheet(self, sheet_name="Sheet 1", sheet_order=1, **kwargs):
        sheet = frappe.new_doc("BoQ Sheet")
        sheet.boq = self.boq_name
        sheet.sheet_name = sheet_name
        sheet.sheet_order = sheet_order
        for k, v in kwargs.items():
            setattr(sheet, k, v)
        sheet.insert(ignore_permissions=True)
        return sheet

    # ------------------------------------------------------------------ #
    # 1. Creation + autoname                                             #
    # ------------------------------------------------------------------ #

    def test_create_with_link_and_autoname(self):
        sheet = self._make_sheet(sheet_name="VRF System", sheet_order=3)
        self.assertIsNotNone(sheet.name)
        self.assertTrue(
            sheet.name.startswith("BQSH-"),
            f"autoname should start with 'BQSH-', got {sheet.name!r}",
        )
        self.assertEqual(sheet.boq, self.boq_name)
        self.assertEqual(sheet.sheet_name, "VRF System")
        self.assertEqual(sheet.sheet_order, 3)

    # ------------------------------------------------------------------ #
    # 2. sheet -> many work headers                                      #
    # ------------------------------------------------------------------ #

    def test_work_packages_accepts_multiple_work_headers(self):
        sheet = frappe.new_doc("BoQ Sheet")
        sheet.boq = self.boq_name
        sheet.sheet_name = "HVAC"
        sheet.sheet_order = 5
        for wh in self.wh_names:
            sheet.append("work_packages", {"work_header": wh})
        sheet.insert(ignore_permissions=True)

        reloaded = frappe.get_doc("BoQ Sheet", sheet.name)
        linked = sorted(r.work_header for r in reloaded.work_packages)
        self.assertEqual(linked, sorted(self.wh_names))
        self.assertEqual(len(reloaded.work_packages), 2)

    # ------------------------------------------------------------------ #
    # 3. JSON fields round-trip (incl. retired role token, opaque)       #
    # ------------------------------------------------------------------ #

    def test_json_fields_round_trip_with_retired_token(self):
        role_map = {
            "A": {"role": "sl_no", "area": None},
            "C": {"role": "description", "area": None},
            # retired token from legacy data — must be stored OPAQUELY, not rejected
            "G": {"role": "amount_by_area", "area": "Phase 1"},
        }
        headers = {"A": "Sl. No.", "C": "Description"}
        dims = ["Phase 1", "Phase 2"]

        # dict-type JSON fields (column_role_map / column_headers) pass as Python
        # dicts; list-type JSON values must be json.dumps()'d before insert
        # (Frappe's get_valid_dict rejects a raw list) -- mirrors _LIST_JSON_FIELDS.
        sheet = self._make_sheet(
            sheet_name="Washroom",
            sheet_order=2,
            column_role_map=role_map,
            column_headers=headers,
            area_dimensions=json.dumps(dims),
        )

        reloaded = frappe.get_doc("BoQ Sheet", sheet.name)
        self.assertEqual(reloaded.column_role_map, role_map)
        self.assertEqual(reloaded.column_headers, headers)
        self.assertEqual(reloaded.area_dimensions, dims)
        # explicit proof the retired token survived untouched
        self.assertEqual(reloaded.column_role_map["G"]["role"], "amount_by_area")

    # ------------------------------------------------------------------ #
    # 4. render-config fields persist + read-only last_parsed_at         #
    # ------------------------------------------------------------------ #

    def test_render_config_and_last_parsed_at_persist(self):
        stamp = frappe.utils.now()
        sheet = self._make_sheet(
            sheet_name="SUMMARY-HVAC",
            sheet_order=1,
            treat_as="master_preamble",
            header_row=10,
            header_row_count=2,
            last_parsed_at=stamp,
        )

        reloaded = frappe.get_doc("BoQ Sheet", sheet.name)
        self.assertEqual(reloaded.treat_as, "master_preamble")
        self.assertEqual(reloaded.header_row, 10)
        self.assertEqual(reloaded.header_row_count, 2)
        self.assertIsNotNone(reloaded.last_parsed_at)

    def test_treat_as_defaults_to_data(self):
        sheet = self._make_sheet(sheet_name="Default Treat", sheet_order=4)
        reloaded = frappe.get_doc("BoQ Sheet", sheet.name)
        self.assertEqual(reloaded.treat_as, "data")
        self.assertEqual(reloaded.header_row_count, 1)
