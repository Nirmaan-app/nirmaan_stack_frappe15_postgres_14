# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The request page's "Where it stands" steps (spec #1494, ticket #1500). Pure: no site, no DB.

Run:
  devenv.sh unit nirmaan_stack.services.test_expense_standing
"""

import unittest

from nirmaan_stack.services.expense_standing import live_status, where_it_stands

PM = "pm@example.com"
HR = "hr@example.com"


def _request(status="Approved", amount=30000, reviewed_by=HR, review_comment=None):
    return {
        "status": status, "amount": amount, "owner": PM, "creation": "2026-10-01 10:00:00",
        "reviewed_by": reviewed_by, "reviewed_on": "2026-10-02 10:00:00" if reviewed_by else None,
        "review_comment": review_comment,
    }


def _expense(status, amount=30000, auto_approved=0, approval_date=None, ceo_approval_date=None,
             payment_date=None):
    return {
        "status": status, "amount": amount, "auto_approved": auto_approved,
        "approval_date": approval_date, "ceo_approval_date": ceo_approval_date, "payment_date": payment_date,
    }


def _states(steps):
    return [(s["key"], s["state"]) for s in steps]


class TestWhereItStands(unittest.TestCase):
    def test_a_request_waiting_for_review_shows_every_step_still_ahead(self):
        steps = where_it_stands(_request("Pending Approval", 80000, reviewed_by=None), None, None)
        self.assertEqual(_states(steps), [
            ("raised", "done"), ("review", "current"), ("admin", "upcoming"), ("ceo", "upcoming"),
            ("paid", "upcoming"),
        ])
        self.assertEqual(steps[0]["by"], PM)

    def test_a_small_request_waiting_for_review_needs_no_admin_or_ceo(self):
        steps = where_it_stands(_request("Pending Approval", 9000, reviewed_by=None), None, None)
        self.assertEqual(_states(steps), [("raised", "done"), ("review", "current"), ("paid", "upcoming")])

    def test_no_further_approval_goes_straight_to_payment(self):
        expense = _expense("Approved", 9000, auto_approved=1, approval_date="2026-10-02",
                           ceo_approval_date="2026-10-02")
        steps = where_it_stands(_request(amount=9000), expense, None)
        self.assertEqual(_states(steps), [("raised", "done"), ("review", "done"), ("paid", "current")])
        self.assertEqual(steps[1]["by"], HR)

    def test_admin_next(self):
        steps = where_it_stands(_request(), _expense("Requested"), None)
        self.assertEqual(_states(steps), [
            ("raised", "done"), ("review", "done"), ("admin", "current"), ("paid", "upcoming"),
        ])

    def test_ceo_next(self):
        expense = _expense("CEO Pending", 80000, approval_date="2026-10-03")
        steps = where_it_stands(_request(amount=80000), expense, None)
        self.assertEqual(_states(steps), [
            ("raised", "done"), ("review", "done"), ("admin", "done"), ("ceo", "current"), ("paid", "upcoming"),
        ])
        self.assertEqual(steps[2]["on"], "2026-10-03")

    def test_an_l1_reject_ends_the_steps_at_admin(self):
        steps = where_it_stands(_request("Rejected", 80000), _expense("Rejected", 80000), None)
        self.assertEqual(_states(steps), [("raised", "done"), ("review", "done"), ("admin", "rejected")])

    def test_a_ceo_reject_ends_the_steps_at_the_ceo(self):
        expense = _expense("Rejected", 80000, approval_date="2026-10-03")
        steps = where_it_stands(_request("Rejected", 80000), expense, None)
        self.assertEqual(_states(steps), [
            ("raised", "done"), ("review", "done"), ("admin", "done"), ("ceo", "rejected"),
        ])

    def test_a_reject_at_review_ends_the_steps_there_with_its_reason(self):
        steps = where_it_stands(_request("Rejected", review_comment="no bill"), None, None)
        self.assertEqual(_states(steps), [("raised", "done"), ("review", "rejected")])
        self.assertEqual(steps[1]["note"], "no bill")

    def test_a_request_approved_on_submit_shows_that_in_place_of_review(self):
        request = {**_request(amount=40000, reviewed_by=None), "approved_on_submit": 1}
        steps = where_it_stands(request, _expense("Requested", 40000), None)
        self.assertEqual(_states(steps), [
            ("raised", "done"), ("review", "done"), ("admin", "current"), ("paid", "upcoming"),
        ])
        self.assertEqual(steps[1]["label"], "Approved on submit (no review)")

    def test_an_admins_own_expense_shows_no_admin_step(self):
        expense = _expense("Approved", 40000, approval_date="2026-10-01")
        steps = where_it_stands({**_request(amount=40000, reviewed_by=None), "approved_on_submit": 1},
                                expense, "l1")
        self.assertEqual(_states(steps), [("raised", "done"), ("review", "done"), ("paid", "current")])

    def test_an_admins_review_is_the_admin_step(self):
        expense = _expense("CEO Pending", 80000, approval_date="2026-10-02")
        steps = where_it_stands(_request(amount=80000), expense, None, reviewer_is_l1=True)
        self.assertEqual(_states(steps), [
            ("raised", "done"), ("review", "done"), ("ceo", "current"), ("paid", "upcoming"),
        ])

    def test_a_raiser_who_is_l1_skips_the_admin_step_ahead(self):
        steps = where_it_stands(_request("Pending Approval", 40000, reviewed_by=None), None, "l1")
        self.assertEqual(_states(steps), [("raised", "done"), ("review", "current"), ("paid", "upcoming")])

    def test_payment_is_current_until_paid_and_done_after(self):
        approved = where_it_stands(_request(), _expense("Approved", approval_date="2026-10-03"), None)
        self.assertEqual(approved[-1]["state"], "current")
        pending = where_it_stands(_request(), _expense("Reconciliation Pending", approval_date="2026-10-03"), None)
        self.assertEqual(pending[-1]["state"], "current")
        self.assertIn("bank", pending[-1]["note"])
        paid = where_it_stands(_request("Paid"), _expense("Paid", approval_date="2026-10-03",
                                                          payment_date="2026-10-05"), None)
        self.assertEqual((paid[-1]["state"], paid[-1]["on"]), ("done", "2026-10-05"))


class TestLiveStatus(unittest.TestCase):
    def test_the_expense_status_wins_once_there_is_one(self):
        self.assertEqual(live_status("Approved", "Requested"), "Waiting for Admin")
        self.assertEqual(live_status("Approved", "Reconciliation Pending"), "Reconciliation Pending")

    def test_without_an_expense_the_request_status_shows(self):
        self.assertEqual(live_status("Pending Approval", None), "Pending Approval")


if __name__ == "__main__":
    unittest.main()
