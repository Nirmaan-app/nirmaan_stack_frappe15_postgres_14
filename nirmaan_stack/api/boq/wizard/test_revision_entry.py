"""S2 (#1099, ADR-0014 D1/D2) -- revised-BoQ ENTRY tests.

S2 is the user-facing entry + the `BOQs` doc every later carry slice hangs off. These
tests pin the three behaviours the plan calls out plus the server-side guards:

  * ELIGIBILITY (`revision.list_revisable_boqs`) -- same project AND >= 1 committed sheet;
    a partial commit qualifies, a never-committed BOQ is absent, a committed REVISION is
    listed (chains allowed), latest-uploaded first, empty when none qualify.
  * VERSION AUTO-BUMP -- a revision upload reusing the original's boq_name gets version N+1
    for free (the origin-agnostic `boqs.py before_insert`).
  * ZERO DRAFTS -- a revision upload seeds NO sheet_drafts (S3 seeds after the human confirms
    the mapping); the unconfirmed-revision marker is exactly origin=="revision" + empty drafts.
  * ENDPOINT GUARDS -- a bad source_boq (missing / wrong project / uncommitted) is rejected.
  * BYTE-IDENTICAL non-revision path -- a plain upload still seeds drafts.
"""

import os
import shutil
import tempfile
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.revision import (
    _boq_has_committed_sheet,
    list_revisable_boqs,
)
from nirmaan_stack.api.boq.wizard.upload_file import _upload_file_worker, upload_file

_FIXTURE_DIR = os.path.abspath(os.path.join(
    os.path.dirname(__file__),          # api/boq/wizard/
    "..", "..", "..",                    # -> nirmaan_stack/ package dir
    "services", "boq_parser", "tests", "fixtures",
))
_SIMPLE_XLSX = os.path.join(_FIXTURE_DIR, "synthetic_simple.xlsx")
_FAKE_FILE_URL = "/private/files/synthetic_simple.xlsx"


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

def _make_project():
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_REV_ENTRY_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


def _make_boq(project_name, origin="upload", source_boq=None, boq_name=None):
    boq = frappe.new_doc("BOQs")
    boq.project = project_name
    boq.boq_name = boq_name or f"Rev Entry BoQ {origin} {frappe.generate_hash(length=4)}"
    boq.tax_treatment = "Pre-tax"
    if origin:
        boq.origin = origin
    if source_boq:
        boq.source_boq = source_boq
    boq.insert(ignore_permissions=True)
    frappe.db.commit()
    return boq


def _commit_sheet(boq_name, sheet="Electrical", version=1):
    """Insert one CURRENT committed grid row -- the D1 committed-ness signal."""
    grid = frappe.new_doc("BoQ Committed Sheet Grid")
    grid.boq = boq_name
    grid.source_sheet_name = sheet
    grid.sheet_disposition = "grid_and_nodes"
    grid.commit_version = version
    grid.is_current = 1
    grid.committed_at = frappe.utils.now()
    grid.insert(ignore_permissions=True)
    frappe.db.commit()
    return grid


def _make_xlsx_tempfile():
    """Copy the simple fixture into a fresh NamedTemporaryFile; the worker's finally deletes it."""
    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    try:
        with open(_SIMPLE_XLSX, "rb") as src:
            shutil.copyfileobj(src, tmp)
    finally:
        tmp.close()
    return tmp.name


def _cleanup_project(project_name):
    for boq in frappe.get_all("BOQs", filters={"project": project_name}, fields=["name"]):
        for grid in frappe.get_all(
            "BoQ Committed Sheet Grid", filters={"boq": boq.name}, fields=["name"]
        ):
            frappe.delete_doc("BoQ Committed Sheet Grid", grid.name, force=True, ignore_permissions=True)
        for att in frappe.get_all(
            "Nirmaan Attachments",
            filters={"associated_doctype": "BOQs", "associated_docname": boq.name},
            fields=["name"],
        ):
            frappe.delete_doc("Nirmaan Attachments", att.name, force=True, ignore_permissions=True)
        frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
    for att in frappe.get_all(
        "Nirmaan Attachments",
        filters={"associated_doctype": "BOQs", "project": project_name},
        fields=["name"],
    ):
        frappe.delete_doc("Nirmaan Attachments", att.name, force=True, ignore_permissions=True)
    frappe.delete_doc("Projects", project_name, force=True, ignore_permissions=True)
    frappe.db.commit()


