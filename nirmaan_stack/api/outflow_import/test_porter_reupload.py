# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Re-uploading a Porter Statement, and Discarding an import (#1447, spec #1442, ADR-0032).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_porter_reupload

Each test uploads the synthetic statement through the real endpoint (`test_porter_import`), validates it
and creates it where the rule needs that (`test_porter_create`: Gemini and the download faked, the jobs
called directly), then uploads the SAME statement again, or a variant of it, or discards the import.

The storage apps' `File` hooks are stubbed: an upload never reaches a bucket, and a delete's call to
`delete_from_cloud` is recorded, not made.

⚠️ Every test removes what it made, through the purge helpers of the suites it builds on: every batch
uploaded under the test's filename goes, with its lines, invoices and their files.
"""

from contextlib import contextmanager
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import porter_discard
from nirmaan_stack.api.outflow_import.test_porter_create import PorterCreateCase
from nirmaan_stack.api.outflow_import.test_porter_import import (
    BATCH_DOCTYPE,
    FIXTURE,
    INVOICE_DOCTYPE,
    ROW_DOCTYPE,
    _fresh_fixture,
)
from nirmaan_stack.api.outflow_import.test_porter_validation import (
    PorterValidationCase,
    _no_bucket_upload,
    _pdf,
)
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD, OUTSIDER, _Users


class _SameStatement:
    """This run's statement again, as the test's first upload saw it, optionally edited."""

    def _statement_text(self) -> str:
        tag = self.numbers["29SS27A0900001"][7:12]
        crn = frappe.get_all(ROW_DOCTYPE, filters={"import_batch": self.batch}, pluck="transfer_id", limit=1)[0]
        return FIXTURE.read_text(encoding="utf-8").replace("A09000", f"A{tag}").replace(
            "CRN90000000", crn[:11]
        )

    def _without_line(self, text: str, crn_suffix: str) -> str:
        return "".join(line for line in text.splitlines(keepends=True) if f"{crn_suffix}," not in line[:20])

    def _assert_refused(self, content: bytes, *words: str) -> str:
        before = len(self.saved)
        with self.assertRaises(frappe.ValidationError) as caught:
            self._upload(content)
        frappe.db.rollback()
        message = str(caught.exception)
        for word in words:
            self.assertIn(word, message)
        self.assertEqual(len(self.saved), before, "nothing may be saved before a refusal")
        self.assertEqual(self._batches(), [self.batch])
        return message


@contextmanager
def _storage_deletes():
    """Record the storage apps' `File.on_trash` deletes instead of making them."""
    with patch("frappe_gcp_attachment.controller.delete_from_cloud") as gcs, patch(
        "frappe_s3_attachment.controller.delete_from_cloud"
    ) as s3:
        yield gcs, s3


# --- re-uploads --------------------------------------------------------------------------------------


