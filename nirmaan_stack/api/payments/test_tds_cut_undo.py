# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""*Company Bears TDS* and *Mark as Deposit* (owner 2026-10-27), which replace *TDS paid by company* (#1537).

  * Raising a payment after its tax was cut is still refused, now pointing to the two actions.
  * Both actions (Admin) put an `Approved` Work Order payment cut by its TDS back to its full request:
    Rs 10,000 cut to Rs 9,800 + Rs 200 -> Rs 10,000. *Company Bears TDS* keeps the Rs 200 deduction as the
    company's; *Mark as Deposit* deletes it. Each leaves a record of who and when.
  * Raising a cut payment (both) is refused once the money is out (`Reconciliation Pending`, `Paid`), on a
    cheque, and when there is no cut to undo. *Mark as Deposit* on a company-borne TDS changes no payment
    figure, so it works up to `Reconciliation Pending`. Both are refused on a `Paid` payment, for a
    non-Admin, and once the TDS is paid (a challan).
  * Once Paid, the Work Order reads Amount Paid = the request and Amount Due 0 either way; its Total TDS
    keeps the Rs 200 only after *Company Bears TDS*.

Driven through the real doors as the role that uses them: an Admin calls the endpoints, an Accountant
edits in Desk (a document save). Approval is `ceo_approve_payment` (`TaxedWorkOrderFixture`); Paid and
the deposit are `DepositedTaxCase`'s.

⚠️ RUNS AGAINST THE SITE DATABASE. Everything is `TEST-TWO-*` (purged by `TaxedWorkOrderFixture`), plus
the challans and the Accountant user `DepositedTaxCase` makes and removes, and the Version / Deleted
Document rows of the deductions made here (`_drop_deduction_records`).
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.payments.tds_cut_undo import company_bears_tds, mark_as_deposit
from nirmaan_stack.api.payments.work_order_tds import get_work_order_tds
from nirmaan_stack.api.tds_challan.test_deposited_tax import PAYMENT, PTD, DepositedTaxCase
from nirmaan_stack.services.role_profiles import ADMIN_PROFILE

MISC = ["Miscellaneous Services"]


class TdsCutUndoCase(DepositedTaxCase):
    def setUp(self):
        super().setUp()
        self.project = self.fx.project()
        self.vendor = self.fx.vendor(2.0)
        self.deductions: list[str] = []
        # Runs before the fixture's purge (cleanups run last-in first-out).
        self.addCleanup(self._drop_deduction_records)

    def _drop_deduction_records(self):
        """The actions write a Version on a deduction they keep and a Deleted Document for one they delete;
        the fixture purges only the payments'."""
        frappe.db.rollback()
        if self.deductions:
            frappe.db.delete("Version", {"ref_doctype": PTD, "docname": ["in", self.deductions]})
            frappe.db.delete("Deleted Document", {"deleted_doctype": PTD, "deleted_name": ["in", self.deductions]})
            frappe.db.commit()

    def _admin(self):
        user = frappe.db.get_value("Nirmaan Users", {"role_profile": ADMIN_PROFILE}, "name")
        if not user:
            self.skipTest(f"no {ADMIN_PROFILE} user on this site")
        return user

    def _approved_on(self, gross=10000, total=10000, categories=None):
        """An Approved payment on its own Work Order, cut by the real approval: 10,000 -> 9,800 + 200."""
        wo = self.fx.service_request(self.project, self.vendor, total=total, categories=categories)
        made = self.fx.payment(gross, project=self.project, vendor=self.vendor, service_request=wo)
        self.deductions.append(made.deduction)
        return made

    def _figures(self, made):
        row = self._wo(made)
        return flt(row.amount_paid, 2), flt(row.total_tds, 2), flt(row.amount_due, 2)

    def _deduction(self, made):
        row = frappe.db.get_value(PTD, made.deduction, ["gross_amount", "tds_amount", "borne_by"], as_dict=True)
        return (flt(row.gross_amount, 2), flt(row.tds_amount, 2), row.borne_by) if row else None

    def _payment(self, made):
        row = frappe.db.get_value(PAYMENT, made.name, ["amount", "payment_tds", "status"], as_dict=True)
        return flt(row.amount, 2), row.payment_tds, row.status

    def assertRefused(self, action, made, *, says):
        with self.assertRaises(frappe.ValidationError) as caught:
            self._as(self._admin(), action, made.name)
        frappe.db.rollback()
        self.assertIn(says, str(caught.exception))


