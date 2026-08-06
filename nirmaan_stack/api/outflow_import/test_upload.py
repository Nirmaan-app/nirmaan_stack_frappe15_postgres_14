# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the outflow statement staging path (Bulk Import Outflow, slice S3).

These exercise `_stage_batch` directly rather than the whitelisted endpoint. The endpoint's own
work above that call is authorization, a multipart read and two extension/size checks -- none of
which can be driven without a real HTTP request, and all of which would need `frappe.request` and
`save_file` faked to the point where the test asserts the fake. What IS worth pinning is everything
downstream: the staged shape, the duplicate guard, the skip semantics and the derived rollup.

⚠️ THIS SUITE RUNS AGAINST THE LIVE SITE DATABASE. Every document it creates is tracked and purged
in `tearDownClass`; the purge is scoped to rows this suite created and never touches anything else.
"""

import unittest
from dataclasses import replace
from datetime import date

import frappe

from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE, _stage_batch
from nirmaan_stack.api.outflow_import.permissions import (
    OUTFLOW_IMPORT_PROFILES,
    has_outflow_access,
)
from nirmaan_stack.services.outflow_import.parser import parse_statement

FIXTURE = (
    frappe.get_app_path("nirmaan_stack")
    + "/services/outflow_import/tests/fixtures/cashfree_sample.csv"
)


def _parsed_in_a_fresh_transfer_namespace():
    """Re-parse the fixture with every transfer id uniquely prefixed.

    STAGING IS DELIBERATELY NOT IDEMPOTENT -- re-staging the same statement is exactly the case the
    duplicate guard exists to catch, and it works against EVERY earlier batch in the database, not
    just this suite's. Without a per-call namespace the second test to run would be skipped as a
    duplicate of the first, and the suite would be asserting the guard by accident everywhere
    instead of once, on purpose, in TestDuplicateGuard.
    """
    with open(FIXTURE, "rb") as handle:
        parsed = parse_statement(handle.read(), source="Cashfree")
    prefix = frappe.generate_hash(length=10)
    rows = tuple(replace(r, transfer_id=f"{prefix}-{r.transfer_id}") for r in parsed.rows)
    return replace(parsed, rows=rows)


class TestStageBatch(unittest.TestCase):
    created_batches: list = []

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.parsed = _parsed_in_a_fresh_transfer_namespace()
        # Staged ONCE: every test in this class reads the same staged batch.
        cls.batch = _stage_batch(
            cls.parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        cls.created_batches.append(cls.batch.name)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for name in cls.created_batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _stage(self, parsed=None):
        return self.batch

    def _rows(self, batch):
        return frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch.name},
            fields=["name", "transfer_id", "row_status", "skip_reason", "amount",
                    "remarks", "normalized_account", "normalized_reference", "status_raw"],
            order_by="creation asc",
        )

    def test_every_parsed_row_is_staged(self):
        batch = self._stage()
        self.assertEqual(len(self._rows(batch)), len(self.parsed.rows))
        self.assertEqual(batch.total_rows, len(self.parsed.rows))

    def test_batch_carries_the_period_and_the_two_money_figures(self):
        batch = self._stage()
        self.assertEqual(batch.period_from, date(2026, 7, 28))
        self.assertEqual(batch.period_to, date(2026, 7, 28))
        self.assertGreater(batch.gross_amount, 0)
        self.assertGreater(batch.charges_amount, 0)

    def test_failed_transfer_is_staged_and_skipped_with_a_system_reason(self):
        # Staged, not dropped -- the skip has to be VISIBLE, and a manual skip is the only kind
        # that requires a typed reason.
        batch = self._stage()
        failed = [r for r in self._rows(batch) if r["status_raw"] == "FAILED"]
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["row_status"], "Skipped")
        self.assertIn("FAILED", failed[0]["skip_reason"])

    def test_successful_rows_are_pending_not_unmatched(self):
        # At upload nothing has been matched, so "Unmatched" would be a finding about work that has
        # not happened. That is the whole reason derive_staged_row_outcome exists.
        # The fixture's repeated transfer id is excluded: it is successful AND a duplicate, and the
        # duplicate wins (see test_in_file_duplicate_is_skipped_on_its_second_appearance).
        batch = self._stage()
        seen: set[str] = set()
        first_appearances = []
        for row in self._rows(batch):
            if row["transfer_id"] in seen:
                continue
            seen.add(row["transfer_id"])
            first_appearances.append(row)

        successes = [r for r in first_appearances if r["status_raw"] == "SUCCESS"]
        self.assertTrue(successes)
        self.assertEqual({r["row_status"] for r in successes}, {"Pending match run"})

    def test_in_file_duplicate_is_skipped_on_its_second_appearance(self):
        # The same transfer listed twice in ONE statement. The cross-batch lookup cannot see it --
        # it only queries EARLIER batches -- so it needs its own guard. Left uncaught, both copies
        # later match the same payment and the second Outflow Row Match insert violates the
        # (transfer_id, target) unique constraint, aborting the whole match pass.
        batch = self._stage()
        rows = self._rows(batch)
        counts: dict[str, list] = {}
        for row in rows:
            counts.setdefault(row["transfer_id"], []).append(row)
        repeated = [group for group in counts.values() if len(group) > 1]
        self.assertTrue(repeated, "fixture should contain a repeated transfer id")
        for group in repeated:
            self.assertEqual(group[0]["row_status"], "Pending match run")
            for later in group[1:]:
                self.assertEqual(later["row_status"], "Skipped")
                self.assertIn("earlier in the same statement", later["skip_reason"])

    def test_long_remark_survives_the_round_trip(self):
        # varchar(140) would have thrown CharacterLengthExceededError on insert.
        batch = self._stage()
        self.assertTrue(any(len(r["remarks"] or "") > 140 for r in self._rows(batch)))

    def test_derived_identity_forms_are_persisted_beside_the_raw_values(self):
        batch = self._stage()
        row = next(r for r in self._rows(batch) if r["transfer_id"].endswith("0006"))
        self.assertEqual(row["normalized_account"], "42345678904")

    def test_rollup_counters_and_status_are_derived(self):
        batch = self._stage()
        rows = self._rows(batch)
        self.assertEqual(batch.skipped_rows, sum(1 for r in rows if r["row_status"] == "Skipped"))
        self.assertEqual(batch.reviewed_rows, batch.skipped_rows)
        # Some rows terminal (skipped), some open (pending).
        self.assertEqual(batch.status, "Partially Settled")


class TestDuplicateGuard(unittest.TestCase):
    created_batches: list = []

    @classmethod
    def tearDownClass(cls):
        for name in cls.created_batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _stage(self, parsed):
        batch = _stage_batch(
            parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        type(self).created_batches.append(batch.name)
        frappe.db.commit()
        return batch

    def test_re_uploading_the_same_statement_skips_every_transfer(self):
        # The precise duplicate guard: transfer_id against EARLIER batches. This is what the
        # date-range overlap warning cannot do -- two exports can share a transfer without their
        # periods overlapping at all, and can share a period without sharing a transfer.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        first = self._stage(parsed)
        second = self._stage(parsed)

        first_rows = frappe.get_all(
            ROW_DOCTYPE, filters={"import_batch": first.name}, fields=["row_status"]
        )
        second_rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": second.name},
            fields=["row_status", "skip_reason"],
        )

        self.assertTrue(any(r["row_status"] == "Pending match run" for r in first_rows))
        self.assertEqual({r["row_status"] for r in second_rows}, {"Skipped"})
        self.assertTrue(all(first.name in (r["skip_reason"] or "") for r in second_rows))

    def test_a_fully_duplicate_batch_is_completed_immediately(self):
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)
        second = self._stage(parsed)
        # Every row terminal -> nothing left for anyone to do.
        self.assertEqual(second.status, "Completed")

    def test_a_fresh_namespace_is_not_treated_as_a_duplicate(self):
        # The guard must key on the TRANSFER, not on the period or the file. Two statements
        # covering the same dates with different transfers are both real work.
        first = self._stage(_parsed_in_a_fresh_transfer_namespace())
        second = self._stage(_parsed_in_a_fresh_transfer_namespace())
        for batch in (first, second):
            rows = frappe.get_all(
                ROW_DOCTYPE, filters={"import_batch": batch.name}, fields=["row_status"]
            )
            self.assertTrue(any(r["row_status"] == "Pending match run" for r in rows))

    def test_a_second_batch_over_the_same_period_records_an_overlap(self):
        # Equality with the first batch is deliberately NOT asserted: the overlap probe returns the
        # most recent EARLIER batch over that period, and other tests in this suite share it.
        self._stage(_parsed_in_a_fresh_transfer_namespace())
        second = self._stage(_parsed_in_a_fresh_transfer_namespace())
        self.assertIsNotNone(second.overlaps_batch)


class TestAccessGate(unittest.TestCase):
    def test_administrator_always_has_access(self):
        self.assertTrue(has_outflow_access("Administrator"))

    def test_guest_and_blank_never_do(self):
        self.assertFalse(has_outflow_access("Guest"))
        self.assertFalse(has_outflow_access(""))

    def test_the_profile_set_is_the_owner_ruling_accountant_lead_admin(self):
        self.assertEqual(
            OUTFLOW_IMPORT_PROFILES,
            {
                "Nirmaan Admin Profile",
                "Nirmaan Accountant Profile",
                "Nirmaan Accountant Lead Profile",
            },
        )

    def test_every_named_profile_exists_in_this_database(self):
        # A typo here locks out exactly the people the module is for, silently.
        for profile in OUTFLOW_IMPORT_PROFILES:
            self.assertTrue(
                frappe.db.exists("Role Profile", profile),
                f"Role Profile {profile!r} does not exist -- the access gate names a dead string.",
            )

    def test_a_non_accountant_profile_is_refused(self):
        user = frappe.db.get_value(
            "Nirmaan Users",
            {"role_profile": "Nirmaan Project Manager Profile"},
            "name",
        )
        if not user:
            self.skipTest("no project-manager user in this database")
        self.assertFalse(has_outflow_access(user))


if __name__ == "__main__":
    unittest.main()
