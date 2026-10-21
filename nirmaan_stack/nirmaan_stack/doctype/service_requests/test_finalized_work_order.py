# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""A Finalized Work Order locks its scope (#1539, spec #1528; GLOSSARY *Finalized (Work Order)*).

Each test acts as a throwaway Admin (or Accountant) user, so the lock is shown to bind Admin too, and acts
the way the SPA does (load, change, save: what `updateDoc` and `deleteDoc` reach) or the way Desk does
(the whole document as JSON through `frappe.client.save`). Then it checks the refusal and what is stored.

Run: DEVENV test --module nirmaan_stack.nirmaan_stack.doctype.service_requests.test_finalized_work_order

⚠️ RUNS AGAINST THE SITE DATABASE. Work Orders are planted with the GST Hold fixture (`TEST-GSTH-*`) and
purged after each test, with the payments, invoices and remarks the tests add to them.
"""

import json

import frappe
import frappe.client
from frappe.utils import flt, nowdate

from nirmaan_stack.api.delivery_notes.update_invoice_data import update_invoice_data
from nirmaan_stack.api.payments.project_payments import create_payment_request_for_service
from nirmaan_stack.api.sr_finalize import finalize_sr, revert_finalize_sr
from nirmaan_stack.api.sr_remarks import add_sr_remark
from nirmaan_stack.nirmaan_stack.doctype.service_requests.test_work_order_lifecycle import (
    ACCOUNTANT,
    ADMIN,
    SR,
    USERS,
    _AsRoleCase,
)
from nirmaan_stack.services.work_order_lifecycle import FINALIZE_FLAG_REFUSAL, FINALIZED_REFUSAL

NIRMAAN_GST = "29ABFCS9095N1Z9"


class _FinalizedCase(_AsRoleCase):
    def setUp(self):
        super().setUp()
        self.admin = USERS[ADMIN]
        self.addCleanup(self._purge_children)
        self.wo = self._finalized_wo()

    def _purge_children(self):
        frappe.db.rollback()
        payments = frappe.get_all("Project Payments", {"document_name": ("in", self.fx.srs)}, pluck="name")
        frappe.db.delete("Payment TDS Deduction", {"document_name": ("in", self.fx.srs)})
        frappe.db.delete("Nirmaan Notifications", {"docname": ("in", self.fx.srs + payments)})
        frappe.db.delete("Project Payments", {"document_name": ("in", self.fx.srs)})
        frappe.db.delete("Vendor Invoices", {"document_name": ("in", self.fx.srs)})
        frappe.db.commit()

    def _finalized_wo(self):
        wo = self._wo("Approved")
        frappe.db.set_value(SR, wo, {
            "project_gst": NIRMAAN_GST,
            "notes": json.dumps({"list": [{"id": "a", "note": "Pay in 30 days"}]}),
        })
        frappe.db.commit()
        self._as(self.admin, finalize_sr, wo)
        self.assertEqual(frappe.db.get_value(SR, wo, "is_finalized"), 1)
        return wo

    def _desk_save(self, user, name, **changes):
        """Save the way the Desk form does: the whole document, as JSON, through `frappe.client.save`."""
        def save():
            doc = json.loads(frappe.as_json(frappe.get_doc(SR, name).as_dict()))
            doc.update(changes)
            frappe.client.save(doc)
        self._as(user, save)

    def _scope(self):
        doc = frappe.get_doc(SR, self.wo)
        return (
            doc.status, doc.vendor, doc.gst, doc.notes, flt(doc.total_amount), doc.is_finalized,
            [(i.item_name, flt(i.quantity), flt(i.rate)) for i in doc.work_order_items],
        )

    def assertRefused(self, act, message=FINALIZED_REFUSAL):
        before = self._scope()
        with self.assertRaises(frappe.ValidationError) as refused:
            act()
        self.assertIn(message, str(refused.exception))
        self.assertEqual(self._scope(), before)


class TestLockedActions(_FinalizedCase):
    def test_amend_is_refused(self):
        self.assertRefused(lambda: self._save(self.admin, self.wo, status="Amendment"))

    def test_terms_change_is_refused(self):
        self.assertRefused(lambda: self._save(self.admin, self.wo, notes={"list": [{"id": "a", "note": "60 days"}]}))

    def test_gst_flag_change_is_refused(self):
        self.assertRefused(lambda: self._save(self.admin, self.wo, gst="true"))

    def test_item_change_is_refused(self):
        def change_rate():
            frappe.set_user(self.admin)
            try:
                doc = frappe.get_doc(SR, self.wo)
                doc.work_order_items[0].rate = 1
                doc.save()
            finally:
                frappe.set_user("Administrator")
        self.assertRefused(change_rate)

    def test_delete_is_refused_and_clears_nothing(self):
        self._as(self.admin, add_sr_remark, self.wo, "kept")
        self.assertRefused(lambda: self._as(self.admin, frappe.delete_doc, SR, self.wo))
        self.assertTrue(frappe.db.exists(SR, self.wo))
        self.assertTrue(frappe.db.exists("Nirmaan Comments", {"reference_name": self.wo, "content": "kept"}))

    def test_desk_total_vendor_and_item_edits_are_refused(self):
        other_vendor = self.fx.vendor()
        frappe.db.commit()
        items = json.loads(frappe.as_json(frappe.get_doc(SR, self.wo).as_dict()))["work_order_items"]
        items[0]["quantity"] = 5
        for changes in ({"total_amount": 1}, {"vendor": other_vendor}, {"work_order_items": items},
                        {"status": "Amendment"}):
            with self.subTest(changes=list(changes)):
                self.assertRefused(lambda: self._desk_save(self.admin, self.wo, **changes))

    def test_desk_cannot_untick_the_finalize_flag(self):
        self.assertRefused(lambda: self._desk_save(self.admin, self.wo, is_finalized=0), FINALIZE_FLAG_REFUSAL)

    def test_desk_cannot_tick_it_either(self):
        wo = self._wo("Approved")
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError) as refused:
            self._desk_save(self.admin, wo, is_finalized=1)
        self.assertIn(FINALIZE_FLAG_REFUSAL, str(refused.exception))
        self.assertEqual(frappe.db.get_value(SR, wo, "is_finalized"), 0)


class TestWhatStaysOpen(_FinalizedCase):
    def test_a_desk_save_that_leaves_the_scope_alone_goes_through(self):
        self._desk_save(self.admin, self.wo, invoice_no="INV-OLD-1")
        self.assertEqual(frappe.db.get_value(SR, self.wo, "invoice_no"), "INV-OLD-1")

    def test_a_payment_request(self):
        out = json.loads(self._as(self.admin, create_payment_request_for_service,
                                  json.dumps({"doctype": SR, "docname": self.wo, "amount": 1000})))
        self.assertTrue(frappe.db.exists("Project Payments", out["name"]))

    def test_an_invoice_upload(self):
        self._as(USERS[ACCOUNTANT], update_invoice_data, docname=self.wo, isSR=True, invoice_data=json.dumps({
            "invoice_no": "T-" + frappe.generate_hash(length=8), "date": nowdate(),
            "amount": 1000, "base_amount": 1000, "gst_amount": 0,
        }))
        self.assertEqual(frappe.db.count("Vendor Invoices", {"document_name": self.wo}), 1)

    def test_remarks(self):
        self._as(USERS[ACCOUNTANT], add_sr_remark, self.wo, "still open")
        self.assertTrue(frappe.db.exists("Nirmaan Comments", {"reference_name": self.wo, "content": "still open"}))


class TestRevertFinalizationUnlocks(_FinalizedCase):
    def test_after_revert_the_work_order_can_be_amended(self):
        self._as(self.admin, revert_finalize_sr, self.wo)
        self._save(self.admin, self.wo, status="Amendment")
        self.assertEqual(
            frappe.db.get_value(SR, self.wo, ["is_finalized", "status"], as_dict=True),
            {"is_finalized": 0, "status": "Amendment"},
        )


class TestDeskShowsTheFlagAndTotalReadOnly(_AsRoleCase):
    def test_the_finalize_flag_and_the_total_are_read_only(self):
        meta = frappe.get_meta(SR)
        self.assertEqual(
            {f: meta.get_field(f).read_only for f in ("is_finalized", "total_amount")},
            {"is_finalized": 1, "total_amount": 1},
        )
