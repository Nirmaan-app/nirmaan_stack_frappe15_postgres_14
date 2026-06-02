"""
Tests for parse_run.py (Slice 1).

Three test groups:
  TestAssembleMappingConfig  -- DB tests (FrappeTestCase): assemble_mapping_config correctness
  TestFlattenFaithfulness    -- pure-Python tests: flatten_resolved_row / flatten_parsed_boq
  TestBoQReviewRowRoundTrip  -- DB tests: optional insert + read-back via Frappe ORM
"""
import json
import unittest
from pathlib import Path

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.orchestrator import parse_boq
from nirmaan_stack.services.boq_parser.tests.fixtures.generate_synthetic import generate_all

from nirmaan_stack.api.boq.wizard.parse_run import (
    assemble_mapping_config,
    flatten_parsed_boq,
    flatten_resolved_row,
)

_FIXTURES = Path(__file__).parent.parent.parent.parent / "services" / "boq_parser" / "tests" / "fixtures"


def _p(name: str) -> str:
    return str(_FIXTURES / name)


# ---------------------------------------------------------------------------
# Fixture configs (mirrors test_orchestrator.py)
# ---------------------------------------------------------------------------

def _simple_config(boq_name: str = "test_boq", project: str = "test") -> MappingConfig:
    return MappingConfig(
        project=project,
        master_boq=MasterBoqMetadata(boq_name=boq_name),
        sheets=[SheetConfig(
            sheet_name="Sheet1",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="unit"),
                "D": ColumnRole(role="qty"),
                "E": ColumnRole(role="rate_supply"),
                "F": ColumnRole(role="amount_supply"),
            },
        )],
    )


def _multi_area_config(boq_name: str = "test_boq", project: str = "test") -> MappingConfig:
    return MappingConfig(
        project=project,
        master_boq=MasterBoqMetadata(boq_name=boq_name),
        sheets=[SheetConfig(
            sheet_name="Multi Area",
            header_row=1,
            area_dimensions=["Floor 1", "Floor 2"],
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="unit"),
                "D": ColumnRole(role="qty", area="Floor 1"),
                "E": ColumnRole(role="qty", area="Floor 2"),
                "F": ColumnRole(role="qty_total"),
                "G": ColumnRole(role="rate_supply"),
                "H": ColumnRole(role="amount_by_area", area="Floor 1"),
                "I": ColumnRole(role="amount_by_area", area="Floor 2"),
                "J": ColumnRole(role="amount_total"),
            },
        )],
    )


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _make_project():
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_PARSE_RUN_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


def _cleanup_project(project_name: str):
    for boq in frappe.get_all("BOQs", filters={"project": project_name}, fields=["name"]):
        frappe.db.delete("BoQ Review Row", {"boq": boq.name})
        frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
    frappe.delete_doc("Projects", project_name, force=True, ignore_permissions=True)
    frappe.db.commit()


# ---------------------------------------------------------------------------
# Group 1: assemble_mapping_config
# ---------------------------------------------------------------------------

