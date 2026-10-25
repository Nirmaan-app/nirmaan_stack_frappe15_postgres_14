"""CU-A AC2: the BoQ delete cascade (integrations/controllers/boqs.after_delete).

Owner ruling 2026-10-18, "children only": a delete always removes the drafts' work-package
grandchildren; a FORCED delete also removes each linked BoQ Sheet's work packages and each linked
grid's rows; the Sheet / Grid / Review Row documents themselves are never deleted; an unforced delete
of a linked BoQ is still refused, with nothing removed.

Fixtures are project-less template-source BoQs (no Projects row needed). Every record is removed in
cleanup, which rolls back first and cleans each scope on its own (CODING_STANDARDS § Writing tests).
"""
import frappe
from frappe.tests.utils import FrappeTestCase

TAG = "TEST_CUA_CASCADE"


def _work_header():
    return frappe.db.get_value("Work Headers", {"work_header_name": ["is", "set"]}, "name", order_by="name asc")


def _make_boq(suffix, with_links):
    """A BoQ with 2 drafts x 2 work packages; with_links adds a BoQ Sheet (2 WPs), a committed grid
    (3 rows) and a Review Row, all pointing at it."""
    wh = _work_header()
    # set_name, not the BOQ-.YY.- series: Frappe rolls a deleted BoQ's number back, so a series name can
    # be one another test deleted while leaving rows linked to it (a full run hit an orphan lock that way).
    tag = f"{TAG}_{suffix}_{frappe.generate_hash(length=6)}"
    boq = frappe.get_doc({
        "doctype": "BOQs",
        "is_template_source": 1,
        "boq_name": tag,
        "sheet_drafts": [
            {"sheet_name": "A", "sheet_order": 1, "wizard_status": "Pending"},
            {"sheet_name": "B", "sheet_order": 2, "wizard_status": "Pending"},
        ],
    }).insert(ignore_permissions=True, set_name=tag)
    for draft in boq.sheet_drafts:
        for i in range(2):
            frappe.get_doc({
                "doctype": "BoQ Sheet Work Package", "parent": draft.name, "parenttype": "BoQ Sheet Draft",
                "parentfield": "work_packages", "idx": i + 1, "work_header": wh,
            }).db_insert()
    ids = {"boq": boq.name, "drafts": [d.name for d in boq.sheet_drafts], "sheet": None, "grid": None, "review": None}
    if with_links:
        sheet = frappe.get_doc({"doctype": "BoQ Sheet", "boq": boq.name, "sheet_name": "A", "sheet_order": 1,
                                "commit_version": 1, "is_current": 1,
                                "work_packages": [{"work_header": wh}, {"work_header": wh}]})
        sheet.insert(ignore_permissions=True, ignore_links=True)
        grid = frappe.get_doc({"doctype": "BoQ Committed Sheet Grid", "boq": boq.name, "source_sheet_name": "A",
                               "commit_version": 1, "is_current": 1,
                               "rows": [{"row_number": n} for n in (1, 2, 3)]})
        grid.insert(ignore_permissions=True, ignore_links=True)
        review = frappe.get_doc({"doctype": "BoQ Review Row", "boq": boq.name, "sheet_name": "A"})
        review.insert(ignore_permissions=True, ignore_links=True)
        ids.update(sheet=sheet.name, grid=grid.name, review=review.name)
    frappe.db.commit()
    return ids


def _counts(ids):
    """Rows of each table that belong to this fixture BoQ."""
    out = {
        "drafts": frappe.db.count("BoQ Sheet Draft", {"parent": ids["boq"], "parenttype": "BOQs"}),
        "draft_wps": frappe.db.count("BoQ Sheet Work Package",
                                     {"parent": ["in", ids["drafts"]], "parenttype": "BoQ Sheet Draft"}),
        "boq": frappe.db.count("BOQs", {"name": ids["boq"]}),
    }
    if ids["sheet"]:
        out.update(
            sheet=frappe.db.count("BoQ Sheet", {"name": ids["sheet"]}),
            sheet_wps=frappe.db.count("BoQ Sheet Work Package", {"parent": ids["sheet"], "parenttype": "BoQ Sheet"}),
            grid=frappe.db.count("BoQ Committed Sheet Grid", {"name": ids["grid"]}),
            grid_rows=frappe.db.count("BoQ Committed Sheet Grid Row", {"parent": ids["grid"]}),
            review=frappe.db.count("BoQ Review Row", {"name": ids["review"]}),
        )
    return out


