import json
import os
import shutil
import tempfile
import uuid
from unittest.mock import ANY, MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils.background_jobs import execute_job

from nirmaan_stack.api.background_ops import get_status
from nirmaan_stack.api.boq.wizard.upload_file import _upload_file_worker, upload_file
from nirmaan_stack.services.boq_fixture_teardown import purge_boq

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


def _run_worker(workbook=None, **kwargs):
    """Invoke `_upload_file_worker` with the workbook FETCH stubbed to a local fixture copy.

    The worker takes no file path. `cfd691b6` (2026-06-14, "make Upload BoQ work across
    multi-container deploys") moved the fetch INSIDE it -- it now re-fetches from durable
    storage by `file_url`, because the web endpoint and the RQ worker may run in SEPARATE
    containers with no shared /tmp, so a path written by the web process is unreadable there.
    Tests therefore stub the FETCH SEAM instead of handing over a path; this mirrors
    `test_revision_entry._run_worker`.

    (These tests kept passing the removed `tempfile_path=` kwarg for ~5 weeks, erroring with
    TypeError before a single assertion ran -- invisible because the suite is run per module
    and nothing touched this one. Routing every call through one helper is what keeps the next
    signature change a single-line fix instead of eight silent ones.)

    `workbook`: what the stubbed fetch returns; defaults to a fresh copy of the simple fixture.
    Each call gets its OWN copy because the worker's `finally` deletes whatever it is handed.
    Pass an explicit path for the failure branches (the reader is stubbed there anyway).
    """
    with patch(
        "nirmaan_stack.api.boq.wizard.upload_file._fetch_boq_file_to_tempfile",
        return_value=workbook if workbook is not None else _make_xlsx_tempfile(),
    ):
        return _upload_file_worker(**kwargs)


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
        purge_boq(boq.name)  # CU-B: takes the BoQ-linked rows (locks, review rows) delete_doc leaves
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
        _run_worker(
            project_id=self.__class__.test_project.name,
            file_url=_FAKE_FILE_URL,
            file_name="synthetic_simple.xlsx",
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
        _run_worker(
            project_id=self.__class__.test_project.name,
            file_url=_FAKE_FILE_URL,
            file_name="RFQ_Bangalore_HVAC_BOQ.xlsx",
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

        _run_worker(
            project_id=self.__class__.test_project.name,
            file_url=_FAKE_FILE_URL,
            file_name="synthetic_simple.xlsx",
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

    def test_corrupted_xlsx_returns_the_corrupted_outcome(self):
        """Worker returns error_code=corrupted when BoqReader raises; no BOQs row created."""
        with patch(
            "nirmaan_stack.api.boq.wizard.upload_file.BoqReader",
            side_effect=Exception("simulated corrupt file"),
        ):
            outcome = _run_worker(
                workbook="/nonexistent/path/corrupted.xlsx",
                project_id=self.__class__.test_project.name,
                file_url="/private/files/corrupted.xlsx",
                file_name="corrupted.xlsx",
            )
        self.assertEqual(outcome, {"status": "error", "error_code": "corrupted"})

        boq_count = frappe.db.count("BOQs", filters={"project": self.__class__.test_project.name})
        self.assertEqual(boq_count, 0)

    def test_zero_sheets_returns_the_zero_sheets_outcome(self):
        """Worker returns error_code=zero_sheets when list_sheets returns empty; no BOQs row."""
        mock_reader = MagicMock()
        mock_reader.list_sheets.return_value = []
        with patch(
            "nirmaan_stack.api.boq.wizard.upload_file.BoqReader",
            return_value=mock_reader,
        ):
            outcome = _run_worker(
                workbook="/nonexistent/path/zero_sheets.xlsx",
                project_id=self.__class__.test_project.name,
                file_url=_FAKE_FILE_URL,
                file_name="synthetic_simple.xlsx",
            )
        self.assertEqual(outcome, {"status": "error", "error_code": "zero_sheets"})

        boq_count = frappe.db.count("BOQs", filters={"project": self.__class__.test_project.name})
        self.assertEqual(boq_count, 0)


# ---------------------------------------------------------------------------
# Prefill: auto_guess wired into the worker (Step 10.5)
# ---------------------------------------------------------------------------

class TestPrefillSheetConfig(FrappeTestCase):
    """Tests for the Step 10.5 auto-guess prefill added to _upload_file_worker."""

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

    def test_pending_sheet_gets_sheet_config(self):
        """Pending sheet must have a non-None sheet_config containing header_row after upload."""
        _run_worker(
            project_id=self.__class__.test_project.name,
            file_url=_FAKE_FILE_URL,
            file_name="synthetic_simple.xlsx",
        )
        boq = frappe.get_all(
            "BOQs",
            filters={"project": self.__class__.test_project.name},
            fields=["name"],
        )[0]
        pending_drafts = frappe.get_all(
            "BoQ Sheet Draft",
            filters={"parent": boq["name"], "wizard_status": "Pending"},
            fields=["sheet_config"],
        )
        self.assertGreater(len(pending_drafts), 0, "Expected at least one Pending draft")
        for d in pending_drafts:
            cfg = d["sheet_config"]
            self.assertIsNotNone(cfg, "Pending draft must have sheet_config populated")
            # Frappe JSON fields may return a parsed dict or a JSON string; handle both.
            parsed = json.loads(cfg) if isinstance(cfg, str) else cfg
            self.assertIn("header_row", parsed)
            self.assertIsNotNone(parsed["header_row"])

    def test_hidden_sheet_sheet_config_stays_none(self):
        """Hidden sheets must not receive a sheet_config; detect_header_row must not be called."""
        mock_reader = MagicMock()
        mock_reader.list_sheets.return_value = ["Sheet1"]
        mock_reader.list_sheet_states.return_value = {"Sheet1": "hidden"}

        with patch("nirmaan_stack.api.boq.wizard.upload_file.BoqReader", return_value=mock_reader):
            _run_worker(
                project_id=self.__class__.test_project.name,
                file_url=_FAKE_FILE_URL,
                file_name="synthetic_simple.xlsx",
            )

        boq = frappe.get_all(
            "BOQs",
            filters={"project": self.__class__.test_project.name},
            fields=["name"],
        )[0]
        config = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": boq["name"]},
            "sheet_config",
        )
        self.assertIsNone(config, "Hidden sheet must have sheet_config=None")
        # Structural check: detect_header_row never called for non-Pending sheets.
        mock_reader.detect_header_row.assert_not_called()

    def test_auto_guess_failure_does_not_fail_upload(self):
        """auto_guess_sheet_config raising must not abort the upload; sheet_config stays None."""
        with patch(
            "nirmaan_stack.api.boq.wizard.upload_file.auto_guess_sheet_config",
            side_effect=RuntimeError("simulated auto-guess failure"),
        ):
            outcome = _run_worker(
                project_id=self.__class__.test_project.name,
                file_url=_FAKE_FILE_URL,
                file_name="synthetic_simple.xlsx",
            )
        self.assertEqual(outcome, {"boq_name": ANY, "status": "success"})

        boqs = frappe.get_all(
            "BOQs",
            filters={"project": self.__class__.test_project.name},
            fields=["name"],
        )
        self.assertEqual(len(boqs), 1, "BOQs row must still be created despite auto-guess failure")
        config = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": boqs[0]["name"]},
            "sheet_config",
        )
        self.assertIsNone(config, "sheet_config must remain None when auto-guess raises")


# ---------------------------------------------------------------------------
# The upload and the template seed as background operations (#1665, ADR 0047)
# ---------------------------------------------------------------------------

STRANGER = "boq-upload-stranger@example.com"


class TestUploadAsBackgroundOperation(FrappeTestCase):
    """Both flows start through `upload_file` with a browser-made operation id and end in that operation's own
    status record. The queue is faked (`get_queue` hands back a recorder) and the test runs the queued wrapper
    itself, as a worker would; the bucket is the other edge faked (`store_file` and the worker's fetch)."""

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

    def setUp(self):
        frappe.set_user("Administrator")
        self.seed_boqs = []

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        frappe.form_dict.pop("project_id", None)
        frappe.form_dict.pop("is_template_source", None)
        _cleanup_for_project(self.__class__.test_project.name)
        for boq in self.seed_boqs:
            for att in frappe.get_all(
                "Nirmaan Attachments",
                filters={"associated_doctype": "BOQs", "associated_docname": boq},
                fields=["name"],
            ):
                frappe.delete_doc("Nirmaan Attachments", att.name, force=True, ignore_permissions=True)
            purge_boq(boq)
            frappe.delete_doc("BOQs", boq, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _start(self, file_name="synthetic_simple.xlsx", template_seed=False):
        """Post one upload as the screen does; returns (op_id, the queued job)."""
        op_id = str(uuid.uuid4())
        started, stored, queued = self._post(op_id, file_name=file_name, template_seed=template_seed)
        self.assertEqual(started["state"], "queued")
        self.assertEqual(stored, [file_name], "the upload stores its workbook once")
        self.assertEqual(len(queued), 1, "the upload queues exactly one operation")
        return op_id, queued[0]

    def _post(self, op_id, file_name="synthetic_simple.xlsx", template_seed=False):
        """POST `upload_file` with this operation id. Returns (its reply, the file names it stored, the jobs it
        queued); the reply is the exception when the post was refused."""
        if template_seed:
            frappe.form_dict["is_template_source"] = "1"
        else:
            frappe.form_dict["project_id"] = self.__class__.test_project.name
        uploaded = MagicMock()
        uploaded.filename = file_name
        uploaded.read.return_value = b"workbook bytes"
        request = MagicMock()
        request.files = {"file": uploaded}
        stored, queued = [], []

        def store_file(fname, **kwargs):
            stored.append(fname)
            return frappe._dict(file_url=f"/private/files/{fname}")

        with (
            patch.object(frappe, "request", request),
            patch("nirmaan_stack.api.boq.wizard.upload_file.store_file", side_effect=store_file),
            patch("frappe.utils.background_jobs.get_queue") as get_queue,
        ):
            get_queue.return_value.enqueue_call.side_effect = lambda func, **kw: queued.append(kw)
            get_queue.return_value.count = 0
            try:
                reply = upload_file(op_id=op_id)
            except (frappe.ValidationError, frappe.PermissionError) as refused:
                reply = refused
            frappe.db.commit()
        frappe.form_dict.pop("is_template_source", None)
        return reply, stored, queued

    def test_an_operation_id_that_is_not_one_is_refused_before_the_workbook_is_stored(self):
        reply, stored, queued = self._post("not-an-operation-id")
        self.assertIsInstance(reply, frappe.ValidationError)
        self.assertEqual((stored, queued), ([], []), "a refused upload stored its workbook in the bucket")

    def test_an_id_another_user_used_is_refused_before_the_workbook_is_stored(self):
        op_id, _ = self._start(file_name="First_Users.xlsx")

        frappe.set_user(STRANGER)
        reply, stored, queued = self._post(op_id, file_name="Strangers.xlsx")
        self.assertIsInstance(reply, frappe.PermissionError)
        self.assertEqual((stored, queued), ([], []), "a refused upload stored its workbook in the bucket")

    def test_the_same_users_repeat_returns_the_existing_operation_without_storing_again(self):
        op_id, _ = self._start(file_name="Tower_A_Civil.xlsx")
        first = get_status(op_id=op_id)

        reply, stored, queued = self._post(op_id, file_name="Tower_A_Civil.xlsx")
        self.assertEqual((reply["op_id"], reply["state"], reply["enqueued_at"]),
                         (op_id, "queued", first["enqueued_at"]))
        self.assertEqual((stored, queued), ([], []), "a repeated post stored the workbook again")

    def _work_off(self, job, fetch=None):
        """Run the queued wrapper as a worker does (it starts as no particular user)."""
        fetch = fetch or (lambda url: _make_xlsx_tempfile())
        with patch("nirmaan_stack.api.boq.wizard.upload_file._fetch_boq_file_to_tempfile", side_effect=fetch):
            frappe.set_user("Guest")
            execute_job(**{**job["kwargs"], "is_async": False})
        frappe.set_user("Administrator")

    def test_an_upload_finishes_in_its_own_record_with_the_boq_it_made(self):
        op_id, job = self._start(file_name="Tower_A_Civil.xlsx")
        self._work_off(job)

        status = get_status(op_id=op_id)
        self.assertEqual(status["state"], "finished", status.get("error"))
        self.assertEqual(status["result"]["status"], "success")
        boq = status["result"]["boq_name"]
        self.assertEqual(frappe.db.get_value("BOQs", boq, "project"), self.__class__.test_project.name)
        self.assertEqual(frappe.db.get_value("BOQs", boq, "boq_name"), "Tower A Civil")
        self.assertTrue(
            frappe.db.exists("Nirmaan Attachments", {"associated_doctype": "BOQs", "associated_docname": boq}),
            "the upload still records its source file as a Nirmaan Attachment",
        )

    def test_a_template_seed_finishes_in_its_own_record_with_a_project_less_boq(self):
        op_id, job = self._start(file_name="Seed_Template.xlsx", template_seed=True)
        self._work_off(job)

        status = get_status(op_id=op_id)
        self.assertEqual(status["state"], "finished", status.get("error"))
        boq = status["result"]["boq_name"]
        self.seed_boqs.append(boq)
        self.assertEqual(frappe.db.get_value("BOQs", boq, "is_template_source"), 1)
        self.assertIsNone(frappe.db.get_value("BOQs", boq, "project"))

    def test_one_uploads_failure_ends_only_its_own_record(self):
        failing, failing_job = self._start(file_name="Broken_Fetch.xlsx")
        other, other_job = self._start(file_name="Still_Fine.xlsx")

        def fetch_fails(url):
            raise ConnectionError("the bucket is unreachable")

        with patch("frappe.log_error"):
            self._work_off(failing_job, fetch=fetch_fails)
        self.assertEqual(get_status(op_id=failing)["state"], "failed")
        self.assertEqual(get_status(op_id=other)["state"], "queued", "another upload is not ended by this failure")

        self._work_off(other_job)
        self.assertEqual(get_status(op_id=other)["state"], "finished")
        self.assertEqual(get_status(op_id=failing)["state"], "failed")

    def test_an_unreadable_workbook_finishes_with_the_corrupted_code_and_no_boq(self):
        op_id, job = self._start(file_name="unreadable.xlsx")
        with (
            patch(
                "nirmaan_stack.api.boq.wizard.upload_file.BoqReader",
                side_effect=Exception("simulated corrupt file"),
            ),
            patch("frappe.log_error"),
        ):
            self._work_off(job, fetch=lambda url: "/nonexistent/path/unreadable.xlsx")

        status = get_status(op_id=op_id)
        self.assertEqual(status["state"], "finished")
        self.assertEqual(status["result"], {"status": "error", "error_code": "corrupted"})
        self.assertEqual(frappe.db.count("BOQs", filters={"project": self.__class__.test_project.name}), 0)

    def test_a_stranger_cannot_read_anothers_upload(self):
        op_id, job = self._start()
        self._work_off(job)

        frappe.set_user(STRANGER)
        with self.assertRaises(frappe.PermissionError):
            get_status(op_id=op_id)
