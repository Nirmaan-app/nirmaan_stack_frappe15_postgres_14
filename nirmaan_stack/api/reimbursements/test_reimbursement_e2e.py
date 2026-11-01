# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Reimbursements end to end through the doors people use (ADR-0040), after the merge with develop's one
expense decision call (`api/approvals/expense_actions.decide_expenses`, spec #1494).

`test_reimbursements` pins each rule on its own and moves the expense with a plain save. These walk one claim
from raise to its ending the way the screens do: the claimant raises it, HR or Admin decides it, the expense
shows in the Approve Payments queue as a Reimbursement, Admin / the CEO / Accounts move it with
`decide_expenses`, and the claim follows. Half the cases try to break that: the wrong person, the wrong
status, a missing reason or payment, paying twice, a revived rejection.

⚠️ LIVE localhost site: the fixtures and the purge are `test_reimbursements`' (`reimb_test_` users, fake
storage); the CEO is the real `CEO_AUTHORIZED_USER`, used only to decide, and the CEO cases skip when that
user is not on the site. `decide_expenses` commits, so everything is removed by the shared purge at class end.

Run:
  bench --site localhost run-tests --module nirmaan_stack.api.reimbursements.test_reimbursement_e2e
"""

from __future__ import annotations

import frappe
from frappe.utils import flt, nowdate

from nirmaan_stack.api.approvals import expense_actions, get_approval_queue
from nirmaan_stack.api.payees import paid_to as paid_to_api
from nirmaan_stack.api.payments.bulk_actions import MAX_BATCH_SIZE
from nirmaan_stack.api.reimbursements import claims, review
from nirmaan_stack.api.reimbursements import test_reimbursements as base
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.reimbursements import convert
from nirmaan_stack.services.reimbursements.rules import APPROVED, PAID, REJECTED

NPE = base.NPE
PM, HR, ADMIN, ACC = base.PM, base.HR, base.ADMIN, base.ACC
CEO = CEO_AUTHORIZED_USER


class _EndToEndCase(base.ReimbursementTestCase):
    """The doors the screens use, as helpers. No tests of its own."""

    def approve(self, approver, amount=1450, claimant=PM):
        """Raise and approve one claim on an empty month, so it routes by its own amount (`fresh_month`); the
        monthly-limit warning is ticked."""
        self.fresh_month()
        name = self.raise_claim(claimant, amount=amount)
        reply = self.as_user(approver, review.approve_reimbursement, name, acknowledged=1)
        self.assertEqual(reply["status"], APPROVED)
        self.assertEqual(reply["expense"], convert.expense_of(name))
        return name, reply["expense"]

    def decide(self, user, expense, action, **kw) -> dict:
        """`decide_expenses` as `user`, the call Approve Payments and the accountant tabs make."""
        return self.as_user(user, expense_actions.decide_expenses, expense_ids=[expense], action=action, **kw)["data"]

    def assert_moved(self, data, expense, status):
        self.assertEqual(data["failed"], [], data["failed"])
        self.assertEqual(data["statuses"], {expense: status})

    def assert_refused(self, data, expense, *words) -> str:
        self.assertEqual(data["succeeded"], [])
        self.assertEqual([f["name"] for f in data["failed"]], [expense])
        reason = data["failed"][0]["reason"]
        for word in words:
            self.assertIn(word, reason)
        return reason

    def payment(self, ref="UTR-REIMB-E2E-1") -> dict:
        return {"payment_date": nowdate(), "payment_ref": ref,
                "payment_attachment": self.storage.loose(ACC, "utr.pdf", base._pdf())}

    def queue_row(self, user, expense):
        """The expense's row in the Approve Payments queue as `user` sees it, or None."""
        reply = self.as_user(user, get_approval_queue.get_approval_queue, filters=[["name", "=", expense]])
        rows = [r for r in reply["data"] if r["name"] == expense]
        return rows[0] if rows else None

    def claim(self, name):
        return frappe.db.get_value("Reimbursement", name, ["status", "rejection_reason", "approved_by"], as_dict=True)

    def expense_status(self, expense):
        return frappe.db.get_value(NPE, expense, "status")

    def need_ceo(self):
        if not frappe.db.exists("User", CEO):
            self.skipTest("the CEO user is not on this site")


