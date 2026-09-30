"""Tests for the invoice create / edit endpoint.

  * `TestBuildLineMappingRows` -- the verified-mapping -> child-row converter. Pure
    (stubbed PO doc); no DB.
  * `TestInvoiceSplitFigures` -- the Invoice Base Amount / Invoice GST Amount split
    (#1336, ADR-0030), driven through `update_invoice_data` itself against the live
    site. The endpoint COMMITS, so every row it or a fixture writes is deleted in
    cleanup.
  * `TestOrderTotalCap` -- Pending + Approved invoices on a Work Order are capped at its
    total + Rs 10, the rule Purchase Orders already had (#1337); same endpoint, same cleanup.

Run: bench --site localhost run-tests --module nirmaan_stack.api.delivery_notes.test_update_invoice_data
"""

import json
import unittest

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.api.delivery_notes.update_invoice_data import (
    build_line_mapping_rows,
    update_invoice_data,
)
from nirmaan_stack.api.invoices.approve_vendor_invoice import approve_vendor_invoice


class _Row(dict):
    """Stub Purchase Order Item child row: dict fields + a `.name` attribute."""
    def __init__(self, name, **kw):
        super().__init__(**kw)
        self.name = name

    def get(self, k, d=None):
        return dict.get(self, k, d)


class _PO:
    doctype = "Procurement Orders"

    def __init__(self, items):
        self._items = items

    def get(self, k, d=None):
        return self._items if k == "items" else d


class _SR:
    doctype = "Service Requests"

    def get(self, k, d=None):
        return d


PO = lambda: _PO([
    _Row("po-row-0", item_id="ITEM-A", item_name="Heat Shrink Sleeve", quantity=1, quote=4850, amount=4850),
    _Row("po-row-1", item_id="ITEM-B", item_name="Heat Gun", quantity=1, quote=1250, amount=1250),
])


def _match(**mappings):
    return json.dumps({"mappings": list(mappings.values())})


