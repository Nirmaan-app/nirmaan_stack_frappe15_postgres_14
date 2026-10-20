# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Pure: a Security Deposit cheque's rules (#1486, spec #1477, ADR-0035).

A deposit cheque is held as a guarantee: it pays nothing, may name the Vendor's POs and Work Orders it
secures (a "Secured PO/WO" line, record only), is Issued when recorded on a typed issue date and is
Cancelled only by hand with a note. It is never cleared, by hand or by the bank import.

No database. Run with `devenv.sh unit nirmaan_stack.services.cheques.test_deposit_rules`.
"""

import unittest

from nirmaan_stack.services.cheques import clear_rules, edit_rules, rules
from nirmaan_stack.services.cheques.rules import ChequeHeader

SD = "Security Deposit"
PAY = "Payment"
PO = "Procurement Orders"
WO = "Service Requests"
RP = "Reconciliation Pending"


def _secured(record_doctype=PO, record_name="PO/1/00012/26-27", project="PROJ-1", **extra):
    return rules.parse_line({"line_type": "Secured PO/WO", "project": project, "record_doctype": record_doctype,
                             "record_name": record_name, **extra})


def _header(**values):
    base = {"bank": "ICICI Bank", "bank_name": None, "cheque_no": "000760", "cheque_date": "2026-10-16",
            "amount": 200000, "vendor": "VEN-1", "payee_name": None, "description": None,
            "attachment": "/private/files/sd.jpg"}
    base.update(values)
    return ChequeHeader(**base)


class TestASecuredLineIsARecordOnly(unittest.TestCase):
    def test_it_names_a_po_or_work_order_and_carries_no_payment_and_no_amount(self):
        line = _secured(payment_name="PAY-1", amount=500)
        self.assertEqual(line.line_type, rules.LINE_SECURED_RECORD)
        self.assertEqual((line.record_doctype, line.record_name, line.project), (PO, "PO/1/00012/26-27", "PROJ-1"))
        self.assertIsNone(line.payment_name)
        self.assertIsNone(line.payment_doctype)
        self.assertEqual(line.amount, 0)

    def test_the_vendor_s_po_or_work_order_in_its_project_is_accepted(self):
        record = {"vendor": "VEN-1", "project": "PROJ-1"}
        self.assertIsNone(rules.secured_line_problem(_secured(), cheque_vendor="VEN-1", record=record))
        self.assertIsNone(rules.secured_line_problem(_secured(WO, "SR/1/00004/26-27"), cheque_vendor="VEN-1",
                                                     record=record))

    def test_a_typed_payee_secures_nothing(self):
        self.assertEqual(
            rules.secured_line_problem(_secured(), cheque_vendor=None, record={"vendor": "VEN-1", "project": "PROJ-1"}),
            "a cheque made out to a typed payee names no PO or Work Order.",
        )

    def test_another_vendor_s_record_or_a_missing_one_is_refused(self):
        self.assertEqual(rules.secured_line_problem(_secured(), cheque_vendor="VEN-1", record=None),
                         "PO/1/00012/26-27 was not found.")
        self.assertEqual(
            rules.secured_line_problem(_secured(), cheque_vendor="VEN-1", record={"vendor": "VEN-2", "project": "PROJ-1"}),
            "PO/1/00012/26-27 is not a PO or Work Order of this cheque's Vendor.",
        )
        self.assertEqual(
            rules.secured_line_problem(_secured(record_doctype=None), cheque_vendor="VEN-1", record=None),
            "pick the PO or Work Order.",
        )


class TestWhichLinesEachTypeTakes(unittest.TestCase):
    def test_a_deposit_cheque_takes_secured_lines_only(self):
        self.assertIsNone(rules.line_kind_problem(_secured(), cheque_type=SD))
        payment_line = rules.parse_line({"line_type": "PO/WO Payment", "record_doctype": PO, "record_name": "PO-1",
                                         "project": "PROJ-1", "payment_name": "PAY-1", "amount": 10})
        self.assertEqual(
            rules.line_kind_problem(payment_line, cheque_type=SD),
            "a Security Deposit cheque pays nothing: its lines only name the POs and Work Orders it secures.",
        )

    def test_a_payment_cheque_takes_no_secured_line(self):
        self.assertEqual(
            rules.line_kind_problem(_secured(), cheque_type=PAY),
            "only a Security Deposit cheque names a PO or Work Order it secures.",
        )


class TestADepositCheque_sHeader(unittest.TestCase):
    def test_it_needs_no_lines_and_no_description(self):
        self.assertIsNone(rules.header_problem(_header(), line_count=0, photo_required=True, cheque_type=SD))

    def test_a_payment_cheque_with_no_lines_still_needs_a_description(self):
        self.assertIn("Ad-hoc", rules.header_problem(_header(), line_count=0, photo_required=True, cheque_type=PAY))

    def test_a_typed_payee_and_the_photo_follow_the_header_rules(self):
        self.assertIsNone(rules.header_problem(_header(vendor=None, payee_name="Kavitha Properties"), line_count=0,
                                               photo_required=True, cheque_type=SD))
        self.assertEqual(rules.header_problem(_header(attachment=None), line_count=0, photo_required=True,
                                              cheque_type=SD), "Upload the photo of the cheque.")

    def test_the_issue_date_is_required_and_never_after_today(self):
        self.assertEqual(clear_rules.issue_date_problem(None, today="2026-10-16"), "Enter the issue date: the day it was handed over.")
        self.assertEqual(clear_rules.issue_date_problem("2026-10-17", today="2026-10-16"), "The issue date cannot be after today.")
        self.assertIsNone(clear_rules.issue_date_problem("2026-10-16", today="2026-10-16"))
        self.assertIsNone(clear_rules.issue_date_problem("2026-01-02", today="2026-10-16"))


class TestEditingADepositCheque(unittest.TestCase):
    def test_procurement_edits_its_own_deposit_while_issued(self):
        own = {"owner": "p@x", "user": "p@x", "any_cheque": False, "cheque_type": SD}
        self.assertIsNone(edit_rules.edit_access_problem(status="Issued", **own))
        self.assertIsNotNone(edit_rules.edit_access_problem(status="Cancelled", **own))
        self.assertIsNotNone(edit_rules.edit_access_problem(status="Issued", **{**own, "owner": "q@x"}))

    def test_procurement_edits_its_own_payment_cheque_only_while_pending(self):
        own = {"owner": "p@x", "user": "p@x", "any_cheque": False, "cheque_type": PAY}
        self.assertIsNone(edit_rules.edit_access_problem(status="Approval Pending", **own))
        self.assertIsNotNone(edit_rules.edit_access_problem(status="Issued", **own))

    def test_an_issued_deposit_changes_in_full_and_a_cancelled_one_only_its_photo(self):
        before, after = _header(), _header(amount=150000, attachment="/private/files/new.jpg")
        lines = [_secured()]
        self.assertIsNone(edit_rules.edit_problem(before, after, status="Issued", made_from="Report", lines_before=[],
                                             lines_after=lines, cheque_type=SD))
        self.assertEqual(
            edit_rules.edit_problem(before, after, status="Cancelled", made_from="Report", lines_before=[],
                               lines_after=[], cheque_type=SD),
            "Cheque 000760 is Cancelled: only its photo can change.",
        )
        photo_only = _header(attachment="/private/files/new.jpg")
        self.assertIsNone(edit_rules.edit_problem(before, photo_only, status="Cancelled", made_from="Report",
                                             lines_before=lines, lines_after=lines, cheque_type=SD))


class TestCancellingADepositCheque(unittest.TestCase):
    def test_only_an_issued_deposit_is_cancelled(self):
        self.assertIsNone(clear_rules.deposit_cancel_problem(status="Issued", cheque_type=SD))
        self.assertEqual(clear_rules.deposit_cancel_problem(status="Cancelled", cheque_type=SD), "already Cancelled")
        self.assertEqual(clear_rules.deposit_cancel_problem(status="Issued", cheque_type=PAY),
                         "it is a Payment cheque, not a Security Deposit")


class TestADepositIsNeverCleared(unittest.TestCase):
    """Story 57: the bank import never matches a deposit; neither does a hand clear."""

    def test_no_way_of_clearing_starts_from_any_deposit_status(self):
        for cleared_by in rules.CLEARED_BY:
            for status in rules.CHEQUE_STATUSES:
                self.assertEqual(
                    clear_rules.clear_problem(status=status, cheque_type=SD, old_type=False, cleared_by=cleared_by,
                                        payments=[], bank_line=cleared_by == rules.CLEARED_BY_BANK_IMPORT),
                    "a Security Deposit cheque is never cashed",
                    (cleared_by, status),
                )

    def test_a_bank_line_with_its_number_and_amount_still_clears_nothing(self):
        line = clear_rules.BankLine(name="OFR-1", source=clear_rules.ICICI_STATEMENT_SOURCE, direction="Debit",
                              row_status="Mismatched", reference_id="760", amount=200000)
        self.assertTrue(clear_rules.bank_line_matches(line, cheque_no="000760", amount=200000))
        self.assertEqual(
            clear_rules.clear_problem(status="Issued", cheque_type=SD, old_type=False,
                                cleared_by=rules.CLEARED_BY_BANK_IMPORT, payments=[], bank_line=True),
            "a Security Deposit cheque is never cashed",
        )


if __name__ == "__main__":
    unittest.main()
