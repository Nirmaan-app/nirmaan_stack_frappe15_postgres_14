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
    _validate_parent_boq(doc)
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
    if doc.flags.get("cascade_in_progress"):
        return
    old_doc = doc.get_doc_before_save()
    if old_doc is None:
        return
    if old_doc.status == "Draft" and doc.status == "Approved" and not doc.parent_boq:
        _cascade_approval_to_children(doc)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _validate_parent_boq(doc):
    if not doc.parent_boq:
        return

    # A. Same-project check
    parent_project = frappe.db.get_value("BOQs", doc.parent_boq, "project")
    if parent_project and parent_project != doc.project:
        frappe.throw(_("Sub-BoQ project must match parent BoQ project."))

    # B. Circular parent detection (cap at 10 levels)
    visited = set()
    current = doc.parent_boq
    for _depth in range(10):
        if not current:
            break
        if current == doc.name:
            frappe.throw(_("Circular parent_boq link detected."))
        if current in visited:
            break
        visited.add(current)
        current = frappe.db.get_value("BOQs", current, "parent_boq")

    # C. One-level hierarchy only — parent must not itself be a sub-BoQ
    parent_parent = frappe.db.get_value("BOQs", doc.parent_boq, "parent_boq")
    if parent_parent:
        frappe.throw(_(
            "Cannot link as sub-BoQ: target parent is itself a sub-BoQ. "
            "Only one level of master/sub hierarchy is supported."
        ))


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


def _cascade_approval_to_children(master):
    children = frappe.get_all(
        "BOQs",
        filters={"parent_boq": master.name, "status": "Draft"},
        fields=["name"],
    )
    for row in children:
        child_doc = frappe.get_doc("BOQs", row.name)
        child_doc.flags.cascade_in_progress = True
        child_doc.flags.ignore_links = True
        child_doc.status = "Approved"
        child_doc.save(ignore_permissions=True)
