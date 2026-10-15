# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read a project's outflow, Current Liabilities, inflow and cashflow gap (#1456, ADR-0034).

Thin doors onto `services/project_money`, the one figure CEO Hold and the Projects list also read.
Each returns `{outflow, liabilities, inflow, cashflow_gap}` per project, plus the outflow's three parts
(`po_outflow`, `wo_outflow`, `expense_outflow`), which add up to `outflow`. Dates are optional and
inclusive (`YYYY-MM-DD`); in a range each payment, refund, expense and inflow counts on its own date.

    nirmaan_stack.api.projects.project_money.get_project_money
        project="PROJ-0001", from_date="2026-04-01", to_date="2027-03-31"
        -> {"po_outflow": 600.0, "wo_outflow": 0.0, "expense_outflow": 70.0, "outflow": 670.0,
            "liabilities": 700.0, "inflow": 800.0, "cashflow_gap": 570.0}

    nirmaan_stack.api.projects.project_money.get_projects_money
        projects=["PROJ-0001", "PROJ-0002"]   (a JSON list from the browser)
        -> {"PROJ-0001": {...}, "PROJ-0002": {...}}   one query for all of them

Readers need read access to Procurement Orders and Project Payments.
"""

import frappe
from frappe import _

from nirmaan_stack.services.project_money import ProjectMoney, project_money


def _check_read_access():
    for doctype in ("Procurement Orders", "Project Payments"):
        if not frappe.has_permission(doctype, "read"):
            frappe.throw(_("Not permitted to read {0}.").format(doctype), frappe.PermissionError)


@frappe.whitelist()
def get_project_money(project: str, from_date: str | None = None, to_date: str | None = None) -> dict:
    """One project's outflow, liabilities, inflow and cashflow gap."""
    return get_projects_money([project], from_date, to_date)[project]


@frappe.whitelist()
def get_projects_money(projects, from_date: str | None = None, to_date: str | None = None) -> dict:
    """Several projects' figures in one call: `{project: {outflow, liabilities, inflow, cashflow_gap}}`.

    Every project asked for is in the reply, with zeros when it has no money rows.
    """
    _check_read_access()
    projects = frappe.parse_json(projects) if isinstance(projects, str) else projects
    if not projects:
        frappe.throw(_("Choose at least one project."))
    money = project_money(list(projects), from_date or None, to_date or None)
    return {project: money.get(project, ProjectMoney()).as_dict() for project in projects}
