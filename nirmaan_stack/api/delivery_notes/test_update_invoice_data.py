"""Unit tests for build_line_mapping_rows — the verified-mapping → child-row
converter. Pure (stubbed PO doc); no DB.

Run: env/bin/python -m unittest nirmaan_stack.api.delivery_notes.test_update_invoice_data
"""

import json
import unittest

from nirmaan_stack.api.delivery_notes.update_invoice_data import build_line_mapping_rows


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


if __name__ == "__main__":
    unittest.main()
