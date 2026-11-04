# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A bill added later reaches the existing Expense with the next statement (#1593, spec #1585 "Dedupe and late
bills", "A late attach uses the same step 3"; ADR-0015 Amendment B decision 5).

Seam: two uploads in one test at the Cashbook import endpoints (`preview_cashbook_statement`,
`confirm_cashbook_import`). Only the transport is faked: the posted file, the queue (the job runs inline, as the
queue would run it) and the bill downloader (`cashbook_bills.fetch_bill`). The fixture's links are signed for 2099, so no
clock is set.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_late_bills
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expenses.cashbook_invoices import get_cashbook_invoice_queue
from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import.test_cashbook_bills import _fake_bills
from nirmaan_stack.api.outflow_import.test_cashbook_import import FIXTURE, _purge
from nirmaan_stack.services.outflow_import.bill_download import BillRefused

LINKED = "OBO1700000000001AAAAAA"  # Upload 1 already carries its bill (1.jpeg)
LATE = "OBO1700000000002BBBBBB"  # no bill in upload 1; upload 2 brings 1.jpeg
OTHER = "OBO1700000000003CCCCCC"  # no bill in either upload


class LateBillsCase(FrappeTestCase):
    """Two uploads of the sample: helpers only, so another module can build on it without re-running these tests."""

    def setUp(self):
        super().setUp()
        lines = FIXTURE.read_text().splitlines()
        self.header, self.data, self.footer = lines[0], lines[1:12], lines[12:]
        link = next(part for part in self.data[0].split('"') if part.startswith("https://"))
        late_link = link.replace(LINKED, LATE)
        assert self.data[1].endswith('"No","","","",""'), self.data[1]
        self.late_line = self.data[1][: -len('"No","","","",""')] + f'"Yes","{late_link}","","",""'
        self.batches: list[str] = []
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        for batch in self.batches:
            for target in frappe.get_all(
                "Outflow Row Match", filters={"import_batch": batch}, fields=["target_doctype", "target_name"]
            ):
                frappe.db.delete(
                    "File", {"attached_to_doctype": target.target_doctype, "attached_to_name": target.target_name}
                )
            frappe.db.delete("File", {"attached_to_doctype": "Outflow Import Batch", "attached_to_name": batch})
            _purge(batch)
        frappe.db.commit()

    def _file(self, data_lines) -> bytes:
        return "\n".join([self.header, *data_lines, *self.footer]).encode()

    def _post(self, endpoint, content: bytes):
        import io

        from werkzeug.datastructures import FileStorage, MultiDict

        from nirmaan_stack.services.outflow_import.tests.cashbook_xlsx import as_statement_xlsx

        class _Request:
            files = MultiDict(
                {"file": FileStorage(stream=io.BytesIO(as_statement_xlsx(content)), filename="cashbook.xlsx")}
            )
            host = None  # `save_file` asks the request for its host

        previous = getattr(frappe.local, "request", None)
        frappe.set_user("Administrator")
        frappe.local.request = _Request()
        try:
            return endpoint()
        finally:
            frappe.local.request = previous

    def _upload(self, content: bytes, fetch=None):
        """Confirm `content` and run its job inline, as the queue would. Returns the confirm's answer."""
        fetch = fetch or _fake_bills()

        def run_now(batch, actor, **kwargs):
            cb._cashbook_worker(batch, actor, **kwargs)

        with patch.object(bills, "fetch_bill", fetch), patch.object(cb, "_enqueue_worker", side_effect=run_now):
            result = self._post(cb.confirm_cashbook_import, content)
        self.batches.append(result["batch"])
        return result

    def _expenses_of(self, txn: str) -> list:
        found = []
        for doctype in ("Project Expenses", "Non Project Expenses"):
            for row in frappe.get_all(
                doctype,
                filters={"payment_ref": txn},
                fields=["name", "invoice_attachment", "no_invoice_by", "cashbook_batch"],
            ):
                found.append(frappe._dict(row, doctype=doctype))
        return found

    def _expense(self, txn: str):
        (only,) = self._expenses_of(txn)
        return only

    def _lines_of(self, txn: str) -> int:
        return frappe.db.count("Outflow Import Row", {"transfer_id": txn})

    def _first_upload(self):
        """Upload 1: the first three spends, the second with no bill. Its Expense waits in the Cashbook tab."""
        self._upload(self._file(self.data[:3]))
        waiting = self._expense(LATE)
        self.assertFalse(waiting.invoice_attachment)
        self.assertIn(waiting.name, {row["name"] for row in get_cashbook_invoice_queue()})
        return waiting

    def _second_file(self) -> bytes:
        """Upload 2: the whole statement, overlapping upload 1, the late spend now with its bill."""
        return self._file([self.data[0], self.late_line, *self.data[2:]])



