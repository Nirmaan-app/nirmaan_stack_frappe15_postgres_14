# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The one-time patch that lists the open Payment cheques on another bank (#1516, ADR-0035 Amendment A).

Only an imported ICICI statement line clears a cheque now, so a Payment cheque on Others that is neither
Cleared nor Cancelled can only be closed by cancelling it. The patch prints them and changes nothing.

Drives the patch's entry function (`open_payment_cheques_on_others`) on planted Cheques only, the way
`execute` runs it over every Cheque, and reads back what it lists and that no Cheque changed.

⚠️ RUNS AGAINST THE ENV DATABASE. Every planted cheque number starts with TESTCHQ, so `ChequeFixture`
purges the Cheques.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.patches.v3_0.list_open_payment_cheques_on_others import (
    open_payment_cheques_on_others,
    summary,
)
from nirmaan_stack.services.cheques.rules import PENDING

U = "Administrator"
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"


class TestOpenChequesOnOthersPatch(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor()
        frappe.db.commit()

    def tearDown(self):
        frappe.db.rollback()
        frappe.set_user(U)

    def _plant(self, status, *, bank_name="HDFC Bank", cheque_type="Payment"):
        """An Ad-hoc cheque at `status`, moved onto `bank_name` (None keeps it on ICICI Bank): the data the
        patch meets, recorded before #1516."""
        name = self.cheques.plant_cheque(
            status=status, bank="ICICI Bank", cheque_no=self.cheques.number(), cheque_date=nowdate(),
            amount=12000, vendor=self.vendor, description="Advance", attachment=PHOTO,
        )
        if cheque_type != "Payment":
            frappe.db.set_value("Cheques", name, "cheque_type", cheque_type, update_modified=False)  # raw: setup
            frappe.db.commit()
        if bank_name:
            ChequeFixture.move_to_other_bank(name, bank_name)
        return name

    def _snapshot(self, names):
        return sorted(
            (c.name, str(c.modified), c.status, c.bank, c.bank_name, c.cheque_type)
            for c in frappe.get_all("Cheques", filters={"name": ["in", names]},
                                    fields=["name", "modified", "status", "bank", "bank_name", "cheque_type"])
        )

    def test_it_lists_the_open_payment_cheques_on_another_bank_and_changes_nothing(self):
        issued, pending = self._plant("Issued"), self._plant(PENDING, bank_name="Axis Bank")
        others = [
            self._plant("Cleared"),
            self._plant("Cancelled"),
            self._plant("Issued", bank_name=None),
            self._plant("Issued", cheque_type="Security Deposit"),
        ]
        planted = [issued, pending, *others]
        before = self._snapshot(planted)

        listed = open_payment_cheques_on_others(planted)

        self.assertEqual(
            [(r["cheque"], r["bank_name"], r["status"]) for r in listed],
            sorted([(issued, "HDFC Bank", "Issued"), (pending, "Axis Bank", PENDING)]),
        )
        self.assertEqual(self._snapshot(planted), before)
        self.assertEqual(open_payment_cheques_on_others(planted), listed)  # a second run says the same

        lines = summary(listed)
        self.assertEqual(
            lines[0],
            "2 open Payment cheque(s) on a bank other than ICICI Bank: no statement import can clear them, "
            "so cancel each one and raise its payment again on ICICI Bank",
        )
        number = frappe.db.get_value("Cheques", issued, "cheque_no")
        self.assertIn(f"{issued} ({number}) on HDFC Bank: Issued, ₹12,000", lines)

    def test_none_open_says_so(self):
        self.assertEqual(summary([]), ["0 open Payment cheque(s) on a bank other than ICICI Bank"])
