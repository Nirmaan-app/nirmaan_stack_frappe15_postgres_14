# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Audit View report: every order, invoice and payment in a date range, project or non-project.

    nirmaan_stack.api.reports.audit_view.get_audit_view_rows                        (GET)
        view="project" | "nonproject", tab="orders" | "invoices" | "payments",
        from_date="2026-04-01" | None, to_date="2027-03-31" | None   (each bound optional, inclusive)
        -> orders:   [{against: "PO"|"WO", id, project, project_name, vendor, vendor_name, date,
                       excl_gst, gst, incl_gst, total_invoiced}, ...]           ([] for view="nonproject")
        -> invoices: [{against: "PO"|"WO"|"Project Expense"|"Non-Project Expense", id, invoice_no,
                       project, project_name, vendor, vendor_name, expense_type, date, invoice_amount,
                       order_date}, ...]
        -> payments: [{against, id, project, project_name, vendor, vendor_name, expense_type, date, utr,
                       amount_paid, tds, net_paid, is_gst_payment, order_date}, ...]
        sorted by date (blank last), then id. Every row carries every key of its tab, None where it does
        not apply; money is float, dates are "YYYY-MM-DD".

    nirmaan_stack.api.reports.audit_view.get_audit_view_summary                     (GET)
        view, from_date, to_date as above
        -> {"orders": {count, incl_gst, total_invoiced} | None (view="nonproject"),
            "invoices": {count, invoice_amount},
            "payments": {count, amount_paid, tds, net_paid}}
        the sums of exactly the rows `get_audit_view_rows` returns for the same arguments.

What each tab reads (owner-confirmed):

* Orders (project only), dated by `creation`: POs not Inactive / Cancelled / Merged, and Approved Work
  Orders. A WO's value before GST is its `work_order_items` (quantity x rate,
  `services/work_order_gst.items_value`); with no items it is `total_amount` / 1.18 when GST is on.
* Invoices, dated by invoice date: Approved Vendor Invoices on a PO / WO (`invoice_amount` only; credit
  notes are stored negative and kept so), and Paid expenses with an invoice date and a non-blank
  invoice ref (Project Expenses in the project view, Non Project Expenses in the non-project view).
