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


class TestACashbookImportRecordsItsOwnMoves(FrappeTestCase):
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
        self.assertEqual(lines[3]["skip_kind"], "Cashbook internal movement")
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

    def test_a_status_changed_repeat_makes_no_second_record(self):
        tag = frappe.generate_hash(length=6).upper()
        txn = f"VALOAD-{tag}"
        first = self._stage([_line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "700",
                                   "SUCCESS", txn)])
        second = self._stage([_line("01/08/2026", "Bank → VA", "Test Company", "Virtual Account", "", "700",
                                    "REVERSED", txn)])
        again = self._lines(second)
        self.assertEqual([line["row_status"] for line in again], ["Internal Transfer"])
        self.assertIsNone(self._record(again[0]["name"]))
        self.assertIsNotNone(self._record(self._lines(first)[0]["name"]))

    def test_a_failed_move_keeps_todays_skip(self):
        tag = frappe.generate_hash(length=6).upper()
        batch = self._stage([_line("01/08/2026", "VA → Wallet", "Virtual Account", "Test Employee A", "", "400",
                                   "FAILED", f"BUSINESS_USER-{tag}")])
        self.assertEqual([(l["row_status"], l["skip_kind"]) for l in self._lines(batch)],
                         [("Skipped", "Cashbook internal movement")])
