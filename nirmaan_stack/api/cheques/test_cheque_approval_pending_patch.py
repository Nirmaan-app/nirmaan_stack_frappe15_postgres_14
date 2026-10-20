# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The one-time patch that renames the Cheque status Pending to Approval Pending (#1515, spec #1514).

Drives the patch's entry function (`rename_pending_cheques`) on planted Cheques, the way `execute` runs it
over every Cheque, and reads back each Cheque's status and history and what the patch reports.

Each planted Cheque is made through the cheques service, then put back into its pre-#1515 state with raw
writes (status and history rows naming Pending): that is the old data the patch meets.

⚠️ RUNS AGAINST THE ENV DATABASE. Every planted cheque number starts with TESTCHQ, so `ChequeFixture` purges
the Cheques; the planted Reminder Schedule Log row is purged by name.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.patches.v3_0.cheque_status_approval_pending import rename_pending_cheques, summary

U = "Administrator"
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"
HISTORY = "Cheque Status History"


class TestChequeApprovalPendingPatch(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.cheques = ChequeFixture.attach(self)
        self.planted = []

    def tearDown(self):
        frappe.db.rollback()

    # -- planting -------------------------------------------------------------------------------
    def _cheque(self, status, *history):
        """A Cheque as the ledger holds one before #1515: at `status`, its history rows `(from, to)`."""
        name = self.cheques.plant_cheque(
            status="Issued", bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
            amount=5000, payee_name="Ravi Kumar", description="Rent", attachment=PHOTO,
        )
        # Raw on purpose: this plants old data, a status today's options no longer allow.
        frappe.db.set_value("Cheques", name, "status", status, update_modified=False)
        frappe.db.delete(HISTORY, {"parenttype": "Cheques", "parent": name})
        doc = frappe.get_doc("Cheques", name)
        for i, (before, after) in enumerate(history, start=1):
            row = doc.append("status_history", {"from_status": before, "to_status": after, "changed_by": U,
                                                "changed_at": frappe.utils.now(), "note": "planted"})
            row.idx = i
            row.db_insert()
        frappe.db.commit()
        self.planted.append(name)
        return name

    def _rename(self, cheques=None):
        result = rename_pending_cheques(cheques=self.planted if cheques is None else cheques)
        frappe.db.commit()
        return result

    def _read(self, name):
        doc = frappe.get_doc("Cheques", name)
        return doc.status, [(h.from_status, h.to_status) for h in doc.status_history]

    # -- the rename -------------------------------------------------------------------------------
    def test_a_pending_cheque_and_its_history_become_approval_pending(self):
        name = self._cheque("Pending", (None, "Pending"))

        result = self._rename()

        self.assertEqual(self._read(name), ("Approval Pending", [(None, "Approval Pending")]))
        self.assertEqual([c["cheque"] for c in result["cheques"]], [name])

    def test_an_issued_cheque_keeps_its_status_and_its_history_is_renamed(self):
        name = self._cheque("Issued", (None, "Pending"), ("Pending", "Issued"))

        result = self._rename()

        self.assertEqual(self._read(name), ("Issued", [(None, "Approval Pending"), ("Approval Pending", "Issued")]))
        self.assertEqual(result["cheques"], [])
        self.assertEqual(result["history"], {name: 2})

    def test_a_cheque_that_never_was_pending_is_untouched(self):
        name = self._cheque("Issued", (None, "Issued"), ("Issued", "Cleared"))
        frappe.db.set_value("Cheques", name, "status", "Cleared", update_modified=False)
        frappe.db.commit()
        modified = frappe.db.get_value("Cheques", name, "modified")

        result = self._rename()

        self.assertEqual(self._read(name), ("Cleared", [(None, "Issued"), ("Issued", "Cleared")]))
        self.assertEqual((result["cheques"], result["history"]), ([], {}))
        self.assertEqual(frappe.db.get_value("Cheques", name, "modified"), modified)

    def test_pending_in_other_doctypes_is_left_alone(self):
        log = frappe.generate_hash(length=10)
        frappe.db.sql(
            """INSERT INTO "tabReminder Schedule Log" (name, creation, modified, modified_by, owner, docstatus,
                   idx, reminder_schedule, due_date, status)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, 'TEST-REMINDER', %s, 'Pending')""",
            (log, U, U, nowdate()),
        )
        frappe.db.commit()
        self.addCleanup(ChequeFixture.purge_rows, [("Reminder Schedule Log", {"name": log})])
        name = self._cheque("Pending", (None, "Pending"))

        # Every Cheque of the env database, as `execute` runs it: only Cheques and their history move.
        rename_pending_cheques()
        frappe.db.commit()

        self.assertEqual(frappe.db.get_value("Reminder Schedule Log", log, "status"), "Pending")
        self.assertEqual(self._read(name)[0], "Approval Pending")
        self.assertFalse(frappe.db.exists("Cheques", {"status": "Pending"}))

    # -- once only, and it says what it did -------------------------------------------------------
    def test_a_second_run_changes_nothing(self):
        self._cheque("Pending", (None, "Pending"))
        self._cheque("Issued", (None, "Pending"), ("Pending", "Issued"))
        self._rename()
        before = [self._read(n) for n in self.planted]

        second = self._rename()

        self.assertEqual((second["cheques"], second["history"]), ([], {}))
        self.assertEqual([self._read(n) for n in self.planted], before)

    def test_the_summary_names_every_cheque_it_changed(self):
        pending = self._cheque("Pending", (None, "Pending"))
        issued = self._cheque("Issued", (None, "Pending"), ("Pending", "Issued"))
        number = frappe.db.get_value("Cheques", pending, "cheque_no")

        text = "\n".join(summary(self._rename()))

        self.assertIn("1 Cheque(s) moved from Pending to Approval Pending", text)
        self.assertIn(f"{pending} ({number})", text)
        self.assertIn(f"{issued}: 2 status history row(s)", text)
