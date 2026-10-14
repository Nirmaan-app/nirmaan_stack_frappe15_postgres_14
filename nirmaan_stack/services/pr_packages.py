# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which procurement packages a Procurement Request carries.

PURE MODULE -- no `frappe`, no database, no request context. The DB-facing half (reading the
package and category masters, writing `pr_tag_list`) lives in
`integrations/controllers/procurement_request_packages.py`; the PR Tracker reads `pr_tag_list` live
(`api/critical_pr_tasks/get_projects_with_pr_stats.py`), nothing is stored for it. The frontend mirror is `frontend/src/utils/prPackages.ts`,
pinned to this file by its parity test.

THE RULE (plan: .claude/plans/pr-packages-replace-headers-plan.md)
------------------------------------------------------------------
A PR's packages come from its items, never from a hand-picked header:

1. EVERY `order_list` row counts, whatever its status -- Pending, Approved, Delayed, Sent Back,
   even Deleted. A PR whose items are all Deleted can still have live POs (9 such PRs with 10 POs
   on 2026-10-13), and those POs find their package through the PR.
2. A row's package is its `procurement_package` when that names a real Procurement Package, else
   its category's package, else nothing. An unknown name is never written: it would fail the
   Link check on `PR Tag Child Table.tag_package` and block the save.
3. `Additional Charges` is never a package.
4. Only the PR's own items count. A PO's items never add or keep a package (owner, 2026-10-14):
   a merged PO, which holds two PRs' items but points to one PR, shows under that PR's packages.

The packages are stored as `pr_tag_list` rows: one row per package, sorted. The retired header
column is never read or written here.
"""

from collections.abc import Iterable, Mapping

EXCLUDED_PACKAGES = frozenset({"Additional Charges"})

ACTION_REBUILD = "rebuild"
ACTION_COLLAPSE = "collapse"


def item_package(
    procurement_package: str | None,
    category: str | None,
    valid_packages: Iterable[str],
    category_packages: Mapping[str, str | None],
) -> str | None:
    """The package one item contributes, or None.

    The item's own `procurement_package` wins when it is a real package; otherwise the package
    its category maps to. `Additional Charges` and anything not in `valid_packages` give None.
    Pass a set: `derive_pr_packages` builds it once for all items instead of once per item.
    """
    valid = valid_packages if isinstance(valid_packages, (set, frozenset)) else set(valid_packages)
    own = (procurement_package or "").strip()
    if own in EXCLUDED_PACKAGES:
        return None
    if own and own in valid:
        return own
    mapped = (category_packages.get(category or "") or "").strip()
    if mapped and mapped in valid and mapped not in EXCLUDED_PACKAGES:
        return mapped
    return None


def derive_pr_packages(
    items: Iterable[Mapping],
    valid_packages: Iterable[str],
    category_packages: Mapping[str, str | None],
) -> list[str]:
    """The sorted, de-duplicated packages of `items` (rows with `procurement_package`, `category`).

    Status is deliberately ignored (rule 1).
    """
    valid = set(valid_packages)
    found = set()
    for item in items:
        package = item_package(
            item.get("procurement_package"), item.get("category"), valid, category_packages
        )
        if package:
            found.add(package)
    return sorted(found)


def categories_needing_lookup(items: Iterable[Mapping], valid_packages: Iterable[str]) -> set[str]:
    """Categories whose package must be read because the item's own package is not usable."""
    valid = set(valid_packages)
    needed = set()
    for item in items:
        own = (item.get("procurement_package") or "").strip()
        if own in EXCLUDED_PACKAGES or (own and own in valid):
            continue
        if item.get("category"):
            needed.add(item.get("category"))
    return needed


def tag_rows_signature(rows: Iterable[Mapping]) -> list[str]:
    """The tag rows' packages, in row order (comparable between two saves)."""
    return [(row.get("tag_package") or "").strip() for row in rows]


def rows_are_clean(rows: Iterable[Mapping]) -> bool:
    """True when every row names a package and none repeats."""
    seen = set()
    for package in tag_rows_signature(rows):
        if not package or package in seen:
            return False
        seen.add(package)
    return True


def stored_packages(rows: Iterable[Mapping]) -> list[str]:
    """The sorted, de-duplicated packages the rows already hold."""
    return sorted({package for package in tag_rows_signature(rows) if package})


def tag_rows_action(
    is_new: bool,
    old_item_packages: list[str] | None,
    new_item_packages: list[str],
    old_rows: Iterable[Mapping] | None,
    new_rows: Iterable[Mapping],
) -> str | None:
    """What a save does to `pr_tag_list`: ACTION_REBUILD, ACTION_COLLAPSE or None.

    - A new PR always rebuilds, so whatever a client sent is replaced.
    - An update rebuilds when the item packages changed, or when the request changed the tag
      rows themselves (a client or a Desk edit may not set packages by hand).
    - Any other save only collapses rows that repeat a package or name none.
    A status-only save changes no item package (rule 1), so it never rebuilds.
    """
    new_rows = list(new_rows)
    if is_new:
        return ACTION_REBUILD
    if old_item_packages != new_item_packages:
        return ACTION_REBUILD
    if tag_rows_signature(old_rows or []) != tag_rows_signature(new_rows):
        return ACTION_REBUILD
    if not rows_are_clean(new_rows):
        return ACTION_COLLAPSE
    return None
