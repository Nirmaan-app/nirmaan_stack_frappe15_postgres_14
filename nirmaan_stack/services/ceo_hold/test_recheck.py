# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Tests for the CEO Hold SCHEDULED RECHECK — the authorized user's "release now, decide on
a named date" path, and the temporary hook bypass it turns on.

The two keystones:

  * `test_payment_hook_skips_evaluation_while_scheduled` (+ its inflow / DN siblings) —
    the whole point of the feature: with `ceo_hold_recheck_scheduled = 1` a condition that
    WOULD hold the project does not, no matter which source fires.
  * `test_cron_reuses_existing_evaluation_and_holds` / `..._keeps_status` — the cron does
    not re-implement a single hold rule; it clears the schedule and lets the EXISTING
    cashflow + delivery-pending evaluations decide, then normal hooks resume.

The cashflow gap itself is patched (`_compute_cashflow_gap`) rather than fabricated out of
Payment / Expense / Inflow rows: the gap formula is existing, unchanged, separately-owned
behaviour — what these tests are about is the WIRING around it. Every test cleans up its
own projects, reason rows and action items.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from nirmaan_stack.constants.authorized_users import (
    CEO_AUTHORIZED_USER,
    CEO_HOLD_SYSTEM_USER,
)
from nirmaan_stack.integrations.controllers import project_cashflow_hold_update as cashflow
from nirmaan_stack.services.action_items.reconcile import reconcile_project_action_items
from nirmaan_stack.services.ceo_hold import core
from nirmaan_stack.tasks import ceo_hold_recheck

_CITY = "ZzCeoHoldRecheckTestCity"
_OVER_LIMIT_GAP = 10_000_000.0  # any gap above the 1.0 limit the fixtures set


def _make_project(suffix, status="WIP", cashflow_gap_limit=0):
    """Insert a Projects fixture (satisfies the generate_pwm after_insert hook)."""
    return (
        frappe.get_doc(
            {
                "doctype": "Projects",
                "project_name": f"CeoHoldRecheckTest {suffix}",
                "project_city": _CITY,
                "project_state": "Test State",
                "project_start_date": "2025-01-01 00:00:00",
                "project_end_date": "2025-12-31 00:00:00",
                "project_scopes": {"scopes": []},
                "status": status,
                "cashflow_gap_limit": cashflow_gap_limit,
            }
        )
        .insert(ignore_permissions=True)
        .name
    )


def _force(project, **values):
    """Write Projects fields directly (bypasses validate — the system-write path)."""
    frappe.db.set_value("Projects", project, values, update_modified=False)


def _row(project):
    return frappe.db.get_value(
        "Projects",
        project,
        ["status", "ceo_hold_by", "ceo_hold_recheck_scheduled", "ceo_hold_recheck_date"],
        as_dict=True,
    )


def _schedule(project, date=None, status="WIP"):
    """Put a project straight into scheduled-recheck mode (the post-release state)."""
    _force(
        project,
        status=status,
        ceo_hold_by=None,
        ceo_hold_recheck_scheduled=1,
        ceo_hold_recheck_date=date or add_days(today(), 7),
    )


def _held_project(suffix, holder=CEO_HOLD_SYSTEM_USER, reason=True):
    """A project sitting on CEO Hold with an active system reason row."""
    p = _make_project(suffix)
    _force(p, status="CEO Hold", ceo_hold_by=holder)
    if reason:
        core.set_reason(p, core.SOURCE_DN, "11 purchase orders awaiting delivery")
        frappe.db.commit()
    return p


_ANCIENT = "2020-01-01 00:00:00"


def _age_modified(project):
    """Backdate `modified` so any real bump is unmistakable."""
    _force(project, modified=_ANCIENT)


def _modified(project):
    return str(frappe.db.get_value("Projects", project, "modified"))


def _clear_trigger_dedup(project):
    """`trigger_check` claims a per-request flag; drop it so a test can fire twice."""
    frappe.flags.pop(f"ceo_hold_checked:{project}", None)


