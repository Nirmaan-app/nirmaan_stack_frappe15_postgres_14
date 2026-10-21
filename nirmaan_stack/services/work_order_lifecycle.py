# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Work Order lifecycle rules: which changes a Service Requests save may make, and who may make them.

This is the one place the server's Work Order status-move and lock rules live (spec #1528). The
Service Requests `validate` hook applies them (`integrations/controllers/service_requests.guard_lifecycle`),
and its `on_trash` hook applies `delete_problem` (`guard_delete`), so the SPA, Desk and the REST API all
obey them.

Who decides (#1529): approving or rejecting a Work Order, and accepting or reverting its amendment, takes
Admin or Project Lead. Each of those saves moves the status INTO Approved or Rejected, so the rule is
written on that move: Vendor Selected -> Approved / Rejected, and Amendment -> Approved (accept, and
revert, which also writes the snapshot's items back). A new Work Order saved straight as Approved or
Rejected counts too.

The Finalize lock (#1539, GLOSSARY *Finalized (Work Order)*): a Finalized Work Order's scope is closed.
Its status (so Amend), vendor, project, GST flag, terms, items, categories and total do not change, for
anyone, Admin included, and it is not deleted. Everything else stays open: payments and the figures they
recount, invoices, remarks, the Nirmaan GST and the PDF. The one GST change let through is Match GST to
vendor (`gst_from_vendor`). The finalize flag itself moves only through Finalize and Revert Finalization
(`api/sr_finalize`, `finalize_action`), which write the audit remark.

The amendment rules (#1540) add their checks to `change_problem`.

Pure: the caller resolves who the user is (`services/role_profiles.can_decide_work_order`) and which
server action is saving, and passes the answers in.
"""

import json
from decimal import Decimal

import frappe

APPROVED = "Approved"
REJECTED = "Rejected"

#: A save that moves a Work Order into one of these from any other status is an approver's decision.
DECISION_STATUSES = (APPROVED, REJECTED)

DECIDE_REFUSAL = (
    "Only Admin and Project Lead can approve or reject a Work Order, or accept or revert its amendment."
)

#: The WO page's banner shows this text word for word (`frontend/src/pages/ServiceRequests/config/finalizedLock.ts`).
FINALIZED_REFUSAL = (
    "This Work Order is Finalized: it can't be amended or deleted, and its items, total, vendor, "
    "GST and terms are locked. Payments, invoices and remarks stay open. "
    "Revert Finalization unlocks it."
)

FINALIZE_FLAG_REFUSAL = (
    "A Work Order is finalized only with Finalize, and unlocked only with Revert Finalization."
)

#: What a Finalized Work Order's save may not change. `gst` gives way to Match GST to vendor.
LOCKED_FIELDS = (
    "status",
    "vendor",
    "project",
    "gst",
    "notes",
    "work_order_items",
    "service_order_list",
    "service_category_list",
    "total_amount",
)

CHILD_TABLES = frozenset(("work_order_items",))

#: A child row's bookkeeping, which a save rewrites without changing the row.
_ROW_BOOKKEEPING = frozenset(
    ("name", "owner", "creation", "modified", "modified_by", "docstatus", "idx",
     "parent", "parentfield", "parenttype", "doctype")
)


class WorkOrderChangeRefused(frappe.ValidationError):
    """The lifecycle rules forbid this Work Order save, for this user."""

    http_status_code = 403


def is_decision(before_status: str | None, after_status: str | None) -> bool:
    """True when a save moves the status into Approved or Rejected. `before_status` is None for a new
    Work Order."""
    return after_status in DECISION_STATUSES and before_status != after_status


def is_finalized(doc) -> bool:
    return bool(doc) and str(doc.get("is_finalized") or 0) not in ("0", "False", "")


def change_problem(
    before, after, *, may_decide: bool, gst_from_vendor: bool = False, finalize_action: bool = False
) -> str | None:
    """Why this save of `after` over `before` (None for a new Work Order) is refused, or None when it may go.

    `may_decide`: the user's answer to `role_profiles.WO_DECIDE_PROFILES`. `gst_from_vendor`: the server set
    the GST flag from the vendor (`flags.gst_set_from_vendor`). `finalize_action`: Finalize or Revert
    Finalization is saving (`flags.finalize_action`).
    """
    before_status = before.get("status") if before else None
    if is_decision(before_status, after.get("status")) and not may_decide:
        return DECIDE_REFUSAL
    if is_finalized(before) != is_finalized(after) and not finalize_action:
        return FINALIZE_FLAG_REFUSAL
    if is_finalized(before) and _locked_changes(before, after, gst_from_vendor=gst_from_vendor):
        return FINALIZED_REFUSAL
    return None


def delete_problem(doc) -> str | None:
    """Why `doc` may not be deleted, or None when it may."""
    return FINALIZED_REFUSAL if is_finalized(doc) else None


def _locked_changes(before, after, *, gst_from_vendor: bool) -> list[str]:
    fields = [f for f in LOCKED_FIELDS if not (f == "gst" and gst_from_vendor)]
    return [f for f in fields if _comparable_field(before, f) != _comparable_field(after, f)]


def _comparable_field(doc, field):
    value = doc.get(field)
    if field in CHILD_TABLES:
        return [_comparable_row(row) for row in value or []]
    return _comparable(value)


def _comparable_row(row) -> dict:
    """A child row's own values, without the bookkeeping a save rewrites."""
    values = row.as_dict() if hasattr(row, "as_dict") else row
    return {
        k: _comparable(v) for k, v in values.items() if k not in _ROW_BOOKKEEPING and not k.startswith("_")
    }


def _comparable(value):
    """`value` in one shape whatever path brought it: a JSON field as text (Desk) or parsed (the database),
    a number as int, float or Decimal, a blank as "" or None."""
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text[0] in "[{":
            try:
                return _comparable(json.loads(text))
            except ValueError:
                return text
        return text
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float, Decimal)):
        return round(float(value), 6)
    if isinstance(value, (list, tuple)):
        return [_comparable(v) for v in value]
    if isinstance(value, dict):
        return {k: _comparable(v) for k, v in value.items()}
    return value
