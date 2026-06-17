"""
Tests for nirmaan_stack.api.boq.wizard.sheet_preview.

S3 fetch strategy: _fetch_boq_file_to_tempfile is monkeypatched in all tests that
need to open a real workbook.  The patch copies a local fixture file into a fresh
NamedTemporaryFile so the endpoint's finally-block can safely os.unlink it without
touching the original fixture.

Fixture files used:
  - synthetic_simple.xlsx  -- sheet "Sheet1", ~5 data rows; used for shape/value checks.
  - snitch_electrical.xlsx -- sheet "6. Electrical", 200+ rows; used for has_more / pagination.
"""
from __future__ import annotations

import datetime
import os
import shutil
import tempfile
import unittest
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.sheet_preview import (
    _derive_s3_key,
    _fetch_boq_file_to_tempfile,
    _to_json_serializable,
    get_sheet_preview,
    get_sheet_preview_full,
)

# ---------------------------------------------------------------------------
# Fixture paths
# ---------------------------------------------------------------------------

_FIXTURE_DIR = os.path.realpath(
    os.path.join(
        os.path.dirname(__file__),
        "..", "..", "..",  # api/boq/wizard → nirmaan_stack/
        "services", "boq_parser", "tests", "fixtures",
    )
)
_SIMPLE_FIXTURE = os.path.join(_FIXTURE_DIR, "synthetic_simple.xlsx")
_LARGE_FIXTURE = os.path.join(_FIXTURE_DIR, "snitch_electrical.xlsx")

# Known metadata from generate_synthetic.py:
#   synthetic_simple.xlsx -- sheet "Sheet1", rows 1-5, A1="Sl.No.", B2="First item"
_SIMPLE_SHEET = "Sheet1"
_SIMPLE_KNOWN_A1 = "Sl.No."
_SIMPLE_KNOWN_B2 = "First item"

# snitch_electrical.xlsx -- parsed config shows sheet "6. Electrical" with 200+ rows
_LARGE_SHEET = "6. Electrical"

# Fake S3 private file URL (key param is parseable by _derive_s3_key)
_FAKE_S3_URL = (
    "/api/method/frappe_s3_attachment.controller.generate_file"
    "?key=TEST_S3_KEY_ABCD1234&file_name=test_boq.xlsx"
)


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

def _make_project():
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_PREVIEW_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


def _make_boq_with_url(project_name: str, source_file_url: str = _FAKE_S3_URL):
    boq = frappe.new_doc("BOQs")
    boq.project = project_name
    boq.boq_name = "Preview Test BoQ"
    boq.tax_treatment = "Pre-tax"
    boq.source_file_url = source_file_url
    boq.insert(ignore_permissions=True)
    frappe.db.commit()
    return boq


def _cleanup_project(project_name: str):
    for row in frappe.get_all("BOQs", filters={"project": project_name}, fields=["name"]):
        frappe.delete_doc("BOQs", row.name, force=True, ignore_permissions=True)
    frappe.delete_doc("Projects", project_name, force=True, ignore_permissions=True)
    frappe.db.commit()


def _make_fixture_copy_fetcher(fixture_path: str):
    """Return a side_effect callable that copies fixture → fresh tempfile each call.

    The endpoint's finally block will os.unlink the returned path; the original
    fixture is never touched.
    """
    def _fetcher(source_file_url: str) -> str:
        tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
        tmp.close()
        shutil.copy2(fixture_path, tmp.name)
        return tmp.name

    return _fetcher


_PATCH_TARGET = "nirmaan_stack.api.boq.wizard.sheet_preview._fetch_boq_file_to_tempfile"


# ---------------------------------------------------------------------------
# TestDeriveS3Key  (helper unit tests — no BOQs DB rows needed)
# ---------------------------------------------------------------------------

