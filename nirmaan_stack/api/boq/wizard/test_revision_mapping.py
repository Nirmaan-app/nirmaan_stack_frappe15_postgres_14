"""S3 (#1100, ADR-0014 D3/D4) -- revised-BoQ sheet-MAPPING tests.

S3 is the pairing authority + the seeding the whole carry pipeline hangs off. These
tests pin the two endpoints (`get_revision_mapping_proposal` / `confirm_revision_mapping`)
end-to-end over the real committed tiers, with the workbook read stubbed so the tab set is
deterministic:

  * PROPOSAL Zone-1 -- identity + committed-sheet list (with the general-specs flag) + the
    cheap carry COUNTs (rates / classifications), no parse.
  * PROPOSAL Zone-2 -- N2 pre-fill of confident pairings, blank + self-collision flag where
    a key is ambiguous; general-specs designation carried on a matched sheet.
  * CONFIRM -- seeds drafts VERBATIM at Pending in tab order, stamps source_sheet_name
    write-once, carries the general-specs designation; strict 1:1 + valid-original + cover-all
    -tabs guards; a second confirm is rejected (write-once).
  * A non-revision BoQ is refused by both endpoints.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.revision import (
    _read_revised_tab_names,
    confirm_revision_mapping,
    get_removed_source_sheets,
    get_revision_mapping_proposal,
)
from nirmaan_stack.api.boq.wizard.test_revision_entry import (
    _SIMPLE_XLSX,
    _cleanup_project,
    _commit_sheet,
    _make_boq,
    _make_project,
    _make_xlsx_tempfile,
)

_READ_TABS = "nirmaan_stack.api.boq.wizard.revision._read_revised_tab_names"


# ---------------------------------------------------------------------------
# fixtures (extend S2's with revision + committed-tier rows)
# ---------------------------------------------------------------------------

def _make_revision(project_name, source_boq, boq_name=None):
    """A NEW unconfirmed revision BOQs doc: origin='revision', source_boq, empty drafts."""
    boq = frappe.new_doc("BOQs")
    boq.project = project_name
    boq.boq_name = boq_name or f"Rev Map BoQ {frappe.generate_hash(length=4)}"
    boq.tax_treatment = "Pre-tax"
    boq.origin = "revision"
    boq.source_boq = source_boq
    boq.source_file_url = "/private/files/revised.xlsx"  # never read -- _read_revised_tab_names is stubbed
    boq.insert(ignore_permissions=True)
    frappe.db.commit()
    return boq


def _commit_gs_sheet(boq_name, sheet, version=1):
    """A CURRENT committed grid row with the general-specs disposition (grid_only)."""
    grid = frappe.new_doc("BoQ Committed Sheet Grid")
    grid.boq = boq_name
    grid.source_sheet_name = sheet
    grid.sheet_disposition = "grid_only"
    grid.commit_version = version
    grid.is_current = 1
    grid.committed_at = frappe.utils.now()
    grid.insert(ignore_permissions=True)
    frappe.db.commit()
    return grid


def _make_pricing_row(boq_name, sheet, excel_row, col, is_current=1):
    doc = frappe.new_doc("BoQ Cell Pricing")
    doc.boq = boq_name
    doc.sheet_name = sheet
    doc.excel_row = excel_row
    doc.col_letter = col
    doc.committed_version = 1
    doc.pricing_version = 1
    doc.is_current = is_current
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc


def _make_boq_sheet(boq_name, sheet):
    doc = frappe.new_doc("BoQ Sheet")
    doc.boq = boq_name
    doc.sheet_name = sheet
    doc.sheet_order = 1
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc


def _make_node(boq_sheet_name, human_classification, is_current=1):
    """A CURRENT BOQ Node with a (possibly blank) human_classification. node_type='Other'
    dodges the Preamble/Line-Item level/description/qty controller throws."""
    doc = frappe.new_doc("BOQ Nodes")
    doc.sheet = boq_sheet_name
    doc.node_type = "Other"
    doc.human_classification = human_classification
    doc.is_current = is_current
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc


def _cleanup_all(project_name):
    """Delete the committed child tiers this suite adds, then delegate to S2's cleanup."""
    for boq in frappe.get_all("BOQs", filters={"project": project_name}, fields=["name"]):
        for dt, key in (
            ("BOQ Nodes", "boq"),
            ("BoQ Cell Pricing", "boq"),
            ("BoQ Sheet", "boq"),
        ):
            for r in frappe.get_all(dt, filters={key: boq.name}, fields=["name"]):
                frappe.delete_doc(dt, r.name, force=True, ignore_permissions=True)
    frappe.db.commit()
    _cleanup_project(project_name)


