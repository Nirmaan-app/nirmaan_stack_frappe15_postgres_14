"""Bulk-download commission report PDFs — ASYNC (background job).

Renders the per-task print format for each SELECTED commission task on the `long`
background queue and merges them into ONE PDF, so NO web worker is ever blocked —
the site stays responsive for every other user even at 55+ reports / many
concurrent downloads. Mirrors api/pdf_helper/bulk_download.py's
enqueue -> worker -> socket-progress -> temp-file-token pattern and reuses its
temp-file helpers + `fetch_temp_file` download endpoint.

Owner scope: only Field-type tasks in Submitted status are rendered; the gate is
re-checked from the DB in the worker (the client is never trusted for it).

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

# Reuse the shared temp-file plumbing (download is via bulk_download.fetch_temp_file).
from nirmaan_stack.api.pdf_helper.bulk_download import ensure_temp_dir, get_temp_path

PARENT_DOCTYPE = "Project Commission Report"
CHILD_DOCTYPE = "Commission Report Task Child Table"
PF_PORTRAIT = "Project Commission Report - Filled Task"
PF_LANDSCAPE = "LSProject Commission Report - Filled Task"

# No selection cap: the async job has no HTTP timeout, so any number the tracker has
# (60, 100, …) is handled — we never reject the user. Job/lock window is generous so
# even a large batch finishes; progress is streamed the whole way.
LOCK_TTL_SECONDS = 300  # 5 min — auto-releases if a job dies; also the enqueue job timeout

# Realtime events (user-targeted, and carry the job_id so the frontend can ignore
# events from a different export it didn't start). Consumer: ApprovedReportsDialog.tsx
EV_PROGRESS = "commission_bulk_progress"
EV_READY = "commission_bulk_ready"
EV_FAILED = "commission_bulk_failed"


def _lock_key(user):
    return f"commission_bulk_lock:{user}"


@frappe.whitelist()
def enqueue_commission_reports(tracker=None, tasks=None):
    """Validate + enqueue a background merge job. Returns immediately.

    Args:
        tracker: the "Project Commission Report" docname (parent of every selected row).
        tasks:   JSON list of {"name": <child row name>, "landscape": bool}.

    Returns:
        {"status": "enqueued", "job_id": <hash>} in ~milliseconds (no render on the web
        worker). Progress / result / errors arrive via the commission_bulk_* realtime
        events, each stamped with this job_id.
    """
    if isinstance(tasks, str):
        tasks = json.loads(tasks or "[]")

    if not tracker:
        frappe.throw(_("Missing tracker."))
    if not tasks:
        frappe.throw(_("No tasks selected."))

    if not frappe.has_permission(PARENT_DOCTYPE, "read", doc=tracker):
        raise frappe.PermissionError(_("Not permitted to read this tracker."))

    user = frappe.session.user
    # One in-flight bulk job per user, via an ATOMIC set-if-absent (NX) lock with a TTL
    # (so a dead job can't lock them out forever). NB: a plain get_value-then-set_value on
    # the same key in one request hits an in-process-cache quirk where the set doesn't
    # stick — so we use the raw redis SET NX EX instead (make_key = site-namespaced key).
    cache = frappe.cache()
    lock_key = cache.make_key(_lock_key(user))
    if not cache.set(lock_key, "1", ex=LOCK_TTL_SECONDS, nx=True):
        frappe.throw(_("A report download is already in progress. Please wait for it to finish."))

    job_id = frappe.generate_hash(length=16)
    try:
        frappe.enqueue(
            "nirmaan_stack.api.commission_report.bulk_download_reports._run_commission_bulk_job",
            queue="long",
            timeout=LOCK_TTL_SECONDS,
            user=user,
            job_id=job_id,
            tracker=tracker,
            tasks=tasks,
        )
    except Exception:
        # The job never made it onto the queue — release the lock so the user isn't
        # stranded for the full TTL, then surface the original error.
        cache.delete_value(_lock_key(user))
        raise
    return {"status": "enqueued", "job_id": job_id}


def _run_commission_bulk_job(tracker=None, tasks=None, user=None, job_id=None):
    """Background worker: render each eligible task, merge, publish the result.

    Runs on the `long` queue (NOT a web worker), so it never blocks page requests.
    """
    frappe.set_user(user or "Administrator")
    try:
        if isinstance(tasks, str):
            tasks = json.loads(tasks or "[]")

        # Requested orientation per child row name (appearance only).
        want_landscape = {}
        for t in (tasks or []):
            name = (t or {}).get("name")
            if name:
                want_landscape[name] = bool((t or {}).get("landscape"))
        names = list(want_landscape.keys())

        # Re-fetch + gate (Field + Submitted), scoped to THIS tracker. Authoritative.
        eligible_rows = frappe.get_all(
            CHILD_DOCTYPE,
            filters={
                "name": ["in", names],
                "parent": tracker,
                "parenttype": PARENT_DOCTYPE,
                "report_type": "Field",
                "task_status": "Submitted",
            },
            fields=["name"],
        )
        eligible = {r.name for r in eligible_rows}
        ordered = [n for n in names if n in eligible]  # preserve client order

        if not ordered:
            frappe.publish_realtime(
                EV_FAILED,
                {"job_id": job_id, "message": "None of the selected tasks are eligible (Field type, Submitted status)."},
                user=user,
            )
            return

        ensure_temp_dir()
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
        for i, name in enumerate(ordered):
            try:
                # form_dict.task_row is what the print format reads; render_template sees it live.
                frappe.local.form_dict["task_row"] = name
                html = frappe.render_template(_pf_html(want_landscape.get(name)), {"doc": tracker_doc})
                pdf_content = get_pdf(html)
                reader = PdfReader(io.BytesIO(pdf_content))
                for page in reader.pages:
                    merger.add_page(page)
                rendered += 1
            except Exception as e:
                failed += 1
                frappe.log_error(message=str(e), title=f"Commission bulk PDF failed for task: {name}")
            frappe.publish_realtime(EV_PROGRESS, {"job_id": job_id, "done": i + 1, "total": total}, user=user)

        if not rendered:
            frappe.publish_realtime(EV_FAILED, {"job_id": job_id, "message": "Failed to generate the selected reports."}, user=user)
            return

        token = frappe.generate_hash(length=32)
        with open(get_temp_path(token), "wb") as f:
            merger.write(f)
        merger.close()

        project_name = frappe.db.get_value(PARENT_DOCTYPE, tracker, "project_name") or "Project"
        safe = "".join(c if (c.isalnum() or c in "-_") else "_" for c in project_name)
        filename = f"{safe}_Commission_Reports_{today()}.pdf"

        # The temp file exists on disk before this event fires -> no race for the download.
        # `failed` lets the frontend tell the user some reports were dropped from the merge.
        frappe.publish_realtime(
            EV_READY,
            {"job_id": job_id, "token": token, "filename": filename,
             "rendered": rendered, "failed": failed, "total": total},
            user=user,
        )
    except Exception as e:
        frappe.log_error(message=str(e), title="Commission bulk job crashed")
        frappe.publish_realtime(EV_FAILED, {"job_id": job_id, "message": "The report download failed. Please try again."}, user=user)
    finally:
        if user:
            frappe.cache().delete_value(_lock_key(user))
