"""CU-B AC2 (c): services/boq_fixture_teardown -- the fixture name and the children-aware teardown."""
import re
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_fixture_teardown import fixture_boq_name, purge_boq, purge_docs
from nirmaan_stack.services import boq_fixture_teardown as teardown

SERIES = re.compile(r"^BOQ-\d{2}-\d{5}$")


def _make(tag):
    wh = frappe.db.get_value("Work Headers", {"work_header_name": ["is", "set"]}, "name", order_by="name asc")
    boq = frappe.get_doc({"doctype": "BOQs", "is_template_source": 1, "boq_name": tag,
                          "sheet_drafts": [{"sheet_name": "A", "sheet_order": 1, "wizard_status": "Pending"}]})
    boq.insert(ignore_permissions=True, set_name=fixture_boq_name(tag))
    draft = boq.sheet_drafts[0].name
    frappe.get_doc({"doctype": "BoQ Sheet Work Package", "parent": draft, "parenttype": "BoQ Sheet Draft",
                    "parentfield": "work_packages", "work_header": wh}).db_insert()
    sheet = frappe.get_doc({"doctype": "BoQ Sheet", "boq": boq.name, "sheet_name": "A", "sheet_order": 1,
                            "commit_version": 1, "is_current": 1, "work_packages": [{"work_header": wh}]})
    sheet.insert(ignore_permissions=True, ignore_links=True)
    grid = frappe.get_doc({"doctype": "BoQ Committed Sheet Grid", "boq": boq.name, "source_sheet_name": "A",
                           "commit_version": 1, "is_current": 1, "rows": [{"row_number": 1}, {"row_number": 2}]})
    grid.insert(ignore_permissions=True, ignore_links=True)
    frappe.get_doc({"doctype": "BoQ Review Row", "boq": boq.name, "sheet_name": "A"}).insert(
        ignore_permissions=True, ignore_links=True)
    frappe.db.commit()
    return {"boq": boq.name, "draft": draft, "sheet": sheet.name, "grid": grid.name}


def _count(ids):
    return {
        "boq": frappe.db.count("BOQs", {"name": ids["boq"]}),
        "draft": frappe.db.count("BoQ Sheet Draft", {"parent": ids["boq"]}),
        "draft_wp": frappe.db.count("BoQ Sheet Work Package", {"parent": ids["draft"]}),
        "sheet": frappe.db.count("BoQ Sheet", {"boq": ids["boq"]}),
        "sheet_wp": frappe.db.count("BoQ Sheet Work Package", {"parent": ids["sheet"]}),
        "grid": frappe.db.count("BoQ Committed Sheet Grid", {"boq": ids["boq"]}),
        "grid_rows": frappe.db.count("BoQ Committed Sheet Grid Row", {"parent": ids["grid"]}),
        "review": frappe.db.count("BoQ Review Row", {"boq": ids["boq"]}),
    }


