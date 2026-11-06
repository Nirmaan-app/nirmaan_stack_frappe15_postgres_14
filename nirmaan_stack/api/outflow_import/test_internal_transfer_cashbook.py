# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A Cashbook Statement import records Cashbook's own moves as Internal Transfers (#1623, spec #1619).

A made-up statement staged through the Cashbook import's own `_stage` (the job that creates expenses is not run:
it writes only `Pending match run` lines, and an internal line is never one). Read back as the screen reads it.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every batch, row and record this suite makes is purged.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.internal_transfers import INTERNAL_TRANSFER_DOCTYPE
from nirmaan_stack.api.outflow_import.test_cashbook_import import _purge
from nirmaan_stack.services.outflow_import.parser import parse_statement

_HEADER = (
    '"Date","Time","Type","From","To","Debit","Credit","Affected Wallet Balance","VA Balance","Remark","Note",'
    '"Employee ID","Reporting Manager","Reporting Manager Employee ID","Payment Status","Txn Id","Category",'
    '"Category Code","Location","Location Code","Department","Department Code","Title","Title Code",'
    '"Bill Attached","Attachments","","",""'
)


def _line(date, kind, who_from, who_to, debit, credit, status, txn):
    return (
        f'"{date}","10:00 AM","{kind}","{who_from}","{who_to}","{debit}","{credit}","","","","","","","",'
        f'"{status}","{txn}","","","","","","","","","No","","","",""'
    )


class CashbookStageCase(FrappeTestCase):
    """Stage a made-up statement through `_stage`, and read its lines and records back."""

    def _stage(self, lines) -> str:
        content = ("\n".join([_HEADER, *lines]) + "\n").encode()
        parsed = parse_statement(content, source="Cashbook")
        batch = cb._stage(parsed, cb._build_plan(parsed), file_url="/private/files/test-it-cb.csv",
                          filename="test-it-cb.csv", user="Administrator").name
        frappe.db.commit()
        self.addCleanup(_purge, batch)
        return batch

    def _lines(self, batch):
        return frappe.get_all(
            "Outflow Import Row", filters={"import_batch": batch},
            fields=["name", "transfer_id", "row_status", "skip_kind", "outcome_note"], order_by="transfer_id asc",
        )

    def _record(self, line):
        rows = frappe.get_all(
            INTERNAL_TRANSFER_DOCTYPE, filters={"import_row": line},
            fields=["from_place", "to_place", "detail", "amount", "direction", "made_by", "source"],
        )
        return rows[0] if rows else None


