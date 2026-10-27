# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Porter import validates itself against Porter's own invoices (#1444, spec #1442, ADR-0032).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_porter_validation

Each test uploads the synthetic statement through the real endpoint (`test_porter_import`), then runs the
validation job DIRECTLY, as the queue would, and asserts on what it leaves: each Porter Invoice's status,
message and what Gemini read, the stored PDF's File, and the import's derived state.

Only two boundaries are faked:
  * Gemini -- `GeminiExtractor._build_client` returns a canned client whose reply depends on which PDF it
    was handed, so the reply still runs through the real parse, pick and GST derivation;
  * the PDF download -- `porter_validation.fetch_invoice_pdf` returns canned PDF bytes naming the invoice.
The download helper's own refusals (not a PDF, too large) are tested one level down, against a canned
HTTP response.
"""

import io
import json
import threading
import time
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import porter as porter_api
from nirmaan_stack.api.outflow_import import porter_records
from nirmaan_stack.api.outflow_import import porter_validation
from nirmaan_stack.api.outflow_import.test_porter_import import (
    INVOICE_DOCTYPE,
    SOURCE,
    PorterImportCase,
    _fresh_fixture,
)
from nirmaan_stack.services.extraction.gemini import GeminiExtractor

_SETTINGS = {
    "enabled": True,
    "provider": "gemini",
    "auth_mode": "API Key",
    "gemini_model": "canned-model",
    "gemini_thinking_level": "low",
    "gemini_media_resolution": "high",
    "request_timeout_seconds": 90,
}


def _pdf(number: str) -> bytes:
    """A real one-page PDF titled with the invoice number (Frappe's File parses a PDF on insert)."""
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_metadata({"/Title": f"canned invoice {number}"})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


@contextmanager
def _no_bucket_upload():
    """The stored invoice PDF stays a real File row with its bytes on local disk, and never reaches a
    bucket: the storage apps' `File.after_insert` uploads are stubbed (CODING_STANDARDS: a test never
    puts a file in real storage). Hooks resolve by dotted path at call time, so patching the module
    attribute holds in the job's own threads too."""
    with patch("frappe_s3_attachment.controller.file_upload_to_s3"), patch(
        "frappe_gcp_attachment.controller.file_upload_to_gcs"
    ):
        yield


class _FakeModels:
    """Gemini's `models`, answering by WHICH invoice PDF it was handed."""

    def __init__(self, replies: dict, fail: set):
        self._replies = replies
        self._fail = fail
        self.calls = 0

    def generate_content(self, model, contents, config):
        self.calls += 1
        data = contents[0].inline_data.data.decode("latin-1")
        number = next(n for n in self._replies if n in data)
        if number in self._fail:
            raise RuntimeError("PERMISSION_DENIED: canned failure")
        return SimpleNamespace(text=json.dumps(self._replies[number]), candidates=[])


class PorterValidationCase(PorterImportCase):
    def setUp(self):
        super().setUp()
        content, self.numbers = _fresh_fixture()
        self.batch = self._upload(content)["batch"]
        self.invoices = {
            old: frappe.get_doc(INVOICE_DOCTYPE, new) for old, new in self.numbers.items()
        }
        # What each PDF says, agreeing with the statement (tax within the statement's rounding).
        self.replies = {
            invoice.name: {
                "invoice_id": invoice.name,
                "invoice_date": "2026-10-01",
                "supplier_gstin": invoice.porter_gstin,
                "receiver_gstin": invoice.customer_gstin,
                "net_amount": float(invoice.fare_total),
                **self._tax(invoice),
                "total_amount": float(invoice.fare_total) + float(invoice.tax_total),
            }
            for invoice in self.invoices.values()
        }
        self.gemini_fails = set()
        self.downloads = []

    @staticmethod
    def _tax(invoice) -> dict:
        tax = round(float(invoice.tax_total) - 0.01, 2)
        if invoice.porter_gstin[:2] == invoice.customer_gstin[:2]:
            return {"cgst_amount": tax / 2, "sgst_amount": tax / 2}
        return {"igst_amount": tax}

    def _download(self, url):
        self.downloads.append(url)
        number = url.rsplit("_", 1)[-1].removesuffix(".pdf")
        return _pdf(number)

    def _run_job(self, download=None):
        models = _FakeModels(self.replies, self.gemini_fails)
        with patch.object(porter_validation, "fetch_invoice_pdf", side_effect=download or self._download), \
                patch.object(porter_validation, "get_extraction_settings", return_value=_SETTINGS), \
                patch.object(GeminiExtractor, "_build_client", return_value=SimpleNamespace(models=models)), \
                _no_bucket_upload():
            porter_validation.validate_porter_import(self.batch, "Administrator")
        return models

    def _invoice(self, old_number: str):
        return frappe.get_doc(INVOICE_DOCTYPE, self.numbers[old_number])

    def _status(self):
        return porter_api.get_porter_status(self.batch)


class TestValidationStartsAtUpload(PorterValidationCase):
    def test_upload_starts_one_validation_job_de_duplicated_per_import(self):
        self.assertEqual(len(self.enqueued), 1)
        job = self.enqueued[0]
        self.assertEqual(job["job_id"], f"porter-validate-{self.batch}")
        self.assertTrue(job["deduplicate"])
        self.assertEqual(job["batch"], self.batch)

    def test_until_it_runs_the_import_is_validating_and_not_validated(self):
        self.assertEqual(self._status()["state"], "Validating")
        self.assertFalse(porter_records.is_validated(self.batch))


class TestEveryInvoiceAgrees(PorterValidationCase):
    def setUp(self):
        super().setUp()
        self._run_job()

    def test_every_invoice_passes_and_the_import_is_validated(self):
        status = self._status()
        self.assertEqual({i["validation_status"] for i in status["invoices"]}, {"Passed"})
        self.assertEqual(status["state"], "Validated")
        self.assertTrue(porter_records.is_validated(self.batch))

    def test_what_gemini_read_is_stored_next_to_the_statements_figures(self):
        bangalore = self._invoice("29SS27A0900001")
        self.assertEqual(bangalore.read_invoice_number, bangalore.invoice_number)
        self.assertEqual(str(bangalore.read_invoice_date), "2026-10-01")
        self.assertEqual(bangalore.read_supplier_gstin, "29AAATP0000A1Z1")
        self.assertEqual(bangalore.read_receiver_gstin, "29AAACN9999X1Z0")
        self.assertEqual(float(bangalore.read_fare), 3087.0)
        # CGST + SGST, added up by the shared GST derivation.
        self.assertAlmostEqual(float(bangalore.read_tax), 154.35, places=2)
        self.assertAlmostEqual(float(bangalore.tax_total), 154.36, places=2)
        ahmedabad = self._invoice("24SS27A0900002")
        self.assertAlmostEqual(float(ahmedabad.read_tax), 38.94, places=2)  # IGST alone

    def test_each_pdf_is_stored_once_as_a_private_file_on_its_invoice(self):
        self.assertEqual(len(self.downloads), 4)
        for invoice in self.invoices.values():
            files = frappe.get_all(
                "File",
                filters={"attached_to_doctype": INVOICE_DOCTYPE, "attached_to_name": invoice.name},
                fields=["file_url", "is_private", "attached_to_field"],
            )
            self.assertEqual(len(files), 1, invoice.name)
            self.assertEqual(files[0].is_private, 1)
            self.assertEqual(files[0].attached_to_field, "invoice_file")
            self.assertEqual(frappe.db.get_value(INVOICE_DOCTYPE, invoice.name, "invoice_file"), files[0].file_url)

    def test_import_history_shows_the_import_validated(self):
        from nirmaan_stack.api.outflow_import.review import list_imports

        listed = next(
            item for item in list_imports(sources=json.dumps([SOURCE]), month="2026-09")
            if item["name"] == self.batch
        )
        self.assertEqual(listed["status"], "Validated")

    def test_a_passed_invoice_cannot_be_retried(self):
        with self.assertRaises(frappe.ValidationError):
            porter_api.retry_porter_invoice(self.numbers["29SS27A0900001"])


class TestOneInvoiceDisagrees(PorterValidationCase):
    def setUp(self):
        super().setUp()
        self.hyderabad = self.numbers["36SM27A0900004"]
        statement_fare = float(self.invoices["36SM27A0900004"].fare_total)
        self.replies[self.hyderabad]["net_amount"] = statement_fare + 1.01  # Rs 1.01 out
        self._run_job()

    def test_it_fails_naming_the_invoice_and_the_fare(self):
        invoice = self._invoice("36SM27A0900004")
        self.assertEqual(invoice.validation_status, "Failed")
        self.assertRegex(
            invoice.validation_message,
            rf"^Invoice {self.hyderabad} disagrees with the statement\. Fare: invoice ₹[\d,]+\.\d\d, statement ₹[\d,]+\.\d\d\.$",
        )

    def test_the_others_still_pass_and_the_whole_import_fails(self):
        status = self._status()
        by_number = {i["invoice_number"]: i["validation_status"] for i in status["invoices"]}
        self.assertEqual(by_number.pop(self.hyderabad), "Failed")
        self.assertEqual(set(by_number.values()), {"Passed"})
        self.assertEqual(status["state"], "Validation failed")
        self.assertFalse(porter_records.is_validated(self.batch))

    def test_running_the_job_again_leaves_a_failed_invoice_failed(self):
        # Only Queued invoices are picked up: the one way back is Retry.
        self._run_job()
        self.assertEqual(self._invoice("36SM27A0900004").validation_status, "Failed")
        self.assertEqual(self._status()["state"], "Validation failed")

    def _retry(self):
        with patch.object(frappe, "enqueue", side_effect=lambda *a, **k: self.enqueued.append(k)):
            return porter_api.retry_porter_invoice(self.hyderabad)

    def test_a_failed_invoice_is_retried_and_the_import_is_checking_meanwhile(self):
        shown = next(i for i in self._status()["invoices"] if i["name"] == self.hyderabad)
        self.assertTrue(shown["can_retry"])

        status = self._retry()
        self.assertEqual(self._invoice("36SM27A0900004").validation_status, "Queued")
        self.assertEqual(status["state"], "Validating")
        self.assertEqual(status["progress"]["check"]["in_progress"], 1)
        self.assertEqual(status["progress"]["check"]["not_matching"], 0)
        self.assertEqual(self.enqueued[-1]["job_id"], f"porter-validate-{self.batch}-{self.hyderabad}")

    def test_a_retry_downloads_and_reads_the_pdf_again_and_passes_once_it_agrees(self):
        self._retry()
        self.replies[self.hyderabad]["net_amount"] = float(self.invoices["36SM27A0900004"].fare_total)
        self.downloads.clear()
        models = self._run_job()

        self.assertEqual(len(self.downloads), 1)
        self.assertEqual(models.calls, 1)
        invoice = self._invoice("36SM27A0900004")
        self.assertEqual((invoice.validation_status, invoice.validation_message), ("Passed", None))
        self.assertEqual(self._status()["state"], "Validated")
        files = frappe.get_all("File", filters={"attached_to_doctype": INVOICE_DOCTYPE, "attached_to_name": self.hyderabad}, pluck="file_url")
        self.assertEqual(files, [invoice.invoice_file])

    def test_a_retry_where_the_fare_still_disagrees_stays_failed(self):
        self._retry()
        self._run_job()
        invoice = self._invoice("36SM27A0900004")
        self.assertEqual(invoice.validation_status, "Failed")
        self.assertIn("Fare: invoice", invoice.validation_message)
        self.assertEqual(self._status()["state"], "Validation failed")


class TestOnlyTheFareAndTheDateDecide(PorterValidationCase):
    """#1559: a GSTIN, tax or invoice-number difference is a warning on a Passed invoice."""

    def _shown(self, old_number: str) -> dict:
        return next(i for i in self._status()["invoices"] if i["name"] == self.numbers[old_number])

    def test_a_tax_and_gstin_difference_passes_with_warnings_returned_with_the_import(self):
        hyderabad = self.numbers["36SM27A0900004"]
        self.replies[hyderabad]["igst_amount"] = 31.66  # statement Rs 30.65: Rs 1.01 out
        self.replies[hyderabad]["receiver_gstin"] = "36AAACN9999X1Z9"
        self._run_job()

        status = self._status()
        self.assertEqual(status["state"], "Validated")
        shown = self._shown("36SM27A0900004")
        self.assertEqual((shown["validation_status"], shown["validation_message"]), ("Passed", None))
        self.assertEqual(
            shown["warnings"],
            [
                {"figure": "Customer GSTIN", "statement": shown["customer_gstin"], "read": "36AAACN9999X1Z9"},
                {"figure": "Tax", "statement": "₹30.65", "read": "₹31.66"},
            ],
        )
        self.assertEqual(self._shown("29SS27A0900001")["warnings"], [])
        self.assertEqual(status["progress"]["check"]["passed"], 4)
        self.assertEqual(status["progress"]["check"]["passed_with_warnings"], 1)

    def test_a_tax_it_could_not_read_passes_with_a_warning(self):
        del self.replies[self.numbers["24SS27A0900002"]]["igst_amount"]
        self._run_job()
        shown = self._shown("24SS27A0900002")
        self.assertEqual(shown["validation_status"], "Passed")
        self.assertEqual(shown["warnings"], [{"figure": "Tax", "statement": "₹38.95", "read": None}])
        self.assertIsNone(shown["read"]["tax"])

    def test_an_invoice_dated_after_the_statement_plus_seven_days_fails(self):
        status = self._status()
        self.assertEqual(status["period_to"], "2026-09-30")
        self.assertEqual(status["invoice_date_window"], {"from": status["period_from"], "to": "2026-10-07"})
        self.replies[self.numbers["29SS27A0900001"]]["invoice_date"] = "2026-10-08"
        self._run_job()
        invoice = self._invoice("29SS27A0900001")
        self.assertEqual(invoice.validation_status, "Failed")
        self.assertIn("Invoice date: invoice 08-Oct-2026", invoice.validation_message)

    def test_a_fare_it_could_not_read_is_an_error_to_retry(self):
        ahmedabad = self.numbers["24SS27A0900002"]
        del self.replies[ahmedabad]["net_amount"]
        self._run_job()
        invoice = self._invoice("24SS27A0900002")
        self.assertEqual(invoice.validation_status, "Error")
        self.assertEqual(
            invoice.validation_message, f"Invoice {ahmedabad}: could not read the fare off the PDF. Retry it."
        )
        self.assertTrue(self._shown("24SS27A0900002")["can_retry"])


class TestAnErrorIsRetriedForThatInvoiceAlone(PorterValidationCase):
    def test_a_gemini_failure_is_an_error_that_a_retry_clears_by_downloading_and_reading_again(self):
        bangalore = self.numbers["29SS27A0900001"]
        self.gemini_fails.add(bangalore)
        self._run_job()

        failed = self._invoice("29SS27A0900001")
        self.assertEqual(failed.validation_status, "Error")
        self.assertIn(bangalore, failed.validation_message)
        self.assertIn("Retry", failed.validation_message)
        self.assertTrue(failed.invoice_file, "the PDF is kept for the retry")
        self.assertEqual(self._status()["state"], "Validation failed")
        self.assertTrue(next(i for i in self._status()["invoices"] if i["name"] == bangalore)["can_retry"])

        with patch.object(frappe, "enqueue", side_effect=lambda *a, **k: self.enqueued.append(k)):
            status = porter_api.retry_porter_invoice(bangalore)
        self.assertEqual(self._invoice("29SS27A0900001").validation_status, "Queued")
        self.assertEqual(status["state"], "Validating")
        self.assertEqual(len(self.enqueued), 2)
        self.assertTrue(self.enqueued[1]["deduplicate"])

        self.gemini_fails.clear()
        self.downloads.clear()
        models = self._run_job()
        self.assertEqual(self.downloads, [failed.invoice_link], "a retry downloads the PDF again")
        self.assertEqual(models.calls, 1, "only the retried invoice is read again")
        self.assertEqual(self._invoice("29SS27A0900001").validation_status, "Passed")
        self.assertEqual(self._status()["state"], "Validated")
        self.assertEqual(
            len(frappe.get_all("File", filters={"attached_to_doctype": INVOICE_DOCTYPE, "attached_to_name": bangalore})),
            1,
        )

    def test_a_retry_whose_link_no_longer_serves_the_pdf_reads_the_copy_kept(self):
        bangalore = self.numbers["29SS27A0900001"]
        self.gemini_fails.add(bangalore)
        self._run_job()
        kept = self._invoice("29SS27A0900001").invoice_file

        with patch.object(frappe, "enqueue"):
            porter_api.retry_porter_invoice(bangalore)
        self.gemini_fails.clear()

        def _gone(url):
            raise porter_validation.InvoiceDownloadError("the request failed (HTTPError)")

        self._run_job(download=_gone)
        invoice = self._invoice("29SS27A0900001")
        self.assertEqual(invoice.validation_status, "Passed")
        self.assertEqual(invoice.invoice_file, kept)

    def test_nothing_is_shown_as_read_before_gemini_has_read_it(self):
        shown = self._status()["invoices"][0]
        self.assertEqual(shown["validation_status"], "Queued")
        self.assertIsNone(shown["read"])

    def test_a_refused_download_is_an_error_and_stores_nothing(self):
        def _refuse(url):
            raise porter_validation.InvoiceDownloadError("what came back is not a PDF")

        self._run_job(download=_refuse)
        invoice = self._invoice("29SM27A0900003")
        self.assertEqual(invoice.validation_status, "Error")
        self.assertEqual(
            invoice.validation_message,
            f"Invoice {invoice.name}: the PDF could not be downloaded: what came back is not a PDF. Retry it.",
        )
        self.assertFalse(invoice.invoice_file)
        self.assertFalse(frappe.get_all("File", filters={"attached_to_doctype": INVOICE_DOCTYPE, "attached_to_name": invoice.name}))


class TestUpToThreeAtOnce(PorterValidationCase):
    def test_four_invoices_run_three_at_a_time(self):
        lock = threading.Lock()
        running = {"now": 0, "most": 0}

        def _slow_download(url):
            with lock:
                running["now"] += 1
                running["most"] = max(running["most"], running["now"])
            time.sleep(0.5)
            with lock:
                running["now"] -= 1
            return self._download(url)

        self._run_job(download=_slow_download)
        self.assertEqual(running["most"], 3)
        self.assertEqual(self._status()["state"], "Validated")


class TestTheDownloadHelper(PorterValidationCase):
    """`fetch_invoice_pdf` itself, against a canned HTTP response (its transport is faked, not it)."""

    class _Response:
        def __init__(self, chunks, status=200):
            self._chunks = chunks
            self.status_code = status

        def raise_for_status(self):
            if self.status_code >= 400:
                import requests

                raise requests.HTTPError(f"{self.status_code}")

        def iter_content(self, chunk_size):
            yield from self._chunks

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def _fetch(self, response, url="https://porter-invoices.example.test/x.pdf"):
        with patch.object(porter_validation.requests, "get", return_value=response) as get:
            result = porter_validation.fetch_invoice_pdf(url)
        return result, get

    def test_a_pdf_comes_back_whole_with_a_timeout_set(self):
        content, get = self._fetch(self._Response([b"%PDF-1.7 ", b"rest"]))
        self.assertEqual(content, b"%PDF-1.7 rest")
        self.assertTrue(get.call_args.kwargs["timeout"])
        self.assertTrue(get.call_args.kwargs["stream"])

    def test_something_that_is_not_a_pdf_is_refused(self):
        with self.assertRaises(porter_validation.InvoiceDownloadError) as caught:
            self._fetch(self._Response([b"<html>login</html>"]))
        self.assertIn("not a PDF", str(caught.exception))

    def test_a_download_over_the_cap_is_refused(self):
        big = [b"%PDF-" + b"x" * (porter_validation.MAX_INVOICE_PDF_BYTES)]
        with self.assertRaises(porter_validation.InvoiceDownloadError) as caught:
            self._fetch(self._Response(big))
        self.assertIn("larger than", str(caught.exception))

    def test_an_http_error_is_refused(self):
        with self.assertRaises(porter_validation.InvoiceDownloadError):
            self._fetch(self._Response([b""], status=404))

    def test_a_link_that_is_not_https_is_refused_without_a_request(self):
        with patch.object(porter_validation.requests, "get") as get:
            with self.assertRaises(porter_validation.InvoiceDownloadError):
                porter_validation.fetch_invoice_pdf("file:///etc/passwd")
        get.assert_not_called()

    def test_an_oversized_download_through_the_job_is_an_error_on_its_invoice(self):
        big = self._Response([b"%PDF-" + b"x" * porter_validation.MAX_INVOICE_PDF_BYTES])
        with patch.object(porter_validation.requests, "get", return_value=big), \
                patch.object(porter_validation, "get_extraction_settings", return_value=_SETTINGS):
            porter_validation.validate_porter_import(self.batch, "Administrator")
        invoice = self._invoice("29SS27A0900001")
        self.assertEqual(invoice.validation_status, "Error")
        self.assertIn("larger than", invoice.validation_message)