class TestRaisingAPaymentAfterItsTaxWasCut(TdsCutUndoCase):
    def _raise(self, made, amount):
        def edit():
            doc = frappe.get_doc(PAYMENT, made.name)
            doc.amount = amount
            doc.save()

        self._as_accountant(edit)

    def test_it_is_refused_pointing_to_the_two_actions(self):
        made = self._approved_on()

        with self.assertRaises(frappe.ValidationError) as caught:
            self._raise(made, 10000)
        frappe.db.rollback()

        self.assertIn("Company Bears TDS", str(caught.exception))
        self.assertIn("Mark as Deposit", str(caught.exception))
        self.assertEqual(self._payment(made)[0], 9800)
        self.assertEqual(self._deduction(made), (10000, 200, "Vendor"))

    def test_lowering_it_still_restates_the_tax(self):
        made = self._approved_on()
        self._raise(made, 4900)
        frappe.db.commit()
        self.assertEqual(self._deduction(made), (5000, 100, "Vendor"))

    def test_a_payment_kept_whole_may_still_be_raised(self):
        """Its tax was never cut, so the raised figure is the new full bill, taxed on top as before."""
        made = self._approved_on(total=20000, categories=MISC)
        self._raise(made, 12000)
        frappe.db.commit()
        self.assertEqual(self._payment(made)[0], 12000)
        self.assertEqual(self._deduction(made), (12000, 240, "Company"))


class TestCompanyBearsTds(TdsCutUndoCase):
    def test_it_restores_the_request_and_keeps_the_tax_as_the_companys(self):
        made = self._approved_on()
        self.assertEqual(self._payment(made), (9800, made.deduction, "Approved"))

        answer = self._as(self._admin(), company_bears_tds, made.name)

        self.assertEqual(answer, {"deduction": made.deduction, "amount": 10000.0})
        self.assertEqual(self._payment(made), (10000, made.deduction, "Approved"))
        self.assertEqual(self._deduction(made), (10000, 200, "Company"))

    def test_once_paid_the_work_order_reads_the_request_paid_and_the_tax_on_top(self):
        made = self._approved_on()
        self._as(self._admin(), company_bears_tds, made.name)
        self._mark_paid(made)

        self.assertEqual(self._figures(made), (10000, 200, 0))
        answer = get_work_order_tds(made.service_request)
        self.assertEqual({k: answer[k] for k in ("withheld", "company", "kind")},
                         {"withheld": 0.0, "company": 200.0, "kind": "company"})
        self.assertEqual(answer["payments"][made.name]["requested_amount"], 10000.0)

    def test_the_endpoint_commits_its_own_work(self):
        made = self._approved_on()
        self._as(self._admin(), company_bears_tds, made.name)
        frappe.db.rollback()   # what the request does after the endpoint returns: nothing is lost
        self.assertEqual(self._payment(made)[0], 10000)
        self.assertEqual(self._deduction(made)[2], "Company")

    def test_it_is_recorded_with_who_and_when(self):
        made = self._approved_on()
        admin = self._admin()

        self._as(admin, company_bears_tds, made.name)

        versions = frappe.get_all(
            "Version", filters={"ref_doctype": PTD, "docname": made.deduction}, fields=["owner", "creation", "data"]
        )
        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0].owner, admin)
        self.assertTrue(versions[0].creation)
        self.assertEqual(frappe.parse_json(versions[0].data)["changed"], [["borne_by", "Vendor", "Company"]])

    def test_who_bore_the_tax_is_not_changed_by_hand(self):
        """Only the action flips it: an edit of the deduction in Desk is refused, naming the action."""
        made = self._approved_on()

        def flip():
            row = frappe.get_doc(PTD, made.deduction)
            row.borne_by = "Company"
            row.save()

        with self.assertRaises(frappe.ValidationError) as caught:
            self._as_accountant(flip)
        frappe.db.rollback()

        self.assertIn("Company Bears TDS", str(caught.exception))
        self.assertEqual(self._deduction(made)[2], "Vendor")


