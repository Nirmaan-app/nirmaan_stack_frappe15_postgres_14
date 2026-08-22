"""Lifecycle hooks for `Project Snag`.

WHY THIS EXISTS RATHER THAN STAMPING IN THE API: `status_changed_by` / `status_changed_on`
answer "who last moved this snag, and when". Stamping them inside the whitelisted endpoints
would leave every OTHER write path unstamped -- a Desk edit, a bulk edit, a Data Import, the
REST API -- and the field would then read as an authoritative answer that is quietly wrong.
Those paths all go through the document layer, so a `before_save` hook covers every one of them.

The standing counterpart trap (root CLAUDE.md): raw SQL and `frappe.db.set_value` BYPASS this
hook. Any future backfill or repair script that moves `status` must stamp these two fields
itself, or say at the call site why skipping them is correct.
"""

import frappe


def before_save(doc, method=None):
    """Stamp the status-change attribution whenever `status` actually changes.

    Recomputed from the transition, never incremented -- an ordinary save of an unchanged
    status leaves the existing stamp alone, so re-saving a snag for any other reason (a
    bare `remark` edit from the Desk, a Data Import) never rewrites who last moved its
    status. `api/snags/test_snag_api.py` exercises this branch with exactly that save.
    """
    if doc.is_new():
        # A newly imported or manually added snag has not been "moved" by anyone yet.
        # Its creation metadata (owner / creation) already records who put it there.
        return

    previous = doc.get_doc_before_save()
    if previous is None:
        # Frappe could not load the pre-save state; do not invent an attribution.
        return

    if previous.status == doc.status:
        return

    doc.status_changed_by = frappe.session.user
    doc.status_changed_on = frappe.utils.now()
