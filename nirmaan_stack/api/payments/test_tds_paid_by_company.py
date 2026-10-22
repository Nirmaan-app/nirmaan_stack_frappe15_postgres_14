# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""*TDS paid by company* (#1537, spec #1528 stories 45-48).

  * Raising a payment after its tax was cut is refused, pointing to *TDS paid by company*: the raised
    figure would be read as a new net and the tax grossed up again.
  * *TDS paid by company* (Admin) marks a payment's deduction as the company's, changing no figure:
    before *Paid*, or after *Paid* while its tax is not in a challan. It recounts the Work Order and is
    recorded with who and when.
  * The Work Order's Amount Paid hover reads the recorded deductions whenever any exist.

The worked case is the decision record's (round 5): a Rs 10,000 Work Order, the vendor got Rs 10,000,
and Rs 204 of tax marked "vendor bore it" makes Amount Paid Rs 10,204 and Amount Due -Rs 204. After
*TDS paid by company*: Amount Paid Rs 10,000, Amount Due 0, project outflow still Rs 10,204.

Driven through the real doors as the role that uses them: an Admin calls the endpoint, an Accountant
edits the amount in Desk (a document save), any reader asks `get_work_order_tds`. Approval is
`ceo_approve_payment` (`TaxedWorkOrderFixture`); Paid and the deposit are `DepositedTaxCase`'s.

⚠️ RUNS AGAINST THE SITE DATABASE. Everything is `TEST-TWO-*` (purged by `TaxedWorkOrderFixture`), plus
the challans and the Accountant user `DepositedTaxCase` makes and removes.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.payments.tds_paid_by_company import mark_tds_paid_by_company
from nirmaan_stack.api.payments.work_order_tds import get_work_order_tds
from nirmaan_stack.api.tds_challan.test_deposited_tax import PAYMENT, PTD, SR, DepositedTaxCase
from nirmaan_stack.services.project_money import project_money_of
from nirmaan_stack.services.role_profiles import ADMIN_PROFILE

MISC = ["Miscellaneous Services"]


class PaidByCompanyCase(DepositedTaxCase):
    def setUp(self):
        super().setUp()
        self.project = self.fx.project()
        self.vendor = self.fx.vendor(2.0)
        # Runs before the fixture's purge (cleanups run last-in first-out), while the deductions exist.
        self.addCleanup(self._drop_deduction_versions)

    def _drop_deduction_versions(self):
        """The action writes a Version on each deduction it flips; the fixture purges only the payments'."""
        frappe.db.rollback()
        deductions = frappe.get_all(PTD, filters={"project_payment": ["in", self.fx.payments or [""]]}, pluck="name")
        if deductions:
            frappe.db.delete("Version", {"ref_doctype": PTD, "docname": ["in", deductions]})
            frappe.db.commit()

    def _admin(self):
        user = frappe.db.get_value("Nirmaan Users", {"role_profile": ADMIN_PROFILE}, "name")
        if not user:
            self.skipTest(f"no {ADMIN_PROFILE} user on this site")
        return user

    def _approved_on(self, gross, total=100000, categories=None):
        wo = self.fx.service_request(self.project, self.vendor, total=total, categories=categories)
        return self.fx.payment(gross, project=self.project, vendor=self.vendor, service_request=wo)

    def _negative_due(self):
        """The decision record's case: approved at 10,200 (cut to 9,996 + 204), then raised back to
        10,000 before the raise was refused (planted by `set_value`, as the old edit left it), and Paid."""
        # Approved within the Work Order's limit, then its total cut to 10,000 by raw write: the approval
        # re-checks the limit, so only the old edit's back door reaches the state.
        made = self._approved_on(10200, total=10200)
        frappe.db.set_value("Service Requests", frappe.db.get_value(PAYMENT, made.name, "document_name"),
                            "total_amount", 10000, update_modified=False)
        frappe.db.set_value(PAYMENT, made.name, "amount", 10000)
        self._mark_paid(made)
        return made

    def _figures(self, made):
        row = self._wo(made)
        return flt(row.amount_paid, 2), flt(row.total_tds, 2), flt(row.amount_due, 2)

    def _deduction(self, made):
        row = frappe.db.get_value(PTD, made.deduction, ["gross_amount", "tds_amount", "borne_by"], as_dict=True)
        return flt(row.gross_amount, 2), flt(row.tds_amount, 2), row.borne_by

    def _amount(self, made):
        return flt(frappe.db.get_value(PAYMENT, made.name, "amount"), 2)


class TestRaisingAPaymentAfterItsTaxWasCut(PaidByCompanyCase):
    def _raise(self, made, amount):
        def edit():
            doc = frappe.get_doc(PAYMENT, made.name)
            doc.amount = amount
            doc.save()

        self._as_accountant(edit)

    def test_it_is_refused_pointing_to_tds_paid_by_company(self):
        made = self._approved_on(10000)  # cut to 9,800 + 200

        with self.assertRaises(frappe.ValidationError) as caught:
            self._raise(made, 10000)
        frappe.db.rollback()

        self.assertIn("TDS paid by company", str(caught.exception))
        self.assertEqual(self._amount(made), 9800)
        self.assertEqual(self._deduction(made), (10000, 200, "Vendor"))

    def test_lowering_it_still_restates_the_tax(self):
        made = self._approved_on(10000)
        self._raise(made, 4900)
        frappe.db.commit()
        self.assertEqual(self._deduction(made), (5000, 100, "Vendor"))

    def test_a_payment_kept_whole_may_still_be_raised(self):
        """Its tax was never cut, so the raised figure is the new full bill, taxed on top as before."""
        made = self._approved_on(10000, categories=MISC)
        self._raise(made, 12000)
        frappe.db.commit()
        self.assertEqual(self._amount(made), 12000)
        self.assertEqual(self._deduction(made), (12000, 240, "Company"))


