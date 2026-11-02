# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Each wallet spend's bills become its Expense's invoice (#1591, spec #1585 "The bill downloader",
"Merging", "Where downloads run").

Seam 1: the Cashbook job run inline on the real-file fixture (`cashbook_statement.xlsx`), with the bill
downloader (`cashbook._fetch_bill`) replaced by a fake that answers from made-up files. No test touches the
network. The fixture's Txn Ids are given a per-test suffix before staging: the dev DB is a copy of
production, which already holds the real ones.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_bills
"""

import dataclasses
import io
from pathlib import Path
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from PIL import Image
from pypdf import PdfReader, PdfWriter

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.test_cashbook_import import FIXTURE, _purge
from nirmaan_stack.api.outflow_import.test_cashbook_statement_upload import _post
from nirmaan_stack.services.outflow_import.bill_download import BillFile, BillRefused, download_bill
from nirmaan_stack.services.outflow_import.parser import parse_statement

STATEMENT = FIXTURE.parent / "cashbook_statement.xlsx"
ONE_LINK = "OBO1792735526469DYMYOU"  # 1.jpeg
FOUR_LINKS = "OBO1792735606960QUTNST"  # 1.jpeg, 2.pdf, 3.jpeg, 4.pdf
NO_LINK = "OBO17927503221100FHX45"
# Flight tickets: a Non Project Expense, 1.jpeg. (#1594: the Hotel stay ADJFUL is now a Paired wallet refund.)
NON_PROJECT_ONE_LINK = "OBO9000000000004PARTSP"  # its one bill is 1.pdf


def _image(width: int, height: int, fmt: str) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(out, format=fmt)
    return out.getvalue()


def _pdf(*sizes: tuple[int, int]) -> bytes:
    writer = PdfWriter()
    for width, height in sizes:
        writer.add_blank_page(width=width, height=height)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


PORTRAIT_JPEG = _image(300, 400, "JPEG")
LANDSCAPE_JPEG = _image(400, 300, "JPEG")
TWO_PAGE_PDF = _pdf((200, 201), (200, 202))
ONE_PAGE_PDF = _pdf((300, 301))
A4_PORTRAIT = (595, 842)
A4_LANDSCAPE = (842, 595)


def _fake_bills(overrides: dict | None = None):
    """A fake downloader. A link is answered by `overrides[(txn id in its path, file name)]` when present, else by its
    file name: 1.jpeg portrait, 3.jpeg landscape, 1.png, 2.pdf two pages, 4.pdf one page, 1.pdf one page."""
    by_name = {
        "1.jpeg": BillFile(PORTRAIT_JPEG, "jpeg"),
        "3.jpeg": BillFile(LANDSCAPE_JPEG, "jpeg"),
        "1.png": BillFile(_image(10, 10, "PNG"), "png"),
        "2.pdf": BillFile(TWO_PAGE_PDF, "pdf"),
        "4.pdf": BillFile(ONE_PAGE_PDF, "pdf"),
        "1.pdf": BillFile(ONE_PAGE_PDF, "pdf"),
    }
    calls = []

    def fetch(url: str):
        calls.append(url)
        txn, name = url.split("?")[0].rsplit("/", 2)[-2:]
        answer = (overrides or {}).get((txn, name), by_name[name])
        return answer(url) if callable(answer) else answer

    fetch.calls = calls
    return fetch


class CashbookBillsCase(FrappeTestCase):
    def setUp(self):
        super().setUp()
        self.suffix = "T" + frappe.generate_hash(length=6).upper()
        parsed = parse_statement(STATEMENT.read_bytes(), source="Cashbook")
        self.parsed = dataclasses.replace(
            parsed,
            rows=[dataclasses.replace(r, transfer_id=r.transfer_id + self.suffix) for r in parsed.rows],
        )
        self.batch = cb._stage(
            self.parsed,
            cb._build_plan(self.parsed),
            file_url="/private/files/test-statement.xlsx",
            filename="test-statement.xlsx",
            user="Administrator",
        ).name
        frappe.db.commit()
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        expenses = [(dt, name) for dt, name in self._targets().values()]
        for doctype, name in expenses:
            frappe.db.delete("File", {"attached_to_doctype": doctype, "attached_to_name": name})
        # #1595: an open Collect payment's bill is stored on its line.
        frappe.db.delete("File", {"attached_to_doctype": "Outflow Import Row", "attached_to_name": ["in", self._lines()]})
        frappe.db.commit()
        _purge(self.batch)

    def _lines(self) -> list:
        return frappe.get_all("Outflow Import Row", filters={"import_batch": self.batch}, pluck="name") or [""]

    def _targets(self) -> dict:
        return {
            r.transfer_id[: -len(self.suffix)]: (r.suggested_doctype, r.suggested_name)
            for r in frappe.get_all(
                "Outflow Import Row",
                filters={"import_batch": self.batch, "row_status": "Settled"},
                fields=["transfer_id", "suggested_doctype", "suggested_name"],
            )
        }

    def _run(self, fetch=None):
        fetch = fetch or _fake_bills()
        with patch.object(cb, "_fetch_bill", fetch):
            cb._cashbook_worker(self.batch, "Administrator")
        return fetch

    def _expense(self, txn: str):
        doctype, name = self._targets()[txn]
        return frappe.get_doc(doctype, name)

    def _invoice_bytes(self, expense) -> bytes:
        file = frappe.get_doc("File", {"file_url": expense.invoice_attachment})
        return file.get_content()

    def _files_of(self, expense) -> list:
        return frappe.get_all(
            "File",
            filters={"attached_to_doctype": expense.doctype, "attached_to_name": expense.name},
            fields=["name", "file_url", "is_private", "attached_to_field"],
        )


class TestBillsBecomeTheInvoice(CashbookBillsCase):
    def test_a_spend_with_one_link_gets_that_file_as_its_invoice(self):
        self._run()
        expense = self._expense(ONE_LINK)
        self.assertTrue(expense.invoice_attachment)
        self.assertEqual(self._invoice_bytes(expense), PORTRAIT_JPEG)

    def test_a_spend_with_four_mixed_links_gets_one_pdf_with_every_page_in_order(self):
        self._run()
        pages = PdfReader(io.BytesIO(self._invoice_bytes(self._expense(FOUR_LINKS)))).pages
        sizes = [(round(float(p.mediabox.width)), round(float(p.mediabox.height))) for p in pages]
        self.assertEqual(sizes, [A4_PORTRAIT, (200, 201), (200, 202), A4_LANDSCAPE, (300, 301)])

    def test_a_spend_with_no_link_gets_no_invoice(self):
        self._run()
        expense = self._expense(NO_LINK)
        self.assertFalse(expense.invoice_attachment)
        self.assertEqual(self._files_of(expense), [])

    def test_the_bill_is_one_private_file_attached_to_its_expense_as_the_invoice(self):
        self._run()
        expense = self._expense(FOUR_LINKS)
        files = self._files_of(expense)
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].file_url, expense.invoice_attachment)
        self.assertEqual(files[0].is_private, 1)
        self.assertEqual(files[0].attached_to_field, "invoice_attachment")

    def test_the_summary_names_no_line_when_every_bill_was_copied(self):
        self._run()
        self.assertEqual(cb.get_cashbook_status(self.batch)["bills_not_copied"], [])


class TestABillThatCannotBeCopied(CashbookBillsCase):
    def test_a_403_leaves_the_expense_with_no_invoice_and_the_summary_names_the_line_and_reason(self):
        fetch = _fake_bills({(FOUR_LINKS, "2.pdf"): BillRefused("the storage refused it (HTTP 403)")})
        before = frappe.db.count("File")
        self._run(fetch)

        expense = self._expense(FOUR_LINKS)
        self.assertFalse(expense.invoice_attachment)
        self.assertEqual(self._files_of(expense), [])
        self.assertEqual(
            cb.get_cashbook_status(self.batch)["bills_not_copied"],
            [
                {
                    "transfer_id": FOUR_LINKS + self.suffix,
                    "expense": expense.name,
                    "reason": "Bill 2 of 4 not copied: the storage refused it (HTTP 403).",
                }
            ],
        )
        # The other lines are unaffected: every spend is created, and the one-link spend has its invoice.
        status = cb.get_cashbook_status(self.batch)
        self.assertEqual((status["failed"], status["pending"]), (0, 0))
        self.assertTrue(self._expense(ONE_LINK).invoice_attachment)
        # Nothing is stored for the refused spend (the other spends' copies are the only new Files).
        self.assertEqual(frappe.db.count("File") - before, self._copied_files())

    def _copied_files(self) -> int:
        """Every bill copied: onto an Expense, or onto an open Collect payment's line (#1595)."""
        return sum(
            1
            for doctype, name in self._targets().values()
            if frappe.db.exists("File", {"attached_to_doctype": doctype, "attached_to_name": name})
        ) + frappe.db.count("File", {"attached_to_doctype": "Outflow Import Row", "attached_to_name": ["in", self._lines()]})

    def test_a_link_the_guard_refuses_is_never_fetched_and_is_named(self):
        transport_calls = []

        def guarded(url):
            def transport(*args, **kwargs):
                transport_calls.append(args)
                raise AssertionError("the guard let a refused link through")

            return download_bill(url.replace("storage.googleapis.com", "evil.example.com"), get=transport)

        self._run(_fake_bills({(ONE_LINK, "1.jpeg"): guarded}))
        expense = self._expense(ONE_LINK)
        self.assertFalse(expense.invoice_attachment)
        self.assertEqual(transport_calls, [])
        self.assertEqual(
            [line["reason"] for line in cb.get_cashbook_status(self.batch)["bills_not_copied"]],
            ["Bill not copied: the link is not on the wallet's bill storage."],
        )

    def test_a_downloader_that_raises_does_not_stop_the_import(self):
        def broken(url):
            raise RuntimeError("boom")

        self._run(_fake_bills({(ONE_LINK, "1.jpeg"): broken}))
        status = cb.get_cashbook_status(self.batch)
        self.assertEqual((status["failed"], status["pending"]), (0, 0))
        self.assertFalse(self._expense(ONE_LINK).invoice_attachment)
        self.assertTrue(self._expense(FOUR_LINKS).invoice_attachment)
        self.assertEqual(
            [line["reason"] for line in status["bills_not_copied"]],
            ["Bill not copied: the bills could not be stored."],
        )


