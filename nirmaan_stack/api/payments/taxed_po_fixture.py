# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Test-only: a PO payment that carries a tax record, in the two shapes the database holds (#1534).

Shared by `services/test_po_tax_counts` and `services/test_net_po_payments_with_tds_patch`. Not a `test_`
module, so the runner never collects it.

THE TWO SHAPES (ADR-0034 Amendment B)
  * `old_payment` -- the 86 payments of 2026-09: stored GROSS, the legacy `Project Payments.tds` box
    filled in, and a vendor-borne `Payment TDS Deduction` written beside it by
    `patches/v3_0/backfill_po_payment_tds_deductions`. Its tax is inside its amount.
  * `netted_payment` -- the same payment after `patches/v3_0/net_po_payments_with_tds`: stored net, the
    legacy box cleared. Its tax counts on top, as a Work Order's does.

Everything is a raw insert (`db_insert`, no hooks) on a scratch vendor and project, purged by them in
`purge`. `po` stores the Amount Paid and Amount Due that are right for the payments planted the old way
(the gross), as production stores them.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.vendor_refunds import po_refund_fixture
from nirmaan_stack.services.payment_tds import BORNE_BY_VENDOR

PO = "Procurement Orders"
PAYMENT = "Project Payments"
DEDUCTION = "Payment TDS Deduction"
CHALLAN = "TDS Challan Attachment"
MATCH = "Outflow Row Match"


class TaxedPoFixture:
    """One scratch vendor and project per instance; `purge` removes all of it."""

    def __init__(self, prefix: str):
        self.prefix = prefix
        self.vendor = self._raw("Vendors", vendor_name=f"{prefix} vendor", credit_limit=500000,
                                tds_deduction_percentage=0.1, vendor_category={"categories": []})
        self.project = self._raw("Projects", project_name=f"{prefix} project", status="WIP")
        frappe.db.commit()

    def _raw(self, doctype, **fields):
        doc = frappe.new_doc(doctype)
        doc.update(fields)
        doc.name = f"{self.prefix}-{frappe.generate_hash(length=10)}"
        doc.db_insert()
        return doc.name

    def po(self, value=118000.0, paid=0.0, project=None):
        """A PO worth `value` incl. 18% GST, invoiced and delivered in full, storing `paid` as its Amount
        Paid and `value - paid` as its Amount Due."""
        base = flt(value / 1.18, 2)
        po = self._raw(
            PO, vendor=self.vendor, project=project or self.project, project_name=f"{self.prefix} project",
            status="Delivered", amount=base, tax_amount=flt(value - base, 2), total_amount=value,
            amount_invoiced=value, po_amount_delivered=value, amount_paid=paid, amount_due=value - paid,
        )
        self._raw("Vendor Invoices", vendor=self.vendor, status="Approved", document_type=PO, document_name=po,
                  invoice_no=f"INV-{po}", invoice_date="2026-04-05", invoice_amount=value)
        frappe.db.sql('UPDATE "tabProcurement Orders" SET creation = %s WHERE name = %s', ("2026-01-01", po))
        frappe.db.commit()
        return po

    def old_payment(self, po, gross, tds, status="Paid", payment_date="2026-05-10", challan=None, project=None):
        """A Paid PO payment stored gross with the legacy `tds` box filled and a vendor-borne deduction."""
        return self._taxed(po, amount=gross, legacy_tds=str(tds), gross=gross, tds=tds, status=status,
                           payment_date=payment_date, challan=challan, project=project)

    def netted_payment(self, po, gross, tds, status="Paid", payment_date="2026-05-10", project=None):
        """The same payment cut to `gross - tds`, the legacy box cleared."""
        return self._taxed(po, amount=flt(gross - tds, 2), legacy_tds=None, gross=gross, tds=tds, status=status,
                           payment_date=payment_date, challan=None, project=project)

    def payment(self, po, amount, status="Paid", payment_date="2026-05-10", project=None):
        """A PO payment with no tax record."""
        name = self._raw(PAYMENT, vendor=self.vendor, project=project or self.project, document_type=PO,
                         document_name=po, amount=amount, status=status, payment_date=payment_date,
                         utr=f"UTR-{frappe.generate_hash(length=6)}")
        frappe.db.commit()
        return name

    def _taxed(self, po, *, amount, legacy_tds, gross, tds, status, payment_date, challan, project):
        project = project or self.project
        payment = self._raw(PAYMENT, vendor=self.vendor, project=project, document_type=PO, document_name=po,
                            amount=amount, tds=legacy_tds, status=status, payment_date=payment_date,
                            utr=f"UTR-{frappe.generate_hash(length=6)}")
        deduction = self._raw(DEDUCTION, project_payment=payment, vendor=self.vendor, project=project,
                              document_type=PO, document_name=po, gross_amount=gross,
                              tds_percentage=flt(tds / gross * 100, 2), tds_amount=tds, borne_by=BORNE_BY_VENDOR,
                              status="Paid" if challan else "Pending", tds_challan=challan,
                              payment_approved_on="2026-05-01")
        frappe.db.set_value(PAYMENT, payment, "payment_tds", deduction, update_modified=False)
        frappe.db.commit()
        return payment

    def challan(self, amount):
        name = self._raw(CHALLAN, amount=amount, reconciled_amount=amount)
        frappe.db.commit()
        return name

    def bank_match(self, payment):
        """An Outflow Row Match settling `payment` from a bank statement line."""
        name = self._raw(MATCH, target_doctype=PAYMENT, target_name=payment, target_amount=frappe.db.get_value(
            PAYMENT, payment, "amount"), target_vendor=self.vendor, target_project=self.project)
        frappe.db.commit()
        return name

    def purge(self):
        pos = frappe.get_all(PO, {"vendor": self.vendor}, pluck="name") or ["-"]
        payments = frappe.get_all(PAYMENT, {"vendor": self.vendor}, pluck="name") or ["-"]
        challans = frappe.get_all(DEDUCTION, {"vendor": self.vendor, "tds_challan": ["is", "set"]},
                                  pluck="tds_challan") or ["-"]
        po_refund_fixture.purge([
            (MATCH, lambda: frappe.db.delete(MATCH, {"target_name": ["in", payments]})),
            ("Version", lambda: frappe.db.delete("Version", {"docname": ["in", payments + pos]})),
            (DEDUCTION, lambda: frappe.db.delete(DEDUCTION, {"vendor": self.vendor})),
            (CHALLAN, lambda: frappe.db.delete(CHALLAN, {"name": ["in", challans]})),
            (PAYMENT, lambda: frappe.db.delete(PAYMENT, {"vendor": self.vendor})),
            ("Vendor Invoices", lambda: frappe.db.delete("Vendor Invoices", {"vendor": self.vendor})),
            ("PO Adjustments", lambda: frappe.db.delete("PO Adjustments", {"po_id": ["in", pos]})),
            (PO, lambda: frappe.db.delete(PO, {"vendor": self.vendor})),
            ("CEO Hold Reason", lambda: frappe.db.delete("CEO Hold Reason", {"project": self.project})),
            ("Projects", lambda: frappe.db.delete("Projects", {"name": self.project})),
            ("Vendor Credit Ledger", lambda: frappe.db.delete("Vendor Credit Ledger", {"parent": self.vendor})),
            ("Vendors", lambda: frappe.db.delete("Vendors", {"name": self.vendor})),
        ])
