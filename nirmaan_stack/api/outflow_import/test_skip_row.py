# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Skip by hand, and who may undo work (#1273, parent #1270, ADR-0022).

What is pinned, all through the whitelisted endpoints:

  * a plain Accountant is refused by `skip_row` and `reverse_allocation`; Admin, Accountant Lead and
    the Administrator user are allowed;
  * `skip_row` refuses Settled, Partially Allocated, already Skipped and Cashbook lines, and writes
    nothing when it does;
  * a successful skip writes skip origin Manual, the reason, who and when, a Version row and a
    comment, refreshes the rollup, and the Skipped scope shows the TYPED reason;
  * the Skipped scope's "Skipped by hand" filter returns only hand skips, server-side.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every batch, row, user, Version and Comment this suite makes
is tracked and purged; nothing else is touched.
"""

import unittest

import frappe

from nirmaan_stack.api.outflow_import.expenses import allocate_row, reverse_allocation
from nirmaan_stack.api.outflow_import.permissions import (
    OUTFLOW_IMPORT_PROFILES,
    OUTFLOW_UNDO_PROFILES,
    has_outflow_undo_access,
)
from nirmaan_stack.api.outflow_import.review import (
    MATCH_DOCTYPE,
    SKIP_REASON_REQUIRED,
    get_outflow_rows,
    get_outflow_summary,
    skip_row,
)
from nirmaan_stack.api.outflow_import.test_allocate_row import AllocationFixture
from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.services.outflow_import.skip_origin import (
    SKIP_REFUSED_ALREADY_SKIPPED,
    SKIP_REFUSED_CASHBOOK,
    SKIP_REFUSED_PARTIALLY_ALLOCATED,
    SKIP_REFUSED_SETTLED,
)
from nirmaan_stack.services.outflow_import.status import (
    BATCH_COMPLETED,
    ROW_MISMATCHED,
    ROW_SKIPPED,
    SKIP_ORIGIN_MANUAL,
    SKIP_ORIGIN_SYSTEM,
)

ACCOUNTANT = "Nirmaan Accountant Profile"
ACCOUNTANT_LEAD = "Nirmaan Accountant Lead Profile"
ADMIN = "Nirmaan Admin Profile"


class _Users:
    """Throwaway users with a given role profile, the `test_template_admin` pattern."""

    def __init__(self):
        self.created = []

    def make(self, role_profile: str) -> str:
        email = f"ofi_skip_{frappe.generate_hash(length=8)}@example.com"
        user = frappe.new_doc("User")
        user.email = email
        user.first_name = "OFI Skip"
        user.send_welcome_email = 0
        user.enabled = 1
        user.insert(ignore_permissions=True)
        # `User.after_insert` may already have minted the Nirmaan Users row, with no profile.
        if frappe.db.exists("Nirmaan Users", email):
            frappe.db.set_value("Nirmaan Users", email, "role_profile", role_profile)
        else:
            nu = frappe.new_doc("Nirmaan Users")
            nu.email = email
            nu.first_name = "OFI Skip"
            nu.role_profile = role_profile
            nu.insert(ignore_permissions=True)
        frappe.db.commit()
        self.created.append(email)
        return email

    def purge(self):
        frappe.set_user("Administrator")
        for email in self.created:
            if frappe.db.exists("Nirmaan Users", email):
                frappe.delete_doc("Nirmaan Users", email, force=True, ignore_permissions=True)
            if frappe.db.exists("User", email):
                frappe.delete_doc("User", email, force=True, ignore_permissions=True)
        frappe.db.commit()


class SkipFixture(unittest.TestCase):
    """Lines staged directly -- `skip_row` reads only the status, the batch and its source."""

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.batches, self.rows = [], []
        self.users = _Users()

    def tearDown(self):
        self.users.purge()
        if self.rows:
            frappe.db.delete("Version", {"ref_doctype": ROW_DOCTYPE, "docname": ["in", self.rows]})
            frappe.db.delete(
                "Comment", {"reference_doctype": ROW_DOCTYPE, "reference_name": ["in", self.rows]}
            )
        for batch in self.batches:
            frappe.db.delete(MATCH_DOCTYPE, {"import_batch": batch})
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": batch})
            frappe.db.delete(BATCH_DOCTYPE, {"name": batch})
        frappe.db.commit()
        super().tearDown()

    def _line(self, *, status=ROW_MISMATCHED, source="Cashfree", batch=None, **fields):
        if batch is None:
            doc = frappe.new_doc(BATCH_DOCTYPE)
            doc.update({"source": source, "status": "In Review"})
            doc.insert(ignore_permissions=True)
            batch = doc.name
            self.batches.append(batch)
        transfer_id = f"skip-{frappe.generate_hash(length=10)}"
        row = frappe.new_doc(ROW_DOCTYPE)
        row.update(
            {
                "import_batch": batch,
                "source": source,
                "transfer_id": transfer_id,
                "bank_reference_no": transfer_id,
                "amount": 8200.0,
                "status_raw": "SUCCESS",
                "row_status": status,
                "outcome_note": "No approved payment or expense matches this transfer.",
                **fields,
            }
        )
        row.insert(ignore_permissions=True)
        frappe.db.commit()
        self.rows.append(row.name)
        return row.name

    def _stored(self, row):
        return frappe.db.get_value(
            ROW_DOCTYPE,
            row,
            ["row_status", "skip_origin", "skip_reason", "outcome_note", "decided_by", "decided_at"],
            as_dict=True,
        )


class TestTheUndoAccessCheck(SkipFixture):
    def test_the_undo_set_is_admin_and_accountant_lead_inside_the_module_set(self):
        self.assertEqual(OUTFLOW_UNDO_PROFILES, {ADMIN, ACCOUNTANT_LEAD})
        self.assertTrue(OUTFLOW_UNDO_PROFILES <= OUTFLOW_IMPORT_PROFILES)

    def test_who_has_it(self):
        self.assertTrue(has_outflow_undo_access("Administrator"))
        self.assertTrue(has_outflow_undo_access(self.users.make(ADMIN)))
        self.assertTrue(has_outflow_undo_access(self.users.make(ACCOUNTANT_LEAD)))
        self.assertFalse(has_outflow_undo_access(self.users.make(ACCOUNTANT)))
        self.assertFalse(has_outflow_undo_access(self.users.make("Nirmaan Project Manager Profile")))
        self.assertFalse(has_outflow_undo_access("Guest"))
        self.assertFalse(has_outflow_undo_access(""))

    def test_a_plain_accountant_is_refused_skip_and_nothing_is_written(self):
        row = self._line()
        frappe.set_user(self.users.make(ACCOUNTANT))
        with self.assertRaises(frappe.PermissionError):
            skip_row(row, "not ours")
        frappe.set_user("Administrator")
        self.assertEqual(self._stored(row).row_status, ROW_MISMATCHED)

    def test_admin_accountant_lead_and_administrator_may_skip(self):
        for who in (self.users.make(ADMIN), self.users.make(ACCOUNTANT_LEAD), "Administrator"):
            with self.subTest(who=who):
                row = self._line()
                frappe.set_user(who)
                skip_row(row, "not ours")
                frappe.set_user("Administrator")
                stored = self._stored(row)
                self.assertEqual(stored.row_status, ROW_SKIPPED)
                self.assertEqual(stored.decided_by, who)


class TestReverseAllocationAccess(AllocationFixture):
    """The single-leg Reverse moved behind the same narrower check (#1273)."""

    def setUp(self):
        super().setUp()
        self.users = _Users()

    def tearDown(self):
        self.users.purge()
        super().tearDown()

    def _leg(self):
        row = self._staged_row(amount="100")
        a, _, _ = self._three_payments()
        allocate_row(row=row, targets=self._targets([a]))
        return frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "match_kind": "Settled"}, "name")

    def test_a_plain_accountant_is_refused(self):
        leg = self._leg()
        frappe.set_user(self.users.make(ACCOUNTANT))
        with self.assertRaises(frappe.PermissionError):
            reverse_allocation(match=leg, reason="wrong payment")
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.get_value(MATCH_DOCTYPE, leg, "match_kind"), "Settled")

    def test_an_accountant_lead_is_allowed(self):
        leg = self._leg()
        frappe.set_user(self.users.make(ACCOUNTANT_LEAD))
        try:
            reverse_allocation(match=leg, reason="wrong payment")
        finally:
            frappe.set_user("Administrator")
        self.assertEqual(frappe.db.get_value(MATCH_DOCTYPE, leg, "match_kind"), "Reversed")


