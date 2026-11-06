# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""An ICICI statement upload records our own money moves as Internal Transfers (#1621, spec #1619).

A made-up statement with one line per in-scope category, plus the lines that must stay as they are: a bounced
vendor payment, the bank's card rounding, fixed deposit lines and an ordinary vendor payment. Staged through the
upload's own `_stage_batch`, and read back as the screen reads it.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every batch, row and Internal Transfer this suite makes is purged.
"""

import unittest
from dataclasses import replace

import frappe

from nirmaan_stack.api.outflow_import.internal_transfers import INTERNAL_TRANSFER_DOCTYPE
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE
from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE, _stage_batch
from nirmaan_stack.services.outflow_import.parser import parse_statement

ICICI = "ICICI Bank Statement"
_HEADER = (
    '"S.N.","Tran. Id","Value Date","Cheque. No./Ref. No.","Transaction Remarks",'
    '"Withdrawal Amt (INR)","Deposit Amt (INR)","Balance (INR)"'
)

# (remarks, withdrawal, deposit) -- every narration made up, shaped after the rule it exercises.
LINES = (
    ("MMT/IMPS/600900000001/TESTWALLETA/IDFB0020101", "1,000.00", ""),  # Cashfree top-up
    ("MMT/IMPS/600900000002/Cashbook Bal/IDFB0080101", "2,000.00", ""),  # Cashbook top-up
    ("MMT/IMPS/600900000003/Porter Topup/RATN0000156", "3,000.00", ""),  # Porter top-up
    ("MMT/IMPS/600900000004/CASHFREEIDFC/IDFB0020101", "", "400.00"),  # Cashfree money returned
    ("Ac xfr from gl 01234 to 56789", "5,000.00", ""),  # the bank's ledger move, out
    ("Ac xfr from gl 01234 to 56789", "", "5,000.00"),  # ... and back in
    ("BIL/BPAY/000900000001/BBPS/ICICI CRED/123456", "7,000.00", ""),  # card bill (BBPS)
    ("ATD/Auto Debit CC0xx4321", "8,000.00", ""),  # card auto-debit
    ("NEFT-RETURN-TESTVENDORBANK0001-TESTVENDOR TRADERS", "", "900.00"),  # a vendor payment bounced
    ("CMS/ CC RBI rounding", "", "2.00"),  # the bank's card rounding
    ("000900000001 FD clos 13-01-2026 TESTCO", "", "50,000.00"),  # FD closure
    ("TRF TO FD 000900000001", "60,000.00", ""),  # FD placement
    ("NEFT/TESTSUPPLIER STEEL/UTIB0000001", "11,000.00", ""),  # an ordinary vendor payment
)


def _statement(lines=LINES) -> bytes:
    body = [_HEADER]
    for n, (remarks, wd, dp) in enumerate(lines, start=1):
        body.append(f'"{n}","S9{n:07d}","{n:02d}/Feb/2026","","{remarks}","{wd}","{dp}","-1,00,000.00"')
    return ("\n".join(body) + "\n").encode()


def _parsed(lines=LINES):
    parsed = parse_statement(_statement(lines), source=ICICI)
    prefix = frappe.generate_hash(length=10)
    return replace(parsed, rows=tuple(replace(r, transfer_id=f"{prefix}-{r.transfer_id}") for r in parsed.rows))


class InternalTransferUploadFixture(unittest.TestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.batches = []

    def tearDown(self):
        frappe.db.rollback()
        for batch in self.batches:
            rows = frappe.get_all(ROW_DOCTYPE, filters={"import_batch": batch}, pluck="name")
            if rows:
                frappe.db.delete(INTERNAL_TRANSFER_DOCTYPE, {"import_row": ["in", rows]})
            frappe.db.delete(MATCH_DOCTYPE, {"import_batch": batch})
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": batch})
            frappe.db.delete(BATCH_DOCTYPE, {"name": batch})
        frappe.db.commit()
        super().tearDown()

    def _stage(self, parsed) -> str:
        batch = _stage_batch(parsed, file_url="/private/files/test-it.csv", filename="test-it.csv", user="Administrator")
        frappe.db.commit()
        self.batches.append(batch.name)
        return batch.name

    def _lines(self, batch) -> list[dict]:
        return frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch},
            fields=["name", "remarks", "direction", "row_status", "skip_kind", "amount"],
            order_by="transfer_id asc",
        )

    def _records(self, lines) -> dict:
        return {
            r["import_row"]: r
            for r in frappe.get_all(
                INTERNAL_TRANSFER_DOCTYPE,
                filters={"import_row": ["in", [l["name"] for l in lines]]},
                fields=["import_row", "from_place", "to_place", "detail", "direction", "amount", "made_by",
                        "reference", "source", "transfer_date"],
            )
        }


class TestAnIciciUploadRecordsInternalTransfers(InternalTransferUploadFixture):
    def test_each_internal_line_is_an_internal_transfer_with_one_record_filled_by_its_rule(self):
        batch = self._stage(_parsed())
        lines = self._lines(batch)
        records = self._records(lines)
        got = [
            (
                l["row_status"],
                records.get(l["name"], {}).get("from_place"),
                records.get(l["name"], {}).get("to_place"),
                records.get(l["name"], {}).get("detail"),
                records.get(l["name"], {}).get("direction"),
            )
            for l in lines
        ]
        self.assertEqual(
            got,
            [
                ("Internal Transfer", "ICICI Current Account", "Cashfree Wallet", None, "Out"),
                ("Internal Transfer", "ICICI Current Account", "Cashbook Virtual Account", None, "Out"),
                ("Internal Transfer", "ICICI Current Account", "Porter Wallet", None, "Out"),
                ("Internal Transfer", "Cashfree Wallet", "ICICI Current Account", None, "In"),
                ("Internal Transfer", "ICICI Current Account", "ICICI Bank Ledger", "GL 01234 to 56789", "Out"),
                ("Internal Transfer", "ICICI Bank Ledger", "ICICI Current Account", "GL 01234 to 56789", "In"),
                ("Internal Transfer", "ICICI Current Account", "ICICI Credit Card", None, "Out"),
                ("Internal Transfer", "ICICI Current Account", "ICICI Credit Card", "Card ending 4321", "Out"),
                ("Skipped", None, None, None, None),
                ("Skipped", None, None, None, None),
                ("Mismatched", None, None, None, None),
                ("Mismatched", None, None, None, None),
                ("Mismatched", None, None, None, None),
            ],
        )
        self.assertEqual(len(records), 8)

    def test_a_record_names_its_rule_its_bank_text_its_source_and_its_date(self):
        batch = self._stage(_parsed())
        lines = self._lines(batch)
        first = self._records(lines)[lines[0]["name"]]
        self.assertEqual(first["made_by"], "platform_cashfree")
        self.assertEqual(first["reference"], LINES[0][0])
        self.assertEqual(first["source"], ICICI)
        self.assertEqual(float(first["amount"]), 1000.0)
        self.assertEqual(str(first["transfer_date"]), "2026-02-01")

    def test_the_lines_that_are_not_ours_keep_todays_skip(self):
        batch = self._stage(_parsed())
        kinds = [l["skip_kind"] for l in self._lines(batch) if l["row_status"] == "Skipped"]
        self.assertEqual(kinds, ["Failed payment bounced back", "Bank card rounding (₹2)"])

    def test_a_status_changed_repeat_is_an_internal_transfer_line_with_no_second_record(self):
        parsed = _parsed()
        first = self._stage(parsed)
        again = replace(parsed, rows=tuple(replace(r, status_raw="REVERSED") for r in parsed.rows))
        second = self._stage(again)
        repeats = [l for l in self._lines(second) if l["row_status"] == "Internal Transfer"]
        self.assertEqual(len(repeats), 8)
        self.assertEqual(self._records(repeats), {})
        self.assertEqual(len(self._records(self._lines(first))), 8)


class TestTheRecordIsNeverEdited(InternalTransferUploadFixture):
    def test_saving_a_record_again_is_refused(self):
        batch = self._stage(_parsed())
        name = frappe.get_all(INTERNAL_TRANSFER_DOCTYPE, filters={"import_row": self._lines(batch)[0]["name"]},
                              pluck="name")[0]
        doc = frappe.get_doc(INTERNAL_TRANSFER_DOCTYPE, name)
        doc.detail = "changed"
        with self.assertRaises(frappe.ValidationError) as caught:
            doc.save(ignore_permissions=True)
        self.assertIn("never edited", str(caught.exception))

    def test_a_second_record_for_one_line_is_refused(self):
        batch = self._stage(_parsed())
        line = self._lines(batch)[0]["name"]
        doc = frappe.new_doc(INTERNAL_TRANSFER_DOCTYPE)
        doc.update({"import_row": line, "from_place": "ICICI Current Account", "to_place": "Cashfree Wallet",
                    "direction": "Out", "amount": 1})
        with self.assertRaises(frappe.UniqueValidationError):
            doc.insert(ignore_permissions=True)


class TestTheInternalTransfersTab(InternalTransferUploadFixture):
    def test_it_lists_both_directions_with_from_to_and_detail_and_its_count_matches_its_rows(self):
        from nirmaan_stack.api.outflow_import.review import get_outflow_rows

        batch = self._stage(_parsed())
        page = get_outflow_rows(scope="internal_transfers", batch=batch, limit=200, sort_by="added_on", sort_dir="asc")
        rows = page["rows"]
        self.assertEqual(page["tab_counts"]["internal_transfers"], len(rows))
        self.assertEqual(len(rows), 8)
        self.assertEqual({r["direction"] for r in rows}, {"Debit", "Credit"})
        gl_in = [r for r in rows if r["direction"] == "Credit" and "gl" in r["remarks"]][0]
        self.assertEqual(
            (gl_in["transfer_from"], gl_in["transfer_to"], gl_in["transfer_detail"]),
            ("ICICI Bank Ledger", "ICICI Current Account", "GL 01234 to 56789"),
        )

    def test_it_follows_the_period_filter(self):
        from nirmaan_stack.api.outflow_import.review import get_outflow_rows

        batch = self._stage(_parsed())
        page = get_outflow_rows(
            scope="internal_transfers", batch=batch, date_from="2026-02-01", date_to="2026-02-03", limit=200
        )
        self.assertEqual(len(page["rows"]), 3)
        self.assertEqual(page["tab_counts"]["internal_transfers"], 3)

    def test_the_matched_and_settled_tabs_and_the_skipped_popup_leave_these_lines_out(self):
        from nirmaan_stack.api.outflow_import.review import get_outflow_rows

        batch = self._stage(_parsed())
        for scope in ("matched_outflow", "settled_inflow", "skipped", "not_matched_outflow"):
            statuses = {r["row_status"] for r in get_outflow_rows(scope=scope, batch=batch, limit=200)["rows"]}
            self.assertNotIn("Internal Transfer", statuses, scope)


class TestTheDoctypeMatchesTheCode(unittest.TestCase):
    def test_from_and_to_offer_exactly_the_places(self):
        from nirmaan_stack.services.outflow_import.internal_transfers import PLACES

        meta = frappe.get_meta(INTERNAL_TRANSFER_DOCTYPE)
        for field in ("from_place", "to_place"):
            self.assertEqual(tuple(meta.get_field(field).options.split("\n")), PLACES, field)

    def test_the_line_status_select_carries_the_vocabulary(self):
        from nirmaan_stack.services.outflow_import.status import ROW_STATUSES

        options = frappe.get_meta(ROW_DOCTYPE).get_field("row_status").options.split("\n")
        self.assertEqual(tuple(options), ROW_STATUSES)