class TestReimbursementEndToEnd(_EndToEndCase):
    # --- the paths a claim takes to Paid ---------------------------------------------------------

    def test_a_small_claim_goes_from_raise_to_paid_through_payments(self):
        name, expense = self.approve(HR, amount=1450)
        self.assertEqual(self.expense_status(expense), "Approved")  # HR's approval: the auto band

        row = self.queue_row(ACC, expense)
        self.assertIsNotNone(row, "Accounts must see the expense in the Approve Payments queue")
        self.assertEqual((row["source"], row["source_type"]), ("Non-Project", "Reimbursement"))
        self.assertEqual(flt(row["amount"]), 1450)
        self.assertEqual(row["raised_by"], PM)  # the claimant, not the approver

        self.assert_moved(self.decide(ACC, expense, "mark_done"), expense, "Reconciliation Pending")
        self.assertEqual(self.claim(name).status, APPROVED)  # only the endings move a claim

        self.assert_moved(self.decide(ACC, expense, "mark_paid", payment=self.payment()), expense, "Paid")
        self.assertEqual(self.claim(name).status, PAID)

        paid = self.as_user(PM, claims.get_claim_payments, [name])[name]
        self.assertEqual((paid["expense"], paid["status"], paid["payment_ref"]), (expense, "Paid", "UTR-REIMB-E2E-1"))

        # A paid claim is closed to its claimant.
        payee = self.account(PM)
        with self.assertRaises(frappe.ValidationError):
            self.as_user(PM, claims.update_reimbursement, name, "Changed", 1450, payee, reimbursement_type="Travel")
        with self.assertRaises(frappe.ValidationError):
            self.as_user(PM, claims.delete_reimbursement, name)

    def test_an_admin_approved_claim_is_paid_straight_from_approved(self):
        name, expense = self.approve(ADMIN, amount=30000)
        self.assertEqual(self.expense_status(expense), "Approved")  # Admin's approval clears L1 up to 50,000
        self.assertEqual(self.claim(name).approved_by, ADMIN)
        self.assert_moved(self.decide(ACC, expense, "mark_paid", payment=self.payment()), expense, "Paid")
        self.assertEqual(self.claim(name).status, PAID)

    def test_a_large_claim_waits_for_the_ceo_then_is_paid(self):
        self.need_ceo()
        name, expense = self.approve(ADMIN, amount=80000)
        self.assertEqual(self.expense_status(expense), "CEO Pending")
        self.assertEqual(self.queue_row(ADMIN, expense)["source_type"], "Reimbursement")

        # Nobody but the CEO clears it, and it can't be paid before.
        self.assert_refused(self.decide(ADMIN, expense, "ceo_approve"), expense, "CEO")
        self.assert_refused(self.decide(ACC, expense, "ceo_approve"), expense, "CEO")
        self.assert_refused(self.decide(ACC, expense, "mark_paid", payment=self.payment()), expense, "CEO Pending")
        self.assertEqual((self.expense_status(expense), self.claim(name).status), ("CEO Pending", APPROVED))

        self.assert_moved(self.decide(CEO, expense, "ceo_approve"), expense, "Approved")
        self.assertEqual(self.claim(name).status, APPROVED)
        self.assert_moved(self.decide(ACC, expense, "mark_paid", payment=self.payment()), expense, "Paid")
        self.assertEqual(self.claim(name).status, PAID)

    def test_the_monthly_limit_is_reached_at_2000_and_hr_then_hands_the_claim_to_l1_in_payments(self):
        """ADR-0040 Amendment B, through the doors the screens use: HR approves, the expense waits in the queue as a
        Reimbursement, Admin approves it there with `decide_expenses`, and it is paid like any other."""
        under, expense = self.approve(HR, amount=1999)
        self.assertEqual((self.claim(under).status, self.expense_status(expense)), (APPROVED, "Approved"))

        above = self.raise_claim(PM, amount=1)  # the month comes to exactly ₹2,000: the limit is reached
        with self.assertRaises(frappe.ValidationError):
            self.as_user(HR, review.approve_reimbursement, above)  # the warning was not ticked
        self.assertIsNone(convert.expense_of(above))  # a refused approval leaves no expense behind
        self.as_user(HR, review.approve_reimbursement, above, acknowledged=1)
        waiting = convert.expense_of(above)
        self.assertEqual(self.expense_status(waiting), "Requested")
        self.assertEqual(self.queue_row(ADMIN, waiting)["source_type"], "Reimbursement")
        self.assert_refused(self.decide(ACC, waiting, "mark_paid", payment=self.payment()), waiting, "Requested")

        self.assert_moved(self.decide(ADMIN, waiting, "l1_approve"), waiting, "Approved")
        self.assertEqual(self.claim(above).status, APPROVED)
        self.assert_moved(self.decide(ACC, waiting, "mark_paid", payment=self.payment()), waiting, "Paid")
        self.assertEqual(self.claim(above).status, PAID)

    # --- rejected in Payments ----------------------------------------------------------------------

    def test_a_ceo_rejection_in_payments_rejects_the_claim_and_it_can_never_be_paid(self):
        self.need_ceo()
        name, expense = self.approve(ADMIN, amount=80000)
        self.assert_moved(self.decide(CEO, expense, "reject", reason="  Bill is for a personal trip "), expense,
                          "Rejected")
        claim = self.claim(name)
        self.assertEqual((claim.status, claim.rejection_reason), (REJECTED, "Bill is for a personal trip"))
        comments = frappe.get_all("Comment", {"reference_doctype": NPE, "reference_name": expense,
                                              "comment_type": "Comment"}, pluck="content")
        self.assertTrue(any("Bill is for a personal trip" in c for c in comments), comments)

        # Rejected is final: no decision moves it, and the claim stays Rejected.
        for user, action, kw in ((ACC, "mark_paid", {"payment": self.payment()}), (ACC, "mark_done", {}),
                                 (CEO, "ceo_approve", {}), (ADMIN, "l1_approve", {})):
            with self.subTest(action):
                self.assert_refused(self.decide(user, expense, action, **kw), expense, "Rejected")
        self.assertEqual((self.expense_status(expense), self.claim(name).status), ("Rejected", REJECTED))

        # The claimant clears it away from Reimbursements: the claim and its Rejected expense go together
        # (owner, 2026-10-27).
        self.as_user(PM, claims.delete_reimbursement, name)
        self.assertFalse(frappe.db.exists("Reimbursement", name))
        self.assertFalse(frappe.db.exists(NPE, expense))

    def test_a_reject_without_a_reason_is_refused_and_nothing_moves(self):
        self.need_ceo()
        name, expense = self.approve(ADMIN, amount=80000)
        for reason in (None, "", "   "):
            with self.subTest(reason=reason), self.assertRaises(frappe.ValidationError):
                self.decide(CEO, expense, "reject", reason=reason)
        self.assertEqual((self.expense_status(expense), self.claim(name).status), ("CEO Pending", APPROVED))

    def test_only_the_ceo_rejects_a_ceo_pending_reimbursement(self):
        name, expense = self.approve(ADMIN, amount=80000)
        for user in (ADMIN, ACC, PM, HR):
            with self.subTest(user):
                self.assert_refused(self.decide(user, expense, "reject", reason="no"), expense)
        self.assertEqual((self.expense_status(expense), self.claim(name).status), ("CEO Pending", APPROVED))

    # --- paying it wrong --------------------------------------------------------------------------

    def test_mark_paid_needs_the_payment_details_and_a_refusal_leaves_the_claim_approved(self):
        name, expense = self.approve(HR)
        reason = self.assert_refused(self.decide(ACC, expense, "mark_paid", payment={"payment_ref": "UTR-X"}),
                                     expense, "Mark as Paid needs")
        self.assertIn("Payment Date", reason)
        self.assertEqual((self.expense_status(expense), self.claim(name).status), ("Approved", APPROVED))
        self.assertFalse(frappe.db.get_value(NPE, expense, "payment_ref"))  # refused writes nothing

    def test_a_paid_expense_cannot_be_paid_again(self):
        name, expense = self.approve(HR)
        self.assert_moved(self.decide(ACC, expense, "mark_paid", payment=self.payment("UTR-FIRST")), expense, "Paid")
        self.assert_refused(self.decide(ACC, expense, "mark_paid", payment=self.payment("UTR-SECOND")), expense,
                            "Paid")
        self.assertEqual(frappe.db.get_value(NPE, expense, "payment_ref"), "UTR-FIRST")
        self.assertEqual(self.claim(name).status, PAID)

    def test_the_claimant_and_hr_cannot_pay_a_claim(self):
        name, expense = self.approve(HR)
        for user in (PM, HR):
            with self.subTest(user):
                self.assert_refused(self.decide(user, expense, "mark_paid", payment=self.payment()), expense,
                                    "Admin or Accounts")
        self.assertEqual((self.expense_status(expense), self.claim(name).status), ("Approved", APPROVED))

    def test_a_typed_in_status_cannot_pay_a_claim(self):
        """A person's own save (Desk, REST) can't move the status: only `decide` does (story 42)."""
        name, expense = self.approve(HR)
        doc = frappe.get_doc(NPE, expense)
        doc.status = "Paid"
        with self.assertRaises(frappe.ValidationError):
            self.as_user(ACC, doc.save)
        self.assertEqual((self.expense_status(expense), self.claim(name).status), ("Approved", APPROVED))

    # --- who sees it ------------------------------------------------------------------------------

    def test_the_claimant_follows_the_payment_of_their_own_claim_only(self):
        """Through the claim (`get_claim_payments`), never the ledgers: whether a role may read the payments
        queue is that doctype's own permission, not this feature's (2026-10-27: on localhost a Project Manager
        reads every Non-Project Expense, reimbursements included)."""
        name, expense = self.approve(HR)
        self.assertEqual(self.as_user(PM, claims.get_claim_payments, [name])[name]["status"], "Approved")
        # Someone else's claim is not theirs to follow.
        other, _ = self.approve(HR, claimant=base.PM2)
        self.assertNotIn(other, self.as_user(PM, claims.get_claim_payments, [name, other]))

    # --- develop's own expenses are unchanged -----------------------------------------------------

    def test_an_ordinary_non_project_expense_still_routes_by_its_raiser(self):
        """`apply_starting_status` now asks `routing_raiser`; without a claim that is `expense_raiser`, as before."""
        cases = ((PM, 20000, "Requested"), (PM, 1000, "Approved"), (ADMIN, 20000, "Approved"),
                 (ADMIN, 80000, "CEO Pending"))
        for raiser, amount, expected in cases:
            with self.subTest(raiser=raiser, amount=amount):
                doc = frappe.get_doc({"doctype": NPE, "amount": amount, "description": "reimb_test ordinary expense"})
                self.as_user(raiser, doc.insert, ignore_permissions=True)
                self.assertEqual(doc.status, expected)
                self.assertFalse(doc.reimbursement)
                self.assertEqual(self.queue_row(ADMIN, doc.name)["source_type"], "Non-Project")


