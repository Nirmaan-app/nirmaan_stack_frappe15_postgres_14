import frappe
from frappe.tests.utils import FrappeTestCase


class TestBoQSheetDraft(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Test fixture placeholders. Production code does NOT create Projects rows --
        # wizard delegates project creation to the existing Nirmaan new-project
        # workflow. These values satisfy the legacy Projects.after_insert
        # (generate_pwm) hook for the purposes of test isolation only.
        cls.test_project = frappe.new_doc("Projects")
        cls.test_project.project_name = (
            f"TEST_BOQ_WIZARD_{frappe.generate_hash(length=6)}"
        )
        cls.test_project.project_start_date = frappe.utils.now()[:19]
        cls.test_project.project_end_date = frappe.utils.add_to_date(
            frappe.utils.now()[:19], years=1
        )[:19]
        cls.test_project.project_scopes = {"scopes": []}
        cls.test_project.insert(ignore_permissions=True)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for boq in frappe.get_all(
            "BOQs", filters={"project": cls.test_project.name}, fields=["name"]
        ):
            frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
        frappe.delete_doc(
            "Projects", cls.test_project.name, force=True, ignore_permissions=True
        )
        frappe.db.commit()
        super().tearDownClass()

    def test_sheet_draft_child_persists(self):
        """Create a BOQs row, append a BoQ Sheet Draft child, save, reload, verify 4 fields."""
        boq = frappe.new_doc("BOQs")
        boq.project = self.__class__.test_project.name
        boq.boq_name = "Sheet Draft Doctype Test"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "Electrical BOQ",
            "sheet_order": 1,
            "wizard_status": "Pending",
            "work_package": None,
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()

        try:
            loaded = frappe.get_doc("BOQs", boq.name)
            self.assertEqual(len(loaded.sheet_drafts), 1)
            child = loaded.sheet_drafts[0]
            self.assertEqual(child.sheet_name, "Electrical BOQ")
            self.assertEqual(child.sheet_order, 1)
            self.assertEqual(child.wizard_status, "Pending")
            self.assertIsNone(child.work_package)
        finally:
            frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
            frappe.db.commit()
