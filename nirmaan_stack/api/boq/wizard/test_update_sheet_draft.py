import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.update_sheet_draft import (
    get_boq_work_packages,
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

    def _get_designated_sheets(self) -> list:
        """Return list of source_sheet_name values in the general_specs_sheets child table."""
        rows = frappe.db.get_all(
            "BoQ General Specs Sheet",
            filters={"parent": self.boq.name, "parenttype": "BOQs"},
            fields=["source_sheet_name"],
            order_by="creation asc",
        )
        return [r.source_sheet_name for r in rows]

    def _get_child_status(self, sheet_name: str) -> str:
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": sheet_name},
            "wizard_status",
        )

    def test_set_designates_one_child_row(self):
        """Designating a sheet creates exactly one child row with the correct source_sheet_name."""
        result = set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        self.assertEqual(result["status"], "saved")
        designated = self._get_designated_sheets()
        self.assertEqual(designated, [_SHEET_HVAC])

    def test_change_designation_replaces_existing_row(self):
        """Designating a second sheet removes the first (replace-all semantics)."""
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_ELEC)
        designated = self._get_designated_sheets()
        self.assertEqual(designated, [_SHEET_ELEC])

    def test_clear_designation_with_none(self):
        """Clearing with None removes all child rows."""
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        result = set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=None)
        self.assertEqual(result["status"], "saved")
        self.assertEqual(self._get_designated_sheets(), [])

    def test_clear_designation_with_empty_string(self):
        """Clearing with '' removes all child rows."""
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none="")
        self.assertEqual(self._get_designated_sheets(), [])

    def test_wizard_status_not_touched_on_set(self):
        """Backend must NOT modify wizard_status when designating (M2.23 unchanged)."""
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        self.assertEqual(self._get_child_status(_SHEET_HVAC), "Pending")
        self.assertEqual(self._get_child_status(_SHEET_ELEC), "Pending")

    def test_wizard_status_not_touched_on_clear(self):
        """Backend must NOT modify wizard_status when clearing (M2.23 unchanged)."""
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=None)
        self.assertEqual(self._get_child_status(_SHEET_HVAC), "Pending")

    def test_un_designating_removes_child_row(self):
        """Un-designating removes the child row entirely (not just clears the field)."""
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=_SHEET_HVAC)
        self.assertEqual(len(self._get_designated_sheets()), 1)
        set_general_specs_sheet(boq_name=self.boq.name, sheet_name_or_none=None)
        self.assertEqual(
            len(self._get_designated_sheets()), 0,
            "Child row was not removed on un-designation",
        )

    def test_two_designated_sheets_produce_two_rows_with_distinct_names(self):
        """Two child rows directly inserted have distinct source_sheet_names (multi-sheet data model)."""
        for sheet in [_SHEET_HVAC, _SHEET_ELEC]:
            child = frappe.new_doc("BoQ General Specs Sheet")
            child.parent = self.boq.name
            child.parenttype = "BOQs"
            child.parentfield = "general_specs_sheets"
            child.source_sheet_name = sheet
            child.preamble_text = ""
            child.insert(ignore_permissions=True)
        frappe.db.commit()

        designated = self._get_designated_sheets()
        self.assertEqual(len(designated), 2)
        self.assertEqual(set(designated), {_SHEET_HVAC, _SHEET_ELEC})

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
# set_sheet_config -- dirty marker (Parsed -> Reviewed on config change)
# ---------------------------------------------------------------------------

