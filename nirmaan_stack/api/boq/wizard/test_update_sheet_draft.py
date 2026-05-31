import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.update_sheet_draft import (
    set_general_specs_sheet,
    set_sheet_config,
    set_sheet_label,
    set_sheet_status,
    set_sheet_work_packages,
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


# ---------------------------------------------------------------------------
# Helpers for Module 3 Slice 3a tests
# ---------------------------------------------------------------------------

def _make_work_header(name: str) -> str:
    """Create a Work Headers record; returns its docname (= name, autonamed from field)."""
    if frappe.db.exists("Work Headers", name):
        return name
    wh = frappe.new_doc("Work Headers")
    wh.work_header_name = name
    wh.insert(ignore_permissions=True)
    frappe.db.commit()
    return wh.name


def _cleanup_work_header(name: str):
    if frappe.db.exists("Work Headers", name):
        frappe.delete_doc("Work Headers", name, force=True, ignore_permissions=True)
    frappe.db.commit()


def _get_work_packages(draft_parent_name: str) -> list:
    """Return list of work_header values on BoQ Sheet Work Package for a given draft row."""
    return frappe.db.get_all(
        "BoQ Sheet Work Package",
        filters={"parent": draft_parent_name, "parenttype": "BoQ Sheet Draft"},
        fields=["work_header"],
        order_by="creation asc",
    )


# ---------------------------------------------------------------------------
# set_sheet_config -- positive
# ---------------------------------------------------------------------------

class TestSetSheetConfig(FrappeTestCase):
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

    def _get_draft_name(self, sheet_name: str) -> str:
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": sheet_name},
            "name",
        )

    def _get_config_raw(self, sheet_name: str):
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": sheet_name},
            "sheet_config",
        )

    def test_set_config_dict_input_writes_and_reads_back(self):
        """Pass a dict; endpoint writes it; reading back matches the original dict."""
        import json
        cfg = {"header_row": 3, "header_row_count": 2, "area_dimensions": ["B1", "B2"]}
        result = set_sheet_config(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            sheet_config=cfg,
        )
        self.assertEqual(result["status"], "saved")
        raw = self._get_config_raw(_SHEET_HVAC)
        self.assertIsNotNone(raw)
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        self.assertEqual(parsed["header_row"], 3)
        self.assertEqual(parsed["area_dimensions"], ["B1", "B2"])

    def test_set_config_json_string_input(self):
        """Pass a JSON string; endpoint stores it; reading back round-trips correctly."""
        import json
        cfg_str = '{"header_row": 1, "column_role_map": {"A": "sl_no"}}'
        result = set_sheet_config(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            sheet_config=cfg_str,
        )
        self.assertEqual(result["status"], "saved")
        raw = self._get_config_raw(_SHEET_HVAC)
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        self.assertEqual(parsed["header_row"], 1)

    def test_set_config_second_sheet_unaffected(self):
        """Writing config to HVAC sheet must not change ELEC sheet config (None)."""
        set_sheet_config(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            sheet_config={"header_row": 5},
        )
        self.assertFalse(self._get_config_raw(_SHEET_ELEC))

    def test_rejects_nonexistent_boq(self):
        with self.assertRaises(frappe.ValidationError):
            set_sheet_config(
                boq_name="BOQ-DOES-NOT-EXIST-99999",
                sheet_name=_SHEET_HVAC,
                sheet_config={"header_row": 1},
            )

    def test_rejects_nonexistent_sheet(self):
        with self.assertRaises(frappe.ValidationError):
            set_sheet_config(
                boq_name=self.boq.name,
                sheet_name="NO SUCH SHEET",
                sheet_config={"header_row": 1},
            )

    def test_rejects_missing_config_param(self):
        with self.assertRaises(frappe.ValidationError):
            set_sheet_config(
                boq_name=self.boq.name,
                sheet_name=_SHEET_HVAC,
                sheet_config=None,
            )


# ---------------------------------------------------------------------------
# set_sheet_work_packages -- positive + negative
# ---------------------------------------------------------------------------

_WH_ALPHA = "TEST_WH_ALPHA_3a"
_WH_BETA = "TEST_WH_BETA_3a"


