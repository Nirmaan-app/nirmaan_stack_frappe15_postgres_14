"""
API for generating the DPR Project Target PDF.
Frontend POSTs the schedule payload; we parse it server-side and attach to
the Project doc so the "DPR Project Target" Print Format Jinja can read it.
"""
import json
import frappe


@frappe.whitelist(methods=["POST"])
def print_dpr_target_pdf(project_id: str, payload: str = "{}"):
    """Render the DPR Project Target print format with frontend-supplied schedule data."""
    if not project_id:
        frappe.throw("project_id is required")

    # Parse payload server-side (Jinja sandbox can't access json/parse_json)
    parsed = {}
    try:
        if isinstance(payload, str):
            parsed = json.loads(payload) if payload else {}
        elif isinstance(payload, dict):
            parsed = payload
    except Exception:
        parsed = {}

    # Attach as an attribute on the project doc — Jinja can access doc.dpr_payload
    project_doc = frappe.get_doc("Projects", project_id)
    project_doc.dpr_payload = parsed

    pdf_content = frappe.get_print(
        "Projects",
        project_id,
        print_format="DPR Project Target",
        as_pdf=True,
        no_letterhead=1,
        doc=project_doc,
    )

    project_label = (project_doc.project_name or project_id).replace(" ", "_")
    frappe.local.response.filename = f"{project_label}_DPR_Project_Target.pdf"
    frappe.local.response.filecontent = pdf_content
    frappe.local.response.type = "download"
