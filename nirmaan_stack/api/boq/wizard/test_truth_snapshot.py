# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for the ground-truth snapshot store (D3a): the BoQ Category Truth Snapshot doctype +
the corpus label loader (corpus_classify_and_label.run mode='label').

Coverage matrix:
  POS  loader label-load -> LINE ITEM labels banked as snapshot rows; readable by durable
       address; fields intact (label_category_id / source / snapshot_by / committed_version).
  POS  skip: a label whose excel_row has no current eligible node is skipped, not inserted.
  NEG  controller rejects an empty label_category_id.
  NEG  loader aborts (no writes) when any label is out-of-vocabulary for the discipline.
  IDEMPOTENCE  a second bulk load over an already-covered sheet is refused; force_new_batch banks
       a fresh batch.
  JOIN  a snapshot row joins to a BoQ Row Category current row by (boq, sheet_name, excel_row,
       discipline) -- the cockpit's future read.

Truth model reminder: snapshots are PERMANENT ground truth banked out-of-band; live BoQ Row
Category rows are working state and are NOT touched by the loader.
"""
import csv
import os
import shutil
import tempfile

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_category import persist
from nirmaan_stack.services.boq_category.harness import corpus_classify_and_label as loader
from nirmaan_stack.api.boq.wizard.test_review_screen import _cleanup_project, _make_project

_SNAPSHOT = "BoQ Category Truth Snapshot"
_SHEET = "RC Truth Sheet "  # VERBATIM trailing space (#152)


class TestTruthSnapshot(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.project.name
        boq.boq_name = "Truth Snapshot BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.cv = 1

        # committed sheet + a tiny tree: Preamble root (src 9) + two Line Items (src 10, 11).
        bs = frappe.new_doc("BoQ Sheet")
        bs.boq = cls.boq
        bs.sheet_name = _SHEET
        bs.sheet_order = 1
        bs.commit_version = 1
        bs.is_current = 1
        bs.insert(ignore_permissions=True)
        cls.sheet_doc = bs.name

        def node(nt, src, parent, desc, sort):
            n = frappe.new_doc("BOQ Nodes")
            n.boq = cls.boq
            n.sheet = cls.sheet_doc
            n.node_type = nt
            n.source_row_number = src
            n.parent_node = parent
            n.description = desc
            n.sort_order = sort
            n.commit_version = 1
            n.is_current = 1
            if nt == "Preamble":
                n.level = 0
            if nt == "Line Item":
                n.qty = 0
            n.insert(ignore_permissions=True)
            return n.name

        root = node("Preamble", 9, None, "SECTION", 1)
        node("Line Item", 10, root, "cable run", 2)
        node("Line Item", 11, root, "mcb board", 3)
        frappe.db.commit()

        # a minimal labelled corpus file: BoQ id from the filename prefix, sheet_name verbatim.
        cls.corpus = tempfile.mkdtemp(prefix="truthsnap_")
        path = os.path.join(cls.corpus, f"{cls.boq}__RC Truth Sheet.csv")
        with open(path, "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh)
            w.writerow(["sheet_name", "node_type", "excel_row", "description", "team_classification"])
            w.writerow([_SHEET, "Preamble", 9, "SECTION", "earthing"])          # not a Line Item -> ignored
            w.writerow([_SHEET, "Line Item", 10, "cable run", "wiring_cabling"])  # eligible -> inserted
            w.writerow([_SHEET, "Line Item", 11, "mcb board", "db_switchgear"])   # eligible -> inserted
            w.writerow([_SHEET, "Line Item", 999, "ghost row", "panels"])         # no node -> skipped

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete(_SNAPSHOT, {"boq": cls.boq})
        frappe.db.delete("BoQ Row Category", {"boq": cls.boq})
        frappe.db.delete("BOQ Nodes", {"boq": cls.boq})
        frappe.db.delete("BoQ Sheet", {"boq": cls.boq})
        frappe.db.commit()
        shutil.rmtree(cls.corpus, ignore_errors=True)
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def _clear_snapshots(self):
        frappe.db.delete(_SNAPSHOT, {"boq": self.boq})
        frappe.db.commit()

    def _load(self, **kw):
        return loader.run(mode="label", corpus=self.corpus, discipline="Electrical", **kw)

    # NEG -- controller validation
    def test_1_controller_rejects_empty_label(self):
        doc = frappe.new_doc(_SNAPSHOT)
        doc.boq = self.boq
        doc.sheet_name = _SHEET
        doc.excel_row = 10
        doc.discipline = "Electrical"
        doc.committed_version = self.cv
        doc.label_category_id = ""  # empty -> must be rejected
        doc.snapshot_batch = "gtbulk-test"
        doc.source = "Bulk-loaded ground truth"
        with self.assertRaises(frappe.exceptions.ValidationError):
            doc.insert(ignore_permissions=True)

    # POS -- load inserts eligible labels, skips the non-eligible one, fields intact
    def test_2_load_inserts_skips_and_reads_back(self):
        self._clear_snapshots()
        res = self._load()
        self.assertEqual(res["inserted"], 2)   # rows 10 + 11
        self.assertEqual(res["skipped"], 1)     # row 999 (no current eligible node)
        rows = frappe.get_all(
            _SNAPSHOT,
            filters={"boq": self.boq, "sheet_name": _SHEET, "discipline": "Electrical"},
            fields=["excel_row", "label_category_id", "source", "snapshot_by",
                    "committed_version", "snapshot_batch"],
        )
        by_row = {r["excel_row"]: r for r in rows}
        self.assertEqual(set(by_row), {10, 11})
        self.assertEqual(by_row[10]["label_category_id"], "wiring_cabling")
        self.assertEqual(by_row[11]["label_category_id"], "db_switchgear")
        self.assertEqual(by_row[10]["source"], "Bulk-loaded ground truth")
        self.assertEqual(by_row[10]["snapshot_by"], "ground-truth-bulk")
        self.assertEqual(by_row[10]["committed_version"], self.cv)
        self.assertTrue(by_row[10]["snapshot_batch"].startswith("gtbulk-"))

    # NEG -- out-of-vocabulary label aborts the whole load (no writes)
    def test_3_out_of_vocab_aborts(self):
        self._clear_snapshots()
        bad = os.path.join(self.corpus, f"{self.boq}__RC Truth Sheet.csv")
        good = open(bad, encoding="utf-8-sig").read()
        try:
            with open(bad, "w", newline="", encoding="utf-8-sig") as fh:
                w = csv.writer(fh)
                w.writerow(["sheet_name", "node_type", "excel_row", "description", "team_classification"])
                w.writerow([_SHEET, "Line Item", 10, "cable run", "not_a_real_category"])
            with self.assertRaises(frappe.exceptions.ValidationError):
                self._load()
            self.assertEqual(frappe.db.count(_SNAPSHOT, {"boq": self.boq}), 0)  # nothing written
        finally:
            with open(bad, "w", newline="", encoding="utf-8-sig") as fh:
                fh.write(good)

    # IDEMPOTENCE -- second load refused; force_new_batch banks a fresh batch
    def test_4_idempotence_and_force(self):
        self._clear_snapshots()
        first = self._load()
        with self.assertRaises(frappe.exceptions.ValidationError):
            self._load()  # already covered -> refused
        forced = self._load(force_new_batch=True)
        self.assertNotEqual(forced["batch"], first["batch"])
        batches = {r["snapshot_batch"] for r in frappe.get_all(
            _SNAPSHOT, filters={"boq": self.boq}, fields=["snapshot_batch"])}
        self.assertEqual(len(batches), 2)  # both batches banked (snapshots are permanent)

    # JOIN -- snapshot row joins to a live Row Category current row by durable address
    def test_5_join_to_row_category(self):
        self._clear_snapshots()
        self._load()
        persist.write_row_categories(
            self.boq, _SHEET, self.cv, "Electrical",
            [{"excel_row": 10, "final_category_id": "wiring_cabling", "rule_category_id": "wiring_cabling",
              "ai_category_id": "wiring_cabling", "rule_band": "HIGH", "routing": "Auto-accepted"}],
        )
        joined = frappe.db.sql(
            '''SELECT s.label_category_id, rc.final_category_id
               FROM "tabBoQ Category Truth Snapshot" s
               JOIN "tabBoQ Row Category" rc
                 ON rc.boq = s.boq AND rc.sheet_name = s.sheet_name
                AND rc.excel_row = s.excel_row AND rc.discipline = s.discipline
               WHERE s.boq=%s AND s.excel_row=10 AND rc.is_current=1''', (self.boq,), as_dict=True)
        self.assertEqual(len(joined), 1)
        self.assertEqual(joined[0]["label_category_id"], "wiring_cabling")
        self.assertEqual(joined[0]["final_category_id"], "wiring_cabling")
