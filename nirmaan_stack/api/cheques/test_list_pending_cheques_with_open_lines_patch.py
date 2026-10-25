# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The one-time patch that lists the Approval Pending Payment cheques left with a line naming no payment (#1517,
spec #1514).

Drives the patch's entry function (`stuck_cheques`) on planted cheques only, the way `execute` runs it over
every cheque, and reads back what it prints and that no cheque or payment changed. The planted cheques are
the ones the Tracker's Add Cheque made before spec #1514 (`ChequeFixture.plant_cheque`).

⚠️ RUNS AGAINST THE ENV DATABASE (the fixtures commit). Vendors, projects and payments come from
`TaxedWorkOrderFixture`, POs from `ChequeFixture.plant_po`; every Cheque carries a TESTCHQ number and is
purged by `ChequeFixture`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.patches.v3_0.list_pending_cheques_with_open_lines import stuck_cheques, summary
from nirmaan_stack.services.cheques.rules import ISSUED, PENDING

U = "Administrator"
PO = "Procurement Orders"
PAYMENT = "Project Payments"
LINE = "PO/WO Payment"
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"


class TestListPendingChequesWithOpenLinesPatch(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor()
        self.project = self.fx.project()
        self.po = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.vendor)
        self.other_po = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.vendor)
        frappe.db.commit()

    def tearDown(self):
        frappe.db.rollback()
        frappe.set_user(U)

    def _line(self, po, payment=None, amount=10000):
        line = {"line_type": LINE, "project": self.project, "record_doctype": PO, "record_name": po, "amount": amount}
        if payment:
            line["payment_name"] = payment
        return line

    def _cheque(self, lines, *, status=PENDING):
        return self.cheques.plant_cheque(
            status=status, bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
            amount=sum(line["amount"] for line in lines), vendor=self.vendor, attachment=PHOTO, lines=lines,
        )

    def _payment(self, status="Requested"):
        return self.cheques.plant_payment(self.fx, status, project=self.project, vendor=self.vendor,
                                          document=(PO, self.po), amount=10000)

    def _state(self, cheques, payments):
        """Everything the patch could have touched: each cheque's row and lines, and each payment."""
        return (
            [frappe.db.get_value("Cheques", c, ["status", "modified", "cheque_date", "amount"]) for c in cheques],
            sorted(frappe.get_all("Cheque Line", filters={"parent": ["in", cheques], "parenttype": "Cheques"},
                                  fields=["parent", "idx", "record_name", "payment_name", "amount"], as_list=True)),
            [frappe.db.get_value(PAYMENT, p, ["status", "mode_of_payment", "cheque", "modified"]) for p in payments],
        )

    def test_it_lists_the_pending_cheques_with_a_line_naming_no_payment_and_changes_nothing(self):
        pay, other = self._payment(), self._payment()
        stuck = self._cheque([self._line(self.po, pay), self._line(self.other_po)])
        stuck_cheque_no = frappe.db.get_value("Cheques", stuck, "cheque_no")
        complete = self._cheque([self._line(self.po, other)])
        issued_open = self._cheque([self._line(self.other_po)], status=ISSUED)  # not waiting for approval
        planted = [stuck, complete, issued_open]
        before = self._state(planted, [pay, other])

        found = stuck_cheques(cheques=planted)
        self.assertEqual([(c["cheque"], c["cheque_no"], c["open_records"]) for c in found],
                         [(stuck, stuck_cheque_no, [self.other_po])])
        printed = summary(found)
        self.assertIn("1 ", printed[0])
        self.assertIn("cancel each one and raise its payment again from the PO", printed[0])
        self.assertIn(f"{stuck} (cheque {stuck_cheque_no}, {self.vendor}, ₹20,000)", printed[1])
        self.assertIn(f"no payment yet on {self.other_po}", printed[1])

        self.assertEqual(self._state(planted, [pay, other]), before, "the patch changed nothing")
        self.assertEqual(stuck_cheques(cheques=planted), found, "a second run lists the same")

    def test_it_lists_nothing_when_no_cheque_is_stuck(self):
        self.assertEqual(stuck_cheques(cheques=[]), [])
        complete = self._cheque([self._line(self.po, self._payment())])
        self.assertEqual(stuck_cheques(cheques=[complete]), [])
        self.assertEqual(summary([])[0][:2], "0 ")
