"""A Work Order invoice approved by the System at upload (ADR-0050 decisions 2-4, 6-8; ADR-0014 Amendment C).

Each upload is made as a Procurement Executive, who may upload but not approve, through the endpoint the WO
page's Add Invoice calls. The rules themselves are pinned in `services/test_work_order_invoice_rules`; this
proves they run at upload, that the System's approval passes the WO guard, and what is stored.

Run: DEVENV test --module nirmaan_stack.api.invoices.test_wo_auto_approve
"""

from unittest.mock import patch

import frappe
from frappe.utils import flt, nowdate

from nirmaan_stack.api.invoices import recheck_auto_approve as recheck
from nirmaan_stack.api.invoices.test_work_order_invoice_permissions import ACCOUNTANT, PROCUREMENT, _AsRoleCase
from nirmaan_stack.tasks import invoice_recheck


class _WoAutoApproveCase(_AsRoleCase):
    """`TOTAL` is ₹10,00,000 on both Work Orders (GST on: ₹8,47,457.63 base)."""

    def setUp(self):
        super().setUp()
        self.addCleanup(self._purge_payments)

    def _purge_payments(self):
        frappe.db.rollback()
        frappe.db.delete("Project Payments", {"document_name": ("in", (self.wo_gst_on, self.wo_gst_off))})
        frappe.db.commit()

    def _upload(self, parent, amount, gst=0, **extra):
        res = self._as(PROCUREMENT, self._save, parent, amount=amount, base_amount=amount - gst, gst_amount=gst,
                       _extra=extra or None)
        self.assertEqual(res["status"], 200, res)
        return res["data"]["vendor_invoice_id"]

    def _row(self, name):
        return frappe.db.get_value(
            "Vendor Invoices", name,
            ["status", "approved_by", "auto_approved", "auto_approve_skip_reasons"], as_dict=True,
        )

    def _approved_invoice(self, parent, amount, gst=0):
        """An invoice an Accountant approved earlier, planted as stored."""
        doc = frappe.get_doc({
            "doctype": "Vendor Invoices", "document_type": "Service Requests", "document_name": parent,
            "invoice_no": "EARLIER-" + frappe.generate_hash(length=6), "invoice_date": nowdate(),
            "invoice_amount": amount, "invoice_base_amount": amount - gst, "invoice_gst_amount": gst,
            "status": "Approved",
        }).insert(ignore_permissions=True)
        frappe.db.commit()
        return doc.name

    def _paid(self, parent, amount_paid, gst_payment=0):
        """The WO's stored Amount Paid (incl. TDS), and one Paid GST payment of `gst_payment` when given."""
        frappe.db.set_value("Service Requests", parent, "amount_paid", amount_paid)
        if gst_payment:
            payment = frappe.new_doc("Project Payments")
            payment.update({"document_type": "Service Requests", "document_name": parent, "status": "Paid",
                            "amount": gst_payment, "is_gst_payment": 1})
            payment.name = "TEST-WOAA-" + frappe.generate_hash(length=8)
            payment.db_insert()   # the payment's hooks would recount the stored Amount Paid set above
        frappe.db.commit()

    def _assert_system_approved(self, name):
        row = self._row(name)
        self.assertEqual((row.status, row.approved_by, row.auto_approved), ("Approved", "System", 1), row)
        self.assertFalse(row.auto_approve_skip_reasons)


class TestRuleTwoAtUpload(_WoAutoApproveCase):
    def test_the_invoice_that_reaches_the_total_is_approved_by_the_system(self):
        self._approved_invoice(self.wo_gst_off, 600_000)
        name = self._upload(self.wo_gst_off, 400_000)
        self._assert_system_approved(name)
        self.assertEqual(flt(frappe.db.get_value("Service Requests", self.wo_gst_off, "amount_invoiced")), 1_000_000)

    def test_a_pending_invoice_does_not_count(self):
        self._upload(self.wo_gst_off, 600_000)        # Pending: matches neither rule
        name = self._upload(self.wo_gst_off, 400_000)
        self.assertEqual(self._row(name).status, "Pending")


