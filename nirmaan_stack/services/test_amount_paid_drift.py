# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the judge of "is this order's stored Amount Paid right" (ADR-0034).

Source = the order's Paid Project Payments, plus (a Work Order's) the TDS withheld from the vendor on
them, less its Received Vendor Refunds (`amount_paid_of`, ADR-0034 Amendment A); Amount Due is built from
it with the order's own formula (PO: invoiced - paid; WO: total - paid). An order is a mismatch when a
stored figure (a Work Order's `total_tds` too, read against its deduction rows) is ₹1 or more off. A mismatch is recounted from source,
with a PO's vendor credit; an order already right is left alone. Fixtures are raw-SQL rows on a real
vendor, purged by name; the vendor's credit is put back.
"""

import unittest

import frappe
from frappe.utils import flt

from nirmaan_stack.api.vendor_refunds import credit_fixture, po_refund_fixture
from nirmaan_stack.services.amount_paid_drift import (
    drifted_pos,
    mismatches,
    recount,
    recount_pos,
)

PO = "Procurement Orders"
WO = "Service Requests"
PAYMENT = "Project Payments"
REFUNDS = "Vendor Refunds"
LEDGER = "Vendor Credit Ledger"
DEDUCTIONS = "Payment TDS Deduction"
ENTRY = "TEST Amount Paid Recount"


class OrdersFixture(unittest.TestCase):
    """Raw-SQL POs and WOs with Paid payments and refunds, on a real vendor; purged by name.

    Shared by the integrity tests (`test_amount_paid_integrity`), which drive real saves on top of it.
    """

    PREFIX = "TEST-RECOUNT"

    def setUp(self):
        frappe.set_user("Administrator")
        # The rows are raw SQL, so the project is only a label; the vendor must be real, with the
        # credit limit its credit recount reads.
        self.project = f"{self.PREFIX}-PROJECT"
        self.vendor = frappe.db.get_value("Vendors", {"credit_limit": [">", 0]}, "name")
        self.orders = {PO: [], WO: []}
        self.credit = credit_fixture.snapshot([self.vendor])
        frappe.db.commit()

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        names = self.orders[PO] + self.orders[WO]
        refunds = frappe.get_all(REFUNDS, {"document_name": ["in", names or ["-"]]}, pluck="name")
        payments = frappe.get_all(PAYMENT, {"document_name": ["in", names or ["-"]]}, pluck="name")
        po_refund_fixture.purge(
            [
                ("Version", lambda: frappe.db.delete(
                    "Version", {"docname": ["in", refunds + payments + names or ["-"]]})),
                (REFUNDS, lambda: refunds and frappe.db.delete(REFUNDS, {"name": ["in", refunds]})),
                (DEDUCTIONS, lambda: frappe.db.delete(DEDUCTIONS, {"document_name": ["in", names or ["-"]]})),
                (PAYMENT, lambda: payments and frappe.db.delete(PAYMENT, {"name": ["in", payments]})),
                ("PO Payment Terms", lambda: self.orders[PO] and frappe.db.delete(
                    "PO Payment Terms", {"parent": ["in", self.orders[PO]]})),
                (PO, lambda: self.orders[PO] and frappe.db.delete(PO, {"name": ["in", self.orders[PO]]})),
                (WO, lambda: self.orders[WO] and frappe.db.delete(WO, {"name": ["in", self.orders[WO]]})),
                ("vendor credit", lambda: credit_fixture.restore(self.credit)),
            ]
        )

    # ── fixture ─────────────────────────────────────────────────────────────────

    def _po(self, stored_paid, payments=(), total=1000.0, invoiced=None, stored_due=None, project=None):
        """A PO worth and invoiced `total` (or `invoiced`), storing `stored_paid` and an Amount Due
        right for it (or `stored_due`), with one Paid payment per amount."""
        invoiced = total if invoiced is None else invoiced
        due = invoiced - stored_paid if stored_due is None else stored_due
        po = f"{self.PREFIX}-PO-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{PO}"
                    (name, creation, modified, modified_by, owner, docstatus, idx, project, vendor,
                     amount_paid, total_amount, amount_invoiced, amount_due, status)
                VALUES (%s, '2026-01-01', '2026-01-01', 'Administrator', 'Administrator', 0, 0, %s, %s,
                        %s, %s, %s, %s, 'Delivered')""",
            (po, project or self.project, self.vendor, stored_paid, total, invoiced, due),
        )
        self.orders[PO].append(po)
        for amount in payments:
            self._payment(PO, po, amount)
        frappe.db.commit()
        return po

    def _wo(self, stored_paid, payments=(), total=1000.0, tds=0.0, stored_due=None, project=None, categories=()):
        """A Work Order worth `total`, raised under `categories`, storing `stored_paid`, `tds` as its
        `total_tds` and an Amount Due right for them (or `stored_due`), with one Paid payment per amount."""
        due = total - stored_paid if stored_due is None else stored_due
        wo = f"{self.PREFIX}-WO-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{WO}"
                    (name, creation, modified, modified_by, owner, docstatus, idx, project, vendor,
                     amount_paid, total_amount, total_tds, amount_due, status, service_category_list)
                VALUES (%s, '2026-01-01', '2026-01-01', 'Administrator', 'Administrator', 0, 0, %s, %s,
                        %s, %s, %s, %s, 'Approved', %s)""",
            (wo, project or self.project, self.vendor, stored_paid, total, tds, due,
             frappe.as_json({"list": [{"name": c} for c in categories]})),
        )
        self.orders[WO].append(wo)
        for amount in payments:
            self._payment(WO, wo, amount)
        frappe.db.commit()
        return wo

    def _payment(self, doctype, order, amount, status="Paid", project=None):
        name = f"{self.PREFIX}-PAY-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{PAYMENT}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     document_type, document_name, project, vendor, amount, status, payment_date)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                        %s, %s, %s, %s, %s, %s, CURRENT_DATE)""",
            (name, doctype, order, project or self.project, self.vendor, amount, status),
        )
        frappe.db.commit()
        return name

    def _taxed_payment(self, order, amount, gross, tds, borne_by="Vendor", project=None):
        """A Paid Work Order payment of `amount` with a deduction of `tds` taken on `gross`, borne by
        `borne_by`: `amount` is `gross - tds` when the tax was withheld from the vendor, `gross` when
        the company bore it and the payment was kept whole."""
        project = project or self.project
        payment = self._payment(WO, order, amount, project=project)
        frappe.db.sql(
            f"""INSERT INTO "tab{DEDUCTIONS}"
                    (name, creation, modified, modified_by, owner, docstatus, idx, project_payment,
                     document_type, document_name, vendor, project, gross_amount, tds_percentage,
                     tds_amount, payment_approved_on, borne_by)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s,
                        %s, %s, %s, %s, %s, 1, %s, CURRENT_DATE, %s)""",
            (f"{self.PREFIX}-PTD-{frappe.generate_hash(length=10)}", payment, WO, order, self.vendor,
             project, gross, tds, borne_by),
        )
        frappe.db.commit()
        return payment

    def _refund(self, doctype, order, amount, status):
        name = f"{self.PREFIX}-VRF-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{REFUNDS}"
                    (name, creation, modified, modified_by, owner, docstatus, idx, vendor, project,
                     document_type, document_name, status, amount, payment_date, waiting_created_by)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s,
                        %s, %s, %s, %s, CURRENT_DATE, 'Administrator')""",
            (name, self.vendor, self.project, doctype, order, status, amount),
        )
        frappe.db.commit()
        return name

    def _stored(self, doctype, order):
        values = frappe.db.get_value(doctype, order, ["amount_paid", "amount_due"], as_dict=True)
        return flt(values.amount_paid, 2), flt(values.amount_due, 2)

    def assertRight(self, doctype, *orders):
        """The judge finds nothing wrong with these orders."""
        self.assertEqual(mismatches(doctype, orders), [])


class FindingMismatches(OrdersFixture):
    def test_finds_a_po_whose_stored_paid_is_off_by_a_rupee_or_more_and_writes_nothing(self):
        stale = self._po(stored_paid=400, payments=[600, 400])
        paisa = self._po(stored_paid=999.5, payments=[1000])
        right = self._po(stored_paid=1000, payments=[1000])

        found = mismatches(PO, [stale, paisa, right])

        self.assertEqual(
            [(m.name, m.stored_paid, m.correct_paid, m.stored_due, m.correct_due) for m in found],
            [(stale, 400.0, 1000.0, 600.0, 0.0)],
        )
        self.assertEqual(self._stored(PO, stale), (400.0, 600.0))

    def test_finds_a_po_whose_paid_is_right_but_whose_amount_due_is_off(self):
        po = self._po(stored_paid=1000, payments=[1000], invoiced=1500, stored_due=0)

        found = mismatches(PO, [po])

        self.assertEqual([(m.name, m.stored_due, m.correct_due) for m in found], [(po, 0.0, 500.0)])

    def test_a_row_carries_the_order_project_vendor_and_status(self):
        po = self._po(stored_paid=0, payments=[700])

        (row,) = mismatches(PO, [po])

        self.assertEqual(
            (row.doctype, row.name, row.project, row.vendor, row.status, row.paid_difference),
            (PO, po, self.project, self.vendor, "Delivered", 700.0),
        )

    def test_a_received_refund_is_part_of_the_source_and_a_waiting_one_is_not(self):
        received = self._po(stored_paid=1000, payments=[1000])
        self._refund(PO, received, 200, "Received")
        waiting = self._po(stored_paid=1000, payments=[1000])
        self._refund(PO, waiting, 200, "Reconciliation Pending")

        found = mismatches(PO, [received, waiting])

        self.assertEqual([(m.name, m.correct_paid) for m in found], [(received, 800.0)])

    def test_a_po_netted_by_its_received_refund_is_right(self):
        po = self._po(stored_paid=800, payments=[1000])
        self._refund(PO, po, 200, "Received")

        self.assertRight(PO, po)

    def test_finds_a_work_order_off_on_paid_or_due_with_the_vendors_tax_in_its_paid(self):
        # 490 reached the vendor and 10 was withheld for them: 500 is paid, 500 is due.
        stale = self._wo(stored_paid=0, tds=10)
        self._taxed_payment(stale, 490, gross=500, tds=10)
        due_off = self._wo(stored_paid=500, tds=10, stored_due=510)
        self._taxed_payment(due_off, 490, gross=500, tds=10)
        right = self._wo(stored_paid=500, tds=10)
        self._taxed_payment(right, 490, gross=500, tds=10)

        found = mismatches(WO, [stale, due_off, right])

        self.assertEqual(
            sorted((m.name, m.stored_paid, m.correct_paid, m.stored_due, m.correct_due) for m in found),
            sorted([(stale, 0.0, 500.0, 1000.0, 500.0), (due_off, 500.0, 500.0, 510.0, 500.0)]),
        )

    def test_a_work_order_stored_without_its_vendors_tax_is_a_mismatch(self):
        # SR-00041-000138: Miscellaneous only, but paid in 2025, before the company-borne rule, so the
        # 248 TDS came out of the vendor's payment (24,800 -> 24,552 + 248). Paid is 24,800, due 0;
        # the rule before ADR-0034 Amendment A stored 24,552.
        right = self._wo(stored_paid=24800, total=24800, tds=248, categories=["Miscellaneous Services"])
        self._taxed_payment(right, 24552, gross=24800, tds=248)
        stale = self._wo(stored_paid=24552, total=24800, tds=248, stored_due=0, categories=["Miscellaneous Services"])
        self._taxed_payment(stale, 24552, gross=24800, tds=248)

        found = mismatches(WO, [right, stale])

        self.assertEqual(
            [(m.name, m.stored_paid, m.correct_paid, m.stored_due, m.correct_due) for m in found],
            [(stale, 24552.0, 24800.0, 0.0, 0.0)],
        )

    def test_a_work_order_whose_stored_tds_drifted_from_its_deductions_is_a_mismatch(self):
        # Paid and due are right, but `total_tds` says 0 while the deduction rows say 248. Under a
        # rupee is paisa rounding.
        drifted = self._wo(stored_paid=24800, total=24800, tds=0)
        self._taxed_payment(drifted, 24552, gross=24800, tds=248)
        paisa = self._wo(stored_paid=24800, total=24800, tds=247.5)
        self._taxed_payment(paisa, 24552, gross=24800, tds=248)

        found = mismatches(WO, [drifted, paisa])

        self.assertEqual(
            [(m.name, m.stored_paid, m.correct_paid, m.stored_tds, m.correct_tds) for m in found],
            [(drifted, 24800.0, 24800.0, 0.0, 248.0)],
        )

    def test_a_deduction_the_company_bore_leaves_its_tax_out(self):
        # SR-00203-001113: Miscellaneous only, approved after the rule, so the payment stayed 12,000 and
        # the company pays the 240 TDS on top. Paid is 12,000, due 0; -240 counted the tax as well.
        right = self._wo(stored_paid=12000, total=12000, tds=240, stored_due=0,
                         categories=["Miscellaneous Services", "Transportation Services"])
        self._taxed_payment(right, 12000, gross=12000, tds=240, borne_by="Company")
        stale = self._wo(stored_paid=12000, total=12000, tds=240, stored_due=-240, categories=["Miscellaneous Services"])
        self._taxed_payment(stale, 12000, gross=12000, tds=240, borne_by="Company")
        # The deduction says who bore it, not today's categories: this WO gained Electrical afterwards.
        recategorised = self._wo(stored_paid=12000, total=12000, tds=240, stored_due=0,
                                 categories=["Miscellaneous Services", "Electrical Services"])
        self._taxed_payment(recategorised, 12000, gross=12000, tds=240, borne_by="Company")

        found = mismatches(WO, [right, stale, recategorised])

        self.assertEqual([(m.name, m.stored_due, m.correct_due) for m in found], [(stale, -240.0, 0.0)])

    def test_a_work_order_with_both_kinds_counts_only_the_withheld_tax_as_paid(self):
        # SR-00107-001055: 120 withheld from a 6,000 payment, 282.40 paid on top of a 14,120 one.
        # Paid is 5,880 + 120 + 14,120 = 20,120; due 0.
        right = self._wo(stored_paid=20120, total=20120, tds=402.4, categories=["Miscellaneous Services"])
        self._taxed_payment(right, 5880, gross=6000, tds=120)
        self._taxed_payment(right, 14120, gross=14120, tds=282.4, borne_by="Company")
        # Both taxes counted as paid.
        stale = self._wo(stored_paid=20402.4, total=20120, tds=402.4, categories=["Miscellaneous Services"])
        self._taxed_payment(stale, 5880, gross=6000, tds=120)
        self._taxed_payment(stale, 14120, gross=14120, tds=282.4, borne_by="Company")

        found = mismatches(WO, [right, stale])

        self.assertEqual(
            [(m.name, m.stored_paid, m.correct_paid, m.correct_due) for m in found],
            [(stale, 20402.4, 20120.0, 0.0)],
        )

    def test_with_no_names_it_reads_every_order_of_the_doctype(self):
        stale = self._po(stored_paid=0, payments=[300])
        right = self._po(stored_paid=300, payments=[300])

        names = {m.name for m in mismatches(PO)}

        self.assertIn(stale, names)
        self.assertNotIn(right, names)

    def test_any_other_doctype_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            mismatches("Project Expenses")


class RecountingOneOrder(OrdersFixture):
    def test_recount_of_a_po_sets_paid_and_due_and_recounts_its_vendors_credit(self):
        po = self._po(stored_paid=0, payments=[500])

        before = recount(PO, po, ENTRY)

        self.assertEqual((before.stored_paid, before.correct_paid), (0.0, 500.0))
        self.assertEqual(self._stored(PO, po), (500.0, 500.0))
        self.assertRight(PO, po)
        entries = frappe.get_all(LEDGER, filters={"parent": self.vendor, "entry_type": ENTRY}, pluck="po_id")
        self.assertEqual(entries, [po])

    def test_recount_of_a_work_order_sets_paid_and_due(self):
        wo = self._wo(stored_paid=0, payments=[400])

        recount(WO, wo, ENTRY)

        self.assertEqual(self._stored(WO, wo), (400.0, 600.0))
        self.assertRight(WO, wo)

    def test_recount_of_a_misc_work_order_counts_only_the_tax_withheld_from_the_vendor(self):
        withheld = self._wo(stored_paid=24552, total=24800, tds=0, stored_due=248, categories=["Miscellaneous Services"])
        self._taxed_payment(withheld, 24552, gross=24800, tds=248)
        kept_whole = self._wo(stored_paid=12000, total=12000, tds=240, stored_due=-240,
                              categories=["Miscellaneous Services"])
        self._taxed_payment(kept_whole, 12000, gross=12000, tds=240, borne_by="Company")

        recount(WO, withheld, ENTRY)
        recount(WO, kept_whole, ENTRY)

        self.assertEqual(self._stored(WO, withheld), (24800.0, 0.0))
        self.assertEqual(frappe.db.get_value(WO, withheld, "total_tds"), 248.0)
        self.assertEqual(self._stored(WO, kept_whole), (12000.0, 0.0))
        self.assertRight(WO, withheld, kept_whole)

    def test_recount_of_an_order_already_right_writes_nothing(self):
        po = self._po(stored_paid=1000, payments=[1000])
        modified = frappe.db.get_value(PO, po, "modified")

        self.assertIsNone(recount(PO, po, ENTRY))
        self.assertEqual(frappe.db.get_value(PO, po, "modified"), modified)
        self.assertFalse(frappe.get_all(LEDGER, filters={"parent": self.vendor, "entry_type": ENTRY}))


class TheOneTimePatchFunctions(OrdersFixture):
    """`patches/v3_0/recount_drifted_po_amount_paid` calls these; the patch file is append-only."""

    def test_drifted_pos_reports_stored_and_source_paid(self):
        stale = self._po(stored_paid=400, payments=[600, 400])
        right = self._po(stored_paid=1000, payments=[1000])

        self.assertEqual([(r.name, r.stored, r.source) for r in drifted_pos([stale, right])], [(stale, 400.0, 1000.0)])

    def test_recount_pos_recounts_each_vendor_once_and_leaves_a_right_po_untouched(self):
        first = self._po(stored_paid=0, payments=[500])
        second = self._po(stored_paid=0, payments=[700])
        right = self._po(stored_paid=1000, payments=[1000])
        right_modified = frappe.db.get_value(PO, right, "modified")

        changed = recount_pos([first, second, right], ENTRY)

        self.assertEqual(sorted(r.name for r in changed), sorted([first, second]))
        self.assertEqual(frappe.db.get_value(PO, right, "modified"), right_modified)
        self.assertRight(PO, first, second, right)
        entries = frappe.get_all(LEDGER, filters={"parent": self.vendor, "entry_type": ENTRY}, pluck="po_id")
        self.assertEqual(len(entries), 1)
        self.assertIn(first, entries[0])
        self.assertIn(second, entries[0])
