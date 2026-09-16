# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Unreconcile a line whose record the import CREATED (#1278, parent #1270, ADR-0022).

Through the whitelisted `get_unreconcile_plan` and `unreconcile_row`, for each Create path -- a Project
Inflow, a Non-Project Inflow and a new expense: the record is deleted, the leg is kept and stamped
Reversed, the line is open again, and (for a credit) the same bank line can be recorded again.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every record hangs off the fixture's throwaway project, and
every record, its Versions, its `Nirmaan Versions` copy and its File rows are purged in tearDown.
"""

import json
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import.expenses import create_expense
from nirmaan_stack.api.outflow_import.inflows import create_inflow, create_non_project_inflow
from nirmaan_stack.api.outflow_import.test_unreconcile_expenses import (
    NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE,
    ExpenseUnreconcileFixture,
)
from nirmaan_stack.api.outflow_import.unreconcile import get_unreconcile_plan, unreconcile_row
from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import (
    _compute_cashflow_gap,
)
from nirmaan_stack.services.ceo_hold import core as ceo_hold
from nirmaan_stack.services.outflow_import.ledgers import (
    INFLOW_DOCTYPES,
    LEDGER_DOCTYPES,
)
from nirmaan_stack.services.outflow_import.settle import statement_attachment_field
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED, ROW_SETTLED
from nirmaan_stack.services.outflow_import.unreconcile import (
    IMPORT_WRITTEN_FIELDS,
    VERDICT_DELETE_CREATED,
    VERDICT_REFUSED,
    WHAT_HAPPENS_DELETE,
    WHAT_HAPPENS_DELETE_PROJECT_INFLOW,
)

PROJECT_INFLOW = "Project Inflows"
NON_PROJECT_INFLOW = "Non Project Inflows"
MATCH_DOCTYPE = "Outflow Row Match"
BATCH_DOCTYPE = "Outflow Import Batch"


class CreatedUnreconcileFixture(ExpenseUnreconcileFixture):
    def setUp(self):
        super().setUp()
        self.created = []

    def tearDown(self):
        for doctype, name in self.created:
            frappe.db.delete("Version", {"ref_doctype": doctype, "docname": name})
            frappe.db.delete("Nirmaan Versions", {"ref_doctype": doctype, "docname": name})
            frappe.db.delete("File", {"attached_to_doctype": doctype, "attached_to_name": name})
            frappe.db.delete("Comment", {"reference_doctype": doctype, "reference_name": name})
            frappe.db.delete(doctype, {"name": name})
        frappe.db.commit()
        super().tearDown()

    def _project_with_customer(self):
        project = self._allocation_project()
        customer = frappe.db.get_value("Customers", {}, "name")
        if not customer:
            self.skipTest("no Customers row on this site")
        frappe.db.set_value("Projects", project, "customer", customer, update_modified=False)
        frappe.db.commit()
        return project

    def _project_inflow(self, amount="500"):
        row = self._staged_row(amount=amount, direction="Credit")
        name = create_inflow(row=row, project=self._project_with_customer())["settled"]["name"]
        self.created.append((PROJECT_INFLOW, name))
        return row, name

    def _non_project_inflow(self, row=None, amount="500"):
        row = row or self._staged_row(amount=amount, direction="Credit")
        name = create_non_project_inflow(row=row, inflow_type="Loan Received")["settled"]["name"]
        self.created.append((NON_PROJECT_INFLOW, name))
        return row, name

    def _created_expense(self, doctype=NON_PROJECT_EXPENSE, amount="500"):
        row = self._staged_row(amount=amount)
        kwargs = {}
        if doctype == PROJECT_EXPENSE:
            kwargs["project"] = self._allocation_project()
        name = create_expense(
            row=row,
            doctype=doctype,
            expense_type=frappe.db.get_value(
                "Expense Type",
                {"project": 1, "non_project": 0}
                if doctype == PROJECT_EXPENSE
                else {"non_project": 1, "project": 0},
                "name",
            ),
            **kwargs,
        )["settled"]["name"]
        self.created.append((doctype, name))
        return row, name

    def _assert_deleted_and_line_open(self, row, doctype, name):
        self.assertFalse(frappe.db.exists(doctype, name))
        leg = frappe.db.get_value(
            MATCH_DOCTYPE,
            {"import_row": row, "target_name": name},
            ["match_kind", "reversal_reason", "created_by_import"],
            as_dict=True,
        )
        # The leg is KEPT (ADR-0020 D3), naming a record that no longer exists.
        self.assertEqual(leg.match_kind, "Reversed")
        self.assertEqual(leg.reversal_reason, "wrong line")
        self.assertEqual(self._line(row).row_status, ROW_MISMATCHED)


class TestTheCreatedFlag(CreatedUnreconcileFixture):
    def test_every_create_path_marks_its_leg_created(self):
        for label, make in [
            ("Project Inflow", self._project_inflow),
            ("Non-Project Inflow", self._non_project_inflow),
            ("Project Expense", lambda: self._created_expense(PROJECT_EXPENSE)),
            ("Non-Project Expense", lambda: self._created_expense(NON_PROJECT_EXPENSE)),
        ]:
            with self.subTest(label):
                row, name = make()
                self.assertEqual(
                    frappe.db.get_value(MATCH_DOCTYPE, self._leg(row, name), "created_by_import"), 1
                )

    def test_a_hand_link_is_not_marked_created(self):
        row, name = self._linked(NON_PROJECT_EXPENSE)
        self.assertEqual(
            frappe.db.get_value(MATCH_DOCTYPE, self._leg(row, name), "created_by_import"), 0
        )

    def test_the_import_written_fields_are_the_statement_attachment_fields(self):
        self.assertEqual(
            IMPORT_WRITTEN_FIELDS,
            frozenset(
                statement_attachment_field(d) for d in (*LEDGER_DOCTYPES, *INFLOW_DOCTYPES)
            ),
        )


class TestACreatedProjectInflow(CreatedUnreconcileFixture):
    def test_the_plan_offers_the_delete_with_the_cash_position_sentence(self):
        row, name = self._project_inflow()
        [leg] = get_unreconcile_plan(row=row)["legs"]
        self.assertEqual(leg["verdict"], VERDICT_DELETE_CREATED)
        self.assertEqual(leg["what_happens"], WHAT_HAPPENS_DELETE_PROJECT_INFLOW)

    def test_it_is_deleted_the_leg_stays_and_the_cashflow_hold_is_a_fresh_evaluation(self):
        project = self._project_with_customer()
        # A Paid 1,000 expense on the project, then a 500 inflow: gap 500, under a limit of 750.
        expense = self._expense(PROJECT_EXPENSE, "1000")
        frappe.db.set_value(PROJECT_EXPENSE, expense, "status", "Paid", update_modified=False)
        frappe.db.commit()
        row, name = self._project_inflow("500")
        gap_before = _compute_cashflow_gap(project)
        frappe.db.set_value(
            "Projects", project, "cashflow_gap_limit", gap_before + 250, update_modified=False
        )
        ceo_hold.clear_reason(project, ceo_hold.SOURCE_CASHFLOW)
        frappe.db.commit()
        # `create_inflow` in this same process already claimed the hook's per-request flag, and the
        # inflow's trash hook evaluates before the row is gone -- only the explicit re-sync is left.
        self.assertTrue(frappe.flags.get(f"ceo_hold_checked:{project}"))

        result = unreconcile_row(row=row, legs="all", reason="wrong line")

        self._assert_deleted_and_line_open(row, PROJECT_INFLOW, name)
        [reversed_leg] = result["reversed"]
        self.assertEqual(reversed_leg["verdict"], VERDICT_DELETE_CREATED)
        self.assertIsNone(reversed_leg["amount_after"])
        gap_after = _compute_cashflow_gap(project)
        self.assertEqual(gap_after, gap_before + 500)
        self.assertIn(ceo_hold.SOURCE_CASHFLOW, ceo_hold.active_sources(project))

    def test_the_same_credit_can_be_recorded_again(self):
        row, name = self._project_inflow()
        unreconcile_row(row=row, legs="all", reason="wrong line")

        again = create_inflow(row=row, project=self._project_with_customer())["settled"]["name"]
        self.created.append((PROJECT_INFLOW, again))
        self.assertNotEqual(again, name)
        self.assertEqual(self._line(row).row_status, ROW_SETTLED)


class TestACreatedNonProjectInflow(CreatedUnreconcileFixture):
    def test_it_is_deleted_and_the_same_credit_is_recordable_again(self):
        row, name = self._non_project_inflow()
        [leg] = get_unreconcile_plan(row=row)["legs"]
        self.assertEqual(leg["what_happens"], WHAT_HAPPENS_DELETE)

        unreconcile_row(row=row, legs="all", reason="wrong line")

        self._assert_deleted_and_line_open(row, NON_PROJECT_INFLOW, name)
        _, again = self._non_project_inflow(row=row)
        self.assertNotEqual(again, name)
        self.assertEqual(self._line(row).row_status, ROW_SETTLED)

    def test_the_statement_survives_with_the_cloud_attachment_app_enabled(self):
        """The record's statement `File` link row must come off by RAW delete, before the record is
        deleted: `delete_doc` deletes attached `File`s through the document layer, and the cloud apps'
        `on_trash` would delete the shared blob by `content_hash` (and throws on a link row's NULL)."""
        row, name = self._non_project_inflow()
        batch = frappe.db.get_value("Outflow Import Row", row, "import_batch")
        batch_file = self._raw_file(self.ALLOC_STATEMENT, BATCH_DOCTYPE, batch, content_hash="abc123")
        link = self._raw_file(self.ALLOC_STATEMENT, NON_PROJECT_INFLOW, name, field="inflow_attachment")

        def cloud_delete(doc, method):
            raise AssertionError(f"cloud delete reached for File {doc.name} ({doc.file_url})")

        with patch("frappe_gcp_attachment.controller.delete_from_cloud", cloud_delete), patch(
            "frappe_s3_attachment.controller.delete_from_cloud", cloud_delete
        ):
            unreconcile_row(row=row, legs="all", reason="wrong line")

        self.assertFalse(frappe.db.exists(NON_PROJECT_INFLOW, name))
        self.assertFalse(frappe.db.exists("File", link))
        self.assertTrue(frappe.db.exists("File", batch_file))

    def _raw_file(self, url, doctype, name, *, field=None, content_hash=None):
        file_name = f"TEST-OFI-FILE-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabFile" (name, creation, modified, modified_by, owner, docstatus, idx,
                   file_name, file_url, attached_to_doctype, attached_to_name, attached_to_field,
                   content_hash, is_private, is_folder)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                   'statement.csv', %s, %s, %s, %s, %s, 1, 0)""",
            (file_name, url, doctype, name, field, content_hash),
        )
        self.files.append(file_name)
        frappe.db.commit()
        return file_name


class TestACreatedExpense(CreatedUnreconcileFixture):
    def test_each_kind_is_deleted_and_the_line_opens(self):
        for doctype in (PROJECT_EXPENSE, NON_PROJECT_EXPENSE):
            with self.subTest(doctype=doctype):
                row, name = self._created_expense(doctype)
                [leg] = get_unreconcile_plan(row=row)["legs"]
                self.assertEqual(leg["verdict"], VERDICT_DELETE_CREATED)
                self.assertEqual(leg["what_happens"], WHAT_HAPPENS_DELETE)

                unreconcile_row(row=row, legs="all", reason="wrong line")

                self._assert_deleted_and_line_open(row, doctype, name)


class TestEditedSince(CreatedUnreconcileFixture):
    def _assert_refused_and_kept(self, row, doctype, name):
        [leg] = get_unreconcile_plan(row=row)["legs"]
        self.assertEqual(leg["verdict"], VERDICT_REFUSED)
        self.assertIn("after the import made it. Delete or fix it on its own screen.", leg["reason"])
        with self.assertRaises(frappe.ValidationError) as caught:
            unreconcile_row(row=row, legs="all", reason="wrong line")
        self.assertIn("Someone edited it on", str(caught.exception))
        self.assertTrue(frappe.db.exists(doctype, name))
        self.assertEqual(frappe.db.get_value(MATCH_DOCTYPE, self._leg(row, name), "match_kind"), "Settled")
        self.assertEqual(self._line(row).row_status, ROW_SETTLED)

    def test_a_record_a_person_edited_after_the_import_made_it_is_refused(self):
        row, name = self._non_project_inflow()
        doc = frappe.get_doc(NON_PROJECT_INFLOW, name)
        doc.description = "corrected by hand"
        doc.save(ignore_permissions=True, ignore_version=False)
        frappe.db.commit()
        self._assert_refused_and_kept(row, NON_PROJECT_INFLOW, name)

    def test_a_created_expense_edited_since_is_refused_too(self):
        row, name = self._created_expense(PROJECT_EXPENSE)
        doc = frappe.get_doc(PROJECT_EXPENSE, name)
        doc.description = "corrected by hand"
        doc.save(ignore_permissions=True, ignore_version=False)
        frappe.db.commit()
        self._assert_refused_and_kept(row, PROJECT_EXPENSE, name)

    def test_one_touched_only_by_the_import_s_attachment_adoption_is_still_deleted(self):
        row, name = self._non_project_inflow()
        frappe.get_doc(
            {
                "doctype": "Version",
                "ref_doctype": NON_PROJECT_INFLOW,
                "docname": name,
                "data": json.dumps(
                    {"changed": [["inflow_attachment", None, self.ALLOC_STATEMENT]], "added": [],
                     "removed": [], "row_changed": []}
                ),
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()

        unreconcile_row(row=row, legs="all", reason="wrong line")

        self._assert_deleted_and_line_open(row, NON_PROJECT_INFLOW, name)
