# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Work Order lifecycle rules: which changes a Service Requests save may make, and who may make them.

This is the one place the server's Work Order status-move and lock rules live (spec #1528). The
Service Requests `validate` hook applies them (`integrations/controllers/service_requests.guard_lifecycle`),
so the SPA, Desk and the REST API all obey them.

Today it holds one rule (#1529): approving or rejecting a Work Order, and accepting or reverting its
amendment, takes Admin or Project Lead. Each of those saves moves the status INTO Approved or Rejected,
so the rule is written on that move: Vendor Selected -> Approved / Rejected, and Amendment -> Approved
(accept, and revert, which also writes the snapshot's items back). A new Work Order saved straight as
Approved or Rejected counts too.

The Finalize lock (#1539) and the amendment rules (#1540) add their checks to `change_problem`.

The approval record (#1532): the save that approves a Work Order (`is_approval`) stamps its
`approved_on` / `approved_by`, and every other save keeps them (`approval_record`, applied by the
doctype's own `validate`). The backfill patch `v3_0.backfill_work_order_approval` reads old history by
the same `is_approval` rule.

Pure: the caller resolves who the user is (`services/role_profiles.can_decide_work_order`) and passes
the answer in.
"""

import frappe

APPROVED = "Approved"
REJECTED = "Rejected"
AMENDMENT = "Amendment"

#: Stamped by the save that approves a Work Order and never moved after (`approval_record`).
APPROVAL_FIELDS = ("approved_on", "approved_by")

#: A save that moves a Work Order into one of these from any other status is an approver's decision.
DECISION_STATUSES = (APPROVED, REJECTED)

DECIDE_REFUSAL = (
    "Only Admin and Project Lead can approve or reject a Work Order, or accept or revert its amendment."
)


class WorkOrderChangeRefused(frappe.ValidationError):
    """The lifecycle rules forbid this Work Order save, for this user."""

    http_status_code = 403


def is_decision(before_status: str | None, after_status: str | None) -> bool:
    """True when a save moves the status into Approved or Rejected. `before_status` is None for a new
    Work Order."""
    return after_status in DECISION_STATUSES and before_status != after_status


def is_approval(before_status: str | None, after_status: str | None) -> bool:
    """True when a save approves a Work Order: a decision into Approved from anything but Amendment.
    Accepting or reverting an amendment also moves it into Approved, but it was approved already."""
    return after_status == APPROVED and is_decision(before_status, after_status) and before_status != AMENDMENT


def approval_record(before, after, *, user: str, now) -> dict:
    """The `approved_on` / `approved_by` a save of `after` over `before` stores (#1532).

    The save that approves stamps `now` and `user`. Every other save carries `before`'s values over,
    whatever it sends, so a later payment, invoice, GST, notes or amendment save never moves them.
    """
    if is_approval(before.get("status") if before else None, after.get("status")):
        return {"approved_on": now, "approved_by": user}
    return {field: before.get(field) if before else None for field in APPROVAL_FIELDS}


def change_problem(before, after, *, may_decide: bool) -> str | None:
    """Why this user may not save `after` over `before` (None for a new Work Order), or None when they may.

    `may_decide` is the user's answer to `role_profiles.WO_DECIDE_PROFILES`.
    """
    before_status = before.get("status") if before else None
    if is_decision(before_status, after.get("status")) and not may_decide:
        return DECIDE_REFUSAL
    return None