* Payments, dated by payment date: Paid Project Payments on a PO / WO, and Paid expenses. Net Paid is
  Amount Paid + TDS (owner's formula). TDS is ALL the tax of the payment's Payment TDS Deduction, Vendor-
  borne (withheld) and Company-borne (paid on top) alike (owner 2026-11-20), read through the one source of
  recorded tax, `payment_tds.paid_borne_tds_sql`; never the legacy `Project Payments.tds` box. An expense
  has no TDS.

For Admin and Accountants only (`services/role_profiles.AUDIT_VIEW_PROFILES`), checked here: this is the
enforcement boundary, as the reads below skip user permissions.
"""

import frappe
from frappe import _
from frappe.utils import create_batch, flt, getdate

from nirmaan_stack.services import payment_tds
from nirmaan_stack.services.role_profiles import assert_audit_view_access
from nirmaan_stack.services.work_order_gst import GST_RATE, gst_is_on, items_value

PO = "Procurement Orders"
WO = "Service Requests"
AGAINST = {PO: "PO", WO: "WO"}
PROJECT_EXPENSE = "Project Expense"
NON_PROJECT_EXPENSE = "Non-Project Expense"

VIEWS = ("project", "nonproject")
TABS = ("orders", "invoices", "payments")
#: PO statuses that are not a live order.
PO_EXCLUDED_STATUSES = ("Inactive", "Cancelled", "Merged")
#: Child-table rows are read `parent IN (...)` in batches this size (no parent index on Postgres).
CHILD_BATCH = 2000

ORDER_KEYS = ("against", "id", "project", "project_name", "vendor", "vendor_name", "date",
              "excl_gst", "gst", "incl_gst", "total_invoiced")
INVOICE_KEYS = ("against", "id", "invoice_no", "project", "project_name", "vendor", "vendor_name",
                "expense_type", "date", "invoice_amount", "order_date", "invoice_url")
PAYMENT_KEYS = ("against", "id", "project", "project_name", "vendor", "vendor_name", "expense_type",
                "date", "utr", "amount_paid", "tds", "net_paid", "is_gst_payment", "order_date")


@frappe.whitelist(methods=["GET"])
def get_audit_view_rows(view: str, tab: str, from_date: str | None = None, to_date: str | None = None) -> list[dict]:
    """One tab of the Audit View for `view`, between the two optional, inclusive dates."""
    assert_audit_view_access(frappe.session.user)
    return _rows(view, tab, _bound(from_date), _bound(to_date))


@frappe.whitelist(methods=["GET"])
def get_audit_view_summary(view: str, from_date: str | None = None, to_date: str | None = None) -> dict:
    """The count and totals of each tab, summed from the same rows `get_audit_view_rows` returns."""
    assert_audit_view_access(frappe.session.user)
    start, end = _bound(from_date), _bound(to_date)
    invoices = _rows(view, "invoices", start, end)
    payments = _rows(view, "payments", start, end)
    orders = _rows(view, "orders", start, end) if view == "project" else None
    return {
        "orders": None if orders is None else _totals(orders, "incl_gst", "total_invoiced", by="incl_gst"),
        "invoices": _totals(invoices, "invoice_amount", by="invoice_amount"),
        "payments": _totals(payments, "amount_paid", "tds", "net_paid", by="net_paid"),
    }


# ── selection ────────────────────────────────────────────────────────────────


def _rows(view, tab, start, end):
    if view not in VIEWS:
        frappe.throw(_("Unknown view {0}.").format(view), frappe.ValidationError)
    if tab not in TABS:
        frappe.throw(_("Unknown tab {0}.").format(tab), frappe.ValidationError)
    sources = {
        ("project", "orders"): (_po_orders, _wo_orders),
        ("project", "invoices"): (_vendor_invoices, _project_expense_invoices),
        ("project", "payments"): (_order_payments, _project_expense_payments),
        ("nonproject", "orders"): (),
        ("nonproject", "invoices"): (_non_project_expense_invoices,),
        ("nonproject", "payments"): (_non_project_expense_payments,),
    }[(view, tab)]
    keys = {"orders": ORDER_KEYS, "invoices": INVOICE_KEYS, "payments": PAYMENT_KEYS}[tab]
    rows = [dict.fromkeys(keys) | row for source in sources for row in source(start, end)]
    _fill_names(rows)
    rows.sort(key=lambda r: (r["date"] is None, r["date"] or "", r["id"] or ""))
    return rows


def _po_orders(start, end):
    pos = frappe.get_all(
        PO,
        filters=[["status", "not in", PO_EXCLUDED_STATUSES], *_creation_between(start, end)],
        fields=["name", "creation", "project", "project_name", "vendor", "vendor_name", "amount",
                "tax_amount", "total_amount", "amount_invoiced"],
    )
    return [
        {"against": "PO", "id": po.name, "project": po.project, "project_name": po.project_name,
         "vendor": po.vendor, "vendor_name": po.vendor_name, "date": _day(po.creation),
         "excl_gst": flt(po.amount), "gst": flt(po.tax_amount), "incl_gst": flt(po.total_amount),
         "total_invoiced": flt(po.amount_invoiced)}
        for po in pos
    ]


def _wo_orders(start, end):
    wos = frappe.get_all(
        WO,
        filters=[["status", "=", "Approved"], *_creation_between(start, end)],
        fields=["name", "creation", "project", "vendor", "total_amount", "gst", "amount_invoiced"],
    )
    items = _work_order_items([wo.name for wo in wos])
    rows = []
    for wo in wos:
        incl = flt(wo.total_amount)
        if wo.name in items:
            excl = flt(items_value(items[wo.name]), 2)
        else:
            excl = flt(incl / (1 + GST_RATE), 2) if gst_is_on(wo.gst) else incl
        rows.append({
            "against": "WO", "id": wo.name, "project": wo.project, "vendor": wo.vendor,
            "date": _day(wo.creation), "excl_gst": excl, "gst": flt(incl - excl, 2), "incl_gst": incl,
            "total_invoiced": flt(wo.amount_invoiced),
        })
    return rows


def _vendor_invoices(start, end):
    invoices = frappe.get_all(
        "Vendor Invoices",
        filters=[["status", "=", "Approved"], ["document_type", "in", (PO, WO)],
                 *_date_between("invoice_date", start, end)],
        fields=["document_type", "document_name", "invoice_no", "project", "vendor", "invoice_date",
                "invoice_amount", "invoice_attachment"],
    )
    order_dates = _order_dates(invoices)
    # The invoice file lives on its Nirmaan Attachments record; one batched lookup for all of them.
    files = _names("Nirmaan Attachments", "attachment", {inv.invoice_attachment for inv in invoices})
    return [
        {"against": AGAINST[inv.document_type], "id": inv.document_name, "invoice_no": inv.invoice_no,
         "project": inv.project, "vendor": inv.vendor, "date": _day(inv.invoice_date),
         "invoice_amount": flt(inv.invoice_amount),
         "order_date": order_dates.get((inv.document_type, inv.document_name)),
         "invoice_url": files.get(inv.invoice_attachment) or None}
        for inv in invoices
    ]


def _project_expense_invoices(start, end):
    return _expense_invoices("Project Expenses", PROJECT_EXPENSE, start, end)


def _non_project_expense_invoices(start, end):
    return _expense_invoices("Non Project Expenses", NON_PROJECT_EXPENSE, start, end)


def _expense_invoices(doctype, against, start, end):
    """Paid expenses that carry an invoice: an invoice date and a non-blank invoice ref."""
    project_fields = ["projects", "vendor"] if doctype == "Project Expenses" else []
    expenses = frappe.get_all(
        doctype,
        filters=[["status", "=", "Paid"], *_date_between("invoice_date", start, end)],
        fields=["name", "type", "invoice_date", "invoice_ref", "amount", "invoice_attachment", *project_fields],
    )
    return [
        {"against": against, "id": e.name, "invoice_no": e.invoice_ref.strip(), "project": e.get("projects"),
         "vendor": e.get("vendor"), "expense_type": e.type, "date": _day(e.invoice_date),
         "invoice_amount": flt(e.amount), "invoice_url": e.invoice_attachment or None}
        for e in expenses
        if e.invoice_date and (e.invoice_ref or "").strip()  # `"is", "set"` on a Date breaks on Postgres
    ]


def _order_payments(start, end):
    payments = frappe.get_all(
        "Project Payments",
        filters=[["status", "=", "Paid"], ["document_type", "in", (PO, WO)],
                 *_date_between("payment_date", start, end)],
        fields=["name", "document_type", "document_name", "project", "vendor", "payment_date", "utr", "amount",
                "is_gst_payment"],
    )
    order_dates = _order_dates(payments)
    recorded = _recorded_tds({p.name for p in payments})
    rows = []
    for p in payments:
        amount, tds = flt(p.amount), recorded.get(p.name, 0.0)
        rows.append({
            "against": AGAINST[p.document_type], "id": p.document_name, "project": p.project,
            "vendor": p.vendor, "date": _day(p.payment_date), "utr": p.utr, "amount_paid": amount,
            "tds": tds, "net_paid": flt(amount + tds, 2), "is_gst_payment": bool(p.is_gst_payment),
            "order_date": order_dates.get((p.document_type, p.document_name)),
        })
    return rows


def _recorded_tds(names: set) -> dict:
    """`{payment: its recorded tax}` for the given Paid payments: Vendor-borne + Company-borne, from their Payment
    TDS Deduction through `payment_tds.paid_borne_tds_sql` (the shared source: a PO payment still stored gross
    counts no tax on top). A payment with no deduction is absent. Batched like `_names`."""
    found = {}
    for batch in create_batch(sorted(n for n in names if n), CHILD_BATCH):
        rows = frappe.db.sql(
            f"""
            SELECT t.project_payment, t.vendor_borne_tds, t.company_borne_tds
            FROM ({payment_tds.paid_borne_tds_sql()}) t
            WHERE t.project_payment IN %(names)s
            """,
            {"names": tuple(batch)},
            as_dict=True,
        )
        found.update({r.project_payment: flt(flt(r.vendor_borne_tds) + flt(r.company_borne_tds), 2) for r in rows})
    return found


def _project_expense_payments(start, end):
    return _expense_payments("Project Expenses", PROJECT_EXPENSE, start, end)


def _non_project_expense_payments(start, end):
    return _expense_payments("Non Project Expenses", NON_PROJECT_EXPENSE, start, end)


def _expense_payments(doctype, against, start, end):
    project_fields = ["projects", "vendor"] if doctype == "Project Expenses" else []
    expenses = frappe.get_all(
        doctype,
        filters=[["status", "=", "Paid"], *_date_between("payment_date", start, end)],
        fields=["name", "type", "payment_date", "payment_ref", "amount", *project_fields],
    )
    return [
        {"against": against, "id": e.name, "project": e.get("projects"), "vendor": e.get("vendor"),
         "expense_type": e.type, "date": _day(e.payment_date), "utr": e.payment_ref,
         "amount_paid": flt(e.amount), "tds": None, "net_paid": flt(e.amount), "is_gst_payment": False}
        for e in expenses
    ]


# ── lookups ──────────────────────────────────────────────────────────────────


def _work_order_items(names):
    """{Work Order: [its `work_order_items` rows]}, read in batches of `parent IN (...)`."""
    items = {}
    for batch in create_batch(names, CHILD_BATCH):
        for row in frappe.get_all(
            "Work Order Items",
            filters={"parenttype": WO, "parentfield": "work_order_items", "parent": ["in", batch]},
            fields=["parent", "quantity", "rate"],
        ):
            items.setdefault(row.parent, []).append(row)
    return items


def _order_dates(rows):
    """{(doctype, order): its creation date} for the PO / WO each row is against."""
    dates = {}
    for doctype in (PO, WO):
        names = list({r.document_name for r in rows if r.document_type == doctype and r.document_name})
        for batch in create_batch(names, CHILD_BATCH):
            for name, creation in frappe.get_all(
                doctype, filters={"name": ["in", batch]}, fields=["name", "creation"], as_list=True
            ):
                dates[(doctype, name)] = _day(creation)
    return dates


def _fill_names(rows):
    """Fill a blank project / vendor name from the Projects / Vendors record."""
    projects = _names("Projects", "project_name", {r["project"] for r in rows if not r["project_name"]})
    vendors = _names("Vendors", "vendor_name", {r["vendor"] for r in rows if not r["vendor_name"]})
    for row in rows:
        row["project_name"] = row["project_name"] or projects.get(row["project"])
        row["vendor_name"] = row["vendor_name"] or vendors.get(row["vendor"])


def _names(doctype: str, field: str, names: set) -> dict:
    """{name: field} for `names`, in batches: one `IN (...)` of thousands of names (every invoice's
    attachment under the ALL range) trips sqlparse's 10,000-token cap."""
    names = [n for n in names if n]
    found = {}
    for batch in create_batch(names, CHILD_BATCH):
        found.update(frappe.get_all(doctype, filters={"name": ["in", batch]}, fields=["name", field], as_list=True))
    return found


# ── helpers ──────────────────────────────────────────────────────────────────


def _bound(value):
    """A "YYYY-MM-DD" bound, or None for no bound. A malformed date is refused."""
    return str(getdate(value)) if value else None


def _date_between(field, start, end):
    return ([[field, ">=", start]] if start else []) + ([[field, "<=", end]] if end else [])


def _creation_between(start, end):
    return _date_between(
        "creation", start and f"{start} 00:00:00", end and f"{end} 23:59:59.999999"
    )


def _day(value):
    return str(getdate(value)) if value else None


def _totals(rows, *fields, by):
    """Count and sums of `fields`, plus `by_against`: the tab's headline figure (`by`) per Against
    (PO / WO / Project Expense / Non-Project Expense), for the tab card's type-mix bar."""
    by_against = {}
    for r in rows:
        by_against[r["against"]] = by_against.get(r["against"], 0) + flt(r[by])
    return {
        "count": len(rows),
        **{f: flt(sum(flt(r[f]) for r in rows), 2) for f in fields},
        "by_against": {k: flt(v, 2) for k, v in by_against.items()},
    }
