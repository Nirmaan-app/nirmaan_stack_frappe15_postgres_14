# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Unreconcile never withholds Work Order tax a second time (#1288, parent #1283, ADR-0022 Amendment).

⚠️ THE TWO BUGS THIS SUITE EXISTS FOR WERE REPRODUCED ON THE LOCAL SITE, THROUGH THESE ENDPOINTS:

  * **Bug A** -- a Work Order payment with no tax row of its own was TAXED when its bank line was
    unreconciled: 50,000 -> 49,000. Unreconcile writes `Paid -> Approved`, and any save into
    `Approved` used to withhold.
  * **Bug B** -- a part payment's LEFTOVER was taxed when its own bank line was unreconciled:
    38,000 -> 37,240, although the original already carried the tax for the whole amount. The first
    line could then no longer be unreconciled at all: the split's undo refuses a taxed leftover
    ("Leftover taxed"), and nothing in the app can remove a tax row.

`payment_tds.is_approval_from_an_earlier_step` fixes both: only `Requested`, `CEO Pending` or
`Rejected` -> `Approved` withholds.

⚠️ IT USES `TaxedWorkOrderFixture`, AND THAT IS THE WHOLE REASON THESE BUGS WENT UNSEEN FOR SO LONG.
Every other Bulk Import suite plants payments by raw SQL with NO VENDOR, so `payment_tds.is_deductible`
is always false and the tax code is structurally unreachable -- a suite built that way cannot see a tax
bug however many assertions it makes. Here the parents come from that shared fixture (a Service Request
against a 2% vendor), so every path below really does reach the tax code.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. The batches, rows and legs are purged by the inherited
fixture; the projects, vendors, Service Requests, payments and split leftovers by `TaxedWorkOrderFixture`.
"""

import frappe

from nirmaan_stack.api.outflow_import.expenses import settle_row, settle_row_partial
from nirmaan_stack.api.outflow_import.test_settle_payment import PaymentSettlementFixture
from nirmaan_stack.api.outflow_import.unreconcile import get_unreconcile_plan, unreconcile_row
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services import payment_tds
from nirmaan_stack.services.outflow_import.partial_settle import INTENT_PART_PAYMENT
from nirmaan_stack.api.outflow_import.test_settle_payment import SETTLEABLE

PAYMENT = "Project Payments"
PTD = "Payment TDS Deduction"
SR = "Service Requests"


class TaxedWorkOrderUnreconcileFixture(PaymentSettlementFixture):
    """The settle/unreconcile machinery of the Bulk Import suites, over a REAL taxed Work Order."""

    GROSS = 50000.0
    NET = 49000.0
    TDS = 1000.0

    def setUp(self):
        super().setUp()
        self.taxed = TaxedWorkOrderFixture.attach(self)
        self.wo_project = self.taxed.project()
        self.wo_vendor = self.taxed.vendor()
        self.wo_sr = self.taxed.service_request(self.wo_project, self.wo_vendor)
        self.extra_payments: list[str] = []

    def tearDown(self):
        # A settle attaches the statement to what it settled; `TaxedWorkOrderFixture.purge` sweeps
        # Versions, Comments and notifications but not `File` rows, so they go here -- before that
        # purge, which `addCleanup` runs after this method.
        names = list(dict.fromkeys(self.taxed.payments + self.extra_payments))
        if names:
            frappe.db.delete(
                "File", {"attached_to_doctype": PAYMENT, "attached_to_name": ["in", names]}
            )
            frappe.db.commit()
        super().tearDown()

    def _taxed_payment(self, gross: float = GROSS):
        """Approved through the real `ceo_approve_payment`, so the deduction row and the netted
        amount come from production code, then MARKED AS DONE so a bank line can settle it.

        ⚠️ THE SECOND STEP IS NOT SETUP NOISE (#1289). The import settles from
        `Reconciliation Pending`, and this fixture's whole point is to reach the tax code -- so the
        transition runs through `doc.save()` and is itself part of what these tests prove: the money
        is taxed ONCE, at the CEO's approval, and neither the mark-as-done nor anything after it
        writes a second deduction row.
        """
        made = self.taxed.payment(
            gross,
            project=self.wo_project,
            vendor=self.wo_vendor,
            service_request=self.wo_sr,
        )
        self.taxed.mark_as_done(made.name)
        return made

    def _untaxed_payment(self, amount: float = GROSS, status: str = SETTLEABLE) -> str:
        """A Work Order payment carrying NO deduction row -- Bug A's shape.

        ⚠️ IT IS PLANTED AT THE SETTLEABLE STATUS, NOT `Approved` (#1289), because every test but one
        settles it from a bank line. The exception passes `status="Approved"` explicitly: proving the
        tax code is REACHABLE means asking `is_deductible`, which answers only about a payment
        sitting at `Approved` -- that is the status tax is withheld on, and the whole point of the
        rest of this suite is that nothing downstream of it withholds again.

        ⚠️ A REAL SHAPE, NOT A CONTRIVANCE. Every one of the 1,331 legacy Paid SR payments predates
        `Payment TDS Deduction` and carries none, and a bulk approval whose post-commit deduction
        phase failed leaves one too. Planted raw so it never passes through an approval -- going
        through one would write the very row this test needs absent.
        """
        name = f"TEST-TWO-UNTAXED-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner,
                   docstatus, idx, project, vendor, amount, status, document_type, document_name)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                   %s, %s, %s, %s, %s, %s)""",
            (name, self.wo_project, self.wo_vendor, float(amount), status, SR, self.wo_sr),
        )
        self.extra_payments.append(name)
        frappe.db.commit()
        return name

    def _stored(self, name):
        return frappe.db.get_value(PAYMENT, name, ["status", "amount", "utr"], as_dict=True)

    def _deductions(self, name):
        return frappe.get_all(PTD, {"project_payment": name}, pluck="name")

    def _settle(self, payment, amount):
        row = self._staged_row(amount=str(amount))
        settle_row(row=row, target_doctype=PAYMENT, target_name=payment)
        return row


class TestAnUntaxedWorkOrderPayment(TaxedWorkOrderUnreconcileFixture):
    """Bug A: the payment with no tax row of its own."""

    def test_it_is_deductible_so_the_tax_code_really_is_reachable(self):
        """⚠️ THE GUARD ON THE OTHER TESTS IN THIS CLASS. If the fixture ever stopped reaching the
        tax code, they would pass for the wrong reason -- which is exactly how Bug A survived."""
        doc = frappe.get_doc(PAYMENT, self._untaxed_payment(status="Approved"))
        self.assertTrue(payment_tds.vendor_rate(self.wo_vendor))
        self.assertTrue(payment_tds.is_deductible(doc))

    def test_unreconciling_it_neither_taxes_it_nor_changes_its_amount(self):
        pay = self._untaxed_payment()
        row = self._settle(pay, self.GROSS)
        self.assertEqual(self._stored(pay).status, "Paid")

        result = unreconcile_row(row=row, legs="all", reason="wrong record")

        stored = self._stored(pay)
        self.assertEqual(stored.status, SETTLEABLE)
        self.assertEqual(float(stored.amount), self.GROSS, "the amount must be untouched")
        self.assertFalse(stored.utr)
        self.assertEqual(self._deductions(pay), [], "no tax row may be written by an undo")
        [leg] = result["reversed"]
        self.assertEqual(leg["amount_after"], self.GROSS)

    def test_it_can_be_settled_again_against_its_own_line(self):
        """The point of the fix: the payment still matches the bank line it came off, so a reviewer
        who unreconciled by mistake can simply put it back. A netted payment could not."""
        pay = self._untaxed_payment()
        row = self._settle(pay, self.GROSS)
        unreconcile_row(row=row, legs="all", reason="wrong record")

        settle_row(row=self._staged_row(amount=str(self.GROSS)),
                   target_doctype=PAYMENT, target_name=pay)
        self.assertEqual(self._stored(pay).status, "Paid")


class TestATaxedWorkOrderPayment(TaxedWorkOrderUnreconcileFixture):
    """The other half of the rule: tax already withheld is neither removed nor restated."""

    def test_the_fixture_withheld_the_tax_at_approval(self):
        made = self._taxed_payment()
        self.assertEqual(made.gross, self.GROSS)
        self.assertEqual(made.tds, self.TDS)
        self.assertEqual(made.net, self.NET)

    def test_unreconciling_leaves_the_deduction_and_the_net_amount_exactly_as_they_were(self):
        made = self._taxed_payment()
        row = self._settle(made.name, self.NET)

        unreconcile_row(row=row, legs="all", reason="wrong record")

        stored = self._stored(made.name)
        self.assertEqual(stored.status, SETTLEABLE)
        self.assertEqual(float(stored.amount), self.NET)
        self.assertEqual(self._deductions(made.name), [made.deduction], "one row, the same one")
        self.assertEqual(
            frappe.db.get_value(PTD, made.deduction, "tds_amount"), self.TDS
        )


class TestAPartPaymentsLeftover(TaxedWorkOrderUnreconcileFixture):
    """Bug B: the leftover taxed on top of the original, and the dead end that followed."""

    BANK = 30000.0
    LEFTOVER = 19000.0  # 49,000 net - 30,000 paid by the bank

    def _part_settle(self):
        made = self._taxed_payment()
        row = self._staged_row(amount=str(self.BANK))
        settle_row_partial(row, made.name, INTENT_PART_PAYMENT)
        (leftover,) = frappe.get_all(PAYMENT, {"split_from": made.name}, pluck="name")
        return made, row, leftover

    def test_the_leftover_is_born_without_a_tax_row(self):
        """The tax was withheld ONCE, on the original, for the whole amount. The leftover is the
        balance still owed out of that same taxed figure -- it is not a second decision."""
        made, _, leftover = self._part_settle()
        self.assertEqual(self._deductions(leftover), [])
        self.assertEqual(float(self._stored(leftover).amount), self.LEFTOVER)
        self.assertEqual(self._deductions(made.name), [made.deduction])

    def test_unreconciling_the_leftovers_own_line_never_taxes_it(self):
        """The measured 38,000 -> 37,240. The leftover comes back from `Paid` exactly as it went."""
        _, _, leftover = self._part_settle()
        second = self._settle(leftover, self.LEFTOVER)
        self.assertEqual(self._stored(leftover).status, "Paid")

        unreconcile_row(row=second, legs="all", reason="wrong balance")

        stored = self._stored(leftover)
        self.assertEqual(stored.status, SETTLEABLE)
        self.assertEqual(float(stored.amount), self.LEFTOVER)
        self.assertEqual(self._deductions(leftover), [])

    def test_the_first_line_is_then_no_longer_refused_as_leftover_taxed(self):
        """⚠️ THE DEAD END, GONE. A taxed leftover makes the split's undo refuse ("Leftover taxed.
        Fix the tax on the Payments screen first"), and nothing in the app can remove a tax row --
        so the reviewer was told to do something that could not be done. Untaxed, the undo works."""
        made, first, leftover = self._part_settle()
        second = self._settle(leftover, self.LEFTOVER)
        unreconcile_row(row=second, legs="all", reason="wrong balance")

        (leg,) = get_unreconcile_plan(row=first)["legs"]
        self.assertNotEqual(leg.get("title"), "Leftover taxed")
        self.assertNotIn("has TDS on it", leg.get("reason") or "")

        unreconcile_row(row=first, legs="all", reason="wrong payment picked")

        self.assertFalse(frappe.db.exists(PAYMENT, leftover), "the leftover is deleted")
        stored = self._stored(made.name)
        self.assertEqual(stored.status, SETTLEABLE)
        self.assertEqual(float(stored.amount), self.NET, "the original gets its net amount back")
        self.assertEqual(self._deductions(made.name), [made.deduction], "still taxed exactly once")
