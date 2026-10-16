"""Keep a Procurement Request's `pr_tag_list` equal to the packages of its items.

The rule itself is the pure module `services/pr_packages.py`; this module only reads what the
rule needs (the package and category masters) and writes the rows. PO items never change a PR's
packages (owner, 2026-10-14). It runs
inside the PR's `validate`, so the rows are saved in the same write as the items -- no second
save, no recursion.

It only reads and never raises: `sent_back_category.py` saves a PR inside `try/except`, and a
swallowed PostgreSQL error there would roll the whole transaction back silently.

The PR Tracker needs no write here: it is computed live from these rows
(`api/critical_pr_tasks/get_projects_with_pr_stats.py`).
"""

import frappe

from nirmaan_stack.services.pr_packages import (
    ACTION_COLLAPSE,
    ACTION_REBUILD,
    categories_needing_lookup,
    derive_pr_packages,
    rows_are_clean,
    stored_packages,
    tag_rows_action,
)



def _item_dicts(doc) -> list[dict]:
    return [
        {"procurement_package": row.get("procurement_package"), "category": row.get("category")}
        for row in (doc.get("order_list") or [])
    ]


def _row_dicts(doc) -> list[dict]:
    return [
        {"tag_package": row.get("tag_package")}
        for row in (doc.get("pr_tag_list") or [])
    ]


def _valid_packages() -> set[str]:
    return set(frappe.get_all("Procurement Packages", pluck="name"))


def _category_packages(categories: set[str]) -> dict[str, str]:
    if not categories:
        return {}
    rows = frappe.get_all(
        "Category",
        filters={"name": ["in", sorted(categories)]},
        fields=["name", "work_package"],
    )
    return {row.name: row.work_package for row in rows}


def sync_pr_packages(doc) -> None:
    """Rewrite `doc.pr_tag_list` from the items when the rule says so. Called from `validate`."""
    old = doc.get_doc_before_save()
    is_new = old is None

    new_items = _item_dicts(doc)
    old_items = _item_dicts(old) if old else []
    valid = _valid_packages()
    category_packages = _category_packages(
        categories_needing_lookup(new_items + old_items, valid)
    )

    new_item_packages = derive_pr_packages(new_items, valid, category_packages)
    old_item_packages = None if is_new else derive_pr_packages(old_items, valid, category_packages)
    current_rows = _row_dicts(doc)

    action = tag_rows_action(
        is_new,
        old_item_packages,
        new_item_packages,
        _row_dicts(old) if old else None,
        current_rows,
    )
    if action == ACTION_REBUILD:
        packages = new_item_packages
    elif action == ACTION_COLLAPSE:
        packages = stored_packages(current_rows)
    else:
        return

    # Rows already exactly right: leave them, so no child rows are re-inserted for nothing.
    if rows_are_clean(current_rows) and [row["tag_package"] for row in current_rows] == packages:
        return
    doc.set("pr_tag_list", [{"tag_package": package} for package in packages])

