# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""PR tag rows: one row per package, and no header (PR headers retired, 2026-10).

WHY IT IS NEEDED
    `Procurement Requests.pr_tag_list` used to hold one row per HEADER the user picked, and several headers
    share a package (HVAC System has four), so 1,329 PRs repeat HVAC System -- 3,941 extra rows on the
    localhost copy of 2026-10-13. Headers are retired: the save hook now writes one row per package with no
    header (`integrations/controllers/procurement_request_packages.py`). This makes the old rows match.

WHAT IT DOES, PER PR
    1. keeps one row per `tag_package` -- the first by `idx`, then `name` -- and deletes the rest (a row with
       a blank package carries nothing and is deleted too);
    2. clears `tag_header` on every PR tag row;
    3. renumbers `idx` 1..n, in the same order, on the PRs that lost a row (closes the gaps; every other PR
       keeps its numbering).

⚠️ A PR'S PACKAGES DO NOT CHANGE
    It never reads the items, never adds a package and never removes a PR's last row of a package. The set
    of packages per PR is snapshotted before and checked after; any difference raises, and the migrate rolls
    the whole patch back.

⚠️ RAW SQL, NO HOOKS -- AND WHY THAT IS SAFE
    Nothing is derived from these rows and stored: the PR Tracker is computed live from them
    (`api/critical_pr_tasks/get_projects_with_pr_stats.py`), and the PR lists, filters and Critical PO
    linking read the package set, which this patch does not change. PR `modified` is not touched, so no PR
    looks edited.

IDEMPOTENT: a second run plans nothing.

DRY RUN (reads only, writes nothing):
    bench --site <site> execute nirmaan_stack.patches.v3_0.pr_tags_one_row_per_package.dry_run
"""

from collections import defaultdict
from dataclasses import dataclass, field

import frappe
from frappe.utils import create_batch

TABLE = "`tabPR Tag Child Table`"
SCOPE = "parenttype = 'Procurement Requests' AND parentfield = 'pr_tag_list'"


@dataclass
class CleanupPlan:
    delete: list[str] = field(default_factory=list)        # row names
    renumber_prs: list[str] = field(default_factory=list)  # PRs that lose a row
    rows_with_header: int = 0                              # of the rows that stay
    rows_before: int = 0
    packages_before: dict = field(default_factory=dict)    # {pr: frozenset(packages)}


def _rows() -> list:
    return frappe.db.sql(
        f"SELECT name, parent, tag_package, tag_header FROM {TABLE} WHERE {SCOPE} ORDER BY parent, idx, name",
        as_dict=True,
    )


def _package_sets(rows) -> dict:
    sets = defaultdict(set)
    for row in rows:
        package = (row.tag_package or "").strip()
        if package:
            sets[row.parent].add(package)
    return {parent: frozenset(packages) for parent, packages in sets.items()}


def plan_cleanup() -> CleanupPlan:
    """What the patch will do. Reads only."""
    rows = _rows()
    plan = CleanupPlan(rows_before=len(rows), packages_before=_package_sets(rows))
    seen = set()
    touched = set()
    for row in rows:
        package = (row.tag_package or "").strip()
        key = (row.parent, package)
        if not package or key in seen:
            plan.delete.append(row.name)
            touched.add(row.parent)
            continue
        seen.add(key)
        if (row.tag_header or "").strip():
            plan.rows_with_header += 1
    plan.renumber_prs = sorted(touched)
    return plan


def apply_cleanup(plan: CleanupPlan) -> None:
    """Delete, clear the headers, renumber. Commits nothing -- `execute()` does."""
    for chunk in create_batch(plan.delete, 500):
        frappe.db.sql(f"DELETE FROM {TABLE} WHERE name IN %s", (tuple(chunk),))
    frappe.db.sql(f"UPDATE {TABLE} SET tag_header = NULL WHERE {SCOPE} AND COALESCE(tag_header, '') <> ''")
    for chunk in create_batch(plan.renumber_prs, 500):
        frappe.db.sql(
            f"""
            UPDATE {TABLE} AS t SET idx = x.rn
            FROM (
                SELECT name, ROW_NUMBER() OVER (PARTITION BY parent ORDER BY idx, name) AS rn
                FROM {TABLE}
                WHERE {SCOPE} AND parent IN %s
            ) AS x
            WHERE t.name = x.name
            """,
            (tuple(chunk),),
        )


def verify(plan: CleanupPlan) -> None:
    """Raise unless every PR keeps exactly its packages, none repeats, and no header is left."""
    rows = _rows()
    after = _package_sets(rows)
    changed = sorted(
        pr for pr in set(plan.packages_before) | set(after)
        if plan.packages_before.get(pr, frozenset()) != after.get(pr, frozenset())
    )
    repeats = len(rows) - len({(row.parent, row.tag_package) for row in rows})
    headers = sum(1 for row in rows if (row.tag_header or "").strip())
    if changed or repeats or headers:
        frappe.throw(
            f"pr_tags_one_row_per_package: refused -- {len(changed)} PR(s) would change packages "
            f"({changed[:10]}), {repeats} repeated row(s), {headers} header(s) left"
        )


def report(plan: CleanupPlan) -> str:
    return (
        f"pr_tags_one_row_per_package: {plan.rows_before} rows -> {plan.rows_before - len(plan.delete)}; "
        f"delete {len(plan.delete)} repeated/blank rows on {len(plan.renumber_prs)} PRs (renumbered); "
        f"clear the header on {plan.rows_with_header} rows; package set per PR unchanged"
    )


def dry_run() -> str:
    """Print what `execute()` would do. Writes nothing."""
    message = report(plan_cleanup())
    print(message)
    return message


def execute():
    plan = plan_cleanup()
    apply_cleanup(plan)
    verify(plan)
    frappe.db.commit()
    print(report(plan))
