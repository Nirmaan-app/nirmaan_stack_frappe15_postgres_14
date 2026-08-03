"""
Project Action Item — the recompute-from-truth reconciler (the projection engine).

This module does ALL the DB I/O; the business definition lives in pure predicates
(predicates.py). The reconciler rebuilds a project's ENTIRE pending obligation set
from current document state and upserts the `Project Action Item` rows to match —
never delta, never increment/decrement a single row in isolation (§2 invariant 1).

Correctness guarantees (docs/prd/project-action-items.md §2/§4):
  * Idempotent + concurrency-safe — N runs (even concurrent, same project) yield the
    same rows and never abort on a UNIQUE violation. Keyed by
    `dedup_key = "{project}::{reference_name}::{action_type}"`.
  * Self-healing — `reconcile_all()` regenerates the whole table from scratch (also the
    backfill). The nightly sweep makes any missed event eventually correct.
  * Bulk queries only — three `get_all`s + pure-Python predicate eval (no per-PO N+1).

NO hooks / scheduler / endpoints are wired here — that is later phases. This is the
engine + its proof (tests) only.
"""

import frappe
from frappe.database.database import savepoint
from frappe.exceptions import DuplicateEntryError, UniqueValidationError
from frappe.utils import now_datetime

from nirmaan_stack.services.action_items.predicates import (
    ACTION_DC_PENDING,
    ACTION_DN_PENDING,
    ASSIGNED_ROLE_PM,
    LIVE_STATUSES,
    is_dc_pending,
    is_dn_pending,
)
from nirmaan_stack.services.ceo_hold import core as ceo_hold

# A duplicate dedup_key can surface as EITHER class depending on cache/timing — the
# in-app pre-check raises UniqueValidationError (<- ValidationError) while the DB unique
# index raises DuplicateEntryError (<- NameError). They share no useful MRO, so the
# savepoint get-or-create MUST catch BOTH (verified in Phase-0 testing; §14).
_DUP_ERRORS = (UniqueValidationError, DuplicateEntryError)

# Project statuses that SUPPRESS all action items (resolve everything + stop).
# Active set (keep generating) = WIP / Won / Handover / CEO Hold.
_SUPPRESS_PROJECT_STATUSES = frozenset({"Completed", "Halted"})

_REFERENCE_DOCTYPE = "Procurement Orders"


def _dedup_key(project, reference_name, action_type):
    return f"{project}::{reference_name}::{action_type}"


def _title_for(action_type, po):
    if action_type == ACTION_DN_PENDING:
        return f"Record Delivery Note — {po}"
    if action_type == ACTION_DC_PENDING:
        return f"Upload Delivery Challan — {po}"
    return f"{action_type} — {po}"


def _action_url_for(project, po):
    # Deep-link to the project page's DC & MIR tab (where both obligations are actioned).
    return f"/projects/{project}?page=projectdcmir"


def _compute_desired(project_name):
    """Compute the desired-Open set via THREE bulk queries + pure-Python predicate eval.

    Returns a dict ``{dedup_key: {action_type, reference_name, title, action_url}}``.
    No writes. The PO-load query is filtered to LIVE_STATUSES so Merged / Cancelled /
    Inactive / PO-Approved POs never enter the desired set (their Open rows therefore
    auto-resolve in the reconcile step).
    """
    pos = frappe.get_all(
        "Procurement Orders",
        filters={"project": project_name, "status": ["in", list(LIVE_STATUSES)]},
        fields=["name", "status", "billing_status"],
        limit_page_length=0,
    )
    if not pos:
        return {}

    po_names = [p["name"] for p in pos]

    item_rows = frappe.get_all(
        "Purchase Order Item",
        filters={"parent": ["in", po_names]},
        fields=[
            "parent",
            "category",
            "is_dispatched",
            "quantity",
            "received_quantity",
        ],
        limit_page_length=0,
    )
    items_by_po = {}
    for row in item_rows:
        items_by_po.setdefault(row["parent"], []).append(row)

    dc_rows = frappe.get_all(
        "PO Delivery Documents",
        filters={
            "parent_doctype": _REFERENCE_DOCTYPE,
            "parent_docname": ["in", po_names],
            "type": "Delivery Challan",
            "is_stub": 0,
        },
        fields=["parent_docname"],
        limit_page_length=0,
    )
    has_dc = {row["parent_docname"] for row in dc_rows}

    desired = {}
    for po in pos:
        name = po["name"]
        status = po["status"]
        billing = po.get("billing_status")
        items = items_by_po.get(name, [])

        if is_dn_pending(status, billing, items):
            key = _dedup_key(project_name, name, ACTION_DN_PENDING)
            desired[key] = {
                "action_type": ACTION_DN_PENDING,
                "reference_name": name,
                "title": _title_for(ACTION_DN_PENDING, name),
                "action_url": _action_url_for(project_name, name),
            }
        if is_dc_pending(status, billing, items, name in has_dc):
            key = _dedup_key(project_name, name, ACTION_DC_PENDING)
            desired[key] = {
                "action_type": ACTION_DC_PENDING,
                "reference_name": name,
                "title": _title_for(ACTION_DC_PENDING, name),
                "action_url": _action_url_for(project_name, name),
            }
    return desired


