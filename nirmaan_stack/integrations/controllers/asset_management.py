"""Asset Management (the current assignment) -> the asset's holder, department and history.

An Asset Management record exists only while someone holds the asset: it is created on Assign and
deleted on Unassign. The permanent record is the asset's `Asset History`, written here.
"""

import frappe

from nirmaan_stack.services.asset_history import (
    ASSIGNED,
    DECLARATION_SIGNED,
    DECLARATION_UPLOADED,
    UNASSIGNED,
    add_history,
)

ASSET_MASTER_DOCTYPE = "Asset Master"
ASSET_MANAGEMENT_DOCTYPE = "Asset Management"
DECLARATION_FIELD = "asset_declaration_attachment"


def after_insert(doc, method):
    """Make the person the asset's holder, move the asset's department if the assignment does, and
    record the assignment (and a declaration that came with it) in the history.

    `set_value` skips Asset Master's validate on purpose: that validate refuses a department change on
    an asset that was assigned before, and an assignment with a reason is exactly the sanctioned way
    to move one. Nothing is derived from these two fields, so no recompute is skipped.
    """
    if not (doc.asset and doc.asset_assigned_to):
        return

    move = doc.flags.department_move
    updates = {"current_assignee": doc.asset_assigned_to}
    if move:
        updates["department"] = move[1]
    frappe.db.set_value(ASSET_MASTER_DOCTYPE, doc.asset, updates)

    add_history(
        doc.asset,
        ASSIGNED,
        assigned_to=doc.asset_assigned_to,
        from_department=move[0] if move else None,
        to_department=move[1] if move else None,
        reason=doc.flags.department_reason,
    )
    if doc.get(DECLARATION_FIELD):
        add_history(
            doc.asset, DECLARATION_UPLOADED, assigned_to=doc.asset_assigned_to, declaration=doc.get(DECLARATION_FIELD)
        )


def on_update(doc, method):
    """Keep the holder in step, and record a declaration signed or uploaded after the assignment."""
    if not doc.asset:
        return
    frappe.db.set_value(ASSET_MASTER_DOCTYPE, doc.asset, "current_assignee", doc.asset_assigned_to)
    notify_asset_changed(doc.asset)  # runs on insert too, so it covers Assign as well

    if doc.flags.in_insert:
        return  # after_insert already recorded a declaration that came with the assignment
    if doc.has_value_changed(DECLARATION_FIELD) and doc.get(DECLARATION_FIELD):
        add_history(
            doc.asset,
            DECLARATION_SIGNED if doc.flags.e_signed else DECLARATION_UPLOADED,
            assigned_to=doc.asset_assigned_to,
            declaration=doc.get(DECLARATION_FIELD),
        )


def on_trash(doc, method):
    """Unassign: record it, keep the declaration, and free the asset.

    Frappe deletes a record's attached files right after on_trash, which used to delete the signed
    declaration with the assignment; `move_files_to_asset` keeps them.

    The asset is freed only when it still names this person -- an older duplicate assignment being
    removed must not clear the real holder.
    """
    if not doc.asset:
        return

    # Every unassign says why (owner, 2026-10-13). The reason rides on the record's flags from
    # `api/assets/assign.unassign_asset`, which checked it; a Desk or API delete carries none.
    reason = doc.flags.unassign_reason
    if not reason:
        frappe.throw(
            "Give a reason for unassigning. Unassign from the asset page or the person's profile, "
            "where the reason is asked."
        )

    add_history(doc.asset, UNASSIGNED, assigned_to=doc.asset_assigned_to, reason=reason)
    move_files_to_asset(doc.name, doc.asset)
    notify_asset_changed(doc.asset)

    if frappe.db.get_value(ASSET_MASTER_DOCTYPE, doc.asset, "current_assignee") == doc.asset_assigned_to:
        free_asset(doc.asset)


def free_asset(asset: str) -> None:
    """Clear the asset's holder and the project it was assigned for.

    asset_city / asset_state are fetched from `project`; set_value skips Asset Master's validate,
    which would otherwise blank them when the project is cleared, so they are cleared here too.
    Nothing else is derived from these fields, so no recompute is skipped.
    """
    frappe.db.set_value(
        ASSET_MASTER_DOCTYPE,
        asset,
        {"current_assignee": None, "project": None, "asset_city": None, "asset_state": None},
    )


def move_files_to_asset(assignment: str, asset: str) -> None:
    """Re-attach the files of an assignment that is being removed (its declaration) to the asset.

    Their URL (the storage key) does not change, so the history's links keep working. `set_value` on
    File skips File's hooks on purpose: only the attachment link changes, not the stored object.
    """
    for file_name in frappe.get_all(
        "File",
        filters={"attached_to_doctype": ASSET_MANAGEMENT_DOCTYPE, "attached_to_name": assignment},
        pluck="name",
    ):
        frappe.db.set_value(
            "File",
            file_name,
            {"attached_to_doctype": ASSET_MASTER_DOCTYPE, "attached_to_name": asset, "attached_to_field": None},
        )


def notify_asset_changed(asset: str) -> None:
    """Tell pages that have the asset open to reload it.

    These hooks write Asset Master with `set_value` and add history rows directly, so none of the
    realtime events a document save sends go out, and an asset page open in another tab would stay
    stale. This is the event a save publishes (Document.notify_update), sent once the transaction commits.
    """
    frappe.publish_realtime(
        "doc_update",
        {
            "doctype": ASSET_MASTER_DOCTYPE,
            "name": asset,
            "modified": frappe.db.get_value(ASSET_MASTER_DOCTYPE, asset, "modified"),
        },
        doctype=ASSET_MASTER_DOCTYPE,
        docname=asset,
        after_commit=True,
    )