class TestAPersonGotThereFirst(CashbookBillsCase):
    """Between step 1 (the Expense is created and committed) and step 3 (the attach), a person may attach
    an invoice or mark the spend No invoice. The job then leaves the Expense as they set it."""

    def _person_acts_during_the_download(self, txn: str, values: dict, bill: str = "1.jpeg"):
        def during(url):
            doctype, name = self._targets()[txn]
            frappe.db.set_value(doctype, name, values, update_modified=False)
            frappe.db.commit()
            return BillFile(PORTRAIT_JPEG, "jpeg")

        return _fake_bills({(txn, bill): during})

    def test_an_invoice_attached_meanwhile_is_left_and_the_copy_discarded(self):
        before = frappe.db.count("File", {"attached_to_doctype": ["is", "not set"]})
        self._run(self._person_acts_during_the_download(ONE_LINK, {"invoice_attachment": "/private/files/theirs.pdf"}))
        expense = self._expense(ONE_LINK)
        self.assertEqual(expense.invoice_attachment, "/private/files/theirs.pdf")
        self.assertEqual(self._files_of(expense), [])
        self.assertEqual(frappe.db.count("File", {"attached_to_doctype": ["is", "not set"]}), before)

    def test_a_spend_marked_no_invoice_meanwhile_gets_no_invoice(self):
        self._run(
            self._person_acts_during_the_download(
                NON_PROJECT_ONE_LINK, {"no_invoice_by": "Administrator", "no_invoice_reason": "Lost"}, bill="1.pdf"
            )
        )
        expense = self._expense(NON_PROJECT_ONE_LINK)
        self.assertEqual(expense.doctype, "Non Project Expenses")
        self.assertFalse(expense.invoice_attachment)
        self.assertEqual(self._files_of(expense), [])


class TestReviewShowsTheInvoiceCounts(FrappeTestCase):
    def test_the_preview_counts_one_file_merged_and_will_wait(self):
        # The sample's 5 spends: 2 with one bill, 1 with two, 2 with none.
        payload = _post(cb.preview_cashbook_statement, FIXTURE.read_bytes(), FIXTURE.name)
        self.assertEqual(payload["invoices"], {"one_file": 2, "merged": 1, "waiting": 2})