def _run_cron_for(project):
    """Run the real sweep, but restricted to ONE fixture project.

    These suites execute against the LIVE localhost site, and `run_due_ceo_hold_rechecks`
    is a global sweep — an unrestricted call would evaluate (and could re-hold) a REAL
    project that happens to be due, under a patched cashflow gap. The REAL
    `get_due_rechecks` query still runs and its result is only FILTERED, so a fixture the
    query fails to select still yields an empty batch and fails the test — the composition
    is proved, the blast radius is not.
    """
    real_get_due = ceo_hold_recheck.get_due_rechecks
    with patch.object(
        ceo_hold_recheck,
        "get_due_rechecks",
        side_effect=lambda: [r for r in real_get_due() if r["name"] == project],
    ):
        return ceo_hold_recheck.run_due_ceo_hold_rechecks()


class _FakePaymentDoc:
    """Minimal stand-in for the Project Payments doc the hook actually receives."""

    def __init__(self, project, status="Paid", prev_status=None):
        self.project = project
        self.projects = project  # Project Expenses uses the plural link field
        self.status = status
        self._prev = prev_status

    def has_value_changed(self, _field):
        return True

    def is_new(self):
        return self._prev is None

    def get_doc_before_save(self):
        return {"status": self._prev} if self._prev else None


def _cleanup():
    for name in frappe.get_all("Projects", filters={"project_city": _CITY}, pluck="name"):
        frappe.db.delete("CEO Hold Reason", {"project": name})
        frappe.db.delete("Project Action Item", {"project": name})
        frappe.delete_doc("Projects", name, ignore_permissions=True, force=True)
    frappe.db.commit()


class CeoHoldRecheckTestCase(FrappeTestCase):
    def setUp(self):
        self.addCleanup(frappe.set_user, "Administrator")

    def tearDown(self):
        frappe.set_user("Administrator")
        _cleanup()


# --------------------------------------------------------------------------------- #
# 1. The guard predicate itself
# --------------------------------------------------------------------------------- #


class TestRecheckGuard(CeoHoldRecheckTestCase):
    def test_is_recheck_scheduled_reads_the_flag(self):
        p = _make_project("guard")
        self.assertFalse(core.is_recheck_scheduled(p))

        _schedule(p)
        self.assertTrue(core.is_recheck_scheduled(p))

        core.clear_recheck_schedule(p)
        self.assertFalse(core.is_recheck_scheduled(p))
        row = _row(p)
        self.assertEqual(row.ceo_hold_recheck_scheduled, 0)
        self.assertIsNone(row.ceo_hold_recheck_date)

    def test_blank_or_unknown_project_is_not_scheduled(self):
        """Fail-open: a stale/blank docname degrades to NORMAL mode, never to a bypass."""
        self.assertFalse(core.is_recheck_scheduled(None))
        self.assertFalse(core.is_recheck_scheduled(""))
        self.assertFalse(core.is_recheck_scheduled("PROJ-does-not-exist"))


# --------------------------------------------------------------------------------- #
# 2. Hooks skip the CEO Hold evaluation while scheduled (and only while scheduled)
# --------------------------------------------------------------------------------- #


