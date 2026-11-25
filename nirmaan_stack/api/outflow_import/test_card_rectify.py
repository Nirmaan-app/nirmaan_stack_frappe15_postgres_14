# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Move a card spend's expense to a Won project: Rectify with the card source (#1761, spec #1753 stories 4, 43, 55-59).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_card_rectify

Seam: the Move plan and write calls (`rectify.get_rectify_plan`, `rectify.rectify_lines`), on a made-up card statement
uploaded and Created end to end (`test_card_create.CardCreateCase`). Read back the way the screens read it: the Credit
Card invoice queue (`card_invoices.get_card_invoice_queue`), the card pill of Expense bills
(`all_expense_bills.get_all_expense_bills`), the line and its Settled match.

Lines of the fixture used here (made-up statement, `test_card_import.FIXTURE`):
  PARK    the spend "PARK RESIDENCY Cochin IN"
  ZOMATO  another spend, given a bill before it moves
"""

import json
from decimal import Decimal

import frappe

from nirmaan_stack.api.expenses.all_expense_bills import get_all_expense_bills
from nirmaan_stack.api.expenses.card_invoices import attach_card_invoice, get_card_invoice_queue
from nirmaan_stack.api.expenses.expense_bill_fixture import capture_jobs, purge_expense_bills
from nirmaan_stack.api.expenses.test_expense_bills import FakeReader, bills_of, run_reading
from nirmaan_stack.api.outflow_import import rectify
from nirmaan_stack.api.outflow_import.test_card_create import CardCreateCase
from nirmaan_stack.api.outflow_import.test_card_import import purge_records
from nirmaan_stack.api.outflow_import.test_porter_rectify import _purge_history
from nirmaan_stack.cloud_file_fixture import cloud_url
from nirmaan_stack.services.expense_bills.bill_check import BillRead

REASON = "Booked for the site visit"
PROJECT_EXPENSE = "Project Expenses"
NON_PROJECT_EXPENSE = "Non Project Expenses"
PARK = "PARK RESIDENCY Cochin IN"
#: A type both ledgers take: a card spend is typed a Non Project-only type (Misc. Expenses), so a move to a project
#: names one, as the dialog asks.
PROJECT_TYPE = "Petty Cash"


class CardRectifyCase(CardCreateCase):
    """The statement uploaded and Created; a made-up Won project and a Tendering one."""

    def setUp(self):
        super().setUp()
        self.jobs = capture_jobs(self)
        self.projects = []
        self.addCleanup(self._purge_projects)
        self.orchid = self._project("Testorchid Heights", "Won")
        self.tender = self._project("Testtender Plaza", "Tendering")
        self._run_create()
        frappe.db.commit()
        # Runs before `_purge_created` (cleanups are last-in, first-out), while the matches still name the expenses.
        self.addCleanup(self._purge_moved)
        self.addCleanup(_purge_history, self.batch)

    def _project(self, name: str, tendering_status: str) -> str:
        doc = frappe.new_doc("Projects")
        doc.project_name = f"{name} {frappe.generate_hash(length=4)}"
        doc.tendering_status = tendering_status
        doc.project_start_date = frappe.utils.now()[:19]
        doc.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
        doc.project_scopes = {"scopes": []}
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        self.projects.append(doc.name)
        return doc.name

    def _purge_projects(self):
        frappe.db.rollback()
        for name in self.projects:
            try:
                frappe.delete_doc("Projects", name, force=True, ignore_permissions=True)
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()
                print(f"card rectify test purge: could not delete project {name}")

    def _purge_moved(self):
        """The bills, the Project Expenses a Move made, and what deleting the old expenses left."""
        frappe.db.rollback()
        matches = frappe.get_all(
            "Outflow Row Match", filters={"import_batch": self.batch}, fields=["target_doctype", "target_name"]
        )
        purge_expense_bills([m.target_name for m in matches])
        purge_records(PROJECT_EXPENSE, [m.target_name for m in matches if m.target_doctype == PROJECT_EXPENSE])
        for m in matches:
            try:
                frappe.db.delete("Deleted Document", {"deleted_doctype": m.target_doctype, "deleted_name": m.target_name})
                frappe.db.delete(
                    "Comment", {"comment_type": "Deleted", "subject": f"{m.target_doctype} {m.target_name}"}
                )
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()
                print(f"card rectify test purge: could not delete what deleting {m.target_name} left")

    def _expense_of(self, details: str):
        """The expense the line's live Settled match names."""
        line = self._line(details)
        target = frappe.db.get_value(
            "Outflow Row Match", {"import_row": line.name, "match_kind": "Settled"}, ["target_doctype", "target_name"]
        )
        return frappe.get_doc(*target)

    def _plan(self, *details: str) -> dict:
        return rectify.get_rectify_plan(json.dumps([self._line(d).name for d in details]))

    def _move(self, details, project, reason=REASON, expense_type=None) -> dict:
        names = [self._line(d).name for d in details]
        return rectify.rectify_lines(json.dumps(names), project or "", reason, expense_type)


class TestACardSpendMovedToAProject(CardRectifyCase):
    def test_it_stays_in_the_credit_card_queue_with_its_holder_as_paid_by_and_keeps_its_bill(self):
        zomato = next(line.remarks for line in self._spends() if line.remarks.upper().startswith("ZOMATO"))
        billed = self._expense_of(zomato)
        attach_card_invoice(billed.name, cloud_url("zomato.pdf"))
        [bill] = bills_of(NON_PROJECT_EXPENSE, billed.name)
        run_reading(bill.name, FakeReader(BillRead(total=Decimal("1.00"), invoice_no="TESTBILL-7")))
        frappe.db.commit()
        old = self._expense_of(PARK)

        result = self._move([PARK, zomato], self.orchid, expense_type=PROJECT_TYPE)

        self.assertTrue(all(line["rectified"] for line in result["lines"]), result)
        self.assertFalse(frappe.db.exists(NON_PROJECT_EXPENSE, old.name))
        new = self._expense_of(PARK)
        self.assertEqual((new.doctype, new.projects), (PROJECT_EXPENSE, self.orchid))
        self.assertEqual((new.credit_card_statement, new.type), (self.statement, PROJECT_TYPE))
        self.assertEqual(new.payment_by, self.holder)
        self.assertEqual((float(new.amount), new.payment_ref, str(new.payment_date)),
                         (float(old.amount), old.payment_ref, str(old.payment_date)))

        # Still waiting in Pending Invoices Upload -> Credit Card, on its new ledger, the holder its Paid by.
        queued = {row["name"]: row for row in get_card_invoice_queue()}
        self.assertIn(new.name, queued)
        self.assertEqual(
            (queued[new.name]["doctype"], queued[new.name]["holder"], queued[new.name]["credit_card_statement"]),
            (PROJECT_EXPENSE, self.holder, self.statement),
        )

        # The billed spend keeps its bill and Bill check, listed on the card pill with the holder as Paid by.
        moved = self._expense_of(zomato)
        [kept] = bills_of(PROJECT_EXPENSE, moved.name)
        self.assertEqual((kept.name, kept.bill_check, kept.is_latest), (bill.name, "Mismatched", 1))
        listed = {
            row["name"]: row
            for row in get_all_expense_bills(filters=json.dumps([["kind", "=", "card"]]), limit_page_length=500)["data"]
        }
        self.assertEqual(
            (listed[bill.name]["expense"], listed[bill.name]["paid_by"], listed[bill.name]["project"]),
            (moved.name, self.holder, self.orchid),
        )