class TestTheTypeFilterCountsAReimbursementAsNonProject(_EndToEndCase):
    """A reimbursement's expense shows as a Non Project Expense with a Reimbursement tag, so the Type filter and
    its counts treat it as one; "Reimbursement" alone still narrows to claims."""

    def rows(self, expense, op, types):
        filters = [["name", "=", expense], ["source_type", op, types]]
        reply = self.as_user(ADMIN, get_approval_queue.get_approval_queue, filters=filters)
        return [r["name"] for r in reply["data"]]

    def test_picking_non_project_keeps_the_reimbursement_and_leaving_it_out_drops_it(self):
        _, expense = self.approve(HR)
        cases = (
            ("in", ["Non-Project"], [expense]),
            ("=", "Non-Project", [expense]),
            ("in", ["Reimbursement"], [expense]),
            ("in", ["PO Payment", "Non-Project"], [expense]),
            ("not in", ["Non-Project"], []),
            ("!=", "Non-Project", []),
            ("in", ["Project Expense"], []),
            ("not in", ["Reimbursement"], []),
        )
        for op, types, expected in cases:
            with self.subTest(op=op, types=types):
                self.assertEqual(self.rows(expense, op, types), expected)

    def test_the_non_project_count_includes_the_reimbursement(self):
        _, expense = self.approve(HR)
        ordinary = frappe.get_doc({"doctype": NPE, "amount": 1000, "description": "reimb_test ordinary expense"})
        self.as_user(PM, ordinary.insert, ignore_permissions=True)
        reply = self.as_user(ADMIN, get_approval_queue.get_approval_queue_facets, "source_type",
                             filters=[["name", "in", [expense, ordinary.name]]])
        self.assertEqual({v["value"]: v["count"] for v in reply["values"]}, {"Non-Project": 2, "Reimbursement": 1})

    def test_a_claim_alone_still_offers_non_project(self):
        _, expense = self.approve(HR)
        reply = self.as_user(ADMIN, get_approval_queue.get_approval_queue_facets, "source_type",
                             filters=[["name", "=", expense]])
        self.assertEqual(reply["values"], [{"value": "Non-Project", "count": 1}, {"value": "Reimbursement", "count": 1}])


