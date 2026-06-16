# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Lifecycle controller for the Project Inflows doctype.

Currently holds only the Tendering operational guard (Slice 5 / B5).
"""

from nirmaan_stack.api.projects._tendering_guard import validate_won


def validate(doc, method):
    """Tendering operational guard (Slice 5 / B5).

    Defense-in-depth backstop: refuse to create a Project Inflow against a
    Tendering project stub. Guard only NEW docs so edits to existing/legacy
    inflows are never blocked.
    """
    if doc.is_new():
        validate_won(doc.project, "Project Inflow")
