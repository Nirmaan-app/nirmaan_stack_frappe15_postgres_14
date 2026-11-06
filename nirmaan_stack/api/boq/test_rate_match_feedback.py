# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for "Not a match" (DEV2-B5 S3, T1; api/boq/rate_match.py mark_not_a_match / undo_not_a_match /
get_match_results' flag / get_match_detail, doctype BoQ Rate Match Feedback). Each test runs inside a savepoint that is
rolled back; the endpoints' commit is patched out; no model call.

  mark          a shown match -> one "not_a_match" row (reason, note, user, time, the run's version); the results
                carry flag on THAT match only  /  an unknown match, another sheet's run, a bad reason -> refused,
                nothing written
  undo          one "undo" row; the flag is gone  /  undo with nothing marked, a second mark -> refused
  latest wins   mark, undo, mark again -> flagged, three rows (append-only)
  append-only   a saved row cannot be changed or deleted
  permissions   the sheet re-committed, deliberately locked, or held fresh by someone else -> refused  /  free,
                mine or stale -> allowed (the lock is only read)
  detail        project / BoQ name and the payload block by the pool's builder, with its sha; can_open from the
                read permission  /  a match the run does not show -> refused
"""
import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_match as RM

BOQ, MBOQ, SHEET, MSHEET, RUN = "BOQ-TEST-RMF-T", "BOQ-TEST-RMF-M", "S", "Old|sheet", "BRMR-TEST-RMF-1"
MATCH = {"key": "k", "boq": MBOQ, "sheet_name": MSHEET, "excel_row": 9, "verdict": "SAME", "colour": "green",
         "supply_rate": 10.0, "install_rate": 2.0, "total_rate": 12.0, "unit": "Nos", "priced_at": "2026-10-01"}
OTHER = dict(MATCH, excel_row=10, colour="amber")


def _bare(table, name, **cols):
    keys = ["name", "creation", "modified", "owner", "modified_by", "docstatus", "idx", *cols]
    vals = [name, "2026-11-03 18:00:00", "2026-11-03 18:00:00", "Administrator", "Administrator", 0, 0, *cols.values()]
    frappe.db.sql(f'insert into "tab{table}" ({", ".join(chr(34) + k + chr(34) for k in keys)}) values ({", ".join(["%s"] * len(vals))})', vals)


class _Base(FrappeTestCase):
    def setUp(self):
        frappe.db.savepoint("rmf")
        _bare("BOQs", BOQ)
        _bare("BOQs", MBOQ, boq_name="Old tender")
        rows = [{"excel_row": 5, "matches": [MATCH, OTHER], "status": "matched"}, {"excel_row": 6, "matches": [], "status": "no match shown"}]
        _bare("BoQ Rate Match Run", RUN, boq=BOQ, sheet_name=SHEET, commit_version=3, status="complete", active=1,
              results=json.dumps({"rows": rows}))
        self.p = [patch.object(frappe.db, "commit"), patch.object(RM, "_guard_can_price")]
        for x in self.p:
            x.start()

    def tearDown(self):
        for x in self.p:
            x.stop()
        frappe.db.rollback(save_point="rmf")

    def mark(self, er=9, **kw):
        return RM.mark_not_a_match(BOQ, SHEET, 5, RUN, MBOQ, MSHEET, er, **kw)

    def undo(self, er=9):
        return RM.undo_not_a_match(BOQ, SHEET, 5, RUN, MBOQ, MSHEET, er)

    def rows(self):
        return frappe.get_all(RM.FEEDBACK_DOCTYPE, filters={"boq": BOQ}, fields=["action", "reason", "note", "user", "commit_version",
                                                                             "match_run", "match_excel_row"], order_by="creation asc, name asc")

    def flags(self):
        res = RM.get_match_results(BOQ, SHEET)["run"]["rows"]
        return {(r["excel_row"], m["excel_row"]): m["flag"] for r in res for m in r["matches"]}


class TestMarkAndUndo(_Base):
    def test_mark_writes_one_row_and_flags_that_match_only(self):
        out = self.mark(reason="Different unit", note="this one is aluminium")
        self.assertTrue(out["ok"])
        self.assertEqual(self.rows(), [{"action": "not_a_match", "reason": "Different unit", "note": "this one is aluminium",
                                        "user": "Administrator", "commit_version": 3, "match_run": RUN, "match_excel_row": 9}])
        f = self.flags()
        self.assertEqual((f[(5, 9)]["action"], f[(5, 9)]["reason"]), ("not_a_match", "Different unit"))
        self.assertIsNone(f[(5, 10)])

    def test_reason_and_note_are_optional(self):
        self.mark()
        r = self.rows()[0]
        self.assertFalse(r["reason"])            # an empty Select is stored as "" by Frappe
        self.assertIsNone(r["note"])

    def test_undo_appends_and_clears_the_flag(self):
        self.mark(reason="Other")
        self.undo()
        self.assertEqual([r["action"] for r in self.rows()], ["not_a_match", "undo"])
        self.assertIsNone(self.flags()[(5, 9)])

    def test_latest_wins_and_nothing_is_deleted(self):
        self.mark()
        self.undo()
        self.mark(reason="Different item")
        self.assertEqual([r["action"] for r in self.rows()], ["not_a_match", "undo", "not_a_match"])
        self.assertEqual(self.flags()[(5, 9)]["reason"], "Different item")

    def test_refusals_write_nothing(self):
        with self.assertRaises(frappe.ValidationError):
            self.undo()                                                    # nothing marked
        with self.assertRaises(frappe.ValidationError):
            self.mark(er=99)                                               # an unknown match
        with self.assertRaises(frappe.ValidationError):
            self.mark(reason="Too expensive")                              # not a reason the store allows
        with self.assertRaises(frappe.ValidationError):
            RM.mark_not_a_match(BOQ, "Another sheet", 5, RUN, MBOQ, MSHEET, 9)   # the run is another sheet's
        with self.assertRaises(frappe.ValidationError):
            RM.mark_not_a_match(BOQ, SHEET, 6, RUN, MBOQ, MSHEET, 9)       # shown for row 5, not row 6
        self.assertEqual(self.rows(), [])
        self.mark()
        with self.assertRaises(frappe.ValidationError):
            self.mark()                                                    # already marked
        self.assertEqual(len(self.rows()), 1)

    def test_append_only(self):
        self.mark()
        name = frappe.get_all(RM.FEEDBACK_DOCTYPE, filters={"boq": BOQ}, pluck="name")[0]
        doc = frappe.get_doc(RM.FEEDBACK_DOCTYPE, name)
        doc.note = "changed"
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)
        with self.assertRaises(frappe.ValidationError):
            frappe.delete_doc(RM.FEEDBACK_DOCTYPE, name, ignore_permissions=True, force=True)
        self.assertEqual(len(self.rows()), 1)

    def test_guest_is_refused(self):
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                self.mark()
        finally:
            frappe.set_user("Administrator")


class TestCanPrice(FrappeTestCase):
    """_guard_can_price, on its own: the sheet's current version, the deliberate lock, the single-editor lock (read)."""

    def guard(self, cur=3, locked=0, info=None):
        frappe.utils.now_datetime()          # warm the system settings before frappe.db.get_value is patched
        with patch.object(frappe.db, "get_value", return_value=cur), \
                patch("nirmaan_stack.api.boq.wizard.pricing._get_sheet_is_locked", return_value=locked), \
                patch("nirmaan_stack.api.boq.wizard.pricing_lock.read_lock_info", return_value=info) as rli, \
                patch("nirmaan_stack.api.boq.wizard.pricing_lock.acquire_or_refresh") as acq:
            RM._guard_can_price(BOQ, SHEET, 3)
            acq.assert_not_called()                     # the lock is only READ, never taken
            return rli

    def test_free_mine_or_stale_is_allowed(self):
        self.guard()
        self.guard(info={"is_locked_by_me": True, "is_stale": False})
        self.guard(info={"is_locked_by_me": False, "is_stale": True})

    def test_refused_when_the_sheet_cannot_be_priced(self):
        with self.assertRaises(frappe.ValidationError):
            self.guard(cur=4)                                               # committed again
        with self.assertRaises(frappe.ValidationError):
            self.guard(cur=None)                                            # no current version
        with self.assertRaises(frappe.PermissionError):
            self.guard(locked=1)                                            # deliberately locked
        with self.assertRaises(frappe.PermissionError):
            self.guard(info={"is_locked_by_me": False, "is_stale": False})  # held fresh by someone else


class TestDetail(_Base):
    def test_detail_of_a_shown_match(self):
        item = {"id": 9, "description": "4C x 16 sq.mm", "ancestor_chain": [{"relation": "sheet", "description": MSHEET}]}
        with patch("nirmaan_stack.services.boq_rate_match.cards.sheet_items", return_value=(2, [(9, item)], [])) as si:
            d = RM.get_match_detail(BOQ, SHEET, 5, RUN, MBOQ, MSHEET, 9)
        si.assert_called_once_with(MBOQ, MSHEET, excel_rows=[9])
        from nirmaan_stack.services.boq_rate_match import cards as C
        self.assertEqual((d["boq_name"], d["sheet_name"], d["excel_row"], d["committed_version"]), ("Old tender", MSHEET, 9, 2))
        self.assertEqual((d["payload"], d["payload_sha256"]), (item, C.payload_sha256(item)))
        self.assertTrue(d["can_open"])                                      # Administrator may read the BoQ
        with patch.object(frappe, "has_permission", return_value=False), \
                patch("nirmaan_stack.services.boq_rate_match.cards.sheet_items", return_value=(2, [(9, item)], [])):
            self.assertFalse(RM.get_match_detail(BOQ, SHEET, 5, RUN, MBOQ, MSHEET, 9)["can_open"])

    def test_detail_of_an_unknown_match_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            RM.get_match_detail(BOQ, SHEET, 5, RUN, MBOQ, MSHEET, 77)
