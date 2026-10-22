# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""The amendment rules (#1540, spec #1528; GLOSSARY *Amendment (of a Work Order)*).

Each test acts as a throwaway user of a real role profile and does what that user does: amends the Work
Order the way the amend sheet saves it (items, vendor, categories, Nirmaan GST and the status in one save),
accepts it the way the approve screen does (the status move), reverts it through
`api/service_requests/amendment.revert_amendment`, or requests a payment through
`create_payment_request_for_service`. Then it checks the refusal or what is stored.

Run: DEVENV test --module nirmaan_stack.nirmaan_stack.doctype.service_requests.test_work_order_amendment

⚠️ RUNS AGAINST THE SITE DATABASE. Work Orders are planted with the GST Hold fixture (`TEST-GSTH-*`); the
payments and invoices planted on them, and their snapshots, are purged after each test.
"""

import json

import frappe
from frappe.utils import flt

from nirmaan_stack.api.payments.project_payments import create_payment_request_for_service
from nirmaan_stack.api.service_requests.amendment import revert_amendment
from nirmaan_stack.nirmaan_stack.doctype.service_requests.test_work_order_lifecycle import (
    ADMIN,
    PROJECT_LEAD,
    PROJECT_MANAGER,
    SR,
    USERS,
    _AsRoleCase,
)
from nirmaan_stack.integrations.controllers.nirmaan_versions import SNAPSHOT_KEPT_REFUSAL
from nirmaan_stack.services.work_order_lifecycle import (
    AMEND_PAYMENTS_REFUSAL,
    APPROVED_SCOPE_REFUSAL,
    GST_HOLD_AMEND_REFUSAL,
    LEAVE_APPROVED_REFUSAL,
    TOTAL_BELOW_REFUSAL,
    UNDER_AMENDMENT_PAYMENT_REFUSAL,
    VENDOR_CHANGE_REFUSAL,
)

NIRMAAN_GST = "29ABFCS9095N1Z9"
OTHER_NIRMAAN_GST = "27ABFCS9095N1Z1"
U = "Administrator"


class _AmendmentCase(_AsRoleCase):
    def setUp(self):
        super().setUp()
        self.addCleanup(self._purge_children)
        self.amender = USERS[PROJECT_MANAGER]
        self.approver = USERS[PROJECT_LEAD]
        self.wo = self._wo("Approved")   # one line of ₹1,00,000, GST off
        frappe.db.set_value(SR, self.wo, {
            "project_gst": NIRMAAN_GST,
            "service_category_list": json.dumps({"list": [{"name": "Test"}]}),
        })
        frappe.db.commit()

    def _purge_children(self):
        frappe.db.rollback()
        frappe.db.delete("Project Payments", {"document_name": ("in", self.fx.srs)})
        frappe.db.delete("Vendor Invoices", {"document_name": ("in", self.fx.srs)})
        frappe.db.delete("Nirmaan Notifications", {"docname": ("in", self.fx.srs)})
        frappe.db.commit()

    def _payment(self, status, amount=10_000):
        name = f"TEST-AMD-PAY-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            """INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner, docstatus, idx,
                   document_type, document_name, project, vendor, status, amount)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s)""",
            (name, U, U, SR, self.wo, self.project, self.vendor, status, amount),
        )
        frappe.db.commit()
        return name

    def _invoice(self, status):
        frappe.db.sql(
            """INSERT INTO "tabVendor Invoices" (name, creation, modified, modified_by, owner, docstatus, idx,
                   document_type, document_name, project, vendor, status, invoice_no, invoice_amount)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s, 1000)""",
            (f"TEST-AMD-VI-{frappe.generate_hash(length=8)}", U, U, SR, self.wo, self.project, self.vendor,
             status, f"T-{frappe.generate_hash(length=6)}"),
        )
        frappe.db.commit()

    def _amend(self, user=None, *, rate=None, vendor=None, project_gst=None, category=None):
        """The amend sheet's save: the whole item list, vendor, categories, Nirmaan GST and the status, as
        `useSRAmendForm` sends them. Versioned, as in the app, so it leaves the snapshot."""
        def save():
            doc = frappe.get_doc(SR, self.wo)
            row = doc.work_order_items[0]
            doc.update({
                "status": "Amendment",
                "vendor": vendor or doc.vendor,
                "project_gst": project_gst or doc.project_gst,
                "service_category_list": {"list": [{"name": category or "Test"}]},
                "work_order_items": [{
                    "item_name": "Amended work" if rate else row.item_name,
                    "category": category or row.category,
                    "uom": row.uom,
                    "quantity": row.quantity,
                    "rate": rate if rate is not None else row.rate,
                }],
            })
            doc.save(ignore_version=False)
        self._as(user or self.amender, save)

    def _accept(self, user=None):
        self._save(user or self.approver, self.wo, status="Approved")

    def assertRefused(self, act, message):
        with self.assertRaises(frappe.ValidationError) as refused:
            act()
        self.assertIn(message, str(refused.exception))
        return str(refused.exception)

    def _snapshots(self):
        """Each amendment snapshot's outcome, oldest first; None while undecided."""
        return [
            outcome or None
            for outcome in frappe.get_all(
                "Nirmaan Versions", {"ref_doctype": SR, "docname": self.wo}, pluck="outcome",
                order_by="creation asc",
            )
        ]


