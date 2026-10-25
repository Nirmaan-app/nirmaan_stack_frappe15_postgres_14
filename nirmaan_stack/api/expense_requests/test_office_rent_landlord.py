# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""No Office Rent tax is withheld without the landlord's name and PAN (spec #1522 review, S1).

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not a Technical Data Sheet.

The request endpoints refuse an Office Rent request that does not name the landlord or whose PAN is
not one, on create and on edit, and a Reviewer's approval of a request without them, at any amount,
so the request stays Pending Approval for its raiser to edit (review batch 2, F1). An Office Rent
Expense whose request carries no landlord (one raised before the server asked, or a row with no
request at all) is not approved by any step that would withhold its tax: `decide_expenses` and an
insert born Approved are refused, naming the way out (reject it and raise it again), and nothing of
the approval is written.

Runs on the fixture of `test_office_rent_tds` (one transaction, commits stubbed, rolled back).

Run:
  devenv.sh test --module nirmaan_stack.api.expense_requests.test_office_rent_landlord
"""

import json
import re

import frappe

from nirmaan_stack.api.approvals.expense_detail import get_expense_approval_detail
from nirmaan_stack.api.expense_requests.create import create_expense_request
from nirmaan_stack.api.expense_requests.review import approve_expense_request
from nirmaan_stack.api.expense_requests.test_office_rent_tds import (
    ADMIN,
    HR,
    NPE,
    OFFICE_RENT,
    TDS,
    OfficeRentCase,
    _rent_answers,
)
from nirmaan_stack.api.expense_requests.test_records_without_review import _write_list
from nirmaan_stack.api.expense_requests.update import update_expense_request
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services import expense_request_routing as routing

# An Expense whose request can no longer be edited (or that has none): the way out is a new request.
REFUSAL = ("This Office Rent expense has no landlord's name and PAN, so its TDS cannot be filed and it "
           "cannot be approved. Reject it and raise it again with the landlord's name and PAN.")
# A request still Pending Approval: its raiser can edit it, so the request's own refusal is given.
REQUEST_REFUSAL = re.escape("Office Rent needs the landlord's name and the landlord's PAN")


class TestTheLandlordIsRequired(OfficeRentCase):
    # -- helpers --------------------------------------------------------------------------------
    def _raise_as_hr(self, amount, **answers) -> dict:
        frappe.set_user(HR)
        try:
            return create_expense_request(expense_type=OFFICE_RENT, amount=amount,
                                          source_data=_rent_answers(**answers))
        finally:
            frappe.set_user("Administrator")

    def _for_review(self):
        """HR's requests wait for a Reviewer instead of becoming their Expense on submit."""
        _write_list([])
        routing.clear_cache()

    def _forget_the_landlord(self, request):
        # A fixture write: the request as one raised before the server asked for the landlord.
        frappe.db.set_value("Expense Request", request, "source_data",
                            json.dumps(_rent_answers(landlord_name="", landlord_pan="")), update_modified=False)

    def _hr_requests(self) -> int:
        return frappe.db.count("Expense Request", {"owner": HR})

    # -- the request names the landlord -----------------------------------------------------------
    def test_a_request_without_the_landlords_name_or_pan_is_refused_and_nothing_is_written(self):
        before = self._hr_requests()
        for answers in ({"landlord_name": ""}, {"landlord_pan": ""}, {"landlord_name": " ", "landlord_pan": " "}):
            with self.subTest(answers=answers):
                with self.assertRaisesRegex(frappe.ValidationError, "landlord"):
                    self._raise_as_hr(100000, **answers)
                self.assertEqual(self._hr_requests(), before)

    def test_an_edit_that_drops_the_landlord_is_refused(self):
        self._for_review()
        request = self._raise_as_hr(100000)["name"]
        for answers in ({"landlord_name": ""}, {"landlord_pan": ""}):
            with self.subTest(answers=answers):
                frappe.set_user(HR)
                try:
                    with self.assertRaisesRegex(frappe.ValidationError, "landlord"):
                        update_expense_request(request, expense_type=OFFICE_RENT, amount=100000,
                                               source_data=_rent_answers(**answers))
                finally:
                    frappe.set_user("Administrator")
        detail = json.loads(frappe.db.get_value("Expense Request", request, "source_data"))["responses"]["detail"]
        self.assertEqual((detail["landlord_name"], detail["landlord_pan"]), ("Asha Rao", "ABCPK1234D"))

    # -- no approval withholds without it ---------------------------------------------------------
    def test_the_approval_that_would_withhold_is_refused_and_nothing_is_written(self):
        request, name = self._raise(100000)
        self._forget_the_landlord(request)
        # Admin's step forwards Rs 1,00,000 to the CEO and withholds nothing, so it is not refused.
        self.assertEqual(self._decide(ADMIN, name, "l1_approve")["statuses"], {name: "CEO Pending"})

        result = self._decide(CEO_AUTHORIZED_USER, name, "ceo_approve")

        self.assertEqual(result["succeeded"], [])
        self.assertEqual([f["reason"] for f in result["failed"]], [REFUSAL])
        self.assertEqual(self._expense(name), {"status": "CEO Pending", "amount": 100000})
        self.assertEqual(self._records(name), [])
        self.assertIsNone(frappe.db.get_value(NPE, name, "ceo_approval_date"))

    def test_an_l1_approval_landing_on_approved_is_refused_too(self):
        request, name = self._raise(30000)
        self._forget_the_landlord(request)

        result = self._decide(ADMIN, name, "l1_approve")

        self.assertEqual([f["reason"] for f in result["failed"]], [REFUSAL])
        self.assertEqual(self._expense(name), {"status": "Requested", "amount": 30000})
        self.assertEqual(self._records(name), [])

    def test_a_reviewers_approval_without_the_landlord_is_refused_and_the_request_stays_pending(self):
        # Rs 12,000 would create the Expense Approved (and withhold); Rs 1,00,000 would create it at
        # Requested, an Expense no later step could ever approve. Both are refused at the review.
        self._for_review()
        for amount in (12000, 100000):
            with self.subTest(amount=amount):
                request = self._raise_as_hr(amount)["name"]
                self._forget_the_landlord(request)
                records = frappe.db.count(TDS)

                with self.assertRaisesRegex(frappe.ValidationError, REQUEST_REFUSAL):
                    approve_expense_request(request)

                self.assertEqual(frappe.db.get_value("Expense Request", request, ["status", "reviewed_by"]),
                                 ("Pending Approval", None))
                self.assertEqual(frappe.get_all(NPE, filters={"request_id": request}), [])
                self.assertEqual(frappe.db.count(TDS), records)

    def test_once_its_raiser_adds_the_landlord_the_reviewer_approves_it(self):
        self._for_review()
        request = self._raise_as_hr(100000)["name"]
        self._forget_the_landlord(request)
        with self.assertRaisesRegex(frappe.ValidationError, REQUEST_REFUSAL):
            approve_expense_request(request)

        frappe.set_user(HR)
        try:
            update_expense_request(request, expense_type=OFFICE_RENT, amount=100000, source_data=_rent_answers())
        finally:
            frappe.set_user("Administrator")
        created = approve_expense_request(request)["created_expense"]

        self.assertEqual(self._expense(created), {"status": "CEO Pending", "amount": 100000})

    def test_a_row_with_no_request_is_not_born_approved(self):
        before = frappe.db.count(NPE, {"type": OFFICE_RENT})
        doc = frappe.new_doc(NPE)
        # Administrator is L1, so Rs 12,000 is born Approved: the insert that would withhold.
        doc.update({"type": OFFICE_RENT, "amount": 12000, "description": "xrtds rent with no request"})

        with self.assertRaisesRegex(frappe.ValidationError, re.escape(REFUSAL)):
            doc.insert(ignore_permissions=True)

        self.assertEqual(frappe.db.count(NPE, {"type": OFFICE_RENT}), before)

    def test_the_approve_dialog_is_told_when_the_landlord_is_missing(self):
        request, name = self._raise(100000)
        missing = lambda: get_expense_approval_detail(doctype=NPE, name=name)["deductee_missing"]  # noqa: E731
        self.assertFalse(missing())

        self._forget_the_landlord(request)
        self.assertTrue(missing())
        self._decide(ADMIN, name, "l1_approve")
        self.assertTrue(missing(), "at CEO Pending too")

    def test_with_the_landlord_the_approval_withholds_as_before(self):
        _request, name = self._raise(30000)

        self.assertEqual(self._decide(ADMIN, name, "l1_approve")["statuses"], {name: "Approved"})

        self.assertEqual(self._expense(name), {"status": "Approved", "amount": 27000})
        [record] = self._records(name)
        self.assertEqual((record.deductee_name, record.deductee_pan), ("Asha Rao", "ABCPK1234D"))
