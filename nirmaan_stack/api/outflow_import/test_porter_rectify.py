# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rectify (and Unreconcile) a created Porter expense (#1449, spec #1442, ADR-0032).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_porter_rectify

Each test creates the synthetic import end to end (`test_porter_create`: upload, validation job, Create
job), then Rectifies or Unreconciles its lines through the real endpoints and asserts on what is left:
Expenses, matches, lines, Porter Orders, Files and the CEO-Hold reasons of both projects.

Lines of the fixture used here: 002 Arjun Pillai on Quillon Park (₹133), 004 Kavya Menon on Zephyr Tower
(₹1616), 003 Ravi Testkumar with no project (₹382, Non-Project), 011 a cancelled order (Skipped).
"""

import json
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import porter_rectify, porter_upload
from nirmaan_stack.api.outflow_import.test_porter_create import (
    MATCH_DOCTYPE,
    NON_PROJECT_EXPENSE,
    ORDER_DOCTYPE,
    PROJECT_EXPENSE,
    PorterCreateCase,
)
from nirmaan_stack.api.outflow_import.test_porter_import import INVOICE_DOCTYPE
from nirmaan_stack.api.outflow_import.test_porter_validation import _no_bucket_upload
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD, _Users
from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import _compute_cashflow_gap
from nirmaan_stack.services.ceo_hold import core as ceo_hold
from nirmaan_stack.services.outflow_import.porter import MATCH_BASIS

REASON = "Belongs to the other site"

#: Every field Rectify must carry over unchanged (spec #1442 story 62).
_KEPT = (
    "amount", "status", "payment_date", "payment_ref", "invoice_ref", "invoice_date",
    "invoice_attachment", "porter_order", "type", "comment",
)


class PorterRectifyCase(PorterCreateCase):
    def setUp(self):
        super().setUp()
        self._validate()
        self._press_create()
        self._run_create()
        self.users = _Users()
        self.addCleanup(self.users.purge)
        # Runs before the create purge (cleanups are last-in, first-out), while the matches still name
        # what Rectify and Unreconcile left history on.
        self.addCleanup(_purge_history, self.batch)

    def _rectify(self, suffixes, project, reason=REASON):
        names = [self._lines()[s].name for s in suffixes]
        return porter_rectify.rectify_porter_rows(json.dumps(names), project or "", reason)

    def _live_expenses_of_order(self, crn: str):
        """What the earlier-imports signal (#1448) reads: the live Expense(s) linked to a Porter Order."""
        return [
            frappe.get_doc(doctype, name)
            for doctype in (PROJECT_EXPENSE, NON_PROJECT_EXPENSE)
            for name in frappe.get_all(doctype, filters={"porter_order": crn}, pluck="name")
        ]

    def _legs(self, suffix: str):
        return frappe.get_all(
            MATCH_DOCTYPE,
            filters={"import_row": self._lines()[suffix].name},
            fields=["*"],
            order_by="creation asc",
        )


class TestNonProjectToAProject(PorterRectifyCase):
    def test_the_expense_is_replaced_on_the_project_identical_but_for_ledger_project_and_description(self):
        old = self._expense_of("003")
        files_before = frappe.db.count("File")

        result = self._rectify(["003"], self.zephyr)

        [line] = result["lines"]
        self.assertTrue(line["rectified"], line)
        new = self._expense_of("003")
        self.assertEqual((new.doctype, new.projects), (PROJECT_EXPENSE, self.zephyr))
        self.assertNotEqual(new.name, old.name)
        self.assertFalse(frappe.db.exists(NON_PROJECT_EXPENSE, old.name))
        for field in _KEPT:
            self.assertEqual(str(new.get(field)), str(old.get(field)), field)
        self.assertEqual(float(new.amount), 382.0)
        self.assertEqual(new.description, "Porter Delivery raised by Ravi Testkumar for Zephyr Tower")
        # Project side only: who booked the order, as Create writes it.
        self.assertEqual(new.payment_by, "Ravi Testkumar")
        # The shared invoice PDF is copied as a URL: no File row is added.
        self.assertEqual(frappe.db.count("File"), files_before)

    def test_the_old_match_is_reversed_with_the_reason_and_a_new_settled_one_exists(self):
        old = self._expense_of("003")
        self._rectify(["003"], self.zephyr)
        new = self._expense_of("003")

        reversed_leg, settled_leg = self._legs("003")
        self.assertEqual(reversed_leg.match_kind, "Reversed")
        self.assertEqual((reversed_leg.target_doctype, reversed_leg.target_name), (NON_PROJECT_EXPENSE, old.name))
        self.assertEqual(reversed_leg.reversal_reason, REASON)
        self.assertEqual(reversed_leg.reversed_by, "Administrator")
        self.assertEqual(settled_leg.match_kind, "Settled")
        self.assertEqual((settled_leg.target_doctype, settled_leg.target_name), (PROJECT_EXPENSE, new.name))
        self.assertEqual(settled_leg.match_basis, MATCH_BASIS)
        self.assertEqual(settled_leg.created_by_import, 1)
        self.assertEqual(settled_leg.target_project, self.zephyr)
        self.assertEqual(float(settled_leg.target_amount), 382.0)

        line = self._lines()["003"]
        self.assertEqual(line.row_status, "Settled")
        self.assertEqual(
            (line.suggested_doctype, line.resolved_project, line.suggested_name),
            (PROJECT_EXPENSE, self.zephyr, new.name),
        )

    def test_the_rectified_placement_is_what_the_porter_order_now_leads_to(self):
        crn = self._crn("003")
        self._rectify(["003"], self.zephyr)
        [live] = self._live_expenses_of_order(crn)
        self.assertEqual((live.doctype, live.projects), (PROJECT_EXPENSE, self.zephyr))
        self.assertTrue(frappe.db.exists(ORDER_DOCTYPE, crn))

    def test_the_next_uploads_earlier_imports_signal_reads_the_rectified_project(self):
        """Through the real reader (#1448's `porter_upload.placement_master`): what it hands the signal for this order's
        remark and city moves from Non-Project to the rectified project. Counted, so earlier imports on the
        same site cannot blur it."""
        order = frappe.get_doc(ORDER_DOCTYPE, self._crn("005"))  # "misc delivery", Non-Project

        def _earlier():
            seen = []
            real = porter_upload.build_placement_master

            def _capture(*args, **kwargs):
                seen.extend(kwargs["earlier"])
                return real(*args, **kwargs)

            with patch.object(porter_upload, "build_placement_master", side_effect=_capture):
                porter_upload.placement_master()
            return [(e.remark, e.city, e.project) for e in seen].count

        before = _earlier()
        self._rectify(["005"], self.zephyr)
        after = _earlier()
        self.assertEqual(after((order.remark, order.city, self.zephyr)), before((order.remark, order.city, self.zephyr)) + 1)
        self.assertEqual(after((order.remark, order.city, None)), before((order.remark, order.city, None)) - 1)


class TestAProjectToAnotherProject(PorterRectifyCase):
    def test_it_moves_with_its_description_rewritten_and_its_paid_by_kept(self):
        old = self._expense_of("002")
        result = self._rectify(["002"], self.zephyr)
        [line] = result["lines"]
        self.assertTrue(line["rectified"], line)
        self.assertEqual(line["from"]["project"], self.quillon)
        self.assertEqual(line["to"]["project"], self.zephyr)
        self.assertFalse(line["description_kept"])

        new = self._expense_of("002")
        self.assertEqual((new.doctype, new.projects), (PROJECT_EXPENSE, self.zephyr))
        self.assertFalse(frappe.db.exists(PROJECT_EXPENSE, old.name))
        for field in _KEPT + ("payment_by", "vendor"):
            self.assertEqual(str(new.get(field)), str(old.get(field)), field)
        self.assertEqual(new.description, "Porter Delivery raised by Arjun Pillai for Zephyr Tower")
        reversed_leg, settled_leg = self._legs("002")
        self.assertEqual(reversed_leg.target_project, self.quillon)
        self.assertEqual(settled_leg.target_project, self.zephyr)


class TestAProjectToNonProject(PorterRectifyCase):
    def test_it_becomes_a_non_project_expense_without_the_project_in_its_description(self):
        old = self._expense_of("002")
        [line] = self._rectify(["002"], None)["lines"]
        self.assertTrue(line["rectified"], line)

        new = self._expense_of("002")
        self.assertEqual(new.doctype, NON_PROJECT_EXPENSE)
        self.assertFalse(frappe.db.exists(PROJECT_EXPENSE, old.name))
        for field in _KEPT:
            self.assertEqual(str(new.get(field)), str(old.get(field)), field)
        self.assertEqual(new.description, "Porter Delivery raised by Arjun Pillai")
        row = self._lines()["002"]
        self.assertEqual((row.suggested_doctype, row.resolved_project), (NON_PROJECT_EXPENSE, None))
        [live] = self._live_expenses_of_order(self._crn("002"))
        self.assertEqual(live.name, new.name)


class TestTheDescriptionRule(PorterRectifyCase):
    def test_a_hand_edited_description_is_kept(self):
        expense = self._expense_of("002")
        expense.description = "Shuttering plates to Quillon, urgent"
        expense.save(ignore_permissions=True)
        frappe.db.commit()
        plan = porter_rectify.get_porter_rectify_plan(json.dumps([self._lines()["002"].name]))
        self.assertTrue(plan["lines"][0]["description_edited"])

        [line] = self._rectify(["002"], self.zephyr)["lines"]
        self.assertTrue(line["rectified"], line)
        self.assertTrue(line["description_kept"])
        self.assertEqual(self._expense_of("002").description, "Shuttering plates to Quillon, urgent")


class TestWhatIsRefused(PorterRectifyCase):
    def test_a_reason_is_required_and_nothing_moves_without_one(self):
        old = self._expense_of("003")
        for reason in ("", "   "):
            with self.subTest(reason=reason), self.assertRaises(frappe.ValidationError):
                self._rectify(["003"], self.zephyr, reason=reason)
        self.assertEqual(self._expense_of("003").name, old.name)

    def test_only_a_won_project_can_be_chosen(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            self._rectify(["003"], self.zephyr_tender)
        self.assertIn("Won", str(caught.exception))

    def test_moving_an_order_to_where_it_already_is_is_refused_on_that_line(self):
        [project_line] = self._rectify(["002"], self.quillon)["lines"]
        self.assertFalse(project_line["rectified"])
        self.assertIn("already on Quillon Park", project_line["reason"])
        [non_project_line] = self._rectify(["003"], None)["lines"]
        self.assertFalse(non_project_line["rectified"])
        self.assertIn("already a Non-Project", non_project_line["reason"])
        self.assertEqual(len(self._legs("002")), 1)

    def test_a_cancelled_order_has_no_expense_to_move(self):
        [line] = self._rectify(["011"], self.zephyr)["lines"]
        self.assertFalse(line["rectified"])
        self.assertIn("not Settled", line["reason"])

    def test_a_plain_accountant_can_neither_plan_nor_rectify(self):
        name = self._lines()["003"].name
        frappe.set_user(self.users.make(ACCOUNTANT))
        try:
            with self.assertRaises(frappe.PermissionError):
                porter_rectify.get_porter_rectify_plan(json.dumps([name]))
            with self.assertRaises(frappe.PermissionError):
                porter_rectify.rectify_porter_rows(json.dumps([name]), self.zephyr, REASON)
        finally:
            frappe.set_user("Administrator")
        self.assertEqual(self._expense_of("003").doctype, NON_PROJECT_EXPENSE)

    def test_an_accountant_lead_can(self):
        frappe.set_user(self.users.make(ACCOUNTANT_LEAD))
        try:
            [line] = self._rectify(["003"], self.zephyr)["lines"]
        finally:
            frappe.set_user("Administrator")
        self.assertTrue(line["rectified"], line)


class TestItIsAllOrNothing(PorterRectifyCase):
    def test_a_failure_after_the_delete_leaves_the_original_expense_and_match_untouched(self):
        old = self._expense_of("002")
        [leg_before] = self._legs("002")
        line_before = self._lines()["002"]

        # The line's very last write fails: everything before it (stamp, create, delete, match) rolls back.
        with patch.object(porter_rectify, "resync_cashflow_hold", side_effect=RuntimeError("hook died")):
            [line] = self._rectify(["002"], self.zephyr)["lines"]

        self.assertFalse(line["rectified"])
        self.assertIn("nothing on it was changed", line["reason"])
        self.assertTrue(frappe.db.exists(PROJECT_EXPENSE, old.name))
        self.assertEqual(frappe.db.get_value(PROJECT_EXPENSE, old.name, "projects"), self.quillon)
        [leg_after] = self._legs("002")
        self.assertEqual((leg_after.name, leg_after.match_kind), (leg_before.name, "Settled"))
        self.assertFalse(leg_after.reversal_reason)
        self.assertEqual([e.name for e in self._live_expenses_of_order(self._crn("002"))], [old.name])
        line_after = self._lines()["002"]
        self.assertEqual(
            (line_after.suggested_name, line_after.resolved_project),
            (line_before.suggested_name, line_before.resolved_project),
        )


class TestBothProjectsCashflowHolds(PorterRectifyCase):
    def test_the_old_project_is_released_and_the_new_one_held(self):
        quillon_gap = _compute_cashflow_gap(self.quillon)
        zephyr_gap = _compute_cashflow_gap(self.zephyr)
        # Quillon is ₹50 over its limit until 002 (₹133) leaves; Zephyr crosses its limit when 002 arrives.
        frappe.db.set_value("Projects", self.quillon, "cashflow_gap_limit", quillon_gap - 50, update_modified=False)
        frappe.db.set_value("Projects", self.zephyr, "cashflow_gap_limit", zephyr_gap + 100, update_modified=False)
        ceo_hold.set_reason(self.quillon, ceo_hold.SOURCE_CASHFLOW, "test: over the limit")
        ceo_hold.clear_reason(self.zephyr, ceo_hold.SOURCE_CASHFLOW)
        frappe.db.commit()

        [line] = self._rectify(["002"], self.zephyr)["lines"]
        self.assertTrue(line["rectified"], line)

        self.assertEqual(_compute_cashflow_gap(self.quillon), quillon_gap - 133)
        self.assertEqual(_compute_cashflow_gap(self.zephyr), zephyr_gap + 133)
        self.assertNotIn(ceo_hold.SOURCE_CASHFLOW, ceo_hold.active_sources(self.quillon))
        self.assertIn(ceo_hold.SOURCE_CASHFLOW, ceo_hold.active_sources(self.zephyr))


class TestSeveralTickedTogether(PorterRectifyCase):
    def test_each_line_moves_on_its_own_and_a_refused_one_stops_no_other(self):
        result = self._rectify(["003", "004", "002"], self.zephyr)
        self.assertEqual(result["count"], 3)
        by_row = {line["row"]: line for line in result["lines"]}
        lines = self._lines()
        self.assertTrue(by_row[lines["003"].name]["rectified"])
        self.assertFalse(by_row[lines["004"].name]["rectified"])  # already on Zephyr
        self.assertTrue(by_row[lines["002"].name]["rectified"])
        for suffix in ("003", "002", "004"):
            expense = self._expense_of(suffix)
            self.assertEqual((expense.doctype, expense.projects), (PROJECT_EXPENSE, self.zephyr), suffix)
        self.assertEqual(len(self._legs("004")), 1)

    def test_the_plan_says_where_each_order_is_and_offers_won_projects_only(self):
        lines = self._lines()
        plan = porter_rectify.get_porter_rectify_plan(
            json.dumps([lines["002"].name, lines["003"].name, lines["011"].name])
        )
        quillon_line, non_project_line, cancelled = plan["lines"]
        self.assertEqual(
            (quillon_line["ledger"], quillon_line["project"], quillon_line["project_name"]),
            (PROJECT_EXPENSE, self.quillon, "Quillon Park"),
        )
        self.assertEqual(quillon_line["expense"], self._expense_of("002").name)
        self.assertIsNone(quillon_line["refusal"])
        self.assertFalse(quillon_line["description_edited"])
        self.assertEqual((non_project_line["ledger"], non_project_line["project"]), (NON_PROJECT_EXPENSE, None))
        self.assertIn("not Settled", cancelled["refusal"])
        offered = {p["name"] for p in plan["projects"]}
        self.assertIn(self.zephyr, offered)
        self.assertNotIn(self.zephyr_tender, offered)


class TestUnreconcileOnAPorterLine(PorterRectifyCase):
    def test_it_deletes_the_expense_keeps_the_porter_order_and_reopens_the_line(self):
        from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row

        line = self._lines()["002"]
        expense = line.suggested_name
        unreconcile_row(row=line.name, legs="all", reason="wrong import")
        self.assertFalse(frappe.db.exists(PROJECT_EXPENSE, expense))
        self.assertTrue(frappe.db.exists(ORDER_DOCTYPE, line.transfer_id))
        self.assertEqual(self._live_expenses_of_order(line.transfer_id), [])
        reopened = self._lines()["002"]
        self.assertEqual(reopened.row_status, "Mismatched")
        self.assertFalse(reopened.suggested_name)

    def test_a_rectified_line_unreconciled_and_created_again_lands_where_it_was_rectified_to(self):
        from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row

        self._rectify(["003"], self.zephyr)
        unreconcile_row(row=self._lines()["003"].name, legs="all", reason="redo it")
        self._press_create()
        self._run_create()
        expense = self._expense_of("003")
        self.assertEqual((expense.doctype, expense.projects), (PROJECT_EXPENSE, self.zephyr))


class TestAPersonsAttachmentMovesWithTheExpense(PorterRectifyCase):
    def test_a_file_added_to_the_old_expense_is_on_the_new_one_and_never_deleted(self):
        old = self._expense_of("002")
        url = "/private/files/porter-site-photo.jpg"
        file_name = f"TEST-PORTER-RECTIFY-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabFile" (name, creation, modified, modified_by, owner, docstatus, idx,
                   file_name, file_url, attached_to_doctype, attached_to_name, attached_to_field,
                   content_hash, is_private, is_folder)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                   'site-photo.jpg', %s, %s, %s, 'payment_attachment', 'abc123', 1, 0)""",
            (file_name, url, PROJECT_EXPENSE, old.name),
        )
        frappe.db.set_value(PROJECT_EXPENSE, old.name, "payment_attachment", url, update_modified=False)
        frappe.db.commit()
        self.addCleanup(_delete_file, file_name)

        def cloud_delete(doc, method):
            raise AssertionError(f"cloud delete reached for File {doc.name} ({doc.file_url})")

        with patch("frappe_gcp_attachment.controller.delete_from_cloud", cloud_delete), patch(
            "frappe_s3_attachment.controller.delete_from_cloud", cloud_delete
        ):
            [line] = self._rectify(["002"], None)["lines"]
        self.assertTrue(line["rectified"], line)

        new = self._expense_of("002")
        self.assertEqual(new.payment_attachment, url)
        self.assertEqual(
            tuple(frappe.db.get_value("File", file_name, ["attached_to_doctype", "attached_to_name"])),
            (NON_PROJECT_EXPENSE, new.name),
        )


class TestTheSharedInvoicePdfSurvivesEveryCorrection(PorterRectifyCase):
    """Story 52: the invoice PDF is one File, attached to its Porter Invoice, whatever happens to one of the
    invoice's expenses afterwards: an ordinary save, a Rectify, an Unreconcile."""

    def test_an_edited_expense_rectified_then_unreconciled_leaves_the_pdf_to_its_invoice_and_the_others(self):
        from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row

        number = self.numbers["29SS27A0900001"]
        pdf = frappe.db.get_value(INVOICE_DOCTYPE, number, "invoice_file")
        pdf_file = frappe.db.get_value(
            "File", {"file_url": pdf, "attached_to_doctype": INVOICE_DOCTYPE, "attached_to_name": number}
        )
        self.assertTrue(pdf_file)

        def cloud_delete(doc, method):
            raise AssertionError(f"cloud delete reached for File {doc.name} ({doc.file_url})")

        with _no_bucket_upload(), patch(
            "frappe_gcp_attachment.controller.delete_from_cloud", cloud_delete
        ), patch("frappe_s3_attachment.controller.delete_from_cloud", cloud_delete):
            # An ordinary later save, as the edit dialog makes one.
            expense = self._expense_of("002")
            # The attach hook records the refused copy as an Error Log on the expense.
            self.addCleanup(_delete_error_logs, expense.doctype, expense.name)
            expense.description = "Porter Delivery for the Quillon site visit"
            expense.save(ignore_permissions=True)
            frappe.db.commit()
            self.assertEqual(_files_of_expenses_for(pdf), [])

            [line] = self._rectify(["002"], None)["lines"]
            self.assertTrue(line["rectified"], line)
            unreconcile_row(row=self._lines()["002"].name, legs="all", reason="wrong import")

        self.assertEqual(_files_of_expenses_for(pdf), [])
        self.assertTrue(frappe.db.exists("File", pdf_file))
        self.assertTrue(frappe.get_doc("File", pdf_file).exists_on_disk())
        others = [e for e in self._expenses() if e.invoice_ref == number]
        self.assertEqual(len(others), 4)
        self.assertEqual({e.invoice_attachment for e in others}, {pdf})

    def test_a_copy_an_older_save_left_on_an_expense_goes_with_it_and_the_pdf_stays(self):
        from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row

        number = self.numbers["29SS27A0900001"]
        original = frappe.db.get_value(
            "File",
            {"attached_to_doctype": INVOICE_DOCTYPE, "attached_to_name": number},
            ["name", "file_url", "content_hash"],
            as_dict=True,
        )
        expense = self._expense_of("001")
        copy = f"TEST-PORTER-PDF-COPY-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabFile" (name, creation, modified, modified_by, owner, docstatus, idx,
                   file_name, file_url, attached_to_doctype, attached_to_name, attached_to_field,
                   content_hash, is_private, is_folder)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                   'invoice.pdf', %s, %s, %s, 'invoice_attachment', %s, 1, 0)""",
            (copy, original.file_url, expense.doctype, expense.name, original.content_hash),
        )
        frappe.db.commit()
        self.addCleanup(_delete_file, copy)

        def cloud_delete(doc, method):
            raise AssertionError(f"cloud delete reached for File {doc.name} ({doc.file_url})")

        with patch("frappe_gcp_attachment.controller.delete_from_cloud", cloud_delete), patch(
            "frappe_s3_attachment.controller.delete_from_cloud", cloud_delete
        ):
            unreconcile_row(row=self._lines()["001"].name, legs="all", reason="wrong import")

        self.assertFalse(frappe.db.exists(expense.doctype, expense.name))
        self.assertFalse(frappe.db.exists("File", copy))
        self.assertTrue(frappe.get_doc("File", original.name).exists_on_disk())


def _files_of_expenses_for(file_url: str) -> list:
    """Every File row an expense owns for `file_url`."""
    return frappe.get_all(
        "File",
        filters={"file_url": file_url, "attached_to_doctype": ["in", [PROJECT_EXPENSE, NON_PROJECT_EXPENSE]]},
        pluck="name",
    )


def _delete_error_logs(doctype: str, name: str) -> None:
    frappe.db.rollback()
    try:
        frappe.db.delete("Error Log", {"reference_doctype": doctype, "reference_name": name})
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        print(f"porter rectify test purge: could not delete the Error Logs of {doctype} {name}")


def _purge_history(batch: str) -> None:
    """The Versions, deleted-record copies and Comments Rectify and Unreconcile leave on the expenses, the
    matches and the lines of `batch`. Raw, per scope."""
    frappe.db.rollback()
    matches = frappe.get_all(
        MATCH_DOCTYPE, filters={"import_batch": batch}, fields=["name", "target_doctype", "target_name"]
    )
    rows = frappe.get_all("Outflow Import Row", filters={"import_batch": batch}, pluck="name")
    scopes = [("Version", {"ref_doctype": MATCH_DOCTYPE, "docname": m.name}) for m in matches]
    for m in matches:
        for doctype in ("Version", "Nirmaan Versions"):
            scopes.append((doctype, {"ref_doctype": m.target_doctype, "docname": m.target_name}))
        scopes.append(("Comment", {"reference_doctype": m.target_doctype, "reference_name": m.target_name}))
    if rows:
        scopes.append(("Comment", {"reference_doctype": "Outflow Import Row", "reference_name": ["in", rows]}))
    for doctype, filters in scopes:
        try:
            frappe.db.delete(doctype, filters)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            print(f"porter rectify test purge: could not delete {doctype} {filters}")


def _delete_file(name: str) -> None:
    frappe.db.rollback()
    try:
        frappe.db.delete("File", {"name": name})
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        print(f"porter rectify test purge: could not delete File {name}")
