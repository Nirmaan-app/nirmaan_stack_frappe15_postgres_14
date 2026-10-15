# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Porter Statement import, through its own endpoints (#1443, spec #1442, ADR-0032).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_porter_import

Drives `upload_porter_statement` with a real `werkzeug` `FileStorage`, as the endpoint receives it, and
asserts on the records it leaves: the batch, its lines and its Porter Invoices. `save_file` is the one
thing stubbed -- it commits inside the request and would put a file in storage for good -- and the stub
records what it was asked to save.

The fixture is SYNTHETIC (invented names, phones, emails) and shaped like the 2026-09 statement. Its
invoice numbers and CRNs are rewritten per test, so nothing a previous run left behind collides.

⚠️ Every test removes everything it made: lines, Porter Invoices, batches (by filename), and the
projects the class created.
"""

import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from werkzeug.datastructures import FileStorage, MultiDict

from nirmaan_stack.api.outflow_import import porter as porter_api
from nirmaan_stack.services.outflow_import.porter import (
    EXPENSE_TYPE,
    OWN_IMPORT_LINE_REFUSAL,
    statement_line,
)

FIXTURE = (
    Path(frappe.get_app_path("nirmaan_stack"))
    / "services"
    / "outflow_import"
    / "tests"
    / "fixtures"
    / "porter_sample.csv"
)
BATCH_DOCTYPE = "Outflow Import Batch"
ROW_DOCTYPE = "Outflow Import Row"
INVOICE_DOCTYPE = "Porter Invoice"
SOURCE = "Porter Statement"


def _fresh_fixture() -> tuple[bytes, dict]:
    """The fixture with its invoice numbers and CRNs made unique to this run.

    Returns the bytes and the map from each fixture invoice number to this run's."""
    tag = frappe.generate_hash(length=5).upper()
    crn = "".join(str(int(c, 16) % 10) for c in frappe.generate_hash(length=8))
    text = FIXTURE.read_text(encoding="utf-8")
    numbers = {
        old: old.replace("A09000", f"A{tag}")
        for old in ("29SS27A0900001", "24SS27A0900002", "29SM27A0900003", "36SM27A0900004")
    }
    text = text.replace("A09000", f"A{tag}").replace("CRN90000000", f"CRN{crn}")
    return text.encode(), numbers


def _purge_batches(filename: str) -> None:
    """Roll back first (a refused upload may have aborted the transaction), then delete by scope."""
    frappe.db.rollback()
    for batch in frappe.get_all(BATCH_DOCTYPE, filters={"original_filename": filename}, pluck="name"):
        _purge_invoice_files(batch)
        for doctype, field in ((ROW_DOCTYPE, "import_batch"), (INVOICE_DOCTYPE, "import_batch")):
            try:
                frappe.db.delete(doctype, {field: batch})
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()
                print(f"porter test purge: could not delete {doctype} of {batch}")
        frappe.db.delete(BATCH_DOCTYPE, {"name": batch})
        frappe.db.commit()


def _purge_invoice_files(batch: str) -> None:
    """The invoice PDFs validation stored (#1444): their File rows, raw, and their bytes on local disk.

    Raw, so no storage hook runs: a test env keeps uploads on local disk, and the bytes go with them."""
    invoices = frappe.get_all(INVOICE_DOCTYPE, filters={"import_batch": batch}, pluck="name")
    if not invoices:
        return
    try:
        files = frappe.get_all(
            "File",
            filters={"attached_to_doctype": INVOICE_DOCTYPE, "attached_to_name": ["in", invoices]},
            fields=["name", "file_url"],
        )
        for file in files:
            path = frappe.get_site_path(*(file.file_url or "").lstrip("/").split("/"))
            if (file.file_url or "").startswith("/private/files/") and os.path.exists(path):
                os.remove(path)
            frappe.db.delete("File", {"name": file.name})
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        print(f"porter test purge: could not delete the invoice files of {batch}")


