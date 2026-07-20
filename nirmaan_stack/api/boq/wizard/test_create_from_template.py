"""
Unit tests for the BoQ "Create from Template" clone worker + endpoints (A1, ADR-0013).

Amendment A1 store model: the template lives in dedicated doctypes (BoQ Template /
BoQ Template Sheet / BoQ Template Row), pre-flattened at seed time. This module tests that
create_from_template + _clone_worker do a STRAIGHT structural copy of the active master's
template rows into BoQ Review Rows at wizard_state="Parsed", is_excluded=0.

Covers:
  - _clone_worker straight-copies template rows into BoQ Review Rows (structure only)
  - qty / rate / amount left blank (None)
  - clean parser baseline: is_excluded=0, is_synthetic=0, chosen_source="parser",
    human_parent=-1 sentinel; -1 (root) and 0 (attached) sentinels preserved verbatim
  - carries sheet_config, work_packages (grandchild), and general_specs membership
  - lands at wizard_state/wizard_status="Parsed" with has_prior_parse=1
  - only the SELECTED sheets are cloned; sheet_name matched VERBATIM (trailing space)
  - version auto-increments (MAX+1 per project+boq_name)
  - idempotent on a double-fire (no duplicate rows)
  - create_from_template endpoint validation + BOQs-shell creation (one master, no template arg)
  - get_master_template returns the active master + sheets; inactive -> {"active": False}
  - role gate rejects a non-wizard user

Run via the bench runner (NOT raw unittest -- see CLAUDE.md BoQ test-runner note):
  bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_create_from_template
"""
import json
import re
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import create_from_template as cft
from nirmaan_stack.api.boq.wizard.create_from_template import (
    _clone_worker,
    create_from_template,
    get_clone_status,
    get_master_template,
)
from nirmaan_stack.services.boq_parser.config import SheetConfig