class TestDeriveS3Key(FrappeTestCase):

    def test_parse_key_from_private_url(self):
        url = (
            "/api/method/frappe_s3_attachment.controller.generate_file"
            "?key=2026%2F05%2F31%2FBOQs%2FABC12345_test.xlsx&file_name=test.xlsx"
        )
        key = _derive_s3_key(url)
        self.assertEqual(key, "2026/05/31/BOQs/ABC12345_test.xlsx")

    def test_fallback_to_file_doc_content_hash(self):
        url = "/files/some_local_path.xlsx"  # no key= param
        with patch("frappe.db.get_value", return_value="fallback_s3_key") as mock_gv:
            key = _derive_s3_key(url)
        self.assertEqual(key, "fallback_s3_key")
        mock_gv.assert_called_once_with("File", {"file_url": url}, "content_hash")

    def test_throws_when_no_key_derivable(self):
        url = "/files/no_key.xlsx"
        with patch("frappe.db.get_value", return_value=None):
            with self.assertRaises(Exception):  # frappe.ValidationError
                _derive_s3_key(url)


# ---------------------------------------------------------------------------
# TestToJsonSerializable  (pure-Python, no DB)
# ---------------------------------------------------------------------------

class TestToJsonSerializable(unittest.TestCase):

    def test_primitives_pass_through(self):
        self.assertIsNone(_to_json_serializable(None))
        self.assertEqual(_to_json_serializable(42), 42)
        self.assertAlmostEqual(_to_json_serializable(3.14), 3.14)
        self.assertEqual(_to_json_serializable("hello"), "hello")
        self.assertIs(_to_json_serializable(True), True)
        self.assertIs(_to_json_serializable(False), False)

    def test_datetime_to_isoformat(self):
        dt = datetime.datetime(2026, 5, 31, 10, 30, 0)
        self.assertEqual(_to_json_serializable(dt), "2026-05-31T10:30:00")

    def test_date_to_isoformat(self):
        d = datetime.date(2026, 5, 31)
        self.assertEqual(_to_json_serializable(d), "2026-05-31")

    def test_timedelta_to_str(self):
        td = datetime.timedelta(days=2, hours=3)
        result = _to_json_serializable(td)
        self.assertIsInstance(result, str)
        self.assertIn("2", result)  # "2 days, 3:00:00"

    def test_unknown_type_falls_back_to_str(self):
        class Weird:
            def __str__(self):
                return "weird_value"
        self.assertEqual(_to_json_serializable(Weird()), "weird_value")


# ---------------------------------------------------------------------------
# TestGetSheetPreviewShape  (synthetic_simple.xlsx — shape + value correctness)
# ---------------------------------------------------------------------------

