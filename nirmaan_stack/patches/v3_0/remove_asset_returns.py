# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Remove asset returns, and every trace of them in the asset history (owner, 2026-10-26).

WHAT IT DOES
    Returns were removed: the holder's Return button, the Assets page's Return Request tab, and the
    "Return Requested" / "Return Rejected" history events. This patch clears what they left behind:
    1. A return still waiting (`Asset Management.returned` ticked) is cancelled: `returned` and `returned_on`
       are cleared and the person keeps the asset. If the asset now owes the cycle month's audit (the 28th /
       7th runs skipped it while the return waited), the audit opens.
    2. Every "Return Requested" and "Return Rejected" history row is deleted (owner: clear them).
    3. An audit opened because a return was rejected has the note "10/2026 · return rejected" on its "Audit
       Requested" row; the note is dropped, leaving "10/2026". The audit itself stays.
    An approved return was a normal Unassign ("Unassigned", reason "Returned – no longer needed"); those
    rows are ordinary unassign history and stay.

IDEMPOTENT
    Each step only finds rows that still carry a return, so a second run does nothing.

HOOKS
    `set_value` and `frappe.db.delete`, so no `doc_events` fire. Skipping them is correct:
    - Asset Management `on_update` keeps `current_assignee` in step and reacts to a declaration arriving;
      neither changes here. The one effect we want, opening an owed audit, is called explicitly.
    - Asset History is append-only on purpose (a save or delete through the document is refused). This
      one-time removal is the owner's ruling, so it goes around that guard with a raw delete / write.
"""

import frappe

from nirmaan_stack.services.asset_audit_open import open_due_audits

ASSET_MANAGEMENT_DOCTYPE = "Asset Management"
ASSET_HISTORY_DOCTYPE = "Asset History"
RETURN_EVENTS = ("Return Requested", "Return Rejected")
AUDIT_REQUESTED = "Audit Requested"
RETURN_NOTE = " · return rejected"  # what reject_return wrote after the month on the audit it opened


def execute():
    print(summary(remove_returns()))


def remove_returns(assets: list[str] | None = None) -> dict:
    """Cancel waiting returns and clear return history (only on `assets`, when given -- the tests scope it).

    Returns:
        {"cancelled": [assignment, ...], "audits_opened": [assignment, ...],
         "history_deleted": <rows>, "notes_trimmed": <rows>}
    """
    scope = {} if assets is None else {"asset": ["in", assets or [""]]}
    history_scope = {"parenttype": "Asset Master", "parentfield": "asset_history"}
    if assets is not None:
        history_scope["parent"] = ["in", assets or [""]]

    cancelled, opened = [], []
    for row in frappe.get_all(
        ASSET_MANAGEMENT_DOCTYPE, filters={"returned": 1, **scope}, fields=["name"], order_by="name"
    ):
        frappe.db.set_value(ASSET_MANAGEMENT_DOCTYPE, row.name, {"returned": 0, "returned_on": None})
        opened += open_due_audits(assignment=row.name)
        cancelled.append(row.name)

    returns = frappe.get_all(
        ASSET_HISTORY_DOCTYPE, filters={"event": ["in", RETURN_EVENTS], **history_scope}, pluck="name"
    )
    if returns:
        frappe.db.delete(ASSET_HISTORY_DOCTYPE, {"name": ["in", returns]})

    notes = frappe.get_all(
        ASSET_HISTORY_DOCTYPE,
        filters={"event": AUDIT_REQUESTED, "reason": ["like", f"%{RETURN_NOTE}"], **history_scope},
        fields=["name", "reason"],
    )
    for row in notes:
        frappe.db.set_value(
            ASSET_HISTORY_DOCTYPE, row.name, "reason", row.reason[: -len(RETURN_NOTE)], update_modified=False
        )

    return {
        "cancelled": cancelled,
        "audits_opened": opened,
        "history_deleted": len(returns),
        "notes_trimmed": len(notes),
    }


def summary(result: dict) -> str:
    return (
        f"remove_asset_returns: {len(result['cancelled'])} waiting return(s) cancelled, "
        f"{len(result['audits_opened'])} audit(s) opened, {result['history_deleted']} return history row(s) "
        f"deleted, {result['notes_trimmed']} audit note(s) trimmed"
    )
