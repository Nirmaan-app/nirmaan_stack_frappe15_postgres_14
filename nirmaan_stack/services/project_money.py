# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A project's outflow, Current Liabilities, inflow and cashflow gap: the one server figure (#1456, ADR-0034).

The terms are `GLOSSARY.md` *Project outflow* and *Current Liabilities*:

  * outflow -- cash, not orders: every Paid Project Payment on the project (whatever state its order is
    in now), less its Received Vendor Refunds against a PO / Work Order, plus its Paid Expenses, plus the
    TDS on its Paid Work Order payments, both the tax withheld from the vendor and the tax the company paid
    on top (ADR-0034 Amendment A). It is kept as its three parts (PO payments, Work Order payments and
    their TDS, expenses; each refund comes off its own order kind), which the project's Financials shows as
    the outflow breakdown; `outflow` is their sum.

    The tax is read off the deduction rows of the Paid payments, keyed and dated by the PAYMENT (its
    project, its date), never by the challan: a challan covers many projects and a whole year. The
    challan itself is recorded later as a *TDS Payment* expense, a Non-Project Expense, which this figure
    never reads, so the tax is not counted twice.
  * liabilities -- max(0, delivered - Amount Paid) per PO, summed over the project's POs except Merged,
    Cancelled and Inactive (what they delivered is counted on the PO that replaced them).
  * inflow -- every Project Inflow.
  * cashflow gap -- outflow + liabilities - inflow.

CEO Hold (`integrations/controllers/project_cashflow_hold_update`), the Projects list rollup
(`api/projects/project_aggregates.get_projects_financial_rollup`) and the endpoints in
`api/projects/project_money` read `project_money`; no reader works the gap out on its own.

