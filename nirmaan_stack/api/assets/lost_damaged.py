"""Mark an asset Lost/Damaged, or bring it back Found/Repaired -- Admin and HR only (owner, 2026-10-31).

The rules are in `services/asset_lost_damaged.py`. Each endpoint locks the asset row first and reads its state
inside the lock, so it can't race an Assign (which locks the same row) or a second click: the loser gets a plain
"just changed ... Reload" message.
"""

import frappe

from nirmaan_stack.api.assets.assign import end_assignment
from nirmaan_stack.integrations.controllers.asset_management import notify_asset_changed
from nirmaan_stack.services.asset_audit_open import is_serialization_failure
from nirmaan_stack.services.asset_history import ASSET_FOUND_REPAIRED, ASSET_LOST_DAMAGED, add_history
from nirmaan_stack.services.asset_lost_damaged import (
    MARK,
    RECOVER,
    UNASSIGN_REASON,
    lost_damaged_refusal,
    reason_text,
)
from nirmaan_stack.services.role_profiles import ASSET_LOST_DAMAGED_PROFILES, has_role_profile

ASSET_MASTER_DOCTYPE = "Asset Master"


@frappe.whitelist(methods=["POST"])
def mark_lost_damaged(asset: str, reason: str) -> dict:
    """Mark `asset` Lost/Damaged. A held asset is unassigned at once, in this same transaction.

    Args:
        asset: Asset Master name.
        reason: what happened (at least 10 characters), e.g. "Stolen from site vehicle on 29 Oct".

    Returns:
        {"asset": <asset>, "had": <the holder whose assignment ended, or None>}

    Example:
        POST /api/method/nirmaan_stack.api.assets.lost_damaged.mark_lost_damaged
        {"asset": "ASSET-LAP-029", "reason": "Screen cracked at site, sent to the service centre"}
    """
    _check_may_mark()
    state = _lock(asset)
    refusal = lost_damaged_refusal(MARK, state.lost_damaged, reason)
    if refusal:
        frappe.throw(refusal)

    holder = state.current_assignee
    if holder:
        end_assignment(asset, UNASSIGN_REASON)
    # set_value skips Asset Master's hooks: its on_update only records department changes, and nothing is derived
    # from this flag. AssetMaster.validate refuses the flag changing on a save, so it is written only here.
    frappe.db.set_value(ASSET_MASTER_DOCTYPE, asset, "lost_damaged", 1)
    add_history(asset, ASSET_LOST_DAMAGED, assigned_to=holder, reason=reason_text(reason))
    frappe.db.commit()
    notify_asset_changed(asset)
    return {"asset": asset, "had": holder}


@frappe.whitelist(methods=["POST"])
def mark_found_repaired(asset: str, reason: str) -> dict:
    """Bring a Lost/Damaged `asset` back. It becomes Unassigned; nobody gets it until it is assigned again.

    Args:
        asset: Asset Master name.
        reason: what happened (at least 10 characters), e.g. "Back from the service centre, working".

    Returns:
        {"asset": <asset>}

    Example:
        POST /api/method/nirmaan_stack.api.assets.lost_damaged.mark_found_repaired
        {"asset": "ASSET-LAP-029", "reason": "Back from the service centre with a new screen"}
    """
    _check_may_mark()
    state = _lock(asset)
    refusal = lost_damaged_refusal(RECOVER, state.lost_damaged, reason)
    if refusal:
        frappe.throw(refusal)

    # set_value: see mark_lost_damaged.
    frappe.db.set_value(ASSET_MASTER_DOCTYPE, asset, "lost_damaged", 0)
    add_history(asset, ASSET_FOUND_REPAIRED, reason=reason_text(reason))
    frappe.db.commit()
    notify_asset_changed(asset)
    return {"asset": asset}


def _check_may_mark() -> None:
    if not has_role_profile(frappe.session.user, ASSET_LOST_DAMAGED_PROFILES):
        frappe.throw("Only Admin or HR can mark an asset Lost/Damaged or Found/Repaired.", frappe.PermissionError)


def _lock(asset: str) -> frappe._dict:
    """The asset's `lost_damaged` and `current_assignee`, read with a row lock."""
    try:
        state = frappe.db.get_value(
            ASSET_MASTER_DOCTYPE, asset, ["lost_damaged", "current_assignee"], as_dict=True, for_update=True
        )
    except Exception as exc:
        if is_serialization_failure(exc):
            frappe.throw(f"{asset} was just changed by someone else. Reload the page and try again.")
        raise
    if not state:
        frappe.throw(f"Asset {asset} not found.", frappe.DoesNotExistError)
    return state