class TestRuleThreeAtUpload(_WoAutoApproveCase):
    def test_a_typed_invoice_equal_to_amount_paid_is_approved(self):
        # Decision 7: amounts only; this one was typed, not read by the AI.
        self._paid(self.wo_gst_off, 250_000)
        self._approved_invoice(self.wo_gst_off, 100_000)
        self._assert_system_approved(self._upload(self.wo_gst_off, 150_000.75))

    def test_on_a_gst_on_work_order_base_is_compared_with_base(self):
        # ₹2,95,000 paid, of which ₹45,000 GST: ₹2,50,000 base, = ₹1,00,000 + ₹1,50,000 base invoiced.
        self._paid(self.wo_gst_on, 295_000, gst_payment=45_000)
        self._approved_invoice(self.wo_gst_on, 118_000, gst=18_000)
        self._assert_system_approved(self._upload(self.wo_gst_on, 177_000, gst=27_000))


class TestTheDailyRecheck(_WoAutoApproveCase):
    """Decision 5: the 05:00 re-check takes Pending WO invoices too, rewrites their reasons and approves those that
    now match. It sweeps the real queue, so each run here is narrowed to this test's own invoices."""

    def _daily(self, *mine):
        real = recheck.pending_queue_candidates
        with patch.object(recheck, "pending_queue_candidates",
                          side_effect=lambda **kw: [n for n in real(**kw) if n in mine]), \
                patch.object(invoice_recheck, "janitor_log"):
            return invoice_recheck.run_daily_recheck()

    def _pending_before_adr_0050(self, parent, amount):
        """A WO invoice uploaded before ADR-0050: Pending with the PO gates' reasons."""
        name = self._upload(parent, amount)
        frappe.db.set_value("Vendor Invoices", name, "auto_approve_skip_reasons",
                            "autofill_not_used,not_procurement_order", update_modified=False)
        frappe.db.commit()
        return name

    def test_a_pending_one_that_now_matches_amount_paid_is_approved(self):
        name = self._upload(self.wo_gst_off, 30_000)
        self._paid(self.wo_gst_off, 30_000)
        summary = self._daily(name)
        self.assertEqual(summary["counts"]["approved"], 1, summary)
        self._assert_system_approved(name)
        comments = frappe.get_all("Comment", filters={"reference_name": name, "comment_type": "Info"}, pluck="content")
        self.assertTrue(any("daily re-check" in c for c in comments), comments)

    def test_its_first_run_rewrites_an_older_ones_reasons_with_the_figures(self):
        name = self._pending_before_adr_0050(self.wo_gst_off, 30_000)
        self._paid(self.wo_gst_off, 10_000)
        self._daily(name)
        self.assertEqual(self._row(name).auto_approve_skip_reasons,
                         "wo_total_mismatch:1000000.00:30000.00,wo_paid_mismatch:10000.00:30000.00")

    def test_the_po_tabs_recheck_takes_po_invoices_only_and_the_wo_tabs_wo_invoices(self):
        name = self._upload(self.wo_gst_off, 30_000)
        self.assertNotIn(name, recheck.pending_queue_candidates())
        self.assertIn(name, recheck.pending_queue_candidates(work_orders=True))
        self.assertIn(name, recheck.pending_queue_candidates(work_orders=True, purchase_orders=False))