class TestHooksSkipWhileScheduled(CeoHoldRecheckTestCase):
    def test_recompute_is_a_no_op_while_scheduled(self):
        """The backstop: even a reason row already on file cannot re-hold the project."""
        p = _make_project("recompute")
        core.set_reason(p, core.SOURCE_DN, "11 POs awaiting delivery")
        _schedule(p)

        core.recompute_ceo_hold(p)
        self.assertEqual(_row(p).status, "WIP")

        # Same reason row, schedule gone → the normal decision lands.
        core.clear_recheck_schedule(p)
        core.recompute_ceo_hold(p)
        self.assertEqual(_row(p).status, "CEO Hold")

    def test_dn_hook_skips_evaluation_while_scheduled(self):
        p = _make_project("dn")
        _schedule(p)

        core.sync_delivery_pending(p, core.DN_PENDING_HOLD_THRESHOLD + 1)
        self.assertEqual(core.active_sources(p), set(), "no reason row may be written")
        self.assertEqual(_row(p).status, "WIP")

        # scheduled = 0 → the SAME count performs the normal evaluation.
        core.clear_recheck_schedule(p)
        core.sync_delivery_pending(p, core.DN_PENDING_HOLD_THRESHOLD + 1)
        self.assertEqual(core.active_sources(p), {core.SOURCE_DN})
        self.assertEqual(_row(p).status, "CEO Hold")

    def test_reconcile_still_runs_its_normal_work_while_scheduled(self):
        """Only the CEO Hold decision is skipped — the action-item pass itself still runs."""
        p = _make_project("reconcile")
        _schedule(p)

        counts = reconcile_project_action_items(p)
        self.assertEqual(
            set(counts), {"opened", "resolved", "reopened", "scanned"},
            "the reconcile must complete normally, not bail out",
        )
        self.assertEqual(_row(p).status, "WIP")
        self.assertEqual(_row(p).ceo_hold_recheck_scheduled, 1, "schedule survives a reconcile")

    def test_payment_hook_skips_evaluation_while_scheduled(self):
        p = _make_project("payment", cashflow_gap_limit=1)
        _schedule(p)

        with patch.object(cashflow, "_compute_cashflow_gap", return_value=_OVER_LIMIT_GAP):
            cashflow.on_project_payment(_FakePaymentDoc(p))
            self.assertEqual(core.active_sources(p), set())
            self.assertEqual(_row(p).status, "WIP")

            # scheduled = 0 → the same payment change performs the normal evaluation.
            core.clear_recheck_schedule(p)
            _clear_trigger_dedup(p)
            cashflow.on_project_payment(_FakePaymentDoc(p))

        self.assertEqual(core.active_sources(p), {core.SOURCE_CASHFLOW})
        self.assertEqual(_row(p).status, "CEO Hold")
        self.assertEqual(_row(p).ceo_hold_by, CEO_HOLD_SYSTEM_USER)

    def test_inflow_hook_skips_evaluation_while_scheduled(self):
        p = _make_project("inflow", cashflow_gap_limit=1)
        _schedule(p)

        with patch.object(cashflow, "_compute_cashflow_gap", return_value=_OVER_LIMIT_GAP):
            cashflow.on_project_inflow(frappe._dict(project=p))
            self.assertEqual(_row(p).status, "WIP")

            core.clear_recheck_schedule(p)
            _clear_trigger_dedup(p)
            cashflow.on_project_inflow(frappe._dict(project=p))

        self.assertEqual(_row(p).status, "CEO Hold")

    def test_expense_hook_skips_evaluation_while_scheduled(self):
        p = _make_project("expense", cashflow_gap_limit=1)
        _schedule(p)

        with patch.object(cashflow, "_compute_cashflow_gap", return_value=_OVER_LIMIT_GAP):
            cashflow.on_project_expense(_FakePaymentDoc(p))
            self.assertEqual(_row(p).status, "WIP")

            core.clear_recheck_schedule(p)
            _clear_trigger_dedup(p)
            cashflow.on_project_expense(_FakePaymentDoc(p))

        self.assertEqual(_row(p).status, "CEO Hold")

    def test_bulk_cashflow_evaluator_skips_scheduled_projects(self):
        """The catch-up evaluator funnels through the same guard as the realtime hooks."""
        p = _make_project("bulk", cashflow_gap_limit=1)
        _schedule(p)

        with patch.object(cashflow, "_compute_cashflow_gap", return_value=_OVER_LIMIT_GAP):
            cashflow.sync_cashflow_reason(p)

        self.assertEqual(core.active_sources(p), set())
        self.assertEqual(_row(p).status, "WIP")


# --------------------------------------------------------------------------------- #
# 3. The release itself — Projects.validate (the server-side half of the dialog)
# --------------------------------------------------------------------------------- #


