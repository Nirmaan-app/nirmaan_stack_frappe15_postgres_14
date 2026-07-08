"""
Unit tests for the BoQ "Create from Template" clone worker + endpoints (T2, ADR-0013).

Covers:
  - _clone_worker flattens EFFECTIVE classification/parent into base fields (drops overlay)
  - strips qty / rate / amount to blank
  - clean parser baseline: is_excluded=0, is_synthetic=0, chosen_source="parser",
    human_parent=-1 sentinel, human_classification cleared
  - human_is_root override folds to a root (parent_index=-1) in the clone
  - carries sheet_config, work_packages (grandchild), and general_specs membership
  - lands at wizard_state/wizard_status="Parsed" with has_prior_parse=1
  - only the SELECTED sheets are cloned
  - version auto-increments (MAX+1 per project+boq_name)
  - idempotent on a double-fire (no duplicate rows)
  - create_from_template endpoint validation + BOQs-shell creation
  - list_templates returns only Published templates with sheets + WP
  - role gate rejects a non-wizard user

Run via the bench runner (NOT raw unittest -- see CLAUDE.md BoQ test-runner note):
  bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_create_from_template
"""
import json
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import create_from_template as cft
from nirmaan_stack.api.boq.wizard.create_from_template import (
    _clone_worker,
    create_from_template,
    get_clone_status,
    list_templates,
)

_SHEET_A = "Sheet A"
_SHEET_B = "Sheet B"
_SHEET_CONFIG_A = {
    "header_row": 1,
    "area_dimensions": [],
    "column_role_map": {"A": {"role": "sl_no"}, "B": {"role": "description"}},
}


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------

def _make_project_fixture():
    """Projects row with the minimal fields the legacy after_insert (generate_pwm) needs."""
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_BOQ_TPL_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


def _make_work_header():
    name = f"TPL_WH_{frappe.generate_hash(length=5)}"
    wh = frappe.new_doc("Work Headers")
    wh.work_header_name = name  # autoname field:work_header_name -> docname == name
    wh.insert(ignore_permissions=True)
    frappe.db.commit()
    return name


def _add_row(boq, sheet, row_index, classification, parent_index, **kw):
    doc = frappe.new_doc("BoQ Review Row")
    doc.boq = boq
    doc.sheet_name = sheet
    doc.row_index = row_index
    doc.source_row_number = kw.get("source_row_number", row_index + 1)
    doc.classification = classification
    doc.parent_index = parent_index
    doc.human_parent = kw.get("human_parent", -1)
    for f in (
        "human_classification", "human_is_root",
        "sl_no_value", "description", "unit", "make_model", "is_rate_only",
        "level", "attached_to_index",
        "qty_total", "rate_supply", "rate_install", "rate_combined",
        "amount_total", "amount_supply", "amount_install",
    ):
        if f in kw:
            setattr(doc, f, kw[f])
    # JSON fields -- pass a pre-serialized STRING (a Python list is rejected on insert).
    if "attached_notes" in kw:
        doc.attached_notes = json.dumps(kw["attached_notes"])
    if "qty_by_area" in kw:
        doc.qty_by_area = json.dumps(kw["qty_by_area"])
    if "rate_by_area" in kw:
        doc.rate_by_area = json.dumps(kw["rate_by_area"])
    if "amount_by_area" in kw:
        doc.amount_by_area = json.dumps(kw["amount_by_area"])
    doc.insert(ignore_permissions=True)
    return doc


