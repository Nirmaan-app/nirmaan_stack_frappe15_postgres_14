# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Tests for the CEO Hold multi-source projection core + the FORK-9 manual-release guard.

The keystone is `test_two_reasons_coexist_release_one_keeps_held` — the anti-clobber proof
that the multi-source model exists to provide (ADR-0004): two independent system reasons
hold one project, and releasing one does NOT release a project the other still wants held.

NOTE: these write Projects.status via the engine's set_value path (bypassing the manual
guard), exactly as production does. Each test cleans its own projects + reason rows.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.ceo_hold import core

_CITY = "ZzCeoHoldCoreTestCity"


def _make_project(suffix, status="WIP"):
    """Insert a Projects fixture (satisfies the generate_pwm after_insert hook)."""
    return (
        frappe.get_doc(
            {
                "doctype": "Projects",
                "project_name": f"CeoHoldCoreTest {suffix}",
                "project_city": _CITY,
                "project_state": "Test State",
                "project_start_date": "2025-01-01 00:00:00",
                "project_end_date": "2025-12-31 00:00:00",
                "project_scopes": {"scopes": []},
                "status": status,
            }
        )
        .insert(ignore_permissions=True)
        .name
    )


def _force_status(project, status, ceo_hold_by=None):
    """Set status/ceo_hold_by directly (bypasses validate — the system-write path)."""
    frappe.db.set_value(
        "Projects",
        project,
        {"status": status, "ceo_hold_by": ceo_hold_by},
        update_modified=False,
    )


def _status(project):
    return frappe.db.get_value("Projects", project, ["status", "ceo_hold_by"], as_dict=True)


def _cleanup():
    for name in frappe.get_all("Projects", filters={"project_city": _CITY}, pluck="name"):
        frappe.db.delete("CEO Hold Reason", {"project": name})
        frappe.delete_doc("Projects", name, ignore_permissions=True, force=True)
    frappe.db.commit()


