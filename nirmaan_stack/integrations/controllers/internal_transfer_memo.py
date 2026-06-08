# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Internal Transfer Memo (ITM) lifecycle controller.

ITMs are created directly from the inventory picker via
``api.internal_transfers.create_itms`` and are born in "Approved" status —
there is no separate approval step. This controller handles:

  * basic invariants and the Approved → Dispatched → Delivered state machine
  * the cross-cutting availability guard used by picker / create / delete
  * realtime events on insert, dispatch, and delivery transitions
  * warehouse-stock side-effects on dispatch
"""

import frappe
from frappe.utils import flt, now


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ADMIN_ROLE = "Nirmaan Admin Profile"

# Roles allowed to dispatch an Approved ITM. Mirrors `ITM_DISPATCH_ROLES`
# on the frontend so UI gating and backend enforcement stay in sync.
DISPATCH_ROLES = (
    "Nirmaan Admin Profile",
    "Nirmaan Procurement Executive Profile",
)

# Roles allowed to delete a pre-dispatch ITM. Mirrors `ITM_DELETE_ROLES` on
# the frontend (Admin / PMO Executive / Procurement Executive). Owner check
# is intentionally NOT required — any creator-eligible role can clean up an
# Approved ITM regardless of who originally raised it.
DELETE_ROLES = (
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Procurement Executive Profile",
)

# Statuses where deletion is blocked (dispatch/delivery has begun).
DELETE_BLOCKED_STATUSES = ("Dispatched", "Partially Delivered", "Delivered")

# Valid state transitions: old_status -> set of allowed new statuses.
ALLOWED_TRANSITIONS = {
    None: {"Approved"},  # Created by ITR approval
    "Approved": {"Approved", "Dispatched"},
    "Dispatched": {"Dispatched", "Partially Delivered", "Delivered"},
    "Partially Delivered": {"Partially Delivered", "Delivered"},
    "Delivered": {"Delivered"},
}


# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------

def validate(doc, method):
    """Enforce invariants and state machine on every save."""
    _validate_basic_invariants(doc)

    old_status = _get_old_status(doc)
    new_status = doc.status

    _validate_state_transition(doc, old_status, new_status)
    _stamp_lifecycle_fields(doc, old_status, new_status)
    _recompute_totals(doc)


def before_delete(doc, method):
    """Block deletion after dispatch and gate on `DELETE_ROLES`."""
    if doc.status in DELETE_BLOCKED_STATUSES:
        frappe.throw("Cannot delete a dispatched or delivered Internal Transfer Memo.")

    _require_deleter(
        "Only administrators, PMO executives, or procurement executives "
        "may delete an Internal Transfer Memo."
    )


def after_insert(doc, method):
    """Emit `itm:created` to admins + creator on first insert.

    Replaces the legacy `itr:new` event from the previous two-step flow —
    ITMs are now born `Approved` and admins should learn about them as
    soon as the picker submission lands.

    **Batch-create coordination.** When called inside ``create_itms`` the
    flag ``itm_create_in_progress`` is set on ``frappe.flags``; we skip the
    commit + publish here so the endpoint can keep all inserts in one
    transaction (preserving its savepoint atomicity) and publish a single
    batch of events after the final commit. Single-doc inserts (Frappe Desk,
    tests, scripts) hit the normal commit-then-publish path.
    """
    if frappe.flags.get("itm_create_in_progress"):
        return

    recipients = _get_admins() | {doc.owner}
    message = {"itm": doc.name, "status": doc.status}
    frappe.db.commit()
    for user in recipients:
        if user:
            frappe.publish_realtime(event="itm:created", message=message, user=user)


def on_update(doc, method):
    """Emit real-time events and adjust warehouse stock on status transitions."""
    _adjust_warehouse_stock_on_dispatch(doc)
    _emit_transition_events(doc)


def _adjust_warehouse_stock_on_dispatch(doc):
    """When ITM source=Warehouse transitions Approved → Dispatched, deduct stock."""
    before = doc.get_doc_before_save()
    if not before:
        return
    old_status = before.status
    new_status = doc.status
    if old_status == "Approved" and new_status == "Dispatched":
        source_type = getattr(doc, "source_type", None) or "Project"
        if source_type == "Warehouse":
            from nirmaan_stack.integrations.controllers.warehouse_stock import (
                adjust_on_dispatch_from_warehouse,
            )
            adjust_on_dispatch_from_warehouse(doc)


# ---------------------------------------------------------------------------
# Validate helpers
# ---------------------------------------------------------------------------

def _validate_basic_invariants(doc):
    source_type = getattr(doc, "source_type", None) or "Project"
    target_type = getattr(doc, "target_type", None) or "Project"

    if target_type == "Project" and not doc.target_project:
        frappe.throw("Target Project is required for project transfers.")
    if source_type == "Warehouse" and target_type == "Warehouse":
        frappe.throw("Source and target cannot both be Warehouse.")
    if (
        source_type == "Project" and target_type == "Project"
        and doc.source_project and doc.target_project
        and doc.source_project == doc.target_project
    ):
        frappe.throw("Source and target projects must differ.")

    if not doc.items:
        frappe.throw("At least one item is required.")

    for row in doc.items:
        qty = flt(row.transfer_quantity)
        if qty <= 0:
            frappe.throw(f"Row {row.idx}: transfer quantity must be greater than zero.")


def _get_old_status(doc):
    if doc.is_new():
        return None
    before = doc.get_doc_before_save()
    if before is not None:
        return before.status
    return frappe.db.get_value(doc.doctype, doc.name, "status")


def _validate_state_transition(doc, old_status, new_status):
    # System-initiated recalculation (DN edit / delete) is the only legitimate
    # source of backward transitions like Delivered → Partially Delivered or
    # → Dispatched. Trust the aggregation in that path and skip the forward-
    # only state-machine check.
    if doc.flags.get("from_dn_recalc"):
        return

    allowed = ALLOWED_TRANSITIONS.get(old_status)
    if allowed is None or new_status not in allowed:
        frappe.throw(
            f"Invalid status transition: {old_status or 'None'} → {new_status}"
        )

    if old_status == "Approved" and new_status == "Dispatched":
        _require_dispatcher(
            "Only administrators or procurement executives may dispatch "
            "Internal Transfer Memos."
        )


def _require_dispatcher(message):
    """Permit users whose ``role_profile_name`` is in ``DISPATCH_ROLES``
    (or the special ``Administrator`` user).

    We compare against the user's *role profile* (the same string the frontend
    uses via ``useUserData`` / ``data.role_profile``) — NOT ``frappe.get_roles``.
    Frappe role profiles assign multiple underlying roles to a user, and
    ``get_roles`` returns those underlying roles which don't include the
    profile name itself. Comparing against ``role_profile_name`` directly
    keeps frontend gating and backend enforcement reading from the same value.
    """
    user = frappe.session.user
    if user == "Administrator":
        return
    role_profile = frappe.db.get_value("User", user, "role_profile_name")
    if role_profile in DISPATCH_ROLES:
        return
    frappe.throw(message, frappe.PermissionError)


def _require_deleter(message):
    """Permit users whose ``role_profile_name`` is in ``DELETE_ROLES``
    (or the special ``Administrator`` user). Mirrors ``_require_dispatcher``.
    """
    user = frappe.session.user
    if user == "Administrator":
        return
    role_profile = frappe.db.get_value("User", user, "role_profile_name")
    if role_profile in DELETE_ROLES:
        return
    frappe.throw(message, frappe.PermissionError)


def _stamp_lifecycle_fields(doc, old_status, new_status):
    if doc.is_new() and not doc.requested_by:
        doc.requested_by = frappe.session.user

    if old_status == "Approved" and new_status == "Dispatched":
        doc.dispatched_by = frappe.session.user
        doc.dispatched_on = now()


def _recompute_totals(doc):
    items = doc.items or []
    doc.total_items = len(items)
    doc.total_quantity = sum(flt(r.transfer_quantity) for r in items)
    doc.estimated_value = sum(
        flt(r.transfer_quantity) * flt(r.estimated_rate) for r in items
    )


# ---------------------------------------------------------------------------
# Real-time event helpers
# ---------------------------------------------------------------------------

def _emit_transition_events(doc):
    """Emit Socket.IO events based on ITM status transitions."""
    before = doc.get_doc_before_save()
    if not before:
        return

    old_status = before.status
    new_status = doc.status
    if old_status == new_status:
        return

    event = None
    target_type = getattr(doc, "target_type", None) or "Project"
    if old_status == "Approved" and new_status == "Dispatched":
        event = "itm:dispatched"
        if target_type == "Warehouse":
            recipients = _get_admins() | {doc.requested_by}
        else:
            recipients = _get_project_users(doc.target_project) | {doc.requested_by}
    elif new_status in ("Delivered", "Partially Delivered"):
        event = "itm:delivered"
        recipients = {doc.requested_by}

    if not event:
        return

    message = {"itm": doc.name, "status": new_status}
    frappe.db.commit()
    for user in recipients:
        if user:
            frappe.publish_realtime(event=event, message=message, user=user)


def _get_admins():
    """Return set of users with the Admin role profile."""
    return {
        r.parent for r in frappe.get_all(
            "Has Role", filters={"role": ADMIN_ROLE, "parenttype": "User"},
            fields=["parent"],
        )
    }


def _get_project_users(project):
    """Return set of users with User Permission for a project."""
    if not project:
        return set()
    return {
        r.user for r in frappe.get_all(
            "User Permission",
            filters={"allow": "Projects", "for_value": project},
            fields=["user"],
        )
    }


# ---------------------------------------------------------------------------
# Availability guard
# ---------------------------------------------------------------------------
#
# Reservation model after the ITR collapse:
#
#   reserved_qty = SUM(ITMI.transfer_quantity) where parent ITM is in
#                  status='Approved' (i.e. created but not yet dispatched).
#
# The picker SQL (`get_inventory_picker_data`) and the `create_itms` create-time
# guard both consult these helpers. Once an ITM transitions to Dispatched+,
# the row drops out of `reserved_qty` and is picked up instead by the
# `dispatched_itm_deductions` leg keyed off `dispatched_on > RIR.modified`.
#
# `make` is mandatory in the bucket key — different makes of the same item
# never share an availability budget. SQL uses `IS NOT DISTINCT FROM` so
# NULL ↔ NULL matches as equal (unlike plain `=`).


def available_quantity(item_id, source_project, exclude_itm=None, make=None):
    """Available transfer qty for ``(item_id, source_project, make)``.

    Three legs:

    1. Latest **submitted** RIR's ``remaining_quantity`` for the bucket.
    2. Reserved by **Approved** ITMs that haven't been dispatched yet.
    3. Subtract Dispatched/Partially Delivered/Delivered ITMs whose
       ``dispatched_on > RIR.modified`` (post-submit dispatches not yet
       reflected in the report).

    Args:
        item_id: Item primary key.
        source_project: Source project to draw from.
        exclude_itm: Optional ITM name to exclude from the reservation
            sum (used during edit/re-validate flows so a doc doesn't
            count itself).
        make: Make/brand bucket. Empty string is normalised to NULL.

    Returns ``0.0`` when no submitted RIR exists or the item has no entry.
    """
    if not item_id or not source_project:
        return 0.0

    if isinstance(make, str):
        make = make.strip() or None

    rie_make_filter = "AND rie.make IS NOT DISTINCT FROM %(make)s" if make is not None else ""
    itmi_make_filter = "AND itmi.make IS NOT DISTINCT FROM %(make)s" if make is not None else ""

    # Leg 1 — Latest submitted RIR.
    # Key the deduction window on `modified` (not report_date) so same-day
    # post-submit dispatches are still deducted.
    latest_rir = frappe.db.sql(
        f"""
        SELECT COALESCE(SUM(rie.remaining_quantity), 0) AS qty,
               rir.report_date,
               rir.modified
        FROM "tabRemaining Item Entry" rie
        JOIN "tabRemaining Items Report" rir ON rie.parent = rir.name
        WHERE rir.project = %(src)s
          AND rir.status = 'Submitted'
          AND rir.name = (
            SELECT name FROM "tabRemaining Items Report"
            WHERE project = %(src)s AND status = 'Submitted'
            ORDER BY report_date DESC, creation DESC LIMIT 1
          )
          AND rie.item_id = %(item)s
          {rie_make_filter}
        GROUP BY rir.report_date, rir.modified
        """,
        {"src": source_project, "item": item_id, "make": make},
        as_dict=True,
    )
    rir_qty = flt(latest_rir[0].qty) if latest_rir else 0.0
    rir_modified = latest_rir[0].modified if latest_rir else None

    # Leg 2 — Reservations: Approved ITMs not yet dispatched.
    reserved = frappe.db.sql(
        f"""
        SELECT COALESCE(SUM(itmi.transfer_quantity), 0)
        FROM "tabInternal Transfer Memo Item" itmi
        JOIN "tabInternal Transfer Memo" itm ON itmi.parent = itm.name
        WHERE itm.source_project = %(src)s
          AND itm.source_type = 'Project'
          AND itm.status = 'Approved'
          AND itmi.item_id = %(item)s
          {itmi_make_filter}
          AND (%(exclude)s IS NULL OR itm.name != %(exclude)s)
        """,
        {"src": source_project, "item": item_id, "exclude": exclude_itm, "make": make},
    )
    reserved_qty = flt(reserved[0][0]) if reserved else 0.0

    # Leg 3 — Post-RIR dispatched ITMs.
    itm_deduction = 0.0
    if rir_modified:
        itm_ded = frappe.db.sql(
            f"""
            SELECT COALESCE(SUM(itmi.transfer_quantity), 0)
            FROM "tabInternal Transfer Memo Item" itmi
            JOIN "tabInternal Transfer Memo" itm ON itmi.parent = itm.name
            WHERE itm.source_project = %(src)s
              AND itmi.item_id = %(item)s
              {itmi_make_filter}
              AND itm.status IN ('Dispatched', 'Partially Delivered', 'Delivered')
              AND itm.dispatched_on > %(rir_modified)s
            """,
            {"src": source_project, "item": item_id, "rir_modified": rir_modified, "make": make},
        )
        itm_deduction = flt(itm_ded[0][0]) if itm_ded else 0.0

    return max(rir_qty - reserved_qty - itm_deduction, 0.0)


def warehouse_available_quantity(item_id, make=None, exclude_itm=None):
    """Available warehouse stock for ``(item_id, make)``.

    On-hand (``Warehouse Stock Item.quantity``) minus Approved-but-not-yet-
    dispatched ITMs from the warehouse with the same ``make`` bucket.

    Args:
        item_id: Item primary key.
        make: Empty-string / falsy → NULL bucket.
        exclude_itm: Optional ITM name to exclude (edit/re-validate flows).
    """
    if not item_id:
        return 0.0

    make = make or None

    on_hand = frappe.db.get_value(
        "Warehouse Stock Item",
        {"item_id": item_id, "make": make},
        "quantity",
    ) or 0.0
    on_hand = flt(on_hand)

    approved_itm = frappe.db.sql(
        """
        SELECT COALESCE(SUM(itmi.transfer_quantity), 0)
        FROM "tabInternal Transfer Memo Item" itmi
        JOIN "tabInternal Transfer Memo" itm ON itmi.parent = itm.name
        WHERE itm.source_type = 'Warehouse'
          AND itmi.item_id = %(item)s
          AND itmi.make IS NOT DISTINCT FROM %(make)s
          AND itm.status = 'Approved'
          AND (%(exclude)s IS NULL OR itm.name != %(exclude)s)
        """,
        {"item": item_id, "make": make, "exclude": exclude_itm},
    )
    reserved_itm = flt(approved_itm[0][0]) if approved_itm else 0.0

    return max(on_hand - reserved_itm, 0.0)
