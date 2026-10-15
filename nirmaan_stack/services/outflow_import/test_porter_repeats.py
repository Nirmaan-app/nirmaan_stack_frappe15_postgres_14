# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Re-uploading a Porter Statement: the invoice-level repeat rules (#1447, ADR-0032, ADR-0031's shape).

    devenv.sh unit nirmaan_stack.services.outflow_import.test_porter_repeats

The synthetic fixture holds four invoices: 29SS27A0900001 (5 orders), 24SS27A0900002 (2),
29SM27A0900003 (2) and 36SM27A0900004 (3, one cancelled) -- 12 orders in all.
"""

import unittest
from decimal import Decimal

from nirmaan_stack.services.outflow_import.porter_repeats import (
    HeldInvoice,
    PorterRepeatRefusal,
    leave_out_repeats,
)
from nirmaan_stack.services.outflow_import.test_porter import _statement

FIRST, SECOND, THIRD, FOURTH = "29SS27A0900001", "24SS27A0900002", "29SM27A0900003", "36SM27A0900004"


def _crns(*numbers: int) -> frozenset:
    return frozenset(f"CRN9000000000{n:02d}" for n in numbers)


def _created(number: str, crns: frozenset, batch: str = "OFI-26-00001") -> HeldInvoice:
    return HeldInvoice(invoice_number=number, import_batch=batch, created=True, crns=crns)


def _uncreated(number: str, crns: frozenset, batch: str = "OFI-26-00002") -> HeldInvoice:
    return HeldInvoice(invoice_number=number, import_batch=batch, created=False, crns=crns)


class TestAFileWithNothingSeenBefore(unittest.TestCase):
    def test_every_invoice_is_kept_and_nothing_is_counted(self):
        statement = _statement()
        judged = leave_out_repeats(statement, {})
        self.assertEqual(judged.statement, statement)
        self.assertEqual(judged.left_out, ())
        self.assertEqual(judged.repeats_not_saved, 0)


class TestAnInvoiceAlreadyCreated(unittest.TestCase):
    def setUp(self):
        self.held = {
            FIRST: _created(FIRST, _crns(1, 2, 3, 4, 5)),
            FOURTH: _created(FOURTH, _crns(10, 11, 12)),
        }
        self.judged = leave_out_repeats(_statement(), self.held)

    def test_it_is_left_out_and_the_new_invoices_are_kept(self):
        self.assertEqual(self.judged.left_out, (FIRST, FOURTH))
        self.assertEqual(
            [invoice.invoice_number for invoice in self.judged.statement.invoices], [SECOND, THIRD]
        )
        self.assertEqual(
            [line.crn for line in self.judged.statement.lines],
            ["CRN900000000006", "CRN900000000007", "CRN900000000008", "CRN900000000009"],
        )

    def test_its_orders_are_counted_as_not_saved_cancelled_one_included(self):
        self.assertEqual(self.judged.repeats_not_saved, 5 + 3)

    def test_the_kept_statement_is_dated_and_totalled_over_what_is_kept(self):
        kept = self.judged.statement
        # 251 + 528 + 456 + 300, from 1 Sep (CRN 6) to 30 Sep (CRN 9).
        self.assertEqual(kept.fare_total, Decimal("1535"))
        self.assertEqual(str(kept.period_from), "2026-09-01")
        self.assertEqual(str(kept.period_to), "2026-09-30")

    def test_the_same_orders_in_a_new_order_still_count_as_the_same_invoice(self):
        held = {SECOND: _created(SECOND, frozenset(reversed(sorted(_crns(6, 7)))))}
        self.assertEqual(leave_out_repeats(_statement(), held).left_out, (SECOND,))


class TestAnAlreadyCreatedInvoiceListingDifferentOrders(unittest.TestCase):
    def test_an_order_added_to_it_blocks_the_upload_naming_the_invoice_and_the_order(self):
        held = {FIRST: _created(FIRST, _crns(1, 2, 3, 4))}
        with self.assertRaises(PorterRepeatRefusal) as caught:
            leave_out_repeats(_statement(), held)
        message = str(caught.exception)
        self.assertIn(f"Invoice {FIRST}", message)
        self.assertIn("OFI-26-00001", message)
        self.assertIn("CRN900000000005", message)
        self.assertIn("different orders", message)

    def test_an_order_dropped_from_it_blocks_too(self):
        held = {SECOND: _created(SECOND, _crns(6, 7, 13))}
        with self.assertRaises(PorterRepeatRefusal) as caught:
            leave_out_repeats(_statement(), held)
        self.assertIn(f"Invoice {SECOND}", str(caught.exception))
        self.assertIn("CRN900000000013", str(caught.exception))

    def test_it_blocks_even_when_the_file_also_holds_new_invoices(self):
        held = {
            FIRST: _created(FIRST, _crns(1, 2, 3, 4, 5)),
            SECOND: _created(SECOND, _crns(6)),
        }
        with self.assertRaises(PorterRepeatRefusal) as caught:
            leave_out_repeats(_statement(), held)
        self.assertIn(SECOND, str(caught.exception))
        self.assertNotIn(f"Invoice {FIRST}", str(caught.exception))


class TestAnInvoiceHeldByAnImportNeverCreated(unittest.TestCase):
    def test_it_blocks_the_upload_with_open_it_or_discard_it(self):
        held = {THIRD: _uncreated(THIRD, _crns(8, 9))}
        with self.assertRaises(PorterRepeatRefusal) as caught:
            leave_out_repeats(_statement(), held)
        message = str(caught.exception)
        self.assertIn("Already uploaded in OFI-26-00002: open it or discard it", message)
        self.assertIn(THIRD, message)

    def test_each_holding_import_is_named_once_with_its_invoices(self):
        held = {
            FIRST: _uncreated(FIRST, _crns(1, 2, 3, 4, 5)),
            SECOND: _uncreated(SECOND, _crns(6, 7)),
            FOURTH: _uncreated(FOURTH, _crns(10, 11, 12), batch="OFI-26-00003"),
        }
        with self.assertRaises(PorterRepeatRefusal) as caught:
            leave_out_repeats(_statement(), held)
        message = str(caught.exception)
        self.assertEqual(message.count("Already uploaded in OFI-26-00002"), 1)
        self.assertIn(f"invoices {FIRST}, {SECOND}", message)
        self.assertIn("Already uploaded in OFI-26-00003", message)


class TestAFileWithNothingNew(unittest.TestCase):
    def test_a_file_of_only_already_created_invoices_is_refused(self):
        held = {
            FIRST: _created(FIRST, _crns(1, 2, 3, 4, 5)),
            SECOND: _created(SECOND, _crns(6, 7)),
            THIRD: _created(THIRD, _crns(8, 9), batch="OFI-26-00004"),
            FOURTH: _created(FOURTH, _crns(10, 11, 12)),
        }
        with self.assertRaises(PorterRepeatRefusal) as caught:
            leave_out_repeats(_statement(), held, filename="porter-sep.csv")
        message = str(caught.exception)
        self.assertIn("Not imported", message)
        self.assertIn("All 4 invoices in 'porter-sep.csv'", message)
        self.assertIn("OFI-26-00001, OFI-26-00004", message)


if __name__ == "__main__":
    unittest.main()
