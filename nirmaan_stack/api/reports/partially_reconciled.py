# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""**Partially Reconciled** -- the money the Outflow Reports' `status = "Paid"` filter cannot see.

Both Outflow Reports count Paid records and nothing else (`useOutflowReportData` hard-filters the
two project ledgers; the Non-Project report is the expenses page sitting on its Paid tab). A record
in `Reconciliation Pending` is money that HAS left the bank -- some of it already confirmed by bank
lines -- but it is not Paid, so none of it reaches those totals.

This returns the confirmed part, by report, so each summary can print

    Total Paid  +  Partially Reconciled  =  Total

⚠️ THE SUMMARY ONLY, NEVER THE TABLE (owner, 2026-09-23). The rows stay exactly what they were:
Paid records. A part-reconciled record is not a transaction anybody can point at in that list -- it
is part of one, still open -- so it belongs in the figure above the table and nowhere in it.

⚠️ DATED BY THE NEWEST BANK LINE, ALL OR NOTHING (owner, 2026-09-24). These records carry no
`payment_date` at all (`derive_expense_status` withholds it until the lines cover the amount), so
the record's newest bank line stands in for it -- the very date it will inherit as `payment_date`
the moment it goes Paid. A record counts IN FULL (its whole confirmed part) when that date falls in
the reader's range, and not at all otherwise; a record whose lines carry no date is out of any
range. The rule is `expense_links.latest_line_in_range`, and the Payments dashboard card reads the
SAME one -- so the card's 30 days and a report range of the same 30 days agree to the rupee.

⚠️ THIS REPLACES A LINE-BY-LINE RULE (2026-09-23) that counted only the lines inside the range. That
split one record across periods while a Paid record is never split, so the figure jumped when a
record's last line landed and it flipped to Paid.
"""

import frappe

from nirmaan_stack.services.outflow_import.expense_links import (
    latest_line_in_range,
    load_part_reconciled,
)

RECONCILIATION_PENDING = "Reconciliation Pending"

# Which ledgers roll up into which report. The project report shows PO/WO payments AND project
# expenses in one table, so its figure spans both -- the same pairing `useOutflowReportData` makes.
_REPORTS = {
    "project": ("Project Payments", "Project Expenses"),
    "non_project": ("Non Project Expenses",),
}


# The fields each ledger lends a row of the report's detail dialog. Project Expenses spell the
# project `projects`; the other two ledgers use `project` or have none.
_DETAIL_FIELDS = {
    "Project Payments": ["name", "amount", "project", "document_type", "document_name"],
    "Project Expenses": ["name", "amount", "projects as project", "type", "description"],
    "Non Project Expenses": ["name", "amount", "type", "description"],
}


def _done_for(ledgers, from_date=None, to_date=None):
    """The confirmed part of every part-reconciled record in `ledgers` whose newest line is in range.

    ⚠️ `items` CARRIES THE PO/WO REFERENCE, and it is there for one reason: the report's
    **Estimated (Excl. GST)** figure divides each row by that document's effective GST, and the
    rate lives on the order -- there is no server-side reader for it (`useOrderTotals.getEffectiveGST`
    is the only one, on the client). So the split is handed over per record and the caller applies
    the SAME rule it applies to the table's own rows. An expense carries no document and no rate,
    exactly as `useOutflowReportData` gives every expense row `effective_gst: 0`.

    The rest of each item (`bill_amount`, `latest_line_date`, `line_count`, project, type,
    description) feeds the report's "Partially Reconciled" dialog. `amount` stays the CONFIRMED part
    -- the figure the summary adds -- so the dialog's total is the headline's addend by construction.
    """
    amount, count, items = 0.0, 0, []
    for ledger in ledgers:
        part = {
            name: links
            for name, links in load_part_reconciled(ledger).items()
            if latest_line_in_range(links, from_date, to_date)
        }
        if not part:
            continue
        records = {
            row.name: row
            for row in frappe.get_all(
                ledger,
                filters={"name": ["in", list(part)]},
                fields=_DETAIL_FIELDS[ledger],
                limit_page_length=None,
            )
        }
        for name, links in part.items():
            record = records.get(name) or frappe._dict()
            confirmed = float(links.linked_total)
            bill = float(record.get("amount") or 0)
            amount += confirmed
            count += 1
            items.append({
                "doctype": ledger,
                "name": name,
                "amount": confirmed,
                "bill_amount": bill,
                "pending_amount": bill - confirmed,
                "latest_line_date": links.latest_line_date,
                "line_count": links.line_count,
                "project": record.get("project"),
                "type": record.get("type"),
                "description": record.get("description"),
                "document_type": record.get("document_type"),
                "document_name": record.get("document_name"),
            })
    _attach_project_names(items)
    items.sort(key=lambda i: (str(i["latest_line_date"] or ""), i["name"]), reverse=True)
    return {"amount": amount, "count": count, "items": items}


def _attach_project_names(items):
    """Each item's `project_name`, in one read -- the dialog shows the name, not the id."""
    ids = {i["project"] for i in items if i.get("project")}
    names = (
        {
            p.name: p.project_name
            for p in frappe.get_all(
                "Projects",
                filters={"name": ["in", list(ids)]},
                fields=["name", "project_name"],
                limit_page_length=None,
            )
        }
        if ids
        else {}
    )
    for item in items:
        item["project_name"] = names.get(item.get("project")) if item.get("project") else None


@frappe.whitelist(allow_guest=False)
def get_partially_reconciled(from_date=None, to_date=None):
    """Partially Reconciled for both Outflow Reports, for an optional date range.

    URL: /api/method/nirmaan_stack.api.reports.partially_reconciled.get_partially_reconciled

    `from_date` / `to_date` are the report's own range and are applied to each record's NEWEST bank
    line date (see the module docstring). Omit both for all time, which is what the reports' default "ALL" range
    means.

    Returns `{"project": {...}, "non_project": {...}}`, each `{"amount", "count", "items"}`.
    `count` is RECORDS, not bank lines: one record several lines part-cover counts once, the same
    way a Paid record is one row in the table above the figure. `items` is that same money per
    record, carrying the PO/WO reference where there is one, so a caller can apply GST the way the
    table does (see `_done_for`).
    """
    from_date = from_date or None
    to_date = to_date or None
    return {
        report: _done_for(ledgers, from_date, to_date)
        for report, ledgers in _REPORTS.items()
    }