def _resolve_all_open(project_name):
    """Resolve EVERY currently-Open row for a project. Returns the count resolved."""
    open_rows = frappe.get_all(
        "Project Action Item",
        filters={"project": project_name, "status": "Open"},
        fields=["name"],
        limit_page_length=0,
    )
    ts = now_datetime()
    for row in open_rows:
        frappe.db.set_value(
            "Project Action Item",
            row["name"],
            {"status": "Resolved", "resolved_at": ts},
            update_modified=False,
        )
    return len(open_rows)


def _reopen(name, ts):
    frappe.db.set_value(
        "Project Action Item",
        name,
        {"status": "Open", "last_opened_at": ts, "resolved_at": None},
        update_modified=False,
    )


def _refresh_display(name, existing, payload):
    """No-op-or-refresh: update title/action_url only if they drifted."""
    updates = {}
    if existing.get("title") != payload["title"]:
        updates["title"] = payload["title"]
    if existing.get("action_url") != payload["action_url"]:
        updates["action_url"] = payload["action_url"]
    if updates:
        frappe.db.set_value(
            "Project Action Item", name, updates, update_modified=False
        )


def _insert_open_row(project_name, key, payload, ts):
    doc = frappe.new_doc("Project Action Item")
    doc.project = project_name
    doc.action_type = payload["action_type"]
    doc.reference_doctype = _REFERENCE_DOCTYPE
    doc.reference_name = payload["reference_name"]
    doc.status = "Open"
    doc.assigned_role = ASSIGNED_ROLE_PM
    doc.dedup_key = key
    doc.title = payload["title"]
    doc.action_url = payload["action_url"]
    doc.first_opened_at = ts
    doc.last_opened_at = ts
    doc.resolved_at = None
    doc.source = "reconcile"
    doc.insert(ignore_permissions=True, ignore_links=True)


def _create_or_reopen(project_name, key, payload, ts):
    """Get-or-create inside a savepoint (the concurrency-safe insert).

    A concurrent reconcile for the same project may win the INSERT race; the dup
    surfaces as UniqueValidationError OR DuplicateEntryError. The
    `savepoint(catch=_DUP_ERRORS)` context manager rolls back to the savepoint AND
    SWALLOWS the dup (it does NOT re-raise — verified: an outer `except` never fires),
    recovering the transaction. So we cannot detect the dup via `except`; instead we set
    `created` only AFTER `_insert_open_row()` returns inside the block — a dup unwinds
    past that line straight to the savepoint handler, leaving `created` False. If the
    insert was swallowed, the other writer's row exists → re-open it in place
    (get-or-create). The obligation is never lost and the call never aborts on a UNIQUE
    violation (§2 invariant 2, §14 Critical).
    """
    created = False
    with savepoint(catch=_DUP_ERRORS):
        _insert_open_row(project_name, key, payload, ts)
        created = True  # reached only if the INSERT did not raise (no dup)

    if created:
        return "opened"

    # The INSERT was a dup (swallowed + rolled back by the savepoint); another reconcile
    # created the row. Get-or-create → re-open the existing row in place.
    existing_name = frappe.db.get_value(
        "Project Action Item", {"dedup_key": key}, "name"
    )
    if existing_name:
        _reopen(existing_name, ts)
        return "reopened"
    # Extremely unlikely: the collision rolled back on both sides, freeing the slot.
    # Re-create cleanly (the unique slot is now free).
    _insert_open_row(project_name, key, payload, ts)
    return "opened"


