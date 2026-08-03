# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""
Seed CEO Hold Reason rows for existing AUTOMATIC (cashflow) CEO Holds.

ADR-0004 moves automatic CEO Holds to a reason-row projection. Projects currently held by
the cashflow system marker have no reason row yet, so this one-time patch re-syncs each
through `sync_cashflow_reason` — which seeds an accurate `cashflow` reason if the gap is
still over limit, or releases the (now-recovered) hold, bringing state to truth.

MANUAL holds (a real-user `ceo_hold_by`) are left untouched. DELIVERY-PENDING reasons are
seeded by the next action-item reconcile (the nightly sweep or the first PO/DN/DC event),
NOT here — no heavy full reconcile in the patch. Commits per project so one failure can't
abort the batch (and can't discard already-seeded projects). Idempotent.
"""

import frappe

from nirmaan_stack.constants.authorized_users import CEO_HOLD_SYSTEM_USER


def execute():
    projects = frappe.get_all(
        "Projects",
        filters={"status": "CEO Hold", "ceo_hold_by": CEO_HOLD_SYSTEM_USER},
        pluck="name",
    )
    if not projects:
        return

    from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import (
        sync_cashflow_reason,
    )

    for name in projects:
        try:
            sync_cashflow_reason(name)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            frappe.log_error(
                frappe.get_traceback(),
                f"seed_ceo_hold_reasons failed for {name}",
            )
