"""Remove leftover asset assignments (owner, 2026-10-12).

An Asset Management row means "this person holds this asset"; Unassign deletes it. Before the
one-holder rule an asset could get a second row that was never removed: ASSET-LAP-029 has a row for
Sharook beside the real holder Bhavani's. A leftover made the asset look held by two people, kept a
"declaration pending" badge on the old holder, and blocked the asset from being assigned again once
the real holder was unassigned.

The asset's current holder is what the app trusts, so a row naming someone else is a leftover when:
- the asset has no holder (the asset is free; the row is a leftover or an Unassign that stopped
  halfway -- either way the asset is meant to be free), or
- the asset has a holder and also a row for that holder (the real assignment stays).
A row naming someone else on an asset whose holder has no row of their own is unclear (which one is
right?), so it is only reported, as is a holder with no row at all, for a person to decide.

The leftover is removed with `frappe.db.delete`, which skips Asset Management's on_trash on purpose:
that hook would write an "Unassigned" history row dated today for a hand-back that happened long ago,
and would never free the asset anyway (it names someone else). Nothing is derived from the row. Its
files (a declaration) are moved onto the asset first, as on_trash does, so they are kept.

Dry run -- prints everything, saves nothing:
    bench --site localhost execute nirmaan_stack.patches.v3_0.remove_leftover_asset_assignments.run --kwargs "{'dry_run': True}"
"""

import frappe

from nirmaan_stack.integrations.controllers.asset_management import move_files_to_asset


def execute():
    run(dry_run=False)


def run(dry_run: bool = True) -> dict:
    """Remove the leftovers; with dry_run, print what would change and roll everything back."""
    leftovers, unclear_rows, holders_without_row = find_leftovers()
    for row in leftovers:
        remove_leftover(row)

    report = {
        "removed": leftovers,
        "unclear_rows": unclear_rows,
        "holders_without_row": holders_without_row,
    }
    _print_report(report, dry_run)

    if dry_run:
        frappe.db.rollback()
    else:
        frappe.db.commit()
    return report


def find_leftovers() -> tuple[list, list, list]:
    """(leftover rows, unclear rows, holders with no row) -- see the module docstring."""
    mismatched = frappe.db.sql(
        """
        select a.name, a.asset, a.asset_assigned_to, m.current_assignee,
               a.asset_declaration_attachment as declaration
        from "tabAsset Management" a
        join "tabAsset Master" m on m.name = a.asset
        where coalesce(m.current_assignee, '') <> coalesce(a.asset_assigned_to, '')
        order by a.asset, a.name
        """,
        as_dict=True,
    )
    assets_with_holder_row = set(
        frappe.db.sql_list(
            """
            select a.asset from "tabAsset Management" a
            join "tabAsset Master" m on m.name = a.asset
            where a.asset_assigned_to = m.current_assignee
            """
        )
    )
    leftovers = [row for row in mismatched if not row.current_assignee or row.asset in assets_with_holder_row]
    unclear_rows = [row for row in mismatched if row.current_assignee and row.asset not in assets_with_holder_row]
    holders_without_row = frappe.db.sql(
        """
        select m.name as asset, m.current_assignee
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
    return leftovers, unclear_rows, holders_without_row


def remove_leftover(row) -> None:
    """Delete one leftover row, keeping its files on the asset (see the module docstring)."""
    move_files_to_asset(row.name, row.asset)
    frappe.db.delete("Asset Management", {"name": row.name})


def _print_report(report: dict, dry_run: bool) -> None:
    print(("DRY RUN -- nothing saved" if dry_run else "Leftover asset assignments removed") + "\n")
    print(f"Leftover rows removed ({len(report['removed'])}):")
    for row in report["removed"]:
        declaration = "with declaration (kept on the asset)" if row.declaration else "no declaration"
        holder = row.current_assignee or "(free)"
        print(f"  {row.asset:16} row {row.name:12} {row.asset_assigned_to or '-':36} holder {holder}  {declaration}")
    print(f"\nLeft alone, for a person to check -- row for someone else, holder has no row ({len(report['unclear_rows'])}):")
    for row in report["unclear_rows"]:
        print(f"  {row.asset:16} row {row.name:12} {row.asset_assigned_to or '-':36} holder {row.current_assignee}")
    print(f"\nLeft alone, for a person to check -- holders with no assignment row ({len(report['holders_without_row'])}):")
    for row in report["holders_without_row"]:
        print(f"  {row.asset:16} holder {row.current_assignee}")
