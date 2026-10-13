# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The migration of old "Adjust Payments" refunds into Vendor Refunds (#1404, ADR-0032).

An old refund is three records: a negative Paid Project Payment, its "RA Vendor" Return term on the
PO, and a `Vendor Refund` entry on the PO Adjustment pointing at the payment. The patch turns it into
one Vendor Refund (Received, no bank line, "migrated from Adjust Payments"), points the entry at it,
and removes the payment and the term -- with the PO's paid amount, amount due and adjustment balance
exactly as before.

Fixtures are raw-SQL rows on a real vendor and project (`WaitingRefundFixture`), purged by name.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.po_adjustments._payment_utils import _recalculate_amount_paid
from nirmaan_stack.api.vendor_refunds.test_waiting_refunds import (
    ADJ,
    ADJ_ITEM,
    PAYMENT,
    PO,
    VENDOR_REFUNDS,
    WaitingRefundFixture,
)
from nirmaan_stack.patches.v3_0.convert_adjustment_vendor_refunds import (
    MIGRATION_REASON,
    convert_adjustment_refunds,
)
from nirmaan_stack.services.vendor_refunds import RECEIVED

TERMS = "PO Payment Terms"
#: The ledger says 1,180 overpaid; the vendor sent 500 of it back through old Adjust Payments.
REFUNDED = 500.0
PROOF = "/private/files/TEST-1404-refund-proof.png"


