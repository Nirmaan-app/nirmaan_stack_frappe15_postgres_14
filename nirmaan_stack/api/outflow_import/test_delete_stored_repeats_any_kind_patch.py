# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The cleanup of exact repeats stored under ANY skip kind (#1359), against real rows.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, so it calls `run_cleanup(batches=..., any_kind=True)` with
only the imports it created -- never `execute()`, which would clean every real import on the site.
"""

import frappe

from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE
from nirmaan_stack.api.outflow_import.test_delete_stored_repeats_patch import (
    BATCH_DOCTYPE,
    ROW_DOCTYPE,
    RepeatFixture,
)
from nirmaan_stack.patches.v3_0.delete_stored_exact_repeats import run_cleanup
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED, ROW_SKIPPED, derive_batch_status

_ICICI = {"source": "ICICI Bank Statement", "direction": "Debit", "remarks": "CASHFREEID top up"}


class AnyKindFixture(RepeatFixture):
    def _cleanup(self, *batches):
        plan = run_cleanup(batches=list(batches), any_kind=True)
        frappe.db.commit()
        return plan

    def _copy(self, original, batch, **fields):
        """A copy of `original` in `batch`, every field overridable (`_repeat` fixes the skip)."""
        src = frappe.db.get_value(
            ROW_DOCTYPE, original,
            ["transfer_id", "amount", "status_raw", "source", "direction", "remarks"], as_dict=True,
        )
        return self._line(batch=batch, **{**src, "bank_reference_no": src.transfer_id, **fields})

    def _skip(self, batch, kind, origin="System", **fields):
        return self._line(batch=batch, status=ROW_SKIPPED, skip_origin=origin, skip_kind=kind, **fields)


class TestWhatGoes(AnyKindFixture):
    """An earlier import holds the originals; a later one holds copies stored under other kinds."""

    def setUp(self):
        super().setUp()
        money = {"service_charge": 8.0, "service_tax": 1.44}
        # ICICI: a wallet top-up, skipped by an exclusion rule both times.
        self.icici_a = self._batch("ICICI Bank Statement")
        top_up = self._skip(self.icici_a, "Cashfree wallet top-up", amount=5000.0, **_ICICI, **money)
        self.icici_b = self._batch("ICICI Bank Statement")
        self.icici_new = self._line(batch=self.icici_b, amount=700.0, **{**_ICICI, "remarks": "NEFT x"},
                                    **money)
        self.icici_copy = self._repeat(top_up, self.icici_b, "Cashfree wallet top-up", **money)

        # Cashbook: an internal movement, and a REFUNDED copy of a stored REFUNDED line.
        cb = {"source": "Cashbook", "direction": "Debit"}
        self.cb_a = self._batch("Cashbook")
        movement = self._skip(self.cb_a, "Cashbook internal movement", **cb)
        refunded = self._skip(self.cb_a, "Already imported", status_raw="REFUNDED", **cb)
        self.cb_b = self._batch("Cashbook")
        self.cb_movement_copy = self._repeat(movement, self.cb_b, "Cashbook internal movement")
        self.cb_refunded_copy = self._repeat(refunded, self.cb_b, "Already imported")

        # Cashfree: a QUEUED line stored on two overlapping uploads, and a QUEUED copy in one file.
        self.cf_a = self._batch("Cashfree")
        queued = self._skip(self.cf_a, "Bank refused", status_raw="QUEUED")
        self.cf_b = self._batch("Cashfree")
        self.cf_queued_copy = self._repeat(queued, self.cf_b, "Bank refused")
        self.cf_in_file_copy = self._repeat(self.cf_queued_copy, self.cf_b, "Bank refused")

        self.copies = [self.icici_copy, self.cb_movement_copy, self.cb_refunded_copy,
                       self.cf_queued_copy, self.cf_in_file_copy]
        self.originals = [top_up, movement, refunded, queued]

    def test_exact_repeats_of_any_kind_go_and_the_originals_stay(self):
        plan = self._cleanup(*self.batches)
        for row in self.copies:
            self.assertFalse(self._exists(row), row)
        for row in [*self.originals, self.icici_new]:
            self.assertTrue(self._exists(row), row)
        self.assertEqual(
            dict(plan.by_kind),
            {"Cashfree wallet top-up": 1, "Cashbook internal movement": 1, "Already imported": 1,
             "Bank refused": 2},
        )

    def test_the_count_counters_status_and_money_come_from_the_remaining_rows(self):
        self._cleanup(*self.batches)
        icici = self._stored(self.icici_b)
        self.assertEqual((icici.repeats_not_saved, icici.total_rows, icici.skipped_rows), (1, 1, 0))
        self.assertEqual(icici.status, derive_batch_status([ROW_MISMATCHED]))
        self.assertEqual(float(icici.gross_amount), 700.0)
        self.assertAlmostEqual(float(icici.charges_amount), 8.0 + 1.44)
        self.assertEqual(self._stored(self.cb_b).repeats_not_saved, 2)
        self.assertEqual(self._stored(self.cf_b).repeats_not_saved, 2)
        # Every row of these two was a repeat: kept, Completed, with its count.
        for batch in (self.cb_b, self.cf_b):
            stored = self._stored(batch)
            self.assertEqual((stored.status, stored.total_rows), ("Completed", 0))

    def test_no_deleted_document_copy_is_made(self):
        self._cleanup(*self.batches)
        self.assertEqual(
            frappe.db.count(
                "Deleted Document", {"deleted_doctype": ROW_DOCTYPE, "deleted_name": ["in", self.copies]}
            ),
            0,
        )

    def test_a_second_run_changes_nothing(self):
        self._cleanup(*self.batches)
        after = {b: self._stored(b) for b in self.batches}
        rows = sorted(frappe.get_all(ROW_DOCTYPE, filters={"import_batch": ["in", self.batches]},
                                     pluck="name"))

        plan = self._cleanup(*self.batches)

        self.assertEqual(plan.delete, {})
        self.assertEqual({b: self._stored(b) for b in self.batches}, after)
        self.assertEqual(
            sorted(frappe.get_all(ROW_DOCTYPE, filters={"import_batch": ["in", self.batches]},
                                  pluck="name")),
            rows,
        )


class TestWhatStays(AnyKindFixture):
    def setUp(self):
        super().setUp()
        self.earlier = self._batch("Cashfree")
        self.original = self._skip(self.earlier, "Bank refused", status_raw="FAILED")
        self.later = self._batch("Cashfree")

    def test_a_hand_skip_is_kept(self):
        copy = self._copy(self.original, self.later, status=ROW_SKIPPED, skip_origin="Manual",
                          skip_kind="Skipped by hand")
        self._cleanup(self.earlier, self.later)
        self.assertTrue(self._exists(copy))

    def test_a_row_with_a_claim_is_kept(self):
        copy = self._repeat(
            self.original, self.later, "Outflow Already Recorded",
            duplicate_basis=frappe.as_json([{"doctype": "Project Payments", "name": "x"}]),
        )
        self._cleanup(self.earlier, self.later)
        self.assertTrue(self._exists(copy))

    def test_a_linked_row_is_kept(self):
        copy = self._repeat(self.original, self.later, "Bank refused")
        frappe.db.sql(
            f"""INSERT INTO "tab{MATCH_DOCTYPE}"
                    (name, creation, modified, owner, modified_by, docstatus, idx,
                     import_row, import_batch, transfer_id, target_doctype, target_name)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s, 'x',
                        'Project Payments', 'nothing')""",
            (f"test-1359-{frappe.generate_hash(length=8)}", copy, self.later),
        )
        frappe.db.commit()
        plan = self._cleanup(self.earlier, self.later)
        self.assertEqual(plan.kept_linked, [copy])
        self.assertTrue(self._exists(copy))

    def test_a_status_changed_repeat_is_kept(self):
        success = self._line(batch=self.earlier)
        changed = self._repeat(success, self.later, "Already imported", status_raw="REVERSED")
        plan = self._cleanup(self.earlier, self.later)
        self.assertIn(changed, plan.kept_status_changed)
        self.assertTrue(self._exists(changed))

    def test_a_row_that_is_not_skipped_is_never_deleted(self):
        same = self._copy(self.original, self.later, status=ROW_MISMATCHED)
        self._cleanup(self.earlier, self.later)
        self.assertTrue(self._exists(same))

    def test_an_in_flight_original_never_makes_a_later_status_a_repeat(self):
        """D4: a stored QUEUED line and a later SUCCESS copy are not one line."""
        queued = self._skip(self.earlier, "Bank refused", status_raw="QUEUED")
        success = self._repeat(queued, self.later, "Bank refused", status_raw="SUCCESS")
        self._cleanup(self.earlier, self.later)
        self.assertTrue(self._exists(success))

    def test_the_repeat_kinds_mode_still_ignores_other_kinds(self):
        """The first patch's own mode is unchanged by the widening: it never looks past its two kinds."""
        copy = self._repeat(self.original, self.later, "Bank refused")
        plan = run_cleanup(batches=[self.earlier, self.later])
        frappe.db.commit()
        self.assertEqual(plan.delete, {})
        self.assertTrue(self._exists(copy))
        self.assertTrue(frappe.db.exists(BATCH_DOCTYPE, self.later))
