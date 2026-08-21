import json
import os

import frappe
from frappe.utils.file_manager import save_file

from nirmaan_stack.api.boq.wizard.revision import assert_revisable_source
from nirmaan_stack.api.boq.wizard.sheet_preview import _fetch_boq_file_to_tempfile
from nirmaan_stack.services.boq_parser._auto_guess import auto_guess_sheet_config
from nirmaan_stack.services.boq_parser.reader import BoqReader

_MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB
_ALLOWED_EXTENSIONS = frozenset({".xlsx", ".xlsm"})

# Fallback status cache: the worker records its terminal outcome here keyed by RQ
# job id so the upload screen can poll get_upload_status() if it misses the
# (room-targeted, non-replayed) boq:wizard_parse_done realtime event.
_UPLOAD_STATUS_CACHE_PREFIX = "boq_upload_status"
_UPLOAD_STATUS_TTL_SEC = 3600  # 1 hour -- ample for a client to poll the fallback


def _upload_status_key(job_id):
    return f"{_UPLOAD_STATUS_CACHE_PREFIX}::{job_id}"


def _coerce_flag(value):
    """Coerce a multipart form flag ('1'/'true'/'yes'/1/True) to int 0|1."""
    if value is None:
        return 0
    if isinstance(value, bool):
        return 1 if value else 0
    return 1 if str(value).strip().lower() in ("1", "true", "yes") else 0


def _publish_and_record(payload, user):
    """Publish boq:wizard_parse_done (user-targeted) AND record the outcome in the
    cache keyed by the current RQ job id.

    The realtime event is room-targeted and is NOT replayed, so a client that was
    not connected/joined when this fires (e.g. right after login) never hears it
    and hangs on "Parsing". get_upload_status() reads this cache entry so the
    client can recover by polling. The cache write is best-effort -- it lives in
    Redis (independent of the DB transaction, so it survives the internal-error
    rollback) and must never fail the job.
    """
    frappe.publish_realtime("boq:wizard_parse_done", payload, user=user)
    try:
        from rq import get_current_job  # noqa: PLC0415

        job = get_current_job()
        if job is not None:
            frappe.cache().set_value(
                _upload_status_key(job.id),
                payload,
                expires_in_sec=_UPLOAD_STATUS_TTL_SEC,
            )
    except Exception:
        pass


@frappe.whitelist()
def upload_file():
    """Validate, persist, enqueue async parse worker. Returns {job_id}.

    Template-source authoring path (is_template_source=1, ADR-0013 A1-D4/D10): the master
    template is SEEDED from a normally-committed, project-less scratch authoring BoQ. That
    seed is authored by uploading with is_template_source=1, so project_id is OPTIONAL then.
    The non-template (project) upload path is byte-identical.
    """
    is_template_source = _coerce_flag(frappe.form_dict.get("is_template_source"))

    # Authoring the project-less template SEED is an Admin/Estimates action (ADR-0013 A1-D10),
    # matching the gate on 'Set as master template'. The NORMAL project-upload path below stays
    # ungated (byte-identical to pre-A1) -- only the is_template_source branch is restricted.
    if is_template_source:
        _u = frappe.session.user
        _role = frappe.db.get_value("Nirmaan Users", _u, "role_profile")
        if _u != "Administrator" and _role not in (
            "Nirmaan Admin Profile",
            "Nirmaan Estimates Executive Profile",
        ):
            frappe.throw(
                "Only an Admin or Estimates Executive may author a template-source BoQ.",
                frappe.PermissionError,
            )

    project_id = frappe.form_dict.get("project_id")
    if not is_template_source:
        if not project_id:
            frappe.throw("project_id is required.", title="Missing field: project_id")

        if not frappe.db.exists("Projects", project_id):
            frappe.throw(f"Project '{project_id}' not found.", title="Not found")
    else:
        # Template-source authoring: project is optional/None. If a project IS supplied it
        # must still exist; otherwise the seed is project-less.
        if project_id and not frappe.db.exists("Projects", project_id):
            frappe.throw(f"Project '{project_id}' not found.", title="Not found")
        project_id = project_id or None

    # Revised-BoQ entry (ADR-0014 D1/D2): when source_boq is set the upload is a REVISION of
    # an already-committed original -- a new BOQs doc (origin="revision", source_boq) that the
    # worker seeds NO drafts for (S3 seeds after the human confirms the sheet mapping). The
    # non-revision path stays byte-identical: source_boq absent -> everything below unchanged.
    source_boq = frappe.form_dict.get("source_boq") or None
    if source_boq:
        if is_template_source:
            frappe.throw(
                "A template-source upload cannot also be a revision.",
                title="Conflicting flags",
            )
        # D1 eligibility (same project + >= 1 committed sheet) is re-validated in its owning
        # module: the picker already filters, but a stale picker / hand-crafted request must
        # not create a revision against an ineligible original (which would break S3 seeding).
        assert_revisable_source(source_boq, project_id)

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

    # The worker re-fetches the file from durable storage by URL (see
    # _upload_file_worker). We intentionally do NOT hand the worker a local
    # path: the web process and the RQ worker can run in separate containers
    # with no shared /tmp, so a web-written tempfile is unreadable there.
    job = frappe.enqueue(
        "nirmaan_stack.api.boq.wizard.upload_file._upload_file_worker",
        queue="long",
        timeout=600,
        user=frappe.session.user,
        project_id=project_id,
        file_url=file_url,
        file_name=filename,
        is_template_source=is_template_source,
        source_boq=source_boq,
    )

    return {"job_id": job.id if job else None}


