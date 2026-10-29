# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Credit Card Statement import, through its own endpoints (#1566, spec #1565, ADR-0039).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_card_import

Drives `upload_card_statement` with a real `werkzeug` `FileStorage` holding a PDF, as the endpoint receives
it, and asserts on the records it leaves: the batch, its lines and its Credit Card Statement. The PDF is
built from the fixture text (`services/outflow_import/tests/card_pdf_builder`), with the holder and every
SerNo made unique to the test, so nothing a previous run left behind collides. The stored PDF is a real
File on local disk; the storage apps' bucket upload is stubbed.

⚠️ Every test removes everything it made: lines, statements, batches, Files, users.
"""

import io
import os
import re
from pathlib import Path
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from werkzeug.datastructures import FileStorage, MultiDict

from nirmaan_stack.api.outflow_import import card_import
from nirmaan_stack.api.outflow_import.test_porter_reupload import _storage_deletes
from nirmaan_stack.api.outflow_import.test_porter_validation import _no_bucket_upload
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD, OUTSIDER, _Users
from nirmaan_stack.services.outflow_import.card_memory import MEMORY_DOCTYPE
from nirmaan_stack.services.outflow_import.card_pdf import statement_text
from nirmaan_stack.services.outflow_import.card_statement import read_card_statement
from nirmaan_stack.services.outflow_import.sources import CARD_STATEMENT_SOURCE
from nirmaan_stack.services.outflow_import.tests.card_pdf_builder import pdf_from_text

FIXTURE = (
    Path(frappe.get_app_path("nirmaan_stack"))
    / "services"
    / "outflow_import"
    / "tests"
    / "fixtures"
    / "icici_card_statement.txt"
)
BATCH_DOCTYPE = "Outflow Import Batch"
ROW_DOCTYPE = "Outflow Import Row"
STATEMENT_DOCTYPE = "Credit Card Statement"
SOURCE = CARD_STATEMENT_SOURCE
_LINE_START = re.compile(r"^(\d{2}/\d{2}/\d{4}) (\d{11}) ", re.MULTILINE)


def purge_records(doctype: str, names: list[str]) -> None:
    """Discard's delete loop, for a test: the records' Version and Comment rows, then the records. Raw, one
    scope, committed; a failure is rolled back and reported, never left to strand the next scope."""
    if not names:
        return
    try:
        frappe.db.delete("Version", {"ref_doctype": doctype, "docname": ["in", names]})
        frappe.db.delete("Comment", {"reference_doctype": doctype, "reference_name": ["in", names]})
        frappe.db.delete(doctype, {"name": ["in", names]})
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        print(f"card test purge: could not delete {doctype} {', '.join(names[:3])}")


def _purge(holder: str) -> None:
    """Roll back first (a refused upload may have aborted the transaction), then delete by scope."""
    frappe.db.rollback()
    for statement in frappe.get_all(STATEMENT_DOCTYPE, filters={"holder": holder}, fields=["name", "import_batch"]):
        try:
            for file in frappe.get_all(
                "File",
                filters={"attached_to_doctype": STATEMENT_DOCTYPE, "attached_to_name": statement.name},
                fields=["name", "file_url"],
            ):
                path = frappe.get_site_path(*(file.file_url or "").lstrip("/").split("/"))
                if (file.file_url or "").startswith("/private/files/") and os.path.exists(path):
                    os.remove(path)
                frappe.db.delete("File", {"name": file.name})
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            print(f"card test purge: could not delete the files of {statement.name}")
        rows = frappe.get_all(ROW_DOCTYPE, filters={"import_batch": statement.import_batch}, pluck="name")
        purge_records(ROW_DOCTYPE, rows)
        purge_records(STATEMENT_DOCTYPE, [statement.name])
        purge_records(BATCH_DOCTYPE, [statement.import_batch])


def _fixture_merchants() -> list[str]:
    text = FIXTURE.read_text(encoding="utf-8")
    return sorted({line.merchant_key for line in read_card_statement(text).lines})


def _forget_fixture_merchants(case) -> None:
    """Clear the merchant memory of every fixture merchant for this test, and restore it afterwards."""
    merchants = _fixture_merchants()
    kept = frappe.get_all(MEMORY_DOCTYPE, filters={"name": ["in", merchants]}, fields=["*"])

    def _clear():
        frappe.db.delete(MEMORY_DOCTYPE, {"name": ["in", merchants]})
        frappe.db.commit()

    def _restore():
        frappe.db.rollback()
        try:
            _clear()
            for row in kept:
                frappe.get_doc({**row, "doctype": MEMORY_DOCTYPE}).db_insert()
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            print("card test purge: could not restore the merchant memory")

    _clear()
    case.addCleanup(_restore)


class CardImportCase(FrappeTestCase):
    def setUp(self):
        super().setUp()
        tag = frappe.generate_hash(length=6).upper()
        self.holder = f"TEST HOLDER {tag}"
        self.serno_base = int("9" + "".join(str(int(c, 16) % 10) for c in frappe.generate_hash(length=6))) * 10_000
        self.addCleanup(_purge, self.holder)
        self.users = _Users()
        self.addCleanup(self.users.purge)
        self.enqueued = []
        # Create and an Expense edit remember a type per merchant (#1569): the fixture's merchants start
        # with no memory, and whatever was there before is put back.
        _forget_fixture_merchants(self)

    def _text(self, *, serno_base: int | None = None, holder: str | None = None) -> str:
        """The fixture with this test's holder and SerNos (each line's own, kept distinct)."""
        base = serno_base if serno_base is not None else self.serno_base
        counter = iter(range(1, 1000))
        text = FIXTURE.read_text(encoding="utf-8").replace("ARJUN TESTHOLDER", holder or self.holder)
        return _LINE_START.sub(lambda m: f"{m.group(1)} {base + next(counter):011d} ", text)

    def _upload(
        self,
        content: bytes,
        filename: str = "card-statement.pdf",
        user: str = "Administrator",
        password: str | None = None,
    ):
        class _Request:
            files = MultiDict({"file": FileStorage(stream=io.BytesIO(content), filename=filename)})
            host = None  # the stored File's URL is built without a request host

        previous_request = getattr(frappe.local, "request", None)
        previous_form = frappe.local.form_dict
        frappe.set_user(user)
        frappe.local.request = _Request()
        # The multipart form's text field, as `make_form_dict` puts it beside the file.
        frappe.local.form_dict = frappe._dict({"password": password} if password is not None else {})
        try:
            # The type suggestion job is RECORDED, never queued: the Redis queue is shared (#1569).
            with _no_bucket_upload(), patch.object(frappe, "enqueue", side_effect=lambda *a, **kw: self.enqueued.append(kw)):
                return card_import.upload_card_statement()
        finally:
            frappe.local.request = previous_request
            self.form_after_upload = frappe.local.form_dict
            frappe.local.form_dict = previous_form
            frappe.set_user("Administrator")

    def _statements(self):
        return frappe.get_all(STATEMENT_DOCTYPE, filters={"holder": self.holder}, fields=["*"])

    def _rows(self, batch: str):
        return frappe.get_all(ROW_DOCTYPE, filters={"import_batch": batch}, fields=["*"], order_by="transfer_id asc")


class TestUploadingAStatement(CardImportCase):
    def setUp(self):
        super().setUp()
        self.result = self._upload(pdf_from_text(self._text()))
        self.batch = self.result["batch"]

    def test_the_batch_is_a_card_import_over_the_billing_period(self):
        batch = frappe.get_doc(BATCH_DOCTYPE, self.batch)
        self.assertEqual(batch.source, SOURCE)
        self.assertEqual(str(batch.period_from), "2026-09-02")
        self.assertEqual(str(batch.period_to), "2026-10-01")
        self.assertEqual(batch.original_filename, "card-statement.pdf")
        # The spends: what the card paid out.
        self.assertEqual(float(batch.gross_amount), 137584.99)

    def test_a_credit_card_statement_holds_the_header_the_totals_and_the_batch(self):
        [statement] = self._statements()
        self.assertEqual(statement.company, "STRATOS INFRA TECHNOLOGIES PVT LTD")
        self.assertEqual(str(statement.statement_date), "2026-10-01")
        self.assertEqual((str(statement.period_from), str(statement.period_to)), ("2026-09-02", "2026-10-01"))
        self.assertEqual(float(statement.previous_balance), 224166.02)
        self.assertEqual(float(statement.purchases_charges), 137584.99)
        self.assertEqual(float(statement.cash_advances), 0)
        self.assertEqual(float(statement.payments_credits), 276821.73)
        self.assertEqual(float(statement.total_amount_due), 84929.28)
        self.assertEqual(statement.import_batch, self.batch)

    def test_the_pdf_is_one_private_file_on_the_statement(self):
        [statement] = self._statements()
        files = frappe.get_all(
            "File",
            filters={"attached_to_doctype": STATEMENT_DOCTYPE, "attached_to_name": statement.name},
            fields=["file_url", "is_private", "attached_to_field"],
        )
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].is_private, 1)
        self.assertEqual(files[0].attached_to_field, "statement_file")
        self.assertEqual(statement.statement_file, files[0].file_url)
        self.assertEqual(frappe.db.count("File", {"attached_to_doctype": BATCH_DOCTYPE, "attached_to_name": self.batch}), 0)

    def test_every_line_is_staged_spends_waiting_for_create_and_credits_sorted(self):
        rows = self._rows(self.batch)
        self.assertEqual(len(rows), 47)
        self.assertEqual({row.source for row in rows}, {SOURCE})
        spends = [row for row in rows if row.direction == "Debit"]
        credits = [row for row in rows if row.direction == "Credit"]
        self.assertEqual((len(spends), len(credits)), (40, 7))
        self.assertEqual({row.row_status for row in spends}, {"Pending match run"})
        self.assertEqual({row.match_basis for row in spends}, {"card statement"})
        self.assertEqual({row.suggested_doctype for row in spends}, {"Non Project Expenses"})
        # Sorted at upload (#1567): six skipped by rule, the unpaired MakeMyTrip credit open.
        self.assertEqual(sorted(row.row_status for row in credits), ["Mismatched"] + ["Skipped"] * 6)

    def test_a_line_keeps_its_date_amount_details_and_reference(self):
        row = next(row for row in self._rows(self.batch) if row.remarks == "PARK RESIDENCY Cochin IN")
        self.assertEqual(str(row.added_on)[:10], "2026-09-23")
        self.assertEqual(float(row.amount), 1933.0)
        self.assertEqual(row.status_raw, "SUCCESS")
        self.assertEqual(row.settlement_reference, f"PARK RESIDENCY Cochin IN - {row.transfer_id}")

    def test_review_shows_the_header_the_totals_and_every_line(self):
        review = card_import.get_card_import(self.batch)
        self.assertEqual(review["holder"], self.holder)
        self.assertEqual(review["company"], "STRATOS INFRA TECHNOLOGIES PVT LTD")
        self.assertEqual(review["totals"]["purchases_charges"], 137584.99)
        self.assertEqual(review["totals"]["total_amount_due"], 84929.28)
        self.assertEqual(review["spends"], 40)
        self.assertEqual(review["credits"], 7)
        self.assertEqual(len(review["lines"]), 47)
        self.assertTrue(review["discardable"])
        first = review["lines"][0]
        self.assertEqual(first["date"], "2026-09-11")
        self.assertEqual(first["details"], "transaction cashback")
        self.assertTrue(first["is_credit"])

    def test_import_history_lists_it_by_holder_and_period(self):
        from nirmaan_stack.api.outflow_import.review import list_imports

        [row] = [row for row in list_imports(month="2026-09") if row["name"] == self.batch]
        self.assertEqual(row["source"], SOURCE)
        self.assertEqual(row["card_holder"], self.holder)
        self.assertEqual((str(row["period_from"]), str(row["period_to"])), ("2026-09-02", "2026-10-01"))


class TestUploadingALockedStatement(CardImportCase):
    """A password-locked PDF opened with the password typed on Upload (ADR-0039 Amendment A)."""

    PASSWORD = "Pdf-Pass-4821"

    def setUp(self):
        super().setUp()
        self.result = self._upload(pdf_from_text(self._text(), password=self.PASSWORD), password=self.PASSWORD)
        self.batch = self.result["batch"]

    def test_the_right_password_stages_the_whole_statement(self):
        self.assertEqual(len(self._rows(self.batch)), 47)
        [statement] = self._statements()
        self.assertEqual(statement.import_batch, self.batch)

    def test_the_stored_pdf_opens_without_a_password(self):
        from pypdf import PdfReader

        [statement] = self._statements()
        path = frappe.get_site_path(*statement.statement_file.lstrip("/").split("/"))
        with open(path, "rb") as stored:
            content = stored.read()
        self.assertFalse(PdfReader(io.BytesIO(content)).is_encrypted)
        self.assertEqual(read_card_statement(statement_text(content)).holder, self.holder)

    def test_the_password_is_taken_out_of_the_request(self):
        self.assertNotIn("password", self.form_after_upload)

    def test_the_password_is_kept_nowhere(self):
        [statement] = self._statements()
        records = [
            frappe.get_doc(BATCH_DOCTYPE, self.batch).as_dict(),
            frappe.get_doc(STATEMENT_DOCTYPE, statement.name).as_dict(),
            *frappe.get_all("File", filters={"attached_to_name": statement.name}, fields=["*"]),
            *self._rows(self.batch),
        ]
        for record in records:
            self.assertNotIn(self.PASSWORD, frappe.as_json(record))
        self.assertNotIn(self.PASSWORD, frappe.as_json(self.result))


class TestCardLinesAreNotBankLines(CardImportCase):
    def test_total_unreconciled_outflow_does_not_move_on_upload(self):
        """The spends wait for the card's own Create. The one unpaired credit (MakeMyTrip ₹801.50) is open
        work on the main table (#1567, README ruling 4), so Unreconciled Inflow gains exactly it."""
        from nirmaan_stack.api.outflow_import.review import not_matched_totals

        before = not_matched_totals()
        self._upload(pdf_from_text(self._text()))
        after = not_matched_totals()
        self.assertEqual(after["outflow"], before["outflow"])
        self.assertEqual(after["inflow"]["rows"], before["inflow"]["rows"] + 1)
        self.assertAlmostEqual(after["inflow"]["amount"], before["inflow"]["amount"] + 801.50, places=2)


class TestRefusalsSaveNothing(CardImportCase):
    def _assert_refused(
        self, content: bytes, *words: str, filename: str = "card-statement.pdf", password: str | None = None
    ):
        files_before = frappe.db.count("File", {"file_name": filename})
        with self.assertRaises(frappe.ValidationError) as caught:
            self._upload(content, filename=filename, password=password)
        for word in words:
            self.assertIn(word, str(caught.exception))
        frappe.db.rollback()
        self.assertEqual(self._statements(), [])
        self.assertEqual(frappe.db.count("File", {"file_name": filename}), files_before)

    def test_a_password_locked_pdf_without_its_password(self):
        self._assert_refused(
            pdf_from_text(self._text(), password="secret"),
            "This PDF is password-locked. Enter its password and upload again.",
        )

    def test_a_password_locked_pdf_with_a_wrong_password(self):
        self._assert_refused(
            pdf_from_text(self._text(), password="secret"),
            "That password did not open this PDF. Check it and upload again.",
            password="not-it",
        )

    def test_a_file_that_is_not_a_pdf(self):
        self._assert_refused(self._text().encode(), ".pdf", filename="card-statement.csv")

    def test_a_statement_of_another_company(self):
        text = self._text().replace("STRATOS INFRA TECHNOLOGIES PVT LTD\nFLAT", "ACME TRADERS PVT LTD\nFLAT")
        self._assert_refused(pdf_from_text(text), "ACME TRADERS PVT LTD", "Stratos Infra Technologies")

    def test_lines_that_do_not_add_up_to_the_statement_totals(self):
        text = self._text().replace("PARK RESIDENCY Cochin IN 0 1,933.00", "PARK RESIDENCY Cochin IN 0 1,934.00")
        self._assert_refused(pdf_from_text(text), "₹1,37,585.99", "₹1,37,584.99")

    def test_a_non_zero_cash_advance(self):
        text = self._text().replace("Á1,37,584.99 Á0.00", "Á1,37,584.99 Á100.00")
        self._assert_refused(pdf_from_text(text), "Cash Advances")

    def test_a_user_outside_bulk_import(self):
        outsider = self.users.make(OUTSIDER)
        with self.assertRaises(frappe.PermissionError):
            self._upload(pdf_from_text(self._text()), user=outsider)
        frappe.db.rollback()
        self.assertEqual(self._statements(), [])


class TestRepeats(CardImportCase):
    def setUp(self):
        super().setUp()
        self.first = self._upload(pdf_from_text(self._text()))["batch"]

    def _next_month(self, text: str) -> str:
        return text.replace(
            "Statement period : September 2, 2026 to October 1, 2026",
            "Statement period : October 2, 2026 to November 1, 2026",
        )

    def test_the_same_holder_and_period_again_is_refused_naming_the_earlier_import(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            self._upload(pdf_from_text(self._text(serno_base=self.serno_base + 5000)))
        frappe.db.rollback()
        self.assertIn(self.first, str(caught.exception))
        self.assertEqual(len(self._statements()), 1)

    def test_a_line_already_imported_is_left_out_and_counted(self):
        # Next month's file repeating every line but one, whose SerNo is new.
        text = self._next_month(self._text())
        first_serno = f"{self.serno_base + 1:011d}"
        text = text.replace(first_serno, f"{self.serno_base + 999:011d}", 1)
        result = self._upload(pdf_from_text(text))
        rows = self._rows(result["batch"])
        self.assertEqual([row.transfer_id for row in rows], [f"{self.serno_base + 999:011d}"])
        self.assertEqual(frappe.db.get_value(BATCH_DOCTYPE, result["batch"], "repeats_not_saved"), 46)
        self.assertEqual(result["repeats_not_saved"], 46)

    def test_a_file_holding_nothing_new_is_refused(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            self._upload(pdf_from_text(self._next_month(self._text())))
        frappe.db.rollback()
        self.assertIn("nothing new", str(caught.exception))
        self.assertIn(self.first, str(caught.exception))
        self.assertEqual(len(self._statements()), 1)


class TestDiscard(CardImportCase):
    def setUp(self):
        super().setUp()
        self.batch = self._upload(pdf_from_text(self._text()))["batch"]
        [self.statement] = self._statements()

    def _discard(self, user: str = "Administrator"):
        frappe.set_user(user)
        try:
            with _storage_deletes(), _no_bucket_upload():
                return card_import.discard_card_import(self.batch)
        finally:
            frappe.set_user("Administrator")

    def test_an_accountant_lead_removes_the_import_its_statement_and_its_pdf(self):
        file = frappe.get_all(
            "File", filters={"attached_to_doctype": STATEMENT_DOCTYPE, "attached_to_name": self.statement.name}, pluck="name"
        )
        self._discard(self.users.make(ACCOUNTANT_LEAD))
        self.assertFalse(frappe.db.exists(BATCH_DOCTYPE, self.batch))
        self.assertEqual(frappe.db.count(ROW_DOCTYPE, {"import_batch": self.batch}), 0)
        self.assertFalse(frappe.db.exists(STATEMENT_DOCTYPE, self.statement.name))
        self.assertFalse(frappe.db.exists("File", file[0]))

    def test_the_same_statement_can_be_uploaded_again_afterwards(self):
        self._discard()
        again = self._upload(pdf_from_text(self._text()))
        self.assertEqual(len(self._rows(again["batch"])), 47)

    def test_a_plain_accountant_is_refused(self):
        with self.assertRaises(frappe.PermissionError):
            self._discard(self.users.make(ACCOUNTANT))
        frappe.db.rollback()
        self.assertTrue(frappe.db.exists(BATCH_DOCTYPE, self.batch))

    def test_it_is_refused_once_create_has_started(self):
        row = frappe.get_all(
            ROW_DOCTYPE, filters={"import_batch": self.batch, "direction": "Debit"}, fields=["name", "transfer_id"]
        )[0]
        match = frappe.get_doc(
            {
                "doctype": "Outflow Row Match",
                "import_row": row.name,
                "import_batch": self.batch,
                "transfer_id": row.transfer_id,
                "target_doctype": "Non Project Expenses",
                "target_name": "NPE-TEST-CARD",
                "match_basis": "card statement",
                "target_amount": 1,
            }
        )
        match.insert(ignore_permissions=True, ignore_links=True, ignore_mandatory=True)
        frappe.db.commit()
        self.addCleanup(lambda: (frappe.db.delete("Outflow Row Match", {"name": match.name}), frappe.db.commit()))

        with self.assertRaises(frappe.ValidationError) as caught:
            self._discard()
        frappe.db.rollback()
        self.assertIn("Create", str(caught.exception))
        self.assertTrue(frappe.db.exists(STATEMENT_DOCTYPE, self.statement.name))
        self.assertFalse(card_import.get_card_import(self.batch)["discardable"])


class TestItHasItsOwnImport(CardImportCase):
    def test_the_bank_upload_will_not_take_a_card_statement(self):
        from nirmaan_stack.api.outflow_import import upload

        content = pdf_from_text(self._text())

        class _Request:
            files = MultiDict({"file": FileStorage(stream=io.BytesIO(content), filename="card.pdf")})

        previous_request = getattr(frappe.local, "request", None)
        previous_form = dict(frappe.form_dict)
        frappe.local.request = _Request()
        frappe.form_dict["source"] = SOURCE
        try:
            with self.assertRaises(frappe.ValidationError) as caught:
                upload.upload_outflow_statement()
        finally:
            frappe.local.request = previous_request
            frappe.local.form_dict = frappe._dict(previous_form)
        self.assertIn("imported through its own import", str(caught.exception))
        self.assertEqual(self._statements(), [])

    def test_the_card_modules_import_and_call_no_settlement_entry_point(self):
        """The Cashbook AST guard (`test_cashbook_import`), as Porter's is."""
        from nirmaan_stack.api.outflow_import import card_upload
        from nirmaan_stack.api.outflow_import.test_cashbook_import import TestItNeverSettlesAnExistingRecord
        from nirmaan_stack.services.outflow_import import card_pdf, card_statement

        guard = TestItNeverSettlesAnExistingRecord
        for module in (card_import, card_upload, card_pdf, card_statement):
            with self.subTest(module=module.__name__):
                self.assertEqual(guard.forbidden_imports(module), [])
                self.assertEqual(guard.forbidden_calls(module), [])


class TestDeskPermissions(CardImportCase):
    """Only the card import's own code writes a statement or the merchant memory: in Desk an Accountant and an
    Accountant Lead may read them, never create, edit or delete them."""

    def test_accountants_only_read_the_statement_and_the_merchant_memory(self):
        for profile, role in ((ACCOUNTANT, "Nirmaan Accountant"), (ACCOUNTANT_LEAD, "Nirmaan Accountant Lead")):
            user = self.users.make(profile)
            frappe.get_doc("User", user).add_roles(role)
            frappe.db.commit()
            for doctype in (STATEMENT_DOCTYPE, MEMORY_DOCTYPE):
                with self.subTest(role=role, doctype=doctype):
                    self.assertTrue(frappe.has_permission(doctype, "read", user=user))
                    for ptype in ("create", "write", "delete"):
                        self.assertFalse(frappe.has_permission(doctype, ptype, user=user), ptype)

    def test_an_accountant_upload_still_writes_the_statement(self):
        self._upload(pdf_from_text(self._text()), user=self.users.make(ACCOUNTANT))
        self.assertEqual(len(self._statements()), 1)