_SHEET_A = "Sheet A"
_SHEET_B = "Sheet B"
_SHEET_G = "Sheet G"          # general_specs disposition
_SHEET_TS = "Sheet TS "       # trailing space -- verbatim identity test (#152)
_SHEET_CONFIG_A = {
    "header_row": 1,
    "area_dimensions": [],
    # A realistic single-area DATA sheet carries a Total-Quantity column -- _collapse_to_single_area
    # guarantees one on every collapsed master data sheet. The A2-D1 insert-before-Total rewrite
    # anchors on it (C=qty_total here); multi-area then inserts the per-area qty cols before C and
    # shifts qty_total right (C -> D/E...).
    "column_role_map": {
        "A": {"role": "sl_no"},
        "B": {"role": "description"},
        "C": {"role": "qty_total"},
    },
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


def _add_template_row(template, sheet, row_index, classification, parent_index, **kw):
    """Insert a pre-flattened BoQ Template Row (structure only -- no qty/rate/overlay)."""
    doc = frappe.new_doc("BoQ Template Row")
    doc.template = template
    doc.sheet_name = sheet
    doc.row_index = row_index
    doc.source_row_number = kw.get("source_row_number", row_index + 1)
    doc.classification = classification
    doc.parent_index = parent_index
    doc.attached_to_index = kw.get("attached_to_index", 0)
    for f in ("level", "path", "sl_no_value", "description", "unit", "make_model", "is_rate_only"):
        if f in kw:
            setattr(doc, f, kw[f])
    # attached_notes is a JSON list-field -- pass a pre-serialized STRING (the LIST-JSON wall:
    # a raw Python list is rejected on insert).
    if "attached_notes" in kw:
        doc.attached_notes = json.dumps(kw["attached_notes"])
    doc.insert(ignore_permissions=True)
    return doc


def _deactivate_all_masters():
    """Make the fixture's master the ONLY active one (create/get resolve is_active=1 first)."""
    for m in frappe.get_all("BoQ Template", filters={"is_active": 1}, fields=["name"]):
        frappe.db.set_value("BoQ Template", m.name, "is_active", 0)


def _build_master_template(work_header, active=True):
    """Build the single master: a BoQ Template + sheets (data / general_specs / trailing-space)
    + WP grandchildren via the JSON list field + pre-flattened template rows.

    Sheet A (data)          : WP=[work_header], general HVAC config, 3 structural rows.
    Sheet B (data)          : no WP, 1 row.
    Sheet G (general_specs) : preamble_text carried on clone; no rows.
    Sheet TS (data, trailing space) : verbatim-identity test; 1 row.
    """
    _deactivate_all_masters()

    tpl = frappe.new_doc("BoQ Template")
    tpl.template_name = f"TPL_MASTER_{frappe.generate_hash(length=5)}"
    tpl.is_active = 1 if active else 0
    tpl.seeded_from_boq = "SEED-TEST"
    # sheet_config is dict-JSON (json.dumps'd here to a valid JSON string -- read back parsed);
    # work_packages is LIST-JSON and MUST be json.dumps'd before insert (the LIST-JSON wall).
    tpl.append("sheets", {
        "sheet_name": _SHEET_A,
        "sheet_order": 1,
        "sheet_label": "HVAC",
        "disposition": "data",
        "sheet_config": json.dumps(_SHEET_CONFIG_A),
        "work_packages": json.dumps([work_header]),
        "preamble_text": "",
    })
    tpl.append("sheets", {
        "sheet_name": _SHEET_B,
        "sheet_order": 2,
        "sheet_label": "",
        "disposition": "data",
        "sheet_config": json.dumps({"header_row": 1, "area_dimensions": []}),
        "work_packages": json.dumps([]),
        "preamble_text": "",
    })
    tpl.append("sheets", {
        "sheet_name": _SHEET_G,
        "sheet_order": 3,
        "sheet_label": "General Specs",
        "disposition": "general_specs",
        "sheet_config": json.dumps({}),
        "work_packages": json.dumps([]),
        "preamble_text": "General preamble for HVAC.",
    })
    tpl.append("sheets", {
        "sheet_name": _SHEET_TS,  # trailing space -- kept VERBATIM
        "sheet_order": 4,
        "sheet_label": "TrailingSpace",
        "disposition": "data",
        "sheet_config": json.dumps({"header_row": 1, "area_dimensions": []}),
        "work_packages": json.dumps([]),
        "preamble_text": "",
    })
    tpl.insert(ignore_permissions=True)

    # Sheet A rows (pre-flattened structure):
    #  0 preamble (root, -1)
    #  1 line_item under 0 -- unit/make_model/attached_notes carried (all copied verbatim)
    #  2 preamble root (-1) -- tests the -1 sentinel is preserved, not turned into 0
    _add_template_row(tpl.name, _SHEET_A, 0, "preamble", -1, level=1,
                      sl_no_value="1", description="Section One")
    _add_template_row(tpl.name, _SHEET_A, 1, "line_item", 0, level=2,
                      sl_no_value="1.1", description="Supply duct", unit="Rmt",
                      make_model="ACME", is_rate_only=0, path="0/1",
                      attached_notes=["carried-note"])
    _add_template_row(tpl.name, _SHEET_A, 2, "preamble", -1, level=1,
                      sl_no_value="2", description="Section Two")
    # Sheet B row.
    _add_template_row(tpl.name, _SHEET_B, 0, "line_item", -1,
                      description="B item", unit="Nos")
    # Sheet TS row (verbatim).
    _add_template_row(tpl.name, _SHEET_TS, 0, "line_item", -1,
                      description="TS item", unit="Nos")

    frappe.db.commit()
    return tpl.name


def _make_target_shell(project, boq_name, master):
    """Create the BOQs shell exactly as create_from_template does, so the worker can run."""
    shell = frappe.new_doc("BOQs")
    shell.project = project
    shell.boq_name = boq_name
    shell.origin = "template"
    shell.is_template_source = 0
    shell.source_template = master
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


def _cleanup_master(master):
    """Raw-delete the master + sheets + rows. The BoQ Template Sheet.work_packages LIST-JSON
    field makes frappe.delete_doc/doc.save throw ('... cannot be a list'), so tear the doc down
    via raw frappe.db.delete (the LIST-JSON wall)."""
    if not master:
        return
    frappe.db.delete("BoQ Template Row", {"template": master})
    frappe.db.delete("BoQ Template Sheet", {"parent": master, "parenttype": "BoQ Template"})
    frappe.db.delete("BoQ Template", {"name": master})
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
        cls.master = _build_master_template(cls.work_header)

    @classmethod
    def tearDownClass(cls):
        _cleanup_boqs(cls.project.name)
        _cleanup_master(cls.master)
        frappe.delete_doc("Work Headers", cls.work_header, force=True, ignore_permissions=True)
        frappe.delete_doc("Projects", cls.project.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    # -- helpers -----------------------------------------------------------
    def _run_clone(self, sheet_names, boq_name=None):
        boq_name = boq_name or f"CLONE_{frappe.generate_hash(length=5)}"
        shell = _make_target_shell(self.project.name, boq_name, self.master)
        _clone_worker(shell, self.master, sheet_names, "Administrator")
        return shell

    def _rows(self, boq, sheet):
        return frappe.get_all(
            "BoQ Review Row",
            filters={"boq": boq, "sheet_name": sheet},
            fields=[
                "row_index", "classification", "parent_index", "attached_to_index",
                "human_parent", "human_classification", "is_excluded", "is_synthetic",
                "chosen_source", "qty_total", "rate_supply", "rate_combined",
                "amount_total", "amount_supply",
                "unit", "make_model", "description", "level", "path", "attached_notes",
            ],
            order_by="row_index asc",
        )

    # -- A2 multi-area helpers + tests ------------------------------------
    def _run_clone_multi(self, sheet_names, areas, boq_name=None):
        boq_name = boq_name or f"CLONE_{frappe.generate_hash(length=5)}"
        shell = _make_target_shell(self.project.name, boq_name, self.master)
        _clone_worker(shell, self.master, sheet_names, "Administrator", areas=areas)
        return shell

    def _sheet_config(self, boq, sheet):
        raw = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": boq, "parenttype": "BOQs", "sheet_name": sheet},
            "sheet_config",
        )
        return json.loads(raw) if isinstance(raw, str) else (raw or {})

    def test_multi_area_rewrites_data_sheet_config(self):
        from nirmaan_stack.services.boq_parser.config import SheetConfig
        shell = self._run_clone_multi([_SHEET_A, _SHEET_G], ["Zone 1", "Zone 2"])
        cfg = self._sheet_config(shell, _SHEET_A)
        role_map = cfg["column_role_map"]
        self.assertEqual(cfg["area_dimensions"], ["Zone 1", "Zone 2"])
        area_of = {e["area"] for e in role_map.values() if e.get("role") == "qty"}
        self.assertEqual(area_of, {"Zone 1", "Zone 2"})
        self.assertEqual(
            len([e for e in role_map.values() if e.get("role") == "qty_total"]), 1,
            "exactly one qty_total (the Total column)",
        )
        # The live gate (get_stale_sheets) runs this validator on every hub load -> must accept
        # the rewrite. sheet_name is injected by _validate_sheet_blob (the only required field).
        SheetConfig.model_validate({**cfg, "sheet_name": _SHEET_A})
        # general_specs sheet is NOT area-ified.
        gcfg = self._sheet_config(shell, _SHEET_G)
        self.assertEqual(gcfg.get("area_dimensions", []), [])

    def test_multi_area_seeds_qty_by_area(self):
        shell = self._run_clone_multi([_SHEET_A], ["Zone 1", "Zone 2"])
        rows = frappe.get_all(
            "BoQ Review Row",
            filters={"boq": shell, "sheet_name": _SHEET_A},
            fields=["row_index", "classification", "qty_by_area", "qty_total"],
            order_by="row_index asc",
        )
        seeded = 0
        for r in rows:
            if r.classification in ("line_item", "preamble"):
                qba = json.loads(r.qty_by_area) if isinstance(r.qty_by_area, str) else r.qty_by_area
                self.assertEqual(qba, {"Zone 1": 0.0, "Zone 2": 0.0})
                self.assertIn(r.qty_total, (0, 0.0))
                seeded += 1
        self.assertGreater(seeded, 0, "at least one eligible row must be qty-seeded")

    def test_single_area_clone_unchanged(self):
        # areas=[] -> byte-identical to Slice 1: no area_dimensions, no per-area qty columns.
        shell = self._run_clone_multi([_SHEET_A], [])
        cfg = self._sheet_config(shell, _SHEET_A)
        self.assertEqual(cfg.get("area_dimensions", []), [])
        self.assertFalse(
            any(e.get("role") == "qty" for e in cfg.get("column_role_map", {}).values()),
            "a single-area clone must not synthesize per-area qty columns",
        )

    # -- tests -------------------------------------------------------------
    def test_copies_classification_verbatim(self):
        shell = self._run_clone([_SHEET_A])
        by_idx = {r.row_index: r for r in self._rows(shell, _SHEET_A)}
        self.assertEqual(by_idx[0].classification, "preamble")
        self.assertEqual(by_idx[1].classification, "line_item")
        self.assertEqual(by_idx[2].classification, "preamble")

    def test_preserves_parent_sentinels(self):
        shell = self._run_clone([_SHEET_A])
        by_idx = {r.row_index: r for r in self._rows(shell, _SHEET_A)}
        # roots keep the -1 sentinel (NOT collapsed to 0, which is a valid row_index).
        self.assertEqual(by_idx[0].parent_index, -1)
        self.assertEqual(by_idx[2].parent_index, -1)
        # a real parent pointer (0) is preserved.
        self.assertEqual(by_idx[1].parent_index, 0)
        # attached_to_index 0 sentinel preserved on every row.
        for r in self._rows(shell, _SHEET_A):
            self.assertEqual(r.attached_to_index, 0)

    def test_strips_qty_rate_amount(self):
        shell = self._run_clone([_SHEET_A])
        by_idx = {r.row_index: r for r in self._rows(shell, _SHEET_A)}
        r1 = by_idx[1]
        for f in ("qty_total", "rate_supply", "rate_combined", "amount_total", "amount_supply"):
            self.assertIn(r1.get(f), (None, 0, 0.0), f"{f} should be blank, got {r1.get(f)}")

    def test_clean_parser_baseline(self):
        shell = self._run_clone([_SHEET_A])
        for r in self._rows(shell, _SHEET_A):
            self.assertEqual(r.is_excluded, 0)
            self.assertEqual(r.is_synthetic, 0)
            self.assertEqual(r.chosen_source, "parser")
            # human_parent MUST be the -1 sentinel, never the Frappe Int default 0.
            self.assertEqual(r.human_parent, -1)
            self.assertFalse(r.human_classification)

    def test_carries_structural_fields(self):
        shell = self._run_clone([_SHEET_A])
        by_idx = {r.row_index: r for r in self._rows(shell, _SHEET_A)}
        r1 = by_idx[1]
        self.assertEqual(r1.unit, "Rmt")
        self.assertEqual(r1.make_model, "ACME")
        self.assertEqual(r1.description, "Supply duct")
        self.assertEqual(r1.level, 2)
        self.assertEqual(r1.path, "0/1")
        # attached_notes JSON carried verbatim. The ORM returns a JSON column already parsed
        # (list) in v15; tolerate a raw string too (read-path dependent).
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
        shell = self._run_clone([_SHEET_A, _SHEET_G])
        gs = frappe.get_all(
            "BoQ General Specs Sheet",
            filters={"parent": shell, "parenttype": "BOQs"},
            fields=["source_sheet_name", "preamble_text"],
        )
        self.assertEqual(len(gs), 1)
        self.assertEqual(gs[0].source_sheet_name, _SHEET_G)
        self.assertEqual(gs[0].preamble_text, "General preamble for HVAC.")

    def test_general_specs_only_for_selected_sheets(self):
        # The general_specs sheet (G) is NOT selected -> no general-specs membership carried.
        shell = self._run_clone([_SHEET_A])
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
        self.assertEqual(len(self._rows(shell, _SHEET_A)), 3)

    def test_sheet_name_matched_verbatim(self):
        # Trailing-space sheet name must clone under its EXACT identity (never .trim()'d).
        shell = self._run_clone([_SHEET_TS])
        drafts = frappe.get_all(
            "BoQ Sheet Draft",
            filters={"parent": shell, "parenttype": "BOQs"},
            fields=["sheet_name"],
        )
        self.assertEqual({d.sheet_name for d in drafts}, {_SHEET_TS})
        self.assertEqual(len(self._rows(shell, _SHEET_TS)), 1)
        # The trimmed form must NOT exist.
        self.assertEqual(self._rows(shell, _SHEET_TS.strip()), [])

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
        _clone_worker(shell, self.master, [_SHEET_A], "Administrator")
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
# Endpoint tests (create_from_template / get_master_template / role gate)
# ---------------------------------------------------------------------------

class TestApplyAreasToSheetConfig(FrappeTestCase):
    """A2-D1 multi-area: the PURE column INSERT-before-Total rewrite (_apply_areas_to_sheet_config).

    The master Total-Quantity column is KEPT and shifted RIGHT by N; the N per-area qty columns
    are inserted into the freed slots immediately BEFORE it; every rate/amount/notes column at or
    after Total shifts right by N in lockstep; column_headers re-key in lockstep (area headers =
    area names, Total header preserved).
    """

    def test_rewrite_inserts_area_cols_before_total_and_shifts_right(self):
        # Realistic HVAC master: A=sl_no B=description C=unit D=qty_total E=rate_supply
        # F=rate_install G=amount_supply H=amount_install I=amount_total J=row_notes.
        cfg = {
            "sheet_name": "HVAC",
            "header_row": 1,
            "area_dimensions": [],
            "column_role_map": {
                "A": {"role": "sl_no"}, "B": {"role": "description"}, "C": {"role": "unit"},
                "D": {"role": "qty_total"},
                "E": {"role": "rate_supply"}, "F": {"role": "rate_install"},
                "G": {"role": "amount_supply"}, "H": {"role": "amount_install"},
                "I": {"role": "amount_total"}, "J": {"role": "row_notes"},
            },
            "column_headers": {
                "A": "Sl. No.", "B": "Description", "C": "Unit", "D": "Total Qty",
                "E": "Supply Rate", "F": "Install Rate", "G": "Supply Amount",
                "H": "Install Amount", "I": "Total Amount", "J": "Notes",
            },
        }
        out = cft._apply_areas_to_sheet_config(cfg, ["Tower A", "Tower B"])
        role_map = out["column_role_map"]

        # For N=2 areas: D=qty(Tower A) E=qty(Tower B) F=qty_total G=rate_supply H=rate_install
        # I=amount_supply J=amount_install K=amount_total L=row_notes.
        self.assertEqual(role_map["A"], {"role": "sl_no"})
        self.assertEqual(role_map["B"], {"role": "description"})
        self.assertEqual(role_map["C"], {"role": "unit"})
        self.assertEqual(role_map["D"], {"role": "qty", "area": "Tower A"})
        self.assertEqual(role_map["E"], {"role": "qty", "area": "Tower B"})
        self.assertEqual(role_map["F"], {"role": "qty_total"})  # KEPT, shifted D -> F
        self.assertEqual(role_map["G"], {"role": "rate_supply"})
        self.assertEqual(role_map["H"], {"role": "rate_install"})
        self.assertEqual(role_map["I"], {"role": "amount_supply"})
        self.assertEqual(role_map["J"], {"role": "amount_install"})
        self.assertEqual(role_map["K"], {"role": "amount_total"})
        self.assertEqual(role_map["L"], {"role": "row_notes"})

        # Exactly one qty_total; area cols occupy the N letters immediately BEFORE the shifted Total.
        total_cols = [c for c, e in role_map.items() if e.get("role") == "qty_total"]
        self.assertEqual(total_cols, ["F"], "Total kept and shifted right by N, exactly once")
        area_cols = {e["area"]: c for c, e in role_map.items() if e.get("role") == "qty"}
        self.assertEqual(area_cols, {"Tower A": "D", "Tower B": "E"})

        # column_headers re-keyed in lockstep: area headers = area names, Total header preserved,
        # rate/amount/notes headers ride the shift.
        headers = out["column_headers"]
        self.assertEqual(headers["A"], "Sl. No.")
        self.assertEqual(headers["B"], "Description")
        self.assertEqual(headers["C"], "Unit")
        self.assertEqual(headers["D"], "Tower A")       # inserted area header
        self.assertEqual(headers["E"], "Tower B")       # inserted area header
        self.assertEqual(headers["F"], "Total Qty")     # PRESERVED, shifted D -> F
        self.assertEqual(headers["G"], "Supply Rate")
        self.assertEqual(headers["H"], "Install Rate")
        self.assertEqual(headers["I"], "Supply Amount")
        self.assertEqual(headers["J"], "Install Amount")
        self.assertEqual(headers["K"], "Total Amount")
        self.assertEqual(headers["L"], "Notes")

        self.assertEqual(out["area_dimensions"], ["Tower A", "Tower B"])
        self.assertTrue(all(re.match(r"^[A-Z]+$", c) for c in role_map),
                        "every column key must be a real Excel letter (^[A-Z]+$)")

        # The rewritten config must survive the live parser validator.
        SheetConfig.model_validate({**cfg, **out})

    def test_rewrite_no_qty_total_anchor_returns_unchanged(self):
        cfg = {
            "sheet_name": "NoTotal", "header_row": 1, "area_dimensions": [],
            "column_role_map": {"A": {"role": "sl_no"}, "B": {"role": "description"}},
        }
        out = cft._apply_areas_to_sheet_config(cfg, ["Tower A"])
        self.assertEqual(out["column_role_map"], cfg["column_role_map"])
        self.assertEqual(out.get("area_dimensions"), [])

    def test_rewrite_is_idempotent_on_rerun(self):
        cfg = {
            "sheet_name": "Idem", "header_row": 1, "area_dimensions": [],
            "column_role_map": {
                "B": {"role": "description"}, "C": {"role": "qty_total"},
                "D": {"role": "rate_combined"}, "E": {"role": "amount_total"},
            },
            "column_headers": {"C": "Total Qty"},
        }
        once = cft._apply_areas_to_sheet_config(cfg, ["Z1", "Z2"])
        twice = cft._apply_areas_to_sheet_config(once, ["Z1", "Z2"])

        for out in (once, twice):
            rm = out["column_role_map"]
            # Re-running never accumulates a second qty_total or duplicate per-area columns.
            self.assertEqual(
                len([e for e in rm.values() if e.get("role") == "qty_total"]), 1)
            self.assertEqual(
                {e["area"] for e in rm.values() if e.get("role") == "qty"}, {"Z1", "Z2"})
            self.assertEqual(out["area_dimensions"], ["Z1", "Z2"])
            # Total header still preserved after the strip-and-reinsert.
            total_col = next(c for c, e in rm.items() if e.get("role") == "qty_total")
            self.assertEqual(out["column_headers"][total_col], "Total Qty")
            SheetConfig.model_validate({**cfg, **out})


class TestCreateFromTemplateEndpoint(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project_fixture()
        cls.work_header = _make_work_header()
        cls.master = _build_master_template(cls.work_header)

    @classmethod
    def tearDownClass(cls):
        _cleanup_boqs(cls.project.name)
        _cleanup_master(cls.master)
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
                project=self.project.name,
                boq_name=None,  # exercise the {project_name}_BOQ default
                sheet_names=[_SHEET_A],
            )
        self.assertEqual(res["job_id"], "job-abc-123")
        shell = frappe.get_doc("BOQs", res["boq_id"])
        self.assertEqual(shell.origin, "template")
        self.assertEqual(shell.source_template, self.master)
        self.assertEqual(shell.is_template_source, 0)
        self.assertEqual(shell.wizard_state, "Parsed")
        self.assertEqual(shell.boq_name, f"{self.project.project_name}_BOQ")
        # enqueue was called with the worker + the new boq id + the master.
        self.assertTrue(mock_enq.called)
        _, kwargs = mock_enq.call_args
        self.assertEqual(kwargs.get("new_boq"), res["boq_id"])
        self.assertEqual(kwargs.get("template"), self.master)
        self.assertEqual(kwargs.get("sheet_names"), [_SHEET_A])

    def test_create_accepts_json_string_sheet_names(self):
        with patch.object(cft.frappe, "enqueue") as mock_enq:
            mock_enq.return_value = MagicMock(id="j1")
            res = create_from_template(
                project=self.project.name,
                boq_name="ExplicitName",
                sheet_names=json.dumps([_SHEET_A, _SHEET_B]),
            )
        self.assertEqual(frappe.db.get_value("BOQs", res["boq_id"], "boq_name"), "ExplicitName")

    def test_create_persists_tax_treatment_and_notes(self):
        # A2: the create-from-template form carries GST Treatment (-> tax_treatment) + Notes.
        with patch.object(cft.frappe, "enqueue") as mock_enq:
            mock_enq.return_value = MagicMock(id="j-tax")
            res = create_from_template(
                project=self.project.name,
                boq_name="TaxedBoQ",
                sheet_names=[_SHEET_A],
                tax_treatment="Post-tax",
                notes="from the tender pack",
            )
        shell = frappe.get_doc("BOQs", res["boq_id"])
        self.assertEqual(shell.tax_treatment, "Post-tax")
        self.assertEqual(shell.notes, "from the tender pack")

    def test_create_invalid_tax_treatment_defaults_pre_tax(self):
        # A2: tax_treatment is a Select -- an invalid value must be whitelisted to a safe default,
        # never passed through to 500 on insert.
        with patch.object(cft.frappe, "enqueue") as mock_enq:
            mock_enq.return_value = MagicMock(id="j-bad-tax")
            res = create_from_template(
                project=self.project.name,
                boq_name="BadTaxBoQ",
                sheet_names=[_SHEET_A],
                tax_treatment="Gibberish",
            )
        self.assertEqual(
            frappe.db.get_value("BOQs", res["boq_id"], "tax_treatment"), "Pre-tax"
        )

    def test_create_three_arg_caller_still_works(self):
        # A2 additive-kwargs proof: the pre-A2 3-arg signature must be unaffected; unspecified
        # tax_treatment falls back to the safe default.
        with patch.object(cft.frappe, "enqueue") as mock_enq:
            mock_enq.return_value = MagicMock(id="j-3arg")
            res = create_from_template(self.project.name, "ThreeArgBoQ", [_SHEET_A])
        shell = frappe.get_doc("BOQs", res["boq_id"])
        self.assertEqual(shell.boq_name, "ThreeArgBoQ")
        self.assertEqual(shell.tax_treatment, "Pre-tax")

    def test_create_multi_area_writes_shell_area_dimensions(self):
        # A2 multi-area: BOQs.area_dimensions (JSON string) is written + areas reach the worker.
        with patch.object(cft.frappe, "enqueue") as mock_enq:
            mock_enq.return_value = MagicMock(id="j-ma")
            res = create_from_template(
                project=self.project.name,
                boq_name="MultiAreaBoQ",
                sheet_names=[_SHEET_A],
                areas=["Tower A", "Tower B"],
            )
        raw = frappe.db.get_value("BOQs", res["boq_id"], "area_dimensions")
        self.assertEqual(json.loads(raw), ["Tower A", "Tower B"])
        _, kwargs = mock_enq.call_args
        self.assertEqual(kwargs.get("areas"), ["Tower A", "Tower B"])

    def test_create_single_area_leaves_shell_area_dimensions_blank(self):
        with patch.object(cft.frappe, "enqueue") as mock_enq:
            mock_enq.return_value = MagicMock(id="j-sa")
            res = create_from_template(
                project=self.project.name, boq_name="SingleAreaBoQ",
                sheet_names=[_SHEET_A], areas=[],
            )
        self.assertFalse(frappe.db.get_value("BOQs", res["boq_id"], "area_dimensions"))

    def test_create_multi_area_accepts_json_string(self):
        # areas arrives from the FE as a JSON string (like sheet_names).
        with patch.object(cft.frappe, "enqueue") as mock_enq:
            mock_enq.return_value = MagicMock(id="j-ma-json")
            res = create_from_template(
                project=self.project.name, boq_name="MultiAreaJsonBoQ",
                sheet_names=json.dumps([_SHEET_A]), areas=json.dumps(["A1", "A2"]),
            )
        self.assertEqual(
            json.loads(frappe.db.get_value("BOQs", res["boq_id"], "area_dimensions")),
            ["A1", "A2"],
        )

    def test_rejects_when_no_active_master(self):
        frappe.db.set_value("BoQ Template", self.master, "is_active", 0)
        frappe.db.commit()
        try:
            with patch.object(cft.frappe, "enqueue"):
                with self.assertRaises(frappe.ValidationError):
                    create_from_template(
                        project=self.project.name,
                        sheet_names=[_SHEET_A],
                    )
        finally:
            frappe.db.set_value("BoQ Template", self.master, "is_active", 1)
            frappe.db.commit()

    def test_rejects_empty_sheet_names(self):
        with self.assertRaises(frappe.ValidationError):
            create_from_template(
                project=self.project.name,
                sheet_names=[],
            )

    def test_rejects_unknown_sheet(self):
        with self.assertRaises(frappe.ValidationError):
            create_from_template(
                project=self.project.name,
                sheet_names=["Nonexistent Sheet"],
            )

    def test_rejects_unknown_project(self):
        with self.assertRaises(frappe.ValidationError):
            create_from_template(
                project="NO-SUCH-PROJECT",
                sheet_names=[_SHEET_A],
            )

    def test_get_master_template_returns_active_with_sheets(self):
        res = get_master_template()
        self.assertTrue(res["active"])
        self.assertEqual(res["name"], self.master)
        by_name = {s["sheet_name"]: s for s in res["sheets"]}
        self.assertEqual(set(by_name), {_SHEET_A, _SHEET_B, _SHEET_G, _SHEET_TS})
        self.assertEqual(by_name[_SHEET_A]["disposition"], "data")
        self.assertEqual(by_name[_SHEET_A]["sheet_label"], "HVAC")
        self.assertEqual(by_name[_SHEET_G]["disposition"], "general_specs")
        # ordered by sheet_order.
        orders = [s["sheet_order"] for s in res["sheets"]]
        self.assertEqual(orders, sorted(orders))

    def test_get_master_template_inactive_returns_guard(self):
        frappe.db.set_value("BoQ Template", self.master, "is_active", 0)
        frappe.db.commit()
        try:
            res = get_master_template()
            self.assertEqual(res, {"active": False})
        finally:
            frappe.db.set_value("BoQ Template", self.master, "is_active", 1)
            frappe.db.commit()

    def test_role_gate_rejects_non_wizard_user(self):
        original = frappe.session.user
        try:
            frappe.set_user("Guest")  # no Nirmaan Users row -> role_profile None
            with self.assertRaises(frappe.PermissionError):
                get_master_template()
        finally:
            frappe.set_user(original)
