# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the PO-deletion guard (D7).

WHAT THIS PROTECTS

Deleting a PO is irreversible, and `procurement_orders.on_trash` then actively destroys
linked records: the PO's `PO Adjustments` doc, the `Project Payments` its adjustment rows
point at, and its vendor-credit ledger entries. The OTHER side of a credit transfer is not
cleaned up, so deleting the RECEIVING PO leaves the paying PO holding an outgoing payment
and a Return term aimed at a document that no longer exists.

That happened, on production data:

    16-Jul 19:07  Rs.144.67 transferred  PO/011/00097/26-27 -> PO/055/00106/26-27
    17-Jul 12:26  the incoming payment PAY-00106-058 is deleted
    17-Jul 12:27  PO/055/00106/26-27 is deleted -- 39 seconds later

PO/011 sat payment-locked on an unbalanceable ledger until it was repaired by hand.

THE TWO PROPERTIES THAT MATTER, in the order they would hurt if they broke:

  1. THE GUARD MUST NOT READ THE PAYMENT ROW. Deleting the payment first is what cleared
     Frappe's Dynamic Link check -- the only thing that had ever stood in the way. A guard
     keyed on live payments would have been defeated by the exact sequence above.
     `test_credit_term_blocks_even_with_no_payment_row` is that property.

  2. A REFUSAL MUST CHANGE NOTHING. `delete_custom_po` deletes the PR's attachments BEFORE
     the PO, and swallows exceptions into a return dict -- so the request ends normally and
     Frappe COMMITS those deletions. A "failed" delete silently destroyed attachments. That
     was reproduced on live data before it was fixed.
     `test_refusal_does_not_touch_attachments` is that property.