class PorterImportCase(FrappeTestCase):
    """Won projects the fixture's remarks name, plus a Tendering duplicate of one of them."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.projects = []
        cls.zephyr = cls._project("Zephyr Tower", "Won")
        cls.zephyr_tender = cls._project("ZEPHYR TOWER", "Tendering")
        cls.quillon = cls._project("Quillon Park", "Won")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        for name in cls.projects:
            try:
                frappe.delete_doc("Projects", name, force=True, ignore_permissions=True)
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()
                print(f"porter test purge: could not delete project {name}")
        super().tearDownClass()

    @classmethod
    def _project(cls, name: str, tendering_status: str) -> str:
        doc = frappe.new_doc("Projects")
        doc.project_name = name
        doc.tendering_status = tendering_status
        doc.project_start_date = frappe.utils.now()[:19]
        doc.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
        doc.project_scopes = {"scopes": []}
        doc.insert(ignore_permissions=True)
        cls.projects.append(doc.name)
        return doc.name

    def setUp(self):
        super().setUp()
        self.filename = f"porter-{frappe.generate_hash(length=8)}.csv"
        self.saved = []
        self.enqueued = []
        self.addCleanup(_purge_batches, self.filename)

    def _upload(self, content: bytes):
        filename = self.filename

        class _Request:
            files = MultiDict({"file": FileStorage(stream=io.BytesIO(content), filename=filename)})

        def _save_file(**kwargs):
            self.saved.append(kwargs)
            return SimpleNamespace(name="no-such-file", file_url=f"/private/files/{filename}")

        previous_request = getattr(frappe.local, "request", None)
        frappe.set_user("Administrator")
        frappe.local.request = _Request()
        # ⚠️ THE QUEUE IS SHARED WITH THE MAIN BENCH: a real enqueue would hand this test's import to a
        # live worker. The job is recorded here, and the validation tests run it directly.
        try:
            with patch.object(porter_api, "save_file", side_effect=_save_file), patch.object(
                frappe, "enqueue", side_effect=lambda *args, **kwargs: self.enqueued.append(kwargs)
            ):
                return porter_api.upload_porter_statement()
        finally:
            frappe.local.request = previous_request

    def _batches(self):
        return frappe.get_all(BATCH_DOCTYPE, filters={"original_filename": self.filename}, pluck="name")


class TestUploadingAStatement(PorterImportCase):
    def setUp(self):
        super().setUp()
        content, self.numbers = _fresh_fixture()
        self.result = self._upload(content)
        self.batch = self.result["batch"]

    def _rows(self):
        return frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch},
            fields=["*"],
            order_by="name asc",
        )

    def _row(self, crn_suffix: str):
        return next(row for row in self._rows() if row.transfer_id.endswith(crn_suffix))

    def test_the_import_is_a_porter_statement_dated_from_first_to_last_completion(self):
        batch = frappe.get_doc(BATCH_DOCTYPE, self.batch)
        self.assertEqual(batch.source, SOURCE)
        self.assertEqual(str(batch.period_from), "2026-09-01")
        self.assertEqual(str(batch.period_to), "2026-09-30")
        self.assertEqual(batch.original_filename, self.filename)
        # The completed orders' fare only: 3087 + 779 + 756 + 613.
        self.assertEqual(float(batch.gross_amount), 5235.0)

    def test_the_csv_is_saved_once_privately_as_the_batchs_file(self):
        self.assertEqual(len(self.saved), 1)
        self.assertEqual(self.saved[0]["is_private"], 1)
        self.assertEqual(
            frappe.db.get_value(BATCH_DOCTYPE, self.batch, "source_file"),
            f"/private/files/{self.filename}",
        )

    def test_one_line_per_order(self):
        rows = self._rows()
        self.assertEqual(len(rows), 12)
        self.assertEqual({row.source for row in rows}, {SOURCE})

    def test_one_porter_invoice_per_invoice_link_holding_the_statements_completed_figures(self):
        invoices = {
            doc.name: doc
            for doc in frappe.get_all(
                INVOICE_DOCTYPE, filters={"import_batch": self.batch}, fields=["*"]
            )
        }
        self.assertEqual(set(invoices), set(self.numbers.values()))
        hyderabad = invoices[self.numbers["36SM27A0900004"]]
        self.assertEqual(hyderabad.invoice_number, self.numbers["36SM27A0900004"])
        self.assertEqual(hyderabad.city, "Hyderabad")
        self.assertEqual(hyderabad.porter_gstin, "36AAATQ1111B1Z3")
        self.assertEqual(hyderabad.customer_gstin, "29AAACN9999X1Z0")
        self.assertEqual(hyderabad.billing_entity, "PORTERTEST MARKETING PRIVATE LIMITED")
        self.assertTrue(hyderabad.invoice_link.endswith(f"{self.numbers['36SM27A0900004']}.pdf"))
        # The cancelled Rs 328 order counts toward nothing.
        self.assertEqual(hyderabad.completed_orders, 2)
        self.assertEqual(float(hyderabad.fare_total), 613.0)
        self.assertAlmostEqual(float(hyderabad.tax_total), 30.65, places=2)
        self.assertEqual({doc.validation_status for doc in invoices.values()}, {"Queued"})

    def test_a_cancelled_order_is_a_skipped_line_that_unskip_refuses(self):
        from nirmaan_stack.api.outflow_import.review import unskip_row

        cancelled = self._row("011")
        self.assertEqual(cancelled.row_status, "Skipped")
        self.assertEqual(cancelled.skip_kind, "Porter order cancelled")
        self.assertEqual(cancelled.skip_origin, "System")
        self.assertIsNone(cancelled.suggested_doctype)
        with self.assertRaises(frappe.ValidationError) as caught:
            unskip_row(cancelled.name, "bring it back")
        self.assertIn("Porter cancelled this order", str(caught.exception))
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, cancelled.name, "row_status"), "Skipped")

    def test_a_completed_line_carries_the_won_only_name_suggestion(self):
        zephyr = self._row("001")
        self.assertEqual(zephyr.row_status, "Pending match run")
        self.assertEqual(zephyr.suggested_doctype, "Project Expenses")
        # The Tendering "ZEPHYR TOWER" is not in the index, so it cannot tie the Won one away.
        self.assertEqual(zephyr.resolved_project, self.zephyr)
        self.assertEqual(zephyr.placement_reason, "name")
        self.assertEqual(zephyr.placement_strength, "Strong")
        self.assertEqual(zephyr.suggested_expense_type, EXPENSE_TYPE)

        quillon = self._row("002")
        self.assertEqual(quillon.resolved_project, self.quillon)
        self.assertEqual(quillon.placement_strength, "Check")

        unnamed = self._row("003")
        self.assertEqual(unnamed.suggested_doctype, "Non Project Expenses")
        self.assertIsNone(unnamed.resolved_project)
        self.assertFalse(unnamed.placement_reason)
        self.assertEqual(unnamed.suggested_expense_type, EXPENSE_TYPE)

    def test_a_line_keeps_its_order_names_its_invoice_and_its_crn_is_its_reference(self):
        row = self._row("004")
        self.assertEqual(row.porter_invoice, self.numbers["29SS27A0900001"])
        self.assertEqual(float(row.amount), 1616.0)
        self.assertEqual(row.direction, "Debit")
        self.assertEqual(row.added_by_raw, "Kavya Menon")
        self.assertEqual(row.settlement_reference, row.transfer_id)
        line = statement_line(row.porter_line)
        self.assertEqual(line["crn"], row.transfer_id)
        self.assertEqual(line["vehicle_type"], "Tata 407")
        self.assertEqual(line["customer_mobile"], "9000000001")
        self.assertEqual(line["waypoint_addresses"], "Demo Hardware  KR Market  Bengaluru  Karnataka 560002  India")
        self.assertEqual(line["tax_amount"], "80.8")

    def test_the_upload_reports_orders_invoices_and_cancelled_orders(self):
        status = porter_api.get_porter_status(self.batch)
        self.assertEqual(status, self.result)
        self.assertEqual(status["orders"], 12)
        self.assertEqual(status["completed"], 11)
        self.assertEqual(status["cancelled"], 1)
        self.assertEqual(status["period_from"], "2026-09-01")
        self.assertEqual(status["period_to"], "2026-09-30")
        self.assertEqual(
            [invoice["invoice_number"] for invoice in status["invoices"]],
            [self.numbers[n] for n in ("29SS27A0900001", "24SS27A0900002", "29SM27A0900003", "36SM27A0900004")],
        )
        first = status["invoices"][0]
        self.assertEqual(first["completed_orders"], 5)
        self.assertEqual(first["fare_total"], 3087.0)
        self.assertEqual(first["validation_status"], "Queued")

    def test_it_is_listed_on_the_porter_tab_under_its_statement_month(self):
        from nirmaan_stack.api.outflow_import.review import list_imports

        september = list_imports(sources=json.dumps([SOURCE]), month="2026-09")
        listed = next(item for item in september if item["name"] == self.batch)
        self.assertEqual(listed["source"], SOURCE)
        self.assertEqual(listed["successful_rows"], 11)
        october = list_imports(sources=json.dumps([SOURCE]), month="2026-10")
        self.assertNotIn(self.batch, [item["name"] for item in october])

    def test_its_waiting_lines_are_in_no_tab_and_no_open_figure(self):
        from nirmaan_stack.api.outflow_import.review import get_outflow_rows, get_outflow_summary

        for scope in ("all", "not_matched_outflow", "matched_outflow"):
            page = get_outflow_rows(batch=self.batch, scope=scope, limit=50, offset=0)
            self.assertEqual(page["total"], 0, scope)
        summary = get_outflow_summary(batch=self.batch)["totals"]
        self.assertEqual(summary["open_rows"], 0)
        self.assertEqual(summary["open_paid_rows"], 0)
        # The cancelled line is still accounted for, in the Skipped popup.
        skipped = get_outflow_rows(batch=self.batch, scope="skipped", limit=50, offset=0)
        self.assertEqual(skipped["total"], 1)

    def test_create_link_and_skip_are_refused_from_the_main_table(self):
        from nirmaan_stack.api.outflow_import.expenses import create_expense, settle_row
        from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
        from nirmaan_stack.api.outflow_import.review import skip_row

        row = self._row("001").name
        attempts = {
            "create": lambda: create_expense(
                row=row, doctype="Project Expenses", expense_type=EXPENSE_TYPE, project=self.zephyr
            ),
            "settle": lambda: settle_row(row, "Project Expenses", "no-such-expense"),
            "link": lambda: link_rows_to_expense(
                json.dumps([row]), "Non Project Expenses", "no-such-expense"
            ),
            "skip": lambda: skip_row(row, "not ours"),
        }
        for action, attempt in attempts.items():
            with self.subTest(action=action):
                with self.assertRaises(frappe.ValidationError) as caught:
                    attempt()
                self.assertIn(OWN_IMPORT_LINE_REFUSAL, str(caught.exception))
                frappe.db.rollback()
                self.assertEqual(
                    frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), "Pending match run"
                )

    def test_the_same_invoices_cannot_be_uploaded_twice(self):
        content = FIXTURE.read_text(encoding="utf-8")
        tag = self.numbers["29SS27A0900001"][7:12]
        content = content.replace("A09000", f"A{tag}")
        before = len(self.saved)
        with self.assertRaises(frappe.ValidationError) as caught:
            self._upload(content.encode())
        self.assertIn(self.batch, str(caught.exception))
        self.assertEqual(len(self.saved), before)
        self.assertEqual(self._batches(), [self.batch])


class TestAnOrderIsPlacedByItsProjectsSiteAddress(PorterImportCase):
    """Signal 4 (#1448) reads `Projects.project_address` -> `Address` of each Won project at upload."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        address = frappe.get_doc(
            {
                "doctype": "Address",
                "address_title": f"Porter test site {frappe.generate_hash(length=6)}",
                "address_type": "Shipping",
                "address_line1": "Demo Site Office, Kondapur",
                "city": "Hyderabad",
                "state": "Telangana",
                "country": "India",
                "pincode": "500084",
            }
        ).insert(ignore_permissions=True)
        cls.address = address.name
        cls.site = cls._project("Deccan Demo Works", "Won")
        frappe.db.set_value("Projects", cls.site, "project_address", address.name)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        frappe.db.delete("Address", {"name": cls.address})
        frappe.db.commit()

    def test_an_order_with_no_remark_going_to_a_site_is_suggested_there_to_check(self):
        batch = self._upload(_fresh_fixture()[0])["batch"]
        row = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch, "transfer_id": ["like", "%012"]},
            fields=["resolved_project", "suggested_doctype", "placement_reason", "placement_strength"],
        )[0]
        self.assertEqual((row.resolved_project, row.suggested_doctype), (self.site, "Project Expenses"))
        self.assertEqual((row.placement_reason, row.placement_strength), ("address", "Check"))