class TestAssembleMappingConfig(FrappeTestCase):
    """
    Verifies that assemble_mapping_config correctly routes each wizard_status
    to the right SheetConfig treatment and collects not_eligible entries.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def _make_boq_with_sheets(self):
        sc = SheetConfig(
            sheet_name="Sheet1",
            header_row=1,
            column_role_map={"A": ColumnRole(role="sl_no"), "B": ColumnRole(role="description")},
        )
        blob = json.dumps(sc.model_dump())

        boq = frappe.new_doc("BOQs")
        boq.project = self.__class__.test_project.name
        boq.boq_name = f"Assemble Test {frappe.generate_hash(length=4)}"
        boq.tax_treatment = "Pre-tax"
        boq.notes = "test notes"
        boq.general_specs_sheet = "Sheet5"
        boq.append("sheet_drafts", {
            "sheet_name": "Sheet1", "sheet_order": 1,
            "wizard_status": "Reviewed", "sheet_config": blob,
        })
        boq.append("sheet_drafts", {
            "sheet_name": "Sheet2", "sheet_order": 2,
            "wizard_status": "Hidden",
        })
        boq.append("sheet_drafts", {
            "sheet_name": "Sheet3", "sheet_order": 3,
            "wizard_status": "Skip",
        })
        boq.append("sheet_drafts", {
            "sheet_name": "Sheet4", "sheet_order": 4,
            "wizard_status": "Pending",
        })
        boq.append("sheet_drafts", {
            "sheet_name": "Sheet5", "sheet_order": 5,
            "wizard_status": "Reviewed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        return boq

    def tearDown(self):
        for boq in frappe.get_all(
            "BOQs",
            filters={"project": self.__class__.test_project.name},
            fields=["name"],
        ):
            frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def test_reviewed_sheet_included_as_data(self):
        """A Reviewed sheet with a valid blob is included as a data SheetConfig."""
        boq = self._make_boq_with_sheets()
        config, not_eligible = assemble_mapping_config(boq.name)
        reviewed = next((s for s in config.sheets if s.sheet_name == "Sheet1"), None)
        self.assertIsNotNone(reviewed)
        self.assertFalse(reviewed.skip)
        self.assertEqual(reviewed.treat_as, "data")

    def test_hidden_sheet_included_with_skip_true(self):
        """A Hidden sheet gets skip=True."""
        boq = self._make_boq_with_sheets()
        config, _ = assemble_mapping_config(boq.name)
        hidden = next((s for s in config.sheets if s.sheet_name == "Sheet2"), None)
        self.assertIsNotNone(hidden)
        self.assertTrue(hidden.skip)

    def test_skip_sheet_included_with_skip_true(self):
        """A Skip sheet gets skip=True."""
        boq = self._make_boq_with_sheets()
        config, _ = assemble_mapping_config(boq.name)
        skipped = next((s for s in config.sheets if s.sheet_name == "Sheet3"), None)
        self.assertIsNotNone(skipped)
        self.assertTrue(skipped.skip)

    def test_pending_sheet_excluded_and_in_not_eligible(self):
        """A Pending sheet is excluded from the config and collected in not_eligible."""
        boq = self._make_boq_with_sheets()
        config, not_eligible = assemble_mapping_config(boq.name)
        self.assertIn("Sheet4", not_eligible)
        sheet_names = [s.sheet_name for s in config.sheets]
        self.assertNotIn("Sheet4", sheet_names)

    def test_general_specs_sheet_treated_as_master_preamble(self):
        """The sheet pointed to by BOQs.general_specs_sheet gets treat_as=master_preamble."""
        boq = self._make_boq_with_sheets()
        config, _ = assemble_mapping_config(boq.name)
        gs = next((s for s in config.sheets if s.sheet_name == "Sheet5"), None)
        self.assertIsNotNone(gs)
        self.assertEqual(gs.treat_as, "master_preamble")

    def test_mapping_config_validates_successfully(self):
        """The assembled MappingConfig passes Pydantic validation without error."""
        boq = self._make_boq_with_sheets()
        config, not_eligible = assemble_mapping_config(boq.name)
        MappingConfig.model_validate(config.model_dump())
        self.assertEqual(config.master_boq.boq_name, boq.boq_name)
        self.assertEqual(config.master_boq.tax_treatment, "Pre-tax")
        self.assertEqual(config.master_boq.notes, "test notes")

    def test_config_has_correct_sheet_count(self):
        """Exactly 4 SheetConfigs: 1 data + 2 skip + 1 master_preamble."""
        boq = self._make_boq_with_sheets()
        config, _ = assemble_mapping_config(boq.name)
        self.assertEqual(len(config.sheets), 4)

    def test_parsed_status_included_like_reviewed(self):
        """A 'Parsed' sheet (next lifecycle state after Reviewed) is treated as data."""
        sc = SheetConfig(
            sheet_name="SheetParsed",
            header_row=1,
            column_role_map={"A": ColumnRole(role="sl_no")},
        )
        blob = json.dumps(sc.model_dump())

        boq = frappe.new_doc("BOQs")
        boq.project = self.__class__.test_project.name
        boq.boq_name = f"Parsed Test {frappe.generate_hash(length=4)}"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "SheetParsed", "sheet_order": 1,
            "wizard_status": "Parsed", "sheet_config": blob,
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()

        config, not_eligible = assemble_mapping_config(boq.name)
        parsed_sc = next((s for s in config.sheets if s.sheet_name == "SheetParsed"), None)
        self.assertIsNotNone(parsed_sc)
        self.assertFalse(parsed_sc.skip)
        self.assertEqual(parsed_sc.treat_as, "data")
        self.assertNotIn("SheetParsed", not_eligible)

    def test_reviewed_without_config_blob_goes_to_not_eligible(self):
        """Reviewed but no sheet_config blob -> not_eligible, not a hard error."""
        sc = SheetConfig(
            sheet_name="OtherSheet",
            header_row=1,
            column_role_map={"A": ColumnRole(role="sl_no")},
        )
        boq = frappe.new_doc("BOQs")
        boq.project = self.__class__.test_project.name
        boq.boq_name = f"No Blob Test {frappe.generate_hash(length=4)}"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "OtherSheet", "sheet_order": 1,
            "wizard_status": "Reviewed", "sheet_config": json.dumps(sc.model_dump()),
        })
        boq.append("sheet_drafts", {
            "sheet_name": "NoBlob", "sheet_order": 2,
            "wizard_status": "Reviewed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()

        config, not_eligible = assemble_mapping_config(boq.name)
        self.assertIn("NoBlob", not_eligible)
        sheet_names = [s.sheet_name for s in config.sheets]
        self.assertNotIn("NoBlob", sheet_names)

    def test_unknown_boq_raises_validation_error(self):
        with self.assertRaises(frappe.ValidationError):
            assemble_mapping_config("BOQ-DOES-NOT-EXIST-99999")


# ---------------------------------------------------------------------------
# Group 2: flatten faithfulness (pure Python -- no DB needed)
# ---------------------------------------------------------------------------

class TestFlattenFaithfulness(unittest.TestCase):
    """
    Verifies that flatten_resolved_row and flatten_parsed_boq faithfully map
    all parser output fields to the expected BoQ Review Row field dict.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        generate_all()

    # ---------------------------------------------------------------- #
    # Case (i): single-area -- synthetic_simple.xlsx                   #
    # ---------------------------------------------------------------- #

    def test_single_area_row_count_matches_resolved_rows(self):
        """flatten_parsed_boq produces one dict per resolved_row across all sheets."""
        parsed = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-001")
        total_resolved = sum(len(ps.resolved_rows) for ps in parsed.sheets)
        self.assertEqual(len(flat), total_resolved)

    def test_single_area_classification_preserved(self):
        """classification field holds the RowClassification .value string."""
        parsed = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-001")
        classifications = {d["classification"] for d in flat}
        self.assertTrue(classifications.issubset({
            "preamble", "line_item", "note", "subtotal_marker", "spacer", "header_repeat"
        }))
        self.assertIn("line_item", classifications)

    def test_single_area_source_row_number_is_positive_int(self):
        """source_row_number is a positive int for every flattened row."""
        parsed = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-001")
        for d in flat:
            self.assertIsInstance(d["source_row_number"], int)
            self.assertGreater(d["source_row_number"], 0)

    def test_single_area_row_index_sequential(self):
        """row_index is 0-based and sequential within each sheet's resolved_rows."""
        parsed = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-001")
        indices = [d["row_index"] for d in flat]
        self.assertEqual(indices, list(range(len(indices))))

    def test_single_area_sheet_name_injected(self):
        """All flattened dicts carry the correct sheet_name from ParsedSheet."""
        parsed = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-001")
        for d in flat:
            self.assertEqual(d["sheet_name"], "Sheet1")

    def test_single_area_boq_name_injected(self):
        """flatten_parsed_boq injects the boq_name into every row dict."""
        parsed = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-001")
        for d in flat:
            self.assertEqual(d["boq"], "FAKE-BOQ-001")

    def test_single_area_parent_index_and_path_coherent(self):
        """For rows with a parent, path contains a slash and parent_index is int."""
        parsed = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-001")
        for d in flat:
            if d["parent_index"] is not None:
                self.assertIsInstance(d["parent_index"], int)
                self.assertIn("/", d["path"])

    def test_single_area_description_for_known_items(self):
        """The three known line items are in the flattened output."""
        parsed = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-001")
        descriptions = [d["description"] for d in flat if d["classification"] == "line_item"]
        self.assertIn("First item", descriptions)
        self.assertIn("Second item", descriptions)
        self.assertIn("Bold item", descriptions)

    def test_single_area_scalar_rate_supply_preserved(self):
        """rate_supply for 'First item' (E2=100) survives the flatten."""
        parsed = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-001")
        first = next(d for d in flat if d.get("description") == "First item")
        self.assertEqual(first["rate_supply"], 100.0)

    # ---------------------------------------------------------------- #
    # Case (ii): multi-area -- synthetic_multi_area.xlsx               #
    # ---------------------------------------------------------------- #

    def test_multi_area_qty_by_area_is_dict(self):
        """qty_by_area for a multi-area line item is a Python dict."""
        parsed = parse_boq(_p("synthetic_multi_area.xlsx"), _multi_area_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-002")
        line_items = [d for d in flat if d["classification"] == "line_item"]
        self.assertGreater(len(line_items), 0)
        for li in line_items:
            self.assertIsInstance(li["qty_by_area"], dict)

    def test_multi_area_qty_by_area_keys_are_area_names(self):
        """qty_by_area keys match the declared area names."""
        parsed = parse_boq(_p("synthetic_multi_area.xlsx"), _multi_area_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-002")
        painting = next(d for d in flat if d.get("description") == "Painting works")
        self.assertIn("Floor 1", painting["qty_by_area"])
        self.assertIn("Floor 2", painting["qty_by_area"])
        self.assertAlmostEqual(painting["qty_by_area"]["Floor 1"], 5.0)
        self.assertAlmostEqual(painting["qty_by_area"]["Floor 2"], 3.0)

    def test_multi_area_amount_by_area_preserved(self):
        """amount_by_area for 'Painting works' carries the per-area amounts."""
        parsed = parse_boq(_p("synthetic_multi_area.xlsx"), _multi_area_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-002")
        painting = next(d for d in flat if d.get("description") == "Painting works")
        self.assertAlmostEqual(painting["amount_by_area"]["Floor 1"], 500.0)
        self.assertAlmostEqual(painting["amount_by_area"]["Floor 2"], 300.0)

    def test_multi_area_tiling_has_validation_warning(self):
        """
        'Tiling works' (Excel row 3) has qty sum 8 vs total 10 (diff=2 > +/-1).
        The validation_warning must survive into the flattened dict.
        """
        parsed = parse_boq(_p("synthetic_multi_area.xlsx"), _multi_area_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-002")
        tiling = next(d for d in flat if d.get("description") == "Tiling works")
        self.assertIsInstance(tiling["validation_warnings"], list)
        self.assertGreater(
            len(tiling["validation_warnings"]), 0,
            "Expected qty mismatch warning on 'Tiling works' but got empty list",
        )
        self.assertTrue(
            any("qty" in w.lower() for w in tiling["validation_warnings"]),
            f"No qty-related warning found: {tiling['validation_warnings']}",
        )

    def test_multi_area_clean_row_has_no_validation_warnings(self):
        """'Painting works' (row 2) is clean -- validation_warnings should be empty."""
        parsed = parse_boq(_p("synthetic_multi_area.xlsx"), _multi_area_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-002")
        painting = next(d for d in flat if d.get("description") == "Painting works")
        self.assertEqual(painting["validation_warnings"], [])

    # ---------------------------------------------------------------- #
    # Case (iii): programmatic needs_classification_review flag        #
    # ---------------------------------------------------------------- #

    def test_flagged_row_review_flag_survives_flatten(self):
        """
        No fixture produces needs_classification_review=True (recon-confirmed --
        the flag requires a PREAMBLE with children AND a price signal, which the
        synthetic fixtures do not produce). We construct a ResolvedRow
        programmatically to verify the flag + reason survive the flatten.
        """
        from nirmaan_stack.services.boq_parser.classifier import ClassifiedRow, RowClassification
        from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow
        from nirmaan_stack.services.boq_parser.reader import CellInfo, RawRow

        dummy_cell = CellInfo(
            value=None, formula=None, is_formula=False,
            is_merged_origin=False, merged_range=None,
            font_bold=False, fill_color_rgb=None, indent=0,
        )
        raw = RawRow(row_number=5, cells={"A": dummy_cell})
        cr = ClassifiedRow(raw_row=raw, classification=RowClassification.PREAMBLE)
        rr = ResolvedRow(
            classified_row=cr,
            parent_index=None,
            level=1,
            path="2",
            needs_classification_review=True,
            review_reason="priced_preamble_with_children",
        )

        d = flatten_resolved_row(rr, "SheetX", 2)

        self.assertTrue(d["needs_classification_review"])
        self.assertEqual(d["review_reason"], "priced_preamble_with_children")
        self.assertEqual(d["classification"], "preamble")
        self.assertEqual(d["source_row_number"], 5)
        self.assertEqual(d["row_index"], 2)
        self.assertEqual(d["path"], "2")

    def test_is_synthetic_false_by_default(self):
        """Parser never sets is_synthetic=True; the flatten maps False correctly."""
        from nirmaan_stack.services.boq_parser.classifier import ClassifiedRow, RowClassification
        from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow
        from nirmaan_stack.services.boq_parser.reader import RawRow

        raw = RawRow(row_number=1, cells={})
        cr = ClassifiedRow(raw_row=raw, classification=RowClassification.SPACER)
        rr = ResolvedRow(classified_row=cr)

        d = flatten_resolved_row(rr, "S", 0)
        self.assertFalse(d["is_synthetic"])

    def test_json_fields_are_python_objects_not_strings(self):
        """
        JSON fields in the flattened dict must be Python objects (list/dict),
        NOT pre-serialized JSON strings. Frappe's JSON fieldtype handles serialization.
        """
        parsed = parse_boq(_p("synthetic_multi_area.xlsx"), _multi_area_config())
        flat = flatten_parsed_boq(parsed, "FAKE-BOQ-003")
        for d in flat:
            for field_name in (
                "attached_notes", "validation_warnings", "classifier_warnings",
                "preamble_candidate_signals",
            ):
                self.assertIsInstance(
                    d[field_name], list,
                    f"{field_name} must be a Python list, got {type(d[field_name])}",
                )
            for field_name in ("qty_by_area", "amount_by_area", "rate_by_area", "append_notes_raw"):
                self.assertIsInstance(
                    d[field_name], dict,
                    f"{field_name} must be a Python dict, got {type(d[field_name])}",
                )


# ---------------------------------------------------------------------------
# Group 3: optional DB round-trip insert + read-back
# ---------------------------------------------------------------------------

class TestBoQReviewRowRoundTrip(FrappeTestCase):
    """
    Inserts a handful of flattened dicts as BoQ Review Row records and asserts
    Frappe can save and read them back with the expected field values.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        generate_all()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Round Trip Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name})
        frappe.db.commit()

    # JSON fields whose values are Python lists need pre-serialization.
    # Frappe's get_valid_dict() (base_document.py) auto-serializes dicts
    # for JSON fields but rejects Python lists with "cannot be a list".
    _LIST_JSON_FIELDS = frozenset({
        "attached_notes", "validation_warnings", "classifier_warnings",
        "preamble_candidate_signals",
    })

    def _insert_rows(self, flat_rows: list[dict]) -> list[str]:
        names = []
        for orig_dict in flat_rows:
            row_dict = dict(orig_dict)  # shallow copy -- don't mutate caller's dict
            for key in self._LIST_JSON_FIELDS:
                if isinstance(row_dict.get(key), list):
                    row_dict[key] = json.dumps(row_dict[key])
            doc = frappe.new_doc("BoQ Review Row")
            doc.update(row_dict)
            doc.insert(ignore_permissions=True)
            names.append(doc.name)
        frappe.db.commit()
        return names

    def test_insert_simple_rows_and_read_back_classification(self):
        """Inserting flattened rows from synthetic_simple.xlsx and reading back works."""
        parsed = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        flat = flatten_parsed_boq(parsed, self.boq_name)
        names = self._insert_rows(flat[:3])
        self.assertEqual(len(names), 3)

        for name in names:
            doc = frappe.get_doc("BoQ Review Row", name)
            self.assertEqual(doc.boq, self.boq_name)
            self.assertEqual(doc.sheet_name, "Sheet1")
            self.assertIn(doc.classification, [
                "preamble", "line_item", "note",
                "subtotal_marker", "spacer", "header_repeat",
            ])
            self.assertIsNotNone(doc.source_row_number)

    def test_insert_multi_area_row_and_read_back_json_fields(self):
        """A multi-area line item row can be inserted and its JSON fields read back."""
        parsed = parse_boq(_p("synthetic_multi_area.xlsx"), _multi_area_config())
        flat = flatten_parsed_boq(parsed, self.boq_name)
        painting_dict = next(d for d in flat if d.get("description") == "Painting works")
        names = self._insert_rows([painting_dict])

        doc = frappe.get_doc("BoQ Review Row", names[0])
        self.assertEqual(doc.description, "Painting works")
        self.assertEqual(doc.classification, "line_item")

        qty_by_area = doc.qty_by_area
        if isinstance(qty_by_area, str):
            qty_by_area = json.loads(qty_by_area)
        self.assertIn("Floor 1", qty_by_area)
        self.assertAlmostEqual(qty_by_area["Floor 1"], 5.0)

    def test_insert_row_with_validation_warning_and_read_back(self):
        """The validation_warnings list on 'Tiling works' survives DB round-trip."""
        parsed = parse_boq(_p("synthetic_multi_area.xlsx"), _multi_area_config())
        flat = flatten_parsed_boq(parsed, self.boq_name)
        tiling_dict = next(d for d in flat if d.get("description") == "Tiling works")
        names = self._insert_rows([tiling_dict])

        doc = frappe.get_doc("BoQ Review Row", names[0])
        warnings = doc.validation_warnings
        if isinstance(warnings, str):
            warnings = json.loads(warnings)
        self.assertIsInstance(warnings, list)
        self.assertGreater(len(warnings), 0)

    def test_insert_flagged_row_and_read_back_review_fields(self):
        """needs_classification_review=True + review_reason survive DB round-trip."""
        from nirmaan_stack.services.boq_parser.classifier import ClassifiedRow, RowClassification
        from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow
        from nirmaan_stack.services.boq_parser.reader import RawRow

        raw = RawRow(row_number=7, cells={})
        cr = ClassifiedRow(raw_row=raw, classification=RowClassification.PREAMBLE)
        rr = ResolvedRow(
            classified_row=cr,
            needs_classification_review=True,
            review_reason="priced_preamble_with_children",
            level=1,
            path="3",
        )
        d = flatten_resolved_row(rr, "TestSheet", 3)
        d["boq"] = self.boq_name
        names = self._insert_rows([d])

        doc = frappe.get_doc("BoQ Review Row", names[0])
        self.assertEqual(doc.needs_classification_review, 1)
        self.assertEqual(doc.review_reason, "priced_preamble_with_children")
