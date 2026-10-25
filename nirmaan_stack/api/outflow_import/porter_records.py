# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Porter import's records, and the reads every step of its pipeline shares (ADR-0032, spec #1442).

Upload (`porter.py`, `porter_upload.py`), validation (`porter_validation.py`), Review (`porter_review.py`),
Create (`porter_create.py`), Rectify (`porter_rectify.py`), Discard (`porter_discard.py`) and the expense
screens (`porter_expense.py`) each ask these, never a copy of them:

  * the import's doctypes and the source -- one constant each (the two Porter doctypes are
    `services/outflow_import/porter`'s);
  * the gates: `refuse_unless_porter_import`, `is_validated`, `created_anything`, `won_refusal` /
    `refuse_unless_won` -- and `won_projects`, the only projects a Porter order can be placed on;
  * the import's DERIVED state, `porter_import_states` (never stored: `Outflow Import Batch.status` keeps
    its own meaning), over the pure `porter_state.import_state`;
  * the import's per-phase progress summary, `porter_progress`, over the pure `porter_state.import_progress`
    (the dialog's progress bar and Import History's chips, #1556);
  * `failed_lines` -- the lines Create could not create, each with its note and fix (#1561);
  * which orders need a person, `porter_placements` / `orders_needing_a_person`, over the pure
    `porter_state.placement_kinds` (#1560): Review's filter, Create's refusal and the progress count;
  * `line_names` -- the posted line names an endpoint was sent.

Reads only; nothing here writes.
"""

from __future__ import annotations

import frappe
from frappe.utils.background_jobs import is_job_enqueued

from nirmaan_stack.services.outflow_import.ledgers import PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.outflow_import.porter import remark_group_key, statement_line
from nirmaan_stack.services.outflow_import.porter_state import (
    CREATE_LINE_STATUSES,
    IMPORT_VALIDATED,
    INVOICE_PASSED,
    NEEDS_PERSON,
    import_progress,
    import_state,
    placement_kinds,
)
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_PORTER_CANCELLED
from nirmaan_stack.services.outflow_import.sources import PORTER_STATEMENT_SOURCE
from nirmaan_stack.services.outflow_import.status import ROW_ERROR

BATCH_DOCTYPE = "Outflow Import Batch"
ROW_DOCTYPE = "Outflow Import Row"
SOURCE = PORTER_STATEMENT_SOURCE

# Only Won projects are suggested, reviewed onto, created on or rectified to (ADR-0032): a Tendering
# duplicate of a Won project's name would tie it in the whole-name step and hide it (measured: "EXL
# KOCHI" vs "EXL Kochi").
WON = "Won"


def refuse_unless_porter_import(batch: str, *, for_update: bool = False) -> None:
    """Refuse a batch that does not exist or is not a Porter Statement import. `for_update` locks the
    batch row (Discard serialises on it)."""
    if frappe.db.get_value(BATCH_DOCTYPE, batch, "source", for_update=for_update) != SOURCE:
        frappe.throw(f"{batch} is not a {SOURCE} import.", title="Not a Porter import")


def line_names(rows) -> list[str]:
    """The distinct posted line names, in the order sent: a JSON list, a list, or one name. Blanks dropped."""
    if isinstance(rows, str):
        rows = frappe.parse_json(rows) if rows.strip().startswith("[") else [rows]
    return list(dict.fromkeys(str(r).strip() for r in (rows or []) if r and str(r).strip()))


# --- projects -------------------------------------------------------------------------------------


def won_projects() -> list[dict]:
    """`[{name, project_name}]` of every Won project, by project name: the only projects a Porter order
    can be suggested for (upload), placed on (Review) or moved to (Rectify)."""
    projects = frappe.db.sql(
        """SELECT name, project_name FROM "tabProjects" WHERE tendering_status = %s ORDER BY project_name""",
        (WON,),
        as_dict=True,
    )
    return [{"name": p.name, "project_name": p.project_name or p.name} for p in projects]


def won_refusal(project: str) -> str | None:
    """Why a Porter order cannot be placed on `project` -- it does not exist, or is not Won -- or None.
    Asked by Review and Rectify when a person chooses, and by Create on every line it writes (#1445)."""
    found = frappe.db.get_value("Projects", project, ["project_name", "tendering_status"], as_dict=True)
    if not found:
        return f"Project {project} does not exist."
    if found.tendering_status != WON:
        return f"{found.project_name or project} ({project}) is {found.tendering_status or 'not set'}, not Won."
    return None


def refuse_unless_won(project: str) -> None:
    """Refuse a project that does not exist or is not Won (Review and Rectify)."""
    refusal = won_refusal(project)
    if refusal:
        frappe.throw(f"Only a Won project can be chosen. {refusal}", title="Not a Won project")


# --- the import's state ---------------------------------------------------------------------------


def porter_import_states(batches: list[str]) -> dict[str, str]:
    """Each Porter import's state (Validating / Validated / Validation failed / Creating / Created),
    DERIVED from its Porter Invoices and its lines, two queries for any number of imports. Never stored:
    `Outflow Import Batch.status` keeps its own meaning."""
    invoices = _invoice_statuses(batches)
    lines: dict[str, set[str]] = {batch: set() for batch in batches}
    if batches:
        # `import_state` asks only "any" / "all" of the lines, so each import's distinct statuses do.
        for row in frappe.db.sql(
            """
            SELECT DISTINCT import_batch, row_status FROM "tabOutflow Import Row"
            WHERE import_batch IN %s
            """,
            (tuple(batches),),
            as_dict=True,
        ):
            lines[row.import_batch].add(row.row_status)
    return {batch: import_state(invoices[batch], lines[batch]) for batch in batches}


def _invoice_statuses(batches: list[str]) -> dict[str, list[str]]:
    statuses: dict[str, list[str]] = {batch: [] for batch in batches}
    if not batches:
        return statuses
    for row in frappe.db.sql(
        """SELECT import_batch, validation_status FROM "tabPorter Invoice" WHERE import_batch IN %s""",
        (tuple(batches),),
        as_dict=True,
    ):
        statuses[row.import_batch].append(row.validation_status)
    return statuses


def porter_placements(batches: list[str]) -> dict[str, dict[str, str]]:
    """Each Porter import's completed orders, by line name, with where each stands in Choose projects
    (`porter_state.placement_kinds`: placed automatically, placed by a person, or needs a person). THE
    one read of that rule (#1560): Review's filter, Create's refusal and the progress count all ask it.
    One query for any number of imports."""
    placed: dict[str, list[dict]] = {batch: [] for batch in batches}
    if batches:
        for row in frappe.db.sql(
            """
            SELECT name, import_batch, row_status, remarks, porter_line,
                   placement_reason, placement_strength, suggested_doctype, resolved_project
            FROM "tabOutflow Import Row"
            WHERE import_batch IN %s AND COALESCE(skip_kind, '') <> %s
            """,
            (tuple(batches), SKIP_KIND_PORTER_CANCELLED),
            as_dict=True,
        ):
            placed[row.import_batch].append(
                {
                    "name": row.name,
                    "group_key": remark_group_key(row.remarks, statement_line(row.porter_line).get("city")),
                    "reason": row.placement_reason,
                    "strength": row.placement_strength,
                    "destination": (
                        row.resolved_project if row.suggested_doctype == PROJECT_EXPENSE_DOCTYPE else None
                    ),
                    "open": row.row_status in CREATE_LINE_STATUSES,
                }
            )
    return {batch: placement_kinds(placed[batch]) for batch in batches}


def orders_needing_a_person(batch: str) -> int:
    """How many of the import's completed orders still need a person (#1560): Create is refused until 0."""
    return sum(1 for kind in porter_placements([batch])[batch].values() if kind == NEEDS_PERSON)


def porter_progress(batches: list[str]) -> dict[str, dict]:
    """Each Porter import's per-phase progress summary (`porter_state.import_progress`, #1556): what the
    import dialog's progress bar and Import History's chips show. Four queries for any number of
    imports, plus one queue lookup each for a running Create job. Reads only."""
    from nirmaan_stack.api.outflow_import.porter_validation import VALIDATION_CONCURRENCY

    invoices = _invoice_statuses(batches)
    warned: dict[str, int] = {batch: 0 for batch in batches}
    lines: dict[str, dict[str, int]] = {batch: {} for batch in batches}
    cancelled: dict[str, int] = {batch: 0 for batch in batches}
    placements: dict[str, dict[str, int]] = {batch: {} for batch in batches}
    if batches:
        # A Passed invoice whose PDF read a GSTIN, tax or invoice number differently (#1559).
        warned.update(
            frappe.db.sql(
                """
                SELECT import_batch, COUNT(*) FROM "tabPorter Invoice"
                WHERE import_batch IN %s AND validation_status = %s AND validation_warnings IS NOT NULL
                GROUP BY import_batch
                """,
                (tuple(batches), INVOICE_PASSED),
            )
        )
        for row in frappe.db.sql(
            """
            SELECT import_batch, row_status, skip_kind, COUNT(*) AS lines
            FROM "tabOutflow Import Row"
            WHERE import_batch IN %s
            GROUP BY import_batch, row_status, skip_kind
            """,
            (tuple(batches),),
            as_dict=True,
        ):
            count = int(row.lines)
            by_status = lines[row.import_batch]
            by_status[row.row_status] = by_status.get(row.row_status, 0) + count
            if row.skip_kind == SKIP_KIND_PORTER_CANCELLED:
                cancelled[row.import_batch] += count
        for batch, kinds in porter_placements(batches).items():
            for kind in kinds.values():
                placements[batch][kind] = placements[batch].get(kind, 0) + 1
    return {
        batch: import_progress(
            orders=sum(lines[batch].values()),
            cancelled=cancelled[batch],
            invoice_statuses=invoices[batch],
            passed_with_warnings=warned[batch],
            line_statuses=lines[batch],
            placements=placements[batch],
            create_running=is_job_enqueued(create_job_id(batch)),
            check_concurrency=VALIDATION_CONCURRENCY,
        )
        for batch in batches
    }


#: A failed line's fix (#1561): place it on a Won project again (its project is no longer Won, or gone).
FIX_REPLACE = "re-place"
#: A failed line's fix: run Create again as it stands.
FIX_RETRY = "retry"


def failed_lines(batch: str) -> list[dict]:
    """Every line Create could not create (Error), by line name: `name`, `crn` (its Porter Order),
    `note` (the sentence Create stored), `fix` and the line's `project` / `project_name`.

    ⚠️ THE FIX IS READ FROM THE LINE AS IT STANDS NOW, NOT FROM THE NOTE: a line on a project that is not
    Won (or no longer exists) is re-placed; any other is retried. So once a person places a refused line on
    a Won project, its fix becomes retry without anything else being written.
    """
    rows = frappe.db.sql(
        """
        SELECT r.name, r.transfer_id, r.outcome_note, r.suggested_doctype, r.resolved_project,
               p.name AS found_project, p.project_name, p.tendering_status
        FROM "tabOutflow Import Row" r
        LEFT JOIN "tabProjects" p ON p.name = r.resolved_project
        WHERE r.import_batch = %s AND r.row_status = %s
        ORDER BY r.name
        """,
        (batch, ROW_ERROR),
        as_dict=True,
    )
    lines = []
    for row in rows:
        project = row.resolved_project if row.suggested_doctype == PROJECT_EXPENSE_DOCTYPE else None
        not_won = bool(project) and (not row.found_project or row.tendering_status != WON)
        lines.append(
            {
                "name": row.name,
                "crn": row.transfer_id,
                "note": row.outcome_note,
                "fix": FIX_REPLACE if not_won else FIX_RETRY,
                "project": project or None,
                "project_name": (row.project_name or project) if project else None,
            }
        )
    return lines


def is_validated(batch: str) -> bool:
    """THE GATE for Review and Create (#1445, #1446): every Porter Invoice of the import has Passed.

    False while any is still being checked, and for good once one has Failed: nothing may proceed past
    a failed invoice, and there is no override. ⚠️ It asks the INVOICES only, so it stays True once
    Create has started (Creating / Created): a re-run of Create passes the same gate.
    """
    return import_state(_invoice_statuses([batch])[batch]) == IMPORT_VALIDATED


def create_job_id(batch: str) -> str:
    """The Create job's id: one per import, so pressing Create twice queues it once (#1445)."""
    return f"porter-create-{batch}"


def created_imports(batches: list[str]) -> set[str]:
    """Which of these Porter imports Create has written to: any match (Settled, or Reversed by
    Unreconcile / Rectify) or any Porter Order. Both outlive every correction, so an import that has
    created once stays created -- past Discard (#1447), and its invoices left out of a re-upload."""
    if not batches:
        return set()
    return set(
        frappe.db.sql(
            """
            SELECT import_batch FROM "tabOutflow Row Match" WHERE import_batch IN %(batches)s
            UNION
            SELECT i.import_batch FROM "tabPorter Order" o
            JOIN "tabPorter Invoice" i ON i.name = o.porter_invoice
            WHERE i.import_batch IN %(batches)s
            """,
            {"batches": tuple(batches)},
            pluck=True,
        )
    )


def created_anything(batch: str) -> bool:
    """Create has written to this import: Discard is refused from here on (#1447)."""
    return batch in created_imports([batch])