class TestSkipRefusals(SkipFixture):
    def _assert_refused(self, row, sentence):
        before = self._stored(row)
        with self.assertRaises(frappe.ValidationError) as caught:
            skip_row(row, "not ours")
        self.assertIn(sentence, str(caught.exception))
        self.assertEqual(self._stored(row), before)

    def test_a_reason_is_required(self):
        row = self._line()
        with self.assertRaises(frappe.ValidationError) as caught:
            skip_row(row, "   ")
        self.assertIn(SKIP_REASON_REQUIRED, str(caught.exception))

    def test_a_settled_line_is_refused(self):
        self._assert_refused(self._line(status="Settled"), SKIP_REFUSED_SETTLED)

    def test_a_partially_allocated_line_is_refused(self):
        self._assert_refused(
            self._line(status="Partially Allocated"), SKIP_REFUSED_PARTIALLY_ALLOCATED
        )

    def test_an_already_skipped_line_is_refused_so_a_system_skip_is_never_relabelled(self):
        row = self._line(
            status=ROW_SKIPPED,
            skip_origin=SKIP_ORIGIN_SYSTEM,
            outcome_note="Already recorded as Paid on Project Payment PAY-1.",
        )
        self._assert_refused(row, SKIP_REFUSED_ALREADY_SKIPPED)
        self.assertEqual(self._stored(row).skip_origin, SKIP_ORIGIN_SYSTEM)

    def test_a_cashbook_line_is_refused_even_while_open(self):
        self._assert_refused(
            self._line(status="Pending match run", source="Cashbook"), SKIP_REFUSED_CASHBOOK
        )