A date range counts each row on its own date: a payment, expense and inflow on its `payment_date`, a
refund on the refund's `payment_date` (not its order's), a WO payment's TDS on its payment's, each falling back to the row's creation date
when blank. Liabilities are a standing figure, not cash on a date: in a range they cover the POs created
in it (the Cash Sheet's PO set).
"""

from dataclasses import asdict, dataclass

import frappe
from frappe.utils import flt

from nirmaan_stack.services.money_dates import ON_PAYMENT_DATE, date_range_clauses
from nirmaan_stack.services.payment_tds import paid_borne_tds_sql
from nirmaan_stack.services.vendor_refunds import LOWERS_PAID_STATUSES, REFUND_DOCUMENT_FIELDS

#: POs whose delivered value is not a liability: it is counted on the PO that replaced them.
LIABILITY_EXCLUDED_PO_STATUSES = ("Merged", "Cancelled", "Inactive")
#: Payments and refunds on this order kind make the Work Order part of the outflow; every other order
#: kind's make the PO part, so no payment can fall out of the outflow.
WORK_ORDER_DOCTYPE = "Service Requests"
#: The TDS on each Paid Work Order payment, both kinds (withheld from the vendor + paid by the company on
#: top), from the one split (`payment_tds.paid_borne_tds_sql`): one row per deduction, with its payment's
#: project and dates. Binds `%(work_order)s`. Part of the outflow (`project_money`), and read on its own
#: by `work_order_tds_by_project`.
_WORK_ORDER_TDS_ROWS = f"""
    SELECT project, payment_date, creation, vendor_borne_tds + company_borne_tds AS tds_amount
    FROM ({paid_borne_tds_sql()}) AS paid_tds
    WHERE document_type = %(work_order)s
"""


@dataclass(frozen=True)
class ProjectMoney:
    """One project's money figures. `outflow` and `cashflow_gap` are derived, so neither can disagree
    with its parts."""

    po_outflow: float = 0.0
    wo_outflow: float = 0.0
    expense_outflow: float = 0.0
    liabilities: float = 0.0
    inflow: float = 0.0

    @property
    def outflow(self) -> float:
        return self.po_outflow + self.wo_outflow + self.expense_outflow

    @property
    def cashflow_gap(self) -> float:
        return self.outflow + self.liabilities - self.inflow

    def as_dict(self) -> dict:
        return {**asdict(self), "outflow": self.outflow, "cashflow_gap": self.cashflow_gap}


def project_money_of(project: str, from_date=None, to_date=None) -> ProjectMoney:
    """`project_money` for one project."""
    return project_money([project], from_date, to_date).get(project, ProjectMoney())


def work_order_tds_by_project(projects=None) -> dict[str, float]:
    """`{project: tax}`, all time: the part of each project's `wo_outflow` that is the TDS on its Paid
    Work Order payments (both kinds), the same rows `project_money` counts. For the 2026-10-20 recount
    patch, whose CEO Hold preview works out each gap as it was before the tax was counted (#1513).
    A project with no such tax is missing; read it as 0."""
    if projects is not None and not projects:
        return {}
    in_projects = "AND project IN %(projects)s" if projects is not None else ""
    rows = frappe.db.sql(
        f"""
        SELECT project, SUM(tds_amount) AS tds
        FROM ({_WORK_ORDER_TDS_ROWS}) AS work_order_tds
        WHERE COALESCE(project, '') <> '' {in_projects}
        GROUP BY project
        """,
        {"work_order": WORK_ORDER_DOCTYPE, "projects": tuple(projects or ())},
        as_dict=True,
    )
    return {row.project: flt(row.tds) for row in rows}


def project_money(projects=None, from_date=None, to_date=None) -> dict[str, ProjectMoney]:
    """`{project: ProjectMoney}` for `projects` (every project when None), in ONE grouped query.

    A project with no rows at all is missing from the result; read it as `ProjectMoney()`. `from_date`
    and `to_date` are optional and inclusive, each on its own.
    """
    if projects is not None and not projects:
        return {}

    values = {
        "refund_statuses": tuple(LOWERS_PAID_STATUSES),
        "refund_doctypes": tuple(REFUND_DOCUMENT_FIELDS),
        "excluded_po_statuses": LIABILITY_EXCLUDED_PO_STATUSES,
        "work_order": WORK_ORDER_DOCTYPE,
        "projects": tuple(projects or ()),
        "from_date": from_date,
        "to_date": to_date,
    }

    def scope(project_col: str, date_expr: str) -> str:
        clauses = [f"COALESCE({project_col}, '') <> ''"]
        if projects is not None:
            clauses.append(f"{project_col} IN %(projects)s")
        return " AND ".join(clauses + date_range_clauses(date_expr, from_date, to_date))

    def order_cash(amount: str) -> str:
        """An order payment's or refund's cash, as its PO-part and Work-Order-part columns."""
        return (
            f"CASE WHEN document_type = %(work_order)s THEN 0 ELSE {amount} END AS po_outflow, "
            f"CASE WHEN document_type = %(work_order)s THEN {amount} ELSE 0 END AS wo_outflow"
        )

    rows = frappe.db.sql(
        f"""
        SELECT project, SUM(po_outflow) AS po_outflow, SUM(wo_outflow) AS wo_outflow,
            SUM(expense_outflow) AS expense_outflow, SUM(liabilities) AS liabilities, SUM(inflow) AS inflow
        FROM (
            SELECT project, {order_cash("amount")}, 0 AS expense_outflow, 0 AS liabilities, 0 AS inflow
            FROM "tabProject Payments"
            WHERE status = 'Paid' AND {scope("project", ON_PAYMENT_DATE)}
            UNION ALL
            SELECT project, {order_cash("-amount")}, 0, 0, 0
            FROM "tabVendor Refunds"
            WHERE status IN %(refund_statuses)s AND document_type IN %(refund_doctypes)s
              AND {scope("project", ON_PAYMENT_DATE)}
            UNION ALL
            SELECT project, 0, tds_amount, 0, 0, 0
            FROM ({_WORK_ORDER_TDS_ROWS}) AS work_order_tds
            WHERE {scope("project", ON_PAYMENT_DATE)}
            UNION ALL
            SELECT projects, 0, 0, amount, 0, 0
            FROM "tabProject Expenses"
            WHERE status = 'Paid' AND {scope("projects", ON_PAYMENT_DATE)}
            UNION ALL
            SELECT project, 0, 0, 0, 0, amount
            FROM "tabProject Inflows"
            WHERE {scope("project", ON_PAYMENT_DATE)}
            UNION ALL
            SELECT project, 0, 0, 0, GREATEST(0, COALESCE(po_amount_delivered, 0) - COALESCE(amount_paid, 0)), 0
            FROM "tabProcurement Orders"
            WHERE status NOT IN %(excluded_po_statuses)s AND {scope("project", "creation::date")}
        ) AS money
        GROUP BY project
        """,
        values,
        as_dict=True,
    )
    return {
        row.project: ProjectMoney(
            po_outflow=flt(row.po_outflow),
            wo_outflow=flt(row.wo_outflow),
            expense_outflow=flt(row.expense_outflow),
            liabilities=flt(row.liabilities),
            inflow=flt(row.inflow),
        )
        for row in rows
    }