class TestTdsPaidByCompany(PaidByCompanyCase):
    def test_it_settles_the_negative_due_without_moving_any_figure(self):
        made = self._negative_due()
        self.assertEqual(self._figures(made), (10204, 204, -204))
        outflow = project_money_of(self.project).outflow
        admin = self._admin()

        self._as(admin, mark_tds_paid_by_company, made.name)
        frappe.db.commit()

        self.assertEqual(self._amount(made), 10000)
        self.assertEqual(self._deduction(made), (10200, 204, "Company"))
        self.assertEqual(self._figures(made), (10000, 204, 0))
        self.assertEqual(project_money_of(self.project).outflow, outflow)

    def test_the_endpoint_commits_its_own_work(self):
        made = self._negative_due()
        self._as(self._admin(), mark_tds_paid_by_company, made.name)
        frappe.db.rollback()   # what the request does after the endpoint returns: nothing is lost
        self.assertEqual(self._deduction(made)[2], "Company")
        self.assertEqual(self._figures(made), (10000, 204, 0))

    def test_it_is_recorded_with_who_and_when(self):
        made = self._negative_due()
        admin = self._admin()

        self._as(admin, mark_tds_paid_by_company, made.name)
        frappe.db.commit()

        versions = frappe.get_all(
            "Version", filters={"ref_doctype": PTD, "docname": made.deduction}, fields=["owner", "creation", "data"]
        )
        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0].owner, admin)
        self.assertTrue(versions[0].creation)
        self.assertEqual(frappe.parse_json(versions[0].data)["changed"], [["borne_by", "Vendor", "Company"]])

    def test_it_is_allowed_before_paid(self):
        made = self._approved_on(10000)

        self._as(self._admin(), mark_tds_paid_by_company, made.name)
        frappe.db.commit()

        self.assertEqual(self._amount(made), 9800)
        self.assertEqual(self._deduction(made), (10000, 200, "Company"))

    def test_it_is_refused_for_a_non_admin(self):
        made = self._negative_due()

        with self.assertRaises(frappe.PermissionError):
            self._as_accountant(mark_tds_paid_by_company, made.name)
        frappe.db.rollback()

        self.assertEqual(self._deduction(made)[2], "Vendor")
        self.assertEqual(self._figures(made), (10204, 204, -204))

    def test_it_is_refused_once_the_tax_is_in_a_challan(self):
        made = self._negative_due()
        challan = self._deposit(made)

        self.assertRefusedNaming(challan, self._as, self._admin(), mark_tds_paid_by_company, made.name)

        self.assertEqual(self._deduction(made)[2], "Vendor")

    def test_it_is_refused_when_the_tax_is_already_the_companys(self):
        made = self._approved_on(10000, categories=MISC)

        with self.assertRaises(frappe.ValidationError) as caught:
            self._as(self._admin(), mark_tds_paid_by_company, made.name)
        frappe.db.rollback()

        self.assertIn("already", str(caught.exception))

    def test_who_bore_the_tax_is_not_changed_by_hand(self):
        """Only the action flips it: an edit of the deduction in Desk is refused."""
        made = self._approved_on(10000)

        def flip():
            row = frappe.get_doc(PTD, made.deduction)
            row.borne_by = "Company"
            row.save()

        with self.assertRaises(frappe.ValidationError) as caught:
            self._as_accountant(flip)
        frappe.db.rollback()

        self.assertIn("TDS paid by company", str(caught.exception))
        self.assertEqual(self._deduction(made)[2], "Vendor")


class TestTheAmountPaidHover(PaidByCompanyCase):
    def _hover(self, made):
        answer = get_work_order_tds(made.service_request)
        return {key: answer[key] for key in ("withheld", "company", "kind")}

    def test_it_shows_company_tax_beside_amount_paid_whatever_the_categories(self):
        """An ordinary (Electrical) Work Order whose recorded deduction is company-borne."""
        made = self._negative_due()
        self._as(self._admin(), mark_tds_paid_by_company, made.name)
        frappe.db.commit()

        self.assertEqual(self._hover(made), {"withheld": 0.0, "company": 204.0, "kind": "company"})

    def test_with_nothing_paid_it_reads_the_recorded_deductions_before_the_categories(self):
        made = self._approved_on(10000)
        self._as(self._admin(), mark_tds_paid_by_company, made.name)
        frappe.db.commit()

        self.assertEqual(self._hover(made)["kind"], "company")



class TestMutatingEndpointsArePostOnly(PaidByCompanyCase):
    def test_retry_tds_and_tds_paid_by_company_take_post_only(self):
        from nirmaan_stack.api.payments.bulk_actions import retry_bulk_deductions
        allowed = frappe.allowed_http_methods_for_whitelisted_func
        self.assertEqual((allowed.get(retry_bulk_deductions), allowed.get(mark_tds_paid_by_company)), (["POST"], ["POST"]))
