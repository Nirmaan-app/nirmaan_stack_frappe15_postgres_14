"""Tests for template lifecycle + management endpoints (template_admin.py) and the
upload authoring path (upload_file.py is_template flag). ADR-0013 T6.

IMPORTANT (pending controller relaxation): a project-less template INSERT is currently
blocked by `integrations/controllers/boqs.py::before_insert` ("Project is required").
Two tests exercise the PRODUCTION project-less insert and therefore depend on that
relaxation landing:
  - test_duplicate_produces_independent_draft (duplicate_template inserts project=None)
  - test_upload_is_template_sets_flag         (worker inserts project=None)
The remaining tests build the template fixture with a scaffold project then NULL it
(a TEST-ONLY accommodation) so the read/status/delete/role-gate logic is verifiable
independent of the controller change.
"""

import os
import shutil
import tempfile
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.template_admin import (
    delete_template,
    deprecate_template,
    duplicate_template,
    list_all_templates,
    publish_template,
    unpublish_template,
)
from nirmaan_stack.api.boq.wizard.upload_file import _upload_file_worker

_FIXTURE_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),  # api/boq/wizard/
        "..", "..", "..",            # -> nirmaan_stack/ package dir
        "services", "boq_parser", "tests", "fixtures",
    )
)
_SIMPLE_XLSX = os.path.join(_FIXTURE_DIR, "synthetic_simple.xlsx")
_FAKE_FILE_URL = "/private/files/synthetic_simple.xlsx"


def _make_xlsx_tempfile():
    """Copy the fixture workbook into a fresh NamedTemporaryFile (worker's finally deletes it)."""
    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    try:
        with open(_SIMPLE_XLSX, "rb") as f:
            shutil.copyfileobj(f, tmp)
    finally:
        tmp.close()
    return tmp.name


def _make_project_fixture():
    """Minimal Projects row satisfying the legacy Projects.after_insert (generate_pwm) hook."""
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_TMPL_ADMIN_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