@frappe.whitelist()
def get_upload_status(job_id=None):
    """Polling fallback for a BoQ upload parse outcome, keyed by RQ job id.

    The upload screen normally learns the result via the realtime
    boq:wizard_parse_done event, but that event is room-targeted and not replayed
    -- a client that missed it (e.g. socket not joined yet right after login)
    would otherwise hang on "Parsing". The worker records its terminal outcome via
    _publish_and_record(); this returns it.

    Shapes (mirrors the realtime payload so the client reuses one handler):
      {"state": "pending"}                                          -- still running / unknown
      {"state": "done", "status": "success", "boq_name": "<name>"}  -- parsed, BOQs row created
      {"state": "done", "status": "error", "error_code": "<code>"}  -- failed
    """
    if not job_id:
        frappe.throw("job_id is required.", title="Missing field: job_id")

    cached = frappe.cache().get_value(_upload_status_key(job_id))
    if not cached:
        return {"state": "pending"}

    return {"state": "done", **cached}


def append_sheet_drafts(boq_doc, reader, sheets):
    """Append one `sheet_drafts` row per workbook sheet. Call BEFORE saving `boq_doc`.

    Extracted verbatim from `_upload_file_worker` (Amendment B W3) so the fresh-upload path and
    `revision.convert_revision_entry`'s Revise -> New re-seed share ONE implementation. A
    conversion that seeded drafts differently from a fresh upload would be a silent divergence
    in the thing the entire wizard hangs off.

    `wizard_status` comes from workbook sheet visibility: a visible sheet is `Pending`, a
    hidden/very-hidden one `Hidden`.
    """
    sheet_states = reader.list_sheet_states()
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
                # NOTE: `BoQ Sheet Draft` has no `work_package` field -- work packages are the
                # `work_packages` GRANDCHILD table. This key has never persisted, so the
                # auto-detect above is inert. Preserved verbatim in this extraction rather than
                # "fixed": making it write for real would change fresh-upload behaviour, which
                # is a separate, owner-visible decision.
                "work_package": work_pkg,
            },
        )


def prefill_sheet_configs(boq_doc, reader, only_sheet_names=None):
    """Auto-guess `sheet_config` for every Pending draft. Call AFTER saving `boq_doc`.

    Post-save because `frappe.db.set_value` needs the child rows' real docnames. Failure is
    per-sheet isolated: an exception leaves that sheet's `sheet_config` as None and the caller
    continues normally. Shared by the upload worker, the W3 conversion re-seed, and the S3
    revision confirm.

    `only_sheet_names`: when given, restrict the guess to those VERBATIM sheet names (#152).
    Default None = every Pending draft, byte-identical to the fresh-upload behaviour. The
    revision seam (`revision._prefill_new_sheet_configs`) passes its declared-New tabs, and
    that scoping is LOAD-BEARING: under A2 every revised draft is `Pending`, so an unfiltered
    call there would overwrite each MAPPED sheet's carried role map (S4) with a fresh guess.
    """
    for draft in boq_doc.sheet_drafts:
        if draft.wizard_status != "Pending":
            continue
        if only_sheet_names is not None and draft.sheet_name not in only_sheet_names:
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