# ---------------------------------------------------------------------------
# 1. get_revision_mapping_proposal
# ---------------------------------------------------------------------------

class TestRevisionMappingProposal(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="XORIANT HVAC")
        frappe.db.set_value("BOQs", cls.original.name, "version", 2)
        # Two committed sheets: 'Electrical' (data), 'Approved Make List' (general-specs).
        _commit_sheet(cls.original.name, sheet="Electrical", version=3)
        _commit_gs_sheet(cls.original.name, sheet="Approved Make List", version=1)

    @classmethod
    def tearDownClass(cls):
        _cleanup_all(cls.project.name)
        super().tearDownClass()

    def _proposal(self, tabs):
        rev = _make_revision(self.project.name, self.original.name)
        with patch(_READ_TABS, return_value=tabs):
            return get_revision_mapping_proposal(rev.name)

    def test_zone1_identity_and_committed_sheets(self):
        p = self._proposal(["Electrical"])
        self.assertEqual(p["source_boq"], self.original.name)
        self.assertEqual(p["boq_name"], "XORIANT HVAC")
        self.assertEqual(p["source_version"], 2)
        by_name = {c["sheet_name"]: c for c in p["committed_sheets"]}
        self.assertEqual(set(by_name), {"Electrical", "Approved Make List"})
        self.assertFalse(by_name["Electrical"]["general_specs"])
        self.assertTrue(by_name["Approved Make List"]["general_specs"])
        self.assertEqual(by_name["Electrical"]["commit_version"], 3)

    def test_zone1_carry_counts(self):
        # 2 current rates (+1 superseded, not counted); 1 classified node (+1 blank, not counted).
        _make_pricing_row(self.original.name, "Electrical", 5, "F")
        _make_pricing_row(self.original.name, "Electrical", 6, "F")
        _make_pricing_row(self.original.name, "Electrical", 7, "F", is_current=0)
        sheet = _make_boq_sheet(self.original.name, "Electrical")
        _make_node(sheet.name, "line_item")
        _make_node(sheet.name, "")  # blank human_classification -> not counted
        p = self._proposal(["Electrical"])
        self.assertEqual(p["carry_counts"]["rates"], 2)
        self.assertEqual(p["carry_counts"]["classifications"], 1)

    def test_zone2_prefills_clean_match_and_flags_unmatched(self):
        p = self._proposal(["Electrical", "Brand New Sheet"])
        by = {s["sheet_name"]: s for s in p["revised_sheets"]}
        self.assertEqual(by["Electrical"]["status"], "matched")
        self.assertEqual(by["Electrical"]["proposed_source"], "Electrical")
        self.assertEqual(by["Electrical"]["sheet_order"], 1)
        self.assertEqual(by["Brand New Sheet"]["status"], "unmatched")
        self.assertIsNone(by["Brand New Sheet"]["proposed_source"])
        self.assertFalse(p["self_collision"])

    def test_zone2_general_specs_carried_on_matched(self):
        p = self._proposal(["approved make list "])  # whitespace/case drift -> N2 matches
        s = p["revised_sheets"][0]
        self.assertEqual(s["status"], "matched")
        self.assertEqual(s["proposed_source"], "Approved Make List")
        self.assertTrue(s["general_specs"])

    def test_zone2_self_collision_flag(self):
        p = self._proposal(["SUMMARY ", "Summary", "Electrical"])
        by = {s["sheet_name"]: s for s in p["revised_sheets"]}
        self.assertTrue(p["self_collision"])
        self.assertEqual(by["SUMMARY "]["status"], "unmatched")
        self.assertEqual(by["Summary"]["status"], "unmatched")
        self.assertEqual(by["Electrical"]["status"], "matched")

    def test_rejects_non_revision(self):
        upload = _make_boq(self.project.name, origin="upload")
        with self.assertRaises(frappe.ValidationError):
            get_revision_mapping_proposal(upload.name)

    def test_real_workbook_read_path(self):
        # One test exercises the REAL tab-name read (via S2's tempfile stub) end to end.
        rev = _make_revision(self.project.name, self.original.name)
        with patch(
            "nirmaan_stack.api.boq.wizard.sheet_preview._fetch_boq_file_to_tempfile",
            return_value=_make_xlsx_tempfile(),
        ):
            names = _read_revised_tab_names(rev.source_file_url)
        self.assertEqual(names, ["Sheet1"])


