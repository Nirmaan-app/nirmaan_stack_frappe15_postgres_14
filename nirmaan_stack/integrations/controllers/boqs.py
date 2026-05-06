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