class TestSetSheetWorkPackages(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        cls.wh_alpha = _make_work_header(_WH_ALPHA)
        cls.wh_beta = _make_work_header(_WH_BETA)

    @classmethod
    def tearDownClass(cls):
        _cleanup_work_header(_WH_ALPHA)
        _cleanup_work_header(_WH_BETA)
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        self.boq = _make_boq(self.__class__.test_project.name)

    def tearDown(self):
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _draft_name(self, sheet_name: str) -> str:
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": sheet_name},
            "name",
        )

    def test_set_two_work_packages_creates_two_rows(self):
        """set_sheet_work_packages with 2 valid headers creates exactly 2 child rows."""
        result = set_sheet_work_packages(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            work_headers=[_WH_ALPHA, _WH_BETA],
        )
        self.assertEqual(result["status"], "saved")
        rows = _get_work_packages(self._draft_name(_SHEET_HVAC))
        self.assertEqual(len(rows), 2)
        wh_names = {r.work_header for r in rows}
        self.assertIn(_WH_ALPHA, wh_names)
        self.assertIn(_WH_BETA, wh_names)

    def test_replace_all_reduces_to_one_row(self):
        """After setting 2, calling again with 1 leaves exactly 1 row (replace-all)."""
        set_sheet_work_packages(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            work_headers=[_WH_ALPHA, _WH_BETA],
        )
        set_sheet_work_packages(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            work_headers=[_WH_BETA],
        )
        rows = _get_work_packages(self._draft_name(_SHEET_HVAC))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].work_header, _WH_BETA)

    def test_empty_list_clears_all_rows(self):
        """Calling with [] after setting 2 headers leaves 0 child rows."""
        set_sheet_work_packages(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            work_headers=[_WH_ALPHA, _WH_BETA],
        )
        result = set_sheet_work_packages(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            work_headers=[],
        )
        self.assertEqual(result["status"], "saved")
        rows = _get_work_packages(self._draft_name(_SHEET_HVAC))
        self.assertEqual(len(rows), 0)

    def test_second_sheet_work_packages_unaffected(self):
        """Setting work packages on HVAC must not create rows for ELEC sheet."""
        set_sheet_work_packages(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            work_headers=[_WH_ALPHA],
        )
        elec_rows = _get_work_packages(self._draft_name(_SHEET_ELEC))
        self.assertEqual(len(elec_rows), 0)

    def test_rejects_nonexistent_boq(self):
        with self.assertRaises(frappe.ValidationError):
            set_sheet_work_packages(
                boq_name="BOQ-DOES-NOT-EXIST-99999",
                sheet_name=_SHEET_HVAC,
                work_headers=[_WH_ALPHA],
            )

    def test_rejects_nonexistent_sheet(self):
        with self.assertRaises(frappe.ValidationError):
            set_sheet_work_packages(
                boq_name=self.boq.name,
                sheet_name="NO SUCH SHEET",
                work_headers=[_WH_ALPHA],
            )

    def test_rejects_nonexistent_work_header_no_partial_write(self):
        """A single invalid header causes full rejection; no child rows written."""
        with self.assertRaises(frappe.ValidationError):
            set_sheet_work_packages(
                boq_name=self.boq.name,
                sheet_name=_SHEET_HVAC,
                work_headers=["WORK_HEADER_DOES_NOT_EXIST_XYZ"],
            )
        rows = _get_work_packages(self._draft_name(_SHEET_HVAC))
        self.assertEqual(len(rows), 0)

    def test_rejects_one_invalid_among_two_no_partial_write(self):
        """One valid + one invalid header: entire call is rejected, 0 rows written."""
        with self.assertRaises(frappe.ValidationError):
            set_sheet_work_packages(
                boq_name=self.boq.name,
                sheet_name=_SHEET_HVAC,
                work_headers=[_WH_ALPHA, "WORK_HEADER_DOES_NOT_EXIST_XYZ"],
            )
        rows = _get_work_packages(self._draft_name(_SHEET_HVAC))
        self.assertEqual(len(rows), 0)


# ---------------------------------------------------------------------------
# Migration patch -- BoQ Sheet Draft work_package -> work_packages
# ---------------------------------------------------------------------------

class TestMigrateWorkPackageToMulti(FrappeTestCase):
    """Verify the migration patch: rows with a legacy work_package column value
    get a matching BoQ Sheet Work Package child row, and the patch is idempotent."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        cls.wh_migrate = _make_work_header("TEST_WH_MIGRATE_3a")

    @classmethod
    def tearDownClass(cls):
        _cleanup_work_header("TEST_WH_MIGRATE_3a")
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        self.boq = _make_boq(self.__class__.test_project.name)
        self._draft_name = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": _SHEET_HVAC},
            "name",
        )
        # Simulate legacy state: write the old work_package column value via raw SQL
        frappe.db.sql(
            'UPDATE "tabBoQ Sheet Draft" SET work_package = %s WHERE name = %s',
            (self.__class__.wh_migrate, self._draft_name),
        )
        frappe.db.commit()

    def tearDown(self):
        # Remove any migration-created child rows before deleting the BOQ
        frappe.db.sql(
            'DELETE FROM "tabBoQ Sheet Work Package" WHERE parent = %s',
            (self._draft_name,),
        )
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def test_migration_creates_child_row_from_legacy_work_package(self):
        """Patch creates one BoQ Sheet Work Package row for the legacy work_package value."""
        from nirmaan_stack.patches.v3_0.migrate_boq_sheet_draft_work_package_to_multi import execute
        execute()
        rows = frappe.db.sql(
            'SELECT work_header FROM "tabBoQ Sheet Work Package" WHERE parent = %s',
            (self._draft_name,),
            as_dict=True,
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].work_header, self.__class__.wh_migrate)

    def test_migration_is_idempotent(self):
        """Running the patch twice must not create duplicate child rows."""
        from nirmaan_stack.patches.v3_0.migrate_boq_sheet_draft_work_package_to_multi import execute
        execute()
        execute()
        rows = frappe.db.sql(
            'SELECT work_header FROM "tabBoQ Sheet Work Package" WHERE parent = %s',
            (self._draft_name,),
            as_dict=True,
        )
        self.assertEqual(len(rows), 1)
