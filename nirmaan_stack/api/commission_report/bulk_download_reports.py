"""Bulk-download commission report PDFs as a background operation (ADR 0047).

`start_commission_reports` starts the operation through `services/background_ops`; its work,
`commission_reports_op`, renders the per-task print format for each SELECTED commission task on the
`long` queue and merges them into ONE PDF, so no web worker is ever blocked. The screen follows the
operation's status record (`api/background_ops.get_status`) and collects the PDF with
`api/background_ops.collect_result`, which only the user who started it can do.

Owner scope: only Field-type tasks in Submitted status are rendered; the gate is re-checked from the
DB in the work (the client is never trusted for it).

Rendering note: the commission print format selects the child row via
`frappe.form_dict.task_row`, which `frappe.get_print` DROPS (every task then renders
identical). So each task is rendered with `frappe.render_template(pf.html, {"doc":
tracker})` (which sees the live form_dict) then `frappe.utils.pdf.get_pdf`. Verified
per-task-correct + valid merged PDF.
"""
import io
import json

import frappe
from frappe import _
from frappe.utils import today
from frappe.utils.pdf import get_pdf
from pypdf import PdfReader, PdfWriter

from nirmaan_stack.services import background_ops

PARENT_DOCTYPE = "Project Commission Report"
CHILD_DOCTYPE = "Commission Report Task Child Table"
PF_PORTRAIT = "Project Commission Report - Filled Task"
PF_LANDSCAPE = "LSProject Commission Report - Filled Task"

# No selection cap: the operation has no HTTP timeout, so any number the tracker has (60, 100, …)
# is handled. Its time limit counts from when it starts running.
TIMEOUT_SECONDS = 300


@frappe.whitelist(methods=["POST"])
def start_commission_reports(op_id=None, tracker=None, tasks=None):
    """Start merging the selected reports into one PDF as a background operation and return its record.

    Args:
        op_id:   the operation id the browser made.
        tracker: the "Project Commission Report" docname (parent of every selected row).
        tasks:   JSON list of {"name": <child row name>, "landscape": bool}.
    """
    if isinstance(tasks, str):
        tasks = json.loads(tasks or "[]")

    if not tracker:
        frappe.throw(_("Missing tracker."))
    if not tasks:
        frappe.throw(_("No tasks selected."))

    if not frappe.has_permission(PARENT_DOCTYPE, "read", doc=tracker):
        raise frappe.PermissionError(_("Not permitted to read this tracker."))

    return background_ops.start(
        "commission_bulk_download",
        "nirmaan_stack.api.commission_report.bulk_download_reports.commission_reports_op",
        op_id=op_id,
        timeout=TIMEOUT_SECONDS,
        tracker=tracker,
        tasks=tasks,
    )


def commission_reports_op(tracker, tasks):
    """The work of `start_commission_reports`, run as its owner: render each eligible task, merge, and keep
    the PDF for the owner. A report that fails to render is left out and counted in `failed`."""
    # Requested orientation per child row name (appearance only).
    want_landscape = {}
    for t in tasks or []:
        name = (t or {}).get("name")
        if name:
            want_landscape[name] = bool((t or {}).get("landscape"))
    names = list(want_landscape.keys())

    # Re-fetch + gate (Field + Submitted), scoped to THIS tracker. Authoritative.
    eligible = set(
        frappe.get_all(
            CHILD_DOCTYPE,
            filters={
                "name": ["in", names],
                "parent": tracker,
                "parenttype": PARENT_DOCTYPE,
                "report_type": "Field",
                "task_status": "Submitted",
            },
            pluck="name",
        )
    )
    ordered = [n for n in names if n in eligible]  # preserve client order
    if not ordered:
        frappe.throw(_("None of the selected tasks are eligible (Field type, Submitted status)."))

    tracker_doc = frappe.get_doc(PARENT_DOCTYPE, tracker)
    pf_html_cache = {}

    def _pf_html(landscape):
        pf_name = PF_LANDSCAPE if landscape else PF_PORTRAIT
        if pf_name not in pf_html_cache:
            pf_html_cache[pf_name] = frappe.get_cached_doc("Print Format", pf_name).html or ""
        return pf_html_cache[pf_name]

    total = len(ordered)
    merger = PdfWriter()
    rendered = 0
    failed = 0
    try:
        for i, name in enumerate(ordered):
            background_ops.set_progress(
                i * 100 // total, f"Preparing report {i + 1} of {total}", detail={"done": i, "total": total}
            )
            try:
                # form_dict.task_row is what the print format reads; render_template sees it live.
                frappe.local.form_dict["task_row"] = name
                html = frappe.render_template(_pf_html(want_landscape.get(name)), {"doc": tracker_doc})
                reader = PdfReader(io.BytesIO(get_pdf(html)))
                for page in reader.pages:
                    merger.add_page(page)
                rendered += 1
            except Exception as e:
                failed += 1
                frappe.log_error(message=str(e), title=f"Commission bulk PDF failed for task: {name}")
    finally:
        frappe.local.form_dict.pop("task_row", None)

    if not rendered:
        frappe.throw(_("Failed to generate the selected reports."))

    buf = io.BytesIO()
    merger.write(buf)
    merger.close()

    project_name = frappe.db.get_value(PARENT_DOCTYPE, tracker, "project_name") or "Project"
    safe = "".join(c if (c.isalnum() or c in "-_") else "_" for c in project_name)
    background_ops.write_result_file(buf.getvalue(), f"{safe}_Commission_Reports_{today()}.pdf")
    # `failed` lets the screen tell the user some reports were dropped from the merge.
    return {"rendered": rendered, "failed": failed, "total": total}
