import frappe
import json
import uuid
from frappe.utils.pdf import get_pdf
from nirmaan_stack.api.pdf_helper.pdf_merger_api import merge_pdfs_interleaved
from nirmaan_stack.api.pdf_helper.bulk_download import ensure_temp_dir, get_temp_path


@frappe.whitelist()
def export_tds_report(settings_json: str, items_json: str, project_name: str = "TDS_Report"):
    """Enqueue a TDS PDF export and return immediately.

    The worker publishes:
      * `tds_export_progress` — per-item progress (via merge_pdfs_interleaved).
      * `tds_export_ready`    — on success, with {token, filename, failed_items}.
      * `tds_export_failed`   — on fatal error, with {message}.

    The client fetches the finished PDF via `bulk_download.fetch_temp_file`.
    """
    user = frappe.session.user
    frappe.enqueue(
        "nirmaan_stack.api.tds.tds_report.run_tds_export_job",
        queue="long",
        timeout=600,  # 10 min
        user=user,
        settings_json=settings_json,
        items_json=items_json,
        project_name=project_name,
    )
    return {"message": "Job enqueued"}


def run_tds_export_job(user, settings_json, items_json, project_name):
    """Background worker: renders the TDS Print Format, merges attachments,
    writes the merged PDF to a temp file, emits `tds_export_ready` with a token."""
    try:
        frappe.set_user(user)

        settings = json.loads(settings_json) if isinstance(settings_json, str) else settings_json
        items = json.loads(items_json) if isinstance(items_json, str) else items_json

        combined_data = json.dumps({"settings": settings, "history": items})

        print_format = frappe.get_doc("Print Format", "Project TDS Report")
        if not print_format:
            frappe.throw("Print Format 'Project TDS Report' not found")

        # Same context plumbing as the old synchronous endpoint so the existing
        # Jinja template keeps working unchanged.
        frappe.form_dict.data = combined_data
        template = frappe.render_template(print_format.html, {"frappe": frappe, "json": json})
        base_pdf = get_pdf(template)

        merged_pdf, failed_items = merge_pdfs_interleaved(
            base_pdf, items, progress_event="tds_export_progress"
        )

        ensure_temp_dir()
        token = uuid.uuid4().hex
        with open(get_temp_path(token), "wb") as f:
            f.write(merged_pdf)

        clean_name = frappe.scrub(project_name).replace("_", " ").title().replace(" ", "_")
        filename = f"TDS_Report_{clean_name}_{frappe.utils.nowdate()}.pdf"

        frappe.publish_realtime(
            "tds_export_ready",
            {"token": token, "filename": filename, "failed_items": failed_items or []},
            user=user,
        )

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "run_tds_export_job failed")
        frappe.publish_realtime(
            "tds_export_failed",
            {"message": str(e)},
            user=user,
        )