class TestAmendWaitsForMoneyInFlight(_AmendmentCase):
    def test_a_payment_neither_paid_nor_rejected_stops_amend_and_is_named(self):
        for status in ("Requested", "CEO Pending", "Approved", "Reconciliation Pending"):
            with self.subTest(status=status):
                payment = self._payment(status)
                message = self.assertRefused(lambda: self._amend(rate=90_000), AMEND_PAYMENTS_REFUSAL)
                self.assertIn(f"{payment} ({status})", message)
                self.assertEqual(self._status(self.wo), "Approved")
                frappe.db.delete("Project Payments", {"name": payment})
                frappe.db.commit()

    def test_paid_and_rejected_payments_let_it_start(self):
        self._payment("Paid")
        self._payment("Rejected")
        self._amend(rate=120_000)
        self.assertEqual(self._status(self.wo), "Amendment")


class TestAmendmentKeepsTheMoneyRight(_AmendmentCase):
    def test_the_total_may_not_fall_below_amount_paid(self):
        frappe.db.set_value(SR, self.wo, "amount_paid", 60_000)
        frappe.db.commit()
        message = self.assertRefused(lambda: self._amend(rate=50_000), TOTAL_BELOW_REFUSAL)
        self.assertIn("Amount Paid", message)
        self.assertEqual(self._status(self.wo), "Approved")
        self._amend(rate=60_000)
        self.assertEqual(self._status(self.wo), "Amendment")

    def test_the_total_may_not_fall_below_approved_invoices(self):
        frappe.db.set_value(SR, self.wo, "amount_invoiced", 80_000)
        frappe.db.commit()
        message = self.assertRefused(lambda: self._amend(rate=70_000), TOTAL_BELOW_REFUSAL)
        self.assertIn("approved invoices", message)

    def test_a_paid_vendor_cannot_be_changed(self):
        self._payment("Paid")
        other = self.fx.vendor()
        frappe.db.commit()
        self.assertRefused(lambda: self._amend(vendor=other), VENDOR_CHANGE_REFUSAL)
        self.assertEqual(frappe.db.get_value(SR, self.wo, "vendor"), self.vendor)

    def test_an_invoiced_vendor_cannot_be_changed(self):
        self._invoice("Pending")
        other = self.fx.vendor()
        frappe.db.commit()
        self.assertRefused(lambda: self._amend(vendor=other), VENDOR_CHANGE_REFUSAL)

    def test_a_vendor_with_only_rejected_money_may_be_changed(self):
        self._payment("Rejected")
        self._invoice("Rejected")
        other = self.fx.vendor()
        frappe.db.commit()
        self._amend(vendor=other)
        self.assertEqual(frappe.db.get_value(SR, self.wo, ["status", "vendor"]), ("Amendment", other))

    def test_a_vendor_on_gst_hold_cannot_be_swapped_in(self):
        held = self.fx.vendor(held=1)
        frappe.db.commit()
        message = self.assertRefused(lambda: self._amend(vendor=held), GST_HOLD_AMEND_REFUSAL)
        self.assertIn(held, message)

    def test_a_held_vendors_own_work_order_may_still_be_amended(self):
        frappe.db.set_value("Vendors", self.vendor, "gst_hold", 1)
        frappe.db.commit()
        self._amend(rate=120_000)
        self.assertEqual(self._status(self.wo), "Amendment")


class TestNoPaymentWhileUnderAmendment(_AmendmentCase):
    def _request(self):
        return self._as(USERS[ADMIN], create_payment_request_for_service,
                        json.dumps({"doctype": SR, "docname": self.wo, "amount": 1000}))

    def test_a_payment_request_is_refused_until_the_amendment_is_decided(self):
        self._amend(rate=120_000)
        self.assertRefused(self._request, UNDER_AMENDMENT_PAYMENT_REFUSAL)
        self.assertEqual(frappe.db.count("Project Payments", {"document_name": self.wo}), 0)
        self._accept()
        self.assertTrue(frappe.db.exists("Project Payments", json.loads(self._request())["name"]))