class TestScheduledReleaseValidation(CeoHoldRecheckTestCase):
    def _release(self, project, new_status="WIP", scheduled=1, date="__default__"):
        doc = frappe.get_doc("Projects", project)
        doc.status = new_status
        doc.ceo_hold_recheck_scheduled = scheduled
        if date == "__default__":
            date = add_days(today(), 12)
        doc.ceo_hold_recheck_date = date
        doc.save(ignore_permissions=True)
        return doc

    def test_release_with_schedule_saves_status_and_schedule_together(self):
        p = _held_project("release-ok")
        frappe.set_user(CEO_AUTHORIZED_USER)

        target = add_days(today(), 12)
        self._release(p, "WIP", 1, target)

        row = _row(p)
        self.assertEqual(row.status, "WIP")
        self.assertIsNone(row.ceo_hold_by)
        self.assertEqual(row.ceo_hold_recheck_scheduled, 1)
        self.assertEqual(str(row.ceo_hold_recheck_date), target)
        self.assertEqual(
            core.active_sources(p),
            {core.SOURCE_DN},
            "the reason is deliberately NOT resolved — it freezes until the recheck",
        )

    def test_release_without_schedule_is_still_blocked_by_the_reason_guard(self):
        """FORK-9 is intact: the schedule is the ONLY thing that lets a held project go."""
        p = _held_project("release-noschedule")
        frappe.set_user(CEO_AUTHORIZED_USER)

        with self.assertRaises(frappe.PermissionError):
            self._release(p, "WIP", 0, None)

        self.assertEqual(_row(p).status, "CEO Hold")

    def test_schedule_without_a_date_is_rejected(self):
        p = _held_project("release-nodate")
        frappe.set_user(CEO_AUTHORIZED_USER)

        with self.assertRaises(frappe.ValidationError):
            self._release(p, "WIP", 1, None)

        row = _row(p)
        self.assertEqual(row.status, "CEO Hold", "a rejected save leaves the hold in place")
        self.assertEqual(row.ceo_hold_recheck_scheduled, 0)

    def test_past_recheck_date_is_rejected(self):
        p = _held_project("release-pastdate")
        frappe.set_user(CEO_AUTHORIZED_USER)

        with self.assertRaises(frappe.ValidationError):
            self._release(p, "WIP", 1, add_days(today(), -1))

        self.assertEqual(_row(p).status, "CEO Hold")

    def test_today_is_accepted_as_a_recheck_date(self):
        p = _held_project("release-today")
        frappe.set_user(CEO_AUTHORIZED_USER)

        self._release(p, "WIP", 1, today())

        row = _row(p)
        self.assertEqual(row.status, "WIP")
        self.assertEqual(str(row.ceo_hold_recheck_date), today())

    def test_non_authorized_user_cannot_schedule_a_recheck(self):
        p = _held_project("release-otheruser")
        # session user stays Administrator — not the authorized CEO account.
        with self.assertRaises(frappe.PermissionError):
            self._release(p, "WIP", 1, add_days(today(), 5))

        self.assertEqual(_row(p).status, "CEO Hold")

    def test_schedule_cannot_be_created_outside_a_ceo_hold_release(self):
        p = _make_project("schedule-from-wip")
        frappe.set_user(CEO_AUTHORIZED_USER)

        with self.assertRaises(frappe.ValidationError):
            self._release(p, "Handover", 1, add_days(today(), 5))

        self.assertEqual(_row(p).ceo_hold_recheck_scheduled, 0)

    def test_release_to_completed_never_creates_a_schedule(self):
        """Terminal statuses are normalised clean, so FORK-9 still guards them."""
        p = _held_project("release-completed")
        frappe.set_user(CEO_AUTHORIZED_USER)

        with self.assertRaises(frappe.PermissionError):
            self._release(p, "Completed", 1, add_days(today(), 5))

        row = _row(p)
        self.assertEqual(row.status, "CEO Hold")
        self.assertEqual(row.ceo_hold_recheck_scheduled, 0)

    def test_release_to_halted_never_creates_a_schedule(self):
        p = _held_project("release-halted")
        frappe.set_user(CEO_AUTHORIZED_USER)

        with self.assertRaises(frappe.PermissionError):
            self._release(p, "Halted", 1, add_days(today(), 5))

        row = _row(p)
        self.assertEqual(row.status, "CEO Hold")
        self.assertEqual(row.ceo_hold_recheck_scheduled, 0)

    def test_terminal_status_clears_an_existing_schedule(self):
        """A scheduled project moved to Completed drops the schedule in the same save."""
        p = _make_project("terminal-clears")
        _schedule(p)
        frappe.set_user(CEO_AUTHORIZED_USER)

        doc = frappe.get_doc("Projects", p)
        doc.status = "Completed"
        doc.save(ignore_permissions=True)

        row = _row(p)
        self.assertEqual(row.status, "Completed")
        self.assertEqual(row.ceo_hold_recheck_scheduled, 0)
        self.assertIsNone(row.ceo_hold_recheck_date)

    def test_manual_re_hold_clears_the_schedule(self):
        """'If the project goes back on CEO Hold, the flag is off and the date is empty.'"""
        p = _make_project("rehold")
        _schedule(p)
        frappe.set_user(CEO_AUTHORIZED_USER)

        doc = frappe.get_doc("Projects", p)
        doc.status = "CEO Hold"
        doc.save(ignore_permissions=True)

        row = _row(p)
        self.assertEqual(row.status, "CEO Hold")
        self.assertEqual(row.ceo_hold_by, CEO_AUTHORIZED_USER)
        self.assertEqual(row.ceo_hold_recheck_scheduled, 0)
        self.assertIsNone(row.ceo_hold_recheck_date)

    def test_an_overdue_schedule_does_not_block_unrelated_saves(self):
        """The past-date rule fires on create/change only — never on every later edit."""
        p = _make_project("overdue-save")
        _schedule(p, date=add_days(today(), -3))

        doc = frappe.get_doc("Projects", p)
        doc.project_state = "Edited State"
        doc.save(ignore_permissions=True)  # must not raise

        row = _row(p)
        self.assertEqual(row.ceo_hold_recheck_scheduled, 1)
        self.assertEqual(str(row.ceo_hold_recheck_date), add_days(today(), -3))


