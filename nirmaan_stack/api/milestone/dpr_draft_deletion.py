"""
Who removed a DPR draft, for the DPR editor's "This draft was deleted" dialog.

The editor keeps a browser copy of the draft it is filling. When that draft is gone from the server
(an Admin deleted it from the DPR list, someone used "Clear Draft & Take Over", or it was submitted
from another tab), the editor asks here what happened before it clears its copy. Frappe records
every delete as a Deleted Document row whose owner is the user who deleted it, but only System
Managers can read that log, so this returns just the deleter's name and time for one DPR.
"""
import frappe

DPR_DOCTYPE = "Project Progress Reports"


@frappe.whitelist()
def get_dpr_draft_deletion(report_name: str) -> dict:
    """Say whether one Project Progress Reports row still exists and, if it was deleted, who deleted it.

    Returns ``{"exists": True, "report_status": "Draft" | "Completed"}`` while the report exists, else
    ``{"exists": False, "deleted_by": <full name> | None, "deleted_at": <datetime> | None}``; the two
    ``None`` values mean Frappe kept no delete record (e.g. a permanent delete).
    """
    if not report_name:
        frappe.throw("report_name is required")

    if frappe.db.exists(DPR_DOCTYPE, report_name):
        return {
            "exists": True,
            "report_status": frappe.db.get_value(DPR_DOCTYPE, report_name, "report_status"),
        }

    deletion = frappe.get_all(
        "Deleted Document",
        filters={"deleted_doctype": DPR_DOCTYPE, "deleted_name": report_name},
        fields=["owner", "creation"],
        order_by="creation desc",
        limit=1,
    )
    if not deletion:
        return {"exists": False, "deleted_by": None, "deleted_at": None}

    return {
        "exists": False,
        "deleted_by": frappe.utils.get_fullname(deletion[0].owner),
        "deleted_at": deletion[0].creation,
    }
