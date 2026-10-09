"""Lifecycle hooks for `Project Snag`.

WHY THIS EXISTS RATHER THAN STAMPING IN THE API: `status_changed_by` / `status_changed_on`
answer "who last moved this snag, and when". Stamping them inside the whitelisted endpoints
would leave every OTHER write path unstamped -- a Desk edit, a bulk edit, a Data Import, the
REST API -- and the field would then read as an authoritative answer that is quietly wrong.
Those paths all go through the document layer, so a `before_save` hook covers every one of them.

The PHOTO RULE is ENFORCED here for the same reason (owner 2026-10-08): "a Completed snag needs
its photo" must hold for the Desk and the REST API too, not only for the two dialogs that send
one. The rule itself is pure and lives in `services/snag_photo.py`. So is WHICH FILE may be the
photo (`_check_new_photo`): Project Manager / Project Lead / PMO hold DocPerm write on Project
Snag, and the Snag PDF fetches every photo server-side, so a REST write naming another
document's private file -- or any URL -- would otherwise be read and printed.

The standing counterpart trap (CODING_STANDARDS.md): raw SQL and `frappe.db.set_value` BYPASS this
hook. Any future backfill or repair script that moves `status` must stamp these two fields
itself, or say at the call site why skipping them is correct.
"""

import mimetypes

import frappe

from nirmaan_stack.services.snag_photo import photo_rule_violation


def _enforce_photo_rule(previous_status, previous_photo, doc):
    error = photo_rule_violation(previous_status, doc.status, previous_photo, doc.attachment)
    if error:
        frappe.throw(error, title="Photo required")


def _check_new_photo(doc, previous_photo):
    """A photo this save PUTS on the snag must be an image uploaded to THIS snag's photo field.

    An unchanged photo is not judged again, so re-saving a snag never trips on it. A NEW snag
    cannot carry one: no file can be attached to it before it exists.
    """
    photo = doc.attachment
    if not photo or photo == previous_photo:
        return
    if doc.is_new():
        frappe.throw(
            "A new snag cannot arrive with a photo. Add the snag, then upload its photo.",
            title="Unknown photo",
        )
    file_name = frappe.db.get_value(
        "File",
        {
            "file_url": photo,
            "attached_to_doctype": "Project Snag",
            "attached_to_name": doc.name,
            "attached_to_field": "attachment",
        },
        "file_name",
    )
    if not file_name:
        frappe.throw(
            "The photo must be a file uploaded to this snag. Upload it again and retry.",
            title="Unknown photo",
        )
    if not (mimetypes.guess_type(file_name)[0] or "").startswith("image/"):
        frappe.throw("The snag's photo must be an image (JPG or PNG).", title="Not a photo")


def before_save(doc, method=None):
    """Enforce the photo rule, then stamp the status-change attribution.

    The stamp is recomputed from the transition, never incremented -- an ordinary save of an
    unchanged status leaves the existing stamp alone, so re-saving a snag for any other reason
    (a bare `remark` edit from the Desk, a Data Import) never rewrites who last moved its
    status. `api/snags/test_snag_api.py` exercises this branch with exactly that save.
    """
    # The location describes the photo, so it never outlives it -- whichever path cleared it.
    if not doc.attachment:
        doc.location = None

    if doc.is_new():
        _check_new_photo(doc, None)
        _enforce_photo_rule(None, None, doc)
        # A newly imported or manually added snag has not been "moved" by anyone yet.
        # Its creation metadata (owner / creation) already records who put it there.
        return

    previous = doc.get_doc_before_save()
    if previous is None:
        # Frappe could not load the pre-save state; do not invent an attribution, and do not
        # judge a transition that cannot be seen.
        return

    _check_new_photo(doc, previous.attachment)
    _enforce_photo_rule(previous.status, previous.attachment, doc)

    if previous.status == doc.status:
        return

    doc.status_changed_by = frappe.session.user
    doc.status_changed_on = frappe.utils.now()