class TestBuildLineMappingRows(unittest.TestCase):
    def test_matched_row_resolves_po_item_row_from_index(self):
        rows = build_line_mapping_rows(json.dumps({"mappings": [
            {"description": "HEAT GUN", "unit": "NOS", "quantity": 1, "rate": 1250, "amount": 1250,
             "po_item_id": "ITEM-B", "po_item_name": "Heat Gun", "po_row": 1, "score": 1.0,
             "source": "fuzzy", "status": "matched",
             "over_billing": {"would_exceed": False}},
        ]}), PO())
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r["match_status"], "Matched")
        self.assertEqual(r["po_item_row"], "po-row-1")   # resolved from po_row index
        self.assertEqual(r["po_item_id"], "ITEM-B")
        self.assertEqual(r["po_item_name"], "Heat Gun")
        self.assertEqual(r["match_source"], "Fuzzy")
        self.assertEqual(r["match_score"], 1.0)
        self.assertEqual(r["is_over_billed"], 0)

    def test_unmatched_row_carries_no_po_fields(self):
        rows = build_line_mapping_rows(json.dumps({"mappings": [
            {"description": "30MM SEAT SHRINK SLEEVE", "unit": "NOS", "quantity": 50, "rate": 97,
             "amount": 4850, "po_item_id": None, "po_row": None, "status": "unmatched", "source": None},
        ]}), PO())
        r = rows[0]
        self.assertEqual(r["match_status"], "Unmatched")
        self.assertIsNone(r["po_item_id"])
        self.assertIsNone(r["po_item_row"])
        self.assertEqual(r["match_source"], "")
        self.assertEqual(r["quantity"], 50.0)

    def test_non_item_row(self):
        rows = build_line_mapping_rows(json.dumps({"mappings": [
            {"description": "Freight Charges", "amount": 500, "status": "non_item", "source": "manual"},
        ]}), PO())
        self.assertEqual(rows[0]["match_status"], "Non-Item")
        self.assertEqual(rows[0]["match_source"], "Manual")
        self.assertIsNone(rows[0]["po_item_id"])

    def test_source_vocabulary_mapping(self):
        for raw, expected in [("fuzzy", "Fuzzy"), ("gemini", "AI"), ("manual", "Manual"), ("", ""), (None, "")]:
            rows = build_line_mapping_rows(json.dumps({"mappings": [
                {"description": "x", "po_row": 0, "po_item_id": "ITEM-A", "status": "matched", "source": raw},
            ]}), PO())
            self.assertEqual(rows[0]["match_source"], expected, f"source {raw!r}")

    def test_over_billing_flag_propagates(self):
        rows = build_line_mapping_rows(json.dumps({"mappings": [
            {"description": "x", "po_row": 0, "po_item_id": "ITEM-A", "status": "matched", "source": "fuzzy",
             "over_billing": {"would_exceed": True}},
        ]}), PO())
        self.assertEqual(rows[0]["is_over_billed"], 1)

    def test_po_row_out_of_range_keeps_id_but_no_row(self):
        rows = build_line_mapping_rows(json.dumps({"mappings": [
            {"description": "x", "po_row": 99, "po_item_id": "ITEM-B", "po_item_name": "Heat Gun",
             "status": "matched", "source": "manual"},
        ]}), PO())
        r = rows[0]
        self.assertIsNone(r["po_item_row"])          # index invalid → unresolved
        self.assertEqual(r["po_item_id"], "ITEM-B")  # falls back to payload value

    def test_non_po_parent_yields_nothing(self):
        self.assertEqual(build_line_mapping_rows(_match(), _SR()), [])

    def test_unparseable_json_yields_nothing(self):
        self.assertEqual(build_line_mapping_rows("not json", PO()), [])
        self.assertEqual(build_line_mapping_rows(None, PO()), [])

    def test_empty_and_malformed_mappings(self):
        self.assertEqual(build_line_mapping_rows(json.dumps({"mappings": []}), PO()), [])
        # Non-dict entries are skipped.
        rows = build_line_mapping_rows(json.dumps({"mappings": ["junk", {"description": "ok", "status": "unmatched"}]}), PO())
        self.assertEqual(len(rows), 1)


def _raw(doctype, **fields):
    """A parent row with only the fields the endpoint reads, skipping hooks/validation."""
    d = frappe.new_doc(doctype)
    d.update(fields)
    d.name = "TEST-SPLIT-" + frappe.generate_hash(length=10)
    d.db_insert()
    return d.name


class _InvoiceEndpointCase(FrappeTestCase):
    """One PO and two Work Orders (GST on / off), each with total `TOTAL`."""

    TOTAL = 1_000_000

    def setUp(self):
        self.po = _raw("Procurement Orders", total_amount=self.TOTAL)
        self.wo_gst_on = _raw("Service Requests", total_amount=self.TOTAL, gst="true")
        self.wo_gst_off = _raw("Service Requests", total_amount=self.TOTAL, gst="false")
        frappe.db.commit()
        self.addCleanup(self._purge)

    def _purge(self):
        frappe.db.rollback()
        parents = (self.po, self.wo_gst_on, self.wo_gst_off)
        frappe.db.delete("Vendor Invoices", {"document_name": ("in", parents)})
        frappe.db.delete("Procurement Orders", {"name": self.po})
        frappe.db.delete("Service Requests", {"name": ("in", parents[1:])})
        frappe.db.commit()

    def _save(self, parent, invoice_id=None, **invoice):
        extra = invoice.pop("_extra", None) or {}
        data = {"invoice_no": "T-" + frappe.generate_hash(length=8), "date": nowdate()}
        data.update(invoice)
        return update_invoice_data(
            docname=parent,
            invoice_data=json.dumps(data),
            isSR=parent != self.po,
            invoice_id=invoice_id,
            **extra,
        )

    def _stored(self, name):
        return frappe.db.get_value(
            "Vendor Invoices",
            name,
            ["invoice_amount", "invoice_base_amount", "invoice_gst_amount",
             "autofill_extracted_base_amount", "autofill_extracted_gst_amount"],
            as_dict=True,
        )

    def _count(self, parent):
        return frappe.db.count("Vendor Invoices", {"document_name": parent})