# ---------------------------------------------------------------------------
# 2. confirm_revision_mapping
# ---------------------------------------------------------------------------

class TestConfirmRevisionMapping(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="ORIG BoQ")
        _commit_sheet(cls.original.name, sheet="Electrical", version=1)
        _commit_gs_sheet(cls.original.name, sheet="Make List", version=1)

    @classmethod
    def tearDownClass(cls):
        _cleanup_all(cls.project.name)
        super().tearDownClass()

    def _revision(self):
        return _make_revision(self.project.name, self.original.name)

    def _confirm(self, rev_name, tabs, mapping):
        with patch(_READ_TABS, return_value=tabs):
            return confirm_revision_mapping(rev_name, mapping)

    def test_seeds_drafts_verbatim_order_and_status(self):
        rev = self._revision()
        tabs = ["Electrical", "New Sheet"]
        mapping = [
            {"sheet_name": "Electrical", "source_sheet_name": "Electrical"},
            {"sheet_name": "New Sheet", "source_sheet_name": None, "declared_new": True},
        ]
        res = self._confirm(rev.name, tabs, mapping)
        self.assertEqual(res["status"], "saved")
        self.assertEqual(res["seeded"], 2)

        doc = frappe.get_doc("BOQs", rev.name)
        drafts = sorted(doc.sheet_drafts, key=lambda d: d.sheet_order)
        self.assertEqual([d.sheet_name for d in drafts], ["Electrical", "New Sheet"])
        self.assertEqual([d.sheet_order for d in drafts], [1, 2])
        self.assertTrue(all(d.wizard_status == "Pending" for d in drafts))
        self.assertEqual(drafts[0].source_sheet_name, "Electrical")  # mapped -> cross-doc pointer
        self.assertIn(drafts[1].source_sheet_name, (None, ""))  # declared New -> no pointer

    def test_carries_general_specs_designation(self):
        rev = self._revision()
        tabs = ["Make List"]
        mapping = [{"sheet_name": "Make List", "source_sheet_name": "Make List", "general_specs": True}]
        self._confirm(rev.name, tabs, mapping)
        doc = frappe.get_doc("BOQs", rev.name)
        gs = [g.source_sheet_name for g in (doc.general_specs_sheets or [])]
        self.assertEqual(gs, ["Make List"])  # keyed by THIS doc's own name (#152)
        self.assertEqual(doc.general_specs_sheets[0].preamble_text or "", "")  # blank, re-extracts

    def test_general_specs_opt_out(self):
        rev = self._revision()
        tabs = ["Make List"]
        mapping = [{"sheet_name": "Make List", "source_sheet_name": "Make List", "general_specs": False}]
        self._confirm(rev.name, tabs, mapping)
        doc = frappe.get_doc("BOQs", rev.name)
        self.assertEqual(list(doc.general_specs_sheets or []), [])

    def test_strict_1to1_rejects_double_claim(self):
        rev = self._revision()
        tabs = ["Elec A", "Elec B"]
        mapping = [
            {"sheet_name": "Elec A", "source_sheet_name": "Electrical"},
            {"sheet_name": "Elec B", "source_sheet_name": "Electrical"},
        ]
        with self.assertRaises(frappe.ValidationError):
            self._confirm(rev.name, tabs, mapping)
        self.assertEqual(frappe.get_doc("BOQs", rev.name).sheet_drafts, [])  # nothing seeded

    def test_rejects_invalid_original(self):
        rev = self._revision()
        tabs = ["X"]
        mapping = [{"sheet_name": "X", "source_sheet_name": "Not A Sheet"}]
        with self.assertRaises(frappe.ValidationError):
            self._confirm(rev.name, tabs, mapping)

    def test_rejects_mapping_not_covering_tabs(self):
        rev = self._revision()
        tabs = ["Electrical", "Plumbing"]
        mapping = [{"sheet_name": "Electrical", "source_sheet_name": "Electrical"}]  # 'Plumbing' undeclared
        with self.assertRaises(frappe.ValidationError):
            self._confirm(rev.name, tabs, mapping)

    def test_rejects_undecided_entry(self):
        # A tab present in the mapping but neither mapped nor declared New (null source, no
        # declared_new) is UNDECIDED -> the server-side hard stop refuses it (defence-in-depth
        # over the client gate), so a stale POST can never silently seed everything as New.
        rev = self._revision()
        tabs = ["Electrical"]
        mapping = [{"sheet_name": "Electrical", "source_sheet_name": None}]  # no declared_new
        with self.assertRaises(frappe.ValidationError):
            self._confirm(rev.name, tabs, mapping)
        self.assertEqual(frappe.get_doc("BOQs", rev.name).sheet_drafts, [])

    def test_accepts_json_string_mapping(self):
        rev = self._revision()
        tabs = ["Electrical"]
        mapping = frappe.as_json([{"sheet_name": "Electrical", "source_sheet_name": "Electrical"}])
        res = self._confirm(rev.name, tabs, mapping)
        self.assertEqual(res["seeded"], 1)

    def test_write_once_second_confirm_rejected(self):
        rev = self._revision()
        tabs = ["Electrical"]
        mapping = [{"sheet_name": "Electrical", "source_sheet_name": "Electrical"}]
        self._confirm(rev.name, tabs, mapping)
        with self.assertRaises(frappe.ValidationError):
            self._confirm(rev.name, tabs, mapping)
        # still exactly one draft -- no duplicate seeding
        self.assertEqual(len(frappe.get_doc("BOQs", rev.name).sheet_drafts), 1)

    def test_rejects_non_revision(self):
        upload = _make_boq(self.project.name, origin="upload")
        with self.assertRaises(frappe.ValidationError):
            confirm_revision_mapping(upload.name, [])