def reconcile_project_action_items(project_name):
    """Recompute-from-truth reconcile for ONE project.

    Returns ``{"opened", "resolved", "reopened", "scanned"}``. Commits once at the end.

    Steps (plan §4):
      1. Per-project serialization lock (SELECT ... FOR UPDATE on the Projects row) —
         serializes a hook-triggered reconcile against the nightly sweep; combined with
         the savepoint get-or-create this closes the concurrent-insert race.
      2. Gate on project status — Completed/Halted → resolve ALL open rows + return.
      3. Compute the desired-Open set (three bulk queries + pure predicates).
      4. Reconcile existing rows vs desired (idempotent upsert; savepoint create).
      5. Commit once.
    """
    # (1) Per-project serialization lock. Lock on `name` (not `status`): the returned
    # name is None ONLY when the project row is absent, so this both confirms existence
    # and takes the row lock — while a project that exists with a NULL/blank status (a
    # valid active project) is NOT mistaken for a missing one.
    locked_name = frappe.db.get_value(
        "Projects", project_name, "name", for_update=True
    )
    if locked_name is None:
        # Unknown / deleted project — nothing to project. (Don't raise: the nightly
        # sweep and hooks must tolerate a stale project_name.)
        return {"opened": 0, "resolved": 0, "reopened": 0, "scanned": 0}

    project_status = frappe.db.get_value("Projects", project_name, "status")

    counts = {"opened": 0, "resolved": 0, "reopened": 0, "scanned": 0}
    ts = now_datetime()

    # (2) Project-status gate. NULL/blank status = active (not Completed/Halted) → keep.
    if project_status in _SUPPRESS_PROJECT_STATUSES:
        counts["resolved"] = _resolve_all_open(project_name)
        # A suppressed (Completed/Halted) project must not be held by ANY automatic
        # condition — clear every reason row and let recompute release the mirror if
        # nothing else holds it (ADR-0004). Clearing ALL reasons (not just dn_pending)
        # prevents recompute from resurrecting a terminal project off a stale reason.
        # Rides this function's single commit.
        ceo_hold.clear_all_reasons(project_name)
        ceo_hold.recompute_ceo_hold(project_name)
        frappe.db.commit()
        return counts

    # (3) Desired-Open set.
    desired = _compute_desired(project_name)
    counts["scanned"] = len(desired)

    # (4) Reconcile existing rows vs desired.
    existing_rows = frappe.get_all(
        "Project Action Item",
        filters={"project": project_name},
        fields=["name", "dedup_key", "status", "title", "action_url"],
        limit_page_length=0,
    )
    existing_by_key = {row["dedup_key"]: row for row in existing_rows}

    for key, payload in desired.items():
        existing = existing_by_key.get(key)
        if existing is None:
            outcome = _create_or_reopen(project_name, key, payload, ts)
            counts[outcome] += 1
        elif existing["status"] == "Open":
            _refresh_display(existing["name"], existing, payload)
        else:  # existing Resolved → re-open in place
            _reopen(existing["name"], ts)
            counts["reopened"] += 1

    # open ∧ not desired → resolve (also closes deleted/Merged/Cancelled PO rows).
    for key, row in existing_by_key.items():
        if row["status"] == "Open" and key not in desired:
            frappe.db.set_value(
                "Project Action Item",
                row["name"],
                {"status": "Resolved", "resolved_at": ts},
                update_modified=False,
            )
            counts["resolved"] += 1

    # (4b) Delivery-pending CEO Hold. The DN_PENDING count is already in `desired` (one
    # row per PO awaiting delivery); >4 holds the project, <=4 releases it. The write
    # rides this reconcile's single commit, under the Projects row lock already held
    # above. CEO Hold is deliberately NOT in _SUPPRESS_PROJECT_STATUSES, so a held
    # project keeps generating these rows and the count stays truthful (no oscillation).
    dn_pending_count = sum(
        1 for p in desired.values() if p["action_type"] == ACTION_DN_PENDING
    )
    ceo_hold.sync_delivery_pending(project_name, dn_pending_count)

    # (5) Commit once.
    frappe.db.commit()
    return counts


