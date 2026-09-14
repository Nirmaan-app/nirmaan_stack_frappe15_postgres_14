# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Non Project Inflows -- the Inflow Type rule, in one pure home (ADR-0016 Amendment A, ADR-0010 B1).

PURE: no `frappe` import, no DB, no request context. Two callers ask it, so the import can never
accept a type + description pair the record itself refuses:
  * `Non Project Inflows.validate` (the doctype controller), on every save;
  * `services/outflow_import/settle.create_non_project_inflow_from_row`, before it builds a record
    from a bank line (#1266).

The frontend's copy of the list is `pages/non-project-inflows/nonProjectInflowModel.ts`, pinned to the
doctype JSON by its parity test.
"""

INFLOW_TYPES = ("Interest Payouts", "FD Closures", "Loan Received", "Others")
INFLOW_TYPE_OTHERS = "Others"


def inflow_type_problem(inflow_type, description) -> str | None:
    """Why this type + description pair cannot be saved, or None when it can."""
    if inflow_type not in INFLOW_TYPES:
        return f"Inflow Type must be one of: {', '.join(INFLOW_TYPES)}."
    if inflow_type == INFLOW_TYPE_OTHERS and not (description or "").strip():
        return "Description is required when the Inflow Type is Others."
    return None