# ---------------------------------------------------------------------------
# 3. get_removed_source_sheets  (D4 hub removed-sheet advisory)
# ---------------------------------------------------------------------------
class TestGetRemovedSourceSheets(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="ORIG BoQ")
        _commit_sheet(cls.original.name, sheet="Electrical", version=1)
        _commit_gs_sheet(cls.original.name, sheet="Make List", version=1)

    @classmethod
    def tearDownClass(cls):
        _cleanup_all(cls.project.name)
        super().tearDownClass()

    def _revision(self):
        return _make_revision(self.project.name, self.original.name)

    def _confirm(self, rev_name, tabs, mapping):
        with patch(_READ_TABS, return_value=tabs):
            return confirm_revision_mapping(rev_name, mapping)

    def test_unclaimed_original_is_removed(self):
        # Claim only "Electrical"; the original's "Make List" is left unclaimed -> removed.
        rev = self._revision()
        self._confirm(
            rev.name,
            ["Electrical"],
            [{"sheet_name": "Electrical", "source_sheet_name": "Electrical"}],
        )
        res = get_removed_source_sheets(rev.name)
        self.assertEqual([r["sheet_name"] for r in res["removed"]], ["Make List"])
        self.assertTrue(res["removed"][0]["general_specs"])  # Make List is a gs sheet
        self.assertEqual(res["source_version"], 1)

    def test_renamed_tab_claims_original_not_removed(self):
        # A renamed revised tab still POINTS at its original via source_sheet_name -> the
        # original is CLAIMED, not removed (the exact E2E rename case: 'ACS & CCTV R2').
        rev = self._revision()
        self._confirm(
            rev.name,
            ["Electrical R2", "Make List"],
            [
                {"sheet_name": "Electrical R2", "source_sheet_name": "Electrical"},
                {"sheet_name": "Make List", "source_sheet_name": "Make List"},
            ],
        )
        self.assertEqual(get_removed_source_sheets(rev.name)["removed"], [])

    def test_new_sheet_does_not_claim_anything(self):
        # A declared-New tab claims no original -> both originals stay removed.
        rev = self._revision()
        self._confirm(
            rev.name,
            ["Brand New"],
            [{"sheet_name": "Brand New", "source_sheet_name": None, "declared_new": True}],
        )
        removed = {r["sheet_name"] for r in get_removed_source_sheets(rev.name)["removed"]}
        self.assertEqual(removed, {"Electrical", "Make List"})

    def test_unconfirmed_revision_returns_empty(self):
        # Before the mapping is confirmed (no drafts) "removed" has no meaning.
        rev = self._revision()
        self.assertEqual(get_removed_source_sheets(rev.name), {"removed": [], "source_version": None})

    def test_rejects_non_revision(self):
        upload = _make_boq(self.project.name, origin="upload")
        with self.assertRaises(frappe.ValidationError):
            get_removed_source_sheets(upload.name)