AND ONE NON-PROPERTY, which is load-bearing precisely because it looks like an omission:
`test_bare_payments_do_not_block` pins that merely HAVING payments is NOT a blocker. Frappe
already blocks that on its own (`document_name` is a Dynamic Link). Adding it here was
measured against live data and would have blocked 4,959 of 6,879 POs (72%) and 25 of the 54
POs in a cancellable state -- silently changing what the Cancel button does. If someone
"tightens" the guard by adding it back, that test fails and says why.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every row here is one this suite created, tracked and
purged in `tearDown`. Fixtures are raw INSERTs, following
`api/outflow_import/test_settle_payment.py`: going through the document lifecycle would need
a PR, a vendor and a category tree to obtain columns the guard only ever reads back.
"""

import unittest

import frappe

from nirmaan_stack.api.delete_custom_po_and_pr import delete_custom_po
from nirmaan_stack.integrations.controllers.procurement_orders import _po_delete_blockers

PO_DOCTYPE = "Procurement Orders"
TERM_DOCTYPE = "PO Payment Terms"
ADJ_DOCTYPE = "PO Adjustments"
ADJ_ITEM_DOCTYPE = "PO Adjustment Items"
PAYMENT_DOCTYPE = "Project Payments"
ATTACHMENT_DOCTYPE = "Nirmaan Attachments"


class PODeletionGuardTests(unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.pos, self.adjustments, self.payments, self.attachments = [], [], [], []
        self.project = frappe.db.get_value("Projects", {}, "name")
        self.vendor = frappe.db.get_value("Vendors", {}, "name")

    def tearDown(self):
        for name in self.attachments:
            frappe.db.sql(f'DELETE FROM "tab{ATTACHMENT_DOCTYPE}" WHERE name=%s', (name,))
        for name in self.payments:
            frappe.db.sql(f'DELETE FROM "tab{PAYMENT_DOCTYPE}" WHERE name=%s', (name,))
        for name in self.adjustments:
            frappe.db.sql(f'DELETE FROM "tab{ADJ_ITEM_DOCTYPE}" WHERE parent=%s', (name,))
            frappe.db.sql(f'DELETE FROM "tab{ADJ_DOCTYPE}" WHERE name=%s', (name,))
        for name in self.pos:
            frappe.db.sql(f'DELETE FROM "tab{TERM_DOCTYPE}" WHERE parent=%s', (name,))
            frappe.db.sql(f'DELETE FROM "tab{PO_DOCTYPE}" WHERE name=%s', (name,))
        frappe.db.commit()
        super().tearDown()

    # ── fixtures ────────────────────────────────────────────────────────────────

    def _po(self, procurement_request=None):
        name = f"TEST-D7-PO-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{PO_DOCTYPE}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     project, vendor, procurement_request, amount_paid, total_amount, status)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                        %s, %s, %s, 0, 1000, 'PO Approved')""",
            (name, self.project, self.vendor, procurement_request),
        )
        self.pos.append(name)
        return name

    def _term(self, po, label, amount, term_status="Created"):
        name = frappe.generate_hash(length=10)
        frappe.db.sql(
            f"""INSERT INTO "tab{TERM_DOCTYPE}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     parent, parenttype, parentfield, label, amount, percentage, term_status)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 1,
                        %s, %s, 'payment_terms', %s, %s, 0, %s)""",
            (name, po, PO_DOCTYPE, label, amount, term_status),
        )
        return name

    def _adjustment_pointing_at(self, source_po, target_po, amount):
        """A source PO's adjustment ledger recording that credit went to `target_po`."""
        adj = f"TEST-D7-ADJ-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{ADJ_DOCTYPE}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     po_id, project, vendor, status, remaining_impact)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                        %s, %s, %s, 'Done', 0)""",
            (adj, source_po, self.project, self.vendor),
        )
        self.adjustments.append(adj)
        frappe.db.sql(
            f"""INSERT INTO "tab{ADJ_ITEM_DOCTYPE}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     parent, parenttype, parentfield, entry_type, amount, target_po)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 1,
                        %s, %s, 'adjustment_items', 'Against PO', %s, %s)""",
            (frappe.generate_hash(length=10), adj, ADJ_DOCTYPE, amount, target_po),
        )
        return adj

    def _payment(self, po, amount, status="Paid"):
        name = f"TEST-D7-PAY-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{PAYMENT_DOCTYPE}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     document_type, document_name, project, vendor, amount, status)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                        %s, %s, %s, %s, %s, %s)""",
            (name, PO_DOCTYPE, po, self.project, self.vendor, amount, status),
        )
        self.payments.append(name)
        return name

    def _attachment(self, pr_name):
        name = f"TEST-D7-ATT-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{ATTACHMENT_DOCTYPE}"
                    (name, creation, modified, modified_by, owner, docstatus, idx,
                     associated_doctype, associated_docname, project)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                        'Procurement Requests', %s, %s)""",
            (name, pr_name, self.project),
        )
        self.attachments.append(name)
        return name

    @staticmethod
    def _stub(name):
        """`_po_delete_blockers` reads only `.name`; loading a full doc proves nothing extra."""
        return frappe._dict(name=name)

    # ── the predicate ───────────────────────────────────────────────────────────

    def test_clean_po_is_deletable(self):
        po = self._po()
        self._term(po, "Advance Payment", 1000, "Created")
        self.assertEqual(_po_delete_blockers(self._stub(po)), [])

    def test_credit_term_blocks_even_with_no_payment_row(self):
        """PROPERTY 1 — the 39-second sequence. The incoming payment is gone; the term is not.

        This is the whole reason the guard does not key on `Project Payments`: deleting the
        payment first is precisely how PO/055/00106/26-27 slipped past Frappe's link check.
        """
        source = self._po()
        receiver = self._po()
        self._term(receiver, f"Credit PO {source}", 144.67, "Paid")
        # deliberately NO payment row on the receiver — it was deleted 39 seconds earlier

        blockers = _po_delete_blockers(self._stub(receiver))
        self.assertEqual(len(blockers), 1)
        self.assertIn("holds credit transferred in from another PO", blockers[0])
        self.assertIn(source, blockers[0])

    def test_being_an_adjustment_target_blocks(self):
        source = self._po()
        receiver = self._po()
        self._adjustment_pointing_at(source, receiver, 563.33)

        blockers = _po_delete_blockers(self._stub(receiver))
        self.assertEqual(len(blockers), 1)
        self.assertIn("adjustment ledger records", blockers[0])
        self.assertIn(source, blockers[0])

    def test_both_signals_are_reported_separately(self):
        """A real receiver trips both. Reporting one and stopping would hide half the cleanup."""
        source = self._po()
        receiver = self._po()
        self._term(receiver, f"Credit PO {source}", 563.33, "Paid")
        self._adjustment_pointing_at(source, receiver, 563.33)

        self.assertEqual(len(_po_delete_blockers(self._stub(receiver))), 2)

    def test_the_paying_po_is_not_blocked_by_its_own_return_term(self):
        """The SOURCE keeps an `RA PO <dest>` Return term. That is its own money leaving and
        must not block it — only `Credit PO …`, money arriving from elsewhere, does."""
        source = self._po()
        receiver = self._po()
        self._term(source, f"RA PO {receiver}", -144.67, "Return")
        self.assertEqual(_po_delete_blockers(self._stub(source)), [])

    def test_bare_payments_do_not_block(self):
        """NON-PROPERTY, ON PURPOSE — see the module docstring.

        Frappe's Dynamic Link check already blocks deleting a PO with a live payment. Adding
        it here was measured to block 72% of POs and 25 of 54 cancellable ones, silently
        changing the Cancel button. If this test fails, someone re-added that check.
        """
        po = self._po()
        self._payment(po, 5000, "Paid")
        self._payment(po, 2500, "Requested")
        self.assertEqual(_po_delete_blockers(self._stub(po)), [])

    # ── the guard, end to end ───────────────────────────────────────────────────

    def test_on_trash_blocks_and_the_po_survives(self):
        """The guard sits at the TOP of `on_trash`, so it fires before the destructive
        `cleanup_po_linked_docs` and before Frappe's own link check."""
        source = self._po()
        receiver = self._po()
        self._term(receiver, f"Credit PO {source}", 144.67, "Paid")
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError) as caught:
            frappe.delete_doc(PO_DOCTYPE, receiver)
        self.assertIn("money from other records points at it", str(caught.exception))

        frappe.db.rollback()
        self.assertTrue(frappe.db.exists(PO_DOCTYPE, receiver))
        self.assertEqual(frappe.db.count(TERM_DOCTYPE, {"parent": receiver}), 1)

    def test_refusal_does_not_touch_attachments(self):
        """PROPERTY 2 — a refusal must be a true no-op.

        `delete_custom_po` deletes the PR's attachments BEFORE the PO and swallows the
        exception into a return dict, so without the pre-check those deletions commit and the
        user loses attachments on a delete that "failed".
        """
        pr_name = f"TEST-D7-PR-{frappe.generate_hash(length=8)}"
        source = self._po()
        receiver = self._po(procurement_request=pr_name)
        self._term(receiver, f"Credit PO {source}", 144.67, "Paid")
        self._attachment(pr_name)
        frappe.db.commit()

        result = delete_custom_po(receiver)

        self.assertEqual(result.get("status"), 400)
        self.assertIn("cannot be deleted", result.get("error", ""))
        self.assertEqual(
            frappe.db.count(
                ATTACHMENT_DOCTYPE,
                {"associated_doctype": "Procurement Requests", "associated_docname": pr_name},
            ),
            1,
            "the refusal deleted the PR's attachments — the pre-check is not running first",
        )
        self.assertTrue(frappe.db.exists(PO_DOCTYPE, receiver))