class TestInvoiceSplitFigures(_InvoiceEndpointCase):
    # ------------------------------------------------------------------ stored

    def test_po_invoice_stores_base_and_gst(self):
        res = self._save(self.po, amount=59000, base_amount=50000, gst_amount=9000)
        self.assertEqual(res["status"], 200, res)
        row = self._stored(res["data"]["vendor_invoice_id"])
        self.assertEqual(flt(row.invoice_amount), 59000)
        self.assertEqual(flt(row.invoice_base_amount), 50000)
        self.assertEqual(flt(row.invoice_gst_amount), 9000)
        self.assertEqual(res["warnings"], [])

    def test_wo_invoice_stores_base_and_gst(self):
        res = self._save(self.wo_gst_on, amount=1180, base_amount="1,000", gst_amount="180")
        self.assertEqual(res["status"], 200, res)
        row = self._stored(res["data"]["vendor_invoice_id"])
        self.assertEqual(flt(row.invoice_base_amount), 1000)
        self.assertEqual(flt(row.invoice_gst_amount), 180)

    def test_zero_gst_is_accepted(self):
        res = self._save(self.wo_gst_off, amount=1000, base_amount=1000, gst_amount=0)
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(flt(self._stored(res["data"]["vendor_invoice_id"]).invoice_gst_amount), 0)

    def test_ai_read_split_is_kept_beside_the_confirmed_figures(self):
        res = self._save(
            self.po, amount=59000, base_amount=50000, gst_amount=9000,
            _extra={
                "autofill_used": True,
                "autofill_extracted_base_amount": "49000",
                "autofill_extracted_gst_amount": "8820",
            },
        )
        self.assertEqual(res["status"], 200, res)
        row = self._stored(res["data"]["vendor_invoice_id"])
        self.assertEqual(flt(row.invoice_base_amount), 50000)       # what the user confirmed
        self.assertEqual(flt(row.autofill_extracted_base_amount), 49000)  # what the AI read
        self.assertEqual(flt(row.autofill_extracted_gst_amount), 8820)

    # ------------------------------------------------------------------ required on create

    def test_create_without_base_is_refused(self):
        res = self._save(self.po, amount=59000, gst_amount=9000)
        self.assertEqual(res["status"], 400)
        self.assertIn("Invoice Base Amount", res["message"])
        self.assertEqual(self._count(self.po), 0)

    def test_create_with_blank_gst_is_refused(self):
        res = self._save(self.wo_gst_on, amount=1180, base_amount=1000, gst_amount="")
        self.assertEqual(res["status"], 400)
        self.assertIn("Invoice GST Amount", res["message"])
        self.assertNotIn("Invoice Base Amount", res["message"])
        self.assertEqual(self._count(self.wo_gst_on), 0)

    def test_split_is_not_reqd_so_an_old_invoice_stays_approvable(self):
        """Required at upload only. An invoice saved before the split existed carries none,
        and must still pass the document layer and the approve endpoint."""
        meta = frappe.get_meta("Vendor Invoices")
        for field in ("invoice_base_amount", "invoice_gst_amount"):
            self.assertFalse(meta.get_field(field).reqd, field)
        old = frappe.get_doc({
            "doctype": "Vendor Invoices",
            "document_type": "Service Requests",
            "document_name": self.wo_gst_on,
            "invoice_no": "OLD-" + frappe.generate_hash(length=6),
            "invoice_date": nowdate(),
            "invoice_amount": 1180,
            "status": "Pending",
        }).insert(ignore_permissions=True)
        frappe.db.commit()
        res = approve_vendor_invoice(old.name, "Approved")
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(frappe.db.get_value("Vendor Invoices", old.name, "status"), "Approved")

    # ------------------------------------------------------------------ warnings

    def test_split_more_than_5_off_the_total_warns_but_saves(self):
        res = self._save(self.po, amount=59000, base_amount=50000, gst_amount=8990)  # gap 10
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(len(res["warnings"]), 1)
        self.assertIn("away from the Invoice Amount", res["warnings"][0])
        self.assertEqual(self._count(self.po), 1)

    def test_split_within_5_of_the_total_is_silent(self):
        res = self._save(self.po, amount=59004, base_amount=50000, gst_amount=9000)  # round-off 4
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(res["warnings"], [])

    def test_gst_on_a_gst_off_work_order_warns_but_saves(self):
        res = self._save(self.wo_gst_off, amount=1180, base_amount=1000, gst_amount=180)
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(len(res["warnings"]), 1)
        self.assertIn("GST off", res["warnings"][0])
        self.assertEqual(self._count(self.wo_gst_off), 1)

    def test_gst_on_a_gst_on_work_order_is_silent(self):
        res = self._save(self.wo_gst_on, amount=1180, base_amount=1000, gst_amount=180)
        self.assertEqual(res["warnings"], [])

    # ------------------------------------------------------------------ credit note

    def test_credit_note_stores_base_and_gst_negative(self):
        res = self._save(
            self.po, amount=-1180, base_amount=1000, gst_amount=180, is_credit_note=1,
        )
        self.assertEqual(res["status"], 200, res)
        row = self._stored(res["data"]["vendor_invoice_id"])
        self.assertEqual(flt(row.invoice_amount), -1180)
        self.assertEqual(flt(row.invoice_base_amount), -1000)
        self.assertEqual(flt(row.invoice_gst_amount), -180)
        self.assertEqual(res["warnings"], [])

    # ------------------------------------------------------------------ edit

    def test_edit_changes_base_and_gst(self):
        name = self._save(self.po, amount=59000, base_amount=50000, gst_amount=9000)["data"]["vendor_invoice_id"]
        res = self._save(self.po, invoice_id=name, amount=59000, base_amount=50001, gst_amount=8999)
        self.assertEqual(res["status"], 200, res)
        row = self._stored(name)
        self.assertEqual(flt(row.invoice_base_amount), 50001)
        self.assertEqual(flt(row.invoice_gst_amount), 8999)

    def test_edit_without_the_split_keys_leaves_them_untouched(self):
        """An older client edits only number/date/amount; the stored split must survive."""
        name = self._save(self.po, amount=59000, base_amount=50000, gst_amount=9000)["data"]["vendor_invoice_id"]
        res = self._save(self.po, invoice_id=name, amount=59000)
        self.assertEqual(res["status"], 200, res)
        row = self._stored(name)
        self.assertEqual(flt(row.invoice_base_amount), 50000)
        self.assertEqual(flt(row.invoice_gst_amount), 9000)