class TestThePorterLinesAreNotBankLines(PorterImportCase):
    def test_total_unreconciled_outflow_does_not_move_on_upload(self):
        from nirmaan_stack.api.outflow_import.review import not_matched_totals

        before = not_matched_totals()
        self._upload(_fresh_fixture()[0])
        self.assertEqual(not_matched_totals(), before)


class TestARefusedFileSavesNothing(PorterImportCase):
    def _assert_refused(self, content: bytes, *words: str):
        with self.assertRaises(frappe.ValidationError) as caught:
            self._upload(content)
        for word in words:
            self.assertIn(word, str(caught.exception))
        frappe.db.rollback()
        self.assertEqual(self.saved, [])
        self.assertEqual(self._batches(), [])

    def test_a_file_missing_a_required_column(self):
        content = _fresh_fixture()[0].decode().replace("porter_gstin", "gstin", 1)
        self._assert_refused(content.encode(), "porter_gstin")

    def test_a_file_that_is_not_a_csv(self):
        """Porter's statement is a CSV (spec #1442); an Excel copy of it is refused, not read."""
        for extension in (".xlsx", ".xls", ".pdf", ""):
            with self.subTest(extension=extension):
                self.filename = f"porter-{frappe.generate_hash(length=8)}{extension}"
                self.addCleanup(_purge_batches, self.filename)
                self.saved = []
                self._assert_refused(_fresh_fixture()[0], ".csv")

    def test_a_file_with_no_rows(self):
        header = _fresh_fixture()[0].decode().splitlines()[0]
        self._assert_refused((header + "\n").encode())

    def test_an_invoice_whose_lines_disagree(self):
        content, numbers = _fresh_fixture()
        lines = content.decode().splitlines(keepends=True)
        lines[2] = lines[2].replace("29AAATP0000A1Z1", "29AAATP0000A1Z9")
        self._assert_refused("".join(lines).encode(), "Porter GSTIN")
        self.assertFalse(
            frappe.db.exists(INVOICE_DOCTYPE, numbers["29SS27A0900001"])
        )

    def test_the_bank_upload_will_not_take_a_porter_statement(self):
        from nirmaan_stack.api.outflow_import import upload

        content = _fresh_fixture()[0]
        filename = self.filename

        class _Request:
            files = MultiDict({"file": FileStorage(stream=io.BytesIO(content), filename=filename)})

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
        self.assertIn("Porter import", str(caught.exception))
        self.assertEqual(self._batches(), [])


class TestTheMatcherIsNeverCalled(FrappeTestCase):
    """The Cashbook AST guard, extended to the Porter module (`test_cashbook_import`)."""

    def test_the_porter_modules_import_and_call_no_settlement_entry_point(self):
        from nirmaan_stack.api.outflow_import.test_cashbook_import import (
            TestItNeverSettlesAnExistingRecord,
        )
        from nirmaan_stack.api.outflow_import import porter_create, porter_rectify
        from nirmaan_stack.services.outflow_import import porter as porter_service
        from nirmaan_stack.services.outflow_import import porter_placement

        guard = TestItNeverSettlesAnExistingRecord
        for module in (porter_api, porter_create, porter_rectify, porter_service, porter_placement):
            with self.subTest(module=module.__name__):
                self.assertEqual(guard.forbidden_imports(module), [])
                self.assertEqual(guard.forbidden_calls(module), [])
