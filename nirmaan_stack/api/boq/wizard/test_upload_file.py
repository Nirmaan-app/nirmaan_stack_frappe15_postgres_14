import os
import shutil
import tempfile
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.upload_file import _upload_file_worker, upload_file

_FIXTURE_DIR = os.path.abspath(os.path.join(
    os.path.dirname(__file__),  # api/boq/wizard/
    "..", "..", "..",            # → nirmaan_stack/ package dir
    "services", "boq_parser", "tests", "fixtures",
))
_SIMPLE_XLSX = os.path.join(_FIXTURE_DIR, "synthetic_simple.xlsx")
_FAKE_FILE_URL = "/private/files/synthetic_simple.xlsx"


def _make_xlsx_tempfile():
    """Copy _SIMPLE_XLSX into a fresh NamedTemporaryFile; worker's finally will delete it."""
    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    try:
        shutil.copyfileobj(open(_SIMPLE_XLSX, "rb"), tmp)
    finally:
        tmp.close()
    return tmp.name


def _make_project_fixture():
    """Create a Projects row with the minimal fields needed to satisfy legacy hooks."""
    # Test fixture placeholders. Production code does NOT create Projects rows --
    # wizard delegates project creation to the existing Nirmaan new-project
    # workflow. These values satisfy the legacy Projects.after_insert
    # (generate_pwm) hook for the purposes of test isolation only.
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_BOQ_WIZARD_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


def _cleanup_for_project(project_name):
    """Delete all BOQs, linked Nirmaan Attachments, and the project."""
    for boq in frappe.get_all("BOQs", filters={"project": project_name}, fields=["name"]):
        for att in frappe.get_all(
            "Nirmaan Attachments",
            filters={"associated_doctype": "BOQs", "associated_docname": boq.name},
            fields=["name"],
        ):
            frappe.delete_doc("Nirmaan Attachments", att.name, force=True, ignore_permissions=True)
        frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
    # Orphaned attachments (corrupted/zero_sheets cases where BOQs row was never created)
    for att in frappe.get_all(
        "Nirmaan Attachments",
        filters={"associated_doctype": "BOQs", "project": project_name},
        fields=["name"],
    ):
        frappe.delete_doc("Nirmaan Attachments", att.name, force=True, ignore_permissions=True)
    frappe.db.commit()


