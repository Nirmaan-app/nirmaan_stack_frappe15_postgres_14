import frappe
import json
from frappe.utils.pdf import get_pdf
from nirmaan_stack.api.pdf_helper.pdf_merger_api import merge_pdfs_interleaved
from nirmaan_stack.services import background_ops


#: Time limit of one export, counted from when it starts running.
EXPORT_TIMEOUT_SECONDS = 600


@frappe.whitelist(methods=["POST"])
def start_tds_export(op_id: str, settings_json: str, items_json: str, project_name: str = "TDS_Report"):
    """Start a TDS PDF export (the TDS Repository's and the Handover's) as a background operation (ADR 0047) and return its record.

    The browser makes `op_id`. The screen follows the export with `api/background_ops.get_status` and collects
    the PDF with `collect_result`; only the user who started it can do either.
    """
    return background_ops.start(
        "tds_export",
        "nirmaan_stack.api.tds.tds_report.tds_export_op",
        op_id=op_id,
        timeout=EXPORT_TIMEOUT_SECONDS,
        settings_json=settings_json,
        items_json=items_json,
        project_name=project_name,
    )


def tds_export_op(settings_json, items_json, project_name):
    """The work of `start_tds_export`: the TDS report PDF, kept privately for the operation's owner."""
    merged_pdf, failed_items = build_tds_report_pdf(
        settings_json, items_json, on_progress=background_ops.set_progress
    )
    background_ops.write_result_file(merged_pdf, _export_filename(project_name))
    return {"failed_items": failed_items or []}


def _export_filename(project_name):
    clean_name = frappe.scrub(project_name).replace("_", " ").title().replace(" ", "_")
    return f"TDS_Report_{clean_name}_{frappe.utils.nowdate()}.pdf"


def _enrich_derived_cells(items):
    """Derive the two per-row cells that are computed LIVE from the master, not
    frozen on the row: "Model No." and the Sample Description member list.

      * `tds_model_no`      = distinct member CATEGORIES, comma-joined.
      * `tds_member_names`  = member ITEM NAMES, comma-joined — what the Sample
                              Description block prints in place of the frozen
                              `tds_description` when the group has members.

    Both come from ONE batched pass over `Items`; adding the member names cost a
    field on the existing query, not another round trip.

    Phase 2 rows hold the frozen TDS Item id in `tds_item_id`; a group spans
    several member categories, so Model No. is the joined member-category list,
    derived **live** from the master (informational, not the signed datasheet —
    ADR-0025). The lookup is a single batched `get_all` over the member child
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
    member_cats = {}   # group id -> [distinct categories, in first-seen order]
    member_names = {}  # group id -> [member item names, item_name asc]
    if item_ids:
        existing = frappe.get_all(
            "TDS Items",
            filters={"name": ["in", item_ids]},
            pluck="name",
            limit_page_length=0,
        )
        valid_groups = set(existing)

        if valid_groups:
            # ADR-0026: membership is N:1 owned by the Item, so a group's members
            # are `Items WHERE linked_tds_item = <group>`. This is the BATCHED
            # equivalent of `members.get_group_category` (which is per-group and
            # would be an N+1 here) — the two must stay semantically identical:
            # distinct member categories, first-seen order.
            rows = frappe.get_all(
                "Items",
                filters={"linked_tds_item": ["in", list(valid_groups)]},
                fields=["linked_tds_item", "category", "item_name"],
                order_by="item_name asc",
                limit_page_length=0,
            )
            for r in rows:
                parent = r.get("linked_tds_item")
                if not parent:
                    continue
                if r.item_name:
                    # Every member, in the query's item_name order. NOT deduped:
                    # two members may legitimately share a name.
                    member_names.setdefault(parent, []).append(r.item_name)
                if not r.category:
                    continue
                cats = member_cats.setdefault(parent, [])
                if r.category not in cats:  # distinct, preserve order
                    cats.append(r.category)

    for it in items:
        gid = (it.get("tds_item_id") or "").strip()
        if gid in valid_groups:
            # Existing group: joined member categories. A member-less group
            # yields no categories → fall back to the frozen category string.
            cats = member_cats.get(gid)
            it["tds_model_no"] = ", ".join(cats) if cats else (it.get("tds_category") or "")
            names = member_names.get(gid)
            it["tds_member_names"] = ", ".join(names) if names else ""
        else:
            # Legacy / unresolved id → frozen single category, and no members to
            # list, so the template keeps printing the frozen description.
            it["tds_model_no"] = it.get("tds_category") or ""
            it["tds_member_names"] = ""


def build_tds_report_pdf(settings, items, on_progress=None) -> tuple:
    """THE TDS report: the "Project TDS Report" print format over `settings` + `items`, with each
    item's attached data sheet merged in after its row. Returns (pdf_bytes, failed_items).

    Shared with the Handover Documents binder, so it puts the SAME document in (`api/hod/tds_pack.py`)
    instead of stapling the loose data sheets together -- one renderer, so the two can never drift.
    `on_progress` is a background operation's progress (`merge_pdfs_interleaved`); the binder passes none.
    """
    settings = json.loads(settings) if isinstance(settings, str) else settings
    items = json.loads(items) if isinstance(items, str) else items

    # Phase 2: a project row = (TDS Item group, Make); the "Model No." cell
    # is the group's distinct member categories, comma-joined (derived live).
    _enrich_derived_cells(items)

    combined_data = json.dumps({"settings": settings, "history": items})

    print_format = frappe.get_doc("Print Format", "Project TDS Report")
    if not print_format:
        frappe.throw("Print Format 'Project TDS Report' not found")

    # Same context plumbing as the old synchronous endpoint so the existing
    # Jinja template keeps working unchanged.
    frappe.form_dict.data = combined_data
    template = frappe.render_template(print_format.html, {"frappe": frappe, "json": json})
    base_pdf = get_pdf(template)

    return merge_pdfs_interleaved(base_pdf, items, on_progress=on_progress)
