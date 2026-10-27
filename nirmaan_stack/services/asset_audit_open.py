"""Open and close the monthly asset audits -- the one place that decides which assignments owe one (owner,
2026-10-14).

The cycle: an audit opened from the 28th belongs to the next month (`services/asset_audit.cycle_month`).
- The 28th (`tasks/asset_audit.open_next_month_audits`): everyone up to date gets next month's audit now;
  anyone still behind is left alone -- grace until the 7th.
- The 7th (`tasks/asset_audit.close_last_month_audits`): every audit still unsent from last month is recorded
  Missed (`roll_missed_audits`), then whoever sent last month's during the grace days gets this month's.
If the scheduler was down at 06:00 on either day, Frappe runs the missed job when it comes back (Scheduled
Job Type works out the next run from the last one), so there is no manual "start".

Audits also open at once, for the cycle month, when:
- a declaration arrives, signed or uploaded (`integrations/controllers/asset_management.on_update`);
- a category's "Monthly audit required" is ticked (`integrations/controllers/asset_category.on_update`).

An assignment owes the cycle month's audit when all of these hold:
- it is the asset's current holder's row (`Asset Master.current_assignee`) -- a leftover row naming someone
  else is never audited;
- the asset's category has `audit_required` ticked;
- its declaration is on file (`asset_declaration_attachment`), not `received`: that flag arrived on
  2026-10-13 and assignments signed earlier still carry 0;
- no audit is open (`audit_status` is not Pending) -- never two at once;
- it has no audit for that month (`audit_month`), and the asset has no "Audit Fulfilled ... for <that month>"
  in its history -- by the month it was FOR, not the day it was sent: an audit sent late in the grace days is
  last month's, and an asset handed over after its previous holder sent that month's isn't asked again.

A month left unsent (the 7th): the audit gets an "Audit Missed" history row (the month it was for), so every
month ends with one result -- Fulfilled or Missed -- and `audit_overdue_since` keeps the first month of the
unbroken run of misses (the screens show "Audit overdue since 09/2026"; sending an audit clears it). Then:
- its category still needs audits: the same open audit moves to this month (still Pending, plus "Audit
  Requested" for this month);
- its category no longer needs audits (switched off, or the asset moved to another category): it closes
  (`audit_status` and `audit_overdue_since` cleared) -- it was required only for the month it was open in.
Mid-cycle nothing closes an audit: switching a category off or moving the asset leaves it to be sent.
"""

from datetime import date

import frappe
from frappe.utils import getdate, now_datetime

from nirmaan_stack.services.asset_audit import (
    AUDIT_PENDING,
    audit_month_label,
    created_text,
    cycle_month,
    for_month_pattern,
)
from nirmaan_stack.services.asset_history import AUDIT_FULFILLED, AUDIT_MISSED, AUDIT_REQUESTED, add_history

SERIALIZATION_FAILURE = "40001"  # PostgreSQL: a row changed by a transaction that committed after our snapshot


def is_serialization_failure(exc: Exception) -> bool:
    """True when `exc` is PostgreSQL's "could not serialize access due to concurrent update".

    Frappe holds PostgreSQL at REPEATABLE READ, so an UPDATE or SELECT ... FOR UPDATE of a row another
    transaction changed and committed after this one's snapshot fails with this instead of waiting.
    """
    return getattr(exc, "pgcode", None) == SERIALIZATION_FAILURE


def due_assignments(day: date, category: str | None = None, assignment: str | None = None) -> list[dict]:
    """The assignments that owe the audit of `day`'s cycle month (rules in the module docstring).

    Args:
        day: the day it runs (from the 28th it means next month's audit).
        category: only assets of this Asset Category.
        assignment: only this Asset Management row.

    Returns:
        [{name, asset, asset_assigned_to}, ...]
    """
    label = audit_month_label(cycle_month(day))
    values = {
        "pending": AUDIT_PENDING,
        "label": label,
        "fulfilled": AUDIT_FULFILLED,
        "sent_for": for_month_pattern(label),
    }
    scope = ""
    if category:
        scope += " and m.asset_category = %(category)s"
        values["category"] = category
    if assignment:
        scope += " and a.name = %(assignment)s"
        values["assignment"] = assignment

    return frappe.db.sql(
        f"""
        select a.name, a.asset, a.asset_assigned_to
        from "tabAsset Management" a
        join "tabAsset Master" m on m.name = a.asset
        join "tabAsset Category" c on c.name = m.asset_category
        where m.current_assignee = a.asset_assigned_to
          and c.audit_required = 1
          and coalesce(a.asset_declaration_attachment, '') != ''
          and coalesce(a.audit_status, '') != %(pending)s
          and coalesce(a.audit_month, '') != %(label)s
          and not exists (
              select 1 from "tabAsset History" h
              where h.parent = a.asset and h.parenttype = 'Asset Master' and h.parentfield = 'asset_history'
                and h.event = %(fulfilled)s and coalesce(h.reason, '') ~ %(sent_for)s
          )
          {scope}
        order by a.name
        """,
        values,
        as_dict=True,
    )