class TestReimbursementBulkActions(_EndToEndCase):
    """The Project Payments bulk bars with reimbursements ticked among ordinary expenses.

    What the screens send (`useBulkApprovalActions`, `AccountantTabs.handleMarkPaid`): the ticks are split by
    ledger and every expense, a reimbursement's included, goes in ONE `decide_expenses` call -- `l1_approve`
    (lead tab), `ceo_approve` (CEO tab), `reject` with one reason for all, `mark_done` (bulk Mark as Paid, after
    `get_paid_to` re-reads who each row is paid to). Reconciliation Pending -> Paid is the per-row Record
    Payment (`mark_paid`). PO / WO payments go to their own engine and never share a call with an expense, so
    they are not ticked here.
    """

    #: Ordinary Non-Project Expenses made here; the shared purge removes them by description, and their
    #: rejection comments are removed below (the purge only clears a reimbursement's).
    _ordinary: list[str] = []

    #: Expense Requests made here (raw inserts, as develop's request tests make them); removed below.
    _requests: list[str] = []

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        if cls._ordinary:
            frappe.db.delete("Comment", {"reference_doctype": NPE, "reference_name": ["in", cls._ordinary]})
        if cls._requests:
            frappe.db.delete("Nirmaan Notifications", {"document": "Expense Request", "docname": ["in", cls._requests]})
            frappe.db.delete("Expense Request", {"name": ["in", cls._requests]})
        frappe.db.commit()
        super().tearDownClass()

    def request_born(self, amount, status) -> tuple[str, str]:
        """An Expense Request PM raised and a reviewer approved, and its Expense at `status`: `(request, expense)`.
        Raw inserts, as `api/expense_requests/test_request_standing` makes them."""
        request = frappe.new_doc("Expense Request")
        request.update({"amount": amount, "status": "Approved", "review_comment": None})
        request.name = f"reimb-test-er-{frappe.generate_hash(length=10)}"
        request.db_insert()
        frappe.db.set_value("Expense Request", request.name, "owner", PM, update_modified=False)
        expense = frappe.new_doc(NPE)
        expense.update({"amount": amount, "status": status, "request_id": request.name,
                        "description": "reimb_test request-born expense"})
        expense.name = f"reimb-test-npe-{frappe.generate_hash(length=10)}"
        expense.owner = ADMIN
        expense.db_insert()
        frappe.db.commit()
        TestReimbursementBulkActions._requests.append(request.name)
        TestReimbursementBulkActions._ordinary.append(expense.name)
        return request.name, expense.name

    def ordinary(self, raiser, amount) -> str:
        """An ordinary Non-Project Expense `raiser` raised (no claim, no account); returns its name."""
        doc = frappe.get_doc({"doctype": NPE, "amount": amount, "description": "reimb_test bulk ordinary expense"})
        self.as_user(raiser, doc.insert, ignore_permissions=True)
        frappe.db.commit()
        TestReimbursementBulkActions._ordinary.append(doc.name)
        return doc.name

    def decide_many(self, user, names, action, **kw) -> dict:
        """One bulk click: every ticked expense in one `decide_expenses`, as `useBulkApprovalActions` sends it."""
        return self.as_user(user, expense_actions.decide_expenses, expense_ids=names, action=action, **kw)["data"]

    def statuses(self, *names):
        return [self.expense_status(n) for n in names]

    def claims_status(self, *names):
        return [self.claim(n).status for n in names]

    # --- bulk approval ----------------------------------------------------------------------------

    def test_ceo_bulk_approve_clears_reimbursements_ticked_with_ordinary_expenses(self):
        self.need_ceo()
        c1, r1 = self.approve(ADMIN, amount=80000)
        c2, r2 = self.approve(ADMIN, amount=60000)
        o1 = self.ordinary(ADMIN, 70000)
        self.assertEqual(self.statuses(r1, r2, o1), ["CEO Pending"] * 3)

        data = self.decide_many(CEO, [r1, o1, r2], "ceo_approve")
        self.assertEqual(data["failed"], [])
        self.assertEqual(data["statuses"], {r1: "Approved", r2: "Approved", o1: "Approved"})
        self.assertEqual(self.claims_status(c1, c2), [APPROVED, APPROVED])  # approval is not an ending
        self.assertEqual(self.queue_row(ACC, r1)["source_type"], "Reimbursement")

    def test_ceo_bulk_reject_gives_every_claim_in_the_batch_the_one_reason(self):
        self.need_ceo()
        c1, r1 = self.approve(ADMIN, amount=80000)
        c2, r2 = self.approve(ADMIN, amount=60000)
        o1 = self.ordinary(ADMIN, 70000)

        data = self.decide_many(CEO, [r1, r2, o1], "reject", reason=" Raised twice this month ")
        self.assertEqual(sorted(data["succeeded"]), sorted([r1, r2, o1]))
        for claim in (c1, c2):
            with self.subTest(claim):
                row = self.claim(claim)
                self.assertEqual((row.status, row.rejection_reason), (REJECTED, "Raised twice this month"))
        self.assertEqual(self.statuses(r1, r2, o1), ["Rejected"] * 3)
        commented = frappe.get_all("Comment", {"reference_doctype": NPE, "reference_name": ["in", [r1, r2, o1]],
                                               "content": ["like", "%Raised twice this month%"]},
                                   pluck="reference_name")
        self.assertEqual(sorted(commented), sorted([r1, r2, o1]))

    def test_a_reject_reason_goes_to_the_reimbursement_claim_only_never_to_the_expense_request(self):
        """Owner, 2026-10-27: in one bulk reject, the claim takes the reason; the request-born expense's Expense
        Request only mirrors Rejected (develop's `on_expense_status_changed`) and keeps its review comment as
        the review wrote it. Both expenses carry the reason as their comment."""
        self.need_ceo()
        claim, reimbursed = self.approve(ADMIN, amount=80000)
        request, request_expense = self.request_born(70000, "CEO Pending")

        data = self.decide_many(CEO, [reimbursed, request_expense], "reject", reason="Not a company expense")
        self.assertEqual(sorted(data["succeeded"]), sorted([reimbursed, request_expense]))

        row = self.claim(claim)
        self.assertEqual((row.status, row.rejection_reason), (REJECTED, "Not a company expense"))
        req = frappe.db.get_value("Expense Request", request, ["status", "review_comment"], as_dict=True)
        self.assertEqual(req.status, "Rejected")
        self.assertFalse(req.review_comment, "the Payments reason must not be copied onto the Expense Request")
        commented = frappe.get_all("Comment", {"reference_doctype": NPE,
                                               "reference_name": ["in", [reimbursed, request_expense]],
                                               "content": ["like", "%Not a company expense%"]},
                                   pluck="reference_name")
        self.assertEqual(sorted(commented), sorted([reimbursed, request_expense]))

    def test_lead_bulk_approve_moves_requested_rows_and_refuses_a_reimbursement_already_past_l1(self):
        """A stale tick: the reimbursement was born Approved, so the lead tab's l1_approve refuses it alone."""
        claim, reimbursed = self.approve(HR, amount=1450)
        small, large = self.ordinary(PM, 20000), self.ordinary(PM, 80000)
        self.assertEqual(self.statuses(small, large), ["Requested", "Requested"])

        data = self.decide_many(ADMIN, [small, reimbursed, large], "l1_approve")
        self.assertEqual(data["statuses"], {small: "Approved", large: "CEO Pending"})
        self.assert_refused({"succeeded": [], "failed": data["failed"]}, reimbursed, "Approved", "Requested")
        self.assertEqual((self.expense_status(reimbursed), self.claim(claim).status), ("Approved", APPROVED))

    def test_bulk_approval_by_someone_who_may_not_refuses_every_row(self):
        claim, reimbursed = self.approve(ADMIN, amount=80000)
        requested = self.ordinary(PM, 20000)
        lead = self.decide_many(ACC, [requested], "l1_approve")  # Accountants are not L1
        self.assert_refused(lead, requested, "Admin")
        ceo = self.decide_many(ADMIN, [reimbursed], "ceo_approve")  # an Admin is not the CEO
        self.assert_refused(ceo, reimbursed, "CEO")
        self.assertEqual(self.statuses(requested, reimbursed), ["Requested", "CEO Pending"])
        self.assertEqual(self.claim(claim).status, APPROVED)

    # --- bulk Mark as Paid -----------------------------------------------------------------------

    def test_bulk_mark_as_paid_then_record_payment_pays_each_claim(self):
        c1, r1 = self.approve(HR, amount=1450)
        c2, r2 = self.approve(ADMIN, amount=30000)
        o1 = self.ordinary(ADMIN, 20000)
        self.assertEqual(self.statuses(r1, r2, o1), ["Approved"] * 3)

        # The confirmation re-reads who each ticked row is paid to: a claim's expense carries the account it
        # was approved with, so it is payable and goes in the bank file.
        rows = [{"doctype": NPE, "name": n} for n in (r1, r2, o1)]
        paid_to = self.as_user(ACC, paid_to_api.get_paid_to, rows)
        for answer in paid_to[:2]:
            self.assertEqual(answer["account"]["account_number"][:len(base.PREFIX)], base.PREFIX)
            self.assertFalse(answer["by_cheque"])
            self.assertIsNone(answer["missing"])
        self.assertIsNone(paid_to[2]["account"])  # the ordinary one has none: card / cash, still payable

        data = self.decide_many(ACC, [r1, r2, o1], "mark_done")
        self.assertEqual(data["failed"], [])
        self.assertEqual(data["statuses"], {r1: "Reconciliation Pending", r2: "Reconciliation Pending",
                                            o1: "Reconciliation Pending"})
        self.assertEqual(self.claims_status(c1, c2), [APPROVED, APPROVED])  # money out is not yet Paid

        for n, ref in ((r1, "UTR-BULK-1"), (r2, "UTR-BULK-2"), (o1, "UTR-BULK-3")):
            self.assert_moved(self.decide(ACC, n, "mark_paid", payment=self.payment(ref)), n, "Paid")
        self.assertEqual(self.claims_status(c1, c2), [PAID, PAID])
        followed = self.as_user(PM, claims.get_claim_payments, [c1, c2])
        self.assertEqual({c: followed[c]["payment_ref"] for c in (c1, c2)}, {c1: "UTR-BULK-1", c2: "UTR-BULK-2"})

    def test_a_bulk_batch_with_bad_rows_still_moves_the_good_ones(self):
        """Partial failure is normal: a Paid claim, an unknown name, a PO payment's name and a duplicate tick."""
        good_claim, good = self.approve(HR)
        paid_claim, paid = self.approve(HR)
        self.assert_moved(self.decide(ACC, paid, "mark_paid", payment=self.payment()), paid, "Paid")
        # The oldest Paid payment: a fixed record, not whichever payment was modified last (rule T1).
        payment = frappe.db.get_value(
            "Project Payments", {"status": "Paid"}, ["name", "status", "modified"], as_dict=True, order_by="creation asc"
        )
        names = [good, paid, "reimb-test-no-such-expense", good] + ([payment.name] if payment else [])

        data = self.decide_many(ACC, names, "mark_done")
        self.assertEqual(data["succeeded"], [good])  # the duplicate tick is one row
        self.assertEqual(data["total"], len(dict.fromkeys(names)))
        reasons = {f["name"]: f["reason"] for f in data["failed"]}
        self.assertIn("Paid", reasons[paid])
        self.assertEqual(reasons["reimb-test-no-such-expense"], "Expense not found")
        if payment:
            # The expense call never touches a payment, whatever name is sent to it.
            self.assertEqual(reasons[payment.name], "Expense not found")
            after = frappe.db.get_value("Project Payments", payment.name, ["status", "modified"], as_dict=True)
            self.assertEqual((after.status, after.modified), (payment.status, payment.modified))
        self.assertEqual((self.expense_status(good), self.claim(good_claim).status), ("Reconciliation Pending", APPROVED))
        self.assertEqual((self.expense_status(paid), self.claim(paid_claim).status), ("Paid", PAID))

    def test_a_batch_over_the_limit_is_refused_whole(self):
        claim, expense = self.approve(HR)
        too_many = [expense] + [f"reimb-test-filler-{i}" for i in range(MAX_BATCH_SIZE)]
        with self.assertRaises(frappe.ValidationError):
            self.decide_many(ACC, too_many, "mark_done")
        self.assertEqual((self.expense_status(expense), self.claim(claim).status), ("Approved", APPROVED))

    def test_bulk_mark_as_paid_by_hr_or_the_claimant_is_refused(self):
        claim, expense = self.approve(HR)
        for user in (HR, PM):
            with self.subTest(user):
                self.assert_refused(self.decide_many(user, [expense], "mark_done"), expense, "Admin or Accounts")
        self.assertEqual((self.expense_status(expense), self.claim(claim).status), ("Approved", APPROVED))