def _purge(ids):
    frappe.db.rollback()
    scopes = [
        ("BoQ Sheet Work Package", {"parent": ["in", ids["drafts"] + [ids["sheet"] or "-"]]}),
        ("BoQ Committed Sheet Grid Row", {"parent": ids["grid"] or "-"}),
        ("BoQ Committed Sheet Grid", {"boq": ids["boq"]}),
        ("BoQ Sheet", {"boq": ids["boq"]}),
        ("BoQ Review Row", {"boq": ids["boq"]}),
        ("BoQ Sheet Draft", {"parent": ids["boq"]}),
        ("BOQs", {"name": ids["boq"]}),
        # what the delete itself writes: generate_versions (on_trash) and Frappe's Deleted Document
        ("Nirmaan Versions", {"ref_doctype": "BOQs", "docname": ids["boq"]}),
        ("Deleted Document", {"deleted_doctype": "BOQs", "deleted_name": ids["boq"]}),
    ]
    failed = []
    for doctype, filters in scopes:
        try:
            frappe.db.delete(doctype, filters)
            frappe.db.commit()
        except Exception as e:  # report, never swallow: a stranded row is permanent dev data
            frappe.db.rollback()
            failed.append(f"{doctype}: {e}")
    if failed:
        raise AssertionError("cleanup failed: " + "; ".join(failed))


class TestBoqDeleteCascade(FrappeTestCase):

    def _fixture(self, suffix, with_links):
        ids = _make_boq(suffix, with_links)
        self.addCleanup(_purge, ids)
        return ids

    def test_a_delete_removes_the_drafts_work_packages(self):
        ids = self._fixture("plain", with_links=False)
        self.assertEqual(_counts(ids), {"drafts": 2, "draft_wps": 4, "boq": 1})
        frappe.delete_doc("BOQs", ids["boq"], ignore_permissions=True)
        self.assertEqual(_counts(ids), {"drafts": 0, "draft_wps": 0, "boq": 0})

    def test_a_forced_delete_also_removes_sheet_work_packages_and_grid_rows_but_not_the_documents(self):
        ids = self._fixture("forced", with_links=True)
        before = _counts(ids)
        self.assertEqual(before, {"drafts": 2, "draft_wps": 4, "boq": 1, "sheet": 1, "sheet_wps": 2,
                                  "grid": 1, "grid_rows": 3, "review": 1})
        frappe.delete_doc("BOQs", ids["boq"], force=True, ignore_permissions=True)
        self.assertEqual(_counts(ids), {"drafts": 0, "draft_wps": 0, "boq": 0, "sheet": 1, "sheet_wps": 0,
                                        "grid": 1, "grid_rows": 0, "review": 1})

    def test_an_unforced_delete_of_a_linked_boq_is_refused_and_removes_nothing(self):
        ids = self._fixture("refused", with_links=True)
        before = _counts(ids)
        with self.assertRaises(frappe.LinkExistsError):
            frappe.delete_doc("BOQs", ids["boq"], ignore_permissions=True)
        # No rollback here on purpose: the refusal itself must have removed nothing, even in a caller
        # that catches the error and carries on in the same transaction.
        self.assertEqual(_counts(ids), before)

    def test_another_boqs_rows_are_untouched(self):
        victim = self._fixture("victim", with_links=True)
        bystander = self._fixture("bystander", with_links=True)
        before = _counts(bystander)
        frappe.delete_doc("BOQs", victim["boq"], force=True, ignore_permissions=True)
        self.assertEqual(_counts(bystander), before)
        self.assertEqual(_counts(victim)["grid_rows"], 0)

    def test_the_hook_is_wired_after_delete_and_versions_stay_on_trash(self):
        events = frappe.get_hooks("doc_events")["BOQs"]
        self.assertIn("nirmaan_stack.integrations.controllers.boqs.after_delete", events["after_delete"])
        self.assertIn("nirmaan_stack.integrations.controllers.delete_doc_versions.generate_versions",
                      events["on_trash"])
        self.assertNotIn("nirmaan_stack.integrations.controllers.boqs.after_delete", events["on_trash"])