class TestGetSheetPreviewShape(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        self.boq = _make_boq_with_url(self.__class__.test_project.name)
        self.patcher = patch(
            _PATCH_TARGET,
            side_effect=_make_fixture_copy_fetcher(_SIMPLE_FIXTURE),
        )
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def test_response_keys_present(self):
        result = get_sheet_preview(
            boq_name=self.boq.name, sheet_name=_SIMPLE_SHEET, start_row=1, end_row=40
        )
        for key in ("sheet_name", "start_row", "end_row_requested", "rows", "returned_count", "has_more"):
            self.assertIn(key, result, f"Missing key: {key}")
        self.assertEqual(result["sheet_name"], _SIMPLE_SHEET)
        self.assertEqual(result["start_row"], 1)
        self.assertEqual(result["end_row_requested"], 40)

    def test_row_numbers_sequential_and_in_range(self):
        result = get_sheet_preview(
            boq_name=self.boq.name, sheet_name=_SIMPLE_SHEET, start_row=1, end_row=40
        )
        rows = result["rows"]
        self.assertGreater(len(rows), 0)
        for i, row in enumerate(rows):
            self.assertIn("row_number", row)
            self.assertIn("cells", row)
            self.assertGreaterEqual(row["row_number"], 1)
            self.assertLessEqual(row["row_number"], 40)
            if i > 0:
                self.assertGreater(row["row_number"], rows[i - 1]["row_number"])

    def test_cells_use_excel_column_letters(self):
        result = get_sheet_preview(
            boq_name=self.boq.name, sheet_name=_SIMPLE_SHEET, start_row=1, end_row=5
        )
        for row in result["rows"]:
            for col_key in row["cells"].keys():
                self.assertTrue(
                    col_key.isalpha() and col_key.isupper(),
                    f"col key {col_key!r} is not an uppercase letter(s)",
                )

    def test_known_cell_value_row1_col_a(self):
        result = get_sheet_preview(
            boq_name=self.boq.name, sheet_name=_SIMPLE_SHEET, start_row=1, end_row=5
        )
        # Row 1 must be present (it has data)
        row1 = next((r for r in result["rows"] if r["row_number"] == 1), None)
        self.assertIsNotNone(row1, "Row 1 not found in result")
        self.assertEqual(row1["cells"].get("A"), _SIMPLE_KNOWN_A1)


# ---------------------------------------------------------------------------
# TestGetSheetPreviewPagination  (snitch_electrical.xlsx — many-row fixture)
# ---------------------------------------------------------------------------

class TestGetSheetPreviewPagination(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        self.boq = _make_boq_with_url(self.__class__.test_project.name)
        self.patcher = patch(
            _PATCH_TARGET,
            side_effect=_make_fixture_copy_fetcher(_LARGE_FIXTURE),
        )
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def test_second_window_row_numbers_start_at_41(self):
        result = get_sheet_preview(
            boq_name=self.boq.name, sheet_name=_LARGE_SHEET, start_row=41, end_row=80
        )
        self.assertGreater(result["returned_count"], 0)
        for row in result["rows"]:
            self.assertGreaterEqual(row["row_number"], 41)
            self.assertLessEqual(row["row_number"], 80)
        self.assertEqual(result["start_row"], 41)

    def test_window_cap_clamped_silently(self):
        # Request 500 rows — should be clamped to 200 without raising an error.
        result = get_sheet_preview(
            boq_name=self.boq.name, sheet_name=_LARGE_SHEET, start_row=1, end_row=500
        )
        self.assertEqual(result["end_row_requested"], 200)  # 1 + 200 - 1
        self.assertLessEqual(result["returned_count"], 200)


# ---------------------------------------------------------------------------
# TestGetSheetPreviewHasMore
# ---------------------------------------------------------------------------

class TestGetSheetPreviewHasMore(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        self.boq = _make_boq_with_url(self.__class__.test_project.name)

    def tearDown(self):
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def test_has_more_true_first_window_of_large_sheet(self):
        with patch(_PATCH_TARGET, side_effect=_make_fixture_copy_fetcher(_LARGE_FIXTURE)):
            result = get_sheet_preview(
                boq_name=self.boq.name, sheet_name=_LARGE_SHEET, start_row=1, end_row=40
            )
        self.assertTrue(result["has_more"], "Expected has_more=True for large sheet first window")

    def test_has_more_false_when_requesting_past_end_of_small_sheet(self):
        # synthetic_simple.xlsx has max_row ~5; requesting rows 1-100 gives has_more=False
        with patch(_PATCH_TARGET, side_effect=_make_fixture_copy_fetcher(_SIMPLE_FIXTURE)):
            result = get_sheet_preview(
                boq_name=self.boq.name, sheet_name=_SIMPLE_SHEET, start_row=1, end_row=100
            )
        self.assertFalse(result["has_more"], "Expected has_more=False past end of small sheet")

    def test_end_of_sheet_returns_fewer_rows(self):
        # Requesting 100 rows from a ~5-row sheet gives returned_count < 100
        with patch(_PATCH_TARGET, side_effect=_make_fixture_copy_fetcher(_SIMPLE_FIXTURE)):
            result = get_sheet_preview(
                boq_name=self.boq.name, sheet_name=_SIMPLE_SHEET, start_row=1, end_row=100
            )
        self.assertLess(result["returned_count"], 100)
        self.assertFalse(result["has_more"])


# ---------------------------------------------------------------------------
# TestGetSheetPreviewNegative
# ---------------------------------------------------------------------------

class TestGetSheetPreviewNegative(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        cls.boq = _make_boq_with_url(cls.test_project.name)
        # A BOQs row with no source_file_url for the "empty URL" test
        cls.boq_no_url = _make_boq_with_url(cls.test_project.name, source_file_url="")

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def test_missing_boq_name_throws(self):
        with self.assertRaises(Exception):
            get_sheet_preview(boq_name=None, sheet_name=_SIMPLE_SHEET)

    def test_missing_sheet_name_throws(self):
        with self.assertRaises(Exception):
            get_sheet_preview(boq_name=self.boq.name, sheet_name=None)

    def test_nonexistent_boq_throws(self):
        with self.assertRaises(Exception):
            get_sheet_preview(
                boq_name="DOES-NOT-EXIST-XYZZY-9999",
                sheet_name=_SIMPLE_SHEET,
            )

    def test_nonexistent_sheet_name_throws(self):
        with patch(_PATCH_TARGET, side_effect=_make_fixture_copy_fetcher(_SIMPLE_FIXTURE)):
            with self.assertRaises(Exception):
                get_sheet_preview(
                    boq_name=self.boq.name,
                    sheet_name="NONEXISTENT SHEET XYZ",
                )

    def test_empty_source_file_url_throws(self):
        with self.assertRaises(Exception):
            get_sheet_preview(
                boq_name=self.boq_no_url.name,
                sheet_name=_SIMPLE_SHEET,
            )

    def test_whitespace_mismatch_throws(self):
        # Sheet name must match VERBATIM -- a leading space is not the same sheet.
        with patch(_PATCH_TARGET, side_effect=_make_fixture_copy_fetcher(_SIMPLE_FIXTURE)):
            with self.assertRaises(Exception):
                get_sheet_preview(
                    boq_name=self.boq.name,
                    sheet_name=" " + _SIMPLE_SHEET,  # leading-space mismatch
                )


# ---------------------------------------------------------------------------
# TestGetSheetPreviewFull  (single-pass full-sheet read; additive sibling)
# ---------------------------------------------------------------------------

def _gather_windowed_rows(boq_name: str, sheet_name: str, window: int = 200):
    """Concatenate get_sheet_preview's rows across every 200-row window of a sheet.

    Walks start=1, then start=end+1, until has_more is False.  This reproduces what
    the parent-picker's windowed loop yields, so the result is the contract the new
    single-pass endpoint must reproduce byte-for-byte.
    """
    all_rows = []
    start = 1
    while True:
        end = start + window - 1
        res = get_sheet_preview(
            boq_name=boq_name, sheet_name=sheet_name, start_row=start, end_row=end
        )
        all_rows.extend(res["rows"])
        if not res["has_more"]:
            break
        start = res["end_row_requested"] + 1
    return all_rows


class TestGetSheetPreviewFull(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        self.boq = _make_boq_with_url(self.__class__.test_project.name)

    def tearDown(self):
        if frappe.db.exists("BOQs", self.boq.name):
            frappe.delete_doc("BOQs", self.boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    # -- T1: every row returned, no 200-row cap --------------------------------
    def test_all_rows_returned_no_200_cap(self):
        with patch(_PATCH_TARGET, side_effect=_make_fixture_copy_fetcher(_LARGE_FIXTURE)):
            result = get_sheet_preview_full(
                boq_name=self.boq.name, sheet_name=_LARGE_SHEET
            )
        self.assertEqual(result["sheet_name"], _LARGE_SHEET)
        self.assertEqual(result["returned_count"], len(result["rows"]))
        # snitch_electrical "6. Electrical" has 200+ content rows -- proves no window cap.
        self.assertGreater(
            result["returned_count"], 200,
            "Full read should return all 200+ rows, not a single 200-row window",
        )
        self.assertFalse(result["has_more"], "A full read never has anything 'more'")

    # -- T2: byte-identity to the concatenated windowed path (correctness keystone)
    def test_byte_identity_to_windowed_path(self):
        with patch(_PATCH_TARGET, side_effect=_make_fixture_copy_fetcher(_LARGE_FIXTURE)):
            windowed = _gather_windowed_rows(self.boq.name, _LARGE_SHEET)
            full = get_sheet_preview_full(
                boq_name=self.boq.name, sheet_name=_LARGE_SHEET
            )["rows"]
        # Exact equality: same order, same row_numbers, same cells dicts.
        self.assertEqual(
            full, windowed,
            "Single-pass rows must be byte-identical to the concatenated windowed path",
        )

    # -- T3: blank rows skipped, not emitted (non-contiguous row_numbers) -------
    def test_blank_rows_skipped_noncontiguous(self):
        # synthetic_simple.xlsx has data on rows 1,2,3,5 -- row 4 is blank.
        with patch(_PATCH_TARGET, side_effect=_make_fixture_copy_fetcher(_SIMPLE_FIXTURE)):
            full = get_sheet_preview_full(
                boq_name=self.boq.name, sheet_name=_SIMPLE_SHEET
            )
            windowed = _gather_windowed_rows(self.boq.name, _SIMPLE_SHEET)
        row_numbers = [r["row_number"] for r in full["rows"]]
        # Strictly ascending + the blank row 4 is absent (skipped, not emitted).
        self.assertEqual(
            row_numbers, sorted(set(row_numbers)),
            "row_numbers must be strictly ascending with no duplicates",
        )
        self.assertNotIn(4, row_numbers, "Blank row 4 must be skipped, not emitted")
        self.assertEqual(row_numbers, [1, 2, 3, 5])
        # max row_number exceeds the count -> a row was genuinely skipped.
        self.assertGreater(max(row_numbers), len(row_numbers))
        # And the skip pattern matches the windowed path exactly.
        self.assertEqual([r["row_number"] for r in windowed], row_numbers)

    # -- T4: #152 verbatim sheet-name match ------------------------------------
    def test_whitespace_mismatch_throws(self):
        with patch(_PATCH_TARGET, side_effect=_make_fixture_copy_fetcher(_SIMPLE_FIXTURE)):
            with self.assertRaises(Exception):
                get_sheet_preview_full(
                    boq_name=self.boq.name,
                    sheet_name=" " + _SIMPLE_SHEET,  # leading-space mismatch
                )

    # -- T5: negatives (mirror the existing endpoint's throw behaviour) --------
    def test_missing_boq_name_throws(self):
        with self.assertRaises(Exception):
            get_sheet_preview_full(boq_name=None, sheet_name=_SIMPLE_SHEET)

    def test_missing_sheet_name_throws(self):
        with self.assertRaises(Exception):
            get_sheet_preview_full(boq_name=self.boq.name, sheet_name=None)

    def test_nonexistent_boq_throws(self):
        with self.assertRaises(Exception):
            get_sheet_preview_full(
                boq_name="DOES-NOT-EXIST-XYZZY-9999", sheet_name=_SIMPLE_SHEET
            )

    def test_nonexistent_sheet_name_throws(self):
        with patch(_PATCH_TARGET, side_effect=_make_fixture_copy_fetcher(_SIMPLE_FIXTURE)):
            with self.assertRaises(Exception):
                get_sheet_preview_full(
                    boq_name=self.boq.name, sheet_name="NONEXISTENT SHEET XYZ"
                )

    def test_empty_source_file_url_throws(self):
        boq_no_url = _make_boq_with_url(
            self.__class__.test_project.name, source_file_url=""
        )
        try:
            with self.assertRaises(Exception):
                get_sheet_preview_full(
                    boq_name=boq_no_url.name, sheet_name=_SIMPLE_SHEET
                )
        finally:
            frappe.delete_doc("BOQs", boq_no_url.name, force=True, ignore_permissions=True)
            frappe.db.commit()
