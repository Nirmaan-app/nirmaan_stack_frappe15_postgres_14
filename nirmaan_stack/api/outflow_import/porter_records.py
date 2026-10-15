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
  * `line_names` -- the posted line names an endpoint was sent.

Reads only; nothing here writes.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.outflow_import.porter_state import IMPORT_VALIDATED, import_state
from nirmaan_stack.services.outflow_import.sources import PORTER_STATEMENT_SOURCE

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
