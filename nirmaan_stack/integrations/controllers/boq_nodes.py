import json
import frappe
from frappe import _


def validate(doc, method):
    if not doc.boq:
        frappe.throw(_("BoQ is required"))
    if not doc.node_type:
        frappe.throw(_("Node Type is required"))
    if not doc.description:
        frappe.throw(_("Description is required"))

    if doc.node_type == "Preamble":
        if doc.level not in (1, 2, 3):
            frappe.throw(_("Level must be 1, 2, or 3 for Preamble nodes"))
        if not doc.amount_override and any([doc.qty, doc.supply_rate, doc.install_rate, doc.combined_rate]):
            frappe.msgprint(
                _("Preamble node has qty/rate values set. Set Amount Override to suppress this warning."),
                alert=True,
            )

    elif doc.node_type == "Line Item":
        if doc.level:
            frappe.throw(_("Level must not be set for Line Item nodes"))
        if not doc.qty:
            frappe.throw(_("Qty is required for Line Item nodes"))
        if not any([doc.supply_rate, doc.install_rate, doc.combined_rate]):
            frappe.msgprint(_("No rate fields are set on this Line Item"), alert=True)

    if doc.parent_node:
        parent = frappe.db.get_value(
            "BOQ Nodes", doc.parent_node, ["node_type", "level"], as_dict=True
        )
        if parent:
            if doc.node_type == "Preamble":
                if doc.level == 2 and (parent.node_type != "Preamble" or parent.level != 1):
                    frappe.throw(_("An L2 Preamble's parent must be an L1 Preamble"))
                if doc.level == 3 and (parent.node_type != "Preamble" or parent.level != 2):
                    frappe.throw(_("An L3 Preamble's parent must be an L2 Preamble"))
            elif doc.node_type == "Line Item":
                if parent.node_type != "Preamble":
                    frappe.throw(_("A Line Item's parent must be a Preamble"))


def before_save(doc, method):
    _compute_path(doc)
    _compute_amounts(doc)


def after_insert(doc, method):
    pass


def on_update(doc, method):
    old_doc = doc.get_doc_before_save()
    # Skip on first insert; only write audit when a user edit supplies a reason
    if old_doc is None or not doc.edit_reason:
        return

    _write_audit(doc, old_doc)
    # Clear the transient field so it does not carry over to the next save
    frappe.db.set_value("BOQ Nodes", doc.name, "edit_reason", None, update_modified=False)


def on_trash(doc, method):
    if not doc.boq:
        return
    boq_status = frappe.db.get_value("BOQs", doc.boq, "status")
    if boq_status == "Approved":
        frappe.throw(_("Cannot delete nodes from an Approved BoQ"))


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _compute_path(doc):
    if not doc.parent_node:
        doc.path = doc.name
        return

    parent_path = frappe.db.get_value("BOQ Nodes", doc.parent_node, "path")
    if not parent_path:
        # Parent exists but has no path yet — treat this node as a root temporarily
        frappe.log_error(
            f"BOQ Node {doc.parent_node} has no path set; treating {doc.name} as root temporarily.",
            "BOQ Node Path Computation",
        )
        doc.path = doc.name
        return

    doc.path = f"{parent_path}/{doc.name}"


def _compute_amounts(doc):
    if doc.node_type != "Line Item" or doc.amount_override:
        return

    # Reset before recomputing to prevent stale values from a prior save leaking through
    doc.supply_amount = None
    doc.install_amount = None

    qty = doc.qty or 0

    if doc.supply_rate is not None:
        doc.supply_amount = qty * doc.supply_rate

    if doc.install_rate is not None:
        doc.install_amount = qty * doc.install_rate

    if doc.combined_rate is not None:
        doc.total_amount = qty * doc.combined_rate
    else:
        supply = doc.supply_amount or 0
        install = doc.install_amount or 0
        doc.total_amount = (supply + install) if (supply or install) else None


def _write_audit(doc, old_doc):
    tracked_fields = [
        "description", "unit", "qty", "supply_rate", "install_rate", "combined_rate",
        "supply_amount", "install_amount", "total_amount", "notes", "level", "code",
        "sort_order", "parent_node", "node_type", "path",
    ]
    changed = []
    for field in tracked_fields:
        old_val = old_doc.get(field)
        new_val = doc.get(field)
        if old_val != new_val:
            changed.append([field, old_val, new_val])

    data = {
        "added": [],
        "changed": changed,
        "data_import": None,
        "removed": [],
        "row_changed": [],
        "updater_reference": None,
    }

    nv = frappe.new_doc("Nirmaan Versions")
    nv.ref_doctype = "BOQ Nodes"
    nv.docname = doc.name
    nv.data = json.dumps(data)
    nv.previous_state = "Active"
    nv.new_state = "Edited"
    nv.reason = doc.edit_reason
    nv.insert(ignore_permissions=True)
    frappe.db.commit()
