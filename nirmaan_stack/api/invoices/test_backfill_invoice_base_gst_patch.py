# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""`patches/v3_0/backfill_vendor_invoice_base_gst.py` against real rows (ticket #1340).

Pins what an accountant would see after the patch: the base / GST figures stored on each
invoice, the ones left blank, and each Work Order's GST Invoiced -- and that a second run
changes nothing, not even `modified`.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, so it calls `backfill(invoices=...)` with only the
invoices it created -- never `execute()`, which would walk every real invoice on the site.
`execute()` is `backfill()` + commit and nothing else. Same rule as
`outflow_import/test_icici_gross_outflow_patch.py`. `backfill` does not commit; every test
rolls back.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.patches.v3_0.backfill_vendor_invoice_base_gst import backfill

POISON = -987654.32


def _entities(net=None, tax=None, net_conf=1.0, tax_conf=1.0):
    ents = [{"type": "invoice_id", "value": "X-1", "confidence": 1.0}]
    if net is not None:
        ents.append({"type": "net_amount", "value": net, "confidence": net_conf})
    if tax is not None:
        ents.append({"type": "total_tax_amount", "value": tax, "confidence": tax_conf})
    return json.dumps(ents)


class TestBackfillInvoiceBaseGstPatch(FrappeTestCase):
    def setUp(self):
        self.invoices = []
        self.SR = self._raw("Service Requests", total_amount=11800, gst="true")
        self.SR2 = self._raw("Service Requests", total_amount=5900, gst="true")
        self.PO = self._raw("Procurement Orders", total_amount=5000)
        for sr in (self.SR, self.SR2):
            frappe.db.set_value("Service Requests", sr, "gst_invoiced", POISON,
                                update_modified=False)

    def tearDown(self):
        frappe.db.rollback()

    # -- fixtures --------------------------------------------------------------------------------

    def _raw(self, doctype, **fields):
        d = frappe.new_doc(doctype)
        d.update(fields)
        d.name = "T1340-" + frappe.generate_hash(length=10)
        d.db_insert()
        return d.name

    def _vi(self, amount, parent=None, doctype="Service Requests", status="Approved", **fields):
        name = self._raw(
            "Vendor Invoices",
            document_type=doctype,
            document_name=parent or self.SR,
            invoice_no="T-" + frappe.generate_hash(length=8),
            invoice_date=nowdate(),
            invoice_amount=amount,
            status=status,
            **fields,
        )
        self.invoices.append(name)
        return name

    def _split(self, name):
        base, gst = frappe.db.get_value(
            "Vendor Invoices", name, ["invoice_base_amount", "invoice_gst_amount"]
        )
        return flt(base), flt(gst)

    def _gst_invoiced(self, sr):
        return flt(frappe.db.get_value("Service Requests", sr, "gst_invoiced"))

    # -- the fill --------------------------------------------------------------------------------

    def test_fills_a_blank_invoice_from_its_saved_extraction(self):
        inv = self._vi(1180, autofill_all_entities_json=_entities("1000", "180"))
        po_inv = self._vi(590, parent=self.PO, doctype="Procurement Orders",
                          autofill_all_entities_json=_entities("₹500.00", "90"))
        pending = self._vi(236, status="Pending", autofill_all_entities_json=_entities("200", "36"))
        before = frappe.db.get_value("Vendor Invoices", inv, "modified")

        result = backfill(invoices=self.invoices)

        self.assertEqual(self._split(inv), (1000, 180))
        self.assertEqual(self._split(po_inv), (500, 90))
        self.assertEqual(self._split(pending), (200, 36))
        self.assertEqual(result["filled"], 3)
        # A backfill, not a user edit: the invoice's own `modified` does not move.
        self.assertEqual(frappe.db.get_value("Vendor Invoices", inv, "modified"), before)

    def test_credit_note_is_filled_negative(self):
        cn = self._vi(-118, is_credit_note=1, autofill_all_entities_json=_entities("100", "18"))
        backfill(invoices=self.invoices)
        self.assertEqual(self._split(cn), (-100, -18))

    def test_leaves_blank_when_the_extraction_cannot_be_trusted(self):
        cases = {
            "no extraction": self._vi(1180),
            "base only": self._vi(1180, autofill_all_entities_json=_entities(net="1000")),
            "gst only": self._vi(1180, autofill_all_entities_json=_entities(tax="180")),
            # A decimal point OCR'd as a space: 3956.40 must not become 395640.
            "unclean number": self._vi(1180, autofill_all_entities_json=_entities("3,956 40", "712")),
            # Below the confidence the upload form needs before it pre-fills a field.
            "low confidence": self._vi(
                1180, autofill_all_entities_json=_entities("1000", "90", tax_conf=0.6)
            ),
            "broken json": self._vi(1180, autofill_all_entities_json="{not json"),
        }
        result = backfill(invoices=self.invoices)

        for label, name in cases.items():
            self.assertEqual(self._split(name), (0, 0), label)
        self.assertEqual(result, {"filled": 0, "left_blank": len(cases), "recomputed": 1})

    def test_never_overwrites_a_figure_a_person_entered(self):
        both = self._vi(590, invoice_base_amount=500, invoice_gst_amount=90,
                        autofill_all_entities_json=_entities("1000", "180"))
        base_only = self._vi(500, invoice_base_amount=500,
                             autofill_all_entities_json=_entities("1000", "180"))
        backfill(invoices=self.invoices)
        self.assertEqual(self._split(both), (500, 90))
        self.assertEqual(self._split(base_only), (500, 0))

    # -- GST Invoiced ----------------------------------------------------------------------------

    def test_gst_invoiced_is_recomputed_from_source_on_every_work_order(self):
        self._vi(1180, autofill_all_entities_json=_entities("1000", "180"))              # +180
        self._vi(-118, is_credit_note=1, autofill_all_entities_json=_entities("100", "18"))  # -18
        self._vi(236, status="Pending", autofill_all_entities_json=_entities("200", "36"))  # not counted
        self._vi(1180)                                                                   # blank, 0
        self._vi(590, invoice_base_amount=500, invoice_gst_amount=90)                    # +90
        # SR2 gets nothing filled; its stale figure must still be brought to source.
        self._vi(354, parent=self.SR2, invoice_base_amount=300, invoice_gst_amount=54)

        backfill(invoices=self.invoices)

        self.assertAlmostEqual(self._gst_invoiced(self.SR), 180 - 18 + 90)
        self.assertAlmostEqual(self._gst_invoiced(self.SR2), 54)

    # -- idempotent ------------------------------------------------------------------------------

    def test_a_second_run_changes_nothing(self):
        self._vi(1180, autofill_all_entities_json=_entities("1000", "180"))
        self._vi(-118, is_credit_note=1, autofill_all_entities_json=_entities("100", "18"))
        self._vi(1180)
        self._vi(354, parent=self.SR2, invoice_base_amount=300, invoice_gst_amount=54)

        first = backfill(invoices=self.invoices)
        snapshot = self._snapshot()
        second = backfill(invoices=self.invoices)

        self.assertEqual(first, {"filled": 2, "left_blank": 1, "recomputed": 2})
        self.assertEqual(second, {"filled": 0, "left_blank": 1, "recomputed": 0})
        self.assertEqual(self._snapshot(), snapshot)

    def _snapshot(self):
        return (
            frappe.get_all(
                "Vendor Invoices",
                filters={"name": ["in", self.invoices]},
                fields=["name", "invoice_base_amount", "invoice_gst_amount", "modified"],
                order_by="name",
            ),
            frappe.get_all(
                "Service Requests",
                filters={"name": ["in", [self.SR, self.SR2]]},
                fields=["name", "gst_invoiced", "amount_invoiced", "amount_due", "modified"],
                order_by="name",
            ),
        )
