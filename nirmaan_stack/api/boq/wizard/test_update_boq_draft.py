import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.update_boq_draft import update_boq_draft


class TestUpdateBoQDraftPositive(FrappeTestCase):
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

    def setUp(self):
        self.boq = frappe.new_doc("BOQs")
        self.boq.project = self.__class__.test_project.name
        self.boq.boq_name = "Update Draft Test BoQ"
        self.boq.tax_treatment = "Pre-tax"
        self.boq.notes = "original notes"
        self.boq.insert(ignore_permissions=True)
        frappe.db.commit()

    def tearDown(self):
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def test_update_boq_name_field(self):
        result = update_boq_draft(boq_name=self.boq.name, boq_name_field="Renamed BoQ Title")
        self.assertEqual(result["status"], "saved")
        val = frappe.db.get_value("BOQs", self.boq.name, "boq_name")
        self.assertEqual(val, "Renamed BoQ Title")

    def test_update_version(self):
        update_boq_draft(boq_name=self.boq.name, version=3)
        val = frappe.db.get_value("BOQs", self.boq.name, "version")
        self.assertEqual(val, 3)

    def test_update_tax_treatment(self):
        update_boq_draft(boq_name=self.boq.name, tax_treatment="Post-tax")
        val = frappe.db.get_value("BOQs", self.boq.name, "tax_treatment")
        self.assertEqual(val, "Post-tax")

    def test_update_notes(self):
        long_note = "This is a longer note with details about the BoQ configuration."
        update_boq_draft(boq_name=self.boq.name, notes=long_note)
        val = frappe.db.get_value("BOQs", self.boq.name, "notes")
        self.assertEqual(val, long_note)

    def test_partial_update_leaves_others_unchanged(self):
        """Updating only version must not change boq_name or tax_treatment."""
        original_boq_name = frappe.db.get_value("BOQs", self.boq.name, "boq_name")
        update_boq_draft(boq_name=self.boq.name, version=5)
        row = frappe.db.get_value(
            "BOQs", self.boq.name, ["boq_name", "tax_treatment", "version"], as_dict=True
        )
        self.assertEqual(row["boq_name"], original_boq_name)
        self.assertEqual(row["tax_treatment"], "Pre-tax")
        self.assertEqual(row["version"], 5)


class TestUpdateBoQDraftNegative(FrappeTestCase):
    def test_missing_boq_name(self):
        with self.assertRaises(frappe.ValidationError):
            update_boq_draft(boq_name=None, notes="x")

    def test_nonexistent_boq_name(self):
        with self.assertRaises(frappe.ValidationError):
            update_boq_draft(boq_name="BOQ-DOES-NOT-EXIST-99999", notes="x")