class TestMarkAsDeposit(TdsCutUndoCase):
    def test_it_restores_the_request_and_deletes_the_tax(self):
        made = self._approved_on()

        answer = self._as(self._admin(), mark_as_deposit, made.name)

        self.assertEqual(answer, {"deduction": made.deduction, "amount": 10000.0})
        self.assertEqual(self._payment(made), (10000, None, "Approved"))
        self.assertIsNone(self._deduction(made))

    def test_once_paid_the_work_order_reads_the_request_paid_and_no_tax(self):
        made = self._approved_on()
        self._as(self._admin(), mark_as_deposit, made.name)
        self._mark_paid(made)

        self.assertEqual(self._figures(made), (10000, 0, 0))
        self.assertNotIn(made.name, get_work_order_tds(made.service_request)["payments"])

    def test_the_endpoint_commits_its_own_work(self):
        made = self._approved_on()
        self._as(self._admin(), mark_as_deposit, made.name)
        frappe.db.rollback()
        self.assertEqual(self._payment(made)[:2], (10000, None))
        self.assertIsNone(self._deduction(made))

    def test_after_company_bears_tds_it_removes_the_tds_and_keeps_the_request(self):
        made = self._approved_on()
        self._as(self._admin(), company_bears_tds, made.name)

        answer = self._as(self._admin(), mark_as_deposit, made.name)

        self.assertEqual(answer, {"deduction": made.deduction, "amount": 10000.0})
        self.assertEqual(self._payment(made), (10000, None, "Approved"))
        self.assertIsNone(self._deduction(made))

    def test_on_a_work_order_whose_tds_the_company_bears_from_approval(self):
        made = self._approved_on(total=20000, categories=MISC)   # kept whole at approval: 10,000 + 200
        self._as(self._admin(), mark_as_deposit, made.name)
        self.assertEqual(self._payment(made), (10000, None, "Approved"))
        self.assertIsNone(self._deduction(made))

    def test_company_borne_tds_on_a_reconciliation_pending_payment_is_removed(self):
        """No payment figure moves, so the money being out doesn't matter until the payment is Paid."""
        made = self._approved_on()
        self._as(self._admin(), company_bears_tds, made.name)
        self.fx.mark_as_done(made.name)

        self._as(self._admin(), mark_as_deposit, made.name)

        self.assertEqual(self._payment(made), (10000, None, "Reconciliation Pending"))
        self.assertIsNone(self._deduction(made))

    def test_company_borne_tds_on_a_paid_payment_is_refused(self):
        """A Paid payment has neither action (owner 2026-10-27)."""
        made = self._approved_on()
        self._as(self._admin(), company_bears_tds, made.name)
        self._mark_paid(made)

        self.assertRefused(mark_as_deposit, made, says="is Paid")

        self.assertEqual(self._payment(made)[:2], (10000, made.deduction))
        self.assertEqual(self._deduction(made), (10000, 200, "Company"))
        self.assertEqual(self._figures(made), (10000, 200, 0))

    def test_company_borne_tds_already_paid_is_refused(self):
        made = self._approved_on()
        self._as(self._admin(), company_bears_tds, made.name)
        self._mark_paid(made)
        challan = self._deposit(made)

        with self.assertRaises(frappe.ValidationError) as caught:
            self._as(self._admin(), mark_as_deposit, made.name)
        frappe.db.rollback()

        self.assertIn("this TDS is already paid", str(caught.exception))
        self.assertIn(challan, str(caught.exception))
        self.assertEqual(self._deduction(made), (10000, 200, "Company"))

    def test_it_is_recorded_with_who_and_when(self):
        made = self._approved_on()
        admin = self._admin()

        self._as(admin, mark_as_deposit, made.name)

        deleted = frappe.get_all(
            "Deleted Document", filters={"deleted_doctype": PTD, "deleted_name": made.deduction},
            fields=["owner", "creation", "data"],
        )
        self.assertEqual(len(deleted), 1)
        self.assertEqual(deleted[0].owner, admin)
        self.assertEqual(flt(frappe.parse_json(deleted[0].data)["tds_amount"], 2), 200)


