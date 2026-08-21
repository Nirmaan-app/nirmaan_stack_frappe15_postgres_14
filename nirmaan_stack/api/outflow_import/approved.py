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

# ⚠️ THE EXPORT'S CEILING IS NOT THE PAGE'S, AND NEITHER MAY BE RAISED TO SUIT THE OTHER.
# `_MAX_PAGE_SIZE` guards the SCREEN: 200 rows is what a table can hand a person at once, and
# raising it would let the panel ask for the whole ledger in one render. `_MAX_EXPORT` guards a
# FILE, which nobody scrolls -- so it is far larger, and it is a different number for a different
# reason.
_MAX_EXPORT = 20000


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


@frappe.whitelist()
def export_approved_records(
    ledger: str = None,
    search: str = None,
    project: str = None,
    sort_by: str = "decided_on",
    sort_dir: str = "desc",
):
    """The WHOLE filtered set of approved-and-unpaid records, for the tab's Export control.

    ⚠️ IT TAKES EXACTLY THE FILTERS `list_approved_records` TAKES, AND READS THROUGH THE SAME
    `ledger_read.approved_rows`. It is deliberately NOT a fourth query that knows the three ledgers'
    asymmetries -- the residence manifest names `ledger_read.py` as the one owner of that, and
    `review._search_one_ledger` is already the second, deliberate caller. A third copy of "which
    columns does a Non Project Expense not have" is how two surfaces come to disagree about the same
    record. It takes no `limit`/`offset`: exporting one page of a filtered set is the defect this
    endpoint exists to remove.

    ⚠️ IT REFUSES OVER THE CAP, IT DOES NOT TRUNCATE -- the same direction as
    `review._assert_confirmable_size`, and for the same reason. A silently `LIMIT`ed download is a
    list nobody chose: the rows it dropped share no property, so nothing on the screen that produced
    it could ever account for them, and a spreadsheet outlives the session that made it. Refusing
    names both numbers and hands the person a lever -- filter, then try again.

    ⚠️ `approved_on` AND `updated_on` STAY SEPARATE COLUMNS, exactly as the page returns them
    (`ledger_read` asymmetry 1). Only `Project Payments` records an approval date; the two expense
    doctypes have no approval date, no approver and no approval step at all, so a row fills exactly
    one. A CSV is the worst place to merge them -- a modification presented as an approval survives
    in a file long after the screen that could have contradicted it is closed.
    """
    require_outflow_access()

    doctypes = _ledgers(ledger)
    search = (search or "").strip()
    project = (project or "").strip()

    # ⚠️ COUNT FIRST, under the same filters, so the refusal can name the real number rather than
    # "more than 20,000". The count is the same one the page's totals are taken from, so the figure
    # quoted here is the figure the screen was already showing.
    total = int(approved_count(doctypes, search=search, project=project)["total"])
    if total > _MAX_EXPORT:
        frappe.throw(
            f"This export would hold {total:,} records. The limit is {_MAX_EXPORT:,}. "
            "Filter by ledger or project, or search, then try again.",
            title="Too many to export at once",
        )

    rows = approved_rows(
        doctypes,
        search=search,
        project=project,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=_MAX_EXPORT,
        offset=0,
    )
    # ⚠️ THE SAME ROW SHAPE THE PAGE RETURNS, so the screen has ONE row type for both -- an export
    # that reshaped its rows would need a second renderer, and the two would drift.
    return {"rows": rows, "total": total}