class TestCeoHoldCore(FrappeTestCase):
    def tearDown(self):
        _cleanup()

    # --- set_reason / clear_reason -------------------------------------------- #

    def test_set_reason_idempotent_with_stable_set_at(self):
        p = _make_project("setreason")
        core.set_reason(p, core.SOURCE_DN, "first")
        rows = frappe.get_all(
            "CEO Hold Reason",
            filters={"project": p},
            fields=["name", "reason_text", "set_at"],
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].reason_text, "first")
        first_name, first_set_at = rows[0].name, rows[0].set_at

        # A second set with new text refreshes the text IN PLACE and keeps set_at stable.
        core.set_reason(p, core.SOURCE_DN, "second")
        rows = frappe.get_all(
            "CEO Hold Reason",
            filters={"project": p},
            fields=["name", "reason_text", "set_at"],
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].name, first_name)
        self.assertEqual(rows[0].reason_text, "second")
        self.assertEqual(rows[0].set_at, first_set_at)

    def test_clear_reason_and_clear_all(self):
        p = _make_project("clear")
        core.set_reason(p, core.SOURCE_DN, "dn")
        core.set_reason(p, core.SOURCE_CASHFLOW, "cf")
        self.assertEqual(core.active_sources(p), {core.SOURCE_DN, core.SOURCE_CASHFLOW})

        core.clear_reason(p, core.SOURCE_DN)
        self.assertEqual(core.active_sources(p), {core.SOURCE_CASHFLOW})

        core.clear_all_reasons(p)
        self.assertEqual(core.active_sources(p), set())

    # --- recompute: system-only hold + release -------------------------------- #

    def test_system_reason_holds_then_releases(self):
        p = _make_project("sysrelease", status="WIP")

        core.set_reason(p, core.SOURCE_DN, "5 POs")
        core.recompute_ceo_hold(p)
        row = _status(p)
        self.assertEqual(row.status, "CEO Hold")
        self.assertEqual(row.ceo_hold_by, core.CEO_HOLD_SYSTEM_USER)

        # Last reason cleared → release (no user-set Version → WIP fallback).
        core.clear_reason(p, core.SOURCE_DN)
        core.recompute_ceo_hold(p)
        row = _status(p)
        self.assertEqual(row.status, "WIP")
        self.assertIsNone(row.ceo_hold_by)

    # --- THE keystone: two reasons coexist; releasing one keeps held ---------- #

    def test_two_reasons_coexist_release_one_keeps_held(self):
        p = _make_project("coexist", status="WIP")
        core.set_reason(p, core.SOURCE_CASHFLOW, "gap over limit")
        core.set_reason(p, core.SOURCE_DN, "5 POs awaiting delivery")
        core.recompute_ceo_hold(p)
        self.assertEqual(_status(p).status, "CEO Hold")

        # Cashflow recovers → drop ONLY the cashflow reason. dn still holds it.
        core.clear_reason(p, core.SOURCE_CASHFLOW)
        core.recompute_ceo_hold(p)
        self.assertEqual(
            _status(p).status,
            "CEO Hold",
            "releasing one source must NOT release a project the other still holds",
        )

        # Deliveries complete → drop the dn reason too → now released.
        core.clear_reason(p, core.SOURCE_DN)
        core.recompute_ceo_hold(p)
        self.assertEqual(_status(p).status, "WIP")

    # --- manual hold preserved alongside a system reason ---------------------- #

    def test_manual_hold_preserved_with_system_reason(self):
        p = _make_project("manual", status="WIP")
        _force_status(p, "CEO Hold", ceo_hold_by="ceo@test.com")  # a manual hold

        # Adding a system reason must NOT overwrite the manual holder.
        core.set_reason(p, core.SOURCE_DN, "5 POs")
        core.recompute_ceo_hold(p)
        row = _status(p)
        self.assertEqual(row.status, "CEO Hold")
        self.assertEqual(row.ceo_hold_by, "ceo@test.com")

        # Removing the system reason: the manual hold still holds it (never auto-released).
        core.clear_reason(p, core.SOURCE_DN)
        core.recompute_ceo_hold(p)
        row = _status(p)
        self.assertEqual(row.status, "CEO Hold")
        self.assertEqual(row.ceo_hold_by, "ceo@test.com")

    # --- sync_delivery_pending threshold (strict > limit) --------------------- #

    def test_sync_delivery_pending_threshold(self):
        p = _make_project("threshold", status="WIP")
        limit = core.DN_PENDING_HOLD_THRESHOLD

        core.sync_delivery_pending(p, limit)  # at the limit → no hold
        self.assertEqual(core.active_sources(p), set())
        self.assertEqual(_status(p).status, "WIP")

        core.sync_delivery_pending(p, limit + 1)  # over the limit → hold
        self.assertEqual(core.active_sources(p), {core.SOURCE_DN})
        self.assertEqual(_status(p).status, "CEO Hold")

        core.sync_delivery_pending(p, limit)  # back to the limit → release
        self.assertEqual(core.active_sources(p), set())
        self.assertEqual(_status(p).status, "WIP")

    def test_dn_reason_text_carries_count_and_limit(self):
        text = core.dn_reason_text(7)
        self.assertIn("7", text)
        self.assertIn(str(core.DN_PENDING_HOLD_THRESHOLD), text)


class TestCeoHoldManualReleaseGuard(FrappeTestCase):
    """FORK 9: a manual move OFF CEO Hold is rejected while any reason row is active."""

    def tearDown(self):
        _cleanup()

    def test_manual_release_blocked_while_reason_active(self):
        p = _make_project("guard-blocked", status="WIP")
        _force_status(p, "CEO Hold", ceo_hold_by=core.CEO_HOLD_SYSTEM_USER)
        core.set_reason(p, core.SOURCE_DN, "5 POs awaiting delivery")

        doc = frappe.get_doc("Projects", p)
        doc.status = "WIP"
        with self.assertRaises(frappe.PermissionError):
            doc.save(ignore_permissions=True)

        # The release was rejected — the project stays on CEO Hold.
        self.assertEqual(frappe.db.get_value("Projects", p, "status"), "CEO Hold")

    def test_manual_release_allowed_when_no_reason(self):
        p = _make_project("guard-allowed", status="WIP")
        # A manual hold owned by the current session user, with NO reason rows.
        _force_status(p, "CEO Hold", ceo_hold_by=frappe.session.user)

        doc = frappe.get_doc("Projects", p)
        doc.status = "WIP"
        doc.save(ignore_permissions=True)  # no reasons → guard passes; self == holder

        self.assertEqual(frappe.db.get_value("Projects", p, "status"), "WIP")