class TestSetSheetConfigDirtyMarker(FrappeTestCase):
    """Truth-table tests for the Parsed->Reviewed dirty marker in set_sheet_config."""

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

    def _set_status_direct(self, sheet_name: str, status: str):
        """Bypass the endpoint to set wizard_status directly (for test setup)."""
        frappe.db.set_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": sheet_name},
            "wizard_status",
            status,
        )
        frappe.db.commit()

    def test_parsed_changed_config_drops_to_reviewed(self):
        """Parsed + changed config -> wizard_status drops to Reviewed."""
        self._set_status_direct(_SHEET_HVAC, "Parsed")
        set_sheet_config(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            sheet_config={"header_row": 5},
        )
        self.assertEqual(self._get_status(_SHEET_HVAC), "Reviewed")

    def test_parsed_identical_config_stays_parsed(self):
        """Parsed + identical config (no-op save) -> wizard_status stays Parsed."""
        cfg = {"header_row": 3, "column_role_map": {"A": "sl_no"}}
        set_sheet_config(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, sheet_config=cfg)
        self._set_status_direct(_SHEET_HVAC, "Parsed")
        # Second write with the same config -- must not drop to Reviewed.
        set_sheet_config(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, sheet_config=cfg)
        self.assertEqual(self._get_status(_SHEET_HVAC), "Parsed")

    def test_parsed_reordered_keys_semantically_identical_stays_parsed(self):
        """Parsed + config with reordered keys (same semantics) -> stays Parsed.

        Regression guard for compare soundness: the stored form is non-canonical
        (json.dumps without sort_keys), so a raw string compare would report
        'changed' here. The normalized sort_keys compare correctly returns False.
        """
        original = {"header_row": 3, "column_role_map": {"A": "sl_no"}}
        reordered = {"column_role_map": {"A": "sl_no"}, "header_row": 3}
        set_sheet_config(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, sheet_config=original)
        self._set_status_direct(_SHEET_HVAC, "Parsed")
        # Reversed key order -- semantically identical; must not drop to Reviewed.
        set_sheet_config(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, sheet_config=reordered)
        self.assertEqual(self._get_status(_SHEET_HVAC), "Parsed")

    def test_reviewed_changed_config_stays_reviewed(self):
        """Reviewed + changed config -> wizard_status stays Reviewed (not touched)."""
        set_sheet_config(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            sheet_config={"header_row": 1},
        )
        self._set_status_direct(_SHEET_HVAC, "Reviewed")
        set_sheet_config(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            sheet_config={"header_row": 99},
        )
        self.assertEqual(self._get_status(_SHEET_HVAC), "Reviewed")

    def test_pending_changed_config_stays_pending(self):
        """Pending + changed config -> wizard_status stays Pending (not touched)."""
        set_sheet_config(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            sheet_config={"header_row": 99},
        )
        self.assertEqual(self._get_status(_SHEET_HVAC), "Pending")

    def test_skip_changed_config_status_untouched(self):
        """Skip + changed config -> wizard_status stays Skip (only Parsed is affected)."""
        self._set_status_direct(_SHEET_HVAC, "Skip")
        set_sheet_config(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            sheet_config={"header_row": 2},
        )
        self.assertEqual(self._get_status(_SHEET_HVAC), "Skip")

    def test_changed_config_blob_written_correctly(self):
        """Config blob is correctly written in the Parsed->Reviewed drop path."""
        import json as _json
        self._set_status_direct(_SHEET_HVAC, "Parsed")
        new_cfg = {"header_row": 7, "area_dimensions": ["C3"]}
        set_sheet_config(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, sheet_config=new_cfg)
        raw = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": _SHEET_HVAC},
            "sheet_config",
        )
        self.assertIsNotNone(raw)
        parsed = _json.loads(raw) if isinstance(raw, str) else raw
        self.assertEqual(parsed["header_row"], 7)
        self.assertEqual(parsed["area_dimensions"], ["C3"])


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


# ---------------------------------------------------------------------------
# get_boq_work_packages -- Slice 3f-readback
# ---------------------------------------------------------------------------

_WH_GET_ALPHA = "TEST_WH_GET_ALPHA_3f"
_WH_GET_BETA = "TEST_WH_GET_BETA_3f"


