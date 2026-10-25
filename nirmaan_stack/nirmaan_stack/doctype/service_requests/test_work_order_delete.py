# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""A Work Order delete announces itself only once it is done (#1548, spec #1528 story 96).

Deleting a Work Order tells each user holding one of its notifications ("sr:delete"), so their open screens
drop it. Frappe refuses the delete AFTER `on_trash` when a payment still points at the Work Order, so an
announcement sent from `on_trash` told every screen about a Work Order that still exists.

Each test deletes as a throwaway Admin user, the way the Work Order page and the Pending list do
(`deleteDoc` reaches `frappe.delete_doc`), lets the request end the way Frappe's handler ends it (a commit,
or a rollback after an error), and reads what reached the realtime server.

Run: DEVENV test --module nirmaan_stack.nirmaan_stack.doctype.service_requests.test_work_order_delete

⚠️ RUNS AGAINST THE SITE DATABASE. Work Orders are planted with the GST Hold fixture (`TEST-GSTH-*`); their
payments and notifications are purged after each test.
"""

from unittest.mock import patch

import frappe

from nirmaan_stack.nirmaan_stack.doctype.service_requests.test_work_order_lifecycle import (
    ADMIN,
    PROJECT_LEAD,
    SR,
    USERS,
    _AsRoleCase,
)

DELETE_EVENT = "sr:delete"


class TestDeletingAWorkOrder(_AsRoleCase):
    def setUp(self):
        super().setUp()
        self.admin = USERS[ADMIN]
        self.watcher = USERS[PROJECT_LEAD]
        self.payments = []
        self.addCleanup(self._purge_children)
        self.wo = self._wo("Vendor Selected")
        self._notify(self.watcher, self.wo)
        frappe.db.commit()

    def _purge_children(self):
        frappe.db.rollback()
        frappe.db.delete("Nirmaan Notifications", {"docname": ("in", self.fx.srs)})
        frappe.db.delete("Project Payments", {"name": ("in", self.payments or [""])})
        frappe.db.commit()

    def _notify(self, user, wo):
        frappe.get_doc({
            "doctype": "Nirmaan Notifications", "recipient": user, "title": "SR Status Updated",
            "description": f"Vendors have been selected for the SR: {wo}!", "document": SR, "docname": wo,
            "project": self.project, "work_package": "Services", "seen": "false", "type": "info",
            "event_id": "sr:vendorSelected",
        }).insert(ignore_permissions=True)

    def _payment(self, wo):
        name = f"TEST-WODEL-PAY-{frappe.generate_hash(length=8)}"
        frappe.get_doc({
            "doctype": "Project Payments", "name": name, "document_type": SR, "document_name": wo,
            "project": self.project, "vendor": self.vendor, "amount": 1000, "status": "Requested",
        }).db_insert()
        self.payments.append(name)
        frappe.db.commit()

    def _delete_as_admin(self):
        """Delete as the Admin, then end the request as Frappe does: commit, or roll back on an error."""
        with patch("frappe.realtime.emit_via_redis") as emit:
            try:
                self._as(self.admin, frappe.delete_doc, SR, self.wo)
            except Exception:
                frappe.db.rollback()
                raise
            else:
                frappe.db.commit()
            finally:
                self.sent = [(c.args[0], c.args[1].get("docname")) for c in emit.call_args_list]

    def test_a_delete_refused_because_a_payment_exists_announces_nothing(self):
        self._payment(self.wo)

        with self.assertRaises(frappe.LinkExistsError):
            self._delete_as_admin()

        self.assertNotIn((DELETE_EVENT, self.wo), self.sent)
        self.assertTrue(frappe.db.exists(SR, self.wo))
        self.assertTrue(frappe.db.exists("Nirmaan Notifications", {"docname": self.wo, "recipient": self.watcher}))

    def test_a_delete_that_goes_through_announces_it(self):
        self._delete_as_admin()

        self.assertFalse(frappe.db.exists(SR, self.wo))
        self.assertIn((DELETE_EVENT, self.wo), self.sent)
        self.assertFalse(frappe.db.exists("Nirmaan Notifications", {"docname": self.wo}))
