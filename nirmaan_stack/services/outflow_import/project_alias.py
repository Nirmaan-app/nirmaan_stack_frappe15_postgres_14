# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""When two `Outflow Import Project Alias` phrases are the same, and the lock that keeps a phrase on one project.

Two readers: the doctype's `validate` (a Desk save) and the Move's phrase learning (`api/outflow_import/rectify_phrase`,
#1758). One definition here, so the two cannot drift into an alias the editor accepts and the matcher ignores.
"Same phrase" is `project_match.alias_haystack`'s reading, the one the import matches by: case, spacing and
punctuation do not count.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.outflow_import.project_match import alias_haystack

ALIAS_DOCTYPE = "Outflow Import Project Alias"


def normalised(phrase: str | None) -> str:
    """The phrase as the import matches it: lowercase words, single spaces. Blank when nothing is left to match."""
    return alias_haystack(phrase).strip()


def lock_key(phrase: str | None) -> str:
    """The advisory-lock key of a phrase (`hashtext` of it): one per normalised phrase."""
    return f"project-alias:{normalised(phrase)}"


def lock_phrase(phrase: str | None) -> None:
    """Hold this transaction's lock on the normalised phrase until it ends (Postgres advisory lock), so a save queues
    behind a Move learning the same phrase until the Move commits."""
    frappe.db.sql("SELECT pg_advisory_xact_lock(hashtext(%s))", (lock_key(phrase),))


def holder_of(phrase: str | None, exclude: str | None = None):
    """The alias row (`name`, `keyword`, `project`, `active`) other than `exclude` that already reads as this phrase,
    active or not, or `None`. The table is small (a curated list plus what Moves teach), so every row is read."""
    wanted = normalised(phrase)
    if not wanted:
        return None
    for row in frappe.get_all(
        ALIAS_DOCTYPE,
        filters={"name": ("!=", exclude or "")},
        fields=["name", "keyword", "project", "active"],
        order_by="creation asc",
    ):
        if normalised(row.keyword) == wanted:
            return row
    return None
