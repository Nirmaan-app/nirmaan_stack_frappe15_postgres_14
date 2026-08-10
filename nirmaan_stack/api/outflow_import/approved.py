"""The approved inbox: what has been sanctioned and not yet paid, across all three ledgers.

⚠️ THIS IS NOT THE DELETED REVERSE VIEW, and the difference is worth stating because the two are one
step apart. `get_reconciliation_report` was removed at V5, taking with it "is every payment we
recorded backed by a real transfer?" -- a scope decision, not an oversight, and it read BACKWARDS
from records already Paid. This reads FORWARDS from records still Approved: the queue this import
exists to consume. It answers "what is waiting", not "what did we get wrong".

⚠️ IT IS A SEPARATE MODULE FROM `review.py` ON PURPOSE. That file is past 1,800 lines and the app's
convention splits anything over ~500 into focused submodules. It also reads a different set of
doctypes from everything in there -- no `Outflow Import Row` is involved at any point.

⚠️ NOTHING HERE WRITES. It is a read of other modules' records; settling one is still `settle_row`'s
job, reached from a transfer. A screen that could mark an approved payment Paid without a transfer in
front of it would be a second, quieter way to spend money.
"""

import frappe

from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.services.outflow_import.ledger_read import (
    LEDGER_SOURCES,
    SORTABLE,
    approved_count,
    approved_projects,
    approved_rows,
)

_DEFAULT_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 200


@frappe.whitelist()
def list_approved_records(
    ledger: str = None,
    search: str = None,
    project: str = None,
    sort_by: str = "decided_on",
    sort_dir: str = "desc",
    limit=_DEFAULT_PAGE_SIZE,
    offset=0,
):
    """One page of approved-and-unpaid records, plus the totals under the same filters.

    ⚠️ THE TOTALS ARE COMPUTED UNDER THE SAME FILTERS AS THE PAGE, for the reason `_row_filters`
    exists on the transfers side: a count taken under different filters than the list it labels is a
    lie that looks like a paging bug. This feature has already shipped that defect once.

    ⚠️ `by_ledger` IS RETURNED BECAUSE THE THREE ARE NOT COMPARABLE. On the live database the split
    is roughly 1,082 payments against 68 non-project and 14 project expenses -- a single total hides
    that two of the three ledgers are rounding errors beside the first, which is exactly the sort of
    thing a person opening this screen wants to see straight away.
    """
    require_outflow_access()

    doctypes = _ledgers(ledger)
    limit = max(1, min(int(limit or _DEFAULT_PAGE_SIZE), _MAX_PAGE_SIZE))
    offset = max(0, int(offset or 0))
    search = (search or "").strip()
    project = (project or "").strip()

    rows = approved_rows(
        doctypes,
        search=search,
        project=project,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=limit,
        offset=offset,
    )
    counts = approved_count(doctypes, search=search, project=project)

    return {
        "rows": rows,
        "total": counts["total"],
        "value": counts["value"],
        "by_ledger": counts["by_ledger"],
        "limit": limit,
        "offset": offset,
        "ledger": ledger or "",
        "sortable": sorted(SORTABLE),
    }


@frappe.whitelist()
def get_approved_projects(ledger: str = None):
    """The projects that approved records actually sit on, for the tab's project filter.

    ⚠️ NOT EVERY PROJECT IN THE SYSTEM. A filter offering 194 projects when 38 of them have anything
    approved is a list you scroll past rather than use -- the same reason the transfers table's
    funnels are built from the rows that exist rather than from the master data behind them.
    """
    require_outflow_access()
    # ⚠️ A DISTINCT QUERY, NOT A PAGE OF ROWS. The first version read `approved_rows(limit=200)` and
    # collected the names it saw -- which silently dropped every project sorting past the cap, on a
    # set of 332. A filter missing an option reads as "nothing is approved there".
    return {"projects": approved_projects(_ledgers(ledger))}


def _ledgers(ledger: str = None):
    """Which ledgers to read. An unknown name reads them ALL rather than none.

    ⚠️ FAILING OPEN IS THE RIGHT WAY ROUND HERE, and it matches `_scope_clause`'s unknown-scope
    fallback. This is a read-only browse: a typo that shows too much is a nuisance, and one that
    silently shows an empty screen looks like "there is nothing approved" -- which on this screen is
    a materially wrong answer.
    """
    wanted = (ledger or "").strip()
    if wanted in LEDGER_SOURCES:
        return [wanted]
    return list(LEDGER_SOURCES)