class TestLateBills(LateBillsCase):
    def test_a_late_bill_reaches_the_waiting_expense_which_leaves_the_cashbook_tab(self):
        waiting = self._first_upload()
        self._upload(self._second_file())

        after = self._expense(LATE)  # still one Expense
        self.assertEqual(after.name, waiting.name)
        self.assertTrue(after.invoice_attachment)
        bill = frappe.get_doc("File", {"file_url": after.invoice_attachment})
        self.assertEqual((bill.attached_to_doctype, bill.attached_to_name), (after.doctype, after.name))
        self.assertNotIn(after.name, {row["name"] for row in get_cashbook_invoice_queue()})
        self.assertEqual(self._lines_of(LATE), 1)  # the repeat line is still not saved

    def test_an_expense_from_an_older_unmarked_import_gets_the_bill_too(self):
        waiting = self._first_upload()
        frappe.db.set_value(waiting.doctype, waiting.name, "cashbook_batch", None)
        frappe.db.commit()

        self._upload(self._second_file())

        after = self._expense(LATE)
        self.assertEqual(after.name, waiting.name)
        self.assertTrue(after.invoice_attachment)

    def test_an_expense_that_already_has_an_invoice_is_not_changed(self):
        waiting = self._first_upload()
        frappe.db.set_value(waiting.doctype, waiting.name, "invoice_attachment", "/private/files/by-hand.pdf")
        frappe.db.commit()
        fetch = _fake_bills()

        self._upload(self._second_file(), fetch)

        self.assertEqual(self._expense(LATE).invoice_attachment, "/private/files/by-hand.pdf")
        self.assertFalse([url for url in fetch.calls if LATE in url])

    def test_an_expense_marked_no_invoice_is_not_changed(self):
        waiting = self._first_upload()
        frappe.db.set_value(
            waiting.doctype,
            waiting.name,
            {"no_invoice_by": "Administrator", "no_invoice_reason": "Lost", "no_invoice_at": frappe.utils.now()},
        )
        frappe.db.commit()

        self._upload(self._second_file())

        after = self._expense(LATE)
        self.assertFalse(after.invoice_attachment)
        self.assertEqual(after.no_invoice_by, "Administrator")

    def test_a_file_of_only_repeats_with_a_new_bill_is_accepted(self):
        self._first_upload()
        repeats = self._file([self.data[0], self.late_line, self.data[2]])

        preview = self._post(cb.preview_cashbook_statement, repeats)
        self.assertFalse(preview["refused"])
        self._upload(repeats)

        self.assertTrue(self._expense(LATE).invoice_attachment)
        self.assertEqual(self._lines_of(LATE), 1)

    def test_a_file_of_only_repeats_with_nothing_new_is_still_refused(self):
        self._first_upload()
        with self.assertRaises(frappe.ValidationError) as caught:
            self._post(cb.confirm_cashbook_import, self._file(self.data[:3]))
        self.assertIn("Nothing in this file is new", str(caught.exception))

    def test_review_lists_the_expenses_that_will_get_a_bill(self):
        waiting = self._first_upload()

        preview = self._post(cb.preview_cashbook_statement, self._second_file())

        self.assertEqual(
            [(line["transfer_id"], line["expense_doctype"], line["expense"], line["bills"]) for line in preview["late_bills"]],
            [(LATE, waiting.doctype, waiting.name, 1)],
        )

    def test_review_does_not_list_an_expense_a_person_already_settled(self):
        waiting = self._first_upload()
        frappe.db.set_value(waiting.doctype, waiting.name, "invoice_attachment", "/private/files/by-hand.pdf")
        frappe.db.commit()

        preview = self._post(cb.preview_cashbook_statement, self._second_file())

        self.assertEqual(preview["late_bills"], [])


class TestALateBillThatFailsIsNamedInTheSummary(LateBillsCase):
    """Story 19: a bill that still fails is "named with its reason in the import summary", a late one too (code
    review S2). The Expense keeps waiting in the Cashbook tab."""

    def test_the_import_summary_names_the_late_bill_and_its_reason(self):
        waiting = self._first_upload()
        fetch = _fake_bills({(LATE, "1.jpeg"): BillRefused("the storage refused it (HTTP 403)")})

        second = self._upload(self._second_file(), fetch)["batch"]

        self.assertFalse(self._expense(LATE).invoice_attachment)
        self.assertIn(
            {"transfer_id": LATE, "expense": waiting.name, "reason": "Bill not copied: the storage refused it (HTTP 403)."},
            cb.get_cashbook_status(second)["bills_not_copied"],
        )
        self.assertFalse(cb.get_cashbook_status(second)["stopped"])
