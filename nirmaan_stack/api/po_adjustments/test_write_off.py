# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the admin-only adjustment write-off (D5).

WHY THE ACTION EXISTS

Every other way to resolve an adjustment balance — Against-PO, Adhoc expense, Vendor Refund —
creates a `Project Payments` row. When the balance is a bookkeeping artefact rather than
money, all three are lies: they book a transfer, an expense or a refund that never happened.
So people went to Desk and hand-edited `remaining_impact` instead, which is how
PO/011/00097/26-27 ended up stuck at +144.00 while its own rows summed to −144.67, with an
audit row deleted and nothing to show who did it.

⚠️ `write_off_adjustment` COMMITS INTERNALLY. A caller's `frappe.db.rollback()` will not undo
it — that is not hypothetical, it happened while this endpoint was being exercised against a
live PO and had to be reversed by hand. Hence: fixtures only, and an explicit purge in
`tearDown`. Never point these tests at a real PO.

THE PROPERTIES, in the order they would hurt if they broke:

  1. NO PAYMENT IS EVER CREATED, and `amount_paid` is never touched. That IS the feature. If a
     write-off starts moving money it has become the thing it was built to avoid.
  2. THE SIGN IS DERIVED FROM THE BALANCE, never taken from the caller — a write-off can only
     move the ledger toward zero, so no input can push a balance further out.
  3. ADMIN ONLY, and a reason is mandatory. Writing off money without a name against it is the
     Desk edit again, wearing a button.
