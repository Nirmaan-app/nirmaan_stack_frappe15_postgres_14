"""CU-A AC3: services/orphans.py report() and delete(confirm_counts=...).

Runs ONLY on its own fixtures: every call passes `scope=SCOPE`, a LIKE pattern on the missing owner's
name, so the real dev orphans (CU-B's to delete) are never counted or touched here. Fixture rows are
written with db_insert (raw), the way the orphans arise; every one is removed in cleanup.
"""
import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services import orphans

PREFIX = "TEST_CUA_ORPH_"
SCOPE = PREFIX + "%"


class TestBoqOrphans(FrappeTestCase):

    def setUp(self):
        frappe.db.rollback()
        h = frappe.generate_hash(length=8)
        self.gone = f"{PREFIX}GONE_{h}"   # a BOQs name that does not exist
        self.live = f"{PREFIX}LIVE_{h}"   # a BOQs record that does
        self.rows = []                    # (doctype, name) of every fixture row, for cleanup
        self.addCleanup(self._purge)
        wh = frappe.db.get_value("Work Headers", {"work_header_name": ["is", "set"]}, "name", order_by="name asc")
        # the live BoQ, its draft and the draft's work package: owned, never orphans
        frappe.get_doc({"doctype": "BOQs", "is_template_source": 1, "boq_name": self.live}).insert(
            ignore_permissions=True, set_name=self.live)
        self.rows.append(("BOQs", self.live))
        self.live_draft = self._row("BoQ Sheet Draft", parent=self.live, parenttype="BOQs",
                                    parentfield="sheet_drafts", sheet_name="A", sheet_order=1, wizard_status="Pending")
        self.live_wp = self._row("BoQ Sheet Work Package", parent=self.live_draft, parenttype="BoQ Sheet Draft",
                                 parentfield="work_packages", work_header=wh)
        # the orphans: a draft whose BoQ is gone, the work package under it, a lock whose boq is gone
        self.orphan_draft = self._row("BoQ Sheet Draft", parent=self.gone, parenttype="BOQs",
                                      parentfield="sheet_drafts", sheet_name="A", sheet_order=1, wizard_status="Pending")
        self.orphan_wp = self._row("BoQ Sheet Work Package", parent=self.orphan_draft, parenttype="BoQ Sheet Draft",
                                   parentfield="work_packages", work_header=wh)
        self.orphan_lock = self._row("BoQ Sheet Pricing Lock", name=f"{PREFIX}LOCK_{h}", boq=self.gone,
                                     sheet_name="A", committed_version=1, locked_by="Administrator",
                                     last_edit_at=frappe.utils.now())
        frappe.db.commit()

    def _row(self, doctype, **fields):
        doc = frappe.get_doc({"doctype": doctype, **fields})
        if not doc.name:
            doc.name = frappe.generate_hash(length=10)
        doc.db_insert()
        self.rows.append((doctype, doc.name))
        return doc.name

    def _purge(self):
        frappe.db.rollback()
        failed = []
        for doctype, name in reversed(self.rows):
            try:
                frappe.db.delete(doctype, {"name": name})
                frappe.db.commit()
            except Exception as e:
                frappe.db.rollback()
                failed.append(f"{doctype} {name}: {e}")
        if failed:
            raise AssertionError("cleanup failed: " + "; ".join(failed))

    def _exists(self, doctype, name):
        return bool(frappe.db.exists(doctype, name))

    EXPECTED = {
        "child:BoQ Sheet Draft<BOQs": 1,
        "link:BoQ Sheet Pricing Lock.boq": 1,
        "below:BoQ Sheet Work Package<BoQ Sheet Draft": 1,
    }

    def test_report_counts_the_orphans_and_not_the_live_rows(self):
        rep = orphans.report(scope=SCOPE)
        self.assertEqual(rep["delete"], self.EXPECTED)
        self.assertEqual(rep["delete_total"], 3)
        sets, _counts, _info = orphans._scan(scope=SCOPE)
        named = {n for _dt, names in sets.values() for n in names}
        self.assertEqual(named, {self.orphan_draft, self.orphan_wp, self.orphan_lock})
        self.assertNotIn(self.live_draft, named)
        self.assertNotIn(self.live_wp, named)

    def test_report_writes_nothing(self):
        orphans.report(scope=SCOPE)
        frappe.db.rollback()
        for doctype, name in self.rows:
            self.assertTrue(self._exists(doctype, name), (doctype, name))

    def test_delete_with_the_approved_counts_removes_only_the_orphans(self):
        approved = orphans.report(scope=SCOPE)["delete"]
        out = orphans.delete(confirm_counts=approved, scope=SCOPE)
        self.assertTrue(out["deleted"])
        self.assertEqual(out["total"], 3)
        self.assertFalse(self._exists("BoQ Sheet Draft", self.orphan_draft))
        self.assertFalse(self._exists("BoQ Sheet Work Package", self.orphan_wp))
        self.assertFalse(self._exists("BoQ Sheet Pricing Lock", self.orphan_lock))
        self.assertTrue(self._exists("BOQs", self.live))
        self.assertTrue(self._exists("BoQ Sheet Draft", self.live_draft))
        self.assertTrue(self._exists("BoQ Sheet Work Package", self.live_wp))
        self.assertEqual(orphans.report(scope=SCOPE)["delete"], {}, "nothing left behind, no new orphans")

    def test_delete_with_stale_counts_refuses_and_removes_nothing(self):
        stale = dict(self.EXPECTED, **{"link:BoQ Sheet Pricing Lock.boq": 2})
        out = orphans.delete(confirm_counts=stale, scope=SCOPE)
        self.assertFalse(out["deleted"])
        self.assertEqual(out["found"], self.EXPECTED)
        for doctype, name in self.rows:
            self.assertTrue(self._exists(doctype, name), (doctype, name))

    def test_an_orphan_that_appeared_after_the_approval_refuses_the_delete(self):
        approved = orphans.report(scope=SCOPE)["delete"]
        self._row("BoQ Sheet Draft", parent=self.gone, parenttype="BOQs", parentfield="sheet_drafts",
                  sheet_name="B", sheet_order=2, wizard_status="Pending")
        frappe.db.commit()
        out = orphans.delete(confirm_counts=approved, scope=SCOPE)
        self.assertFalse(out["deleted"])
        self.assertTrue(self._exists("BoQ Sheet Draft", self.orphan_draft))

    def test_an_empty_approval_deletes_nothing(self):
        out = orphans.delete(confirm_counts={}, scope=SCOPE)
        self.assertFalse(out["deleted"])
        self.assertTrue(self._exists("BoQ Sheet Pricing Lock", self.orphan_lock))