class TestFixtureTeardown(FrappeTestCase):

    def setUp(self):
        frappe.db.rollback()
        self.made = []
        self.addCleanup(self._safety)

    def _safety(self):
        frappe.db.rollback()
        for ids in self.made:
            purge_boq(ids["boq"])
        frappe.db.commit()

    def _fixture(self, tag):
        ids = _make(tag)
        self.made.append(ids)
        return ids

    def test_a_fixture_name_is_never_a_series_name(self):
        name = fixture_boq_name("truth_snapshot")
        self.assertTrue(name.startswith("BOQ-TEST-TRUTH-SNAPSHOT-"))
        self.assertIsNone(SERIES.match(name))
        self.assertNotEqual(name, fixture_boq_name("truth_snapshot"))

    def test_purge_boq_leaves_nothing_and_spares_a_bystander(self):
        ids = self._fixture("PURGE")
        other = self._fixture("BYSTANDER")
        before_other = _count(other)
        self.assertEqual(_count(ids), {"boq": 1, "draft": 1, "draft_wp": 1, "sheet": 1, "sheet_wp": 1, "grid": 1,
                                       "grid_rows": 2, "review": 1})
        purge_boq(ids["boq"])
        frappe.db.commit()
        self.assertEqual(set(_count(ids).values()), {0})
        self.assertEqual(_count(other), before_other)

    def test_purge_boq_removes_the_boqs_attached_files(self):
        ids = self._fixture("FILES")
        f = frappe.get_doc({"doctype": "File", "file_name": "cub_purge_probe.txt", "content": b"x", "is_private": 1,
                            "attached_to_doctype": "BOQs", "attached_to_name": ids["boq"]})
        with patch("frappe_gcp_attachment.controller.file_upload_to_gcs"), \
                patch("frappe_gcp_attachment.controller.delete_from_cloud"):
            f.insert(ignore_permissions=True)
            frappe.db.commit()
            purge_boq(ids["boq"])
            frappe.db.commit()
        self.assertFalse(frappe.db.exists("File", f.name))

    def test_purge_boq_refuses_a_boq_from_before_the_run(self):
        # Negative, on a FIXTURE: its creation is moved before the cutoff -- purge_boq must refuse and delete nothing.
        ids = self._fixture("OLD")
        frappe.db.sql('update "tabBOQs" set creation = %s where name = %s', ("2026-10-01 00:00:00", ids["boq"]))
        frappe.db.commit()
        before = _count(ids)
        with self.assertRaises(teardown.PurgeRefused):
            purge_boq(ids["boq"])
        frappe.db.rollback()
        self.assertEqual(_count(ids), before, "nothing deleted")
        frappe.db.sql('update "tabBOQs" set creation = %s where name = %s', (frappe.utils.now(), ids["boq"]))
        frappe.db.commit()

    def test_purge_boq_refuses_a_boq_created_before_the_process_started(self):
        ids = self._fixture("EARLY")
        with patch.object(teardown, "PROCESS_START", frappe.utils.add_to_date(frappe.utils.now_datetime(), minutes=5)):
            with self.assertRaises(teardown.PurgeRefused):
                purge_boq(ids["boq"])
        frappe.db.rollback()
        self.assertEqual(_count(ids)["boq"], 1)

    def test_a_recycled_name_never_takes_an_older_rows(self):
        # An orphan lock older than the run, on a name a fixture then reuses: the purge leaves the old lock alone.
        ids = self._fixture("RECYCLE")
        lock = frappe.get_doc({"doctype": "BoQ Sheet Pricing Lock", "boq": ids["boq"], "sheet_name": "A",
                               "committed_version": 1, "locked_by": "Administrator", "last_edit_at": frappe.utils.now()})
        lock.db_insert()
        frappe.db.sql('update "tabBoQ Sheet Pricing Lock" set creation = %s where name = %s', ("2026-10-10 00:00:00", lock.name))
        frappe.db.commit()
        self.addCleanup(lambda: (frappe.db.sql('delete from "tabBoQ Sheet Pricing Lock" where name = %s', (lock.name,)), frappe.db.commit()))
        with patch.object(teardown, "PROCESS_START", frappe.utils.get_datetime("2026-10-11 00:00:00")):
            purge_boq(ids["boq"])
        frappe.db.commit()
        self.assertTrue(frappe.db.exists("BoQ Sheet Pricing Lock", lock.name), "the older row is not this run's")
        self.assertEqual(_count(ids)["boq"], 0)

    def test_purge_docs_takes_the_children_a_raw_delete_leaves(self):
        ids = self._fixture("DOCS")
        purge_docs("BoQ Sheet", {"boq": ids["boq"]})
        purge_docs("BoQ Committed Sheet Grid", {"boq": ids["boq"]})
        frappe.db.commit()
        counts = _count(ids)
        self.assertEqual((counts["sheet"], counts["sheet_wp"], counts["grid"], counts["grid_rows"]), (0, 0, 0, 0))
        self.assertEqual(counts["boq"], 1, "only what was named goes")
