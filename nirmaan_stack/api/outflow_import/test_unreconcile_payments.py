# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Unreconcile a line settled against Project Payments (#1275, parent #1270, ADR-0022).

Through the two whitelisted endpoints, `get_unreconcile_plan` and `unreconcile_row`, for every way a
payment gets settled: a confirmed suggestion, a hand Link and a Split (fan-out). Each settle path ends
with the payment re-settled against a DIFFERENT line, which is the only proof it is really free.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Everything a test makes -- batches, rows, legs, payments,
their Versions and Comments, users, the TDS fixtures -- is purged by the fixtures' tearDown.
"""

import json

import frappe

from nirmaan_stack.api.outflow_import.expenses import settle_row
from nirmaan_stack.api.outflow_import.test_allocate_row import AllocationFixture
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD, _Users
from nirmaan_stack.api.outflow_import.unreconcile import get_unreconcile_plan, unreconcile_row
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)
from nirmaan_stack.services.outflow_import.unreconcile import (
    CASHBOOK_REFUSAL,
    VERDICT_REFUSED,
    VERDICT_REVERT_PAYMENT,
    WHAT_HAPPENS_REVERT_PAYMENT,
)

MATCH_DOCTYPE = "Outflow Row Match"
ROW_DOCTYPE = "Outflow Import Row"
BATCH_DOCTYPE = "Outflow Import Batch"
PAYMENT = "Project Payments"
PTD = "Payment TDS Deduction"


class PaymentUnreconcileFixture(AllocationFixture):
    def setUp(self):
        super().setUp()
        self.users = _Users()

    def tearDown(self):
        self.users.purge()
        super().tearDown()

    def _leg(self, row, payment):
        return frappe.db.get_value(
            MATCH_DOCTYPE, {"import_row": row, "target_name": payment}, "name"
        )

    def _payment(self, name):
        return frappe.db.get_value(
            PAYMENT, name, ["status", "utr", "payment_date", "amount"], as_dict=True
        )

    def _line(self, row):
        return frappe.db.get_value(
            ROW_DOCTYPE,
            row,
            ["row_status", "suggested_doctype", "suggested_name", "decided_by"],
            as_dict=True,
        )

    def _assert_free(self, payment):
        stored = self._payment(payment)
        self.assertEqual(stored.status, "Approved")
        self.assertFalse(stored.utr)
        self.assertFalse(stored.payment_date)

    def _resettle_elsewhere(self, payment):
        """The acceptance proof: the payment settles against a different line afterwards."""
        amount = frappe.db.get_value(PAYMENT, payment, "amount")
        other = self._staged_row(amount=str(amount))
        settle_row(row=other, target_doctype=PAYMENT, target_name=payment)
        self.assertEqual(self._line(other).row_status, ROW_SETTLED)
        self.assertEqual(self._payment(payment).status, "Paid")
        return other


class TestAConfirmedSuggestion(PaymentUnreconcileFixture):
    def _settled(self):
        pay = self._approved_payment("100")
        row = self._staged_row(amount="100")
        frappe.db.set_value(
            ROW_DOCTYPE, row, {"suggested_doctype": PAYMENT, "suggested_name": pay},
            update_modified=False,
        )
        frappe.db.commit()
        settle_row(row=row, target_doctype=PAYMENT, target_name=pay)
        self.assertEqual(self._line(row).row_status, ROW_SETTLED)
        return row, pay

    def test_the_line_reopens_with_its_suggestion_and_the_payment_is_free(self):
        row, pay = self._settled()
        result = unreconcile_row(row=row, legs="all", reason="wrong vendor bill")

        self.assertEqual(result["row_status"], ROW_MATCHED)
        stored = self._line(row)
        self.assertEqual(stored.row_status, ROW_MATCHED)
        # Keeps its previous suggestion (#1270 story 34).
        self.assertEqual(stored.suggested_name, pay)
        self.assertFalse(stored.decided_by)
        self._assert_free(pay)
        self.assertEqual(
            frappe.db.get_value(MATCH_DOCTYPE, self._leg(row, pay), "match_kind"), "Reversed"
        )
        self._resettle_elsewhere(pay)

    def test_the_plan_names_the_leg_and_what_happens(self):
        row, pay = self._settled()
        plan = get_unreconcile_plan(row=row)
        self.assertEqual(plan["row"], row)
        self.assertEqual(plan["row_status"], ROW_SETTLED)
        self.assertEqual(float(plan["amount"]), 100.0)
        self.assertEqual(float(plan["allocated"]), 100.0)
        self.assertEqual(plan["refused_count"], 0)
        [leg] = plan["legs"]
        self.assertEqual(leg["target_name"], pay)
        self.assertEqual(leg["target_doctype"], PAYMENT)
        self.assertEqual(leg["verdict"], VERDICT_REVERT_PAYMENT)
        self.assertEqual(leg["what_happens"], WHAT_HAPPENS_REVERT_PAYMENT)
        self.assertIsNone(leg["reason"])
        self.assertEqual(float(leg["target_amount"]), 100.0)

    def test_the_plan_writes_nothing(self):
        row, pay = self._settled()
        get_unreconcile_plan(row=row)
        self.assertEqual(self._payment(pay).status, "Paid")
        self.assertEqual(self._line(row).row_status, ROW_SETTLED)


class TestAHandLink(PaymentUnreconcileFixture):
    def test_a_hand_link_reopens_as_needs_a_record_and_the_payment_is_free(self):
        pay = self._approved_payment("100")
        row = self._staged_row(amount="100")
        settle_row(row=row, target_doctype=PAYMENT, target_name=pay)

        result = unreconcile_row(row=row, legs="all", reason="picked the wrong payment")

        # No suggestion to fall back on, so it needs a record again.
        self.assertEqual(result["row_status"], ROW_MISMATCHED)
        self._assert_free(pay)
        self._resettle_elsewhere(pay)


class TestASplit(PaymentUnreconcileFixture):
    def test_reverse_all_frees_every_payment(self):
        row, pays = self._allocated()
        result = unreconcile_row(row=row, legs="all", reason="three wrong bills")
        self.assertIn(result["row_status"], (ROW_MATCHED, ROW_MISMATCHED))
        self.assertEqual(len(result["reversed"]), 3)
        for pay in pays:
            self._assert_free(pay)
            self.assertEqual(
                frappe.db.get_value(MATCH_DOCTYPE, self._leg(row, pay), "match_kind"), "Reversed"
            )
        # Each payment is free, not just the first (#1275 AC1).
        for pay in pays:
            self._resettle_elsewhere(pay)

    def test_one_reverse_on_a_multi_leg_line_removes_only_that_leg(self):
        row, (a, b, c) = self._allocated()
        result = unreconcile_row(row=row, legs=json.dumps([self._leg(row, b)]), reason="not this")
        self.assertEqual(result["row_status"], ROW_PARTIALLY_ALLOCATED)
        self.assertEqual(float(result["remaining"]), 30.0)
        self._assert_free(b)
        for pay in (a, c):
            self.assertEqual(self._payment(pay).status, "Paid")
        plan = get_unreconcile_plan(row=row)
        self.assertEqual(sorted(leg["target_name"] for leg in plan["legs"]), sorted([a, c]))

    def test_reverse_all_with_one_refused_leg_writes_nothing_and_says_why(self):
        row, pays = self._allocated()
        frappe.db.set_value(PAYMENT, pays[2], "amount", 11.0, update_modified=False)
        frappe.db.commit()

        plan = get_unreconcile_plan(row=row)
        self.assertEqual(plan["refused_count"], 1)
        refused = next(leg for leg in plan["legs"] if leg["verdict"] == VERDICT_REFUSED)
        self.assertEqual(refused["target_name"], pays[2])
        self.assertIsNone(refused["what_happens"])

        with self.assertRaises(frappe.ValidationError) as caught:
            unreconcile_row(row=row, legs="all", reason="all wrong")
        self.assertIn(refused["reason"], str(caught.exception))
        for pay in pays[:2]:
            self.assertEqual(self._payment(pay).status, "Paid")
        self.assertEqual(self._line(row).row_status, ROW_SETTLED)

    def test_the_response_reports_each_payments_amount_after_the_save(self):
        row, pays = self._allocated()
        result = unreconcile_row(row=row, legs="all", reason="all wrong")
        after = {r["target_name"]: r["amount_after"] for r in result["reversed"]}
        self.assertEqual(after, {pays[0]: 60.0, pays[1]: 30.0, pays[2]: 10.0})
        self.assertTrue(result["batch_status"])


class TestTheAudit(PaymentUnreconcileFixture):
    def test_versions_for_the_payment_and_the_match_record_and_a_line_comment(self):
        row, (a, b, c) = self._allocated()
        leg = self._leg(row, a)
        unreconcile_row(row=row, legs=[leg], reason="wrong vendor bill")

        payment_versions = frappe.get_all(
            "Version", filters={"ref_doctype": PAYMENT, "docname": a}, pluck="data"
        )
        self.assertTrue(any('"Approved"' in data for data in payment_versions))
        leg_versions = frappe.get_all(
            "Version", filters={"ref_doctype": MATCH_DOCTYPE, "docname": leg}, pluck="data"
        )
        self.assertTrue(any('"Reversed"' in data for data in leg_versions))

        comments = frappe.get_all(
            "Comment",
            filters={
                "reference_doctype": ROW_DOCTYPE,
                "reference_name": row,
                "comment_type": "Comment",
            },
            pluck="content",
        )
        self.assertEqual(len(comments), 1)
        self.assertIn("Unreconciled by Administrator: wrong vendor bill", comments[0])
        self.assertIn("1 record", comments[0])
        self.assertIn(a, comments[0])


class TestAccess(PaymentUnreconcileFixture):
    def test_a_plain_accountant_is_refused_the_plan_and_the_write(self):
        row, pays = self._allocated()
        frappe.set_user(self.users.make(ACCOUNTANT))
        try:
            with self.assertRaises(frappe.PermissionError):
                get_unreconcile_plan(row=row)
            with self.assertRaises(frappe.PermissionError):
                unreconcile_row(row=row, legs="all", reason="wrong")
        finally:
            frappe.set_user("Administrator")
        for pay in pays:
            self.assertEqual(self._payment(pay).status, "Paid")

    def test_an_accountant_lead_may_unreconcile(self):
        row, pays = self._allocated()
        lead = self.users.make(ACCOUNTANT_LEAD)
        frappe.set_user(lead)
        try:
            get_unreconcile_plan(row=row)
            unreconcile_row(row=row, legs="all", reason="wrong")
        finally:
            frappe.set_user("Administrator")
        self._assert_free(pays[0])

    def test_both_endpoints_are_whitelisted_and_the_write_is_post_only(self):
        from frappe import allowed_http_methods_for_whitelisted_func as methods
        from frappe import whitelisted

        self.assertIn(get_unreconcile_plan, whitelisted)
        self.assertIn(unreconcile_row, whitelisted)
        self.assertEqual(methods[unreconcile_row], ["POST"])


class TestCashbook(PaymentUnreconcileFixture):
    def test_a_cashbook_settled_line_is_refused_and_nothing_is_written(self):
        row, pays = self._allocated()
        batch = frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")
        frappe.db.set_value(BATCH_DOCTYPE, batch, "source", "Cashbook", update_modified=False)
        frappe.db.commit()

        plan = get_unreconcile_plan(row=row)
        self.assertEqual(plan["refused_count"], 3)
        self.assertTrue(all(leg["reason"] == CASHBOOK_REFUSAL for leg in plan["legs"]))

        with self.assertRaises(frappe.ValidationError) as caught:
            unreconcile_row(row=row, legs="all", reason="wrong")
        self.assertIn(CASHBOOK_REFUSAL, str(caught.exception))
        for pay in pays:
            self.assertEqual(self._payment(pay).status, "Paid")


class TestUnreconcileNeverWithholdsTds(PaymentUnreconcileFixture):
    """⚠️ THE INVERTED "TDS ON APPROVED" PIN (#1288 retires the #1270 owner ruling; ADR-0022 Amendment).

    It used to pin the OPPOSITE: putting a Service Request payment back to Approved read as an approval
    to `controllers/project_payments.on_update`, so a payment to a TDS-rate vendor with no deduction row
    got one and was NETTED -- 1,000 -> 980 here.

    The rule is now `payment_tds.is_approval_from_an_earlier_step` (which holds the measured cases and
    the reasoning): Unreconcile writes `Paid -> Approved`, which withholds nothing.

    ⚠️ INVERTED, NOT DELETED. It asserts the NEW truth on the SAME fixture, so a regression to the old
    behaviour turns it red at exactly the point that behaviour returns."""

    def setUp(self):
        super().setUp()
        tag = frappe.generate_hash(length=8)
        self.vendor = f"TEST-OFI-UNREC-VEN-{tag}"
        self.sr = f"TEST-OFI-UNREC-SR-{tag}"
        frappe.db.sql(
            """INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner,
                   docstatus, idx, vendor_name, tds_deduction_percentage)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, 2)""",
            (self.vendor, self.vendor),
        )
        frappe.db.sql(
            """INSERT INTO "tabService Requests" (name, creation, modified, modified_by, owner,
                   docstatus, idx, project, vendor, status, total_amount, amount_paid)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s,
                   'Approved', 100000, 0)""",
            (self.sr, self._allocation_project(), self.vendor),
        )
        frappe.db.commit()

    def tearDown(self):
        if self.payments:
            deductions = frappe.get_all(PTD, {"project_payment": ["in", self.payments]}, pluck="name")
            if deductions:
                frappe.db.delete("Version", {"ref_doctype": PTD, "docname": ["in", deductions]})
            frappe.db.delete(PTD, {"project_payment": ["in", self.payments]})
        for doctype, name in (("Service Requests", self.sr), ("Vendors", self.vendor)):
            frappe.db.delete("Version", {"ref_doctype": doctype, "docname": name})
        frappe.db.delete("Service Requests", {"name": self.sr})
        frappe.db.delete("Vendors", {"name": self.vendor})
        frappe.db.commit()
        super().tearDown()

    def _sr_payment(self, amount):
        name = f"TEST-OFI-PAY-{frappe.generate_hash(length=12)}"
        frappe.db.sql(
            """INSERT INTO "tabProject Payments"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    project, vendor, amount, status, document_type, document_name)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                   %s, %s, %s, 'Approved', 'Service Requests', %s)""",
            (name, self._allocation_project(), self.vendor, float(amount), self.sr),
        )
        self.payments.append(name)
        frappe.db.commit()
        return name

    def test_unreconciling_creates_no_deduction_and_leaves_the_amount_alone(self):
        """Bug A of #1283, at the endpoint: a payment with no tax row of its own comes back from a
        settled status unchanged. The reported `amount_after` now equals the amount before, which is
        what lets the notice stay silent about it."""
        pay = self._sr_payment("1000")
        row = self._staged_row(amount="1000")
        settle_row(row=row, target_doctype=PAYMENT, target_name=pay)
        self.assertFalse(frappe.db.exists(PTD, {"project_payment": pay}))

        result = unreconcile_row(row=row, legs="all", reason="wrong SR")

        [reversed_leg] = result["reversed"]
        self.assertEqual(reversed_leg["reversed_amount"], 1000.0)
        self.assertEqual(reversed_leg["amount_after"], 1000.0)
        self.assertEqual(self._payment(pay).amount, 1000.0)
        self.assertFalse(frappe.db.exists(PTD, {"project_payment": pay}))

    # The other half of the rule -- a payment that ALREADY carries a deduction is unchanged on
    # every path -- is covered in `test_unreconcile_tds.TestATaxedWorkOrderPayment`, which builds
    # its payment through the shared `TaxedWorkOrderFixture` and a real approval rather than this
    # class's raw fixture. Repeating it here would be the same assertion over a weaker arrangement.
