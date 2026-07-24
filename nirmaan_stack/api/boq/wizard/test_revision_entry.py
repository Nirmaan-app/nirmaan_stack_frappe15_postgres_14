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
    convert_revision_entry,
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
        # `origin` feeds the picker's Type badge. Dropping it does not error -- the badge just
        # silently reads every row as "Original Upload" -- so the key is pinned here.
        self.assertEqual(row["origin"], "upload")

    def test_origin_is_returned_raw_so_a_chain_shows_as_a_revision(self):
        original = _make_boq(self.project.name)
        _commit_sheet(original.name)
        revision = _make_boq(self.project.name, origin="revision", source_boq=original.name)
        _commit_sheet(revision.name)
        by_name = {r["name"]: r for r in list_revisable_boqs(self.project.name)["revisable"]}
        self.assertEqual(by_name[revision.name]["origin"], "revision")
        self.assertEqual(by_name[original.name]["origin"], "upload")

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


# ---------------------------------------------------------------------------
# 5. convert_revision_entry -- entry un-lock (ADR-0014 A1, Amendment B W3)
# ---------------------------------------------------------------------------

class TestConvertRevisionEntry(FrappeTestCase):
    """The New <-> Revise flip AFTER upload, in both directions.

    `origin`/`source_boq` used to be baked at insert and the radio froze the moment the file
    dropped -- and only in the frontend (`BoqMasterPanel`'s `entryLocked`); the server never
    enforced it. These tests pin the whole round trip, because the risky part is not the flag
    flip: it is that converting CHANGES `boq_name` (a revision reuses the original's), which
    changes the version scope, AFTER `before_insert` already computed a version against the old
    name. `next_boq_version` is shared with the controller for exactly that reason.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def setUp(self):
        self._file_rows = []

    def tearDown(self):
        for name in self._file_rows:
            frappe.delete_doc("File", name, force=True, ignore_permissions=True)
        for boq in frappe.get_all(
            "BOQs", filters={"project": self.__class__.project.name}, fields=["name"]
        ):
            for grid in frappe.get_all(
                "BoQ Committed Sheet Grid", filters={"boq": boq.name}, fields=["name"]
            ):
                frappe.delete_doc(
                    "BoQ Committed Sheet Grid", grid.name, force=True, ignore_permissions=True
                )
            for att in frappe.get_all(
                "Nirmaan Attachments",
                filters={"associated_doctype": "BOQs", "associated_docname": boq.name},
                fields=["name"],
            ):
                frappe.delete_doc(
                    "Nirmaan Attachments", att.name, force=True, ignore_permissions=True
                )
            frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _upload_new(self, file_name="a_fresh_revision.xlsx"):
        """Run the real upload worker as a NEW BoQ and return its docname.

        Creates a real `File` row for the upload, because that is where Revise -> New reads the
        original filename back from -- in production `save_file(file_name, ...)` always leaves
        one. The class-level `_FAKE_FILE_URL` is deliberately NOT reused: it is a fixed URL
        whose basename ('synthetic_simple') has nothing to do with the `file_name` the worker is
        handed, so it would silently exercise the degraded basename fallback instead of the real
        path. Each upload therefore gets its own matching URL.
        """
        # Store the workbook exactly as the upload endpoint does (`save_file`), so the File row
        # and its URL are consistent and the convert path reads a real one.
        from frappe.utils.file_manager import save_file  # noqa: PLC0415

        with open(_SIMPLE_XLSX, "rb") as src:
            file_doc = save_file(file_name, src.read(), "Projects", self.project.name,
                                 is_private=1)
        self._file_rows.append(file_doc.name)
        file_url = file_doc.file_url
        with patch(
            "nirmaan_stack.api.boq.wizard.upload_file._fetch_boq_file_to_tempfile",
            return_value=_make_xlsx_tempfile(),
        ):
            _upload_file_worker(
                project_id=self.__class__.project.name,
                file_url=file_url,
                file_name=file_name,
                user="Administrator",
                source_boq=None,
            )
        return frappe.get_all(
            "BOQs",
            filters={"project": self.project.name, "origin": "upload"},
            fields=["name"],
            order_by="creation desc",
        )[0]["name"]

    def _convert(self, boq, mode, source_boq=None, file_name=None):
        # The Revise -> New re-seed re-reads the workbook through sheet_preview's fetcher.
        with patch(
            "nirmaan_stack.api.boq.wizard.sheet_preview._fetch_boq_file_to_tempfile",
            side_effect=lambda url: _make_xlsx_tempfile(),
        ):
            return convert_revision_entry(
                boq=boq, mode=mode, source_boq=source_boq, file_name=file_name
            )

    def _revisable_original(self, boq_name="Convert Original"):
        original = _make_boq(self.project.name, boq_name=boq_name)
        _commit_sheet(original.name)
        return original

    # ── New -> Revise ────────────────────────────────────────────────────────
    def test_new_to_revise_adopts_origin_source_and_the_originals_name(self):
        original = self._revisable_original()
        boq = self._upload_new()
        res = self._convert(boq, "revise", original.name)
        self.assertEqual(res["origin"], "revision")
        self.assertEqual(res["source_boq"], original.name)
        self.assertEqual(res["boq_name"], "Convert Original")  # the ORIGINAL's, not the filename

    def test_new_to_revise_recomputes_version_in_the_new_naming_scope(self):
        """The wave's real risk. `before_insert` computed a version against the FILENAME-derived
        name; adopting the original's name moves the doc into a different scope entirely."""
        original = self._revisable_original("Version Scope Original")
        boq = self._upload_new()
        res = self._convert(boq, "revise", original.name)
        self.assertEqual(res["version"], original.version + 1)

    def test_new_to_revise_drops_the_seeded_drafts(self):
        """An unconfirmed revision is marked by exactly origin=="revision" AND empty
        sheet_drafts -- S2's emergent marker, which the hub and the mapping screen both read.
        A converted revision that kept its drafts would look confirmed and skip the mapping."""
        original = self._revisable_original()
        boq = self._upload_new()
        self.assertGreater(
            len(frappe.get_all("BoQ Sheet Draft", filters={"parent": boq})), 0
        )
        self._convert(boq, "revise", original.name)
        self.assertEqual(
            frappe.get_all("BoQ Sheet Draft", filters={"parent": boq}), []
        )

    def test_revise_requires_a_source(self):
        boq = self._upload_new()
        with self.assertRaises(frappe.ValidationError):
            self._convert(boq, "revise", None)

    def test_revise_revalidates_the_source_server_side(self):
        """A stale picker must not be able to create a revision against an ineligible original --
        the D1 rule has one owner and the convert path goes through it too."""
        uncommitted = _make_boq(self.project.name, boq_name="Never Committed")
        boq = self._upload_new()
        with self.assertRaises(frappe.ValidationError):
            self._convert(boq, "revise", uncommitted.name)

    # ── Revise -> New ────────────────────────────────────────────────────────
    def test_revise_to_new_clears_the_source_and_restores_the_filename_name(self):
        original = self._revisable_original()
        boq = self._upload_new(file_name="my_boq_file.xlsx")
        self._convert(boq, "revise", original.name)
        # The client's ORIGINAL filename, as the upload screen sends it from its store.
        res = self._convert(boq, "new", file_name="my_boq_file.xlsx")
        self.assertEqual(res["origin"], "upload")
        self.assertIsNone(res["source_boq"])
        # Exactly what a fresh upload of this file would have derived (ext stripped, _ -> space).
        self.assertEqual(res["boq_name"], "my boq file")

    def test_revise_to_new_without_a_filename_falls_back_without_throwing(self):
        """A direct API call may omit `file_name`. The restored name then comes from the stored
        File row, which Frappe may have UNIQUIFIED on a name collision -- so it can carry a hash
        suffix. That is accepted (the field is user-editable); silently throwing is not."""
        original = self._revisable_original()
        boq = self._upload_new(file_name="fallback_name.xlsx")
        self._convert(boq, "revise", original.name)
        res = self._convert(boq, "new")
        self.assertEqual(res["origin"], "upload")
        self.assertTrue(res["boq_name"].startswith("fallback name"))

    def test_revise_to_new_reseeds_the_drafts(self):
        original = self._revisable_original()
        boq = self._upload_new()
        self._convert(boq, "revise", original.name)
        res = self._convert(boq, "new")
        self.assertGreater(res["seeded"], 0)
        self.assertEqual(
            len(frappe.get_all("BoQ Sheet Draft", filters={"parent": boq})), res["seeded"]
        )

    # ── the round trip ───────────────────────────────────────────────────────
    def test_round_trip_new_revise_new_revise_is_stable(self):
        """The acceptance case from the handoff. The version must NOT ratchet upward on every
        flip -- `next_boq_version(exclude=<this doc>)` is what stops the doc counting itself."""
        original = self._revisable_original("Round Trip Original")
        boq = self._upload_new(file_name="round_trip.xlsx")

        first = self._convert(boq, "revise", original.name)
        self._convert(boq, "new")
        second = self._convert(boq, "revise", original.name)

        self.assertEqual(second["version"], first["version"])
        self.assertEqual(second["version"], original.version + 1)
        self.assertEqual(second["boq_name"], "Round Trip Original")
        self.assertEqual(
            frappe.get_all("BoQ Sheet Draft", filters={"parent": boq}), []
        )

    def test_converting_to_the_current_mode_is_a_no_op(self):
        boq = self._upload_new()
        before = frappe.db.get_value("BOQs", boq, ["boq_name", "version"], as_dict=True)
        res = self._convert(boq, "new")
        self.assertEqual(res["boq_name"], before.boq_name)
        self.assertEqual(res["version"], before.version)
        self.assertGreater(len(frappe.get_all("BoQ Sheet Draft", filters={"parent": boq})), 0)

    # ── guards ───────────────────────────────────────────────────────────────
    def test_rejects_a_committed_boq(self):
        original = self._revisable_original()
        boq = self._upload_new()
        _commit_sheet(boq)  # this BoQ now owns a committed tier that a flip would orphan
        with self.assertRaises(frappe.ValidationError):
            self._convert(boq, "revise", original.name)

    def test_rejects_an_already_parsed_boq(self):
        original = self._revisable_original()
        boq = self._upload_new()
        draft = frappe.get_all("BoQ Sheet Draft", filters={"parent": boq}, fields=["name"])[0]
        frappe.db.set_value("BoQ Sheet Draft", draft.name, "has_prior_parse", 1)
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError):
            self._convert(boq, "revise", original.name)

    def test_rejects_a_revision_whose_mapping_is_already_confirmed(self):
        """`source_sheet_name` is write-once (D3) -- delete + re-upload is the escape hatch."""
        original = self._revisable_original()
        boq = self._upload_new()
        self._convert(boq, "revise", original.name)
        # Simulate confirm_revision_mapping having seeded the drafts.
        rev_doc = frappe.get_doc("BOQs", boq)
        rev_doc.append("sheet_drafts", {"sheet_name": "Sheet1", "sheet_order": 1,
                                        "wizard_status": "Pending"})
        rev_doc.save(ignore_permissions=True)
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError):
            self._convert(boq, "new")

    def test_rejects_a_bad_mode(self):
        boq = self._upload_new()
        with self.assertRaises(frappe.ValidationError):
            self._convert(boq, "sideways")
