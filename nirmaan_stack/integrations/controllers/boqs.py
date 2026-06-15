import json
import frappe
from frappe import _


def before_insert(doc, method):
    if not doc.project:
        frappe.throw(_("Project is required"))
    if not doc.boq_name:
        frappe.throw(_("BoQ Name is required"))

    result = frappe.db.sql("""
        SELECT COALESCE(MAX(version), 0) + 1
        FROM "tabBOQs"
        WHERE project = %s AND boq_name = %s
    """, (doc.project, doc.boq_name))
    doc.version = result[0][0] if result else 1

    doc.status = "Draft"
    doc.uploaded_by = frappe.session.user
    doc.uploaded_at = frappe.utils.now()


def validate(doc, method):
    _validate_area_dimensions(doc)

    old_doc = doc.get_doc_before_save()
    if old_doc is None:
        return

    if old_doc.status != "Superseded" and doc.status == "Superseded":
        frappe.throw(_(
            "Status cannot be manually set to Superseded. "
            "This transitions automatically when a new version is uploaded."
        ))

    if old_doc.status == "Superseded" and doc.status != "Superseded":
        frappe.throw(_("A Superseded BoQ cannot be reopened."))


def on_update(doc, method):
    # parent_boq (the master/sub BoQ link) was retired in Phase 4 P4-FINAL, and the
    # Draft->Approved approval cascade it drove was removed with it. on_update has no
    # remaining work; kept as a wired no-op so hooks.py needs no change.
    pass


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _validate_area_dimensions(doc):
    if not doc.area_dimensions:
        return

    try:
        dims = json.loads(doc.area_dimensions)
    except (json.JSONDecodeError, ValueError):
        frappe.throw(_("area_dimensions must be valid JSON, e.g. [\"B1\", \"B3\"]."))

    if not isinstance(dims, list):
        frappe.throw(_("area_dimensions must be a JSON array, e.g. [\"B1\", \"B3\"]."))

    if not dims:
        return  # empty list [] is valid

    for item in dims:
        if not isinstance(item, str):
            frappe.throw(_("area_dimensions must contain only strings."))

    if len(dims) != len(set(dims)):
        frappe.throw(_("area_dimensions must not contain duplicate area names."))