def _build_template(project, work_header, published=True):
    """A template BOQs (is_template=1) with 2 sheets, WP grandchildren, general_specs, rows.

    NOTE: the template is given a project only to satisfy the current BOQs.before_insert
    (which still requires project); the clone worker never reads the template's project, so
    this is a harmless test-fixture accommodation. Production templates are project-less.
    """
    boq = frappe.new_doc("BOQs")
    boq.project = project
    boq.boq_name = f"TPL_MEP_{frappe.generate_hash(length=5)}"
    boq.is_template = 1
    boq.template_status = "Published" if published else "Draft"
    boq.origin = "upload"  # templates are authored via the upload wizard
    boq.tax_treatment = "Post-tax"
    boq.append("sheet_drafts", {
        "sheet_name": _SHEET_A,
        "sheet_order": 1,
        "wizard_status": "Parsed",
        "sheet_label": "HVAC",
        "sheet_config": json.dumps(_SHEET_CONFIG_A),
        "has_prior_parse": 1,
    })
    boq.append("sheet_drafts", {
        "sheet_name": _SHEET_B,
        "sheet_order": 2,
        "wizard_status": "Parsed",
        "sheet_config": json.dumps({"header_row": 1, "area_dimensions": []}),
        "has_prior_parse": 1,
    })
    boq.append("general_specs_sheets", {
        "source_sheet_name": _SHEET_A,
        "preamble_text": "General preamble for HVAC.",
    })
    boq.insert(ignore_permissions=True)

    # WP grandchild on Sheet A's draft.
    draft_a = next(d for d in boq.sheet_drafts if d.sheet_name == _SHEET_A)
    pkg = frappe.new_doc("BoQ Sheet Work Package")
    pkg.parent = draft_a.name
    pkg.parenttype = "BoQ Sheet Draft"
    pkg.parentfield = "work_packages"
    pkg.work_header = work_header
    pkg.insert(ignore_permissions=True)

    # Sheet A rows:
    #  0 preamble (root)
    #  1 line_item under 0 -- populated qty/rate/amount + attached_notes (all stripped on clone)
    #  2 note w/ human override -> line_item under 0 (tests effective classification)
    #  3 preamble whose parser parent is 1 BUT human_is_root=1 -> effective root
    _add_row(boq.name, _SHEET_A, 0, "preamble", -1, level=1,
             sl_no_value="1", description="Section One")
    _add_row(boq.name, _SHEET_A, 1, "line_item", 0, level=2,
             sl_no_value="1.1", description="Supply duct", unit="Rmt",
             make_model="ACME", is_rate_only=0,
             qty_total=5.0, rate_supply=100.0, rate_combined=120.0,
             amount_total=600.0, amount_supply=500.0,
             attached_notes=["carried-note"],
             qty_by_area={"B1": 5.0})
    _add_row(boq.name, _SHEET_A, 2, "note", 0,
             human_classification="line_item",
             sl_no_value="1.2", description="Was a note, now an item",
             unit="Nos", qty_total=3.0)
    _add_row(boq.name, _SHEET_A, 3, "preamble", 1, human_is_root=1, level=2,
             sl_no_value="2", description="Section Two (human root)")
    # Sheet B row.
    _add_row(boq.name, _SHEET_B, 0, "line_item", -1,
             description="B item", unit="Nos", qty_total=2.0)

    frappe.db.commit()
    return boq.name


def _make_target_shell(project, boq_name, template_boq):
    """Create the BOQs shell exactly as create_from_template does, so the worker can run."""
    shell = frappe.new_doc("BOQs")
    shell.project = project
    shell.boq_name = boq_name
    shell.origin = "template"
    shell.is_template = 0
    shell.source_template = template_boq
    shell.tax_treatment = "Post-tax"
    shell.source_file_url = None
    shell.wizard_state = "Parsed"
    shell.insert(ignore_permissions=True)
    frappe.db.commit()
    return shell.name


def _cleanup_boqs(project):
    for boq in frappe.get_all("BOQs", filters={"project": project}, fields=["name"]):
        draft_names = [
            d.name
            for d in frappe.get_all(
                "BoQ Sheet Draft",
                filters={"parent": boq.name, "parenttype": "BOQs"},
                fields=["name"],
            )
        ]
        if draft_names:
            frappe.db.delete(
                "BoQ Sheet Work Package",
                {"parent": ("in", draft_names), "parenttype": "BoQ Sheet Draft"},
            )
        frappe.db.delete("BoQ Review Row", {"boq": boq.name})
        frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
    frappe.db.commit()


# ---------------------------------------------------------------------------
# Worker tests
# ---------------------------------------------------------------------------

