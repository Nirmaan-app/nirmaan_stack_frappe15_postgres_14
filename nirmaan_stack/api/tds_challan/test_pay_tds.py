# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Pay TDS pays an Office Rent row and a Work Order row alike (spec #1522, #1525).

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not a Technical Data Sheet.

Driven through the two endpoints the Pay TDS dialog calls, `create_challan_and_pay` (a new challan)
and `pay_tds` (an existing one), and asserted on what the register and View Challans show: each row's
status and challan, and the challan's used balance, which is always the sum of its rows.

The rent rows are withheld by the real `expense_tds.withhold_expense_tds` from Office Rent expenses
planted at Approved; the Work Order row is a document insert on a planted payment, as in
`services/test_tds_expense_records`. Runs inside ONE transaction whose commits are stubbed and which
`tearDown` rolls back, so nothing outlives a test.

Run:
  devenv.sh test --module nirmaan_stack.api.tds_challan.test_pay_tds
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.tds_challan.pay_tds import create_challan_and_pay, pay_tds
from nirmaan_stack.services.expense_tds import withhold_expense_tds
from nirmaan_stack.services.payment_tds import TDS_SECTION_WORK_ORDER

TDS = "Payment TDS Deduction"
CHALLAN = "TDS Challan Attachment"
NPE = "Non Project Expenses"
P = "XPAYTDS-"


class TestPayTds(FrappeTestCase):
    def setUp(self):
        self._commit = frappe.db.commit
        frappe.db.commit = lambda *a, **k: None
        frappe.set_user("Administrator")

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.commit = self._commit
        frappe.db.rollback()

    # -- helpers --------------------------------------------------------------------------------
    def _rent_row(self, amount) -> str:
        """An Office Rent expense at Approved, its tax withheld; returns the tax record."""
        name = f"{P}NPE-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            """INSERT INTO "tabNon Project Expenses" (name, creation, modified, modified_by, owner,
                   docstatus, idx, type, amount, status, description)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, 'Office Rent', %s,
                   'Approved', 'xpaytds rent')""",
            (name, amount),
        )
        return withhold_expense_tds(frappe.get_doc(NPE, name), deductee_name="Asha Rao",
                                    deductee_pan="ABCPK1234D")

    def _work_order_row(self, tds) -> str:
        payment = f"{P}PAY-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            """INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner,
                   docstatus, idx, amount, status)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, 'Approved')""",
            (payment, tds * 49),
        )
        row = frappe.new_doc(TDS)
        row.update({"project_payment": payment, "gross_amount": tds * 50, "tds_percentage": 2,
                    "tds_amount": tds, "tds_section": TDS_SECTION_WORK_ORDER})
        return row.insert(ignore_permissions=True).name

    @staticmethod
    def _challan_data(amount, ref):
        return {"financial_year": "2026-27", "amount": amount, "date_of_deposit": "2026-10-20",
                "bank_reference_number": f"{P}{ref}-{frappe.generate_hash(length=6)}", "bsr_code": "00069",
                "challan_no": "12345", "mode_of_payment": "Net Banking",
                "challan_attachment": "/api/method/frappe_gcp_attachment.controller.generate_file?key=x.pdf"}

    def _row(self, name):
        return frappe.db.get_value(TDS, name, ["status", "tds_challan", "tds_amount"], as_dict=True)

    def _used(self, challan):
        return frappe.db.get_value(CHALLAN, challan, "reconciled_amount")

    def _sum_of_rows(self, challan):
        return frappe.db.sql(f'SELECT SUM(tds_amount) FROM "tab{TDS}" WHERE tds_challan = %s', (challan,))[0][0]

    # -- tests ----------------------------------------------------------------------------------
    def test_a_rent_row_is_paid_against_a_new_challan(self):
        rent = self._rent_row(100000)

        result = create_challan_and_pay(deductions=frappe.as_json([rent]),
                                        challan_data=frappe.as_json(self._challan_data(25000, "NEW")))

        challan = result["created_challan"]
        self.assertEqual(self._row(rent), {"status": "Paid", "tds_challan": challan, "tds_amount": 10000})
        self.assertEqual(self._used(challan), 10000)
        self.assertEqual(result["remaining"], 15000)

    def test_rent_and_work_order_rows_share_an_existing_challan_and_its_used_balance_is_their_sum(self):
        first = create_challan_and_pay(deductions=frappe.as_json([self._rent_row(100000)]),
                                       challan_data=frappe.as_json(self._challan_data(25000, "OLD")))
        challan = first["created_challan"]
        rent, work_order = self._rent_row(55000), self._work_order_row(800)

        pay_tds(deductions=frappe.as_json([rent, work_order]), challan=challan)

        for name in (rent, work_order):
            self.assertEqual(self._row(name).status, "Paid")
            self.assertEqual(self._row(name).tds_challan, challan)
        self.assertEqual(self._used(challan), 10000 + 5500 + 800)
        self.assertEqual(self._used(challan), self._sum_of_rows(challan))

    def test_rent_rows_over_the_challans_balance_are_refused_and_nothing_is_paid(self):
        challan = create_challan_and_pay(deductions=frappe.as_json([self._rent_row(100000)]),
                                         challan_data=frappe.as_json(self._challan_data(12000, "FULL")))["created_challan"]
        rent = self._rent_row(30000)

        with self.assertRaisesRegex(frappe.ValidationError, "has only 2000.0 left"):
            pay_tds(deductions=frappe.as_json([rent]), challan=challan)

        self.assertEqual(self._row(rent), {"status": "Pending", "tds_challan": None, "tds_amount": 3000})
        self.assertEqual(self._used(challan), self._sum_of_rows(challan))