# --------------------------------------------------------------------------------- #
# 4. The cron — the only mechanism that ends scheduled-recheck mode
# --------------------------------------------------------------------------------- #


class TestRecheckCron(CeoHoldRecheckTestCase):
    def test_future_date_is_not_due(self):
        p = _make_project("cron-future")
        _schedule(p, date=add_days(today(), 5))

        self.assertNotIn(p, [r["name"] for r in ceo_hold_recheck.get_due_rechecks()])

        _run_cron_for(p)
        row = _row(p)
        self.assertEqual(row.ceo_hold_recheck_scheduled, 1, "the schedule must survive")
        self.assertEqual(row.status, "WIP")

    def test_today_and_past_dates_are_due(self):
        due_today = _make_project("cron-today")
        _schedule(due_today, date=today())
        overdue = _make_project("cron-overdue")
        _schedule(overdue, date=add_days(today(), -4))

        due_names = [r["name"] for r in ceo_hold_recheck.get_due_rechecks()]
        self.assertIn(due_today, due_names)
        self.assertIn(overdue, due_names, "`<= today` must catch up on a missed run")

    def test_cron_reuses_existing_evaluation_and_holds(self):
        """Condition TRUE at recheck time → the EXISTING evaluation puts the hold back."""
        p = _make_project("cron-holds", cashflow_gap_limit=1)
        _schedule(p, date=today())

        with patch.object(cashflow, "_compute_cashflow_gap", return_value=_OVER_LIMIT_GAP):
            totals = _run_cron_for(p)

        self.assertEqual(totals["evaluated"], 1)
        row = _row(p)
        self.assertEqual(row.status, "CEO Hold")
        self.assertEqual(row.ceo_hold_by, CEO_HOLD_SYSTEM_USER)
        self.assertEqual(core.active_sources(p), {core.SOURCE_CASHFLOW})
        self.assertEqual(row.ceo_hold_recheck_scheduled, 0, "schedule cleared either way")
        self.assertIsNone(row.ceo_hold_recheck_date)

    def test_cron_keeps_current_status_when_condition_is_false(self):
        p = _make_project("cron-clear", cashflow_gap_limit=1)
        _schedule(p, date=add_days(today(), -1), status="Handover")
        core.set_reason(p, core.SOURCE_CASHFLOW, "stale reason from before the release")
        frappe.db.commit()

        with patch.object(cashflow, "_compute_cashflow_gap", return_value=0.0):
            _run_cron_for(p)

        row = _row(p)
        self.assertEqual(row.status, "Handover", "the released status is kept")
        self.assertEqual(
            core.active_sources(p), set(),
            "the frozen reason is re-derived from truth, not trusted",
        )
        self.assertEqual(row.ceo_hold_recheck_scheduled, 0)
        self.assertIsNone(row.ceo_hold_recheck_date)

    def test_completed_project_is_never_re_held(self):
        p = _make_project("cron-completed", cashflow_gap_limit=1)
        _schedule(p, date=today(), status="Completed")

        with patch.object(cashflow, "_compute_cashflow_gap", return_value=_OVER_LIMIT_GAP):
            totals = _run_cron_for(p)

        self.assertEqual(totals["skipped_terminal"], 1)
        row = _row(p)
        self.assertEqual(row.status, "Completed")
        self.assertEqual(row.ceo_hold_recheck_scheduled, 0, "the stale schedule is cleared")
        self.assertIsNone(row.ceo_hold_recheck_date)

    def test_halted_project_is_never_re_held(self):
        p = _make_project("cron-halted", cashflow_gap_limit=1)
        _schedule(p, date=add_days(today(), -2), status="Halted")

        with patch.object(cashflow, "_compute_cashflow_gap", return_value=_OVER_LIMIT_GAP):
            _run_cron_for(p)

        row = _row(p)
        self.assertEqual(row.status, "Halted")
        self.assertEqual(row.ceo_hold_recheck_scheduled, 0)

    def test_already_re_held_project_only_has_its_schedule_cleared(self):
        p = _make_project("cron-alreadyheld", cashflow_gap_limit=1)
        _schedule(p, date=today(), status="CEO Hold")
        _force(p, ceo_hold_by=CEO_AUTHORIZED_USER)

        _run_cron_for(p)

        row = _row(p)
        self.assertEqual(row.status, "CEO Hold")
        self.assertEqual(row.ceo_hold_by, CEO_AUTHORIZED_USER, "the manual hold is untouched")
        self.assertEqual(row.ceo_hold_recheck_scheduled, 0)

    def test_normal_hooks_resume_after_the_cron_clears_the_schedule(self):
        """The full loop: scheduled → hooks silent → cron → hooks live again."""
        p = _make_project("cron-resume", cashflow_gap_limit=1)
        _schedule(p, date=today())

        with patch.object(cashflow, "_compute_cashflow_gap", return_value=0.0):
            # Silent while scheduled.
            cashflow.on_project_payment(_FakePaymentDoc(p))
            self.assertEqual(_row(p).status, "WIP")
            # The recheck finds nothing wrong and hands control back to the hooks.
            _run_cron_for(p)

        self.assertEqual(_row(p).ceo_hold_recheck_scheduled, 0)
        self.assertEqual(_row(p).status, "WIP")

        _clear_trigger_dedup(p)
        with patch.object(cashflow, "_compute_cashflow_gap", return_value=_OVER_LIMIT_GAP):
            cashflow.on_project_payment(_FakePaymentDoc(p))

        self.assertEqual(
            _row(p).status, "CEO Hold", "a normal payment hook decides again once cleared"
        )