class TestACashbookImportRecordsItsOwnMoves(CashbookStageCase):
    def test_the_three_types_are_internal_transfers_with_one_record_each(self):
        tag = frappe.generate_hash(length=6).upper()
        batch = self._stage([
            _line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "50000", "SUCCESS", f"VALOAD-{tag}1"),
            _line("01/08/2026", "VA → Wallet", "Virtual Account", "Test Employee A", "", "4000", "SUCCESS",
                  f"VALOAD-{tag}2"),
            _line("02/08/2026", "Wallet → VA", "Test Employee B", "Virtual Account", "300", "", "SUCCESS",
                  f"VALOAD-{tag}3"),
            _line("02/08/2026", "Something New", "Test Employee B", "Virtual Account", "", "10", "SUCCESS",
                  f"VALOAD-{tag}4"),
        ])
        lines = self._lines(batch)
        self.assertEqual(
            [line["row_status"] for line in lines],
            ["Internal Transfer", "Internal Transfer", "Internal Transfer", "Skipped"],
        )
        # Owner decision 4 (#1619): a Type the app does not know has its own Skip Type.
        self.assertEqual(lines[3]["skip_kind"], "Unknown Cashbook type")
        records = [self._record(line["name"]) for line in lines]
        self.assertEqual(
            [(r["from_place"], r["to_place"], r["detail"], float(r["amount"])) for r in records[:3]],
            [
                ("ICICI Current Account", "Cashbook Virtual Account", None, 50000.0),
                ("Cashbook Virtual Account", "Cashbook Employee Wallet", "Test Employee A", 4000.0),
                ("Cashbook Employee Wallet", "Cashbook Virtual Account", "Test Employee B", 300.0),
            ],
        )
        self.assertEqual(records[0]["made_by"], "cashbook_bank_to_va")
        self.assertEqual(records[0]["source"], "Cashbook")
        self.assertIsNone(records[3])

    def test_they_appear_in_the_internal_transfers_tab_beside_the_icici_ones(self):
        from nirmaan_stack.api.outflow_import.review import get_outflow_rows

        tag = frappe.generate_hash(length=6).upper()
        batch = self._stage([
            _line("01/08/2026", "VA → Wallet", "Virtual Account", "Test Employee A", "", "4000", "SUCCESS",
                  f"BUSINESS_USER-{tag}"),
        ])
        rows = get_outflow_rows(scope="internal_transfers", batch=batch, limit=50)["rows"]
        self.assertEqual([(r["transfer_from"], r["transfer_to"]) for r in rows],
                         [("Cashbook Virtual Account", "Cashbook Employee Wallet")])

    def test_a_move_seen_successful_and_later_reversed_keeps_its_record_on_the_first_line(self):
        """Owner decision 3, for repeats too (#1619): the later line moved no money, so it is Bank refused, naming the
        earlier import. The first line's record stays, as a wallet spend imported SUCCESS and later REVERSED keeps its
        expense (an open question for the owner)."""
        tag = frappe.generate_hash(length=6).upper()
        txn = f"VALOAD-{tag}"
        first = self._stage([_line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "700",
                                   "SUCCESS", txn)])
        second = self._stage([_line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "700",
                                    "REVERSED", txn)])
        again = self._lines(second)[0]
        self.assertEqual(
            (again["row_status"], again["skip_kind"]), ("Skipped", "Bank refused")
        )
        self.assertEqual(
            frappe.db.get_value("Outflow Import Row", again["name"], "skip_reason"),
            f"Did not succeed at the wallet. Already imported in batch {first}, bank status changed SUCCESS → "
            "REVERSED.",
        )
        self.assertIsNone(self._record(again["name"]))
        self.assertIsNotNone(self._record(self._lines(first)[0]["name"]))

    def test_a_failed_move_is_skipped_as_bank_refused(self):
        """Owner decision 3 (#1619, 2026-11-07)."""
        tag = frappe.generate_hash(length=6).upper()
        batch = self._stage([_line("01/08/2026", "VA → Wallet", "Virtual Account", "Test Employee A", "", "400",
                                   "FAILED", f"BUSINESS_USER-{tag}")])
        self.assertEqual([(l["row_status"], l["skip_kind"]) for l in self._lines(batch)],
                         [("Skipped", "Bank refused")])

    def test_a_move_first_seen_not_successful_and_then_failed_again_gets_no_record(self):
        """Review finding (#1619): a record only for money that moved."""
        tag = frappe.generate_hash(length=6).upper()
        txn = f"VALOAD-{tag}"
        self._stage([_line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "700", "FAILED", txn)])
        second = self._stage([_line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "700",
                                    "REVERSED", txn)])
        again = self._lines(second)
        self.assertEqual([(line["row_status"], line["skip_kind"]) for line in again], [("Skipped", "Bank refused")])
        self.assertIsNone(self._record(again[0]["name"]))

    def test_a_move_first_seen_failed_is_recorded_when_it_comes_back_successful(self):
        """Review finding: the earlier sighting was skipped (no money moved), so it holds no record; the repeat
        that says SUCCESS is the move, and it is recorded once."""
        tag = frappe.generate_hash(length=6).upper()
        txn = f"VALOAD-{tag}"
        first = self._stage([_line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "700",
                                   "FAILED", txn)])
        second = self._stage([_line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "700",
                                    "SUCCESS", txn)])
        self.assertIsNone(self._record(self._lines(first)[0]["name"]))
        again = self._lines(second)[0]
        self.assertEqual(again["row_status"], "Internal Transfer")
        self.assertIsNotNone(self._record(again["name"]))

    def test_a_failed_repeat_of_a_move_sent_back_to_mismatched_is_no_internal_transfer(self):
        """Every Internal Transfer line keeps exactly one record. The SUCCESS line was sent back; a later REVERSED
        sighting moved no money: Bank refused, as every not-successful move is (owner decision 3, #1619)."""
        from nirmaan_stack.api.outflow_import.internal_transfer_actions import send_back_to_mismatched

        tag = frappe.generate_hash(length=6).upper()
        txn = f"VALOAD-{tag}"
        first = self._lines(self._stage([_line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "",
                                               "700", "SUCCESS", txn)]))[0]
        send_back_to_mismatched(first["name"], reason="Not our own move")
        again = self._lines(self._stage([_line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "",
                                               "700", "REVERSED", txn)]))[0]
        self.assertEqual((again["row_status"], again["skip_kind"]), ("Skipped", "Bank refused"))
        self.assertIsNone(self._record(again["name"]))

    def test_a_top_up_into_the_virtual_account_is_money_in_and_money_back_out_is_money_out(self):
        """Review finding: the record's direction is the column the statement filled -- Credit is In, Debit is Out."""
        tag = frappe.generate_hash(length=6).upper()
        batch = self._stage([
            _line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "500", "SUCCESS", f"VALOAD-{tag}1"),
            _line("02/08/2026", "Wallet → VA", "Test Employee B", "Virtual Account", "300", "", "SUCCESS",
                  f"VALOAD-{tag}2"),
        ])
        self.assertEqual([self._record(l["name"])["direction"] for l in self._lines(batch)], ["In", "Out"])