class _TemplateAdminBase(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.scaffold_project = _make_project_fixture()
        # A Work Headers row so we can exercise the work_packages grandchild copy.
        cls.work_header = f"TEST_TMPL_WH_{frappe.generate_hash(length=6)}"
        wh = frappe.new_doc("Work Headers")
        wh.work_header_name = cls.work_header
        wh.insert(ignore_permissions=True)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        if frappe.db.exists("Work Headers", cls.work_header):
            frappe.delete_doc("Work Headers", cls.work_header, force=True, ignore_permissions=True)
        frappe.delete_doc(
            "Projects", cls.scaffold_project.name, force=True, ignore_permissions=True
        )
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        self._created_boqs = []
        self._created_users = []
        # LIFO cleanups: restore Administrator, then delete users, then delete BOQs.
        self.addCleanup(self._cleanup_boqs)
        self.addCleanup(self._cleanup_users)
        self.addCleanup(frappe.set_user, "Administrator")

    # -- fixtures -----------------------------------------------------------

    def _make_template(self, boq_name="Test Template", status="Draft", with_grandchildren=True):
        """Create a project-less is_template BOQs fixture with 2 sheets, a general-specs
        child, an optional work_packages grandchild, and 2 review rows.

        TEST-ONLY: inserts with the scaffold project (to satisfy the current
        before_insert controller) then NULLs project so the fixture is genuinely
        project-less. See module docstring.
        """
        doc = frappe.new_doc("BOQs")
        doc.project = self.scaffold_project.name
        doc.boq_name = boq_name
        doc.tax_treatment = "Pre-tax"
        doc.wizard_state = "Parsed"
        doc.is_template = 1
        doc.template_status = status
        doc.origin = "upload"
        doc.append("sheet_drafts", {"sheet_name": "Sheet A", "sheet_order": 1, "wizard_status": "Parsed"})
        # trailing space is VERBATIM (#152) -- proves duplicate matches sheet_name exactly.
        doc.append("sheet_drafts", {"sheet_name": "Sheet B ", "sheet_order": 2, "wizard_status": "Parsed"})
        doc.append("general_specs_sheets", {"source_sheet_name": "Sheet B ", "preamble_text": "General notes"})
        doc.insert(ignore_permissions=True)
        frappe.db.set_value("BOQs", doc.name, "project", None)
        self._created_boqs.append(doc.name)

        if with_grandchildren:
            draft_a = next(d.name for d in doc.sheet_drafts if d.sheet_name == "Sheet A")
            pkg = frappe.new_doc("BoQ Sheet Work Package")
            pkg.parent = draft_a
            pkg.parenttype = "BoQ Sheet Draft"
            pkg.parentfield = "work_packages"
            pkg.work_header = self.work_header
            pkg.insert(ignore_permissions=True)

        for idx, classification in enumerate(("preamble", "line_item")):
            row = frappe.new_doc("BoQ Review Row")
            row.boq = doc.name
            row.sheet_name = "Sheet A"
            row.row_index = idx
            row.classification = classification
            row.description = f"Row {idx}"
            row.parent_index = -1
            row.insert(ignore_permissions=True)

        frappe.db.commit()
        return doc.name

    def _make_project_boq(self, boq_name="Not A Template"):
        """A normal (is_template=0) project BOQ, for the not-a-template guard tests."""
        boq = frappe.new_doc("BOQs")
        boq.project = self.scaffold_project.name
        boq.boq_name = boq_name
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        self._created_boqs.append(boq.name)
        frappe.db.commit()
        return boq.name

    def _make_user_with_role(self, role_profile):
        email = f"tmpl_gate_{frappe.generate_hash(length=6)}@example.com"
        if not frappe.db.exists("User", email):
            u = frappe.new_doc("User")
            u.email = email
            u.first_name = "Tmpl Gate"
            u.send_welcome_email = 0
            u.enabled = 1
            u.insert(ignore_permissions=True)
        # User.after_insert may auto-create a Nirmaan Users row (role None). Ensure the
        # desired role_profile is set. Nirmaan Users is named by lowercased email.
        if frappe.db.exists("Nirmaan Users", email):
            frappe.db.set_value("Nirmaan Users", email, "role_profile", role_profile)
        else:
            nu = frappe.new_doc("Nirmaan Users")
            nu.email = email
            nu.first_name = "Tmpl Gate"
            nu.role_profile = role_profile
            nu.insert(ignore_permissions=True)
        frappe.db.commit()
        self._created_users.append(email)
        return email

    # -- cleanup ------------------------------------------------------------

    def _cleanup_boqs(self):
        frappe.set_user("Administrator")
        for name in self._created_boqs:
            if not frappe.db.exists("BOQs", name):
                continue
            frappe.db.delete("BoQ Review Row", {"boq": name})
            draft_names = frappe.db.get_all(
                "BoQ Sheet Draft", filters={"parent": name, "parenttype": "BOQs"}, pluck="name"
            )
            if draft_names:
                frappe.db.delete(
                    "BoQ Sheet Work Package",
                    {"parent": ("in", draft_names), "parenttype": "BoQ Sheet Draft"},
                )
            for att in frappe.get_all(
                "Nirmaan Attachments",
                filters={"associated_doctype": "BOQs", "associated_docname": name},
                fields=["name"],
            ):
                frappe.delete_doc("Nirmaan Attachments", att.name, force=True, ignore_permissions=True)
            frappe.delete_doc("BOQs", name, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _cleanup_users(self):
        frappe.set_user("Administrator")
        for email in self._created_users:
            if frappe.db.exists("Nirmaan Users", email):
                frappe.delete_doc("Nirmaan Users", email, force=True, ignore_permissions=True)
            if frappe.db.exists("User", email):
                frappe.delete_doc("User", email, force=True, ignore_permissions=True)
        frappe.db.commit()


class TestTemplateStatusTransitions(_TemplateAdminBase):
    def test_publish_deprecate_unpublish(self):
        """publish -> Published, deprecate -> Deprecated, unpublish -> Draft."""
        name = self._make_template(status="Draft", with_grandchildren=False)

        publish_template(boq=name)
        self.assertEqual(frappe.db.get_value("BOQs", name, "template_status"), "Published")

        deprecate_template(boq=name)
        self.assertEqual(frappe.db.get_value("BOQs", name, "template_status"), "Deprecated")

        unpublish_template(boq=name)
        self.assertEqual(frappe.db.get_value("BOQs", name, "template_status"), "Draft")

    def test_status_rejects_non_template(self):
        """A status transition must refuse a non-template (is_template=0) BOQ."""
        boq = self._make_project_boq()
        with self.assertRaises(frappe.ValidationError):
            publish_template(boq=boq)

    def test_status_rejects_missing_boq(self):
        with self.assertRaises(frappe.ValidationError):
            publish_template(boq="BOQ-does-not-exist-xyz")


class TestTemplateRoleGate(_TemplateAdminBase):
    def test_role_gate_rejects_project_lead_on_publish(self):
        """A Project Lead may NOT manage templates (only Admin + Estimates)."""
        name = self._make_template(with_grandchildren=False)
        lead = self._make_user_with_role("Nirmaan Project Lead Profile")
        frappe.set_user(lead)
        with self.assertRaises(frappe.PermissionError):
            publish_template(boq=name)

    def test_role_gate_rejects_project_lead_on_list(self):
        self._make_template(with_grandchildren=False)
        lead = self._make_user_with_role("Nirmaan Project Lead Profile")
        frappe.set_user(lead)
        with self.assertRaises(frappe.PermissionError):
            list_all_templates()

    def test_role_gate_allows_estimates_executive(self):
        """An Estimates Executive is permitted to manage templates."""
        name = self._make_template(with_grandchildren=False)
        est = self._make_user_with_role("Nirmaan Estimates Executive Profile")
        frappe.set_user(est)
        publish_template(boq=name)  # must not raise
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.get_value("BOQs", name, "template_status"), "Published")


class TestListAllTemplates(_TemplateAdminBase):
    def test_list_returns_templates_with_sheet_count(self):
        name = self._make_template(
            boq_name=f"List Test {frappe.generate_hash(length=4)}", with_grandchildren=False
        )
        result = list_all_templates()
        match = [t for t in result if t["name"] == name]
        self.assertEqual(len(match), 1)
        self.assertEqual(match[0]["sheet_count"], 2)  # Sheet A + Sheet B
        self.assertIn("template_status", match[0])
        self.assertIn("boq_name", match[0])

    def test_list_includes_all_statuses(self):
        """Draft AND Deprecated templates both appear (management page shows all)."""
        draft = self._make_template(boq_name=f"Draft {frappe.generate_hash(length=4)}", with_grandchildren=False)
        depr = self._make_template(boq_name=f"Depr {frappe.generate_hash(length=4)}", status="Deprecated", with_grandchildren=False)
        names = {t["name"] for t in list_all_templates()}
        self.assertIn(draft, names)
        self.assertIn(depr, names)


class TestDuplicateTemplate(_TemplateAdminBase):
    def test_duplicate_produces_independent_draft(self):
        """Deep-copy a Published template to a NEW, independent is_template Draft.

        NOTE: exercises the PRODUCTION project-less insert -> depends on the
        before_insert controller relaxation (see module docstring).
        """
        src = self._make_template(boq_name="Dup Src", status="Published", with_grandchildren=True)

        result = duplicate_template(boq=src)
        new_name = result["name"]
        self._created_boqs.append(new_name)

        self.assertTrue(frappe.db.exists("BOQs", new_name))
        self.assertNotEqual(new_name, src)

        row = frappe.db.get_value(
            "BOQs",
            new_name,
            ["is_template", "template_status", "project", "source_template"],
            as_dict=True,
        )
        self.assertEqual(row.is_template, 1)
        self.assertEqual(row.template_status, "Draft")  # reset to Draft even from a Published source
        self.assertIsNone(row.project)  # project-less
        self.assertIsNone(row.source_template)  # a template has no source_template

        # sheet_drafts copied (sheet_name VERBATIM, trailing space preserved).
        drafts = frappe.db.get_all(
            "BoQ Sheet Draft", filters={"parent": new_name, "parenttype": "BOQs"}, fields=["name", "sheet_name"]
        )
        self.assertEqual({d.sheet_name for d in drafts}, {"Sheet A", "Sheet B "})

        # work_packages grandchild copied onto the matching (verbatim) new draft.
        new_draft_a = next(d.name for d in drafts if d.sheet_name == "Sheet A")
        wp = frappe.db.get_all(
            "BoQ Sheet Work Package",
            filters={"parent": new_draft_a, "parenttype": "BoQ Sheet Draft"},
            fields=["work_header"],
        )
        self.assertEqual([w.work_header for w in wp], [self.work_header])

        # general_specs child copied.
        gs = frappe.db.get_all(
            "BoQ General Specs Sheet",
            filters={"parent": new_name, "parenttype": "BOQs"},
            fields=["source_sheet_name"],
        )
        self.assertIn("Sheet B ", [g.source_sheet_name for g in gs])

        # review rows copied (same count) and INDEPENDENT of the source.
        self.assertEqual(
            frappe.db.count("BoQ Review Row", {"boq": new_name}),
            frappe.db.count("BoQ Review Row", {"boq": src}),
        )
        # mutate the copy -> source must be unaffected.
        frappe.db.delete("BoQ Review Row", {"boq": new_name})
        self.assertGreater(frappe.db.count("BoQ Review Row", {"boq": src}), 0)

    def test_duplicate_rejects_non_template(self):
        boq = self._make_project_boq(boq_name="Dup Non Template")
        with self.assertRaises(frappe.ValidationError):
            duplicate_template(boq=boq)


class TestDeleteTemplate(_TemplateAdminBase):
    def test_delete_removes_template_rows_and_grandchildren(self):
        name = self._make_template(boq_name="Del Test", with_grandchildren=True)
        draft_names = frappe.db.get_all(
            "BoQ Sheet Draft", filters={"parent": name, "parenttype": "BOQs"}, pluck="name"
        )
        self.assertGreater(frappe.db.count("BoQ Review Row", {"boq": name}), 0)
        self.assertGreater(
            frappe.db.count(
                "BoQ Sheet Work Package",
                {"parent": ("in", draft_names), "parenttype": "BoQ Sheet Draft"},
            ),
            0,
        )

        delete_template(boq=name)

        self.assertFalse(frappe.db.exists("BOQs", name))
        self.assertEqual(frappe.db.count("BoQ Review Row", {"boq": name}), 0)
        self.assertEqual(
            frappe.db.count(
                "BoQ Sheet Work Package",
                {"parent": ("in", draft_names), "parenttype": "BoQ Sheet Draft"},
            ),
            0,
        )
        self._created_boqs.remove(name)  # already deleted

    def test_delete_rejects_non_template(self):
        boq = self._make_project_boq(boq_name="Del Non Template")
        with self.assertRaises(frappe.ValidationError):
            delete_template(boq=boq)
        self.assertTrue(frappe.db.exists("BOQs", boq))  # untouched


class TestUploadIsTemplate(_TemplateAdminBase):
    def test_upload_is_template_sets_flag(self):
        """The upload worker's is_template path stamps is_template=1, origin=upload,
        project=None.

        NOTE: exercises the PRODUCTION project-less insert -> depends on the
        before_insert controller relaxation (see module docstring).
        """
        with patch(
            "nirmaan_stack.api.boq.wizard.upload_file._fetch_boq_file_to_tempfile",
            return_value=_make_xlsx_tempfile(),
        ):
            with patch("frappe.publish_realtime"):
                _upload_file_worker(
                    project_id=None,
                    file_url=_FAKE_FILE_URL,
                    file_name="MEP Template.xlsx",
                    user="Administrator",
                    is_template=1,
                )

        boqs = frappe.get_all(
            "BOQs",
            filters={"is_template": 1, "boq_name": "MEP Template"},
            fields=["name", "is_template", "origin", "project"],
        )
        self.assertEqual(len(boqs), 1)
        self._created_boqs.append(boqs[0].name)
        self.assertEqual(boqs[0].is_template, 1)
        self.assertEqual(boqs[0].origin, "upload")
        self.assertIsNone(boqs[0].project)

    def test_upload_non_template_path_unchanged(self):
        """The default (non-template) worker path still creates a project-bound,
        is_template=0 BOQ -- byte-identical behavior."""
        with patch(
            "nirmaan_stack.api.boq.wizard.upload_file._fetch_boq_file_to_tempfile",
            return_value=_make_xlsx_tempfile(),
        ):
            with patch("frappe.publish_realtime"):
                _upload_file_worker(
                    project_id=self.scaffold_project.name,
                    file_url=_FAKE_FILE_URL,
                    file_name="Regular BOQ.xlsx",
                    user="Administrator",
                )

        boqs = frappe.get_all(
            "BOQs",
            filters={"project": self.scaffold_project.name, "boq_name": "Regular BOQ"},
            fields=["name", "is_template", "origin"],
        )
        self.assertEqual(len(boqs), 1)
        self._created_boqs.append(boqs[0].name)
        self.assertIn(boqs[0].is_template, (0, None))
        self.assertEqual(boqs[0].origin, "upload")
