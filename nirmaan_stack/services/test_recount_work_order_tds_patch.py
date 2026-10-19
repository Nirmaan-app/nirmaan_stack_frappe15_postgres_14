# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The one-time recount of every Work Order under the new Amount Paid, with its CEO Hold preview (#1513).

ADR-0034 Amendment A: a Work Order's Amount Paid is its Paid payments plus the TDS withheld from the
vendor on them, less Received refunds, and project outflow counts the TDS on Paid WO payments (both
kinds). The patch `patches/v3_0/recount_work_order_amount_paid_with_tds`:

  * its preview writes nothing and lists every Work Order whose stored figures change, and every
    project the larger outflow newly puts over its cashflow limit (old gap: without the WO tax; new
    gap: with it), decided by the owner's CEO Hold rule;
  * its run recounts through the one writer, so the mismatch judge finds no Work Order after it, and a
    second run changes nothing. It leaves CEO Hold to its normal check.

Worked by hand: a ₹10,000 vendor-borne payment cut to ₹9,800 with ₹200 withheld adds ₹10,000 to the
outflow (₹9,800 before); a ₹800 company-borne payment with ₹16 on top adds ₹816 (₹800 before).
"""

import contextlib
import io

import frappe
from frappe.utils import flt

from nirmaan_stack.api.vendor_refunds import po_refund_fixture
from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import sync_cashflow_reason
from nirmaan_stack.patches.v3_0 import recount_work_order_amount_paid_with_tds as patch
from nirmaan_stack.services.amount_paid_drift import mismatches
from nirmaan_stack.services.ceo_hold import core as ceo_hold
from nirmaan_stack.services.test_amount_paid_drift import WO, OrdersFixture


class RecountFixture(OrdersFixture):
    """`OrdersFixture`'s Work Orders, on real projects with a cashflow limit; purged by name."""

    PREFIX = "TEST-1513"

    def setUp(self):
        super().setUp()
        self.projects = []

    def tearDown(self):
        super().tearDown()
        names = self.projects or ["-"]
        po_refund_fixture.purge([
            ("CEO Hold Reason", lambda: frappe.db.delete("CEO Hold Reason", {"project": ["in", names]})),
            ("Projects", lambda: frappe.db.delete("Projects", {"name": ["in", names]})),
        ])

    def _project(self, limit, status="WIP", recheck_scheduled=0):
        doc = frappe.new_doc("Projects")
        doc.update({
            "project_name": f"{self.PREFIX} project", "status": status, "cashflow_gap_limit": limit,
            ceo_hold.RECHECK_SCHEDULED_FIELD: recheck_scheduled,
        })
        doc.name = f"{self.PREFIX}-PROJ-{frappe.generate_hash(length=8)}"
        doc.db_insert()
        frappe.db.commit()
        self.projects.append(doc.name)
        return doc.name

    def _stale_vendor_borne_wo(self, project):
        """₹10,000 WO paid ₹9,800 with ₹200 withheld, stored the old way: paid 9,800, due 200."""
        wo = self._wo(stored_paid=9800, total=10000, tds=200, stored_due=200, project=project)
        self._taxed_payment(wo, 9800, gross=10000, tds=200, project=project)
        return wo

    def _preview(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            patch.preview(names=self.orders[WO], projects=self.projects)
        return out.getvalue()


class ThePreview(RecountFixture):
    def test_it_lists_each_work_order_that_changes_and_writes_nothing(self):
        project = self._project(limit=0)
        stale = self._stale_vendor_borne_wo(project)
        right = self._wo(stored_paid=816, total=816, tds=16, project=project)
        self._taxed_payment(right, 816, gross=816, tds=16, borne_by="Company", project=project)
        modified = frappe.db.get_value(WO, stale, "modified")

        printed = self._preview()

        self.assertEqual(
            [(m.name, m.stored_paid, m.correct_paid, m.stored_due, m.correct_due)
             for m in patch.changed_work_orders(self.orders[WO])],
            [(stale, 9800.0, 10000.0, 200.0, 0.0)],
        )
        self.assertIn(stale, printed)
        self.assertNotIn(right, printed)
        self.assertEqual(self._stored(WO, stale), (9800.0, 200.0))
        self.assertEqual(frappe.db.get_value(WO, stale, "modified"), modified)

    def test_it_lists_the_projects_the_wo_tax_newly_puts_over_their_cashflow_limit(self):
        # Gap without the tax / with it: 9,800 / 10,000 and 800 / 816.
        newly = self._project(limit=9900)
        company = self._project(limit=810)
        already_over = self._project(limit=5000)
        still_under = self._project(limit=20000)
        completed = self._project(limit=9900, status="Completed")
        scheduled = self._project(limit=9900, recheck_scheduled=1)
        for project in (newly, already_over, still_under, completed, scheduled):
            self._stale_vendor_borne_wo(project)
        kept_whole = self._wo(stored_paid=800, total=800, tds=16, project=company)
        self._taxed_payment(kept_whole, 800, gross=800, tds=16, borne_by="Company", project=company)

        holds = patch.new_ceo_holds(self.projects)
        printed = self._preview()

        self.assertEqual(
            sorted((h.project, h.limit, flt(h.old_gap, 2), flt(h.new_gap, 2), h.recheck_scheduled) for h in holds),
            sorted([
                (newly, 9900.0, 9800.0, 10000.0, False),
                (company, 810.0, 800.0, 816.0, False),
                (scheduled, 9900.0, 9800.0, 10000.0, True),
            ]),
        )
        self.assertIn(newly, printed)
        self.assertNotIn(already_over, printed)
        for project in self.projects:
            self.assertNotIn(ceo_hold.SOURCE_CASHFLOW, ceo_hold.active_sources(project))
            self.assertNotEqual(frappe.db.get_value("Projects", project, "status"), ceo_hold.CEO_HOLD_STATUS)


class TheRun(RecountFixture):
    def test_after_it_the_judge_finds_no_work_order_and_a_second_run_changes_nothing(self):
        project = self._project(limit=0)
        stale = self._stale_vendor_borne_wo(project)
        drifted_tds = self._wo(stored_paid=10000, total=10000, tds=0, stored_due=0, project=project)
        self._taxed_payment(drifted_tds, 9800, gross=10000, tds=200, project=project)

        with contextlib.redirect_stdout(io.StringIO()):
            first = patch.execute(names=self.orders[WO])
        frappe.db.commit()
        modified = frappe.db.get_value(WO, stale, "modified")
        with contextlib.redirect_stdout(io.StringIO()):
            second = patch.execute(names=self.orders[WO])

        self.assertEqual(sorted(m.name for m in first), sorted([stale, drifted_tds]))
        self.assertEqual(mismatches(WO, self.orders[WO]), [])
        self.assertEqual(self._stored(WO, stale), (10000.0, 0.0))
        self.assertEqual(frappe.db.get_value(WO, drifted_tds, "total_tds"), 200.0)
        self.assertEqual(second, [])
        self.assertEqual(frappe.db.get_value(WO, stale, "modified"), modified)

    def test_it_leaves_ceo_hold_to_the_normal_check_which_then_agrees_with_the_preview(self):
        project = self._project(limit=9900)
        self._stale_vendor_borne_wo(project)
        self.assertEqual([h.project for h in patch.new_ceo_holds([project])], [project])

        with contextlib.redirect_stdout(io.StringIO()):
            patch.execute(names=self.orders[WO])

        self.assertNotIn(ceo_hold.SOURCE_CASHFLOW, ceo_hold.active_sources(project))
        sync_cashflow_reason(project)
        self.assertIn(ceo_hold.SOURCE_CASHFLOW, ceo_hold.active_sources(project))
