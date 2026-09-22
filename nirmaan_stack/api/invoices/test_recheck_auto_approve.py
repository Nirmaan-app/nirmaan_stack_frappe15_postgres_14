# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tests for the invoice re-check's two runners — the daily job and the button.

`frappe` is replaced wholesale inside `recheck_auto_approve`, so nothing here
touches a database: tests run against the LIVE localhost DB, and this code
approves and commits. The ceiling arithmetic (`ceiling_reasons`) stays real; only
the figures it reads off the PO are fed in.

The keystone is `test_invoice_rejected_mid_sweep_stays_rejected`: a manual
reject keeps the old reason tokens, so before the re-test under lock a sweep
that had already listed the invoice would approve it.

Run inside the bench venv:
    python -m unittest nirmaan_stack.api.invoices.test_recheck_auto_approve
"""

import importlib
import unittest
from unittest.mock import MagicMock, patch

import frappe

from nirmaan_stack import hooks
from nirmaan_stack.api.invoices import recheck_auto_approve as mod
from nirmaan_stack.tasks import invoice_recheck

INVOICE = "VI-TEST-RECHECK-1"

# Delivered and within the PO — both ceilings pass.
PASSING = {"po_total": 10000.0, "po_delivered": 10000.0, "invoice_amount": 5000.0, "cumulative": 5000.0}
# The PO records no delivery yet.
NOTHING_DELIVERED = {**PASSING, "po_delivered": 0.0}


class FakeInvoice(frappe._dict):
    def save(self, **kwargs):
        self.save_calls = (self.save_calls or 0) + 1

    def add_comment(self, comment_type, text):
        self.setdefault("comments", []).append(text)


def _invoice(status="Pending", reasons="nothing_delivered_yet", approved_by=None):
    return FakeInvoice(
        name=INVOICE,
        status=status,
        document_type="Procurement Orders",
        document_name="PO/TEST/RECHECK",
        invoice_no="INV-1",
        invoice_amount=5000.0,
        vendor="VEN-TEST",
        auto_approve_skip_reasons=reasons,
        approved_by=approved_by,
    )


class RecheckTestCase(unittest.TestCase):
    def setUp(self):
        self.doc = _invoice()
        self.figures = PASSING

        self.frappe = MagicMock()
        self.frappe.session.user = "accounts@test.local"
        self.frappe.get_doc.side_effect = lambda doctype, name, for_update=False: self.doc

        for patcher in (
            patch.object(mod, "frappe", self.frappe),
            patch.object(mod, "_", lambda text: text),
            patch.object(mod, "ceiling_figures", side_effect=lambda doc, docname: self.figures),
            patch("nirmaan_stack.api.invoices._auto_approve.now", return_value="2026-09-22 05:00:00"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

        recompute = patch.object(mod, "recompute_po_invoice_qty")
        self.recompute = recompute.start()
        self.addCleanup(recompute.stop)

    @property
    def commits(self):
        return self.frappe.db.commit.call_count


class TestRowRetestUnderLock(RecheckTestCase):
    def test_invoice_rejected_mid_sweep_stays_rejected(self):
        # Listed while Pending, rejected by hand before the sweep reached it.
        self.doc = _invoice(status="Rejected")

        summary = mod._run([INVOICE], dry_run=False)

        self.assertEqual(self.doc.status, "Rejected")
        self.assertIsNone(self.doc.save_calls)
        self.assertEqual(summary["checked"], 0)
        self.assertEqual(self.commits, 1, "the row lock must be released")

    def test_invoice_approved_by_hand_mid_sweep_keeps_its_approver(self):
        self.doc = _invoice(status="Approved", approved_by="Accountant One")

        mod._run([INVOICE], dry_run=False)

        self.assertEqual(self.doc.approved_by, "Accountant One")
        self.assertIsNone(self.doc.save_calls)
        self.assertIsNone(self.doc.comments)

    def test_apply_locks_the_row_and_preview_does_not(self):
        mod._run([INVOICE], dry_run=True)
        self.assertFalse(self.frappe.get_doc.call_args.kwargs["for_update"])

        mod._run([INVOICE], dry_run=False)
        self.assertTrue(self.frappe.get_doc.call_args.kwargs["for_update"])


class TestOutcomes(RecheckTestCase):
    def test_preview_writes_and_commits_nothing(self):
        summary = mod._run([INVOICE], dry_run=True)

        self.assertEqual(summary["counts"]["approved"], 1)
        self.assertEqual(self.doc.status, "Pending")
        self.assertIsNone(self.doc.save_calls)
        self.assertEqual(self.commits, 0)

    def test_button_approval_names_the_user(self):
        mod._run([INVOICE], dry_run=False)

        self.assertEqual(self.doc.status, "Approved")
        self.assertEqual(self.doc.approved_by, "System")
        self.recompute.assert_called_once_with("PO/TEST/RECHECK")
        self.assertIn("by accounts@test.local", self.doc.comments[0])

    def test_other_reason_holds_the_invoice(self):
        self.doc = _invoice(reasons="amount_unreconciled,nothing_delivered_yet")

        summary = mod._run([INVOICE], dry_run=False)

        self.assertEqual(summary["counts"]["cleared"], 1)
        self.assertEqual(self.doc.status, "Pending")
        self.assertEqual(self.doc.auto_approve_skip_reasons, "amount_unreconciled")

    def test_unchanged_block_writes_nothing_and_releases_the_lock(self):
        self.figures = NOTHING_DELIVERED

        summary = mod._run([INVOICE], dry_run=False)

        self.assertEqual(summary["counts"]["blocked"], 1)
        self.assertIsNone(self.doc.save_calls)
        self.assertEqual(self.commits, 1)


class TestDailyJob(RecheckTestCase):
    def test_daily_job_approves_and_names_itself(self):
        with patch.object(mod, "pending_queue_candidates", return_value=[INVOICE]), \
                patch.object(invoice_recheck, "janitor_log") as log:
            summary = invoice_recheck.run_daily_recheck()

        self.assertFalse(summary["dry_run"])
        self.assertEqual(summary["counts"]["approved"], 1)
        self.assertEqual(self.doc.status, "Approved")
        self.assertIn("daily re-check", self.doc.comments[0])
        self.assertNotIn("accounts@test.local", self.doc.comments[0])
        self.assertIn("approved 1", log.call_args.args[0])

    def test_queue_candidates_are_pending_po_invoices_on_a_ceiling(self):
        self.frappe.get_all.return_value = [
            frappe._dict(name="A", status="Pending", document_type="Procurement Orders",
                         auto_approve_skip_reasons="nothing_delivered_yet"),
            frappe._dict(name="B", status="Pending", document_type="Service Requests",
                         auto_approve_skip_reasons="nothing_delivered_yet"),
            frappe._dict(name="C", status="Pending", document_type="Procurement Orders",
                         auto_approve_skip_reasons="amount_unreconciled"),
        ]

        self.assertEqual(mod.pending_queue_candidates(), ["A"])
        self.assertEqual(self.frappe.get_all.call_args.kwargs["filters"], {"status": "Pending"})

    def test_cron_points_at_the_daily_job(self):
        path = "nirmaan_stack.tasks.invoice_recheck.run_daily_recheck"
        self.assertIn(path, hooks.scheduler_events["cron"]["0 5 * * *"])

        module, _, attr = path.rpartition(".")
        self.assertIs(getattr(importlib.import_module(module), attr), invoice_recheck.run_daily_recheck)


if __name__ == "__main__":
    unittest.main()
