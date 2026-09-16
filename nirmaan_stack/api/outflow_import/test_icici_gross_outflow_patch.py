# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""`patches/v3_0/recompute_icici_gross_outflow.py` against real batches (ticket #1287).

The direction split itself is pinned purely in `services/outflow_import/test_parser.py`; this pins
that the patch reads the right rows off real staged lines, corrects the stored figure, leaves the
other two sources alone, and is a no-op the second time.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, so it calls `recompute_gross_outflow(batches=...)` with only
the batches it created -- never `execute()`, which would recompute every real ICICI import on the
site. Same rule, and the same reason, as `test_skip_origin_backfill.py`.
"""

import unittest

import frappe

from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.patches.v3_0.recompute_icici_gross_outflow import recompute_gross_outflow

ICICI = "ICICI Bank Statement"


class TestIciciGrossOutflowPatch(unittest.TestCase):
    def setUp(self):
        self.batches: list[str] = []

    def tearDown(self):
        frappe.set_user("Administrator")
        for batch in self.batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": batch})
            if frappe.db.exists(BATCH_DOCTYPE, batch):
                frappe.delete_doc(BATCH_DOCTYPE, batch, force=True, ignore_permissions=True)
        frappe.db.commit()

    # -- fixture ---------------------------------------------------------------------------------

    def _batch(self, source=ICICI, stored_gross=0.0, rows=()):
        """One import batch with `rows` as `(amount, direction)` pairs and a WRONG stored total.

        `stored_gross` is written as the pre-#1287 code would have left it, so the patch has
        something real to correct rather than agreeing with itself.
        """
        batch = frappe.new_doc(BATCH_DOCTYPE)
        batch.update(
            {
                "source": source,
                "original_filename": "patch-fixture.csv",
                "gross_amount": stored_gross,
                "charges_amount": 0,
                "uploaded_by": "Administrator",
                "uploaded_at": frappe.utils.now_datetime(),
                "status": "Draft",
            }
        )
        batch.insert(ignore_permissions=True)
        self.batches.append(batch.name)

        for position, (amount, direction) in enumerate(rows, start=1):
            row = frappe.new_doc(ROW_DOCTYPE)
            row.update(
                {
                    "import_batch": batch.name,
                    "source": source,
                    "transfer_id": f"{batch.name}-{position}",
                    "amount": amount,
                    "direction": direction,
                    "status_raw": "SUCCESS",
                    # ⚠️ `row_status`, NOT `status` -- this doctype has no field called `status`, and
                    # Frappe's `get_valid_dict` DROPS an unknown key silently. A fixture written the
                    # wrong way reads as configuration and is doing nothing: harmless while the patch
                    # has no row-status term, but it would make a later `row_status` condition look
                    # covered by tests that only ever exercise the default.
                    "row_status": "Mismatched",
                }
            )
            row.insert(ignore_permissions=True)
        frappe.db.commit()
        return batch.name

    def _stored(self, batch) -> float:
        return float(frappe.db.get_value(BATCH_DOCTYPE, batch, "gross_amount") or 0)

    # -- the correction --------------------------------------------------------------------------

    def test_an_icici_total_is_recomputed_to_its_debits_alone(self):
        """⚠️ THE SHAPE THE TICKET DESCRIBES: the stored figure was withdrawals PLUS deposits."""
        batch = self._batch(
            stored_gross=900.0,  # what the old parser stored: 600 out + 300 in
            rows=[("400", "Debit"), ("200", "Debit"), ("300", "Credit")],
        )
        self.assertEqual(recompute_gross_outflow(batches=[batch]), {batch: 600.0})
        self.assertEqual(self._stored(batch), 600.0)

    def test_a_row_with_no_direction_is_in_no_total(self):
        """A blank direction is "the statement did not say", never "debit by default" -- the rule
        `parser.py` states in as many words, and the reason an unscoped `direction != 'Credit'` would
        have been wrong here."""
        batch = self._batch(
            stored_gross=5100.0,
            rows=[("100", "Debit"), ("5000", ""), ("40", "Credit")],
        )
        self.assertEqual(recompute_gross_outflow(batches=[batch]), {batch: 100.0})
        self.assertEqual(self._stored(batch), 100.0)

    def test_padding_around_the_direction_still_counts_as_a_debit(self):
        """The `TRIM` mirrors every other spelling of this predicate. No stored row carries padding
        today, which is exactly why it is planted rather than assumed."""
        batch = self._batch(stored_gross=0.0, rows=[("100", " Debit "), ("40", " Credit ")])
        self.assertEqual(recompute_gross_outflow(batches=[batch]), {batch: 100.0})

    def test_a_credit_only_statement_is_corrected_to_zero_rather_than_left_alone(self):
        """An all-deposits period really did pay nothing out. Zero is the answer, and skipping it
        because it "looks like an empty write" would leave the worst case wrong."""
        batch = self._batch(stored_gross=750.0, rows=[("500", "Credit"), ("250", "Credit")])
        self.assertEqual(recompute_gross_outflow(batches=[batch]), {batch: 0.0})
        self.assertEqual(self._stored(batch), 0.0)

    # -- what it must not touch ------------------------------------------------------------------

    def test_cashfree_and_cashbook_are_left_exactly_as_they_are(self):
        """⚠️ THE SCOPE IS LOAD-BEARING. Those two are outflow-only exports whose stored figure was
        never wrong, and their rows may legitimately read BLANK on direction -- so a debit-only row
        sum over them would silently SHRINK a correct total."""
        for source in ("Cashfree", "Cashbook"):
            with self.subTest(source=source):
                batch = self._batch(
                    source=source,
                    stored_gross=150.0,
                    rows=[("100", ""), ("50", "")],
                )
                self.assertEqual(recompute_gross_outflow(batches=[batch]), {})
                self.assertEqual(self._stored(batch), 150.0)

    def test_an_icici_batch_with_no_rows_is_left_alone_rather_than_zeroed(self):
        """An absent row set is not evidence that nothing was paid out."""
        batch = self._batch(stored_gross=900.0, rows=[])
        self.assertEqual(recompute_gross_outflow(batches=[batch]), {})
        self.assertEqual(self._stored(batch), 900.0)

    def test_an_empty_scope_is_nothing_and_never_falls_through_to_every_batch(self):
        """`batches=[]` and `batches=None` are different instructions. Collapsing them is how a
        scoped test recomputes the whole site."""
        batch = self._batch(stored_gross=900.0, rows=[("600", "Debit"), ("300", "Credit")])
        self.assertEqual(recompute_gross_outflow(batches=[]), {})
        self.assertEqual(self._stored(batch), 900.0)

    # -- idempotence -----------------------------------------------------------------------------

    def test_running_it_twice_changes_nothing_more(self):
        batch = self._batch(stored_gross=900.0, rows=[("600", "Debit"), ("300", "Credit")])
        recompute_gross_outflow(batches=[batch])
        modified = frappe.db.get_value(BATCH_DOCTYPE, batch, "modified")

        self.assertEqual(recompute_gross_outflow(batches=[batch]), {})
        self.assertEqual(self._stored(batch), 600.0)
        # ⚠️ `modified` MUST NOT MOVE. The batch was not edited; a stale derivation was corrected,
        # and bumping the timestamp would make an audit read as a change somebody made.
        self.assertEqual(frappe.db.get_value(BATCH_DOCTYPE, batch, "modified"), modified)

    def test_an_already_correct_icici_batch_is_not_rewritten_on_the_first_run_either(self):
        batch = self._batch(stored_gross=600.0, rows=[("600", "Debit"), ("300", "Credit")])
        modified = frappe.db.get_value(BATCH_DOCTYPE, batch, "modified")
        self.assertEqual(recompute_gross_outflow(batches=[batch]), {})
        self.assertEqual(frappe.db.get_value(BATCH_DOCTYPE, batch, "modified"), modified)
