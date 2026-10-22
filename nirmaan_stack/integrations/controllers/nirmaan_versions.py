import json
import frappe

SNAPSHOT_KEPT_REFUSAL = "An amendment snapshot is the Work Order's audit record: it can't be deleted or changed."

def generate_sr_amend_version(doc, method):
    if doc.ref_doctype != "Service Requests":
        return
    data = json.loads(doc.data)
    print(f"amend version: {data}")

    # Check if the status changed from "Approved" to "Amendment"
    status_change = next((change for change in data['changed'] if change[0] == 'status'), None)
    if status_change and status_change[1] == "Approved" and status_change[2] == "Amendment":
        # Create a new Nirmaan Versions document
        nv = frappe.new_doc("Nirmaan Versions")
        nv.ref_doctype = doc.ref_doctype
        nv.docname = doc.docname
        nv.data = json.dumps(doc.data)
        nv.previous_state = status_change[1]
        nv.new_state = status_change[2]
        nv.insert(ignore_permissions=True)
    else:
        pass


def is_amendment_snapshot(doc) -> bool:
    """The record `generate_sr_amend_version` leaves when a Work Order moves from Approved to Amendment."""
    return (doc.get("ref_doctype") == "Service Requests" and doc.get("previous_state") == "Approved"
            and doc.get("new_state") == "Amendment")


def keep_amendment_snapshot(doc, method=None):
    """A Work Order's amendment snapshot is its audit record (#1540, story 25): no REST, Desk or code save
    changes it after it is made, and nothing deletes it. Bound to validate and on_trash. The one change
    made to it, its outcome, is the server's `services/work_order_amendment.mark_snapshots` (`set_value`,
    which runs no hook)."""
    before = doc if method == "on_trash" else doc.get_doc_before_save()
    if before and is_amendment_snapshot(before):
        frappe.throw(SNAPSHOT_KEPT_REFUSAL, frappe.ValidationError)