# ---------------------------------------------------------------------------
# 1. _boq_has_committed_sheet (the shared eligibility primitive)
# ---------------------------------------------------------------------------

class TestBoqHasCommittedSheet(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_false_without_committed_grid(self):
        boq = _make_boq(self.project.name)
        self.assertFalse(_boq_has_committed_sheet(boq.name))

    def test_true_with_one_current_committed_sheet(self):
        boq = _make_boq(self.project.name)
        _commit_sheet(boq.name)
        self.assertTrue(_boq_has_committed_sheet(boq.name))

    def test_superseded_grid_row_does_not_count(self):
        # is_current=0 (a superseded prior commit) is NOT a committed sheet.
        boq = _make_boq(self.project.name)
        grid = _commit_sheet(boq.name)
        frappe.db.set_value("BoQ Committed Sheet Grid", grid.name, "is_current", 0)
        frappe.db.commit()
        self.assertFalse(_boq_has_committed_sheet(boq.name))


# ---------------------------------------------------------------------------
# 2. list_revisable_boqs (eligibility predicate + ordering + chains)
# ---------------------------------------------------------------------------

class TestListRevisableBoqs(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def tearDown(self):
        # per-test isolation: drop every BOQ + grid but keep the project
        for boq in frappe.get_all("BOQs", filters={"project": self.__class__.project.name}, fields=["name"]):
            for grid in frappe.get_all("BoQ Committed Sheet Grid", filters={"boq": boq.name}, fields=["name"]):
                frappe.delete_doc("BoQ Committed Sheet Grid", grid.name, force=True, ignore_permissions=True)
            frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _names(self, project=None):
        res = list_revisable_boqs(project or self.__class__.project.name)
        return [r["name"] for r in res["revisable"]]

    def test_committed_boq_is_listed_and_partial_commit_qualifies(self):
        boq = _make_boq(self.project.name)
        _commit_sheet(boq.name, sheet="OnlyOneSheet")  # a single committed sheet is enough
        self.assertIn(boq.name, self._names())

    def test_never_committed_boq_is_absent(self):
        boq = _make_boq(self.project.name)
        self.assertNotIn(boq.name, self._names())

    def test_committed_revision_is_listed_chains_allowed(self):
        original = _make_boq(self.project.name)
        _commit_sheet(original.name)
        revision = _make_boq(self.project.name, origin="revision", source_boq=original.name)
        _commit_sheet(revision.name)
        names = self._names()
        self.assertIn(revision.name, names)   # a committed revision is itself revisable
        self.assertIn(original.name, names)

    def test_empty_when_no_committed_boqs(self):
        _make_boq(self.project.name)   # uncommitted only
        self.assertEqual(self._names(), [])

    def test_template_source_seed_excluded(self):
        boq = _make_boq(self.project.name)
        _commit_sheet(boq.name)
        frappe.db.set_value("BOQs", boq.name, "is_template_source", 1)
        frappe.db.commit()
        self.assertNotIn(boq.name, self._names())

    def test_ordered_latest_uploaded_first(self):
        older = _make_boq(self.project.name)
        newer = _make_boq(self.project.name)
        _commit_sheet(older.name)
        _commit_sheet(newer.name)
        # pin distinct uploaded_at (read_only field, set for deterministic ordering)
        frappe.db.set_value("BOQs", older.name, "uploaded_at", "2026-01-01 09:00:00", update_modified=False)
        frappe.db.set_value("BOQs", newer.name, "uploaded_at", "2026-06-01 09:00:00", update_modified=False)
        frappe.db.commit()
        names = self._names()
        self.assertLess(names.index(newer.name), names.index(older.name))

    def test_returns_shape_fields(self):
        boq = _make_boq(self.project.name, boq_name="Shape Check BoQ")
        _commit_sheet(boq.name)
        row = next(r for r in list_revisable_boqs(self.project.name)["revisable"] if r["name"] == boq.name)
        self.assertEqual(row["boq_name"], "Shape Check BoQ")
        self.assertEqual(row["version"], 1)
        self.assertIn("uploaded_at", row)

    def test_other_project_boq_not_listed(self):
        boq = _make_boq(self.project.name)
        _commit_sheet(boq.name)
        other = _make_project()
        try:
            self.assertNotIn(boq.name, self._names(project=other.name))
        finally:
            _cleanup_project(other.name)


# ---------------------------------------------------------------------------
# 3. worker: revision creates origin=revision, N+1 version, ZERO drafts
# ---------------------------------------------------------------------------

class TestRevisionUploadWorker(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def tearDown(self):
        for boq in frappe.get_all("BOQs", filters={"project": self.__class__.project.name}, fields=["name"]):
            for grid in frappe.get_all("BoQ Committed Sheet Grid", filters={"boq": boq.name}, fields=["name"]):
                frappe.delete_doc("BoQ Committed Sheet Grid", grid.name, force=True, ignore_permissions=True)
            for att in frappe.get_all(
                "Nirmaan Attachments",
                filters={"associated_doctype": "BOQs", "associated_docname": boq.name},
                fields=["name"],
            ):
                frappe.delete_doc("Nirmaan Attachments", att.name, force=True, ignore_permissions=True)
            frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _run_worker(self, source_boq=None):
        with patch(
            "nirmaan_stack.api.boq.wizard.upload_file._fetch_boq_file_to_tempfile",
            return_value=_make_xlsx_tempfile(),
        ):
            _upload_file_worker(
                project_id=self.__class__.project.name,
                file_url=_FAKE_FILE_URL,
                file_name="a_fresh_revision.xlsx",
                user="Administrator",
                source_boq=source_boq,
            )

    def test_revision_upload_stamps_origin_and_source_and_reuses_boq_name(self):
        original = _make_boq(self.project.name, boq_name="Shared Revision Name")
        _commit_sheet(original.name)
        self._run_worker(source_boq=original.name)

        revs = frappe.get_all(
            "BOQs",
            filters={"project": self.project.name, "origin": "revision"},
            fields=["name", "origin", "source_boq", "boq_name", "version"],
        )
        self.assertEqual(len(revs), 1)
        rev = revs[0]
        self.assertEqual(rev["origin"], "revision")
        self.assertEqual(rev["source_boq"], original.name)
        self.assertEqual(rev["boq_name"], "Shared Revision Name")   # reused, NOT the filename
        self.assertEqual(rev["version"], original.version + 1)      # N+1 for free (D2)

    def test_revision_upload_seeds_zero_drafts(self):
        original = _make_boq(self.project.name, boq_name="Zero Draft Original")
        _commit_sheet(original.name)
        self._run_worker(source_boq=original.name)

        rev = frappe.get_all(
            "BOQs", filters={"project": self.project.name, "origin": "revision"}, fields=["name"]
        )[0]
        drafts = frappe.get_all("BoQ Sheet Draft", filters={"parent": rev["name"]}, fields=["name"])
        self.assertEqual(len(drafts), 0, "a revision must seed ZERO sheet_drafts (S3 seeds later)")

    def test_non_revision_upload_still_seeds_drafts(self):
        # Byte-identical guardrail: the fresh-upload path is unchanged -> drafts ARE seeded.
        self._run_worker(source_boq=None)
        boq = frappe.get_all(
            "BOQs", filters={"project": self.project.name}, fields=["name", "origin"]
        )[0]
        self.assertEqual(boq["origin"], "upload")
        drafts = frappe.get_all("BoQ Sheet Draft", filters={"parent": boq["name"]}, fields=["name"])
        self.assertGreater(len(drafts), 0, "a fresh upload must still seed drafts")


# ---------------------------------------------------------------------------
# 4. endpoint: source_boq validation (rejects bad picks before enqueue)
# ---------------------------------------------------------------------------

class TestUploadEndpointRevisionValidation(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def tearDown(self):
        frappe.form_dict.pop("project_id", None)
        frappe.form_dict.pop("source_boq", None)

    def test_rejects_nonexistent_source_boq(self):
        frappe.form_dict["project_id"] = self.project.name
        frappe.form_dict["source_boq"] = "BOQ-NONEXISTENT-XYZ"
        with self.assertRaises(frappe.ValidationError):
            upload_file()

    def test_rejects_source_boq_from_another_project(self):
        other = _make_project()
        try:
            src = _make_boq(other.name)
            _commit_sheet(src.name)
            frappe.form_dict["project_id"] = self.project.name
            frappe.form_dict["source_boq"] = src.name
            with self.assertRaises(frappe.ValidationError):
                upload_file()
        finally:
            _cleanup_project(other.name)

    def test_rejects_uncommitted_source_boq(self):
        src = _make_boq(self.project.name)   # no committed sheet
        frappe.form_dict["project_id"] = self.project.name
        frappe.form_dict["source_boq"] = src.name
        with self.assertRaises(frappe.ValidationError):
            upload_file()
