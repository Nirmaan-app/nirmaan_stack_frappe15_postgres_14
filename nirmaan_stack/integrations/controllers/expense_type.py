"""Expense Type -> Records without review (spec #1494, story 28).

A role profile that can no longer raise any type comes off the Records without review list, so a
profile given a type again later does not come back ticked. Every path that changes a type's
`allowed_roles` counts: Expense Packages (`masters.update_expense_type`), Desk, REST, a delete.

`Expense Type` is no longer a fixture (owner, 2026-11-02), so a migrate does not reload the types. A
data import still reloads a type by removing it and inserting it again
(`frappe.modules.import_file.import_doc`). Between the two the type is gone, so a prune there would
drop a profile whose only type is being reloaded. `after_delete` stands down while Frappe imports,
the re-insert has no previous version for `on_update` to compare, and `after_migrate` prunes once,
against the types the migrate ends with (a patch may merge types).
"""

import frappe

from nirmaan_stack.api.expense_requests.access import prune_records_without_review
from nirmaan_stack.services import expense_request_routing


def _role_profiles(doc) -> list[str]:
    return sorted(row.role_profile for row in doc.get("allowed_roles") or [])


def _prune() -> None:
    expense_request_routing.clear_cache()
    prune_records_without_review()


def on_update(doc, method):
    """Prune when a save changes who may raise the type. A fixture reload inserts, so it has no
    previous version and never prunes here."""
    before = doc.get_doc_before_save()
    if before is not None and _role_profiles(before) != _role_profiles(doc):
        _prune()


def after_delete(doc, method):
    """Prune after a type is deleted, unless Frappe is deleting it for reload during an import:
    the same type is inserted again next."""
    if frappe.flags.in_import:
        return
    _prune()


def after_migrate():
    """Prune once, against the types the migrate ends with."""
    _prune()
