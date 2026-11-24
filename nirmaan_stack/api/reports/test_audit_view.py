# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the Audit View report's two endpoints.

    bench --site <restored copy> run-tests --module nirmaan_stack.api.reports.test_audit_view

⚠️ RUNS AGAINST A REAL DATABASE full of real orders, invoices and payments. Every fixture is a raw-SQL row
named `TEST-AUDITV-...`, dated in January 2031 (orders by `creation`, the rest by invoice / payment date),
and every assertion reads only the rows of those fixtures. The rows are raw SQL so no hook recomputes the
figures under test; they are purged by name in `tearDownClass`, scope by scope, after a rollback.
"""

import unittest
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.reports.audit_view import get_audit_view_rows, get_audit_view_summary

PREFIX = "TEST-AUDITV"
PO = "Procurement Orders"
WO = "Service Requests"
ITEMS = "Work Order Items"
VI = "Vendor Invoices"
PP = "Project Payments"
PE = "Project Expenses"
NPE = "Non Project Expenses"
PTD = "Payment TDS Deduction"

#: The window every fixture sits in; edges and the days just outside it are for the bound tests.
FROM, TO = "2031-01-10", "2031-01-20"
IN = "2031-01-15"
BEFORE, AFTER = "2031-01-09", "2031-01-21"
ORDER_CREATED = f"{IN} 10:00:00"


class AuditViewFixture(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.created = {}
        cls.project, cls.project_name = frappe.db.get_value(
            "Projects", {"project_name": ["is", "set"]}, ["name", "project_name"]
        ) or (None, None)
        cls.vendor, cls.vendor_name = frappe.db.get_value(
            "Vendors", {"vendor_name": ["is", "set"]}, ["name", "vendor_name"]
        ) or (None, None)
        if not (cls.project and cls.vendor):
            raise unittest.SkipTest("no named Project or Vendor on this site")
        cls.project_type = frappe.db.get_value("Expense Type", {"project": 1}, "name")
        cls.non_project_type = frappe.db.get_value("Expense Type", {"non_project": 1}, "name")
        try:
            cls._plant()
        finally:
            frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        failures = []
        scopes = [(ITEMS, "parent", cls.created.get(WO, []))] + [
            (doctype, "name", names) for doctype, names in cls.created.items() if doctype != ITEMS
        ]
        for doctype, field, names in scopes:
            if not names:
                continue
            try:
                frappe.db.delete(doctype, {field: ["in", names]})
                frappe.db.commit()
            except Exception as error:  # report, never strand the scopes after it
                frappe.db.rollback()
                failures.append(f"{doctype}: {error}")
        super().tearDownClass()
        if failures:
            raise AssertionError("audit view fixtures not purged: " + "; ".join(failures))

    # ── fixture ─────────────────────────────────────────────────────────────

    @classmethod
    def _insert(cls, doctype, creation=ORDER_CREATED, **values):
        name = f"{PREFIX}-{frappe.generate_hash(length=10)}"
        cols = {"name": name, "creation": creation, "modified": creation, "modified_by": "Administrator",
                "owner": "Administrator", "docstatus": 0, "idx": 0, **values}
        frappe.db.sql(
            f'INSERT INTO "tab{doctype}" ({", ".join(cols)}) VALUES ({", ".join(["%s"] * len(cols))})',
            tuple(cols.values()),
        )
        cls.created.setdefault(doctype, []).append(name)
        return name

    @classmethod
    def _po(cls, status="Delivered", creation=ORDER_CREATED, **values):
        values = {"project": cls.project, "vendor": cls.vendor, "amount": 1000, "tax_amount": 180,
                  "total_amount": 1180, "amount_invoiced": 590, **values}
        return cls._insert(PO, creation=creation, status=status, **values)

    @classmethod
    def _wo(cls, total, gst, items=(), status="Approved", creation=ORDER_CREATED):
        wo = cls._insert(WO, creation=creation, status=status, project=cls.project, vendor=cls.vendor,
                         total_amount=total, gst=gst, amount_invoiced=100)
        for i, (quantity, rate) in enumerate(items):
            cls._insert(ITEMS, parent=wo, parenttype=WO, parentfield="work_order_items", quantity=quantity,
                        rate=rate, item_name=f"{PREFIX} item {i}")
        return wo

    @classmethod
    def _invoice(cls, order, amount, status="Approved", doctype=PO, date=IN, **values):
        invoice_no = f"{PREFIX}-INV-{frappe.generate_hash(length=8)}"
        cls._insert(VI, status=status, document_type=doctype, document_name=order, invoice_no=invoice_no,
                    invoice_date=date, invoice_amount=amount, project=cls.project, vendor=cls.vendor, **values)
        return invoice_no

    @classmethod
    def _payment(cls, order, amount, status="Paid", doctype=PO, date=IN, is_gst_payment=0, box=None,
                 deduction=None, borne_by="Vendor"):
        """A payment; `deduction` plants its Payment TDS Deduction (`borne_by` Vendor / Company), `box` fills
        the legacy `Project Payments.tds` box, which the report must never read."""
        utr = f"{PREFIX}-UTR-{frappe.generate_hash(length=8)}"
        name = cls._insert(PP, status=status, document_type=doctype, document_name=order, project=cls.project,
                           vendor=cls.vendor, payment_date=date, utr=utr, amount=amount, tds=box,
                           is_gst_payment=is_gst_payment)
        if deduction is not None:
            cls._insert(PTD, project_payment=name, document_type=doctype, document_name=order,
                        vendor=cls.vendor, project=cls.project, gross_amount=flt(amount) + flt(deduction),
                        tds_percentage=2, tds_amount=deduction, borne_by=borne_by, status="Pending")
        return utr

    @classmethod
    def _expense(cls, doctype, amount, status="Paid", invoice_date=IN, invoice_ref="INV-1", payment_date=IN,
                 untyped=False, **values):
        project = {"projects": cls.project, "vendor": cls.vendor} if doctype == PE else {}
        expense_type = None if untyped else cls.project_type if doctype == PE else cls.non_project_type
        return cls._insert(doctype, status=status, type=expense_type, amount=amount, invoice_date=invoice_date,
                           invoice_ref=invoice_ref, payment_date=payment_date,
                           payment_ref=f"{PREFIX}-REF-{amount}", **project, **values)

    @classmethod
    def _plant(cls):
        c = cls
        # Orders
        c.po_live = c._po(project_name="TEST AV project label", vendor_name="TEST AV vendor label")
        c.po_blank_names = c._po(status="PO Approved", project_name=None, vendor_name=None)
        c.po_excluded = {s: c._po(status=s) for s in ("Inactive", "Cancelled", "Merged")}
        c.po_edges = {
            "from": c._po(creation=f"{FROM} 00:00:00"), "to": c._po(creation=f"{TO} 23:59:59.999"),
            "before": c._po(creation=f"{BEFORE} 23:59:59.999"), "after": c._po(creation=f"{AFTER} 00:00:00"),
        }
        c.wo_items = c._wo(1475, "true", items=[(2, 500), (1, 250)])
        c.wo_items_gst_off = c._wo(300, "false", items=[(3, 100)])
        c.wo_no_items_on = c._wo(1180, "Yes")
        c.wo_no_items_off = c._wo(1000, "false")
        c.wo_pending = c._wo(1000, "false", status="Pending")
        # Vendor invoices
        c.vi_approved = c._invoice(c.po_live, 1180, invoice_base_amount=999, invoice_gst_amount=111)
        c.vi_pending = c._invoice(c.po_live, 500, status="Pending")
        c.vi_rejected = c._invoice(c.po_live, 500, status="Rejected")
        c.vi_credit = c._invoice(c.wo_items, -236, doctype=WO)
        c.vi_orphan = c._invoice(f"{PREFIX}-NO-SUCH-PO", 50)
        c.vi_other_doctype = c._invoice(c.project, 70, doctype="Projects")
        # Invoice files: a Nirmaan Attachments record, one pointing nowhere, and an expense's own file URL
        c.file_url = f"/private/files/{PREFIX}-invoice.pdf"
        c.attachment = c._insert("Nirmaan Attachments", attachment=c.file_url)
        c.vi_with_file = c._invoice(c.po_live, 20, invoice_attachment=c.attachment)
        c.vi_dangling_file = c._invoice(c.po_live, 21, invoice_attachment=f"{PREFIX}-NO-SUCH-ATTACHMENT")
        c.vi_edges = {k: c._invoice(c.po_live, 10, date=d)
                      for k, d in (("from", FROM), ("to", TO), ("before", BEFORE), ("after", AFTER))}
        # Payments
        # Payments. TDS is the Payment TDS Deduction, Vendor- and Company-borne: 500 + 250.50 + 16 = 766.50.
        c.pp_tds = c._payment(c.po_live, 9500, deduction=500)
        c.pp_tds_float = c._payment(c.po_live, 1000, deduction=250.50)
        c.pp_company = c._payment(c.wo_items, 800, doctype=WO, deduction=16, borne_by="Company")
        c.pp_gross_po = c._payment(c.po_live, 1000, box="20", deduction=20)  # PO still stored at the full bill
        c.pp_box_only = c._payment(c.po_live, 400, box="99")  # legacy box, no deduction record
        c.pp_empty_tds = c._payment(c.wo_items, 1000, doctype=WO, is_gst_payment=1)
        c.pp_not_paid = c._payment(c.po_live, 777, status="Approved", deduction=15)
        c.pp_edges = {k: c._payment(c.po_live, 10, date=d)
                      for k, d in (("from", FROM), ("to", TO), ("before", BEFORE), ("after", AFTER))}
        # Expenses
        c.pe_ok = c._expense(PE, 750, invoice_ref="  PE-INV-1  ",
                             description="  Porter delivery to Block B\nBank: XXXX1234  ")
        c.pe_blank_ref = c._expense(PE, 751, invoice_ref="   ")
        c.pe_null_ref = c._expense(PE, 752, invoice_ref=None)
        c.pe_no_date = c._expense(PE, 753, invoice_date=None)
        c.pe_approved = c._expense(PE, 754, status="Approved")
        c.pe_with_file = c._expense(PE, 760, invoice_ref="PE-INV-FILE", invoice_attachment="/private/files/pe.pdf")
        c.npe_ok = c._expense(NPE, 850, invoice_ref="NPE-INV-1", description="Office rent, November")
        c.npe_with_file = c._expense(NPE, 860, invoice_ref="NPE-INV-FILE", invoice_attachment="/files/npe.pdf")
        c.npe_blank_ref = c._expense(NPE, 851, invoice_ref=" ")
        c.npe_no_date = c._expense(NPE, 852, invoice_date=None)
        c.npe_pending = c._expense(NPE, 853, status="Reconciliation Pending")
        # Made from an approved reimbursement claim: no expense type, a link to the claim.
        c.npe_reimbursement = c._expense(NPE, 870, invoice_ref="REIMB-INV-1", untyped=True,
                                         reimbursement=f"{PREFIX}-REIMB-1",
                                         description="Travel · Site visit · Claimant: Test User · [REIMB-1]")
        c.npe_untyped = c._expense(NPE, 871, invoice_ref="NPE-INV-UNTYPED", untyped=True)

    # ── reading ─────────────────────────────────────────────────────────────

    def _by(self, key, view, tab, start=FROM, end=TO):
        """The fixture rows of a tab, keyed by `key` (id, invoice_no or utr), limited to fixtures."""
        mine = set(sum(self.created.values(), [])) | {f"{PREFIX}-NO-SUCH-PO"}
        return {
            r[key]: r for r in get_audit_view_rows(view, tab, start, end)
            if r["id"] in mine and (key == "id" or str(r[key] or "").startswith(PREFIX))
        }


class Orders(AuditViewFixture):
    def test_a_live_po_carries_its_own_figures_and_its_stored_names(self):
        row = self._by("id", "project", "orders")[self.po_live]
        self.assertEqual(row, {
            "against": "PO", "id": self.po_live, "project": self.project, "project_name": "TEST AV project label",
            "vendor": self.vendor, "vendor_name": "TEST AV vendor label", "date": IN, "excl_gst": 1000.0,
            "gst": 180.0, "incl_gst": 1180.0, "total_invoiced": 590.0,
        })

    def test_a_po_without_stored_names_takes_them_from_project_and_vendor(self):
        row = self._by("id", "project", "orders")[self.po_blank_names]
        self.assertEqual((row["project_name"], row["vendor_name"]), (self.project_name, self.vendor_name))

    def test_inactive_cancelled_and_merged_pos_are_left_out(self):
        rows = self._by("id", "project", "orders", None, None)
        for status, po in self.po_excluded.items():
            with self.subTest(status):
                self.assertNotIn(po, rows)

    def test_a_work_order_with_items_is_split_on_its_items_value(self):
        rows = self._by("id", "project", "orders")
        self.assertEqual(
            [(rows[w]["excl_gst"], rows[w]["gst"], rows[w]["incl_gst"]) for w in (self.wo_items, self.wo_items_gst_off)],
            [(1250.0, 225.0, 1475.0), (300.0, 0.0, 300.0)],
        )
        self.assertEqual(
            {k: rows[self.wo_items][k] for k in ("against", "project_name", "vendor_name", "total_invoiced")},
            {"against": "WO", "project_name": self.project_name, "vendor_name": self.vendor_name,
             "total_invoiced": 100.0},
        )

    def test_a_work_order_without_items_falls_back_on_its_gst_flag(self):
        rows = self._by("id", "project", "orders")
        self.assertEqual((rows[self.wo_no_items_on]["excl_gst"], rows[self.wo_no_items_on]["gst"]), (1000.0, 180.0))
        self.assertEqual((rows[self.wo_no_items_off]["excl_gst"], rows[self.wo_no_items_off]["gst"]), (1000.0, 0.0))

    def test_a_work_order_not_approved_is_left_out(self):
        self.assertNotIn(self.wo_pending, self._by("id", "project", "orders", None, None))

    def test_creation_bounds_are_inclusive_to_the_last_microsecond_of_the_day(self):
        e = self.po_edges
        cases = {
            (FROM, TO): {e["from"], e["to"]},
            (TO, None): {e["to"], e["after"]},
            (None, FROM): {e["from"], e["before"]},
            (None, None): set(e.values()),
        }
        for (start, end), expected in cases.items():
            with self.subTest(start=start, end=end):
                got = set(self._by("id", "project", "orders", start, end)) & set(e.values())
                self.assertEqual(got, expected)

    def test_the_non_project_view_has_no_orders(self):
        self.assertEqual(get_audit_view_rows("nonproject", "orders", None, None), [])


class Invoices(AuditViewFixture):
    def test_invoice_url_is_the_attached_file_or_none(self):
        project = self._by("invoice_no", "project", "invoices")
        # Vendor invoice: the file of its Nirmaan Attachments record.
        self.assertEqual(project[self.vi_with_file]["invoice_url"], self.file_url)
        # No attachment, or an attachment record that does not exist: no link.
        self.assertIsNone(project[self.vi_approved]["invoice_url"])
        self.assertIsNone(project[self.vi_dangling_file]["invoice_url"])
        # Expenses carry their own file URL; none attached -> None. (Expense rows keyed by id: their
        # invoice numbers are not prefixed.)
        expenses = self._by("id", "project", "invoices")
        self.assertEqual(expenses[self.pe_with_file]["invoice_url"], "/private/files/pe.pdf")
        self.assertIsNone(expenses[self.pe_ok]["invoice_url"])
        nonproject = self._by("id", "nonproject", "invoices")
        self.assertEqual(nonproject[self.npe_with_file]["invoice_url"], "/files/npe.pdf")
        self.assertIsNone(nonproject[self.npe_ok]["invoice_url"])
        # Every invoice row carries the key, even with no file.
        self.assertTrue(all("invoice_url" in r for r in project.values()))

    def test_only_approved_vendor_invoices_count_and_only_their_invoice_amount(self):
        rows = self._by("invoice_no", "project", "invoices")
        self.assertNotIn(self.vi_pending, rows)
        self.assertNotIn(self.vi_rejected, rows)
        self.assertEqual(rows[self.vi_approved], {
            "against": "PO", "id": self.po_live, "invoice_no": self.vi_approved, "project": self.project,
            "project_name": self.project_name, "vendor": self.vendor, "vendor_name": self.vendor_name,
            "expense_type": None, "description": None, "date": IN, "invoice_amount": 1180.0, "order_date": IN,
            "invoice_url": None,
        })

    def test_a_credit_note_is_kept_negative_against_its_work_order(self):
        row = self._by("invoice_no", "project", "invoices")[self.vi_credit]
        self.assertEqual((row["against"], row["id"], row["invoice_amount"]), ("WO", self.wo_items, -236.0))

    def test_an_invoice_on_a_missing_order_has_no_order_date(self):
        row = self._by("invoice_no", "project", "invoices")[self.vi_orphan]
        self.assertIsNone(row["order_date"])

    def test_an_invoice_on_anything_but_a_po_or_wo_is_left_out(self):
        rows = get_audit_view_rows("project", "invoices", FROM, TO)
        self.assertNotIn(self.vi_other_doctype, {r["invoice_no"] for r in rows})

    def test_a_paid_project_expense_with_a_date_and_a_ref_is_an_invoice(self):
        rows = self._by("id", "project", "invoices")
        self.assertEqual(rows[self.pe_ok], {
            "against": "Project Expense", "id": self.pe_ok, "invoice_no": "PE-INV-1", "project": self.project,
            "project_name": self.project_name, "vendor": self.vendor, "vendor_name": self.vendor_name,
            "expense_type": self.project_type, "description": "Porter delivery to Block B\nBank: XXXX1234",
            "date": IN, "invoice_amount": 750.0, "order_date": None, "invoice_url": None,
        })
        for missing in (self.pe_blank_ref, self.pe_null_ref, self.pe_no_date, self.pe_approved):
            with self.subTest(missing):
                self.assertNotIn(missing, self._by("id", "project", "invoices", None, None))

    def test_the_non_project_view_holds_only_paid_non_project_expenses_with_a_date_and_a_ref(self):
        all_rows = get_audit_view_rows("nonproject", "invoices", None, None)
        self.assertEqual({r["against"] for r in all_rows}, {"Non-Project Expense"})
        rows = {r["id"]: r for r in all_rows}
        self.assertEqual(rows[self.npe_ok], {
            "against": "Non-Project Expense", "id": self.npe_ok, "invoice_no": "NPE-INV-1", "project": None,
            "project_name": None, "vendor": None, "vendor_name": None, "expense_type": self.non_project_type,
            "description": "Office rent, November", "date": IN, "invoice_amount": 850.0, "order_date": None, "invoice_url": None,
        })
        for missing in (self.npe_blank_ref, self.npe_no_date, self.npe_pending, self.pe_ok):
            with self.subTest(missing):
                self.assertNotIn(missing, rows)

    def test_invoice_date_bounds_are_inclusive(self):
        e = self.vi_edges
        cases = {
            (FROM, TO): {e["from"], e["to"]},
            (TO, None): {e["to"], e["after"]},
            (None, FROM): {e["from"], e["before"]},
            (None, None): set(e.values()),
        }
        for (start, end), expected in cases.items():
            with self.subTest(start=start, end=end):
                got = set(self._by("invoice_no", "project", "invoices", start, end)) & set(e.values())
                self.assertEqual(got, expected)


class Payments(AuditViewFixture):
    def test_tds_is_the_vendor_borne_deduction_added_to_net_paid(self):
        rows = self._by("utr", "project", "payments")
        self.assertEqual(rows[self.pp_tds], {
            "against": "PO", "id": self.po_live, "project": self.project, "project_name": self.project_name,
            "vendor": self.vendor, "vendor_name": self.vendor_name, "expense_type": None, "description": None,
            "date": IN, "utr": self.pp_tds, "amount_paid": 9500.0, "tds": 500.0, "net_paid": 10000.0,
            "is_gst_payment": False, "order_date": IN,
        })
        self.assertEqual((rows[self.pp_tds_float]["tds"], rows[self.pp_tds_float]["net_paid"]), (250.5, 1250.5))

    def test_no_deduction_reads_zero_and_the_legacy_tds_box_is_never_read(self):
        rows = self._by("utr", "project", "payments")
        for utr, amount in ((self.pp_empty_tds, 1000.0), (self.pp_box_only, 400.0)):
            with self.subTest(utr):
                self.assertEqual((rows[utr]["tds"], rows[utr]["net_paid"]), (0.0, amount))

    def test_company_borne_tds_is_counted_too(self):
        # Paid on top by the company (the vendor got the full 800): its tax still counts in TDS and Net Paid.
        row = self._by("utr", "project", "payments")[self.pp_company]
        self.assertEqual((row["amount_paid"], row["tds"], row["net_paid"]), (800.0, 16.0, 816.0))

    def test_a_po_payment_still_stored_gross_counts_no_tax_on_top(self):
        # The shared source (`paid_borne_tds_sql`) skips it: its amount already holds the tax.
        row = self._by("utr", "project", "payments")[self.pp_gross_po]
        self.assertEqual((row["amount_paid"], row["tds"], row["net_paid"]), (1000.0, 0.0, 1000.0))

    def test_the_gst_payment_flag_is_carried(self):
        row = self._by("utr", "project", "payments")[self.pp_empty_tds]
        self.assertEqual((row["against"], row["id"], row["is_gst_payment"]), ("WO", self.wo_items, True))

    def test_a_payment_not_paid_is_left_out(self):
        self.assertNotIn(self.pp_not_paid, self._by("utr", "project", "payments", None, None))

    def test_a_paid_project_expense_has_no_tds_and_nets_its_amount(self):
        rows = self._by("id", "project", "payments")
        self.assertEqual(rows[self.pe_ok], {
            "against": "Project Expense", "id": self.pe_ok, "project": self.project,
            "project_name": self.project_name, "vendor": self.vendor, "vendor_name": self.vendor_name,
            "expense_type": self.project_type, "description": "Porter delivery to Block B\nBank: XXXX1234",
            "date": IN, "utr": f"{PREFIX}-REF-750", "amount_paid": 750.0,
            "tds": None, "net_paid": 750.0, "is_gst_payment": False, "order_date": None,
        })
        # Paid without an invoice ref is still a payment; a non-Paid expense is not.
        self.assertIn(self.pe_blank_ref, rows)
        self.assertNotIn(self.pe_approved, rows)

    def test_the_non_project_view_holds_only_paid_non_project_expenses(self):
        all_rows = get_audit_view_rows("nonproject", "payments", FROM, TO)
        self.assertEqual({r["against"] for r in all_rows}, {"Non-Project Expense"})
        rows = {r["id"]: r for r in all_rows}
        self.assertEqual(
            (rows[self.npe_ok]["amount_paid"], rows[self.npe_ok]["tds"], rows[self.npe_ok]["net_paid"],
             rows[self.npe_ok]["project"], rows[self.npe_ok]["utr"]),
            (850.0, None, 850.0, None, f"{PREFIX}-REF-850"),
        )
        self.assertEqual(rows[self.npe_ok]["description"], "Office rent, November")
        self.assertIn(self.npe_no_date, rows)  # no invoice date, but Paid
        self.assertNotIn(self.npe_pending, rows)

    def test_payment_date_bounds_are_inclusive_and_rows_sort_by_date_then_id(self):
        e = self.pp_edges
        cases = {
            (FROM, TO): {e["from"], e["to"]},
            (TO, None): {e["to"], e["after"]},
            (None, FROM): {e["from"], e["before"]},
            (None, None): set(e.values()),
        }
        for (start, end), expected in cases.items():
            with self.subTest(start=start, end=end):
                got = set(self._by("utr", "project", "payments", start, end)) & set(e.values())
                self.assertEqual(got, expected)
        rows = get_audit_view_rows("project", "payments", BEFORE, AFTER)
        keys = [(r["date"], r["id"]) for r in rows]
        self.assertEqual(keys, sorted(keys))


class Summary(AuditViewFixture):
    def _sum(self, rows, field):
        return flt(sum(flt(r[field]) for r in rows), 2)

    def _by_against(self, rows, field):
        out = {}
        for r in rows:
            out[r["against"]] = flt(out.get(r["against"], 0) + flt(r[field]), 2)
        return out

    def test_summary_is_the_sum_of_the_rows_in_the_same_window(self):
        for view in ("project", "nonproject"):
            with self.subTest(view):
                summary = get_audit_view_summary(view, FROM, TO)
                invoices = get_audit_view_rows(view, "invoices", FROM, TO)
                payments = get_audit_view_rows(view, "payments", FROM, TO)
                self.assertEqual(summary["invoices"], {"count": len(invoices),
                                                       "invoice_amount": self._sum(invoices, "invoice_amount"),
                                                       "by_against": self._by_against(invoices, "invoice_amount")})
                self.assertEqual(summary["payments"], {
                    "count": len(payments), "amount_paid": self._sum(payments, "amount_paid"),
                    "tds": self._sum(payments, "tds"), "net_paid": self._sum(payments, "net_paid"),
                    "by_against": self._by_against(payments, "net_paid"),
                })
                if view == "nonproject":
                    self.assertIsNone(summary["orders"])
                else:
                    orders = get_audit_view_rows(view, "orders", FROM, TO)
                    self.assertEqual(summary["orders"], {
                        "count": len(orders), "incl_gst": self._sum(orders, "incl_gst"),
                        "total_invoiced": self._sum(orders, "total_invoiced"),
                        "by_against": self._by_against(orders, "incl_gst"),
                    })

    def test_the_fixtures_are_counted_in_the_summary(self):
        # Every row the window holds is a fixture unless real data is dated January 2031.
        summary = get_audit_view_summary("project", FROM, TO)
        mine = self._by("utr", "project", "payments")
        self.assertGreaterEqual(summary["payments"]["count"], len(mine))
        self.assertGreaterEqual(summary["payments"]["tds"], 766.5)


class ReimbursementType(AuditViewFixture):
    def test_a_reimbursement_expense_reads_reimbursement_as_its_type_on_both_tabs(self):
        for tab in ("invoices", "payments"):
            with self.subTest(tab):
                rows = {r["id"]: r for r in get_audit_view_rows("nonproject", tab, FROM, TO)}
                self.assertEqual(rows[self.npe_reimbursement]["expense_type"], "Reimbursement")
                self.assertEqual(rows[self.npe_reimbursement]["description"],
                                 "Travel · Site visit · Claimant: Test User · [REIMB-1]")

    def test_only_a_missing_type_with_a_claim_is_labelled(self):
        for tab in ("invoices", "payments"):
            with self.subTest(tab):
                rows = {r["id"]: r for r in get_audit_view_rows("nonproject", tab, FROM, TO)}
                # No type and no claim stays blank; an expense with its own type keeps it.
                self.assertIsNone(rows[self.npe_untyped]["expense_type"])
                self.assertEqual(rows[self.npe_ok]["expense_type"], self.non_project_type)

    def test_nothing_is_stored(self):
        get_audit_view_rows("nonproject", "payments", FROM, TO)
        self.assertIsNone(frappe.db.get_value(NPE, self.npe_reimbursement, "type"))


class Refusals(AuditViewFixture):
    def test_an_unknown_view_or_tab_or_a_malformed_date_is_refused(self):
        for args in (("everything", "orders"), ("project", "ledger"), ("project", "payments", "not-a-date")):
            with self.subTest(args), self.assertRaises(frappe.ValidationError):
                get_audit_view_rows(*args)
        with self.assertRaises(frappe.ValidationError):
            get_audit_view_summary("everything")

    def test_a_user_outside_the_audit_view_profiles_is_refused_by_both_endpoints(self):
        with patch("nirmaan_stack.services.role_profiles.has_role_profile", return_value=False):
            with self.assertRaises(frappe.PermissionError):
                get_audit_view_rows("project", "payments", FROM, TO)
            with self.assertRaises(frappe.PermissionError):
                get_audit_view_summary("project", FROM, TO)

    def _as(self, profile, fn, *args):
        user = frappe.db.get_value("Nirmaan Users", {"role_profile": profile}, "name")
        if not user:
            self.skipTest(f"no {profile} user on this site")
        frappe.set_user(user)
        try:
            return fn(*args)
        finally:
            frappe.set_user("Administrator")

    def test_an_accountant_may_read_and_a_procurement_or_pmo_user_may_not(self):
        rows = self._as("Nirmaan Accountant Profile", get_audit_view_rows, "project", "payments", FROM, TO)
        self.assertIn(self.pp_tds, {r["utr"] for r in rows})
        for profile in ("Nirmaan Procurement Executive Profile", "Nirmaan PMO Executive Profile"):
            with self.subTest(profile), self.assertRaises(frappe.PermissionError):
                self._as(profile, get_audit_view_summary, "project", FROM, TO)