class TestReuploadingACreatedImport(_SameStatement, PorterCreateCase):
    def setUp(self):
        super().setUp()
        self._validate()
        self._run_create()
        self.assertEqual(self._status()["state"], "Created")

    def test_its_invoices_are_left_out_counted_and_never_read_again_while_a_new_invoice_is_kept(self):
        text = self._statement_text()
        hyderabad = self.numbers["36SM27A0900004"]
        new_number = hyderabad[:7] + "ZZZZZ" + hyderabad[12:]
        crn = self._crn("010")[:11]
        new_crn = "CRN" + str(int(crn[3:]) + 1).zfill(8)
        reissued = []
        for line in text.splitlines(keepends=True):
            if hyderabad in line:
                line = line.replace(hyderabad, new_number).replace(crn, new_crn)
            reissued.append(line)
        self.enqueued.clear()

        result = self._upload("".join(reissued).encode())

        new_batch = result["batch"]
        self.assertNotEqual(new_batch, self.batch)
        self.assertEqual(frappe.db.get_value(BATCH_DOCTYPE, new_batch, "repeats_not_saved"), 9)
        self.assertEqual(result["repeats_not_saved"], 9)
        self.assertEqual([invoice["invoice_number"] for invoice in result["invoices"]], [new_number])
        self.assertEqual(result["orders"], 3)
        # The fare and the period are the new invoice's alone: 285 + 328, 15 to 22 Sep.
        self.assertEqual(result["fare_total"], 613.0)
        self.assertEqual((result["period_from"], result["period_to"]), ("2026-09-15", "2026-09-22"))
        # The created invoices still belong to the first import, untouched; only the new one is queued.
        for old, number in self.numbers.items():
            if old != "36SM27A0900004":
                invoice = frappe.db.get_value(
                    INVOICE_DOCTYPE, number, ["import_batch", "validation_status"], as_dict=True
                )
                self.assertEqual((invoice.import_batch, invoice.validation_status), (self.batch, "Passed"))
        self.assertEqual([job["batch"] for job in self.enqueued], [new_batch])
        self.assertEqual(
            frappe.get_all(INVOICE_DOCTYPE, filters={"import_batch": new_batch}, pluck="validation_status"),
            ["Queued"],
        )

    def test_a_file_holding_only_created_invoices_is_refused_and_nothing_is_saved(self):
        message = self._assert_refused(self._statement_text().encode(), "Not imported", self.batch)
        self.assertIn("All 4 invoices", message)

    def test_a_created_invoice_now_listing_different_orders_blocks_the_upload_naming_it(self):
        text = self._without_line(self._statement_text(), self._crn("005"))
        self._assert_refused(
            text.encode(),
            f"Invoice {self.numbers['29SS27A0900001']}",
            "different orders",
            self._crn("005"),
        )

    def test_discard_is_refused_once_anything_was_created(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            porter_discard.discard_porter_import(self.batch)
        frappe.db.rollback()
        self.assertIn("Rectify", str(caught.exception))
        self.assertTrue(frappe.db.exists(BATCH_DOCTYPE, self.batch))
        self.assertEqual(len(self._expenses()), 11)
        self.assertFalse(self._status()["discardable"])

    def test_an_accountant_is_refused_too_with_the_same_message(self):
        users = _Users()
        self.addCleanup(users.purge)
        frappe.set_user(users.make(ACCOUNTANT))
        with self.assertRaises(frappe.ValidationError) as caught:
            porter_discard.discard_porter_import(self.batch)
        frappe.db.rollback()
        frappe.set_user("Administrator")
        self.assertNotIsInstance(caught.exception, frappe.PermissionError)
        self.assertIn("Create has already created expenses from it", str(caught.exception))
        self.assertTrue(frappe.db.exists(BATCH_DOCTYPE, self.batch))
        self.assertEqual(len(self._expenses()), 11)


class TestReuploadingAnImportNeverCreated(_SameStatement, PorterValidationCase):
    def test_the_same_statement_is_blocked_with_open_it_or_discard_it(self):
        self._assert_refused(
            self._statement_text().encode(),
            f"Already uploaded in {self.batch}: open it or discard it",
        )

    def test_one_invoice_of_it_in_another_file_is_blocked_too(self):
        text = self._statement_text()
        bangalore = self.numbers["29SS27A0900001"]
        only = [line for line in text.splitlines(keepends=True) if line.startswith("crn,") or bangalore in line]
        self._assert_refused("".join(only).encode(), f"Already uploaded in {self.batch}", bangalore)


# --- Discard -----------------------------------------------------------------------------------------


class DiscardCase(_SameStatement, PorterValidationCase):
    def setUp(self):
        super().setUp()
        self.users = _Users()
        self.addCleanup(self.users.purge)

    def _discard(self, batch: str | None = None, user: str = "Administrator"):
        frappe.set_user(user)
        try:
            with _storage_deletes() as (gcs, _s3), _no_bucket_upload():
                result = porter_discard.discard_porter_import(batch or self.batch)
        finally:
            frappe.set_user("Administrator")
        self.cloud_deletes = gcs.call_count
        return result

    def _files(self, batch: str):
        invoices = frappe.get_all(INVOICE_DOCTYPE, filters={"import_batch": batch}, pluck="name")
        return frappe.get_all(
            "File",
            filters={"attached_to_doctype": INVOICE_DOCTYPE, "attached_to_name": ["in", invoices or [""]]},
            pluck="name",
        )


class TestDiscardingAValidatedImport(DiscardCase):
    def setUp(self):
        super().setUp()
        self._run_job()
        self.pdf_files = self._files(self.batch)
        self.assertEqual(len(self.pdf_files), 4)
        # Another import, uploaded beside it, that Discard must not touch.
        content, self.other_numbers = _fresh_fixture()
        self.other = self._upload(content)["batch"]

    def test_it_removes_the_batch_its_lines_its_invoices_and_their_pdfs(self):
        self.assertTrue(self._status()["discardable"])
        result = self._discard()
        self.assertEqual(result["batch"], self.batch)
        self.assertFalse(frappe.db.exists(BATCH_DOCTYPE, self.batch))
        self.assertEqual(frappe.db.count(ROW_DOCTYPE, {"import_batch": self.batch}), 0)
        self.assertEqual(frappe.db.count(INVOICE_DOCTYPE, {"import_batch": self.batch}), 0)
        for name in self.pdf_files:
            self.assertFalse(frappe.db.exists("File", name))
        # Each PDF was the only File of its bytes, so each went through the storage delete.
        self.assertEqual(self.cloud_deletes, 4)

    def test_and_nothing_else(self):
        self._discard()
        self.assertTrue(frappe.db.exists(BATCH_DOCTYPE, self.other))
        self.assertEqual(frappe.db.count(ROW_DOCTYPE, {"import_batch": self.other}), 12)
        self.assertEqual(
            sorted(frappe.get_all(INVOICE_DOCTYPE, filters={"import_batch": self.other}, pluck="name")),
            sorted(self.other_numbers.values()),
        )

    def test_a_pdf_whose_bytes_another_file_shares_keeps_its_bytes(self):
        from frappe.utils.file_manager import save_file

        bangalore = self.numbers["29SS27A0900001"]
        with _no_bucket_upload():
            twin = save_file(f"twin-{bangalore}.pdf", _pdf(bangalore), None, None, is_private=1)
        frappe.db.commit()
        self.addCleanup(lambda: (frappe.db.delete("File", {"name": twin.name}), frappe.db.commit()))

        self._discard()

        self.assertEqual(self.cloud_deletes, 3)
        self.assertTrue(frappe.db.exists("File", twin.name))
        self.assertTrue(frappe.get_doc("File", twin.name).get_content())

    def test_the_same_statement_can_be_uploaded_again_afterwards(self):
        text = self._statement_text()
        self._discard()
        again = self._upload(text.encode())
        self.assertEqual(again["orders"], 12)
        self.assertEqual(sorted(invoice["name"] for invoice in again["invoices"]), sorted(self.numbers.values()))

    def test_an_accountant_may_discard_it(self):
        self._discard(user=self.users.make(ACCOUNTANT))
        self.assertFalse(frappe.db.exists(BATCH_DOCTYPE, self.batch))
        self.assertEqual(frappe.db.count(INVOICE_DOCTYPE, {"import_batch": self.batch}), 0)

    def test_an_accountant_lead_may_discard_it(self):
        self._discard(user=self.users.make(ACCOUNTANT_LEAD))
        self.assertFalse(frappe.db.exists(BATCH_DOCTYPE, self.batch))

    def test_someone_without_outflow_access_is_refused(self):
        with self.assertRaises(frappe.PermissionError):
            self._discard(user=self.users.make(OUTSIDER))
        frappe.db.rollback()
        self.assertTrue(frappe.db.exists(BATCH_DOCTYPE, self.batch))


class TestDiscardingAnImportStuckValidating(DiscardCase):
    def test_an_import_whose_validation_never_finished_can_be_discarded(self):
        frappe.db.set_value(INVOICE_DOCTYPE, self.numbers["29SS27A0900001"], "validation_status", "Reading")
        frappe.db.commit()
        self.assertEqual(self._status()["state"], "Validating")
        self._discard()
        self.assertFalse(frappe.db.exists(BATCH_DOCTYPE, self.batch))

    def test_while_its_validation_job_is_still_queued_or_running_it_is_refused(self):
        with patch.object(porter_discard, "is_job_enqueued", side_effect=lambda job: job == f"porter-validate-{self.batch}"):
            with self.assertRaises(frappe.ValidationError) as caught:
                self._discard()
        frappe.db.rollback()
        self.assertIn("still", str(caught.exception))
        self.assertTrue(frappe.db.exists(BATCH_DOCTYPE, self.batch))

    def test_an_accountant_is_refused_while_a_job_of_it_runs(self):
        accountant = self.users.make(ACCOUNTANT)
        with patch.object(porter_discard, "is_job_enqueued", side_effect=lambda job: job == f"porter-create-{self.batch}"):
            with self.assertRaises(frappe.ValidationError) as caught:
                self._discard(user=accountant)
        frappe.db.rollback()
        self.assertNotIsInstance(caught.exception, frappe.PermissionError)
        self.assertIn("still being worked on", str(caught.exception))
        self.assertTrue(frappe.db.exists(BATCH_DOCTYPE, self.batch))

    def test_a_batch_that_is_not_a_porter_import_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            porter_discard.discard_porter_import("OFI-NO-SUCH-BATCH")