class TestConvertAnAdjustmentRefund(WaitingRefundFixture):
    def setUp(self):
        super().setUp()
        self.files = []

    def tearDown(self):
        frappe.db.rollback()
        for label, purge in (
            (TERMS, lambda: self.pos and frappe.db.delete(TERMS, {"parent": ["in", self.pos]})),
            ("File", lambda: self.files and frappe.db.delete("File", {"name": ["in", self.files]})),
            ("Deleted Document", lambda: self.pos and frappe.db.sql(
                """DELETE FROM "tabDeleted Document" WHERE deleted_doctype = %s AND data LIKE %s""",
                (PAYMENT, "%TEST-1404-%"))),
        ):
            try:
                purge()
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()
        super().tearDown()

    # ── fixture: the old shape, as `execute_adjustment` "Vendor-has-refund" wrote it ──

    def _old_style_refund(self, utr="TEST-1404-UTR", refund_attachment=PROOF, payment_attachment=None):
        po, adj = self._overpaid_po()
        payment = f"TEST-1404-PAY-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{PAYMENT}"
                    (name, creation, modified, modified_by, owner, docstatus, idx, document_type,
                     document_name, project, vendor, amount, status, utr, payment_attachment, payment_date)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s, %s, %s,
                        %s, 'Paid', %s, %s, '2026-03-24')""",
            (payment, PO, po, self.project, self.vendor, -REFUNDED, utr, payment_attachment),
        )
        frappe.db.sql(
            f"""INSERT INTO "tab{TERMS}"
                    (name, creation, modified, modified_by, owner, docstatus, idx, parent, parenttype,
                     parentfield, label, amount, percentage, term_status, payment_type, project_payment)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 1, %s, %s,
                        'payment_terms', 'RA Vendor', %s, 0, 'Return', 'Cash', %s)""",
            (frappe.generate_hash(length=10), po, PO, -REFUNDED, payment),
        )
        frappe.db.sql(
            f"""INSERT INTO "tab{ADJ_ITEM}"
                    (name, creation, modified, modified_by, owner, docstatus, idx, parent, parenttype,
                     parentfield, entry_type, amount, project_payment, refund_date, refund_attachment,
                     description)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 2, %s, %s,
                        'adjustment_items', 'Vendor Refund', %s, %s, '2026-03-15', %s,
                        'Vendor refund received')""",
            (frappe.generate_hash(length=10), adj, ADJ, REFUNDED, payment, refund_attachment),
        )
        frappe.get_doc(ADJ, adj).recalculate_remaining_impact()
        _recalculate_amount_paid(po)
        frappe.db.commit()
        return po, adj, payment

    def _money_figures(self, po, adj):
        paid, due = frappe.db.get_value(PO, po, ["amount_paid", "amount_due"])
        return flt(paid, 2), flt(due, 2), flt(frappe.db.get_value(ADJ, adj, "remaining_impact"), 2)

    # ── the conversion ──────────────────────────────────────────────────────────

    def test_an_old_refund_becomes_one_received_vendor_refund_and_running_again_changes_nothing(self):
        po, adj, payment = self._old_style_refund()
        before = self._money_figures(po, adj)
        # The old shape really is overpaid by 1,180 less the 500 refunded, paid 11,180 - 500.
        self.assertEqual(before, (10680.0, -10680.0, -680.0))

        convert_adjustment_refunds(pos=[po])
        convert_adjustment_refunds(pos=[po])

        refunds = frappe.get_all(VENDOR_REFUNDS, filters={"document_name": po}, pluck="name")
        self.assertEqual(len(refunds), 1)
        refund = frappe.get_doc(VENDOR_REFUNDS, refunds[0])
        self.assertEqual(refund.status, RECEIVED)
        self.assertEqual(refund.no_bank_line, 1)
        self.assertEqual(refund.no_bank_line_reason, MIGRATION_REASON)
        self.assertEqual(MIGRATION_REASON, "migrated from Adjust Payments")
        self.assertEqual((refund.vendor, refund.project, refund.document_type), (self.vendor, self.project, PO))
        self.assertEqual(flt(refund.amount, 2), REFUNDED)
        self.assertEqual(str(refund.payment_date), "2026-03-15")
        self.assertEqual(refund.utr, "TEST-1404-UTR")
        self.assertEqual(refund.refund_attachment, PROOF)

        # The negative payment and its RA Vendor term are gone; the entry points at the refund.
        self.assertFalse(frappe.db.exists(PAYMENT, payment))
        self.assertEqual(frappe.db.count(PAYMENT, {"document_name": po, "amount": ["<", 0]}), 0)
        self.assertEqual(frappe.db.count(TERMS, {"parent": po, "label": "RA Vendor"}), 0)
        self.assertEqual(frappe.db.count(TERMS, {"parent": po, "term_status": "Created"}), 0)
        entries = frappe.get_all(
            ADJ_ITEM, filters={"parent": adj, "entry_type": "Vendor Refund"},
            fields=["vendor_refund", "project_payment", "amount"],
        )
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].vendor_refund, refund.name)
        self.assertFalse(entries[0].project_payment)
        self.assertEqual(flt(entries[0].amount, 2), REFUNDED)

        # Paid amount, amount due and adjustment balance: unchanged to the paisa.
        self.assertEqual(self._money_figures(po, adj), before)

    def test_proof_on_the_payment_is_carried_and_its_file_kept_and_a_made_up_utr_is_dropped(self):
        po, adj, payment = self._old_style_refund(
            utr=f"VR-{frappe.generate_hash(length=4)}", refund_attachment=None, payment_attachment=PROOF
        )
        # The VR-<po> placeholder the old flow wrote in place of a UTR when proof was uploaded.
        frappe.db.set_value(PAYMENT, payment, "utr", f"VR-{po}")
        file = frappe.get_doc({
            "doctype": "File", "file_name": "TEST-1404-refund-proof.png", "file_url": PROOF,
            "attached_to_doctype": PAYMENT, "attached_to_name": payment,
            "attached_to_field": "payment_attachment", "is_private": 1,
        })
        file.flags.ignore_file_validate = True
        file.db_insert()
        self.files.append(file.name)
        frappe.db.commit()

        convert_adjustment_refunds(pos=[po])

        refund = frappe.get_doc(VENDOR_REFUNDS, {"document_name": po})
        self.assertEqual(refund.refund_attachment, PROOF)
        self.assertFalse(refund.utr)
        self.assertEqual(
            frappe.db.get_value("File", file.name, ["attached_to_doctype", "attached_to_name"]),
            (VENDOR_REFUNDS, refund.name),
        )

    def test_a_refund_with_no_proof_anywhere_is_left_without_an_attachment(self):
        po, _, _ = self._old_style_refund(refund_attachment=None, payment_attachment=None)

        convert_adjustment_refunds(pos=[po])

        refund = frappe.get_doc(VENDOR_REFUNDS, {"document_name": po})
        self.assertFalse(refund.refund_attachment)
        self.assertEqual(refund.no_bank_line, 1)

    def test_it_stops_and_writes_nothing_when_a_figure_would_move(self):
        po, adj, payment = self._old_style_refund()
        # A stored paid amount that disagrees with the PO's payments: the recompute would move it.
        frappe.db.set_value(PO, po, "amount_paid", 99.0)
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError):
            convert_adjustment_refunds(pos=[po])
        frappe.db.rollback()

        self.assertTrue(frappe.db.exists(PAYMENT, payment))
        self.assertEqual(frappe.db.count(VENDOR_REFUNDS, {"document_name": po}), 0)
        self.assertEqual(frappe.db.count(TERMS, {"parent": po, "label": "RA Vendor"}), 1)