def open_due_audits(
    *, day: date | str | None = None, category: str | None = None, assignment: str | None = None, note: str | None = None
) -> list[str]:
    """Open the cycle month's audit on every assignment that owes one; return the assignments opened.

    Each opened audit gets an "Audit Requested" history row ("11/2026", or "11/2026 · <note>"). The caller
    commits. Safe to run again: an assignment already opened for that month is not due.
    """
    month = cycle_month(getdate(day) if day else getdate())
    label = audit_month_label(month)
    opened = []
    for row in due_assignments(month, category=category, assignment=assignment):
        if not _mark_pending(row.name, label):
            continue  # another run opened it first
        add_history(row.asset, AUDIT_REQUESTED, assigned_to=row.asset_assigned_to, reason=created_text(month, note))
        _notify(row.asset)
        opened.append(row.name)
    return opened


def open_audits_from_earlier_months(day: date) -> list[dict]:
    """Holders' audits still Pending for a month before `day`'s cycle month, with whether their category
    still needs one.

    Only a genuinely earlier month: a later one (typed in Desk, or left by a run "as if" a later day) is not
    recorded Missed. `audit_month` is MM/YYYY text, so it is read as a date here.

    Returns:
        [{name, asset, asset_assigned_to, audit_month, audit_required}, ...]
    """
    return frappe.db.sql(
        """
        select a.name, a.asset, a.asset_assigned_to, a.audit_month, coalesce(c.audit_required, 0) as audit_required
        from "tabAsset Management" a
        join "tabAsset Master" m on m.name = a.asset
        left join "tabAsset Category" c on c.name = m.asset_category
        where m.current_assignee = a.asset_assigned_to
          and a.audit_status = %(pending)s
          and a.audit_month ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'
          and to_date(a.audit_month, 'MM/YYYY') < %(start)s
        order by a.name
        """,
        {"pending": AUDIT_PENDING, "start": cycle_month(day)},
        as_dict=True,
    )


def roll_missed_audits(*, day: date | str | None = None) -> dict:
    """The 7th: record every audit left unsent last month as Missed, then move it to this month (category still
    audited, `audit_overdue_since` set to the first missed month) or close it (category no longer audited).
    Only for the 7th -- on the 28th the cycle month is already the next one. The caller commits.

    Returns:
        {"missed": [<assignment>, ...], "moved": [...], "closed": [...]}
    """
    month = cycle_month(getdate(day) if day else getdate())
    label = audit_month_label(month)
    result = {"missed": [], "moved": [], "closed": []}
    for row in open_audits_from_earlier_months(month):
        keep = bool(row.audit_required)
        # Only while it is still the same open audit: two runs at once can't both record it.
        changed = _conditional_update(
            """
            update "tabAsset Management"
            set audit_status = %(status)s, audit_month = %(month)s,
                audit_overdue_since = case when %(keep)s then coalesce(nullif(audit_overdue_since, ''), %(old)s) end,
                modified = %(now)s, modified_by = %(user)s
            where name = %(name)s and audit_status = %(pending)s
              and coalesce(audit_month, '') = coalesce(%(old)s, '')
            returning name
            """,
            {
                "status": AUDIT_PENDING if keep else None,
                "month": label if keep else row.audit_month,
                "keep": keep,
                "pending": AUDIT_PENDING,
                "old": row.audit_month,
                "name": row.name,
            },
        )
        if not changed:
            continue
        add_history(row.asset, AUDIT_MISSED, assigned_to=row.asset_assigned_to, reason=row.audit_month)
        result["missed"].append(row.name)
        if keep:
            add_history(row.asset, AUDIT_REQUESTED, assigned_to=row.asset_assigned_to, reason=created_text(month))
            result["moved"].append(row.name)
        else:
            result["closed"].append(row.name)
        _notify(row.asset)
    return result


def _mark_pending(assignment: str, label: str) -> bool:
    """Set the audit open on `assignment` unless it already is; True when this call opened it.

    The WHERE repeats the "not open, not this month" check so two runs at once can't both open it.
    """
    return _conditional_update(
        """
        update "tabAsset Management"
        set audit_status = %(pending)s, audit_month = %(label)s, modified = %(now)s, modified_by = %(user)s
        where name = %(name)s
          and coalesce(audit_status, '') != %(pending)s
          and coalesce(audit_month, '') != %(label)s
        returning name
        """,
        {"pending": AUDIT_PENDING, "label": label, "name": assignment},
    )


def _conditional_update(sql: str, values: dict) -> bool:
    """Run a guarded `update ... returning name` on one Asset Management row; True when it changed the row.

    Raw SQL: it skips the Asset Management doc_events on purpose -- those keep the holder in step and record
    declarations, neither of which changes here, and nothing is derived from the audit fields. It moves
    `modified` (`now` / `user` are filled in), so a form opened before it (Desk) is refused on save instead
    of writing the old audit fields back.

    At REPEATABLE READ a run whose snapshot predates another run's commit gets a serialization failure on
    the row instead of waiting; the savepoint keeps the rest of the transaction usable and the row is
    skipped (the other run handled it).
    """
    savepoint = f"asset_audit_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        updated = frappe.db.sql(sql, {**values, "now": now_datetime(), "user": frappe.session.user})
    except Exception as exc:
        frappe.db.rollback(save_point=savepoint)
        if is_serialization_failure(exc):
            return False
        raise
    frappe.db.release_savepoint(savepoint)
    return bool(updated)


def _notify(asset: str) -> None:
    # Imported here: the Asset Management hooks import this module.
    from nirmaan_stack.integrations.controllers.asset_management import notify_asset_changed

    notify_asset_changed(asset)
