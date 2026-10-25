# Copyright (c) 2026, Abhishek and Contributors
# See license.txt

"""
Integration tests for `api/projects/convert_boq_options.get_convert_boq_options`,
the read behind the convert wizard's "BOQ" step.

Fixtures are real rows on a marker-city Tendering stub. `create_tendering_project`
commits, so everything is removed explicitly in `tearDownClass` (these suites run
against the live site DB). BoQ-side rows are deleted with raw deletes: a
`delete_doc` on BOQs writes a Nirmaan Versions snapshot that would outlive the test.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.projects.convert_boq_options import get_convert_boq_options
from nirmaan_stack.api.projects.tendering import create_tendering_project

BOQ_OPTIONS_TEST_CITY = "ZzBoqOptTestCity"


class TestGetConvertBoqOptions(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        mapped = frappe.get_all(
            "Work Headers",
            filters={"work_package_link": ["is", "set"]},
            fields=["name", "work_package_link"],
            order_by="name asc",
            limit=2,
        )
        cls.mapped_header = mapped[0].name
        cls.mapped_package = mapped[0].work_package_link
        # A second mapped header, used only on a NON-current sheet.
        cls.stale_header = mapped[1].name if len(mapped) > 1 else None
        unmapped = frappe.get_all(
            "Work Headers", filters={"work_package_link": ["is", "not set"]}, pluck="name", limit=1
        )
        cls.unmapped_header = unmapped[0] if unmapped else None

        res = create_tendering_project(
            project_name="BoqOptTest stub",
            project_state="Test State",
            project_city=BOQ_OPTIONS_TEST_CITY,
        )
        cls.project = res["project_name"]

        cls.elec_v1 = cls._boq("Electrical")
        cls.elec_v2 = cls._boq("Electrical")
        cls.hvac = cls._boq("HVAC")
        cls.gone = cls._boq("Old")
        frappe.db.set_value("BOQs", cls.gone, "status", "Superseded")

        headers = [cls.mapped_header] + ([cls.unmapped_header] if cls.unmapped_header else [])
        cls._sheet(cls.elec_v2, "Sheet A", headers, is_current=1)
        cls._sheet(cls.elec_v2, "Sheet B", [cls.mapped_header], is_current=1)
        if cls.stale_header:
            cls._sheet(cls.elec_v2, "Sheet A", [cls.stale_header], is_current=0)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        # Roll back first: a poisoned transaction would make every delete below raise. Then each
        # scope in its own try, committed on its own, so one failure never strands the rest --
        # and failures are reported, not swallowed (CODING_STANDARDS, Writing tests).
        frappe.db.rollback()
        problems = []

        def scope(label, purge):
            try:
                purge()
                frappe.db.commit()
            except Exception as exc:  # report every failed scope, keep purging the others
                frappe.db.rollback()
                problems.append(f"{label}: {exc}")

        boqs = frappe.get_all("BOQs", filters={"project": cls.project}, pluck="name") if cls.project else []
        sheets = frappe.get_all("BoQ Sheet", filters={"boq": ["in", boqs]}, pluck="name") if boqs else []
        if sheets:
            scope("sheet work packages", lambda: frappe.db.delete("BoQ Sheet Work Package", {"parent": ["in", sheets]}))
            scope("sheets", lambda: frappe.db.delete("BoQ Sheet", {"name": ["in", sheets]}))
        if boqs:
            scope("BoQs", lambda: frappe.db.delete("BOQs", {"name": ["in", boqs]}))
        for name in frappe.get_all(
            "Projects", filters={"project_city": BOQ_OPTIONS_TEST_CITY}, pluck="name"
        ):
            scope(f"project {name}", lambda name=name: frappe.delete_doc(
                "Projects", name, ignore_permissions=True, force=True
            ))
        super().tearDownClass()
        if problems:
            raise AssertionError("test_convert_boq_options clean-up failed: " + "; ".join(problems))

    @classmethod
    def _boq(cls, boq_name):
        boq = frappe.new_doc("BOQs")
        boq.project = cls.project
        boq.boq_name = boq_name
        boq.insert(ignore_permissions=True)
        return boq.name

    @classmethod
    def _sheet(cls, boq, sheet_name, headers, is_current):
        sheet = frappe.new_doc("BoQ Sheet")
        sheet.boq = boq
        sheet.sheet_name = sheet_name
        sheet.sheet_order = 1
        sheet.is_current = is_current
        for header in headers:
            sheet.append("work_packages", {"work_header": header})
        sheet.insert(ignore_permissions=True)

    def _options(self):
        return {row.name: row for row in get_convert_boq_options(self.project)["boqs"]}

    def test_superseded_boqs_are_not_offered(self):
        self.assertEqual(set(self._options()), {self.elec_v1, self.elec_v2, self.hvac})

    def test_highest_version_of_each_name_is_latest(self):
        options = self._options()
        self.assertTrue(options[self.elec_v2].is_latest)
        self.assertFalse(options[self.elec_v1].is_latest)
        self.assertTrue(options[self.hvac].is_latest)

    def test_versions_of_one_name_are_grouped_highest_first(self):
        names = [row.name for row in get_convert_boq_options(self.project)["boqs"]]
        self.assertLess(names.index(self.elec_v2), names.index(self.elec_v1))

    def test_packages_come_from_current_committed_sheets_only(self):
        row = self._options()[self.elec_v2]
        self.assertEqual(row.committed_sheets, 2)
        self.assertEqual(row.packages, [self.mapped_package])
        if self.stale_header:
            stale_package = frappe.db.get_value("Work Headers", self.stale_header, "work_package_link")
            if stale_package != self.mapped_package:
                self.assertNotIn(stale_package, row.packages)

    def test_header_without_a_package_is_reported_not_dropped(self):
        if not self.unmapped_header:
            self.skipTest("every Work Header is mapped to a package on this site")
        self.assertEqual(self._options()[self.elec_v2].unmapped_headers, [self.unmapped_header])

    def test_uncommitted_boq_has_no_packages(self):
        row = self._options()[self.hvac]
        self.assertEqual(row.committed_sheets, 0)
        self.assertEqual(row.packages, [])
        self.assertEqual(row.unmapped_headers, [])

    def test_gated_to_tendering_managers(self):
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                get_convert_boq_options(self.project)
        finally:
            frappe.set_user("Administrator")
