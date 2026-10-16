"""Give every asset assigned before the asset history started its first history entry (owner, 2026-10-16).

The `Asset History` arrived on 12 Oct 2026, so an asset assigned before then has no "Assigned" row for the
person who holds it, and a declaration signed on paper and uploaded then has no row either. For each asset
held today, through its holder's own Asset Management row:
- an "Assigned" row: by whoever created the assignment, on its Assigned On date (at the time it was entered,
  or 12:00 AM when it was entered on a later day);
- when that row has a declaration and the history has none for the holder, a "Declaration Signed" row by the
  HOLDER, who signed the form (owner: the uploader -- HR, Admin or procurement -- is not named; the File
  record keeps them), at the upload time, never before the Assigned row;
- a pending declaration gets nothing more: signing later adds its own row, as it does today.
Free assets, past holders and holders with no Asset Management row get nothing; the last are only reported.

The new rows become the asset's FIRST entries: they take idx 1 (and 2) and the existing rows move up, because the
asset page's history card orders by idx, while the History tab orders by done_on, which the old dates put first.
Only idx moves on an existing row; the append-only guard (AssetMaster.keep_history_unchanged) compares content.
Both rows carry `BACKFILL_NOTE`, the only thing that tells an old paper form from one signed in the app.

Rows are inserted directly, as `services/asset_history.add_history` does, but with the old records' who and when
(add_history always stamps the session user and now, which is right for a live event). Skipping hooks is correct:
Asset History has no doc_events and nothing is derived from it; Asset Management is never saved, so no audit
opens and `received` stays as it is. Each asset's `modified` moves once at the end (`touch_assets`), as in every
batch run. An asset that already has an "Assigned" row for its holder is skipped, so a second run writes nothing.

Dry run -- prints everything, saves nothing:
    bench --site localhost execute nirmaan_stack.patches.v3_0.backfill_first_asset_history.run --kwargs "{'dry_run': True}"
"""

from datetime import datetime, time

import frappe
from frappe.utils import get_datetime, getdate

from nirmaan_stack.services.asset_history import (
    ASSET_HISTORY_DOCTYPE,
    ASSET_MASTER_DOCTYPE,
    ASSIGNED,
    DECLARATION_SIGNED,
    DECLARATION_UPLOADED,
    HISTORY_FIELD,
    touch_assets,
)

BACKFILL_NOTE = "Recorded from the assignment made before asset history started"


def execute():
    run(dry_run=False)


def run(dry_run: bool = True) -> dict:
    """Write the first entries; with dry_run, print what would be written and roll everything back."""
    assets, holders_without_row = find_assets_to_backfill()
    written = [backfill_asset(row) for row in assets]
    touch_assets([row.asset for row in assets])

    report = {"written": written, "holders_without_row": holders_without_row}
    _print_report(report, dry_run)

    if dry_run:
        frappe.db.rollback()
    else:
        frappe.db.commit()
    return report


def find_assets_to_backfill() -> tuple[list, list]:
    """(held assets whose holder has no "Assigned" row, holders with no Asset Management row of their own).

    One row per asset: the holder's own Asset Management row (the oldest, should there ever be two), with
    whether the history already records a declaration for the holder.
    """
    assets = frappe.db.sql(
        """
        select distinct on (m.name)
            m.name as asset, m.current_assignee as holder,
            a.name as assignment, a.owner as assigned_by, a.creation as entered_on,
            a.asset_assigned_on as assigned_on, a.asset_declaration_attachment as declaration,
            exists (
                select 1 from "tabAsset History" h
                where h.parent = m.name and h.parenttype = %(parenttype)s and h.parentfield = %(parentfield)s
                  and h.assigned_to = m.current_assignee and h.event in %(declaration_events)s
            ) as declaration_in_history
        from "tabAsset Master" m
        join "tabAsset Management" a on a.asset = m.name and a.asset_assigned_to = m.current_assignee
        where coalesce(m.current_assignee, '') <> ''
          and not exists (
              select 1 from "tabAsset History" h
              where h.parent = m.name and h.parenttype = %(parenttype)s and h.parentfield = %(parentfield)s
                and h.assigned_to = m.current_assignee and h.event = %(assigned)s
          )
        order by m.name, a.creation, a.name
        """,
        {
            "parenttype": ASSET_MASTER_DOCTYPE,
            "parentfield": HISTORY_FIELD,
            "assigned": ASSIGNED,
            "declaration_events": (DECLARATION_SIGNED, DECLARATION_UPLOADED),
        },
        as_dict=True,
    )
    holders_without_row = frappe.db.sql(
        """
        select m.name as asset, m.current_assignee as holder
        from "tabAsset Master" m
        where coalesce(m.current_assignee, '') <> ''
          and not exists (
              select 1 from "tabAsset Management" a
              where a.asset = m.name and a.asset_assigned_to = m.current_assignee
          )
        order by m.name
        """,
        as_dict=True,
    )
    return assets, holders_without_row