class TestCloneWorker(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project_fixture()
        cls.work_header = _make_work_header()
        cls.template = _build_template(cls.project.name, cls.work_header)

    @classmethod
    def tearDownClass(cls):
        _cleanup_boqs(cls.project.name)
        frappe.delete_doc("Work Headers", cls.work_header, force=True, ignore_permissions=True)
        frappe.delete_doc("Projects", cls.project.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    # -- helpers -----------------------------------------------------------
    def _run_clone(self, sheet_names, boq_name=None):
        boq_name = boq_name or f"CLONE_{frappe.generate_hash(length=5)}"
        shell = _make_target_shell(self.project.name, boq_name, self.template)
        _clone_worker(shell, self.template, sheet_names, "Administrator")
        return shell

    def _rows(self, boq, sheet):
        return frappe.get_all(
            "BoQ Review Row",
            filters={"boq": boq, "sheet_name": sheet},
            fields=[
                "row_index", "classification", "parent_index", "human_parent",
                "human_classification", "is_excluded", "is_synthetic", "chosen_source",
                "qty_total", "rate_supply", "rate_combined", "amount_total", "amount_supply",
                "qty_by_area", "rate_by_area", "amount_by_area",
                "unit", "make_model", "description", "level", "attached_notes",
            ],
            order_by="row_index asc",
        )

    # -- tests -------------------------------------------------------------
    def test_flattens_effective_classification(self):
        shell = self._run_clone([_SHEET_A])
        rows = self._rows(shell, _SHEET_A)
        by_idx = {r.row_index: r for r in rows}
        # row 2 was a parser "note" with a human override to "line_item".
        self.assertEqual(by_idx[2].classification, "line_item")
        # the human overlay is DROPPED on the clone.
        self.assertFalse(by_idx[2].human_classification)
        # parser rows keep their classification.
        self.assertEqual(by_idx[0].classification, "preamble")
        self.assertEqual(by_idx[1].classification, "line_item")

    def test_human_root_folds_to_root(self):
        shell = self._run_clone([_SHEET_A])
        by_idx = {r.row_index: r for r in self._rows(shell, _SHEET_A)}
        # row 3 parser parent was 1 but human_is_root=1 -> effective root -> -1 sentinel.
        self.assertEqual(by_idx[3].parent_index, -1)
        # row 1's parser parent (0) is preserved.
        self.assertEqual(by_idx[1].parent_index, 0)

    def test_strips_qty_rate_amount(self):
        shell = self._run_clone([_SHEET_A])
        by_idx = {r.row_index: r for r in self._rows(shell, _SHEET_A)}
        r1 = by_idx[1]  # the fully-populated template row
        for f in ("qty_total", "rate_supply", "rate_combined", "amount_total", "amount_supply"):
            self.assertIn(r1.get(f), (None, 0, 0.0), f"{f} should be blank, got {r1.get(f)}")
        # per-area JSON qty is not carried either.
        self.assertIn(r1.get("qty_by_area"), (None, "", "{}", "null"))

    def test_clean_parser_baseline(self):
        shell = self._run_clone([_SHEET_A])
        for r in self._rows(shell, _SHEET_A):
            self.assertEqual(r.is_excluded, 0)
            self.assertEqual(r.is_synthetic, 0)
            self.assertEqual(r.chosen_source, "parser")
            # human_parent MUST be the -1 sentinel, never the Frappe Int default 0.
            self.assertEqual(r.human_parent, -1)

    def test_carries_structural_fields(self):
        shell = self._run_clone([_SHEET_A])
        by_idx = {r.row_index: r for r in self._rows(shell, _SHEET_A)}
        r1 = by_idx[1]
        self.assertEqual(r1.unit, "Rmt")
        self.assertEqual(r1.make_model, "ACME")
        self.assertEqual(r1.description, "Supply duct")
        self.assertEqual(r1.level, 2)
        # attached_notes JSON carried verbatim. The ORM returns a JSON column already
        # parsed (list) in v15; tolerate a raw string too (read-path dependent).
        notes = r1.attached_notes
        if isinstance(notes, str):
            notes = json.loads(notes)
        self.assertEqual(notes, ["carried-note"])

    def test_carries_work_packages(self):
        shell = self._run_clone([_SHEET_A, _SHEET_B])
        wps = cft.get_boq_work_packages(shell)
        self.assertEqual(wps.get(_SHEET_A), [self.work_header])
        # Sheet B had no WP -> omitted from the dict.
        self.assertNotIn(_SHEET_B, wps)

    def test_carries_sheet_config_and_parsed_status(self):
        shell = self._run_clone([_SHEET_A])
        draft = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": shell, "parenttype": "BOQs", "sheet_name": _SHEET_A},
            ["wizard_status", "sheet_config", "has_prior_parse", "sheet_label", "last_parsed_at"],
            as_dict=True,
        )
        self.assertEqual(draft.wizard_status, "Parsed")
        self.assertEqual(draft.has_prior_parse, 1)
        self.assertEqual(draft.sheet_label, "HVAC")
        self.assertIsNotNone(draft.last_parsed_at)
        cfg = draft.sheet_config
        if isinstance(cfg, str):
            cfg = json.loads(cfg)
        self.assertEqual(cfg, _SHEET_CONFIG_A)
        # BOQs itself lands Parsed.
        self.assertEqual(frappe.db.get_value("BOQs", shell, "wizard_state"), "Parsed")

    def test_carries_general_specs(self):
        shell = self._run_clone([_SHEET_A])
        gs = frappe.get_all(
            "BoQ General Specs Sheet",
            filters={"parent": shell, "parenttype": "BOQs"},
            fields=["source_sheet_name", "preamble_text"],
        )
        self.assertEqual(len(gs), 1)
        self.assertEqual(gs[0].source_sheet_name, _SHEET_A)
        self.assertEqual(gs[0].preamble_text, "General preamble for HVAC.")

    def test_general_specs_only_for_selected_sheets(self):
        # Sheet A carries a general-specs entry; selecting only Sheet B must not carry it.
        shell = self._run_clone([_SHEET_B])
        gs = frappe.get_all(
            "BoQ General Specs Sheet",
            filters={"parent": shell, "parenttype": "BOQs"},
            fields=["source_sheet_name"],
        )
        self.assertEqual(gs, [])

    def test_only_selected_sheets_cloned(self):
        shell = self._run_clone([_SHEET_A])
        drafts = frappe.get_all(
            "BoQ Sheet Draft",
            filters={"parent": shell, "parenttype": "BOQs"},
            fields=["sheet_name"],
        )
        self.assertEqual({d.sheet_name for d in drafts}, {_SHEET_A})
        # No Sheet B review rows either.
        self.assertEqual(self._rows(shell, _SHEET_B), [])
        self.assertEqual(len(self._rows(shell, _SHEET_A)), 4)

    def test_version_increments(self):
        name = f"CLONE_VER_{frappe.generate_hash(length=5)}"
        s1 = self._run_clone([_SHEET_A], boq_name=name)
        s2 = self._run_clone([_SHEET_A], boq_name=name)
        v1 = frappe.db.get_value("BOQs", s1, "version")
        v2 = frappe.db.get_value("BOQs", s2, "version")
        self.assertEqual(v1, 1)
        self.assertEqual(v2, 2)

    def test_idempotent_double_fire(self):
        shell = self._run_clone([_SHEET_A])
        first = len(self._rows(shell, _SHEET_A))
        # Re-run the worker on the same target -- must not duplicate.
        _clone_worker(shell, self.template, [_SHEET_A], "Administrator")
        second = len(self._rows(shell, _SHEET_A))
        self.assertEqual(first, second)
        drafts = frappe.get_all(
            "BoQ Sheet Draft",
            filters={"parent": shell, "parenttype": "BOQs"},
            fields=["name"],
        )
        self.assertEqual(len(drafts), 1)

    def test_get_clone_status_pending_for_unknown_job(self):
        self.assertEqual(get_clone_status("no-such-job")["state"], "pending")


# ---------------------------------------------------------------------------
# Endpoint tests (create_from_template / list_templates / role gate)
# ---------------------------------------------------------------------------

class TestCreateFromTemplateEndpoint(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project_fixture()
        cls.work_header = _make_work_header()
        cls.template = _build_template(cls.project.name, cls.work_header)
        cls.draft_template = _build_template(cls.project.name, cls.work_header, published=False)

    @classmethod
    def tearDownClass(cls):
        _cleanup_boqs(cls.project.name)
        frappe.delete_doc("Work Headers", cls.work_header, force=True, ignore_permissions=True)
        frappe.delete_doc("Projects", cls.project.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def test_create_endpoint_creates_shell_and_enqueues(self):
        with patch.object(cft.frappe, "enqueue") as mock_enq:
            job = MagicMock()
            job.id = "job-abc-123"
            mock_enq.return_value = job
            res = create_from_template(
                template_boq=self.template,
                project=self.project.name,
                boq_name=None,  # exercise the {project_name}_BOQ default
                sheet_names=[_SHEET_A],
            )
        self.assertEqual(res["job_id"], "job-abc-123")
        shell = frappe.get_doc("BOQs", res["boq_id"])
        self.assertEqual(shell.origin, "template")
        self.assertEqual(shell.source_template, self.template)
        self.assertEqual(shell.is_template, 0)
        self.assertEqual(shell.wizard_state, "Parsed")
        self.assertEqual(shell.tax_treatment, "Post-tax")  # copied from template
        self.assertEqual(shell.boq_name, f"{self.project.project_name}_BOQ")
        # enqueue was called with the worker + the new boq id.
        self.assertTrue(mock_enq.called)
        _, kwargs = mock_enq.call_args
        self.assertEqual(kwargs.get("new_boq"), res["boq_id"])
        self.assertEqual(kwargs.get("template_boq"), self.template)
        self.assertEqual(kwargs.get("sheet_names"), [_SHEET_A])

    def test_create_accepts_json_string_sheet_names(self):
        with patch.object(cft.frappe, "enqueue") as mock_enq:
            mock_enq.return_value = MagicMock(id="j1")
            res = create_from_template(
                template_boq=self.template,
                project=self.project.name,
                boq_name="ExplicitName",
                sheet_names=json.dumps([_SHEET_A, _SHEET_B]),
            )
        self.assertEqual(frappe.db.get_value("BOQs", res["boq_id"], "boq_name"), "ExplicitName")

    def test_rejects_non_published_template(self):
        with patch.object(cft.frappe, "enqueue"):
            with self.assertRaises(frappe.ValidationError):
                create_from_template(
                    template_boq=self.draft_template,
                    project=self.project.name,
                    sheet_names=[_SHEET_A],
                )

    def test_rejects_unknown_template(self):
        with self.assertRaises(frappe.ValidationError):
            create_from_template(
                template_boq="BOQ-99-99999",
                project=self.project.name,
                sheet_names=[_SHEET_A],
            )

    def test_rejects_empty_sheet_names(self):
        with self.assertRaises(frappe.ValidationError):
            create_from_template(
                template_boq=self.template,
                project=self.project.name,
                sheet_names=[],
            )

    def test_rejects_unknown_sheet(self):
        with self.assertRaises(frappe.ValidationError):
            create_from_template(
                template_boq=self.template,
                project=self.project.name,
                sheet_names=["Nonexistent Sheet"],
            )

    def test_rejects_unknown_project(self):
        with self.assertRaises(frappe.ValidationError):
            create_from_template(
                template_boq=self.template,
                project="NO-SUCH-PROJECT",
                sheet_names=[_SHEET_A],
            )

    def test_list_templates_returns_published_with_sheets_and_wp(self):
        listed = list_templates()
        entry = next((t for t in listed if t["name"] == self.template), None)
        self.assertIsNotNone(entry, "published template must be listed")
        names = {s["sheet_name"] for s in entry["sheets"]}
        self.assertEqual(names, {_SHEET_A, _SHEET_B})
        sheet_a = next(s for s in entry["sheets"] if s["sheet_name"] == _SHEET_A)
        self.assertEqual(sheet_a["work_packages"], [self.work_header])
        sheet_b = next(s for s in entry["sheets"] if s["sheet_name"] == _SHEET_B)
        self.assertEqual(sheet_b["work_packages"], [])
        # the Draft template must NOT be listed.
        self.assertNotIn(self.draft_template, {t["name"] for t in listed})

    def test_role_gate_rejects_non_wizard_user(self):
        original = frappe.session.user
        try:
            frappe.set_user("Guest")  # no Nirmaan Users row -> role_profile None
            with self.assertRaises(frappe.PermissionError):
                list_templates()
        finally:
            frappe.set_user(original)
