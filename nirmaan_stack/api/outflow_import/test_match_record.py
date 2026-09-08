# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The `Outflow Row Match` record's own rules (ADR-0020 D3/D4).

Runs against the LIVE localhost site, so every row this suite creates is torn down by name.
"""

import unittest

import frappe

MATCH_DOCTYPE = "Outflow Row Match"


class MatchRecordFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._created = []

    @classmethod
    def tearDownClass(cls):
        for name in cls._created:
            frappe.delete_doc(MATCH_DOCTYPE, name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def _match(self, **overrides):
        doc = frappe.new_doc(MATCH_DOCTYPE)
        doc.update(
            {
                "import_row": overrides.get("import_row", "OFR-TEST-000001"),
                "import_batch": overrides.get("import_batch", "OFI-TEST-00001"),
                "transfer_id": overrides.get("transfer_id", frappe.generate_hash(length=10)),
                "target_doctype": "Project Payments",
                "target_name": overrides.get("target_name", "PAY-TEST-001"),
                "target_amount": overrides.get("target_amount", 1000.0),
                "match_kind": overrides.get("match_kind", "Settled"),
                "match_basis": "Manual",
            }
        )
        # This suite tests the doctype's OWN rules (D3/D4) in isolation, not integration with real
        # linked records -- the identity/target fields are synthetic placeholders (OFR-TEST-...,
        # PAY-TEST-...) that never exist as real rows on this live site. Without this, insert()
        # throws LinkValidationError before validate() ever runs.
        doc.flags.ignore_links = True
        doc.insert(ignore_permissions=True)
        type(self)._created.append(doc.name)
        return doc


class TestTheNewFieldsExist(MatchRecordFixture):
    def test_the_six_new_fields_are_on_the_doctype(self):
        meta = frappe.get_meta(MATCH_DOCTYPE)
        for fieldname in (
            "reversed_at",
            "reversed_by",
            "reversal_reason",
            "target_project",
            "target_vendor",
        ):
            self.assertIsNotNone(
                meta.get_field(fieldname), f"{fieldname} is missing from {MATCH_DOCTYPE}"
            )

    def test_match_kind_offers_exactly_settled_and_reversed(self):
        options = frappe.get_meta(MATCH_DOCTYPE).get_field("match_kind").options
        self.assertEqual(options.split("\n"), ["Settled", "Reversed"])

    def test_the_runtime_table_really_has_the_columns(self):
        """⚠️ Root CLAUDE.md: passing tests do not prove the RUNTIME database has the column.
        Tests use a separate auto-migrated database; this asserts the live one."""
        for column in ("reversed_at", "reversed_by", "reversal_reason", "target_project", "target_vendor"):
            self.assertTrue(
                frappe.db.has_column(MATCH_DOCTYPE, column), f"{column} missing from the live table"
            )


class TestTheImmutabilityRuleIsNarrowedNotDropped(MatchRecordFixture):
    def test_a_match_is_created_as_settled(self):
        with self.assertRaises(frappe.ValidationError):
            self._match(match_kind="Reversed")

    def test_settled_may_become_reversed(self):
        doc = self._match()
        doc.match_kind = "Reversed"
        doc.reversed_by = "tester@example.com"
        doc.reversal_reason = "wrong PO"
        doc.save(ignore_permissions=True)
        self.assertEqual(
            frappe.db.get_value(MATCH_DOCTYPE, doc.name, "match_kind"), "Reversed"
        )

    def test_reversed_may_never_become_settled_again(self):
        """A correction SUPERSEDES; it never un-happens. Re-allocating that payment mints a NEW
        record, which the partial unique index now permits."""
        doc = self._match()
        doc.match_kind = "Reversed"
        doc.reversal_reason = "wrong PO"
        doc.save(ignore_permissions=True)
        doc.match_kind = "Settled"
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

    def test_the_identity_fields_stay_immutable(self):
        doc = self._match()
        doc.target_name = "PAY-TEST-999"
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)


class TestThePartialUniqueIndex(MatchRecordFixture):
    def test_two_settled_legs_of_one_transfer_are_allowed(self):
        """Fan-out. The key is on (transfer, TARGET), not on the transfer alone."""
        transfer = frappe.generate_hash(length=10)
        self._match(transfer_id=transfer, target_name="PAY-TEST-A")
        self._match(transfer_id=transfer, target_name="PAY-TEST-B")

    def test_the_same_target_twice_on_one_transfer_is_still_refused(self):
        transfer = frappe.generate_hash(length=10)
        self._match(transfer_id=transfer, target_name="PAY-TEST-C")
        savepoint = "test_match_record_dup_target"
        frappe.db.savepoint(savepoint)
        try:
            with self.assertRaises(Exception):
                self._match(transfer_id=transfer, target_name="PAY-TEST-C")
        finally:
            frappe.db.rollback(save_point=savepoint)

    def test_a_reversed_leg_releases_the_key(self):
        """⚠️ THE WHOLE POINT OF THE PARTIAL INDEX (ADR-0020 D4). Without `WHERE match_kind =
        'Settled'` a correctly-reversed payment could never be re-allocated to that transfer."""
        transfer = frappe.generate_hash(length=10)
        first = self._match(transfer_id=transfer, target_name="PAY-TEST-D")
        first.match_kind = "Reversed"
        first.reversal_reason = "wrong PO"
        first.save(ignore_permissions=True)
        frappe.db.commit()
        self._match(transfer_id=transfer, target_name="PAY-TEST-D")

    def test_the_old_non_partial_constraint_is_gone(self):
        """⚠️ If `on_doctype_update` still calls `add_unique`, a migrate re-adds the plain
        constraint beside the partial index and the test above starts failing months later."""
        rows = frappe.db.sql(
            """SELECT conname FROM pg_constraint
               WHERE conrelid = '"tabOutflow Row Match"'::regclass AND contype = 'u'"""
        )
        self.assertEqual(rows, [], f"a non-partial UNIQUE constraint survives: {rows}")