class TestUploadFileWorkerPositive(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project_fixture()

    @classmethod
    def tearDownClass(cls):
        _cleanup_for_project(cls.test_project.name)
        frappe.delete_doc("Projects", cls.test_project.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def tearDown(self):
        # Clean up BOQs (and their attachments) between tests for isolation.
        _cleanup_for_project(self.__class__.test_project.name)
        # Re-commit cleanup so the next test starts fresh.
        frappe.db.commit()

    def test_boq_created_correct_fields(self):
        """Worker creates BOQs row with wizard_state=In progress and populates sheet_drafts."""
        _upload_file_worker(
            project_id=self.__class__.test_project.name,
            tempfile_path=_make_xlsx_tempfile(),
            file_url=_FAKE_FILE_URL,
            file_name="synthetic_simple.xlsx",
            user="Administrator",
        )
        boqs = frappe.get_all(
            "BOQs",
            filters={"project": self.__class__.test_project.name},
            fields=["name", "wizard_state", "boq_name", "version", "tax_treatment"],
        )
        self.assertEqual(len(boqs), 1)
        row = boqs[0]
        self.assertEqual(row["wizard_state"], "In progress")
        self.assertEqual(row["tax_treatment"], "Pre-tax")
        self.assertEqual(row["version"], 1)

        drafts = frappe.get_all(
            "BoQ Sheet Draft",
            filters={"parent": row["name"]},
            fields=["sheet_name", "sheet_order", "wizard_status"],
            order_by="sheet_order asc",
        )
        self.assertGreater(len(drafts), 0)
        self.assertEqual(drafts[0]["sheet_order"], 1)
        self.assertIn(drafts[0]["wizard_status"], {"Pending", "Hidden"})

    def test_filename_underscores_to_spaces(self):
        """File name with underscores produces boq_name with spaces."""
        _upload_file_worker(
            project_id=self.__class__.test_project.name,
            tempfile_path=_make_xlsx_tempfile(),
            file_url=_FAKE_FILE_URL,
            file_name="RFQ_Bangalore_HVAC_BOQ.xlsx",
            user="Administrator",
        )
        boq_name_val = frappe.db.get_value(
            "BOQs",
            {"project": self.__class__.test_project.name},
            "boq_name",
        )
        self.assertEqual(boq_name_val, "RFQ Bangalore HVAC BOQ")

    def test_version_auto_increment(self):
        """Second upload with same (project, boq_name) gets version=2 via BOQs.before_insert."""
        # Create a prior BOQs row; before_insert computes version=1 (no prior rows exist).
        prior = frappe.new_doc("BOQs")
        prior.project = self.__class__.test_project.name
        prior.boq_name = "synthetic simple"
        prior.tax_treatment = "Pre-tax"
        prior.insert(ignore_permissions=True)
        frappe.db.commit()

        _upload_file_worker(
            project_id=self.__class__.test_project.name,
            tempfile_path=_make_xlsx_tempfile(),
            file_url=_FAKE_FILE_URL,
            file_name="synthetic_simple.xlsx",
            user="Administrator",
        )

        versions = sorted(
            r["version"]
            for r in frappe.get_all(
                "BOQs",
                filters={"project": self.__class__.test_project.name, "boq_name": "synthetic simple"},
                fields=["version"],
            )
        )
        self.assertIn(2, versions)


class TestUploadFileEndpointNegative(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project_fixture()

    @classmethod
    def tearDownClass(cls):
        _cleanup_for_project(cls.test_project.name)
        frappe.delete_doc("Projects", cls.test_project.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def tearDown(self):
        frappe.form_dict.pop("project_id", None)

    def test_missing_project_id_throws(self):
        frappe.form_dict["project_id"] = ""
        with self.assertRaises(frappe.ValidationError):
            upload_file()

    def test_nonexistent_project_throws(self):
        frappe.form_dict["project_id"] = "NONEXISTENT_PROJECT_XYZ"
        with self.assertRaises(frappe.ValidationError):
            upload_file()

    def test_wrong_extension_throws(self):
        frappe.form_dict["project_id"] = self.__class__.test_project.name
        mock_file = MagicMock()
        mock_file.filename = "document.pdf"
        mock_request = MagicMock()
        mock_request.files = {"file": mock_file}
        with patch.object(frappe, "request", mock_request):
            with self.assertRaises(frappe.ValidationError):
                upload_file()

    def test_file_too_large_throws(self):
        frappe.form_dict["project_id"] = self.__class__.test_project.name
        mock_file = MagicMock()
        mock_file.filename = "bigfile.xlsx"
        mock_file.read.return_value = b"x" * (26 * 1024 * 1024)  # 26 MB
        mock_request = MagicMock()
        mock_request.files = {"file": mock_file}
        with patch.object(frappe, "request", mock_request):
            with self.assertRaises(frappe.ValidationError):
                upload_file()


class TestUploadFileWorkerNegative(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project_fixture()

    @classmethod
    def tearDownClass(cls):
        _cleanup_for_project(cls.test_project.name)
        frappe.delete_doc("Projects", cls.test_project.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def tearDown(self):
        _cleanup_for_project(self.__class__.test_project.name)
        frappe.db.commit()

    def test_corrupted_xlsx_publishes_error(self):
        """Worker publishes error_code=corrupted when BoqReader raises; no BOQs row created."""
        with patch(
            "nirmaan_stack.api.boq.wizard.upload_file.BoqReader",
            side_effect=Exception("simulated corrupt file"),
        ):
            with patch("frappe.publish_realtime") as mock_pub:
                _upload_file_worker(
                    project_id=self.__class__.test_project.name,
                    tempfile_path="/nonexistent/path/corrupted.xlsx",
                    file_url="/private/files/corrupted.xlsx",
                    file_name="corrupted.xlsx",
                    user="Administrator",
                )
                mock_pub.assert_any_call(
                    "boq:wizard_parse_done",
                    {"status": "error", "error_code": "corrupted"},
                )

        boq_count = frappe.db.count("BOQs", filters={"project": self.__class__.test_project.name})
        self.assertEqual(boq_count, 0)

    def test_zero_sheets_publishes_error(self):
        """Worker publishes error_code=zero_sheets when list_sheets returns empty; no BOQs row."""
        mock_reader = MagicMock()
        mock_reader.list_sheets.return_value = []
        with patch(
            "nirmaan_stack.api.boq.wizard.upload_file.BoqReader",
            return_value=mock_reader,
        ):
            with patch("frappe.publish_realtime") as mock_pub:
                _upload_file_worker(
                    project_id=self.__class__.test_project.name,
                    tempfile_path="/nonexistent/path/zero_sheets.xlsx",
                    file_url=_FAKE_FILE_URL,
                    file_name="synthetic_simple.xlsx",
                    user="Administrator",
                )
                mock_pub.assert_any_call(
                    "boq:wizard_parse_done",
                    {"status": "error", "error_code": "zero_sheets"},
                )

        boq_count = frappe.db.count("BOQs", filters={"project": self.__class__.test_project.name})
        self.assertEqual(boq_count, 0)