class TestOrderTotalCap(_InvoiceEndpointCase):
    """Pending + Approved invoice amounts on an order may not pass its total + Rs 10."""

    TOTAL = 11_800

    def _invoice(self, parent, amount, invoice_id=None):
        """Save an invoice whose base + GST add up to `amount` (so no split warning)."""
        gst = round(amount * 18 / 118, 2)
        return self._save(
            parent, invoice_id=invoice_id,
            amount=amount, base_amount=round(amount - gst, 2), gst_amount=gst,
        )

    def _ok(self, parent, amount):
        res = self._invoice(parent, amount)
        self.assertEqual(res["status"], 200, res)
        return res["data"]["vendor_invoice_id"]

    # ------------------------------------------------------------------ Work Order, create

    def test_wo_invoice_over_total_plus_10_is_refused(self):
        res = self._invoice(self.wo_gst_on, 11_811)
        self.assertEqual(res["status"], 400, res)
        self.assertIn("exceeds the Work Order total of ₹11,800.00", res["message"])
        self.assertIn("₹11,811.00", res["message"])
        self.assertEqual(self._count(self.wo_gst_on), 0)

    def test_wo_invoice_up_to_total_plus_10_saves(self):
        self._ok(self.wo_gst_on, 11_810)
        self.assertEqual(self._count(self.wo_gst_on), 1)

    def test_gst_off_wo_is_capped_at_its_own_total(self):
        res = self._invoice(self.wo_gst_off, 11_811)
        self.assertEqual(res["status"], 400, res)
        self.assertIn("Work Order total", res["message"])

    def test_pending_and_approved_invoices_both_count(self):
        self._ok(self.wo_gst_on, 6_000)                                   # stays Pending
        approved = self._ok(self.wo_gst_on, 5_000)
        self.assertEqual(approve_vendor_invoice(approved, "Approved")["status"], 200)

        res = self._invoice(self.wo_gst_on, 900)                          # 11,900 > 11,810
        self.assertEqual(res["status"], 400, res)
        self.assertIn("Already invoiced ₹11,000.00", res["message"])
        self._ok(self.wo_gst_on, 800)                                     # 11,800 fits
        self.assertEqual(self._count(self.wo_gst_on), 3)

    def test_rejected_invoice_does_not_count(self):
        rejected = self._ok(self.wo_gst_on, 11_800)
        self.assertEqual(approve_vendor_invoice(rejected, "Rejected", "wrong bill")["status"], 200)
        self._ok(self.wo_gst_on, 11_800)

    def test_credit_note_is_not_capped(self):
        self._ok(self.wo_gst_on, 11_800)
        res = self._save(
            self.wo_gst_on, amount=-1180, base_amount=1000, gst_amount=180, is_credit_note=1,
        )
        self.assertEqual(res["status"], 200, res)

    def test_wo_without_a_total_is_not_capped(self):
        frappe.db.set_value("Service Requests", self.wo_gst_on, "total_amount", 0)  # test fixture, no hooks
        frappe.db.commit()
        self._ok(self.wo_gst_on, 50_000)

    # ------------------------------------------------------------------ Work Order, edit

    def test_edit_in_place_does_not_count_the_invoice_twice(self):
        name = self._ok(self.wo_gst_on, 11_000)
        res = self._invoice(self.wo_gst_on, 11_800, invoice_id=name)
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(flt(self._stored(name).invoice_amount), 11_800)

    def test_edit_over_total_is_refused_and_leaves_the_invoice_alone(self):
        self._ok(self.wo_gst_on, 6_000)
        name = self._ok(self.wo_gst_on, 5_000)
        res = self._invoice(self.wo_gst_on, 5_900, invoice_id=name)       # 6,000 + 5,900
        self.assertEqual(res["status"], 400, res)
        self.assertIn("Work Order total", res["message"])
        self.assertIn("Already invoiced ₹6,000.00", res["message"])
        self.assertEqual(flt(self._stored(name).invoice_amount), 5_000)

    # ------------------------------------------------------------------ Purchase Order, unchanged

    def test_po_invoice_over_total_is_refused_with_the_po_message(self):
        self._ok(self.po, 5_000)
        res = self._invoice(self.po, 6_811)
        self.assertEqual(res["status"], 400, res)
        self.assertEqual(
            res["message"],
            "Total invoiced amount would be ₹11,811.00, which exceeds the PO total of "
            "₹11,800.00. Already invoiced ₹5,000.00. Please revise the amount before submitting.",
        )
        self.assertEqual(self._count(self.po), 1)

    def test_po_invoice_up_to_total_plus_10_saves(self):
        self._ok(self.po, 11_810)

    def test_po_invoices_do_not_count_toward_a_work_order(self):
        """The sum is per order: a PO and a Work Order with the same total don't share it."""
        self._ok(self.po, 11_800)
        self._ok(self.wo_gst_on, 11_800)

if __name__ == "__main__":
    unittest.main()