class TestBothAreRefused(TdsCutUndoCase):
    ACTIONS = (company_bears_tds, mark_as_deposit)

    def _unchanged(self, made):
        self.assertEqual(self._payment(made)[:2], (9800, made.deduction))
        self.assertEqual(self._deduction(made), (10000, 200, "Vendor"))

    def test_for_a_non_admin(self):
        made = self._approved_on()
        for action in self.ACTIONS:
            with self.subTest(action=action.__name__):
                with self.assertRaises(frappe.PermissionError):
                    self._as_accountant(action, made.name)
                frappe.db.rollback()
                self._unchanged(made)

    def test_once_the_money_is_out(self):
        made = self._approved_on()
        self.fx.mark_as_done(made.name)
        for action in self.ACTIONS:
            with self.subTest(action=action.__name__, status="Reconciliation Pending"):
                self.assertRefused(action, made, says="Reconciliation Pending")
        self._mark_paid(made)
        for action in self.ACTIONS:
            with self.subTest(action=action.__name__, status="Paid"):
                self.assertRefused(action, made, says="is Paid")
        self.assertEqual(self._deduction(made), (10000, 200, "Vendor"))

    def test_on_a_cheque(self):
        made = self._approved_on()
        # Planted: a cheque links its payments through the cheques service, which this suite doesn't test.
        frappe.db.set_value(PAYMENT, made.name, "cheque", "TEST-TWO-CHQ", update_modified=False)
        frappe.db.commit()
        for action in self.ACTIONS:
            with self.subTest(action=action.__name__):
                self.assertRefused(action, made, says="TEST-TWO-CHQ")
        self._unchanged(made)

    def test_once_the_tax_is_in_a_challan(self):
        made = self._approved_on()
        challan = self._empty_challan()
        self._deposited_before_this_rule(made, challan)
        for action in self.ACTIONS:
            with self.subTest(action=action.__name__):
                self.assertRefusedNaming(challan, self._as, self._admin(), action, made.name)
                self.assertRefused(action, made, says="this TDS is already paid")
        self.assertEqual(self._payment(made)[0], 9800)

    def test_company_bears_tds_when_the_company_already_bears_the_tax(self):
        made = self._approved_on(total=20000, categories=MISC)   # kept whole at approval: 10,000 + 200
        self.assertRefused(company_bears_tds, made, says="already paid by the company")
        self.assertEqual(self._payment(made)[0], 10000)
        self.assertEqual(self._deduction(made), (10000, 200, "Company"))

    def test_when_there_is_no_cut_to_undo(self):
        made = self._approved_on()
        # Planted: a vendor-borne row whose payment already stands at the gross (an old raise's back door).
        frappe.db.set_value(PAYMENT, made.name, "amount", 10000, update_modified=False)
        frappe.db.commit()
        for action in self.ACTIONS:
            with self.subTest(action=action.__name__):
                self.assertRefused(action, made, says="full request")
        self.assertEqual(self._deduction(made), (10000, 200, "Vendor"))

    def test_company_bears_tds_after_mark_as_deposit_has_no_tds(self):
        made = self._approved_on()
        self._as(self._admin(), mark_as_deposit, made.name)
        self.assertRefused(company_bears_tds, made, says="carries no TDS")
        self.assertEqual(self._payment(made)[:2], (10000, None))


class TestMutatingEndpointsArePostOnly(TdsCutUndoCase):
    def test_both_take_post_only(self):
        allowed = frappe.allowed_http_methods_for_whitelisted_func
        self.assertEqual((allowed.get(company_bears_tds), allowed.get(mark_as_deposit)), (["POST"], ["POST"]))
