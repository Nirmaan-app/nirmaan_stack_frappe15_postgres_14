"""Write a row to an asset's history (the `Asset History` child table on Asset Master).

The history is append-only and written only by the server, from the Asset Management / Asset Master
/ Nirmaan Users hooks, so every screen and Desk produce the same log. A row is inserted directly as
a child record rather than through a parent save: that keeps the parent's Version log and its validate
out of it. Skipping them is correct here -- nothing is derived from the history, and the parent's own
rules (Asset Master validate) guard edits to existing rows, not new ones.

The parent's `modified` does move with each new row (owner, 2026-10-15, review #11), as a Procurement
Order's does when its rows change: a Desk form opened before the row then gets Frappe's "changed after you
opened it" instead of failing the history guard. A batch run (the 28th / 7th jobs, a category switched on)
moves it once at the end (`touch_assets_at_the_end`), so the run holds no asset row while it works.

The person (`assigned_to`) and the actor (`done_by`) are stored as plain text, not Links (owner,
2026-10-12): Frappe's delete check counts child-table links, so a Link would stop anyone who ever held
an asset or took an asset action from being deleted, forever. A rename therefore doesn't follow them on
its own -- `rename_person` does, called from `api/users.rename_user_email`.
"""

from contextlib import contextmanager

import frappe
from frappe.utils import now_datetime

ASSET_MASTER_DOCTYPE = "Asset Master"
# While a batch run defers it: the set of assets whose `modified` moves at the end (`touch_assets_at_the_end`).
_TOUCH_LATER_FLAG = "asset_history_touch_later"
ASSET_HISTORY_DOCTYPE = "Asset History"
HISTORY_FIELD = "asset_history"

ASSET_ADDED = "Asset Added"
ASSIGNED = "Assigned"
DECLARATION_SIGNED = "Declaration Signed"
DECLARATION_UPLOADED = "Declaration Uploaded"
UNASSIGNED = "Unassigned"
DEPARTMENT_SET = "Department Set"
RETURN_REQUESTED = "Return Requested"  # the holder says they gave it back (api/assets/returns.py)
RETURN_REJECTED = "Return Rejected"  # Admin / HR / PMO: not received, the person keeps it
AUDIT_REQUESTED = "Audit Requested"  # the month's audit asked of the holder (services/asset_audit_open.py)
AUDIT_FULFILLED = "Audit Fulfilled"  # the holder sent condition + photo (api/assets/audits.submit_audit)
AUDIT_MISSED = "Audit Missed"  # the month ended with the audit unsent (tasks/asset_audit, owner 2026-10-14)

ROW_FIELDS = ("assigned_to", "declaration", "from_department", "to_department", "reason", "audit_answers")


def add_history(asset: str, event: str, **fields) -> str:
    """Append one event to `asset`'s history and return the new row's name.

    `fields` may carry any of ROW_FIELDS. Who and when are always the session user and the server
    clock -- never values a client sent.
    """
    unknown = set(fields) - set(ROW_FIELDS)
    if unknown:
        raise ValueError(f"Unknown Asset History field(s): {sorted(unknown)}")

    last_idx = frappe.db.sql(
        f'select coalesce(max(idx), 0) from "tab{ASSET_HISTORY_DOCTYPE}" '
        "where parent = %s and parenttype = %s and parentfield = %s",
        (asset, ASSET_MASTER_DOCTYPE, HISTORY_FIELD),
    )[0][0]

    row = frappe.get_doc({
        "doctype": ASSET_HISTORY_DOCTYPE,
        "parent": asset,
        "parenttype": ASSET_MASTER_DOCTYPE,
        "parentfield": HISTORY_FIELD,
        "idx": int(last_idx) + 1,
        "event": event,
        "done_by": frappe.session.user,
        "done_on": now_datetime(),
        **{key: value for key, value in fields.items() if value},
    })
    row.db_insert()

    later = frappe.flags.get(_TOUCH_LATER_FLAG)
    if later is not None:
        later.add(asset)
    else:
        touch_assets([asset])
    return row.name


def touch_assets(assets) -> None:
    """Move these assets' `modified` / `modified_by` forward, without their save (no validate, no Version row).

    One statement, in a savepoint. At REPEATABLE READ, an asset someone else saved since this transaction began
    fails the update with a serialization error: the rest are then done one by one and that one is skipped --
    the history row it got matters more than the date.
    """
    names = sorted({name for name in assets if name})
    if names and not _touch(names):
        for name in names:
            _touch([name])


def _touch(names: list[str]) -> bool:
    """Run the update for `names`; False (nothing changed) on a serialization failure."""
    # Imported here: asset_audit_open imports this module.
    from nirmaan_stack.services.asset_audit_open import is_serialization_failure

    savepoint = f"asset_touch_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        frappe.db.sql(
            f'update "tab{ASSET_MASTER_DOCTYPE}" set modified = %(now)s, modified_by = %(user)s where name in %(names)s',
            {"now": now_datetime(), "user": frappe.session.user, "names": tuple(names)},
        )
    except Exception as exc:
        frappe.db.rollback(save_point=savepoint)
        if is_serialization_failure(exc):
            return False
        raise
    frappe.db.release_savepoint(savepoint)
    return True


@contextmanager
def touch_assets_at_the_end():
    """For a batch run: collect the assets that get history rows and move their `modified` once, as the block
    ends -- right before the caller commits -- so the run doesn't hold asset rows while it works. A nested
    block joins the outer one."""
    if frappe.flags.get(_TOUCH_LATER_FLAG) is not None:
        yield
        return
    frappe.flags[_TOUCH_LATER_FLAG] = later = set()
    try:
        yield
    finally:
        frappe.flags.pop(_TOUCH_LATER_FLAG, None)
    touch_assets(later)


def rename_person(old_email: str, new_email: str) -> None:
    """Point every history row that names `old_email` (as the person or the actor) at `new_email`.

    Raw SQL: Asset History has no doc_events and nothing is derived from these two fields, so no hook
    or recompute is skipped.
    """
    for field in ("assigned_to", "done_by"):
        frappe.db.sql(
            f'update "tab{ASSET_HISTORY_DOCTYPE}" set {field} = %s where {field} = %s',
            (new_email, old_email),
        )