class TestEveryInternalTransferLineHoldsOneRecord(CashbookStageCase):
    """Owner decision 3, for repeats too (#1619): only a line that says SUCCESS is an Internal Transfer line, and it
    makes the record. So on a mixed statement the Internal Transfers tab, the summary chip and the records agree."""

    def test_the_tab_count_the_chip_and_the_records_are_one_number(self):
        from nirmaan_stack.api.outflow_import.review import get_outflow_rows, get_outflow_summary

        tag = frappe.generate_hash(length=6).upper()
        self._stage([_line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "700", "SUCCESS",
                           f"VALOAD-{tag}1")])
        batch = self._stage([
            # A repeat of the move above that the wallet now calls REVERSED, a new move, a failed move, a move the
            # same file then calls REVERSED, a spend and a Type the app does not know.
            _line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "700", "REVERSED", f"VALOAD-{tag}1"),
            _line("02/08/2026", "VA → Wallet", "Virtual Account", "Test Employee A", "", "400", "SUCCESS",
                  f"BUSINESS_USER-{tag}2"),
            _line("02/08/2026", "Wallet → VA", "Test Employee B", "Virtual Account", "300", "", "FAILED",
                  f"C2B-{tag}3"),
            _line("03/08/2026", "VA → Wallet", "Virtual Account", "Test Employee A", "", "900", "SUCCESS",
                  f"BUSINESS_USER-{tag}4"),
            _line("03/08/2026", "VA → Wallet", "Virtual Account", "Test Employee A", "", "900", "REVERSED",
                  f"BUSINESS_USER-{tag}4"),
            _line("03/08/2026", "Wallet Spend", "Test Employee A", "A Test Shop", "120", "", "SUCCESS",
                  f"OBO-{tag}5"),
            _line("04/08/2026", "Something New", "Test Employee B", "Virtual Account", "", "10", "SUCCESS",
                  f"VALOAD-{tag}6"),
        ])
        tab = get_outflow_rows(scope="internal_transfers", batch=batch, limit=50)
        chip = get_outflow_summary(batch=batch)["totals"]["internal_transfer_rows"]
        lines = [line["name"] for line in self._lines(batch)]
        records = frappe.db.count(INTERNAL_TRANSFER_DOCTYPE, {"import_row": ["in", lines]})
        self.assertEqual((len(tab["rows"]), chip, records), (2, 2, 2))
        self.assertTrue(all(row["internal_transfer"] for row in tab["rows"]))


def _xlsx(lines) -> bytes:
    """The made-up statement as the .xlsx the Cashbook import takes."""
    import csv
    import io

    from openpyxl import Workbook

    book = Workbook()
    for row in csv.reader([_HEADER, *lines]):
        book.active.append(row)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