"""

import unittest

import frappe

from nirmaan_stack.api.po_adjustments.adjustment_logic import write_off_adjustment

PO_DOCTYPE = "Procurement Orders"
ADJ_DOCTYPE = "PO Adjustments"
ADJ_ITEM_DOCTYPE = "PO Adjustment Items"
PAYMENT_DOCTYPE = "Project Payments"


class WriteOffTests(unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.pos, self.adjustments = [], []
        self.project = frappe.db.get_value("Projects", {}, "name")
        self.vendor = frappe.db.get_value("Vendors", {}, "name")
        frappe.set_user("Administrator")

    def tearDown(self):
        frappe.set_user("Administrator")
        for name in self.adjustments:
            frappe.db.sql(f'DELETE FROM "tab{ADJ_ITEM_DOCTYPE}" WHERE parent=%s', (name,))
            frappe.db.sql(f'DELETE FROM "tab{ADJ_DOCTYPE}" WHERE name=%s', (name,))
        for name in self.pos:
            frappe.db.sql(
                f'DELETE FROM "tab{PAYMENT_DOCTYPE}" WHERE document_type=%s AND document_name=%s',
                (PO_DOCTYPE, name),
            )
            frappe.db.sql(f'DELETE FROM "tab{PO_DOCTYPE}" WHERE name=%s', (name,))
        frappe.db.commit()
        super().tearDown()

    # ── fixture ─────────────────────────────────────────────────────────────────

    def _po_with_balance(self, remaining, amount_paid=0, total_amount=10000):
        po = f"TEST-D5-PO-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{PO_DOCTYPE}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     project, vendor, amount_paid, total_amount, status)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                        %s, %s, %s, %s, 'PO Approved')""",
            (po, self.project, self.vendor, amount_paid, total_amount),
        )
        self.pos.append(po)

        adj = f"TEST-D5-ADJ-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{ADJ_DOCTYPE}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     po_id, project, vendor, status, remaining_impact)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                        %s, %s, %s, 'Pending', %s)""",
            (adj, po, self.project, self.vendor, remaining),
        )
        self.adjustments.append(adj)
        frappe.db.sql(
            f"""INSERT INTO "tab{ADJ_ITEM_DOCTYPE}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     parent, parenttype, parentfield, entry_type, amount)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 1,
                        %s, %s, 'adjustment_items', 'Revision Impact', %s)""",
            (frappe.generate_hash(length=10), adj, ADJ_DOCTYPE, remaining),
        )
        frappe.db.commit()
        return po, adj

    def _balance(self, adj):
        return frappe.db.get_value(ADJ_DOCTYPE, adj, ["status", "remaining_impact"], as_dict=True)

    def _payment_count(self, po):
        return frappe.db.count(
            PAYMENT_DOCTYPE, {"document_type": PO_DOCTYPE, "document_name": po}
        )

    @staticmethod
    def _a_non_admin():
        for user in frappe.get_all(
            "Nirmaan Users", filters={"role_profile": ["!=", "Nirmaan Admin Profile"]},
            pluck="name", limit=5,
        ):
            if user and user != "Administrator":
                return user
        return None

    # ── property 1: it must never move money ────────────────────────────────────

    def test_no_payment_is_created_and_amount_paid_is_untouched(self):
        """The entire reason this action exists. Against-PO / Adhoc / Refund all write a
        payment; a write-off must not, because nothing moved."""
        po, adj = self._po_with_balance(-708, amount_paid=885, total_amount=177)
        self.assertEqual(self._payment_count(po), 0)

        write_off_adjustment(po, 708, "no money moved — bookkeeping artefact")

        self.assertEqual(self._payment_count(po), 0)
        self.assertEqual(frappe.db.get_value(PO_DOCTYPE, po, "amount_paid"), 885)

    # ── property 2: the sign is derived, not supplied ───────────────────────────

    def test_a_negative_balance_is_cancelled_by_a_positive_entry(self):
        po, adj = self._po_with_balance(-4130)
        write_off_adjustment(po, 4130, "phantom credit, nothing was ever paid")

        self.assertEqual(self._balance(adj).remaining_impact, 0)
        self.assertEqual(
            frappe.db.get_value(
                ADJ_ITEM_DOCTYPE, {"parent": adj, "entry_type": "Write Off"}, "amount"
            ),
            4130,
        )

    def test_a_positive_balance_is_cancelled_by_a_negative_entry(self):
        """The mirror case, and the reason the caller does not get to choose the sign: a
        supplied sign could push a balance FURTHER from zero."""
        po, adj = self._po_with_balance(144)
        write_off_adjustment(po, 144, "orphaned obligation")

        self.assertEqual(self._balance(adj).remaining_impact, 0)
        self.assertEqual(
            frappe.db.get_value(
                ADJ_ITEM_DOCTYPE, {"parent": adj, "entry_type": "Write Off"}, "amount"
            ),
            -144,
        )

    def test_a_partial_write_off_leaves_the_remainder(self):
        po, adj = self._po_with_balance(-708)
        write_off_adjustment(po, 300, "partial")

        state = self._balance(adj)
        self.assertEqual(state.remaining_impact, -408)
        self.assertEqual(state.status, "Pending")

    def test_writing_off_the_full_balance_marks_it_done(self):
        po, adj = self._po_with_balance(-4130)
        write_off_adjustment(po, 4130, "all of it")
        self.assertEqual(self._balance(adj).status, "Done")

    # ── property 3: admin only, reason mandatory ────────────────────────────────

    def test_a_non_admin_is_rejected_and_nothing_is_written(self):
        non_admin = self._a_non_admin()
        if not non_admin:
            self.skipTest("no non-admin Nirmaan User on this site")
        po, adj = self._po_with_balance(-708)

        frappe.set_user(non_admin)
        with self.assertRaises(frappe.PermissionError):
            write_off_adjustment(po, 708, "should not work")
        frappe.set_user("Administrator")

        self.assertEqual(self._balance(adj).remaining_impact, -708)
        self.assertEqual(
            frappe.db.count(ADJ_ITEM_DOCTYPE, {"parent": adj, "entry_type": "Write Off"}), 0
        )

    def test_a_blank_reason_is_rejected(self):
        po, adj = self._po_with_balance(-708)
        for blank in ("", "   ", None):
            with self.subTest(reason=blank):
                with self.assertRaises(frappe.ValidationError):
                    write_off_adjustment(po, 708, blank)
        self.assertEqual(self._balance(adj).remaining_impact, -708)

    def test_the_reason_and_actor_are_recorded_on_the_entry(self):
        po, adj = self._po_with_balance(-708)
        write_off_adjustment(po, 708, "vendor confirmed nothing is owed")

        desc = frappe.db.get_value(
            ADJ_ITEM_DOCTYPE, {"parent": adj, "entry_type": "Write Off"}, "description"
        )
        self.assertIn("vendor confirmed nothing is owed", desc)
        self.assertIn("Administrator", desc)

    # ── bounds ──────────────────────────────────────────────────────────────────

    def test_over_drawing_is_rejected(self):
        po, adj = self._po_with_balance(-708)
        with self.assertRaises(frappe.ValidationError):
            write_off_adjustment(po, 5000, "too much")
        self.assertEqual(self._balance(adj).remaining_impact, -708)

    def test_a_zero_amount_is_rejected(self):
        po, adj = self._po_with_balance(-708)
        with self.assertRaises(frappe.ValidationError):
            write_off_adjustment(po, 0, "nothing")

    def test_a_settled_balance_has_nothing_to_write_off(self):
        po, adj = self._po_with_balance(-708)
        write_off_adjustment(po, 708, "done")
        with self.assertRaises(frappe.ValidationError):
            write_off_adjustment(po, 10, "again")

    def test_a_po_with_no_adjustment_is_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            write_off_adjustment("TEST-D5-NOPE-does-not-exist", 100, "reason")
