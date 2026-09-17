# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The Skipped popup's reads: its All / Inflow / Outflow tabs and its Skip Type filter (2026-09-17).

Pinned through the whitelisted `review` reads the popup calls:

  * `skipped_outflow` / `skipped_inflow` split `skipped` by direction with no row in both or neither,
    and each count in `tab_counts` equals the rows that scope returns;
  * the `skip_kind` facet narrows the page, its count and the export alike, and the funnel's own
    values are the stored kinds of the scope on screen;
  * every row carries `skip_kind`.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, so every read is scoped to the one batch created here.
"""

import json

import frappe

from nirmaan_stack.api.outflow_import.review import (
    export_outflow_rows,
    get_outflow_facet_values,
    get_outflow_rows,
)
from nirmaan_stack.api.outflow_import.test_skip_row import SkipFixture
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED, ROW_SKIPPED


class TestTheSkippedPopupReads(SkipFixture):
    def setUp(self):
        super().setUp()
        first = self._line(status=ROW_SKIPPED, direction="Debit", skip_kind="Already imported")
        self.batch = frappe.db.get_value("Outflow Import Row", first, "import_batch")
        self.lines = {
            "imported_out": first,
            "refused_out": self._line(
                batch=self.batch, status=ROW_SKIPPED, direction="", skip_kind="Bank refused"
            ),
            "recorded_in": self._line(
                batch=self.batch, status=ROW_SKIPPED, direction="Credit",
                skip_kind="Inflow Already Recorded",
            ),
            "wallet_in": self._line(
                batch=self.batch, status=ROW_SKIPPED, direction=" Credit ",
                skip_kind="Wallet money returned",
            ),
            "open_line": self._line(batch=self.batch, status=ROW_MISMATCHED, direction="Credit"),
        }

    def _page(self, **kwargs):
        return get_outflow_rows(batch=self.batch, limit=200, **kwargs)

    def _names(self, **kwargs):
        return {r["name"] for r in self._page(**kwargs)["rows"]}

    def test_the_direction_tabs_partition_skipped(self):
        out = self._names(scope="skipped_outflow")
        into = self._names(scope="skipped_inflow")
        self.assertEqual(out, {self.lines["imported_out"], self.lines["refused_out"]})
        self.assertEqual(into, {self.lines["recorded_in"], self.lines["wallet_in"]})
        self.assertEqual(out | into, self._names(scope="skipped"))

    def test_each_tab_count_is_what_that_tab_returns(self):
        counts = self._page(scope="skipped")["tab_counts"]
        for scope in ("skipped", "skipped_outflow", "skipped_inflow"):
            with self.subTest(scope=scope):
                self.assertEqual(counts[scope], self._page(scope=scope)["total"])
        # A skipped tab count never leaks into the working views.
        self.assertNotIn(self.lines["recorded_in"], self._names(scope="all"))

    def test_every_row_carries_its_kind(self):
        kinds = {r["name"]: r["skip_kind"] for r in self._page(scope="skipped")["rows"]}
        self.assertEqual(kinds[self.lines["refused_out"]], "Bank refused")
        self.assertEqual(kinds[self.lines["wallet_in"]], "Wallet money returned")

    def test_the_skip_type_facet_narrows_the_page_its_counts_and_the_export(self):
        facets = json.dumps({"skip_kind": ["Bank refused", "Wallet money returned"]})
        page = self._page(scope="skipped", facets=facets)
        self.assertEqual(
            {r["name"] for r in page["rows"]}, {self.lines["refused_out"], self.lines["wallet_in"]}
        )
        self.assertEqual(page["tab_counts"]["skipped_outflow"], 1)
        self.assertEqual(page["tab_counts"]["skipped_inflow"], 1)
        exported = export_outflow_rows(scope="skipped", batch=self.batch, facets=facets)
        self.assertEqual(
            {r["name"] for r in exported["rows"]}, {self.lines["refused_out"], self.lines["wallet_in"]}
        )
        self.assertEqual(
            {r["skip_kind"] for r in exported["rows"]}, {"Bank refused", "Wallet money returned"}
        )

    def test_the_funnel_offers_the_kinds_of_the_tab_on_screen(self):
        values = get_outflow_facet_values("skip_kind", batch=self.batch, scope="skipped_inflow")["values"]
        self.assertEqual(sorted(v for v in values if v), ["Inflow Already Recorded", "Wallet money returned"])


class TestTheSkipTypeHoverSources(SkipFixture):
    """`skip_source` on each Skipped row: the document that caused the skip."""

    def test_already_imported_names_the_earlier_statement(self):
        tid = f"hover-{frappe.generate_hash(length=8)}"
        original = self._line(status="Settled", transfer_id=tid, added_on="2026-09-01 10:00:00")
        first_batch = frappe.db.get_value("Outflow Import Row", original, "import_batch")
        again = self._line(
            status=ROW_SKIPPED, transfer_id=tid, added_on="2026-09-01 10:00:00",
            skip_origin="System", skip_kind="Already imported",
        )
        batch = frappe.db.get_value("Outflow Import Row", again, "import_batch")
        row = next(r for r in get_outflow_rows(scope="skipped", batch=batch)["rows"] if r["name"] == again)
        self.assertEqual(row["skip_source"]["earlier_import"]["name"], first_batch)

    def test_repeated_in_file_names_the_first_line(self):
        tid = f"hover-{frappe.generate_hash(length=8)}"
        first = self._line(status=ROW_MISMATCHED, transfer_id=tid, added_on="2026-09-01 10:00:00")
        batch = frappe.db.get_value("Outflow Import Row", first, "import_batch")
        repeat = self._line(
            batch=batch, status=ROW_SKIPPED, transfer_id=tid, added_on="2026-09-01 10:00:00",
            skip_origin="System", skip_kind="Repeated in same file",
        )
        row = next(r for r in get_outflow_rows(scope="skipped", batch=batch)["rows"] if r["name"] == repeat)
        self.assertEqual(row["skip_source"]["earlier_line"]["name"], first)

    def test_a_bank_rule_kind_carries_what_the_rule_catches(self):
        line = self._line(status=ROW_SKIPPED, skip_origin="System", skip_kind="Porter wallet top-up")
        batch = frappe.db.get_value("Outflow Import Row", line, "import_batch")
        row = get_outflow_rows(scope="skipped", batch=batch)["rows"][0]
        self.assertIn("Porter wallet", row["skip_source"]["rule"])
        self.assertIsNone(row["skip_source"]["earlier_import"])

    def test_a_row_that_is_not_skipped_carries_no_source(self):
        line = self._line(status=ROW_MISMATCHED)
        batch = frappe.db.get_value("Outflow Import Row", line, "import_batch")
        row = get_outflow_rows(scope="not_matched_outflow", batch=batch)["rows"][0]
        self.assertIsNone(row["skip_source"])
