"""S1 (#1098, ADR-0014) -- revised-BoQ schema + origin-gate regression tests.

S1 is an ADDITIVE-schema + audit prefactor: it lands the 7 nullable fields the whole
Revised-BoQ feature reads, and audits every `origin == "template"` / `!= "template"`
gate so a NEW `origin="revision"` routes to the correct branch. These tests pin both
halves as executable regressions:

  * the 7 schema fields exist / are typed / carry the right options (nothing silently
    dropped by a later migrate), and
  * a `revision` origin routes into the NON-template / upload branch of every audited
    gate (ADR-0014 D2 -- "a revision is an upload in every one of these"), while the
    existing `upload` / `template` behaviour stays byte-identical.

The gate audit found SIX production gates (the plan cited four); each is exercised here
through its real endpoint/helper. Written now so S2 (which adds the `origin="revision"`
write) cannot regress the routing unnoticed.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.review_screen import _boq_origin_is_template
from nirmaan_stack.api.boq.wizard.template_select import set_row_excluded
from nirmaan_stack.api.boq.wizard.template_rows import _guard_template_write
from nirmaan_stack.api.boq.wizard.export_writeback import export_priced_workbook


# ---------------------------------------------------------------------------
# fixtures (mirror the repo pattern: satisfy Projects.after_insert generate_pwm)
# ---------------------------------------------------------------------------

def _make_project():
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_REV_SCHEMA_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


def _make_boq(project_name, origin, source_boq=None, boq_name=None):
    boq = frappe.new_doc("BOQs")
    boq.project = project_name
    boq.boq_name = boq_name or f"Rev Schema Test BoQ {origin} {frappe.generate_hash(length=4)}"
    boq.tax_treatment = "Pre-tax"
    if origin:
        boq.origin = origin          # read_only in the UI; programmatic set is allowed
    if source_boq:
        boq.source_boq = source_boq
    boq.insert(ignore_permissions=True)
    frappe.db.commit()
    return boq


def _cleanup_project(project_name):
    for boq in frappe.get_all("BOQs", filters={"project": project_name}, fields=["name"]):
        frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
    frappe.delete_doc("Projects", project_name, force=True, ignore_permissions=True)
    frappe.db.commit()


# ---------------------------------------------------------------------------
# 1. Schema presence (the 7 fields; additive/nullable/typed)
# ---------------------------------------------------------------------------

class TestRevisionSchemaFields(FrappeTestCase):
    """The 6 new columns + the `revision` origin option exist and are correctly typed."""

    # (doctype, fieldname, expected fieldtype)
    _NEW_FIELDS = [
        ("BOQs", "source_boq", "Link"),
        ("BoQ Sheet Draft", "source_sheet_name", "Data"),
        ("BoQ Sheet", "source_boq", "Link"),
        ("BoQ Sheet", "source_commit_version", "Int"),
        ("BoQ Sheet", "source_sheet_name", "Data"),
        ("BoQ Review Row", "revision_carry_status", "Select"),
        # S2 -- the needs-review diagnosis + the reviewer's affirmation.
        ("BoQ Review Row", "revision_review_reason", "Data"),
        ("BoQ Review Row", "revision_shift_delta", "Int"),
        ("BoQ Review Row", "revision_shift_anchor", "Int"),
        ("BoQ Review Row", "revision_reviewed", "Check"),
        ("BoQ Review Row", "revision_reviewed_by", "Link"),
        ("BoQ Review Row", "revision_reviewed_at", "Datetime"),
        ("BoQ Sheet Draft", "revision_change_summary", "JSON"),
    ]

    def test_six_new_columns_exist_on_the_runtime_db(self):
        for dt, col, _ft in self._NEW_FIELDS:
            self.assertTrue(frappe.db.has_column(dt, col), f"{dt}.{col} missing on the DB")

    def test_new_fields_registered_in_meta_with_expected_type(self):
        for dt, col, ft in self._NEW_FIELDS:
            f = frappe.get_meta(dt).get_field(col)
            self.assertIsNotNone(f, f"{dt}.{col} not registered in Meta")
            self.assertEqual(f.fieldtype, ft, f"{dt}.{col} wrong fieldtype")

    def test_link_fields_point_at_boqs(self):
        self.assertEqual(frappe.get_meta("BOQs").get_field("source_boq").options, "BOQs")
        self.assertEqual(frappe.get_meta("BoQ Sheet").get_field("source_boq").options, "BOQs")

    def test_origin_select_offers_revision_without_dropping_existing(self):
        opts = (frappe.get_meta("BOQs").get_field("origin").options or "").split("\n")
        self.assertIn("revision", opts)
        self.assertIn("upload", opts)      # byte-unaffected: existing values preserved
        self.assertIn("template", opts)

    def test_revision_carry_status_options_are_exact(self):
        opts = frappe.get_meta("BoQ Review Row").get_field("revision_carry_status").options
        # S2 (2026-07-22): `Needs Review` joins `Copied` as a value the merge writes -- together
        # they now cover every CONTENT row of a revision sheet. Leading blank means "not a revision
        # row at all" (upload/template, or a spacer). The four legacy values stay in the Select so
        # rows stamped before Amendment B still validate; they are never produced again. REMOVED
        # was never a value on this side.
        self.assertEqual(opts, "\nCopied\nNeeds Review\nMatched\nNew\nAmbiguous\nDrifted")
        self.assertNotIn("REMOVED", opts)

    def test_needs_review_status_matches_the_vocabulary_constant(self):
        # Pins the Select against its source of truth -- a typo in either is a silent no-stamp.
        from nirmaan_stack.services.boq_revision.reasons import NEEDS_REVIEW
        self.assertEqual(NEEDS_REVIEW, "Needs Review")
        opts = frappe.get_meta("BoQ Review Row").get_field("revision_carry_status").options
        self.assertIn(NEEDS_REVIEW, (opts or "").split("\n"))

    def test_copied_is_the_only_status_the_carry_writes(self):
        # Pins the vocabulary at its source, so retiring a legacy option later is a deliberate act.
        from nirmaan_stack.services.boq_revision.carry import COPIED
        self.assertEqual(COPIED, "Copied")
        opts = frappe.get_meta("BoQ Review Row").get_field("revision_carry_status").options
        self.assertIn(COPIED, (opts or "").split("\n"))

    def test_write_once_provenance_fields_are_read_only(self):
        self.assertTrue(frappe.get_meta("BoQ Sheet Draft").get_field("source_sheet_name").read_only)
        self.assertTrue(frappe.get_meta("BoQ Sheet").get_field("source_sheet_name").read_only)
        self.assertTrue(frappe.get_meta("BOQs").get_field("source_boq").read_only)


# ---------------------------------------------------------------------------
# 2. origin round-trip + D2 version auto-bump (origin-agnostic before_insert)
# ---------------------------------------------------------------------------

class TestRevisionOriginRoundTrip(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, "upload")

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_revision_boq_persists_origin_and_source_boq(self):
        rev = _make_boq(self.project.name, "revision", source_boq=self.original.name)
        reloaded = frappe.get_doc("BOQs", rev.name)
        self.assertEqual(reloaded.origin, "revision")
        self.assertEqual(reloaded.source_boq, self.original.name)

    def test_revision_reusing_boq_name_autobumps_version(self):
        # ADR-0014 D2: the before_insert version-bump is origin-AGNOSTIC (WHERE project AND
        # boq_name), so a revision reusing the original's boq_name gets version N+1 for free.
        shared = f"Shared BoQ Name {frappe.generate_hash(length=4)}"
        orig = _make_boq(self.project.name, "upload", boq_name=shared)
        rev = _make_boq(self.project.name, "revision", source_boq=orig.name, boq_name=shared)
        self.assertEqual(orig.version, 1)
        self.assertEqual(rev.version, orig.version + 1)


# ---------------------------------------------------------------------------
# 3. origin-gate audit as regression tests (a revision -> the upload branch)
# ---------------------------------------------------------------------------

class TestRevisionOriginGates(FrappeTestCase):
    """Every audited `origin` gate routes a `revision` into the non-template / upload branch;
    `upload` and `template` behaviour is unchanged (byte-unaffected)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.upload_boq = _make_boq(cls.project.name, "upload")
        cls.template_boq = _make_boq(cls.project.name, "template")
        cls.revision_boq = _make_boq(cls.project.name, "revision")

    @classmethod
    def tearDownClass(cls):
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    # -- Gates 3 & 4: _boq_origin_is_template (the template-only A2 quantity-rule scope,
    #    shared by save + finalize). A revision must read False so it inherits the upload
    #    "negative qty IS valid" convention. --
    def test_origin_is_template_helper_true_only_for_template(self):
        self.assertTrue(_boq_origin_is_template(self.template_boq.name))     # positive case intact
        self.assertFalse(_boq_origin_is_template(self.revision_boq.name))    # revision -> upload path
        self.assertFalse(_boq_origin_is_template(self.upload_boq.name))      # byte-unaffected

    # -- Gate 2: set_row_excluded (template-authoring row selection ONLY). A revision walks
    #    the normal review pipeline and never row-selects, so it is correctly rejected. --
    def test_set_row_excluded_rejects_revision(self):
        with self.assertRaisesRegex(frappe.ValidationError, "template-origin"):
            set_row_excluded(self.revision_boq.name, "AnySheet", 0, True)

    def test_set_row_excluded_still_rejects_upload(self):  # unchanged
        with self.assertRaisesRegex(frappe.ValidationError, "template-origin"):
            set_row_excluded(self.upload_boq.name, "AnySheet", 0, True)

    # -- Gate 6: _guard_template_write (template row create/delete). Its own rationale --
    #    "re-parse deletes-and-regenerates the sheet and would destroy any inserted row" --
    #    applies with full force to a revision (a revision re-parses), so it is rejected. --
    def test_guard_template_write_rejects_revision(self):
        with self.assertRaisesRegex(frappe.ValidationError, "template-origin"):
            _guard_template_write(self.revision_boq.name, "AnySheet")

    def test_guard_template_write_still_rejects_upload(self):  # unchanged
        with self.assertRaisesRegex(frappe.ValidationError, "template-origin"):
            _guard_template_write(self.upload_boq.name, "AnySheet")

    # -- Gate 1: export_priced_workbook. The template branch generates FROM SCRATCH (no
    #    workbook); a revision HAS a real uploaded workbook, so it must take the else/upload
    #    branch -> which fetches source_file_url. With none set, it throws the UPLOAD-branch
    #    error (never the template path), proving the routing. --
    def test_export_priced_workbook_takes_upload_branch_for_revision(self):
        with self.assertRaisesRegex(frappe.ValidationError, "source_file_url"):
            export_priced_workbook(self.revision_boq.name, ["AnySheet"])

    def test_export_priced_workbook_upload_branch_unchanged(self):  # byte-unaffected
        with self.assertRaisesRegex(frappe.ValidationError, "source_file_url"):
            export_priced_workbook(self.upload_boq.name, ["AnySheet"])
