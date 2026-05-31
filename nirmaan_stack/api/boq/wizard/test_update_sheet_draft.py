import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.update_sheet_draft import (
    set_general_specs_sheet,
    set_sheet_label,
    set_sheet_status,
)

_SHEET_HVAC = "HVAC BOQ"
_SHEET_ELEC = "ELECTRICAL"


def _make_project():
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_SHEET_DRAFT_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


def _make_boq(project_name: str):
    boq = frappe.new_doc("BOQs")
    boq.project = project_name
    boq.boq_name = "Sheet Draft Test BoQ"
    boq.tax_treatment = "Pre-tax"
    boq.append("sheet_drafts", {"sheet_name": _SHEET_HVAC, "sheet_order": 1, "wizard_status": "Pending"})
    boq.append("sheet_drafts", {"sheet_name": _SHEET_ELEC, "sheet_order": 2, "wizard_status": "Pending"})
    boq.insert(ignore_permissions=True)
    frappe.db.commit()
    return boq


def _cleanup_project(project_name: str):
    for boq in frappe.get_all("BOQs", filters={"project": project_name}, fields=["name"]):
        frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
    frappe.delete_doc("Projects", project_name, force=True, ignore_permissions=True)
    frappe.db.commit()


# ---------------------------------------------------------------------------
# set_sheet_status -- positive
# ---------------------------------------------------------------------------

class TestSetSheetStatusPositive(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        self.boq = _make_boq(self.__class__.test_project.name)

    def tearDown(self):
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _get_status(self, sheet_name: str) -> str:
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": sheet_name},
            "wizard_status",
        )

    def test_set_reviewed(self):
        result = set_sheet_status(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, status="Reviewed")
        self.assertEqual(result["status"], "saved")
        self.assertEqual(self._get_status(_SHEET_HVAC), "Reviewed")

    def test_set_skip(self):
        result = set_sheet_status(boq_name=self.boq.name, sheet_name=_SHEET_ELEC, status="Skip")
        self.assertEqual(result["status"], "saved")
        self.assertEqual(self._get_status(_SHEET_ELEC), "Skip")

    def test_set_hidden(self):
        set_sheet_status(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, status="Hidden")
        self.assertEqual(self._get_status(_SHEET_HVAC), "Hidden")

    def test_set_pending_after_reviewed(self):
        set_sheet_status(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, status="Reviewed")
        set_sheet_status(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, status="Pending")
        self.assertEqual(self._get_status(_SHEET_HVAC), "Pending")

    def test_set_parse_failed(self):
        set_sheet_status(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, status="Parse failed")
        self.assertEqual(self._get_status(_SHEET_HVAC), "Parse failed")

    def test_second_sheet_unaffected(self):
        set_sheet_status(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, status="Reviewed")
        self.assertEqual(self._get_status(_SHEET_ELEC), "Pending")


# ---------------------------------------------------------------------------
# set_sheet_status -- negative (guards)
# ---------------------------------------------------------------------------