class TestGetBoqWorkPackages(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        cls.wh_alpha = _make_work_header(_WH_GET_ALPHA)
        cls.wh_beta = _make_work_header(_WH_GET_BETA)

    @classmethod
    def tearDownClass(cls):
        _cleanup_work_header(_WH_GET_ALPHA)
        _cleanup_work_header(_WH_GET_BETA)
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        self.boq = _make_boq(self.__class__.test_project.name)

    def tearDown(self):
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def test_returns_empty_dict_when_no_assignments(self):
        """BoQ with no work-package assignments returns {}."""
        result = get_boq_work_packages(boq_name=self.boq.name)
        self.assertIsInstance(result, dict)
        self.assertEqual(result, {})

    def test_returns_correct_map_for_assigned_sheet(self):
        """Sheets with assignments appear in the result with the correct header list."""
        set_sheet_work_packages(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            work_headers=[_WH_GET_ALPHA, _WH_GET_BETA],
        )
        result = get_boq_work_packages(boq_name=self.boq.name)
        self.assertIn(_SHEET_HVAC, result)
        self.assertEqual(set(result[_SHEET_HVAC]), {_WH_GET_ALPHA, _WH_GET_BETA})

    def test_sheet_with_no_assignments_is_omitted(self):
        """A sheet with no work packages is omitted, not returned as []."""
        set_sheet_work_packages(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            work_headers=[_WH_GET_ALPHA],
        )
        result = get_boq_work_packages(boq_name=self.boq.name)
        self.assertIn(_SHEET_HVAC, result)
        self.assertNotIn(_SHEET_ELEC, result)

    def test_raises_for_nonexistent_boq(self):
        """Nonexistent boq_name raises ValidationError."""
        with self.assertRaises(frappe.ValidationError):
            get_boq_work_packages(boq_name="BOQ-DOES-NOT-EXIST-99999")

    def test_raises_for_missing_boq_name(self):
        """Calling without boq_name raises ValidationError."""
        with self.assertRaises(frappe.ValidationError):
            get_boq_work_packages(boq_name=None)

    def test_round_trip_set_then_get(self):
        """set_sheet_work_packages then get_boq_work_packages reflects the saved state."""
        # Assign HVAC -> alpha; ELEC -> beta
        set_sheet_work_packages(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            work_headers=[_WH_GET_ALPHA],
        )
        set_sheet_work_packages(
            boq_name=self.boq.name,
            sheet_name=_SHEET_ELEC,
            work_headers=[_WH_GET_BETA],
        )
        result = get_boq_work_packages(boq_name=self.boq.name)
        self.assertEqual(result.get(_SHEET_HVAC), [_WH_GET_ALPHA])
        self.assertEqual(result.get(_SHEET_ELEC), [_WH_GET_BETA])

        # Replace HVAC assignments; ELEC must be unaffected.
        set_sheet_work_packages(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            work_headers=[_WH_GET_BETA],
        )
        result2 = get_boq_work_packages(boq_name=self.boq.name)
        self.assertEqual(result2.get(_SHEET_HVAC), [_WH_GET_BETA])
        self.assertEqual(result2.get(_SHEET_ELEC), [_WH_GET_BETA])


# ---------------------------------------------------------------------------
# Parse-history fields NOT touched by update_sheet_draft endpoints -- Slice 2b-backend-2
# ---------------------------------------------------------------------------

class TestParseHistoryNotTouched(FrappeTestCase):
    """
    Asserts that set_sheet_config and set_sheet_status do NOT read or modify
    has_prior_parse / last_parsed_at.  These are write-once-by-the-worker fields;
    the update_sheet_draft endpoints must leave them untouched.
    """

    _SENTINEL_TS = "2026-01-01 00:00:00"

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
        # Simulate parse history on HVAC sheet (as if worker ran and stamped it)
        child_name = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": _SHEET_HVAC},
            "name",
        )
        frappe.db.set_value("BoQ Sheet Draft", child_name, {
            "wizard_status": "Parsed",
            "has_prior_parse": 1,
            "last_parsed_at": self._SENTINEL_TS,
        })
        frappe.db.commit()

    def tearDown(self):
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _get_history(self, sheet_name: str) -> dict:
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": sheet_name},
            ["has_prior_parse", "last_parsed_at"],
            as_dict=True,
        )

    @staticmethod
    def _ts_str(val) -> str:
        """Normalize a Frappe Datetime return to a 19-char string for comparison.
        Frappe returns Datetime fields as datetime.datetime objects, not strings."""
        return str(val)[:19] if val is not None else ""

    def test_set_sheet_config_dirty_drop_does_not_clear_parse_history(self):
        """
        set_sheet_config with a changed config drops Parsed->Reviewed but must NOT
        touch has_prior_parse or last_parsed_at.
        """
        set_sheet_config(
            boq_name=self.boq.name,
            sheet_name=_SHEET_HVAC,
            sheet_config={"header_row": 7, "area_dimensions": []},
        )

        status = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq.name, "sheet_name": _SHEET_HVAC},
            "wizard_status",
        )
        self.assertEqual(status, "Reviewed", "dirty-marker drop did not fire -- test precondition failed")

        hist = self._get_history(_SHEET_HVAC)
        self.assertEqual(hist.has_prior_parse, 1,
            "set_sheet_config cleared has_prior_parse during dirty-drop")
        self.assertEqual(self._ts_str(hist.last_parsed_at), self._SENTINEL_TS,
            "set_sheet_config modified last_parsed_at during dirty-drop")

    def test_set_sheet_config_noop_save_does_not_clear_parse_history(self):
        """
        set_sheet_config with an identical config (no status change) also must NOT
        touch the parse-history fields.
        """
        cfg = {"header_row": 1, "area_dimensions": []}
        set_sheet_config(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, sheet_config=cfg)
        # Write it again identically (no-op save path)
        set_sheet_config(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, sheet_config=cfg)

        hist = self._get_history(_SHEET_HVAC)
        self.assertEqual(hist.has_prior_parse, 1,
            "set_sheet_config (no-op path) cleared has_prior_parse")
        self.assertEqual(self._ts_str(hist.last_parsed_at), self._SENTINEL_TS,
            "set_sheet_config (no-op path) modified last_parsed_at")

    def test_set_sheet_status_pending_does_not_clear_parse_history(self):
        """
        set_sheet_status("Pending") must leave has_prior_parse and last_parsed_at
        exactly as they were.  A Pending sheet that was parsed before carries history.
        """
        set_sheet_status(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, status="Pending")

        hist = self._get_history(_SHEET_HVAC)
        self.assertEqual(hist.has_prior_parse, 1,
            "set_sheet_status('Pending') cleared has_prior_parse")
        self.assertEqual(self._ts_str(hist.last_parsed_at), self._SENTINEL_TS,
            "set_sheet_status('Pending') modified last_parsed_at")

    def test_set_sheet_status_reviewed_does_not_clear_parse_history(self):
        """set_sheet_status('Reviewed') must also leave parse history intact."""
        set_sheet_status(boq_name=self.boq.name, sheet_name=_SHEET_HVAC, status="Reviewed")

        hist = self._get_history(_SHEET_HVAC)
        self.assertEqual(hist.has_prior_parse, 1,
            "set_sheet_status('Reviewed') cleared has_prior_parse")
        self.assertEqual(self._ts_str(hist.last_parsed_at), self._SENTINEL_TS,
            "set_sheet_status('Reviewed') modified last_parsed_at")
