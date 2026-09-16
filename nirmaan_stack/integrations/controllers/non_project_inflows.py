import frappe

from nirmaan_stack.services.role_profiles import (
    NON_PROJECT_INFLOWS_DELETE_PROFILES,
    NON_PROJECT_INFLOWS_READ_PROFILES,
    NON_PROJECT_INFLOWS_WRITE_PROFILES,
    has_role_profile,
)

DOCTYPE = "Non Project Inflows"
ATTACHMENT_FIELD = "inflow_attachment"

_PROFILES_FOR = {
    "write": NON_PROJECT_INFLOWS_WRITE_PROFILES,
    "submit": NON_PROJECT_INFLOWS_WRITE_PROFILES,
    "cancel": NON_PROJECT_INFLOWS_WRITE_PROFILES,
    "amend": NON_PROJECT_INFLOWS_WRITE_PROFILES,
    "delete": NON_PROJECT_INFLOWS_DELETE_PROFILES,
}


def has_permission(doc, ptype=None, user=None, debug=False):
    """Narrow the role rows to the #1265 access table, by PROFILE.

    A `has_permission` hook can only DENY (Frappe never lets it grant), so returning None leaves the
    role rows in charge. Every ptype not named in `_PROFILES_FOR` (read, create, print, export, ...)
    needs a read profile. Frappe calls this only for a document-level check, which is what every
    create, read, write and delete of a record goes through; the list is gated separately below.
    """
    user = user or frappe.session.user
    profiles = _PROFILES_FOR.get(ptype, NON_PROJECT_INFLOWS_READ_PROFILES)
    return None if has_role_profile(user, profiles) else False


def get_permission_query_conditions(user=None, doctype=None):
    """Empty the list for anyone outside the read profiles (the hook above never sees a list)."""
    user = user or frappe.session.user
    return "" if has_role_profile(user, NON_PROJECT_INFLOWS_READ_PROFILES) else "1=0"


def adopt_receipt_file(doc, method=None):
    """Claim the loose receipt File this record points at.

    WHY THE FILE IS LOOSE: the add dialog uploads the receipt before the record exists, with no
    doctype on the upload. Frappe's `upload_file` checks WRITE on the target doctype even for a
    record not yet inserted, and an Accountant holds CREATE only (#1265) -- so an upload bound to
    this doctype would refuse them. Without adoption the File stays readable by its uploader and
    System Manager alone, and an Accountant Lead could not open a proof an Accountant added.

    Same shape as `project_progress_reports.relink_attachment_files`: only an UNLINKED File is
    claimed (a File belongs to one document in Frappe's model), and the raw UPDATE touches the
    link columns only. `File` carries no `doc_events` in this app, and this write skips the S3 /
    GCP `after_insert` upload on purpose -- the bytes are already stored. No commit: it rides the
    record's save transaction. Runs on every `on_update`, so a replacement receipt is claimed on
    edit too, and a second run is a no-op.
    """
    url = (doc.get(ATTACHMENT_FIELD) or "").strip()
    if not url:
        return
    frappe.db.sql(
        """
        UPDATE "tabFile"
        SET attached_to_doctype = %(dt)s,
            attached_to_name    = %(dn)s,
            attached_to_field   = %(field)s
        WHERE file_url = %(url)s
          AND COALESCE(attached_to_doctype, '') = ''
        """,
        {"dt": DOCTYPE, "dn": doc.name, "field": ATTACHMENT_FIELD, "url": url},
    )
