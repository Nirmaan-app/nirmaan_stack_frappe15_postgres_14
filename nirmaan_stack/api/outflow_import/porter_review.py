# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Review a Porter import's projects before Create (#1446, spec #1442, ADR-0032).

Once every Porter Invoice of an import has Passed (`porter.is_validated`), the Accountant checks each
completed order's suggested project and corrects it: by remark group, or order by order where an order
has no remark. Grouping and ordering are the screen's (`frontend/.../porterReview.ts`); this module
reports the lines with their group key and writes the corrections.

⚠️ AN EDIT IS THE PLAN CREATE READS. It writes the line's `suggested_doctype`, `resolved_project` and
`suggested_expense_type` -- the same fields upload wrote and the Create job (#1445) turns into the
Expense -- the moment it is made, so closing the browser loses nothing and there is no separate "save".

⚠️ ONLY BEFORE CREATE, ONLY ONCE VALIDATED. Both endpoints refuse an import that is not Validated (still
being checked, or an invoice Failed); a line already created (no longer `Pending match run`) is refused
under its row lock, so an edit can never move an Expense that exists. Moving one is Rectify's (#1449).
"""

import frappe

from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.porter import BATCH_DOCTYPE, ROW_DOCTYPE, SOURCE, is_validated
from nirmaan_stack.services.outflow_import.ledgers import (
    NON_PROJECT_EXPENSE_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
)
from nirmaan_stack.services.outflow_import.porter import (
    EXPENSE_TYPE,
    REASON_REVIEW,
    remark_group_key,
    statement_line,
)
from nirmaan_stack.services.outflow_import.status import ROW_PENDING_MATCH, ROW_SKIPPED

_WON = "Won"


@frappe.whitelist()
def get_porter_review(batch: str):
    """Every completed order of a Validated Porter import, with its placement, and the Won projects.

    URL: /api/method/nirmaan_stack.api.outflow_import.porter_review.get_porter_review?batch=OFI-...

    Returns `{batch, lines: [...], projects: [{name, project_name}]}`. Each line: `name`, `crn`,
    `completed_on`, `fare`, `remarks`, `city`, `from_address`, `to_address`, `booked_by`, `group_key`
    (blank: no remark, reviewed on its own), `ledger`, `project`, `project_name`, `reason`, `strength`,
    `editable` (not yet created).
    """
    require_outflow_access()
    _refuse_unless_validated(batch)
    return porter_review(batch)


@frappe.whitelist(methods=["POST"])
def set_porter_placement(batch: str, rows, project: str | None = None):
    """Place one or more orders of a Validated Porter import: on a Won project, or Non-Project.

    URL: /api/method/nirmaan_stack.api.outflow_import.porter_review.set_porter_placement
    Body: `batch`, `rows` (the line names: a remark group, or one order), `project` (blank or absent:
    Non-Project). Returns the review as `get_porter_review` does.

    Writes, on every line, the ledger, the project and the expense type (Material Transportation Charges
    on both ledgers), and marks the placement as chosen in review (`placement_reason` "review", no
    strength). Refused, writing nothing: an import not Validated; a project that does not exist or is
    not Won; no lines; a line of another import, a cancelled order, or an order already created.
    """
    require_outflow_access()
    names = _line_names(rows)
    if not names:
        frappe.throw("No orders were given to place.", title="No orders")
    _refuse_unless_validated(batch)
    project = (project or "").strip() or None
    if project:
        refuse_unless_won(project)

    lines = frappe.db.sql(
        """
        SELECT name, import_batch, source, row_status
        FROM "tabOutflow Import Row"
        WHERE name IN %s
        ORDER BY name
        FOR UPDATE
        """,
        (tuple(names),),
        as_dict=True,
    )
    _refuse_lines_not_open(batch, names, lines)

    # Raw: `Outflow Import Row` carries no doc_events, and these fields are read, never derived from --
    # the Create job reads them as they stand. The row status does not move, so no batch rollup is due.
    frappe.db.set_value(
        ROW_DOCTYPE,
        {"name": ["in", names]},
        {
            "suggested_doctype": PROJECT_EXPENSE_DOCTYPE if project else NON_PROJECT_EXPENSE_DOCTYPE,
            "resolved_project": project,
            "suggested_expense_type": EXPENSE_TYPE,
            "placement_reason": REASON_REVIEW,
            "placement_strength": None,
        },
    )
    frappe.db.commit()
    return porter_review(batch)


def porter_review(batch: str) -> dict:
    """The completed orders in file order, each with its placement and review group; the Won projects."""
    rows = frappe.db.sql(
        """
        SELECT r.name, r.transfer_id, r.added_on, r.amount, r.remarks, r.added_by_raw, r.porter_line,
               r.row_status, r.suggested_doctype, r.resolved_project, p.project_name,
               r.placement_reason, r.placement_strength
        FROM "tabOutflow Import Row" r
        LEFT JOIN "tabProjects" p ON p.name = r.resolved_project
        WHERE r.import_batch = %s AND r.row_status <> %s
        ORDER BY r.name
        """,
        (batch, ROW_SKIPPED),
        as_dict=True,
    )
    lines = []
    for row in rows:
        line = statement_line(row.porter_line)
        lines.append(
            {
                "name": row.name,
                "crn": row.transfer_id,
                "completed_on": str(row.added_on) if row.added_on else None,
                "fare": float(row.amount or 0),
                "remarks": (row.remarks or "").strip(),
                "city": line["city"],
                "from_address": line["from_address"],
                "to_address": line["to_address"],
                "booked_by": (row.added_by_raw or "").strip(),
                "group_key": remark_group_key(row.remarks, line["city"]),
                "ledger": row.suggested_doctype,
                "project": row.resolved_project or None,
                "project_name": row.project_name or None,
                "reason": row.placement_reason or None,
                "strength": row.placement_strength or None,
                "editable": row.row_status == ROW_PENDING_MATCH,
            }
        )
    return {"batch": batch, "lines": lines, "projects": won_projects()}


def won_projects() -> list[dict]:
    """`[{name, project_name}]` of every Won project, by name: the only projects a Porter order can be
    placed on, in Review and in Rectify (#1449)."""
    projects = frappe.db.sql(
        """SELECT name, project_name FROM "tabProjects" WHERE tendering_status = %s ORDER BY project_name""",
        (_WON,),
        as_dict=True,
    )
    return [{"name": p.name, "project_name": p.project_name or p.name} for p in projects]


def _refuse_unless_validated(batch: str) -> None:
    if frappe.db.get_value(BATCH_DOCTYPE, batch, "source") != SOURCE:
        frappe.throw(f"{batch} is not a {SOURCE} import.", title="Not a Porter import")
    if not is_validated(batch):
        frappe.throw(
            f"{batch} cannot be reviewed yet: every invoice has to pass its check against Porter's own "
            "PDF first.",
            title="Not validated",
        )


def refuse_unless_won(project: str) -> None:
    """Refuse a project that does not exist or is not Won (Review and Rectify)."""
    found = frappe.db.get_value("Projects", project, ["project_name", "tendering_status"], as_dict=True)
    if not found:
        frappe.throw(f"Project {project} does not exist.", title="No such project")
    if found.tendering_status != _WON:
        frappe.throw(
            f"Only a Won project can be chosen. {found.project_name or project} ({project}) is "
            f"{found.tendering_status or 'not Won'}.",
            title="Not a Won project",
        )


def _refuse_lines_not_open(batch: str, names: list[str], lines: list) -> None:
    """Every named line is a completed order of this import, not yet created -- read under the lock."""
    found = {line.name: line for line in lines}
    foreign = [name for name in names if name not in found or found[name].import_batch != batch]
    if foreign:
        frappe.throw(f"Not an order of {batch}: {', '.join(foreign)}.", title="Not this import")
    cancelled = [line.name for line in lines if line.row_status == ROW_SKIPPED]
    if cancelled:
        frappe.throw(
            f"Porter cancelled {', '.join(cancelled)}: it becomes no expense, so it has no project.",
            title="Cancelled order",
        )
    created = [line.name for line in lines if line.row_status != ROW_PENDING_MATCH]
    if created:
        frappe.throw(
            f"{', '.join(created)} already created (or is being created). Move a created order with "
            "Rectify.",
            title="Already created",
        )


def _line_names(rows) -> list[str]:
    """The posted line names: a JSON list, a list, or one name."""
    if isinstance(rows, str):
        rows = frappe.parse_json(rows) if rows.strip().startswith("[") else [rows]
    return list(dict.fromkeys(str(name) for name in (rows or []) if name))
