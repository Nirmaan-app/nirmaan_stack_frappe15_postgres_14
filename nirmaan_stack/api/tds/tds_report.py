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


def _enrich_model_no(items):
    """Compute the per-row "Model No." cell = distinct member categories of the
    row's frozen TDS Item (group), comma-joined.

    Phase 2 rows hold the frozen TDS Item id in `tds_item_id`; a group spans
    several member categories, so Model No. is the joined member-category list,
    derived **live** from the master (informational, not the signed datasheet —
    ADR-0003). The lookup is a single batched `get_all` over the member child
    rows (no N+1).

    Fallbacks:
      * legacy rows whose `tds_item_id` is an old Items-SKU / CUS- / PCUS- id
        (i.e. it does NOT resolve to an existing `TDS Items` group) → fall back
        to the row's frozen `tds_category` string;
      * a member-less (custom) group → empty (its frozen `tds_category`, if any).
    """
    if not items:
        return

    # Collect the candidate group ids referenced by the rows.
    item_ids = sorted({
        (it.get("tds_item_id") or "").strip()
        for it in items
        if (it.get("tds_item_id") or "").strip()
    })

    # Which of those ids are real TDS Item groups? (vs legacy SKU/CUS-/PCUS- ids)
    valid_groups = set()
    member_cats = {}  # group id -> [distinct categories, in first-seen order]
    if item_ids:
        existing = frappe.get_all(
            "TDS Items",
            filters={"name": ["in", item_ids]},
            pluck="name",
            limit_page_length=0,
        )
        valid_groups = set(existing)

        if valid_groups:
            rows = frappe.get_all(
                "TDS Items Child Table",
                filters={
                    "parent": ["in", list(valid_groups)],
                    "parenttype": "TDS Items",
                },
                fields=["parent", "category"],
                order_by="idx asc",
                limit_page_length=0,
            )
            for r in rows:
                if not r.parent or not r.category:
                    continue
                cats = member_cats.setdefault(r.parent, [])
                if r.category not in cats:  # distinct, preserve order
                    cats.append(r.category)

    for it in items:
        gid = (it.get("tds_item_id") or "").strip()
        if gid in valid_groups:
            # Existing group: joined member categories. A member-less group
            # yields no categories → fall back to the frozen category string.
            cats = member_cats.get(gid)
            it["tds_model_no"] = ", ".join(cats) if cats else (it.get("tds_category") or "")
        else:
            # Legacy / unresolved id → frozen single category.
            it["tds_model_no"] = it.get("tds_category") or ""


def run_tds_export_job(user, settings_json, items_json, project_name):
    """Background worker: renders the TDS Print Format, merges attachments,
    writes the merged PDF to a temp file, emits `tds_export_ready` with a token."""
    try:
        frappe.set_user(user)

        settings = json.loads(settings_json) if isinstance(settings_json, str) else settings_json
        items = json.loads(items_json) if isinstance(items_json, str) else items_json

        # Phase 2: a project row = (TDS Item group, Make); the "Model No." cell
        # is the group's distinct member categories, comma-joined (derived live).
        _enrich_model_no(items)

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
