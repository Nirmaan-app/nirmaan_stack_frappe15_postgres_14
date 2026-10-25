# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The one-time cut of the old PO payments that carry a tax record to net (#1534, ADR-0034 Amendment B).

`patches/v3_0/net_po_payments_with_tds`: each PO payment still stored gross with its legacy `tds` box
filled and a tax record beside it is cut to gross - tax and its box cleared, so its tax counts on top as a
Work Order's does. A payment matched to a bank line, or carrying tax of ₹5 or less, is skipped and
listed. The run aborts, writing nothing, unless every touched PO's Amount Paid, Amount Due and vendor
credit, and every touched project's outflow, are what they were. A second run changes nothing.

Worked by hand: a PO worth ₹1,18,000 paid ₹1,00,000 with ₹100 tax recorded is cut to ₹99,900; its
Amount Paid stays ₹1,00,000 and its Amount Due ₹18,000.
"""

import contextlib
import io
import unittest
from pathlib import Path

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.payments.taxed_po_fixture import PAYMENT, PO, TaxedPoFixture
from nirmaan_stack.api.vendor.get_vendor_po_invoices import get_po_ledger_data
from nirmaan_stack.api.vendor_credit import recalculate_vendor_credit
from nirmaan_stack.patches.v3_0 import net_po_payments_with_tds as patch
from nirmaan_stack.services.amount_paid_drift import mismatches
from nirmaan_stack.services.project_money import project_money_of


class NettingFixture(FrappeTestCase):
    PREFIX = "TEST-1534P"

    def setUp(self):
        frappe.set_user("Administrator")
        self.fx = TaxedPoFixture(self.PREFIX)
        # Cut: ₹1,00,000 gross, ₹100 tax, in a challan.
        self.po = self.fx.po(value=118000, paid=100000)
        self.cut = self.fx.old_payment(self.po, gross=100000, tds=100, challan=self.fx.challan(100))
        # Skipped: tax of ₹5 or less.
        self.tiny_po = self.fx.po(value=5900, paid=4720)
        self.tiny = self.fx.old_payment(self.tiny_po, gross=4720, tds=4.72)
        # Skipped: matched to a bank line.
        self.matched_po = self.fx.po(value=59000, paid=50000)
        self.matched = self.fx.old_payment(self.matched_po, gross=50000, tds=50)
        self.fx.bank_match(self.matched)
        self.pos = [self.po, self.tiny_po, self.matched_po]

    def tearDown(self):
        frappe.set_user("Administrator")
        self.fx.purge()

    def payment(self, name):
        return frappe.db.get_value(PAYMENT, name, ["amount", "tds"])

    def stored(self, po):
        return tuple(flt(v, 2) for v in frappe.db.get_value(PO, po, ["amount_paid", "amount_due"]))

    def credit(self):
        return tuple(flt(v, 2) for v in frappe.db.get_value("Vendors", self.fx.vendor, ["credit_used", "available_credit"]))

    def quietly(self, fn, *args, **kwargs):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            result = fn(*args, **kwargs)
        return result, out.getvalue()


class TheDryRun(NettingFixture):
    def test_it_lists_the_payments_it_would_cut_and_the_ones_it_skips_and_writes_nothing(self):
        modified = frappe.db.get_value(PAYMENT, self.cut, "modified")

        plan, printed = self.quietly(patch.preview, pos=self.pos)

        self.assertEqual([(c.payment, c.po, c.tds) for c in plan.cut], [(self.cut, self.po, 100.0)])
        self.assertEqual(
            sorted((s.payment, s.reason) for s in plan.skipped),
            sorted([(self.tiny, patch.SKIP_TINY_TAX), (self.matched, patch.SKIP_BANK_MATCHED)]),
        )
        for name in (self.cut, self.tiny, self.matched):
            self.assertIn(name, printed)
        self.assertEqual(self.payment(self.cut), (100000.0, "100"))
        self.assertEqual(frappe.db.get_value(PAYMENT, self.cut, "modified"), modified)


class TheRun(NettingFixture):
    def test_it_cuts_to_net_clears_the_box_and_nothing_moves(self):
        project_outflow = flt(project_money_of(self.fx.project).outflow, 2)
        recalculate_vendor_credit(self.fx.vendor, "TEST 1534")  # the stored credit right, as production keeps it
        frappe.db.commit()
        credit = self.credit()

        plan, _ = self.quietly(patch.execute, pos=self.pos)

        self.assertEqual([c.payment for c in plan.cut], [self.cut])
        self.assertEqual(self.payment(self.cut), (99900.0, None))
        self.assertEqual(self.payment(self.tiny), (4720.0, "4.72"))
        self.assertEqual(self.payment(self.matched), (50000.0, "50"))
        self.assertEqual(self.stored(self.po), (100000.0, 18000.0))
        self.assertEqual(self.credit(), credit)
        self.assertEqual(flt(project_money_of(self.fx.project).outflow, 2), project_outflow)
        self.assertEqual(mismatches(PO, self.pos), [])
        ledger = {r["details"].split("For PO: ")[1].split("\n")[0]: r["payment"]
                  for r in get_po_ledger_data(self.fx.vendor) if r["type"] == "Payment Made"}
        self.assertEqual(ledger, {self.po: 100000.0, self.tiny_po: 4720.0, self.matched_po: 50000.0})

    def test_a_second_run_changes_nothing(self):
        self.quietly(patch.execute, pos=self.pos)
        frappe.db.commit()
        modified = frappe.db.get_value(PO, self.po, "modified")

        plan, _ = self.quietly(patch.execute, pos=self.pos)

        self.assertEqual(plan.cut, [])
        self.assertEqual(len(plan.skipped), 2)
        self.assertEqual(self.payment(self.cut), (99900.0, None))
        self.assertEqual(frappe.db.get_value(PO, self.po, "modified"), modified)

    def test_a_vendor_with_many_touched_pos_gets_one_credit_entry_naming_them_all(self):
        # The env copy's run found a vendor with 43 touched POs: their names overflow the entry's `po_id`.
        many = [self.fx.po(value=11800, paid=10000) for _ in range(7)]
        for po in many:
            self.fx.old_payment(po, gross=10000, tds=10)

        self.quietly(patch.execute, pos=many)

        (entry,) = frappe.get_all("Vendor Credit Ledger", filters={"parent": self.fx.vendor,
                                  "entry_type": patch.CREDIT_ENTRY}, fields=["po_id", "description"])
        self.assertEqual(entry.po_id, "7 POs")
        for po in many:
            self.assertIn(po, entry.description)

    def test_it_aborts_and_writes_nothing_when_a_touched_po_would_move(self):
        # Stored ₹90,000 though ₹1,00,000 was paid: the recount would move it, so nothing may be written.
        stale = self.fx.po(value=118000, paid=90000)
        payment = self.fx.old_payment(stale, gross=100000, tds=100)

        with self.assertRaisesRegex(frappe.ValidationError, stale):
            self.quietly(patch.execute, pos=self.pos + [stale])

        self.assertEqual(self.payment(payment), (100000.0, "100"))
        self.assertEqual(self.payment(self.cut), (100000.0, "100"))
        self.assertEqual(self.stored(stale), (90000.0, 28000.0))


class WhenItRuns(unittest.TestCase):
    """Every data change previews first on current data (owner rule, spec #1528): the money patch runs by
    hand only, never on migrate; the approval backfill (blanks only, no money) runs on migrate."""

    def test_migrate_runs_the_approval_backfill_but_not_the_money_patch(self):
        lines = (Path(__file__).resolve().parents[1] / "patches.txt").read_text().split()
        self.assertFalse("nirmaan_stack.patches.v3_0.net_po_payments_with_tds" in lines, "migrate would cut money")
        self.assertTrue("nirmaan_stack.patches.v3_0.backfill_work_order_approval" in lines, "backfill not on migrate")
