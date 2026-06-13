"""Unit tests for the pure billing roll-up (compute_item_billing).

The SQL/IO wrapper (get_po_item_billing) is validated end-to-end against a live
PO separately; these tests pin the over-billing math, tolerance, split-row
aggregation, and orphan handling without touching the DB.

Run: env/bin/python -m unittest nirmaan_stack.api.invoices.test_get_po_item_billing
"""

import unittest

from nirmaan_stack.api.invoices.get_po_item_billing import compute_item_billing


def _po(item_id, amount, qty, name=None, unit="NOS"):
    return {"item_id": item_id, "item_name": name or item_id, "unit": unit,
            "quantity": qty, "amount": amount}


def _inv(item_id, amount, qty, count=1):
    return {"po_item_id": item_id, "invoiced_amount": amount,
            "invoiced_quantity": qty, "invoice_count": count}


class TestComputeItemBilling(unittest.TestCase):
    def _by_id(self, res):
        return {x["po_item_id"]: x for x in res["items"]}

    def test_clean_under_po_is_not_over_billed(self):
        res = compute_item_billing([_po("A", 1000, 10)], [_inv("A", 600, 6)])
        a = self._by_id(res)["A"]
        self.assertFalse(a["is_over_billed"])
        self.assertEqual(a["invoiced_amount"], 600)
        self.assertEqual(a["over_billed_amount"], 0)
        self.assertEqual(a["invoice_count"], 1)

    def test_amount_over_tolerance_is_over_billed(self):
        # +50 over PO amount, qty fine → over on amount.
        res = compute_item_billing([_po("A", 1000, 10)], [_inv("A", 1050, 10)])
        a = self._by_id(res)["A"]
        self.assertTrue(a["is_over_billed"])
        self.assertEqual(a["over_billed_amount"], 50)
        self.assertEqual(a["over_billed_quantity"], 0)

    def test_quantity_over_is_over_billed_even_if_amount_ok(self):
        # Amount under PO, but qty exceeds → over on quantity (more units, lower rate).
        res = compute_item_billing([_po("A", 1000, 10)], [_inv("A", 900, 12)])
        a = self._by_id(res)["A"]
        self.assertTrue(a["is_over_billed"])
        self.assertEqual(a["over_billed_quantity"], 2)
        self.assertEqual(a["over_billed_amount"], 0)

    def test_within_amount_tolerance_not_flagged(self):
        # +5 over (< ₹10 tolerance) and qty exact → not flagged.
        res = compute_item_billing([_po("A", 1000, 10)], [_inv("A", 1005, 10)])
        self.assertFalse(self._by_id(res)["A"]["is_over_billed"])

    def test_split_rows_same_item_id_sum_baseline(self):
        # One item across two PO rows: baseline = 1000+500 = 1500; invoiced 1400 → ok.
        res = compute_item_billing(
            [_po("A", 1000, 10, name="Item A r0"), _po("A", 500, 5, name="Item A r1")],
            [_inv("A", 1400, 14)],
        )
        a = self._by_id(res)["A"]
        self.assertEqual(a["po_amount"], 1500)
        self.assertEqual(a["po_quantity"], 15)
        self.assertFalse(a["is_over_billed"])

    def test_orphan_invoiced_item_absent_from_po_is_over_billed(self):
        # Item billed but not on the PO (removed by revision) → zero baseline → over.
        res = compute_item_billing([_po("A", 1000, 10)], [_inv("Z", 200, 2)])
        z = self._by_id(res)["Z"]
        self.assertTrue(z["is_over_billed"])
        self.assertEqual(z["po_amount"], 0)
        self.assertEqual(z["over_billed_amount"], 200)

    def test_po_item_with_no_invoices_shows_zero(self):
        res = compute_item_billing([_po("A", 1000, 10)], [])
        a = self._by_id(res)["A"]
        self.assertEqual(a["invoiced_amount"], 0)
        self.assertEqual(a["invoice_count"], 0)
        self.assertFalse(a["is_over_billed"])

    def test_summary_counts(self):
        res = compute_item_billing(
            [_po("A", 1000, 10), _po("B", 500, 5)],
            [_inv("A", 1100, 10), _inv("B", 100, 1)],
        )
        s = res["summary"]
        self.assertEqual(s["items"], 2)
        self.assertEqual(s["over_billed"], 1)  # only A
        self.assertEqual(s["total_po_amount"], 1500)
        self.assertEqual(s["total_invoiced_amount"], 1200)

    def test_over_billed_sorted_first(self):
        res = compute_item_billing(
            [_po("A", 1000, 10, name="Zeta"), _po("B", 500, 5, name="Alpha")],
            [_inv("A", 2000, 10)],  # A over-billed
        )
        # A (over-billed) must sort ahead of B despite name ordering.
        self.assertEqual(res["items"][0]["po_item_id"], "A")


if __name__ == "__main__":
    unittest.main()