class TestTheDecision(_AmendmentCase):
    def test_accepting_keeps_the_snapshot_marked_accepted(self):
        self._amend(rate=120_000)
        self.assertEqual(self._snapshots(), [None])
        self._accept()
        self.assertEqual(self._snapshots(), ["Accepted"])
        self.assertEqual(flt(frappe.db.get_value(SR, self.wo, "total_amount")), 120_000)

    def test_revert_restores_items_vendor_categories_and_nirmaan_gst(self):
        other = self.fx.vendor()
        frappe.db.commit()
        self._amend(rate=120_000, vendor=other, project_gst=OTHER_NIRMAAN_GST, category="Painting")
        self._as(self.approver, revert_amendment, self.wo)

        doc = frappe.get_doc(SR, self.wo)
        self.assertEqual(
            (doc.status, doc.vendor, doc.project_gst, json.loads(doc.service_category_list)
             if isinstance(doc.service_category_list, str) else doc.service_category_list,
             [(r.item_name, r.category, flt(r.rate)) for r in doc.work_order_items], flt(doc.total_amount)),
            ("Approved", self.vendor, NIRMAAN_GST, {"list": [{"name": "Test"}]},
             [("Test work", "Test", 100_000)], 100_000),
        )
        self.assertEqual(self._snapshots(), ["Reverted"])

    def test_only_an_approver_may_revert(self):
        self._amend(rate=120_000)
        self.assertRefused(lambda: self._as(self.amender, revert_amendment, self.wo),
                           "Only Admin and Project Lead")
        self.assertEqual((self._status(self.wo), self._snapshots()), ("Amendment", [None]))

    def test_a_second_amendment_gets_its_own_snapshot(self):
        self._amend(rate=120_000)
        self._accept()
        self._amend(rate=130_000)
        self._as(self.approver, revert_amendment, self.wo)
        self.assertEqual(self._snapshots(), ["Accepted", "Reverted"])
        self.assertEqual(flt(frappe.db.get_value(SR, self.wo, "total_amount")), 120_000)


class TestScopeChangesOnlyThroughAmend(_AmendmentCase):
    """An Approved Work Order's vendor, items, categories and total change only through Amend, and it never
    goes back to an earlier status, where a change and a fresh approval would skip the amendment rules."""

    def test_a_desk_save_that_changes_an_approved_work_orders_scope_is_refused(self):
        frappe.db.set_value(SR, self.wo, "amount_paid", 60_000)
        frappe.db.commit()
        other = self.fx.vendor()
        frappe.db.commit()

        def new_rate(doc):
            doc.work_order_items[0].rate = 10_000

        def new_vendor(doc):
            doc.vendor = other

        def new_categories(doc):
            doc.service_category_list = {"list": [{"name": "Painting"}]}

        for change in (new_rate, new_vendor, new_categories):
            with self.subTest(change=change.__name__):
                def save():
                    doc = frappe.get_doc(SR, self.wo)
                    change(doc)
                    doc.save()
                self.assertRefused(lambda: self._as(USERS[ADMIN], save), APPROVED_SCOPE_REFUSAL)
        doc = frappe.get_doc(SR, self.wo)
        self.assertEqual((doc.status, doc.vendor, flt(doc.work_order_items[0].rate)),
                         ("Approved", self.vendor, 100_000))

    def test_an_approved_work_order_does_not_go_back_to_an_earlier_status(self):
        for status in ("Vendor Selected", "Rejected", "Created"):
            with self.subTest(status=status):
                self.assertRefused(lambda: self._save(USERS[ADMIN], self.wo, status=status), LEAVE_APPROVED_REFUSAL)
                self.assertEqual(self._status(self.wo), "Approved")

    def test_terms_and_nirmaan_gst_stay_editable(self):
        self._save(USERS[PROJECT_MANAGER], self.wo, notes={"list": ["New terms"]}, project_gst=OTHER_NIRMAAN_GST)
        self.assertEqual(frappe.db.get_value(SR, self.wo, "project_gst"), OTHER_NIRMAAN_GST)

    def test_a_vendor_on_gst_hold_cannot_be_put_on_any_existing_work_order(self):
        held = self.fx.vendor(held=1)
        frappe.db.commit()
        for status in ("Vendor Selected", "Rejected"):
            with self.subTest(status=status):
                wo = self._wo(status)
                self.assertRefused(lambda: self._save(USERS[ADMIN], wo, vendor=held), "GST Hold")
                self.assertEqual(frappe.db.get_value(SR, wo, "vendor"), self.vendor)


class TestTheSnapshotIsKept(_AmendmentCase):
    """An amendment snapshot is the audit record of what was amended (story 25): REST and Desk can't delete
    or change it; only the server marks its outcome."""

    def _snapshot(self):
        return frappe.get_all("Nirmaan Versions", {"ref_doctype": SR, "docname": self.wo}, pluck="name")[0]

    def test_it_cannot_be_deleted_or_changed_by_anyone(self):
        self._amend(rate=120_000)
        snapshot = self._snapshot()
        for user in (USERS[ADMIN], "Administrator"):
            with self.subTest(user=user):
                self.assertRefused(lambda: self._as(user, frappe.delete_doc, "Nirmaan Versions", snapshot),
                                   SNAPSHOT_KEPT_REFUSAL)
                for changes in ({"data": "{}"}, {"outcome": "Accepted"}, {"new_state": "Approved"}):
                    def save():
                        doc = frappe.get_doc("Nirmaan Versions", snapshot)
                        doc.update(changes)
                        doc.save(ignore_permissions=True)
                    self.assertRefused(lambda: self._as(user, save), SNAPSHOT_KEPT_REFUSAL)
        self.assertEqual(self._snapshots(), [None])

    def test_the_decision_still_marks_it(self):
        self._amend(rate=120_000)
        self._accept()
        self.assertEqual(self._snapshots(), ["Accepted"])
