# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A vendor's category list, derived from the POs and Work Orders it actually supplied.

PURE MODULE -- no `frappe`, no database, no request context. The query and the writes live in
`tasks/vendor_category_sync.py`; this file only owns the rule.

THE RULE (owner, 21/09/2026)
----------------------------
    A vendor's categories = the distinct item categories on its
        POs  in PO_STATUSES   (Merged / Cancelled / Inactive skipped -- a merged PO's items
                               live on the PO it was merged into)
        WOs  in WO_STATUSES
    keeping only names that are CURRENT:
        PO categories  -> must exist in `Category`
        WO categories  -> must exist in `Category` OR `WO Service Category` (the WO form's own master)
    and never EXCLUDED_CATEGORIES.

    First run REPLACES every vendor's list (hand-entered categories are discarded). The daily run
    only ADDS -- a category, once earned, is never removed by the job.

⚠️ OLD NAMES ON PAST ROWS. `Purchase Order Item.category` / `Work Order Items.category` are Data
fields, so a Category rename never reaches them (`integrations/controllers/category.py` rewrites the
JSON fields only). RENAMED_CATEGORIES carries the renames Frappe's rename log shows kept their
MEANING; a rename that REUSED the name for a different category (HVAC Miscellaneous -> Chilled Water
Pipes, Chilled Water Piping -> Chilled Water Valve Packages, Fire Fighting Miscellaneous -> Sprinkler
Valves, Plenum Box -> HVAC Electrical Items) is deliberately NOT here: mapping it would give a vendor
a category it never supplied. Those, deleted names (Sprinkler Piping) and never-valid text (Penalty,
Additonal Charges, Test Category) fail the "current" check and are dropped.
"""

from collections import defaultdict
from typing import Dict, Iterable, List, Set, Tuple

PO_STATUSES = ("PO Approved", "Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered")
WO_STATUSES = ("Approved", "Amendment")

# Freight / loading / penalties -- not something a vendor offers.
EXCLUDED_CATEGORIES = frozenset({"Additional Charges"})

# old name still on past order rows -> its current name (from the Category rename log)
RENAMED_CATEGORIES = {
    "Sprinkler Piping & Accessories": "Sprinkler Pipes & Fittings - MS",
    "MS Sprinkler Piping & Fittings": "Sprinkler Pipes & Fittings - MS",
    "HVAC Hardware & Accessories": "HVAC Accessories",
    "Grills, Diffusers and Dampers": "Air Distribution Products",
    "DX Sysetm": "DX System",
    "Sensor & Control Panel": "BMS",
    "Fire Alarm Panel": "Conventional Fire Alarm Panel",
    "HVAC Cables": "HVAC Electrical Items",
    "Massage Manager": "Message Manager",
}

PO = "po"
WO = "wo"


def categories_by_vendor(
    pairs: Iterable[Tuple[str, str, str]],
    po_valid: Set[str],
    wo_valid: Set[str],
) -> Tuple[Dict[str, Set[str]], Dict[str, int]]:
    """(vendor, category, source) rows -> ({vendor: {current categories}}, {dropped name: pair count}).

    `source` is PO or WO; it picks which set of current names the category is checked against.
    """
    found: Dict[str, Set[str]] = defaultdict(set)
    dropped: Dict[str, int] = defaultdict(int)
    for vendor, category, source in pairs:
        if not vendor or not category:
            continue
        name = RENAMED_CATEGORIES.get(category, category)
        if name in EXCLUDED_CATEGORIES:
            continue
        if name in (po_valid if source == PO else wo_valid):
            found[vendor].add(name)
        else:
            dropped[category] += 1
    return dict(found), dict(dropped)


def merged(existing: Iterable[str], found: Iterable[str], replace: bool) -> List[str]:
    """The list to store: `found` alone when replacing, else `existing` plus `found`. Unique, sorted."""
    names = set(found) if replace else set(existing) | set(found)
    return sorted(n for n in names if n)