class TestASuccessfulSkip(SkipFixture):
    REASON = "Staff's personal UPI transfer, not company money"

    def test_it_records_manual_the_reason_who_and_when(self):
        row = self._line()
        skip_row(row, f"  {self.REASON}  ")
        stored = self._stored(row)
        self.assertEqual(stored.row_status, ROW_SKIPPED)
        self.assertEqual(stored.skip_origin, SKIP_ORIGIN_MANUAL)
        self.assertEqual(stored.skip_reason, self.REASON)
        self.assertEqual(stored.decided_by, "Administrator")
        self.assertIsNotNone(stored.decided_at)
        # The displayed note BECOMES the reason, replacing the matcher's old sentence.
        self.assertEqual(stored.outcome_note, self.REASON)
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "skip_kind"), "Skipped by hand")

    def test_it_writes_a_version_row_and_a_comment(self):
        row = self._line()
        skip_row(row, self.REASON)
        versions = frappe.get_all(
            "Version", filters={"ref_doctype": ROW_DOCTYPE, "docname": row}, fields=["data"]
        )
        self.assertEqual(len(versions), 1)
        self.assertIn("skip_origin", versions[0]["data"])
        comments = frappe.get_all(
            "Comment",
            filters={"reference_doctype": ROW_DOCTYPE, "reference_name": row, "comment_type": "Comment"},
            fields=["content"],
        )
        self.assertEqual(len(comments), 1)
        self.assertIn(self.REASON, comments[0]["content"])
        self.assertIn("Administrator", comments[0]["content"])

    def test_it_refreshes_the_import_rollup(self):
        row = self._line()
        batch = frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")
        result = skip_row(row, self.REASON)
        self.assertEqual(result["batch_status"], BATCH_COMPLETED)
        self.assertEqual(frappe.db.get_value(BATCH_DOCTYPE, batch, "status"), BATCH_COMPLETED)
        self.assertEqual(frappe.db.get_value(BATCH_DOCTYPE, batch, "skipped_rows"), 1)

    def test_the_skipped_scope_shows_the_typed_reason_and_who_and_when(self):
        row = self._line()
        batch = frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")
        skip_row(row, self.REASON)
        page = get_outflow_rows(scope="skipped", batch=batch)
        mine = next(r for r in page["rows"] if r["name"] == row)
        self.assertEqual(mine["outcome_note"] or mine["skip_reason"], self.REASON)
        self.assertEqual(mine["skip_origin"], SKIP_ORIGIN_MANUAL)
        self.assertEqual(mine["decided_by"], "Administrator")
        self.assertTrue(mine["decided_at"])


class TestSkippedByHandFilter(SkipFixture):
    def test_the_filter_returns_only_hand_skips_and_is_applied_by_the_server(self):
        hand = self._line()
        batch = frappe.db.get_value(ROW_DOCTYPE, hand, "import_batch")
        system = self._line(
            batch=batch,
            status=ROW_SKIPPED,
            skip_origin=SKIP_ORIGIN_SYSTEM,
            outcome_note="Already recorded as Paid on Project Payment PAY-1.",
        )
        skip_row(hand, "not ours")

        everything = {r["name"] for r in get_outflow_rows(scope="skipped", batch=batch)["rows"]}
        self.assertEqual(everything, {hand, system})

        page = get_outflow_rows(scope="skipped", batch=batch, skip_origin=SKIP_ORIGIN_MANUAL)
        self.assertEqual({r["name"] for r in page["rows"]}, {hand})
        self.assertEqual(page["total"], 1)

    def test_the_summary_counts_the_same_hand_skips_the_filter_returns(self):
        hand = self._line()
        batch = frappe.db.get_value(ROW_DOCTYPE, hand, "import_batch")
        self._line(batch=batch, status=ROW_SKIPPED, skip_origin=SKIP_ORIGIN_SYSTEM)
        self.assertEqual(get_outflow_summary(batch=batch)["skipped_by_hand_rows"], 0)
        skip_row(hand, "not ours")
        summary = get_outflow_summary(batch=batch)
        self.assertEqual(summary["skipped_by_hand_rows"], 1)
        self.assertEqual(
            summary["skipped_by_hand_rows"],
            get_outflow_rows(scope="skipped", batch=batch, skip_origin=SKIP_ORIGIN_MANUAL)["total"],
        )

    def test_an_unknown_origin_filters_nothing_out(self):
        row = self._line(status=ROW_SKIPPED, skip_origin=SKIP_ORIGIN_SYSTEM)
        batch = frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")
        page = get_outflow_rows(scope="skipped", batch=batch, skip_origin="Robot")
        self.assertEqual({r["name"] for r in page["rows"]}, {row})
