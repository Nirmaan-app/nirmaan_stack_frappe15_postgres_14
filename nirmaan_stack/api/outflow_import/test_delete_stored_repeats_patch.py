# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The one-time cleanup of stored exact repeats (#1356, ADR-0031), against real rows.

The stored shape is built by hand, and has to be: the upload no longer saves an exact repeat, so
nothing can reproduce a pre-ADR-0031 import except writing one.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, so it calls `run_cleanup(batches=...)` with only the imports
it created -- never `execute()`, which would clean every real import on the site.
"""

import frappe

from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE
from nirmaan_stack.api.outflow_import.test_skip_row import SkipFixture
from nirmaan_stack.patches.v3_0.delete_stored_exact_repeats import run_cleanup
from nirmaan_stack.services.outflow_import.status import (
    ROW_MISMATCHED,
    ROW_SKIPPED,
    derive_batch_status,
)

ROW_DOCTYPE = "Outflow Import Row"
BATCH_DOCTYPE = "Outflow Import Batch"
_BATCH_FIELDS = [
    "total_rows", "reviewed_rows", "settled_rows", "skipped_rows", "error_rows", "status",
    "gross_amount", "charges_amount", "repeats_not_saved",
]


class RepeatFixture(SkipFixture):
    def _batch(self, source):
        doc = frappe.new_doc(BATCH_DOCTYPE)
        doc.update({"source": source, "status": "In Review", "gross_amount": 0, "charges_amount": 0})
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        self.batches.append(doc.name)
        return doc.name

    def _repeat(self, original, batch, kind, **fields):
        """A Skipped copy of `original` in `batch`, as the code before ADR-0031 stored one."""
        src = frappe.db.get_value(
            ROW_DOCTYPE, original,
            ["transfer_id", "amount", "status_raw", "source", "direction", "remarks"], as_dict=True,
        )
        return self._line(
            batch=batch, status=ROW_SKIPPED, skip_origin="System", skip_kind=kind,
            **{**src, "bank_reference_no": src.transfer_id, **fields},
        )

    def _cleanup(self, *batches):
        plan = run_cleanup(batches=list(batches))
        frappe.db.commit()
        return plan

    def _exists(self, row):
        return bool(frappe.db.exists(ROW_DOCTYPE, row))

    def _stored(self, batch):
        return frappe.db.get_value(BATCH_DOCTYPE, batch, _BATCH_FIELDS, as_dict=True)


class TestTheCleanupOfOneImport(RepeatFixture):
    """An earlier import holds the originals; a later one holds an original, exact repeats from both
    the earlier import and its own file, one status-changed repeat, and one bank refusal."""

    def setUp(self):
        super().setUp()
        money = {"service_charge": 8.0, "service_tax": 1.44, "direction": "Debit"}
        self.earlier = self._batch("Cashfree")
        x = self._line(batch=self.earlier, amount=1000.0, **money)
        y = self._line(batch=self.earlier, amount=2000.0, **money)
        w = self._line(batch=self.earlier, amount=4000.0, **money)

        self.later = self._batch("Cashfree")
        self.new_line = self._line(batch=self.later, amount=3000.0, **money)
        self.exact_x = self._repeat(x, self.later, "Already imported", **money)
        self.exact_w = self._repeat(w, self.later, "Already imported", **money)
        self.exact_in_file = self._repeat(self.new_line, self.later, "Repeated in same file", **money)
        self.status_changed = self._repeat(y, self.later, "Already imported", status_raw="REVERSED", **money)
        self.refused = self._line(
            batch=self.later, status=ROW_SKIPPED, skip_origin="System", skip_kind="Bank refused",
            status_raw="FAILED", amount=500.0, direction="Debit", service_charge=0, service_tax=0,
        )
        self.exact = [self.exact_x, self.exact_w, self.exact_in_file]

    def test_the_count_is_recorded_and_the_exact_repeats_are_gone(self):
        self._cleanup(self.later)
        self.assertEqual(self._stored(self.later).repeats_not_saved, 3)
        for row in self.exact:
            self.assertFalse(self._exists(row), row)

    def test_no_deleted_document_copy_is_made(self):
        self._cleanup(self.later)
        self.assertEqual(
            frappe.db.count(
                "Deleted Document", {"deleted_doctype": ROW_DOCTYPE, "deleted_name": ["in", self.exact]}
            ),
            0,
        )

    def test_the_status_changed_repeat_and_every_other_row_are_kept(self):
        plan = self._cleanup(self.later)
        self.assertIn(self.status_changed, plan.kept_status_changed)
        for row in (self.status_changed, self.new_line, self.refused):
            self.assertTrue(self._exists(row), row)

    def test_counters_status_and_money_describe_the_remaining_rows(self):
        self._cleanup(self.later)
        stored = self._stored(self.later)
        # Left: the new line (Mismatched, SUCCESS 3000), the REVERSED repeat and the bank refusal.
        self.assertEqual(stored.total_rows, 3)
        self.assertEqual(stored.skipped_rows, 2)
        self.assertEqual(stored.reviewed_rows, 3)
        self.assertEqual(
            stored.status, derive_batch_status([ROW_MISMATCHED, ROW_SKIPPED, ROW_SKIPPED])
        )
        # Gross: successful debits only -- the REVERSED and FAILED lines are out.
        self.assertEqual(float(stored.gross_amount), 3000.0)
        # Charges: every remaining line, whatever its outcome.
        self.assertAlmostEqual(float(stored.charges_amount), 2 * (8.0 + 1.44))

    def test_the_earlier_import_is_not_touched(self):
        before = self._stored(self.earlier)
        plan = self._cleanup(self.earlier, self.later)
        self.assertNotIn(self.earlier, plan.delete)
        self.assertEqual(self._stored(self.earlier), before)

    def test_a_second_run_changes_nothing(self):
        self._cleanup(self.later)
        after_first = self._stored(self.later)
        rows = frappe.get_all(ROW_DOCTYPE, filters={"import_batch": self.later}, pluck="name")

        plan = self._cleanup(self.later)

        self.assertEqual(plan.delete, {})
        self.assertEqual(self._stored(self.later), after_first)
        self.assertEqual(
            sorted(frappe.get_all(ROW_DOCTYPE, filters={"import_batch": self.later}, pluck="name")),
            sorted(rows),
        )


class TestAChainInsideOneFile(RepeatFixture):
    def test_the_first_run_already_lands_where_a_second_run_would(self):
        """Line 1 repeats an earlier import exactly and goes. Lines 2 and 3 are REVERSED and named line 1
        (SUCCESS) as their original, so each reads as a status change -- but once line 1 is gone, line 3's
        original is line 2, which is REVERSED too. One run must already account for that."""
        earlier = self._batch("Cashfree")
        original = self._line(batch=earlier)
        batch = self._batch("Cashfree")
        line1 = self._repeat(original, batch, "Already imported")
        line2 = self._repeat(line1, batch, "Repeated in same file", status_raw="REVERSED")
        line3 = self._repeat(line1, batch, "Repeated in same file", status_raw="REVERSED")

        self._cleanup(batch)
        after_first = self._stored(batch)

        self.assertFalse(self._exists(line1))
        self.assertTrue(self._exists(line2))
        self.assertFalse(self._exists(line3))
        self.assertEqual(after_first.repeats_not_saved, 2)
        self.assertEqual(self._cleanup(batch).delete, {})
        self.assertEqual(self._stored(batch), after_first)


class TestEverySource(RepeatFixture):
    def test_cashfree_icici_and_cashbook_repeats_are_all_cleared(self):
        for source in ("Cashfree", "ICICI Bank Statement", "Cashbook"):
            with self.subTest(source=source):
                fields = {"source": source, "direction": "Debit", "remarks": f"{source} narration"}
                earlier = self._batch(source)
                original = self._line(batch=earlier, **fields)
                later = self._batch(source)
                own = self._line(batch=later, **fields)
                imported = self._repeat(original, later, "Already imported")
                in_file = self._repeat(own, later, "Repeated in same file")

                plan = self._cleanup(later)

                self.assertEqual(plan.by_source[source], 2)
                self.assertFalse(self._exists(imported))
                self.assertFalse(self._exists(in_file))
                self.assertTrue(self._exists(own))
                self.assertEqual(self._stored(later).repeats_not_saved, 2)
                self.assertEqual(self._stored(later).total_rows, 1)

    def test_an_icici_tax_pair_is_not_one_line(self):
        """The two legs share id, amount and date and differ only in narration (the widened identity),
        so a leg skipped as repeated in the same file repeats ITS OWN earlier leg, not its partner.

        The partner carries a different bank status on purpose: judged against the partner, the copy
        would read as a status change and be kept."""
        fields = {"source": "ICICI Bank Statement", "direction": "Debit"}
        batch = self._batch("ICICI Bank Statement")
        sgst = self._line(batch=batch, remarks="SGST leg", status_raw="REVERSED", **fields)
        tid = frappe.db.get_value(ROW_DOCTYPE, sgst, "transfer_id")
        cgst = self._line(batch=batch, remarks="CGST leg", transfer_id=tid, **fields)
        cgst_again = self._repeat(cgst, batch, "Repeated in same file")

        self._cleanup(batch)

        self.assertFalse(self._exists(cgst_again))
        self.assertTrue(self._exists(sgst))
        self.assertTrue(self._exists(cgst))


class TestWhatIsNeverDeleted(RepeatFixture):
    def test_a_repeat_whose_only_original_is_in_a_later_import_is_kept(self):
        """Its real original is gone. Deleting it against a LATER copy could delete both copies."""
        source = "Cashfree"
        orphan_batch = self._batch(source)
        orphan = self._line(batch=orphan_batch, status=ROW_SKIPPED, skip_origin="System",
                            skip_kind="Already imported")
        later = self._batch(source)
        later_copy = self._repeat(orphan, later, "Already imported")

        plan = self._cleanup(orphan_batch, later)

        self.assertEqual(plan.kept_no_earlier_original, [orphan])
        self.assertTrue(self._exists(orphan))
        self.assertFalse(self._exists(later_copy))

    def test_a_repeat_a_match_points_at_is_kept(self):
        earlier = self._batch("Cashfree")
        original = self._line(batch=earlier)
        later = self._batch("Cashfree")
        repeat = self._repeat(original, later, "Already imported")
        frappe.db.sql(
            f"""INSERT INTO "tab{MATCH_DOCTYPE}"
                    (name, creation, modified, owner, modified_by, docstatus, idx,
                     import_row, import_batch, transfer_id, target_doctype, target_name)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s, 'x',
                        'Project Payments', 'nothing')""",
            (f"test-1356-{frappe.generate_hash(length=8)}", repeat, later),
        )
        frappe.db.commit()

        plan = self._cleanup(later)

        self.assertEqual(plan.kept_linked, [repeat])
        self.assertTrue(self._exists(repeat))
        self.assertEqual(self._stored(later).repeats_not_saved or 0, 0)


class TestAnImportLeftEmpty(RepeatFixture):
    def test_it_is_kept_completed_with_its_count(self):
        """#1358: `derive_batch_status([])` is Draft, and a Draft import reads as open work. An import
        the patch empties still records that the file was uploaded, so it is kept -- and Completed."""
        earlier = self._batch("Cashfree")
        original = self._line(batch=earlier)
        later = self._batch("Cashfree")
        repeat = self._repeat(original, later, "Already imported")

        self._cleanup(later)

        self.assertFalse(self._exists(repeat))
        self.assertTrue(frappe.db.exists(BATCH_DOCTYPE, later))
        stored = self._stored(later)
        self.assertEqual((stored.status, stored.total_rows, stored.repeats_not_saved), ("Completed", 0, 1))
        self.assertEqual(float(stored.gross_amount), 0.0)


class TestThePatchAgreesWithTheUpload(RepeatFixture):
    """#1358: the patch decides exactness through the upload's own walk (`repeats.split_repeats`,
    `duplicates.match_repeat`), so what it deletes is what an upload today would have left out."""

    def test_an_exact_repeat_of_any_earlier_sighting_goes_not_only_of_the_earliest(self):
        """SUCCESS in A, then REVERSED in B, C and D. The upload keeps only B's line: C and D repeat
        B exactly. Judged against A alone, all three would read as status changes and be kept."""
        a = self._batch("Cashfree")
        original = self._line(batch=a)
        copies = []
        for _ in range(3):
            batch = self._batch("Cashfree")
            copies.append(self._repeat(original, batch, "Already imported", status_raw="REVERSED"))

        plan = self._cleanup(*self.batches)

        self.assertTrue(self._exists(copies[0]))
        self.assertFalse(self._exists(copies[1]))
        self.assertFalse(self._exists(copies[2]))
        self.assertEqual(plan.kept_status_changed, [copies[0]])

    def test_an_in_flight_first_line_is_not_the_original(self):
        """QUEUED, then SUCCESS, then a SUCCESS copy stored as repeated in the same file. Only a
        terminal line is an in-file sighting, so the copy repeats line 2 exactly and goes."""
        batch = self._batch("Cashfree")
        queued = self._line(batch=batch, status_raw="QUEUED")
        tid = frappe.db.get_value(ROW_DOCTYPE, queued, "transfer_id")
        success = self._line(batch=batch, transfer_id=tid)
        copy = self._repeat(success, batch, "Repeated in same file")

        self._cleanup(batch)

        self.assertFalse(self._exists(copy))
        self.assertTrue(self._exists(queued))
        self.assertTrue(self._exists(success))

    def test_on_cashbook_the_original_is_the_line_that_was_created(self):
        """FAILED (skipped), then SUCCESS (created), then a SUCCESS copy stored as repeated in the
        same file. On Cashbook an in-file sighting is a created line, so the FAILED line is not the
        original -- the copy repeats the SUCCESS line exactly and goes."""
        source = "Cashbook"
        batch = self._batch(source)
        failed = self._line(batch=batch, source=source, status_raw="FAILED", status=ROW_SKIPPED,
                            skip_origin="System", skip_kind="Bank refused")
        tid = frappe.db.get_value(ROW_DOCTYPE, failed, "transfer_id")
        created = self._line(batch=batch, source=source, transfer_id=tid)
        copy = self._repeat(created, batch, "Repeated in same file")

        self._cleanup(batch)

        self.assertFalse(self._exists(copy))
        self.assertTrue(self._exists(failed))
        self.assertTrue(self._exists(created))

    def test_on_cashbook_an_identical_copy_of_a_skipped_line_goes(self):
        """INVERTED by #1359 (it was "a line the plan skipped is no original", #1358). A SUCCESS line
        the plan skipped (already booked) was never created, so it is not FINAL -- but an identical
        copy of it is still an exact repeat of a line the system holds, and goes."""
        source = "Cashbook"
        batch = self._batch(source)
        booked = self._line(batch=batch, source=source, status=ROW_SKIPPED, skip_origin="System",
                            skip_kind="Outflow Already Recorded")
        copy = self._repeat(booked, batch, "Repeated in same file")

        plan = self._cleanup(batch)

        self.assertFalse(self._exists(copy))
        self.assertTrue(self._exists(booked))
        self.assertEqual(plan.delete, {batch: [copy]})

    def test_an_icici_line_whose_only_earlier_sighting_is_the_other_leg_is_kept(self):
        """The earlier import holds the SGST leg. The later import holds a CGST leg the old lookup
        skipped as already imported (same id, amount and date) -- it is a different line and stays.
        The later import's true copy of the SGST leg still goes."""
        fields = {"source": "ICICI Bank Statement", "direction": "Debit"}
        earlier = self._batch("ICICI Bank Statement")
        sgst = self._line(batch=earlier, remarks="SGST leg", **fields)
        tid = frappe.db.get_value(ROW_DOCTYPE, sgst, "transfer_id")
        later = self._batch("ICICI Bank Statement")
        cgst = self._line(batch=later, remarks="CGST leg", transfer_id=tid, status=ROW_SKIPPED,
                          skip_origin="System", skip_kind="Already imported", **fields)
        sgst_again = self._repeat(sgst, later, "Already imported")

        plan = self._cleanup(later)

        self.assertTrue(self._exists(cgst))
        self.assertIn(cgst, plan.kept_no_earlier_original)
        self.assertFalse(self._exists(sgst_again))


class TestCashbookMoneyWithNoStoredDirection(RepeatFixture):
    def test_a_cashbook_import_keeps_its_gross_when_its_rows_carry_no_direction(self):
        """Cashbook staging does not write `direction`, and the one-off direction backfill is not
        wired in `patches.txt`, so production Cashbook rows can be blank. Cashbook cannot state money
        in, so a blank there is money out -- the re-sum must not zero the import's gross."""
        source = "Cashbook"
        earlier = self._batch(source)
        original = self._line(batch=earlier, source=source, direction="", amount=700.0)
        later = self._batch(source)
        self._line(batch=later, source=source, direction="", amount=300.0)
        self._repeat(original, later, "Already imported", direction="")

        self._cleanup(later)

        self.assertEqual(float(self._stored(later).gross_amount), 300.0)
