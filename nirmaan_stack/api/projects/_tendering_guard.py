# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""
Tendering operational guard (Slice 5 / module B5).

A small, isolated helper that prevents operational documents from being
created against a *Tendering* project. A Tendering project is a lightweight
bid/prospect stub (see `docs/adr/0001-project-tendering-status.md`); it must
never accumulate operational data (PR / PO / SR / payments / inflows /
invoices / DC).

The UI already hides Tendering stubs from every project picker; this module is
the **server-side backstop** (defense-in-depth) — even if a stub slips through
a picker, the backend refuses to attach operational documents to it.

Public interface:
    is_tendering(project_name) -> bool
    validate_not_tendering(project_name, doctype_label=None) -> None  (raises)
"""

import frappe


def is_tendering(project_name) -> bool:
    """
    Return True iff the linked project's `status` is exactly `"Tendering"`.

    A single, efficient `frappe.db.get_value` lookup is used. An empty/None
    project (or a project that no longer exists) is treated as "not Tendering"
    and returns False — callers that require a project to be present should
    enforce that separately; this predicate only answers the narrow question
    "is this a Tendering stub?".

    Args:
        project_name (str | None): The Projects docname (e.g. `City-PROJ-00001`).

    Returns:
        bool: True only when the project exists and `status == "Tendering"`.
    """
    if not project_name:
        return False

    status = frappe.db.get_value("Projects", project_name, "status")
    return status == "Tendering"


def validate_not_tendering(project_name, doctype_label=None) -> None:
    """
    Raise `frappe.ValidationError` if `project_name` is a Tendering project.

    Used in the validate / before_insert path of operational doctypes to
    refuse creating operational documents against a prospect stub. When the
    project is not Tendering (Won / WIP / Completed / Halted / Handover /
    CEO Hold / missing / empty), this returns None and the caller proceeds.

    Args:
        project_name (str | None): The Projects docname being linked.
        doctype_label (str | None): A human-readable label for the document
            being created (e.g. "Procurement Request"), used in the error
            message. Falls back to "this document" when not supplied.

    Raises:
        frappe.ValidationError: When the linked project's status is
            `"Tendering"`. The message names the project.
    """
    if is_tendering(project_name):
        frappe.throw(
            f"Cannot create {doctype_label or 'this document'} for project "
            f"'{project_name}': it is still a Tendering prospect.",
            frappe.ValidationError,
        )
