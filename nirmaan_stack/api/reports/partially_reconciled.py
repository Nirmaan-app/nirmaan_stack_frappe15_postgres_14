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

⚠️ DATED BY THE BANK LINE, NOT THE RECORD. These records carry no `payment_date` at all
(`derive_expense_status` withholds it until the lines cover the amount), so there is nothing on
them a date range could test. The bank line's `added_on` is the date the money moved AND the date
the record will inherit as its `payment_date` the moment it goes Paid -- so a range that catches
the money today catches the same record tomorrow, under the same date, once it settles.

⚠️ THIS IS WHY IT DIFFERS FROM THE PAYMENTS DASHBOARD CARD, which counts a dateless record as
inside its window. The card's window is fixed at 30 days and never asked about; a report's range is
chosen by the reader, and a figure that ignores their choice is worse than one that answers it.
"""

import frappe

from nirmaan_stack.services.outflow_import.expense_links import load_linked_totals

RECONCILIATION_PENDING = "Reconciliation Pending"

# Which ledgers roll up into which report. The project report shows PO/WO payments AND project
# expenses in one table, so its figure spans both -- the same pairing `useOutflowReportData` makes.
_REPORTS = {
    "project": ("Project Payments", "Project Expenses"),
    "non_project": ("Non Project Expenses",),
}


def _done_for(ledgers, from_date=None, to_date=None):
    """The confirmed part of every Reconciliation Pending record in `ledgers`.

    ⚠️ `items` CARRIES THE PO/WO REFERENCE, and it is there for one reason: the report's
    **Estimated (Excl. GST)** figure divides each row by that document's effective GST, and the
    rate lives on the order -- there is no server-side reader for it (`useOrderTotals.getEffectiveGST`
    is the only one, on the client). So the split is handed over per record and the caller applies
    the SAME rule it applies to the table's own rows. An expense carries no document and no rate,
    exactly as `useOutflowReportData` gives every expense row `effective_gst: 0`.
    """
    amount, count, items = 0.0, 0, []
    for ledger in ledgers:
        is_payment = ledger == "Project Payments"
        fields = ["name"] + (["document_type", "document_name"] if is_payment else [])
        pending = {
            row.name: row
            for row in frappe.get_all(
                ledger,
                filters={"status": RECONCILIATION_PENDING},
                fields=fields,
                limit_page_length=None,
            )
        }
        if not pending:
            continue
        for name, links in load_linked_totals(ledger, from_date, to_date).items():
            record = pending.get(name)
            if record is None:
                continue
            confirmed = float(links.linked_total)
            if not confirmed:
                continue
            amount += confirmed
            count += 1
            items.append({
                "doctype": ledger,
                "name": name,
                "amount": confirmed,
                "document_type": record.get("document_type") if is_payment else None,
                "document_name": record.get("document_name") if is_payment else None,
            })
    return {"amount": amount, "count": count, "items": items}


@frappe.whitelist(allow_guest=False)
def get_partially_reconciled(from_date=None, to_date=None):
    """Partially Reconciled for both Outflow Reports, for an optional date range.

    URL: /api/method/nirmaan_stack.api.reports.partially_reconciled.get_partially_reconciled

    `from_date` / `to_date` are the report's own range and are applied to the BANK LINE's date (see
    the module docstring). Omit both for all time, which is what the reports' default "ALL" range
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
