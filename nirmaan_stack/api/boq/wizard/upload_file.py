import json
import os
import tempfile

import frappe
from frappe.utils.file_manager import save_file

from nirmaan_stack.services.boq_parser._auto_guess import auto_guess_sheet_config
from nirmaan_stack.services.boq_parser.reader import BoqReader

_MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB
_ALLOWED_EXTENSIONS = frozenset({".xlsx", ".xlsm"})


@frappe.whitelist()
def upload_file():
    """Validate, persist, enqueue async parse worker. Returns {job_id}."""
    project_id = frappe.form_dict.get("project_id")
    if not project_id:
        frappe.throw("project_id is required.", title="Missing field: project_id")

    if not frappe.db.exists("Projects", project_id):
        frappe.throw(f"Project '{project_id}' not found.", title="Not found")

    files = frappe.request.files
    if "file" not in files:
        frappe.throw("No file uploaded.", title="Missing file")

    uploaded = files["file"]
    filename = uploaded.filename or ""
    _, ext = os.path.splitext(filename)
    if ext.lower() not in _ALLOWED_EXTENSIONS:
        frappe.throw(
            f"We support .xlsx and .xlsm files only. You uploaded a .{ext.lstrip('.')} file.",
            title="Unsupported file type",
        )

    file_content = uploaded.read()
    if len(file_content) > _MAX_FILE_BYTES:
        mb = len(file_content) / (1024 * 1024)
        frappe.throw(
            f"This file is {mb:.1f} MB. Maximum is 25 MB.",
            title="File too large",
        )

    ret = save_file(fname=filename, content=file_content, dt=None, dn=None, is_private=1)
    file_url = ret.file_url

    # Write upload bytes to a tempfile so the worker can parse them regardless
    # of storage backend (file_url may be an S3 API URL, not a local path).
    tmp = tempfile.NamedTemporaryFile(suffix=ext.lower(), delete=False)
    try:
        tmp.write(file_content)
    finally:
        tmp.close()
    tempfile_path = tmp.name

    job = frappe.enqueue(
        "nirmaan_stack.api.boq.wizard.upload_file._upload_file_worker",
        queue="long",
        timeout=600,
        user=frappe.session.user,
        project_id=project_id,
        tempfile_path=tempfile_path,
        file_url=file_url,
        file_name=filename,
    )

    return {"job_id": job.id if job else None}


def _upload_file_worker(project_id, tempfile_path, file_url, file_name, user):
    """Async worker: open workbook, create BOQs row + sheet_drafts, publish result."""
    frappe.set_user(user)
    try:
        # Step 1: Create Nirmaan Attachments early; associated_docname linked in step 11.
        att_doc = frappe.new_doc("Nirmaan Attachments")
        att_doc.project = project_id
        att_doc.associated_doctype = "BOQs"
        att_doc.attachment_type = "boq source file"
        att_doc.attachment = file_url
        att_doc.insert(ignore_permissions=True)

        # Step 2: Open workbook; publish corrupted error and abort on failure.
        try:
            reader = BoqReader(tempfile_path)
        except Exception:
            frappe.publish_realtime(
                "boq:wizard_parse_done",
                {"status": "error", "error_code": "corrupted"},
            )
            return

        # Step 3: Guard zero sheets.
        sheets = reader.list_sheets()
        if not sheets:
            frappe.publish_realtime(
                "boq:wizard_parse_done",
                {"status": "error", "error_code": "zero_sheets"},
            )
            return

        # Step 4: BoQ name from filename (strip ext, underscores -> spaces).
        base = os.path.splitext(file_name)[0]
        boq_name = base.replace("_", " ")

        # Step 5: Version is owned by BOQs.before_insert (M1.25: COALESCE(MAX(version), 0) + 1
        # scoped to project + boq_name). Do not set it here; the controller computes it.

        # Step 6: Create BOQs row.
        boq_doc = frappe.new_doc("BOQs")
        boq_doc.project = project_id
        boq_doc.wizard_state = "In progress"
        boq_doc.boq_name = boq_name
        boq_doc.tax_treatment = "Pre-tax"
        boq_doc.notes = ""
        boq_doc.source_file_url = file_url

        # Step 8: Get sheet visibility states.
        sheet_states = reader.list_sheet_states()

        # Step 9: Auto-detect work_package; build sheet_drafts.
        work_headers = frappe.get_all(
            "Work Headers",
            fields=["work_header_name"],
            order_by="work_header_name asc",
        )
        for idx, sheet_name in enumerate(sheets, start=1):
            state = sheet_states.get(sheet_name, "visible")
            wiz_status = "Pending" if state == "visible" else "Hidden"

            work_pkg = None
            for wh in work_headers:
                if wh["work_header_name"].lower() in sheet_name.lower():
                    work_pkg = wh["work_header_name"]
                    break

            boq_doc.append(
                "sheet_drafts",
                {
                    "sheet_name": sheet_name,
                    "sheet_order": idx,
                    "wizard_status": wiz_status,
                    "work_package": work_pkg,
                },
            )

        # Step 10: Save the BOQs row (cascades sheet_drafts child rows).
        boq_doc.insert(ignore_permissions=True)

        # Step 10.5: Prefill sheet_config with auto-guessed SheetConfig for each Pending sheet.
        # Child row names are now assigned (post-insert), so set_value targets are valid.
        # Failure is per-sheet isolated: an exception leaves sheet_config as None and the
        # upload continues normally. The reader is still open at this point.
        for draft in boq_doc.sheet_drafts:
            if draft.wizard_status != "Pending":
                continue
            try:
                header_row = reader.detect_header_row(draft.sheet_name)
                if header_row is None:
                    continue
                detected = auto_guess_sheet_config(reader, draft.sheet_name, header_row)
                frappe.db.set_value(
                    "BoQ Sheet Draft",
                    draft.name,
                    "sheet_config",
                    json.dumps(detected.model_dump()),
                )
            except Exception:
                frappe.log_error(
                    title="BoQ auto-guess failed",
                    message=frappe.get_traceback(),
                )

        # Step 11: Link the attachment to the now-known BOQs document name.
        frappe.db.set_value(
            "Nirmaan Attachments", att_doc.name, "associated_docname", boq_doc.name
        )

        frappe.db.commit()

        # Step 12: Notify client.
        frappe.publish_realtime(
            "boq:wizard_parse_done",
            {"boq_name": boq_doc.name, "status": "success"},
        )

    except Exception:
        frappe.publish_realtime(
            "boq:wizard_parse_done",
            {"status": "error", "error_code": "internal"},
        )
        raise
    finally:
        try:
            os.remove(tempfile_path)
        except OSError:
            pass