def _project_has_no_pm(project_name):
    """True iff the project resolves to zero Project-Manager-Profile users.

    Mirrors the `get_allowed_manager_users` pattern (Nirmaan User Permissions for_value
    + role_profile filter), keyed on a project NAME rather than a doc. Cheap two-step
    lookup; used only for the nightly orphan warning.
    """
    permitted = frappe.get_all(
        "Nirmaan User Permissions",
        filters={"for_value": project_name},
        fields=["user"],
        limit_page_length=0,
    )
    user_ids = [p["user"] for p in permitted]
    if not user_ids:
        return True
    pms = frappe.get_all(
        "Nirmaan Users",
        filters={
            "name": ["in", user_ids],
            "role_profile": ASSIGNED_ROLE_PM,
        },
        fields=["name"],
        limit_page_length=1,
    )
    return not pms


def reconcile_all():
    """Sweep every ACTIVE project → reconcile each, isolating failures per project.

    This is BOTH the nightly-sweep body AND the one-time backfill. Per-project
    try/except + rollback + log_error + continue (the pmo_task_renewal idiom) — one bad
    project can never poison the batch. The inner reconcile commits once per project, so
    reconcile_all does NOT double-commit; on failure it rolls back the partial project.

    Also logs a WARNING naming any project that has Open rows but resolves to zero PM
    users (the orphan check — those rows are still visible to Admin/PMO on Surface A, but
    no PM is assigned to act on them).

    Returns aggregate ``{opened, resolved, reopened, scanned, projects, failed}``.
    """
    # NOTE: a bare `["not in", [...]]` filter would DROP NULL/blank-status rows on
    # PostgreSQL (`NULL NOT IN (...)` is NULL, not TRUE). A blank-status project is a
    # valid ACTIVE project, so we sweep every project whose status is NOT one of the
    # suppress values — NULLs included — by listing the active set isn't possible (it's
    # open-ended), so we fetch all and filter in Python against the suppress set.
    all_projects = frappe.get_all(
        "Projects",
        fields=["name", "status"],
        limit_page_length=0,
    )
    projects = [
        p for p in all_projects if p.get("status") not in _SUPPRESS_PROJECT_STATUSES
    ]

    totals = {
        "opened": 0,
        "resolved": 0,
        "reopened": 0,
        "scanned": 0,
        "projects": 0,
        "failed": 0,
    }
    orphans = []

    for project in projects:
        name = project["name"]
        try:
            result = reconcile_project_action_items(name)
            totals["opened"] += result["opened"]
            totals["resolved"] += result["resolved"]
            totals["reopened"] += result["reopened"]
            totals["scanned"] += result["scanned"]
            totals["projects"] += 1

            # Orphan check: only worth a query when the project actually has Open rows.
            open_count = frappe.db.count(
                "Project Action Item", {"project": name, "status": "Open"}
            )
            if open_count > 0 and _project_has_no_pm(name):
                orphans.append((name, open_count))
        except Exception:
            frappe.db.rollback()
            totals["failed"] += 1
            frappe.log_error(
                frappe.get_traceback(),
                f"Project Action Item reconcile failed for {name}",
            )

    if orphans:
        detail = "\n".join(
            f"{name}: {count} open action item(s), no Project Manager assigned"
            for name, count in orphans
        )
        frappe.log_error(
            detail,
            "Project Action Item orphan warning — projects with open rows but no PM",
        )

    return totals
