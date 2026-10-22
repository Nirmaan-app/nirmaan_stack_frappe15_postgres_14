# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A `Payment TDS Deduction` can hold a Non-Project Expense's tax, and no Work Order reader counts it
(#1523, spec #1522).

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not the Technical Data Sheet family.

Fixtures are raw-inserted (prefix `TEST-TDSX-`), as in `services/test_payment_tds`: the Work Order
deduction comes from the real `record_deduction`, and the expense records are inserted through the
document layer, so the doctype's `validate` and its unique index are what refuse a bad one. The
app's own writer (`services/expense_tds`, #1525) is tested in `api/expense_requests/test_office_rent_tds`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.patches.v3_0 import backfill_payment_tds_section
from nirmaan_stack.services import order_payments, payment_tds
from nirmaan_stack.services.amount_paid import write_amount_paid
from nirmaan_stack.services.amount_paid_drift import mismatches
from nirmaan_stack.services.project_money import project_money_of

TDS_DOCTYPE = payment_tds.TDS_DOCTYPE
PAYMENT = "Project Payments"
SR = "Service Requests"
NPE = "Non Project Expenses"

P = "TEST-TDSX-"
U = "Administrator"


class TestTdsExpenseRecords(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.db.rollback()
        cls.project = f"{P}PROJ"
        cls.vendor = f"{P}VEN"
        cls.sr = f"{P}SR"
        frappe.db.sql(
            """INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner,
                   docstatus, idx, project_name, tendering_status)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 'Won')""",
            (cls.project, U, U, "TEST TDSX Project"),
        )
        frappe.db.sql(
            """INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner,
                   docstatus, idx, vendor_name, tds_deduction_percentage)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 2)""",
            (cls.vendor, U, U, cls.vendor),
        )
        frappe.db.sql(
            """INSERT INTO "tabService Requests" (name, creation, modified, modified_by, owner,
                   docstatus, idx, project, vendor, status, total_amount, amount_paid)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 'Approved', 1000000, 0)""",
            (cls.sr, U, U, cls.project, cls.vendor),
        )
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        like = f"{P}%"
        try:
            frappe.db.sql(
                f'DELETE FROM "tab{TDS_DOCTYPE}" WHERE project_payment LIKE %s OR non_project_expense LIKE %s',
                (like, like),
            )
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            print(f"tearDown purge failed: {TDS_DOCTYPE}\n{frappe.get_traceback()}")
        for dt in (PAYMENT, NPE, SR, "Vendors", "Projects"):
            try:
                frappe.db.sql(f'DELETE FROM "tab{dt}" WHERE name LIKE %s', (like,))
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()
                print(f"tearDown purge failed: {dt}\n{frappe.get_traceback()}")
        super().tearDownClass()

    def tearDown(self):
        frappe.db.rollback()
        frappe.db.sql(
            f'DELETE FROM "tab{TDS_DOCTYPE}" WHERE project_payment LIKE %s OR non_project_expense LIKE %s',
            (f"{P}%", f"{P}%"),
        )
        for dt in (PAYMENT, NPE):
            frappe.db.sql(f'DELETE FROM "tab{dt}" WHERE name LIKE %s', (f"{P}%",))
        frappe.db.commit()
        super().tearDown()

    # -- helpers ---------------------------------------------------------------------------
    def _expense(self, amount=100000):
        name = f"{P}NPE-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            """INSERT INTO "tabNon Project Expenses" (name, creation, modified, modified_by, owner,
                   docstatus, idx, amount, status, description)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 'Approved', 'TEST TDSX rent')""",
            (name, U, U, amount),
        )
        frappe.db.commit()
        return name

    def _record(self, **links):
        """An expense-style tax record, inserted through the document layer."""
        row = frappe.new_doc(TDS_DOCTYPE)
        row.update(
            {
                "gross_amount": 100000,
                "tds_percentage": 10,
                "tds_amount": 10000,
                "tds_section": payment_tds.TDS_SECTION_RENT,
                "deductee_name": "TEST TDSX Landlord",
                "deductee_pan": "ABCPK1234D",
                **links,
            }
        )
        return row.insert(ignore_permissions=True)

    def _paid_work_order_payment(self, amount=50000):
        """A Work Order payment taxed by the real `record_deduction`, then Paid and recounted."""
        name = f"{P}PAY-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{PAYMENT}" (name, creation, modified, modified_by, owner,
                    docstatus, idx, project, vendor, amount, status, document_type, document_name)
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, 'Approved', %s, %s)""",
            (name, U, U, self.project, self.vendor, amount, SR, self.sr),
        )
        self.assertTrue(payment_tds.record_deduction(frappe.get_doc(PAYMENT, name)))
        frappe.db.sql(f"""UPDATE "tab{PAYMENT}" SET status = 'Paid' WHERE name = %s""", (name,))
        write_amount_paid(SR, self.sr)
        frappe.db.commit()
        return name

    def _work_order_figures(self):
        write_amount_paid(SR, self.sr)
        stored = frappe.db.get_value(SR, self.sr, ["amount_paid", "total_tds", "amount_due"], as_dict=True)
        return {
            "stored": dict(stored),
            "total_tds_of": payment_tds.total_tds_of(SR, self.sr),
            "borne_by_order": payment_tds.borne_tds_by_order(SR, [self.sr]),
            "borne": payment_tds.work_order_tds_borne(self.sr),
            "deductions": payment_tds.order_deductions(SR, self.sr),
            "request_cap_tds": order_payments.load_payments(SR, self.sr)[1],
            "mismatches": mismatches(SR, [self.sr]),
            "project_money": project_money_of(self.project).as_dict(),
        }

    # -- which source ----------------------------------------------------------------------
    def test_a_record_for_an_expense_saves(self):
        expense = self._expense()
        row = self._record(non_project_expense=expense)
        self.assertEqual(frappe.db.get_value(TDS_DOCTYPE, row.name, "non_project_expense"), expense)
        self.assertIsNone(frappe.db.get_value(TDS_DOCTYPE, row.name, "project_payment"))

    def test_a_record_with_neither_link_is_refused_saying_why(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            self._record()
        self.assertIn("Project Payment or a Non-Project Expense", str(caught.exception))
        self.assertFalse(frappe.db.exists(TDS_DOCTYPE, {"deductee_name": "TEST TDSX Landlord"}))

    def test_a_record_with_both_links_is_refused_saying_why(self):
        payment = self._paid_work_order_payment()
        expense = self._expense()
        with self.assertRaises(frappe.ValidationError) as caught:
            self._record(project_payment=payment, non_project_expense=expense)
        self.assertIn("never both", str(caught.exception))
        self.assertFalse(frappe.db.exists(TDS_DOCTYPE, {"non_project_expense": expense}))

    def test_an_edit_that_drops_the_link_is_refused(self):
        row = self._record(non_project_expense=self._expense())
        row.non_project_expense = None
        with self.assertRaises(frappe.ValidationError):
            row.save(ignore_permissions=True)

    def test_a_second_record_for_the_same_expense_is_refused(self):
        expense = self._expense()
        self._record(non_project_expense=expense)
        frappe.db.commit()
        frappe.db.savepoint("second_record")
        with self.assertRaises((frappe.UniqueValidationError, frappe.DuplicateEntryError)):
            self._record(non_project_expense=expense)
        frappe.db.rollback(save_point="second_record")
        self.assertEqual(frappe.db.count(TDS_DOCTYPE, {"non_project_expense": expense}), 1)

    # -- the section -----------------------------------------------------------------------
    def test_a_work_order_deduction_is_section_194c_with_no_deductee(self):
        payment = self._paid_work_order_payment()
        row = frappe.db.get_value(
            TDS_DOCTYPE,
            {"project_payment": payment},
            ["tds_section", "non_project_expense", "deductee_name", "deductee_pan"],
            as_dict=True,
        )
        self.assertEqual(row.tds_section, payment_tds.TDS_SECTION_WORK_ORDER)
        self.assertFalse(row.non_project_expense or row.deductee_name or row.deductee_pan)

    def test_the_patch_sets_194c_on_a_row_with_no_section(self):
        payment = self._paid_work_order_payment()
        name = frappe.db.get_value(TDS_DOCTYPE, {"project_payment": payment}, "name")
        frappe.db.sql(f"""UPDATE "tab{TDS_DOCTYPE}" SET tds_section = NULL WHERE name = %s""", (name,))
        rent = self._record(non_project_expense=self._expense())

        backfill_payment_tds_section.execute()

        self.assertEqual(frappe.db.get_value(TDS_DOCTYPE, name, "tds_section"), "194C")
        # A row that already says its section keeps it.
        self.assertEqual(frappe.db.get_value(TDS_DOCTYPE, rent.name, "tds_section"), "194-I")

    # -- no Work Order reader counts an expense record ------------------------------------
    def test_an_expense_record_moves_no_work_order_or_project_figure(self):
        """The adversarial case: the expense records name the SAME vendor, project and Work Order
        as the taxed payment, one of them Company-borne, so a reader that filtered on those snapshot
        columns instead of joining through `project_payment` would count them."""
        self._paid_work_order_payment()
        before = self._work_order_figures()
        self.assertEqual(before["stored"]["total_tds"], 1000)

        for borne_by in (payment_tds.BORNE_BY_VENDOR, payment_tds.BORNE_BY_COMPANY):
            self._record(
                non_project_expense=self._expense(),
                vendor=self.vendor,
                project=self.project,
                document_type=SR,
                document_name=self.sr,
                borne_by=borne_by,
            )
        frappe.db.commit()

        self.assertEqual(self._work_order_figures(), before)
