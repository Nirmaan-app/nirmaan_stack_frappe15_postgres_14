# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A Work Order's stored Amount Paid includes the TDS withheld from the vendor (ADR-0034 Amendment A, #1509).

Amount Paid = its Paid payments + the `Vendor`-borne tax on them - its Received refunds. Tax the company
paid on top (`borne_by` Company) is not part of it. Amount Due = total - Amount Paid.

Driven through the real doors: approval by `ceo_approve_payment` (`TaxedWorkOrderFixture`), Paid, an
amount edit and a move by a payment save, delete by `frappe.delete_doc`, a refund Received by a refund
save. After each, THE JUDGE (`services/amount_paid_drift.mismatches`) finds nothing on the Work Orders
involved, and the stored figures are what a user reads. A change that moves the tax on a Paid payment
moves project outflow (#1510), so the CEO Hold check runs after it and reads the recounted figures.

⚠️ RUNS AGAINST THE SITE DATABASE. Everything is `TEST-TWO-*`, purged by `TaxedWorkOrderFixture`.
"""

import contextlib
from unittest.mock import patch

import frappe
from frappe.utils import flt

from nirmaan_stack.integrations.controllers import project_cashflow_hold_update as cashflow_hold
from nirmaan_stack.services.amount_paid_drift import mismatches
from nirmaan_stack.services.test_tds_borne_by import MISC, MISC_AND_ELECTRICAL, PAYMENT, PTD, SR, BorneByFixture

REFUNDS = "Vendor Refunds"


class AmountPaidFixture(BorneByFixture):
    def _paid(self, wo, gross):
        made = self._approve(wo, gross)
        self._pay(made.name)
        return made

    def _save_payment(self, name, **changes):
        doc = frappe.get_doc(PAYMENT, name)
        doc.update(changes)
        doc.save(ignore_permissions=True)
        frappe.db.commit()

    def _figures(self, wo):
        """(amount_paid, amount_due) as stored."""
        paid, _tds, due = self._wo_figures(wo)
        return paid, due

    def assertRight(self, *wos):
        self.assertEqual(mismatches(SR, wos), [])

    @contextlib.contextmanager
    def _ceo_hold_checks(self, wo):
        """Each CEO Hold check run inside the block, as `(project, wo's stored figures at that moment)`."""
        checks = []
        frappe.flags.pop(f"ceo_hold_checked:{self.project}", None)
        with patch.object(
            cashflow_hold, "sync_cashflow_reason", side_effect=lambda project: checks.append((project, self._wo_figures(wo)))
        ):
            yield checks


class TestTheStoredFigure(AmountPaidFixture):
    def test_a_vendor_borne_payment_counts_its_tax_in_amount_paid(self):
        # Rs 10,000 gross, Rs 200 withheld, Rs 9,800 reached the vendor: Rs 10,000 is settled.
        wo = self._wo(MISC_AND_ELECTRICAL, total=50000)
        made = self._paid(wo, 10000)

        self.assertEqual((made.net, made.tds), (9800.0, 200.0))
        self.assertEqual(self._figures(wo), (10000.0, 40000.0))
        self.assertRight(wo)

    def test_a_company_borne_payment_counts_only_what_was_paid(self):
        # Rs 800 paid whole, Rs 16 paid by the company on top: the tax is not the vendor's.
        wo = self._wo(MISC, total=5000)
        made = self._paid(wo, 800)

        self.assertEqual((made.net, made.tds), (800.0, 16.0))
        self.assertEqual(self._wo_figures(wo), (800.0, 16.0, 4200.0))
        self.assertRight(wo)

    # A Work Order with both kinds: `test_tds_borne_by.TestAWorkOrderWithBothKinds`.


class TestEveryChangeRecountsTheTax(AmountPaidFixture):
    def test_editing_a_paid_payments_amount_restates_its_tax_into_amount_paid(self):
        # The edited 4,900 is the net: 5,000 gross, 100 withheld. Settled: 5,000.
        wo = self._wo(MISC_AND_ELECTRICAL, total=50000)
        made = self._paid(wo, 10000)

        with self._ceo_hold_checks(wo) as checks:
            self._save_payment(made.name, amount=4900)

        self.assertEqual(self._wo_figures(wo), (5000.0, 100.0, 45000.0))
        self.assertRight(wo)
        # The restated tax moves project outflow: the check ran after the restate, on its figures.
        self.assertEqual(checks, [(self.project, (5000.0, 100.0, 45000.0))])

    def test_deleting_a_deduction_on_its_own_takes_its_tax_out(self):
        # Desk / REST delete of the deduction alone: the payment stays Paid at its net 9,800.
        wo = self._wo(MISC_AND_ELECTRICAL, total=50000)
        made = self._paid(wo, 10000)
        self.addCleanup(frappe.db.delete, "Deleted Document", {"deleted_doctype": PTD, "deleted_name": made.deduction})

        with self._ceo_hold_checks(wo) as checks:
            frappe.delete_doc(PTD, made.deduction, force=True, ignore_permissions=True)
            frappe.db.commit()

        self.assertEqual(self._wo_figures(wo), (9800.0, 0.0, 40200.0))
        self.assertRight(wo)
        self.assertEqual(checks, [(self.project, (9800.0, 0.0, 40200.0))])

    def test_deleting_a_deduction_on_an_unpaid_payment_moves_nothing(self):
        wo = self._wo(MISC_AND_ELECTRICAL, total=50000)
        made = self._approve(wo, 10000)
        self.addCleanup(frappe.db.delete, "Deleted Document", {"deleted_doctype": PTD, "deleted_name": made.deduction})
        modified = frappe.db.get_value(SR, wo, "modified")

        with self._ceo_hold_checks(wo) as checks:
            frappe.delete_doc(PTD, made.deduction, force=True, ignore_permissions=True)
            frappe.db.commit()

        self.assertEqual(frappe.db.get_value(SR, wo, "modified"), modified)
        self.assertEqual(checks, [])

    def test_moving_a_paid_payment_to_another_work_order_takes_its_tax_along(self):
        left = self._wo(MISC_AND_ELECTRICAL, total=50000)
        joined = self._wo(MISC_AND_ELECTRICAL, total=30000)
        made = self._paid(left, 10000)

        self._save_payment(made.name, document_name=joined)

        self.assertEqual(self._figures(left), (0.0, 50000.0))
        self.assertEqual(self._figures(joined), (10000.0, 20000.0))
        self.assertRight(left, joined)

    def test_deleting_a_paid_payment_takes_its_tax_out(self):
        wo = self._wo(MISC_AND_ELECTRICAL, total=50000)
        self._paid(wo, 5000)
        made = self._paid(wo, 10000)

        frappe.delete_doc(PAYMENT, made.name, force=True, ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(self._wo_figures(wo), (5000.0, 100.0, 45000.0))
        self.assertRight(wo)

    def test_a_refund_received_lowers_amount_paid_and_keeps_the_tax(self):
        wo = self._wo(MISC_AND_ELECTRICAL, total=50000)
        self._paid(wo, 10000)
        refund = self._waiting_refund(wo, 1000)

        doc = frappe.get_doc(REFUNDS, refund)
        doc.status = "Received"
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        self.assertEqual(self._figures(wo), (9000.0, 41000.0))
        self.assertRight(wo)

    def _waiting_refund(self, wo, amount):
        name = self.fx._name("VRF")
        frappe.db.sql(
            f"""INSERT INTO "tab{REFUNDS}"
                    (name, creation, modified, modified_by, owner, docstatus, idx, vendor, project,
                     document_type, document_name, status, amount, payment_date, waiting_created_by)
                VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s,
                        %s, %s, 'Reconciliation Pending', %s, CURRENT_DATE, 'Administrator')""",
            (name, self.vendor, self.project, SR, wo, flt(amount)),
        )
        frappe.db.commit()
        self.addCleanup(self._purge_refund, name)
        return name

    def _purge_refund(self, name):
        frappe.db.rollback()
        frappe.db.delete("Version", {"ref_doctype": REFUNDS, "docname": name})
        frappe.db.delete(REFUNDS, {"name": name})
        frappe.db.commit()