def _upload_file_worker(project_id, file_url, file_name, user, is_template_source=0, source_boq=None):
    """Async worker: open workbook, create BOQs row + sheet_drafts, publish result.

    is_template_source=1 (ADR-0013 A1): stamp the created BOQs as a project-less template
    SOURCE (is_template_source=1, origin="upload") -- the scratch authoring BoQ that is later
    committed and promoted into the master template via 'Set as master template'. project_id
    may be None in that case.

    source_boq set (ADR-0014 D1/D2, a REVISION): stamp the created BOQs as origin="revision"
    with source_boq -> the original, and reuse the ORIGINAL's boq_name so the origin-agnostic
    `boqs.py before_insert` auto-bumps version to N+1. The E/F workbook validation runs exactly
    as today, but NO sheet_drafts are seeded -- S3's confirm_revision_mapping seeds them after
    the human confirms the sheet mapping. The non-revision path (source_boq is None) is
    byte-identical to before.
    """
    frappe.set_user(user)
    worker_tmp = None
    try:
        # Step 1: Create Nirmaan Attachments early; associated_docname linked in step 11.
        att_doc = frappe.new_doc("Nirmaan Attachments")
        att_doc.project = project_id
        att_doc.associated_doctype = "BOQs"
        att_doc.attachment_type = "boq source file"
        att_doc.attachment = file_url
        att_doc.insert(ignore_permissions=True)

        # Step 2: Fetch the workbook into THIS worker's own filesystem, then open it.
        # We re-fetch from durable storage (S3) by URL because the web endpoint and
        # the RQ worker may run in SEPARATE containers with no shared /tmp -- a path
        # written by the web process is unreadable here (mirrors the proven
        # sheet_preview.get_sheet_preview path). A fetch failure propagates to the
        # outer except (-> "internal" + raise, landing in the Error Log + a failed
        # job, so it is diagnosable); a genuine open failure on a good fetch below
        # is a corrupted workbook.
        worker_tmp = _fetch_boq_file_to_tempfile(file_url)
        try:
            reader = BoqReader(worker_tmp)
        except Exception:
            # LOG BEFORE RETURNING. This branch returns rather than raising, so
            # without an explicit log_error it lands in NO Error Log at all -- the
            # user sees a generic "corrupted" and nobody can tell WHY. That gap is
            # what made the 2026-08-20 openpyxl-strictness failures undiagnosable
            # (two real BoQs, two different out-of-spec attributes, one useless
            # message). `_repair_fetched_workbook` now handles the two known
            # defects at fetch time, so anything reaching here is a NEW defect and
            # the traceback is the only way we will learn what it is.
            frappe.log_error(
                title="BoQ upload: workbook could not be opened",
                message=(
                    f"file_url={file_url!r} file_name={file_name!r}\n\n"
                    f"{frappe.get_traceback()}"
                ),
            )
            _publish_and_record({"status": "error", "error_code": "corrupted"}, user)
            return

        # Step 3: Guard zero sheets.
        sheets = reader.list_sheets()
        if not sheets:
            _publish_and_record({"status": "error", "error_code": "zero_sheets"}, user)
            return

        # Step 4: BoQ name. A revision REUSES the original's boq_name (so before_insert bumps
        # version to N+1 for the same (project, boq_name)); a fresh upload derives it from the
        # filename (strip ext, underscores -> spaces).
        if source_boq:
            boq_name = frappe.db.get_value("BOQs", source_boq, "boq_name")
        else:
            base = os.path.splitext(file_name)[0]
            boq_name = base.replace("_", " ")

        # Step 5: Version is owned by BOQs.before_insert (M1.25: COALESCE(MAX(version), 0) + 1
        # scoped to project + boq_name). Do not set it here; the controller computes it.

        # Step 6: Create BOQs row.
        boq_doc = frappe.new_doc("BOQs")
        boq_doc.project = project_id
        if is_template_source:
            # ADR-0013 A1: a template-source authored via upload is a project-less BOQs doc
            # (the scratch seed later promoted into the master template).
            boq_doc.is_template_source = 1
            boq_doc.origin = "upload"
        if source_boq:
            # ADR-0014 D2: a revision is a new BOQs doc pointing back at the frozen original.
            boq_doc.origin = "revision"
            boq_doc.source_boq = source_boq
        boq_doc.wizard_state = "In progress"
        boq_doc.boq_name = boq_name
        boq_doc.tax_treatment = "Pre-tax"
        boq_doc.notes = ""
        boq_doc.source_file_url = file_url

        # Steps 8-9: seed sheet_drafts (fresh-upload path only). A REVISION seeds NO drafts
        # here -- S3's confirm_revision_mapping seeds them once the human confirms the sheet
        # mapping (ADR-0014 D2/D3). The unconfirmed-revision marker is exactly
        # origin=="revision" AND an empty sheet_drafts, so this skip is load-bearing.
        if not source_boq:
            append_sheet_drafts(boq_doc, reader, sheets)

        # Step 10: Save the BOQs row (cascades sheet_drafts child rows; a revision has none).
        boq_doc.insert(ignore_permissions=True)

        # Step 10.5: auto-guess each Pending sheet's config (post-insert -- child row names
        # exist now). A revision has no seeded drafts, so this is a no-op for it (S3 seeds).
        prefill_sheet_configs(boq_doc, reader)

        # Step 11: Link the attachment to the now-known BOQs document name.
        frappe.db.set_value(
            "Nirmaan Attachments", att_doc.name, "associated_docname", boq_doc.name
        )

        # Step 11b: Give the uploaded workbook File a real owner. save_file() at the
        # endpoint stores it with an empty attached_to_* (an orphan in "tabFile");
        # now that the BOQs doc exists, attach the File to it so it shows in the
        # native attachment panel and is cleaned up when the BoQ is deleted. The
        # Nirmaan Attachments row stays as the parallel index (unchanged).
        source_file = frappe.db.get_value("File", {"file_url": file_url}, "name")
        if source_file:
            frappe.db.set_value(
                "File",
                source_file,
                {"attached_to_doctype": "BOQs", "attached_to_name": boq_doc.name},
                update_modified=False,
            )

        frappe.db.commit()

        # Step 12: Notify client (realtime) + record outcome for the polling fallback.
        _publish_and_record({"boq_name": boq_doc.name, "status": "success"}, user)

    except Exception:
        _publish_and_record({"status": "error", "error_code": "internal"}, user)
        raise
    finally:
        if worker_tmp:
            try:
                os.remove(worker_tmp)
            except OSError:
                pass
