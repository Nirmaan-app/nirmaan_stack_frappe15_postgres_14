# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""
Tendering operational guard (v3 dual-field model).

A small, isolated helper that prevents operational documents from being created
against any project that has not yet been awarded. A project is "operational"
only when `tendering_status == "Won"`; any other value (`Tendering` or `Lost`)
is **pre-Won** and must never accumulate operational data (PR / PO / SR /
payments / inflows / invoices / DC).

The UI already hides non-Won projects from every project picker; this module is
the **server-side backstop** (defense-in-depth) — even if a stub/lost project
slips through a picker, the backend refuses to attach operational documents.

Public interface:
    is_pre_won(project_name) -> bool
    validate_won(project_name, doctype_label=None) -> None  (raises)

History:
    v2 (single-field model) named these `is_tendering` / `validate_not_tendering`
    and keyed off `status == "Tendering"`. v3 splits the bid dimension into a
    new `tendering_status` field; the predicate flips to `tendering_status != "Won"`
    so both `Tendering` AND `Lost` projects are blocked.
"""

import frappe


def is_pre_won(project_name) -> bool:
    """
    Return True iff the linked project's `tendering_status` is NOT `"Won"`.

    In the v3 dual-field model, `tendering_status` is the single source of truth
    for whether a project is an awarded job. Both `Tendering` (prospect) and
    `Lost` (dead bid) are pre-Won and must not carry operational documents.

    An empty/None project (or a project that no longer exists) is treated as
    "not pre-Won" and returns False — callers that require a project to be
    present should enforce that separately; this predicate only answers the
    narrow question "is this NOT an awarded project?".

    Args:
        project_name (str | None): The Projects docname (e.g. `City-PROJ-00001`).

    Returns:
        bool: True only when the project exists and
              `tendering_status != "Won"`.
    """
    if not project_name:
        return False

    tendering_status = frappe.db.get_value("Projects", project_name, "tendering_status")
    if tendering_status is None:
        # Project missing -> treat as "not pre-Won" so we don't false-positive.
        return False
    return tendering_status != "Won"


def validate_won(project_name, doctype_label=None) -> None:
    """
    Raise `frappe.ValidationError` if `project_name` is NOT a Won project.

    Used in the validate / before_insert path of operational doctypes to refuse
    creating operational documents against a prospect stub or a lost bid. When
    the project is Won (or the project name is missing/empty), this returns
    None and the caller proceeds.

    Args:
        project_name (str | None): The Projects docname being linked.
        doctype_label (str | None): A human-readable label for the document
            being created (e.g. "Procurement Request"), used in the error
            message. Falls back to "this document" when not supplied.

    Raises:
        frappe.ValidationError: When the linked project's `tendering_status` is
            not `"Won"`. The message names the project.
    """
    if is_pre_won(project_name):
        tendering_status = frappe.db.get_value(
            "Projects", project_name, "tendering_status"
        )
        frappe.throw(
            f"Cannot create {doctype_label or 'this document'} for project "
            f"'{project_name}': it is a {tendering_status} project, not Won.",
            frappe.ValidationError,
        )
