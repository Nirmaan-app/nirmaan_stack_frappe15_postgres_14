# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Add to old PRs the packages their items carry but their tag rows miss. ADD-ONLY.

Runs after `pr_tags_one_row_per_package` (registered right after it). It is a SEPARATE patch, not a step of
that one, because patches are append-only: a site that already ran the first one (localhost did, 2026-10-14)
never runs an edited version of it, but does run a new patch -- so every site ends up the same.

WHY
    Since 2026-10 a PR's packages come from its items (`services/pr_packages.py`, written by the save hook in
    `integrations/controllers/procurement_request_packages.py`). Old PRs still hold the packages of the headers
    someone picked, and 948 of them (localhost, 2026-10-14) miss a package their items carry -- mostly Tool &
    Equipments (789 of 1,034 rows). This adds those packages so old and new PRs follow the same rule.

⚠️ IT NEVER REMOVES A PACKAGE
    A package a user picked through a header stays even when no item has it -- most are tools PRs tagged
    "Electrical Work" or "HVAC System" whose POs are linked to Critical PO tasks under that package. Each PR's
    packages after = before ∪ its item packages; anything else raises and the whole patch rolls back.

THE RULE IS THE SAVE HOOK'S
    `derive_pr_packages`: every item counts whatever its status, its own package if real else its category's,
    never Additional Charges. New rows: one per added package, no header, `idx` after the PR's last row.

⚠️ RAW INSERTS, NO HOOKS -- AND WHY THAT IS SAFE
    The PR Tracker, the PR lists and Critical PO linking read these rows live; nothing derived from them is
    stored. PR `modified` is not touched.

WHAT USERS SEE AFTERWARDS
    The PRs that gain a package -- and their POs -- also show under it: in the PR lists' Package filter, in the
    PR Tracker, and in the Critical PO "Select Package" dropdown (1,204 POs gain a listing, 38 projects gain an
    option, mostly Tool & Equipments). No PO leaves a package; existing Critical PO links are untouched.

IDEMPOTENT: a second run adds nothing.

DRY RUN (reads only, writes nothing):
    bench --site <site> execute nirmaan_stack.patches.v3_0.pr_tags_add_item_packages.dry_run
"""

from collections import Counter, defaultdict
from dataclasses import dataclass, field

import frappe
from frappe.utils import now

from nirmaan_stack.services.pr_packages import categories_needing_lookup, derive_pr_packages

TABLE = "`tabPR Tag Child Table`"
SCOPE = "parenttype = 'Procurement Requests' AND parentfield = 'pr_tag_list'"


@dataclass
class AddPlan:
    add: list[tuple[str, str]] = field(default_factory=list)  # (pr, package)
    packages_before: dict = field(default_factory=dict)       # {pr: frozenset}
    max_idx: dict = field(default_factory=dict)               # {pr: int}


def _tag_state() -> tuple[dict, dict]:
    packages = defaultdict(set)
    max_idx = {}
    for parent, package, idx in frappe.db.sql(f"SELECT parent, tag_package, idx FROM {TABLE} WHERE {SCOPE}"):
        if (package or "").strip():
            packages[parent].add(package.strip())
        max_idx[parent] = max(max_idx.get(parent, 0), idx or 0)
    return {pr: frozenset(p) for pr, p in packages.items()}, max_idx


def plan_additions() -> AddPlan:
    """What the patch will add. Reads only."""
    valid = set(frappe.get_all("Procurement Packages", pluck="name"))
    items_by_pr = defaultdict(list)
    for parent, package, category in frappe.db.sql(
        "SELECT parent, procurement_package, category FROM `tabProcurement Request Item Detail` "
        "WHERE parenttype = 'Procurement Requests' AND parentfield = 'order_list'"
    ):
        items_by_pr[parent].append({"procurement_package": package, "category": category})

    needed = categories_needing_lookup([item for items in items_by_pr.values() for item in items], valid)
    category_packages = dict(
        frappe.db.sql("SELECT name, work_package FROM `tabCategory` WHERE name IN %s", (tuple(needed),))
    ) if needed else {}

    packages_before, max_idx = _tag_state()
    plan = AddPlan(packages_before=packages_before, max_idx=max_idx)
    existing_prs = set(frappe.get_all("Procurement Requests", pluck="name"))
    for pr in sorted(items_by_pr):
        if pr not in existing_prs:
            continue
        missing = set(derive_pr_packages(items_by_pr[pr], valid, category_packages)) - packages_before.get(pr, frozenset())
        plan.add.extend((pr, package) for package in sorted(missing))
    return plan


def apply_additions(plan: AddPlan) -> None:
    """Insert the rows. Commits nothing -- `execute()` does."""
    if not plan.add:
        return
    timestamp = now()
    next_idx = dict(plan.max_idx)
    values = []
    for pr, package in plan.add:
        next_idx[pr] = next_idx.get(pr, 0) + 1
        values.append((
            frappe.generate_hash(length=10), timestamp, timestamp, "Administrator", "Administrator", 0,
            next_idx[pr], pr, "pr_tag_list", "Procurement Requests", package,
        ))
    frappe.db.bulk_insert(
        "PR Tag Child Table",
        fields=["name", "creation", "modified", "owner", "modified_by", "docstatus",
                "idx", "parent", "parentfield", "parenttype", "tag_package"],
        values=values,
    )


def verify(plan: AddPlan) -> None:
    """Raise unless every PR's packages are exactly before ∪ added."""
    after, _ = _tag_state()
    expected = defaultdict(set, {pr: set(p) for pr, p in plan.packages_before.items()})
    for pr, package in plan.add:
        expected[pr].add(package)
    wrong = sorted(
        pr for pr in set(expected) | set(after)
        if frozenset(expected.get(pr, set())) != after.get(pr, frozenset())
    )
    if wrong:
        frappe.throw(f"pr_tags_add_item_packages: refused -- {len(wrong)} PR(s) not as planned ({wrong[:10]})")


def report(plan: AddPlan) -> str:
    by_package = Counter(package for _, package in plan.add)
    return (
        f"pr_tags_add_item_packages: add {len(plan.add)} rows on {len({pr for pr, _ in plan.add})} PRs; "
        f"by package {dict(by_package.most_common())}; nothing removed"
    )


def dry_run() -> str:
    """Print what `execute()` would add. Writes nothing."""
    message = report(plan_additions())
    print(message)
    return message


def execute():
    plan = plan_additions()
    apply_additions(plan)
    verify(plan)
    frappe.db.commit()
    print(report(plan))