class TestReCheckOnTheWorkOrderTab(_WoAutoApproveCase):
    """Re-check on Pending Invoice Approvals › WO runs the 05:00 job's Work Order check now (rules 2 and 3), as
    an Accountant presses it. The queue sweep is the real queue, so each run is narrowed to this test's invoices."""

    def _queue(self, *mine, dry_run=False):
        real = recheck.pending_queue_candidates
        with patch.object(recheck, "pending_queue_candidates",
                          side_effect=lambda **kw: [n for n in real(**kw) if n in mine]):
            return self._as(ACCOUNTANT, recheck.recheck_pending_queue, dry_run=dry_run,
                            document_type="Service Requests")

    def test_it_approves_one_that_now_matches_amount_paid(self):
        name = self._upload(self.wo_gst_off, 30_000)
        self._paid(self.wo_gst_off, 30_000)
        summary = self._queue(name)
        self.assertEqual(summary["counts"]["approved"], 1, summary)
        self._assert_system_approved(name)
        comments = frappe.get_all("Comment", filters={"reference_name": name, "comment_type": "Info"}, pluck="content")
        self.assertTrue(any("on re-check by" in c for c in comments), comments)

    def test_its_preview_writes_nothing_and_shows_the_figures(self):
        name = self._upload(self.wo_gst_off, 30_000)
        self._paid(self.wo_gst_off, 30_000)
        row = next(r for r in self._queue(name, dry_run=True)["results"] if r["invoice_id"] == name)
        self.assertEqual(row["outcome"], "approved")
        self.assertEqual((row["cumulative"], row["wo_total"], row["amount_paid"]), (30_000, 1_000_000, 30_000))
        self.assertEqual(row["rules"], [{"rule": 3, "base": False, "target": 30_000, "invoiced": 30_000}])
        self.assertEqual(self._row(name).status, "Pending")

    def test_one_matching_neither_rule_gets_todays_figures(self):
        name = self._upload(self.wo_gst_off, 30_000)
        self._paid(self.wo_gst_off, 10_000)
        summary = self._queue(name)
        self.assertEqual(summary["counts"]["approved"], 0, summary)
        self.assertEqual(self._row(name).auto_approve_skip_reasons,
                         "wo_total_mismatch:1000000.00:30000.00,wo_paid_mismatch:10000.00:30000.00")

    def test_the_row_re_check_takes_a_work_order_invoice(self):
        name = self._upload(self.wo_gst_off, 30_000)
        self._paid(self.wo_gst_off, 30_000)
        summary = self._as(ACCOUNTANT, recheck.recheck_auto_approve, [name])
        self.assertEqual(summary["counts"]["approved"], 1, summary)
        self._assert_system_approved(name)

    def test_the_po_tabs_re_check_leaves_it_alone(self):
        name = self._upload(self.wo_gst_off, 30_000)
        self._paid(self.wo_gst_off, 30_000)
        real = recheck.pending_queue_candidates
        with patch.object(recheck, "pending_queue_candidates",
                          side_effect=lambda **kw: [n for n in real(**kw) if n == name]):
            summary = self._as(ACCOUNTANT, recheck.recheck_pending_queue, document_type="Procurement Orders")
        self.assertEqual(summary["checked"], 0, summary)
        self.assertEqual(self._row(name).status, "Pending")


class TestWhyNotAtUpload(_WoAutoApproveCase):
    def test_it_stays_pending_with_the_figures_and_no_po_reason(self):
        self._paid(self.wo_gst_off, 50_000)
        name = self._upload(self.wo_gst_off, 20_000)
        row = self._row(name)
        self.assertEqual((row.status, row.auto_approved), ("Pending", 0))
        self.assertEqual(
            row.auto_approve_skip_reasons,
            "wo_total_mismatch:1000000.00:20000.00,wo_paid_mismatch:50000.00:20000.00",
        )

    def test_a_purchase_order_invoice_still_gets_its_gates(self):
        res = self._as(PROCUREMENT, self._save, self.po, amount=1_000_000, base_amount=1_000_000, gst_amount=0)
        row = self._row(res["data"]["vendor_invoice_id"])
        self.assertEqual(row.status, "Pending")
        self.assertIn("autofill_not_used", row.auto_approve_skip_reasons)