class TestSetSheetStatusNegative(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        self.boq = _make_boq(self.__class__.test_project.name)

    def tearDown(self):
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def test_rejects_general_specs_direct(self):
        """'General specs' must be rejected with a redirect message."""
        with self.assertRaises(frappe.ValidationError):
            set_sheet_status(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, status="General specs")

    def test_rejects_invalid_status(self):
        with self.assertRaises(frappe.ValidationError):
            set_sheet_status(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, status="Approved")

    def test_rejects_unknown_sheet(self):
        with self.assertRaises(frappe.ValidationError):
            set_sheet_status(boq_name=self.boq.name, sheet_name="NONEXISTENT SHEET", status="Reviewed")

    def test_rejects_unknown_boq(self):
        with self.assertRaises(frappe.ValidationError):
            set_sheet_status(boq_name="BOQ-DOES-NOT-EXIST-99999", sheet_name=_SHEET_HVAC, status="Reviewed")

    def test_rejects_missing_status(self):
        with self.assertRaises(frappe.ValidationError):
            set_sheet_status(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, status=None)


# ---------------------------------------------------------------------------
# set_sheet_label -- positive + negative
# ---------------------------------------------------------------------------

class TestSetSheetLabel(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        self.boq = _make_boq(self.__class__.test_project.name)

    def tearDown(self):
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _get_label(self, sheet_name: str):
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": sheet_name},
            "sheet_label",
        )

    def test_set_label(self):
        result = set_sheet_label(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, label="Phase 1 HVAC")
        self.assertEqual(result["status"], "saved")
        self.assertEqual(self._get_label(_SHEET_HVAC), "Phase 1 HVAC")

    def test_clear_label_with_empty_string(self):
        frappe.db.set_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": _SHEET_HVAC},
            "sheet_label",
            "Old Label",
        )
        frappe.db.commit()
        result = set_sheet_label(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, label="")
        self.assertEqual(result["status"], "saved")
        self.assertFalse(self._get_label(_SHEET_HVAC))

    def test_clear_label_with_none(self):
        frappe.db.set_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": _SHEET_HVAC},
            "sheet_label",
            "Old Label",
        )
        frappe.db.commit()
        set_sheet_label(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, label=None)
        self.assertFalse(self._get_label(_SHEET_HVAC))

    def test_second_sheet_label_unaffected(self):
        set_sheet_label(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, label="Only HVAC")
        self.assertFalse(self._get_label(_SHEET_ELEC))

    def test_rejects_unknown_sheet(self):
        with self.assertRaises(frappe.ValidationError):
            set_sheet_label(boq_name=self.boq.name, sheet_name="NONEXISTENT", label="X")

    def test_rejects_unknown_boq(self):
        with self.assertRaises(frappe.ValidationError):
            set_sheet_label(boq_name="BOQ-DOES-NOT-EXIST-99999", sheet_name=_SHEET_HVAC, label="X")


# ---------------------------------------------------------------------------
# set_general_specs_sheet -- positive + negative
# ---------------------------------------------------------------------------

class TestSetGeneralSpecsSheet(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        self.boq = _make_boq(self.__class__.test_project.name)

    def tearDown(self):
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _get_pointer(self) -> str:
        return frappe.db.get_value("BOQs", self.boq.name, "general_specs_sheet")

    def _get_child_status(self, sheet_name: str) -> str:
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": sheet_name},
            "wizard_status",
        )

    def test_set_pointer(self):
        result = set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        self.assertEqual(result["status"], "saved")
        self.assertEqual(self._get_pointer(), _SHEET_HVAC)

    def test_change_pointer(self):
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_ELEC)
        self.assertEqual(self._get_pointer(), _SHEET_ELEC)

    def test_clear_pointer_with_none(self):
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        result = set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=None)
        self.assertEqual(result["status"], "saved")
        self.assertFalse(self._get_pointer())

    def test_clear_pointer_with_empty_string(self):
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none="")
        self.assertFalse(self._get_pointer())

    def test_wizard_status_not_touched_on_set(self):
        """Backend must NOT modify wizard_status when setting the pointer."""
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        self.assertEqual(self._get_child_status(_SHEET_HVAC), "Pending")
        self.assertEqual(self._get_child_status(_SHEET_ELEC), "Pending")

    def test_wizard_status_not_touched_on_clear(self):
        """Backend must NOT modify wizard_status when clearing the pointer."""
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=None)
        self.assertEqual(self._get_child_status(_SHEET_HVAC), "Pending")

    def test_rejects_unknown_sheet(self):
        with self.assertRaises(frappe.ValidationError):
            set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none="NO SUCH SHEET")

    def test_rejects_unknown_boq(self):
        with self.assertRaises(frappe.ValidationError):
            set_general_specs_sheet(boq_name="BOQ-DOES-NOT-EXIST-99999", sheet_name_or_none=_SHEET_HVAC)
