"""
Move a Won project's BoQs between Selected and Draft (ADR-0037 D4/D7).

The Admin's bulk "Mark as Selected" / "Move to Draft" on the Won project's BoQs tab. A thin
endpoint: the rule -- Admin only, Won project only, from-status checked under a row lock, all or
nothing -- is `controllers.boqs.change_boq_selection`.
"""
import frappe

from nirmaan_stack.integrations.controllers.boqs import change_boq_selection


@frappe.whitelist(methods=["POST"])
def set_boq_selection(project, boqs, status):
    """Set every BoQ in ``boqs`` to ``status`` ("Selected" or "Draft") in one transaction.

    Args:
        project (str): The Won project's docname.
        boqs (list[str] | str): BOQs docnames (a JSON list is accepted).
        status (str): "Selected" (Mark as Selected, from Draft) or "Draft" (Move to Draft,
            from Selected).

    Returns:
        dict: {"status": "Selected" | "Draft", "boqs": [names]}. A refusal raises (PermissionError
        for a non-Admin, ValidationError otherwise) and nothing is written.

    Example:
        POST nirmaan_stack.api.projects.boq_selection.set_boq_selection
        {"project": "Bangalore-PROJ-00260", "boqs": ["BOQ-26-00301"], "status": "Selected"}
    """
    if isinstance(boqs, str) and boqs.startswith("["):
        boqs = frappe.parse_json(boqs)
    result = change_boq_selection(project, boqs, status)
    frappe.db.commit()
    return result