def backfill_asset(row) -> dict:
    """Put the first entries in front of `row.asset`'s history; return what was written."""
    assigned_at = assigned_time(row.assigned_on, row.entered_on)
    entries = [{
        "event": ASSIGNED,
        "assigned_to": row.holder,
        "done_by": row.assigned_by,
        "done_on": assigned_at,
    }]
    if row.declaration and not row.declaration_in_history:
        entries.append({
            "event": DECLARATION_SIGNED,
            "assigned_to": row.holder,
            "done_by": row.holder,
            "done_on": declaration_time(row.declaration, assigned_at),
            "declaration": row.declaration,
        })

    # Make room at the front. Asset History has no doc_events and nothing reads idx but the order on screen.
    frappe.db.sql(
        f'update "tab{ASSET_HISTORY_DOCTYPE}" set idx = idx + %s '
        "where parent = %s and parenttype = %s and parentfield = %s",
        (len(entries), row.asset, ASSET_MASTER_DOCTYPE, HISTORY_FIELD),
    )
    for idx, entry in enumerate(entries, start=1):
        frappe.get_doc({
            "doctype": ASSET_HISTORY_DOCTYPE,
            "parent": row.asset,
            "parenttype": ASSET_MASTER_DOCTYPE,
            "parentfield": HISTORY_FIELD,
            "idx": idx,
            "reason": BACKFILL_NOTE,
            **entry,
        }).db_insert()

    return {"asset": row.asset, "holder": row.holder, "events": [e["event"] for e in entries], "assigned_at": assigned_at}


def assigned_time(assigned_on, entered_on) -> datetime:
    """The Assigned On date, at the time the assignment was entered when that was the same day, else 12:00 AM."""
    entered_on = get_datetime(entered_on)
    if not assigned_on or getdate(assigned_on) == entered_on.date():
        return entered_on
    return datetime.combine(getdate(assigned_on), time.min)


def declaration_time(file_url: str, assigned_at: datetime) -> datetime:
    """When the form was uploaded (its oldest File record), never before the assignment it belongs to."""
    uploaded = frappe.db.sql('select min(creation) from "tabFile" where file_url = %s', (file_url,))[0][0]
    return max(get_datetime(uploaded), assigned_at) if uploaded else assigned_at


def _print_report(report: dict, dry_run: bool) -> None:
    written = report["written"]
    print(("DRY RUN -- nothing saved" if dry_run else "First asset history entries written") + "\n")
    rows = sum(len(item["events"]) for item in written)
    with_declaration = sum(1 for item in written if DECLARATION_SIGNED in item["events"])
    print(
        f"Assets: {len(written)} ({with_declaration} Assigned + Declaration Signed, "
        f"{len(written) - with_declaration} Assigned only); rows: {rows}"
    )
    for item in written:
        events = " + ".join(item["events"])
        print(f"  {item['asset']:16} {item['holder']:40} {item['assigned_at']:%d-%m-%Y %H:%M}  {events}")
    print(f"\nLeft alone, for a person to check -- holders with no assignment row ({len(report['holders_without_row'])}):")
    for row in report["holders_without_row"]:
        print(f"  {row.asset:16} holder {row.holder}")