class TestAReuploadFillsAZeroRecord(CashbookStageCase):
    """Owner decision 2 (#1619, 2026-11-07): imports before #1623 never stored a top-up's Credit, so its record holds
    ₹0. A re-upload repeating that line gives the record the money from the file, and changes nothing else."""

    def _confirm(self, content: bytes) -> dict:
        from unittest.mock import patch

        from nirmaan_stack.api.outflow_import.test_cashbook_reopen import _post

        with patch.object(cb, "_enqueue_worker"):
            result = _post(cb.confirm_cashbook_import, content, "test-it-reupload.xlsx")
        self.addCleanup(_purge, result["batch"])
        self.addCleanup(self._purge_statement_file, result["batch"])
        return result

    @staticmethod
    def _purge_statement_file(batch: str) -> None:
        """The statement `save_file` committed; `_purge` deletes no File. Rolled back first, committed on its own."""
        frappe.db.rollback()
        try:
            for name in frappe.get_all("File", filters={"attached_to_doctype": "Outflow Import Batch",
                                                        "attached_to_name": batch}, pluck="name"):
                frappe.delete_doc("File", name, ignore_permissions=True, force=True)
            frappe.db.commit()
        except Exception as exc:
            frappe.db.rollback()
            print(f"internal transfer re-upload test: could not purge the statement file of {batch}: {exc}")

    def test_an_exact_repeat_fills_a_zero_record_and_nothing_else(self):
        tag = frappe.generate_hash(length=6).upper()
        lines = [
            _line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "50000", "SUCCESS",
                  f"VALOAD-{tag}1"),
            _line("02/08/2026", "Wallet → VA", "Test Employee B", "Virtual Account", "300", "", "SUCCESS",
                  f"C2B-{tag}2"),
        ]
        old = self._lines(self._stage(lines))
        top_up, back = old[1], old[0]  # ordered by Txn Id: C2B- before VALOAD-
        # As an import before #1623 left them: the top-up's record at 0; the other one non-zero, and never touched.
        frappe.db.set_value(INTERNAL_TRANSFER_DOCTYPE, {"import_row": top_up["name"]}, "amount", 0)
        frappe.db.set_value(INTERNAL_TRANSFER_DOCTYPE, {"import_row": back["name"]}, "amount", 250)
        frappe.db.commit()

        result = self._confirm(_xlsx(lines))

        self.assertEqual(result["repeats_not_saved"], 2)
        self.assertEqual(result["records_filled"], 1)
        self.assertEqual(self._lines(result["batch"]), [])
        self.assertEqual(float(self._record(top_up["name"])["amount"]), 50000.0)
        self.assertEqual(self._record(top_up["name"])["direction"], "In")
        self.assertEqual(float(self._record(back["name"])["amount"]), 250.0)
        self.assertEqual(float(frappe.db.get_value("Outflow Import Row", top_up["name"], "amount")), 0.0)
        self.assertEqual(frappe.db.count(INTERNAL_TRANSFER_DOCTYPE, {"import_row": ["in", [l["name"] for l in old]]}), 2)

    def test_a_file_that_only_fills_records_is_not_refused_as_nothing_new(self):
        tag = frappe.generate_hash(length=6).upper()
        lines = [_line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "700", "SUCCESS",
                       f"VALOAD-{tag}")]
        old = self._lines(self._stage(lines))[0]
        frappe.db.set_value(INTERNAL_TRANSFER_DOCTYPE, {"import_row": old["name"]}, "amount", 0)
        frappe.db.commit()
        self.assertEqual(self._confirm(_xlsx(lines))["records_filled"], 1)
        self.assertEqual(float(self._record(old["name"])["amount"]), 700.0)


class TestThePreviewListsInternalTransfersUnderTheirOwnHeading(FrappeTestCase):
    """Owner decision 7 (#1619): the Cashbook upload preview lists Internal Transfer lines on their own, as the card
    Review does, not under "Not importing"."""

    def test_an_internal_line_is_listed_with_the_money_it_moved_and_not_with_the_skips(self):
        from nirmaan_stack.api.outflow_import.test_cashbook_reopen import _post

        tag = frappe.generate_hash(length=6).upper()
        preview = _post(cb.preview_cashbook_statement, _xlsx([
            _line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "500", "SUCCESS", f"VALOAD-{tag}1"),
            _line("02/08/2026", "Something New", "Test Employee B", "Virtual Account", "", "10", "SUCCESS",
                  f"VALOAD-{tag}2"),
        ]), "test-it-preview.xlsx")
        self.assertEqual(
            [(line["transfer_id"], line["amount"], line["reason"]) for line in preview["internal_transfers"]],
            [(f"VALOAD-{tag}1", 500.0,
              "Internal Transfer from ICICI Current Account to Cashbook Virtual Account.")],
        )
        self.assertEqual([line["transfer_id"] for line in preview["skipped"]], [f"VALOAD-{tag}2"])