# --------------------------------------------------------------------------------- #
# 5. CEO Hold writes never restamp `modified` (owner ruling 2026-09-08)
# --------------------------------------------------------------------------------- #


class TestCeoHoldWritesLeaveModifiedAlone(CeoHoldRecheckTestCase):
    """`modified` / `modified_by` are the record of what a HUMAN last did to a project.

    Every write in the CEO Hold engine passes `update_modified=False`, so a system hold, a
    release, or the cron ending scheduled-recheck mode leaves the timestamp untouched — a
    nightly sweep must not reshuffle every list sorted on `modified`, nor make "last edited
    by" read as the system. These pin that; flipping any of those writes to
    `update_modified=True` turns all three red.
    """

    def test_system_hold_leaves_modified_alone(self):
        p = _make_project("modified-hold")
        _age_modified(p)

        core.set_reason(p, core.SOURCE_DN, "11 POs awaiting delivery")
        core.recompute_ceo_hold(p)

        self.assertEqual(_row(p).status, "CEO Hold", "the hold itself must still land")
        self.assertEqual(_modified(p), _ANCIENT)

    def test_release_leaves_modified_alone(self):
        p = _make_project("modified-release")
        core.set_reason(p, core.SOURCE_DN, "11 POs awaiting delivery")
        core.recompute_ceo_hold(p)
        _age_modified(p)

        core.clear_reason(p, core.SOURCE_DN)
        core.recompute_ceo_hold(p)

        self.assertEqual(_row(p).status, "WIP", "the release itself must still land")
        self.assertEqual(_modified(p), _ANCIENT)

    def test_cron_schedule_clear_leaves_modified_alone(self):
        p = _make_project("modified-cron", cashflow_gap_limit=1)
        _schedule(p, date=today())
        _age_modified(p)

        with patch.object(cashflow, "_compute_cashflow_gap", return_value=0.0):
            _run_cron_for(p)

        self.assertEqual(_row(p).ceo_hold_recheck_scheduled, 0, "the clear must still land")
        self.assertEqual(_modified(p), _ANCIENT)
