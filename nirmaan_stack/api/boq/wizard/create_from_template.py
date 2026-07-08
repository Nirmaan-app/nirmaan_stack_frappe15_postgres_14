"""
BoQ "Create from Template" -- clone worker + create/master-reader endpoints + socket.

**Amendment A1 (ADR-0013, 2026-07-08):** the templating STORE was redesigned. There is now a
single MASTER template that lives in dedicated doctypes -- **`BoQ Template`** (one master row),
**`BoQ Template Sheet`** (child), **`BoQ Template Row`** (separate doctype keyed by
`template` + `sheet_name`). Templates no longer live on `BOQs` (the `is_template` /
`template_status` flags are GONE). The flatten-and-strip work moved earlier, to seed time
(`template_materialize.py`), so `BoQ Template Row`s are already pre-flattened, single-area,
structure-only. This module's clone is therefore a STRAIGHT structural copy of the template
rows into `BoQ Review Row`s at `wizard_state="Parsed"`, `is_excluded=0` -- a clean parser
baseline the user prunes (`is_excluded`) and prices later.

Because there is exactly ONE master, the create flow has NO template-selection step:
`create_from_template(project, boq_name, sheet_names)` takes no `template_boq` -- it resolves
the active master itself and the picker only chooses the sheet subset.

Public API:
  get_master_template()                                   [GET-capable] -> active master + sheets
  create_from_template(project, boq_name, sheet_names)    [POST] -> {job_id, boq_id}
  get_clone_status(job_id)                                [GET-capable]

Long-job scaffolding (socket + poll fallback) MIRRORS upload_file.py exactly -- the realtime
boq:template_clone_done event is room-targeted + not replayed, so the worker also records its
terminal outcome in a Redis cache keyed by RQ job id for get_clone_status() to poll.
"""
from __future__ import annotations

import json

import frappe

# get_boq_work_packages reads the WP grandchild rows of the CLONED BoQ (get_doc does not
# hydrate grandchildren); re-exported so callers/tests read cloned WP via this module.
from nirmaan_stack.api.boq.wizard.update_sheet_draft import get_boq_work_packages
# The list-valued JSON fields that MUST be json.dumps()'d before doc.insert() -- Frappe
# rejects a Python list on a JSON field ("Value for X cannot be a list"). Single source
# of truth in parse_run; the clone mirrors the parser's insert path (CLAUDE.md gotcha).
from nirmaan_stack.api.boq.wizard.parse_run import _LIST_JSON_FIELDS


# ---------------------------------------------------------------------------
# Authorization -- create-from-template is gated to the 5 wizard role profiles
# (ADR-0013 A1-D10). Read the profile off Nirmaan Users.role_profile (this app's
# Nirmaan Users doctype stores the full "... Profile" strings). The Administrator
# user is always allowed. UI gates are not enough -- these endpoints can be called
# directly.
# ---------------------------------------------------------------------------

_WIZARD_ROLE_PROFILES = frozenset({
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Estimates Executive Profile",
    "Nirmaan Project Lead Profile",
})


def _ensure_wizard_role() -> None:
    user = frappe.session.user
    if user == "Administrator":
        return
    role_profile = frappe.db.get_value("Nirmaan Users", user, "role_profile")
    if role_profile not in _WIZARD_ROLE_PROFILES:
        frappe.throw(
            "You are not permitted to create a BoQ from a template.",
            frappe.PermissionError,
        )


def _get_active_master():
    """Return the one ACTIVE master (is_active=1) as {name, template_name}, or None.

    There is exactly one master in MVP; if more than one is active (should not happen),
    the first by name is returned deterministically. Reads the flag off the doctype -- an
    admin flips is_active=0 to make risky structural edits, then re-activates (A1-D10).
    """
    rows = frappe.get_all(
        "BoQ Template",
        filters={"is_active": 1},
        fields=["name", "template_name"],
        order_by="name asc",
        limit=1,
    )
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Fallback status cache (mirrors upload_file._upload_status_key / get_upload_status)
# ---------------------------------------------------------------------------

_CLONE_STATUS_CACHE_PREFIX = "boq_clone_status"
_CLONE_STATUS_TTL_SEC = 3600  # 1 hour -- ample for a client to poll the fallback


def _clone_status_key(job_id):
    return f"{_CLONE_STATUS_CACHE_PREFIX}::{job_id}"


def _publish_and_record(payload, user):
    """Publish boq:template_clone_done (user-targeted) AND record the outcome in the
    cache keyed by the current RQ job id.

    The realtime event is room-targeted and is NOT replayed, so a client that was not
    connected/joined when this fires never hears it and hangs on "Building your BoQ".
    get_clone_status() reads this cache entry so the client can recover by polling. The
    cache write is best-effort -- it lives in Redis (independent of the DB transaction, so
    it survives a rollback) and must never fail the job. Mirrors upload_file exactly.
    """
    frappe.publish_realtime("boq:template_clone_done", payload, user=user)
    try:
        from rq import get_current_job  # noqa: PLC0415

        job = get_current_job()
        if job is not None:
            frappe.cache().set_value(
                _clone_status_key(job.id),
                payload,
                expires_in_sec=_CLONE_STATUS_TTL_SEC,
            )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Template-row clone -- fields read off each BoQ Template Row + copy rules (A1-D2/D3)
# ---------------------------------------------------------------------------

# Fields fetched from each BoQ Template Row. A template row is ALREADY pre-flattened
# (no human/AI/edit_log overlay -- that work happened at seed time), so the clone is a
# STRAIGHT structural copy: classification / parent_index / attached_to_index carry the
# effective (sentinel-bearing) values verbatim; no resolve_effective needed.
_TEMPLATE_ROW_READ_FIELDS = [
    "row_index",
    "source_row_number",
    "classification",
    "parent_index",
    "attached_to_index",
    "level",
    "path",
    "sl_no_value",
    "description",
    "unit",
    "make_model",
    "is_rate_only",
    "attached_notes",
    "row_notes",
    "append_notes_raw",
]


def _copy_template_row(tr: dict, new_boq: str, sheet_name: str) -> dict:
    """Build a NEW BoQ Review Row field-dict from a pre-flattened BoQ Template Row (A1-D2/D3).

    - classification / parent_index / attached_to_index / level / path / source_row_number /
      sl_no_value / description / unit / make_model / is_rate_only / attached_notes are copied
      VERBATIM -- the template row is already the effective, structure-only baseline.
    - parent_index keeps the -1 "no parent/root" sentinel; attached_to_index keeps the 0
      "not attached" sentinel (NEVER conflate the two -- 0 is a valid row_index).
    - qty/rate/amount are BLANK (left unset -> None).
    - is_excluded=0, is_synthetic=0, chosen_source="parser".
    - human_parent MUST be the -1 sentinel (NOT the Frappe Int default 0 -- 0 is a valid
      row index and resolve_effective treats human_parent >= 0 as a real override, which
      would falsely re-parent every clone row to row 0). human_is_root=0.
    """
    row = {
        "boq": new_boq,
        "sheet_name": sheet_name,  # VERBATIM (#152)
        # --- copied structural fields (already effective) ---
        "row_index": tr.get("row_index"),
        "classification": tr.get("classification"),
        "parent_index": tr.get("parent_index") if tr.get("parent_index") is not None else -1,
        "attached_to_index": tr.get("attached_to_index") if tr.get("attached_to_index") is not None else 0,
        "level": tr.get("level"),
        "path": tr.get("path") or "",
        "source_row_number": tr.get("source_row_number"),
        "sl_no_value": tr.get("sl_no_value"),
        "description": tr.get("description"),
        "unit": tr.get("unit"),
        "make_model": tr.get("make_model"),
        "is_rate_only": tr.get("is_rate_only") or 0,
        "row_notes": tr.get("row_notes"),
        # append_notes_raw is DICT-JSON -> assign as-is (NOT in _LIST_JSON_FIELDS, so the
        # json.dumps loop below leaves it alone; Frappe auto-serializes a dict on insert).
        "append_notes_raw": tr.get("append_notes_raw"),
        # --- clean parser baseline ---
        "is_excluded": 0,
        "is_synthetic": 0,
        "chosen_source": "parser",
        # human layer explicitly at the "no override" baseline (-1 sentinel, NOT 0)
        "human_parent": -1,
        "human_is_root": 0,
    }
    # attached_notes is a JSON list-field. frappe.get_all returns it PARSED (a Python list)
    # in v15; the per-row insert loop below json.dumps it (isinstance-guarded). Only carry
    # it when present so a null template value stays null on the clone.
    an = tr.get("attached_notes")
    if an is not None:
        row["attached_notes"] = an
    return row


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_master_template():
    """Return the ACTIVE master template + its sheets, driving the create-time sheet picker.

    Role-gated to the 5 wizard profiles + Administrator. With exactly one master there is NO
    template-selection step -- the picker only chooses the sheet subset.

    Returns:
      {"active": False}                              -- no active master configured
      {
        "active": True,
        "name": "<BoQ Template docname>",
        "template_name": "<display name>",
        "sheets": [
          {"sheet_name": "<verbatim>", "sheet_order": <int>,
           "sheet_label": "<str>", "disposition": "data" | "general_specs"},
          ...
        ],
      }
    """
    _ensure_wizard_role()

    master = _get_active_master()
    if not master:
        return {"active": False}

    sheets = frappe.get_all(
        "BoQ Template Sheet",
        filters={"parent": master.name, "parenttype": "BoQ Template"},
        fields=["sheet_name", "sheet_order", "sheet_label", "disposition"],
        order_by="sheet_order asc",
    )
    return {
        "active": True,
        "name": master.name,
        "template_name": master.template_name,
        "sheets": [
            {
                "sheet_name": s.sheet_name,  # VERBATIM (#152)
                "sheet_order": s.sheet_order,
                "sheet_label": s.sheet_label,
                "disposition": s.disposition,
            }
            for s in sheets
        ],
    }


@frappe.whitelist(methods=["POST"])
def create_from_template(project=None, boq_name=None, sheet_names=None):
    """Create a fresh project BOQs from the active master template, then enqueue the clone worker.

    There is ONE master, so there is NO `template_boq` argument -- this resolves the active
    master itself. Validates that an active master exists, the project exists, and that
    sheet_names is a NON-EMPTY de-duplicated subset of the master's sheet names. Creates the
    BOQs shell (origin="template", source_template=<master>, project-bound,
    wizard_state="Parsed", no source_file_url, is_template_source=0; version auto-computed by
    BOQs.before_insert), commits it so the (async, possibly cross-process) worker can read it,
    then enqueues _clone_worker.

    Returns {"job_id": <RQ id>, "boq_id": <new BOQs docname>}.
    """
    _ensure_wizard_role()

    if not project:
        frappe.throw("project is required.", title="Missing field: project")

    # --- Resolve the active master (one master; no selection step) ---
    master = _get_active_master()
    if not master:
        frappe.throw(
            "No active master template is configured.", title="No active template"
        )

    # --- Validate project ---
    if not frappe.db.exists("Projects", project):
        frappe.throw(f"Project '{project}' not found.", title="Not found")

    # --- Normalize + validate sheet_names (non-empty subset of the master's sheets) ---
    if isinstance(sheet_names, str):
        try:
            sheet_names = json.loads(sheet_names)
        except (ValueError, TypeError):
            frappe.throw(
                "sheet_names must be a JSON array string or a list.", title="Invalid JSON"
            )
    if not isinstance(sheet_names, list) or not sheet_names:
        frappe.throw(
            "sheet_names must be a non-empty list of template sheet names.",
            title="Missing field: sheet_names",
        )
    # De-duplicate (order-preserving): a repeated sheet name would otherwise clone that
    # sheet's draft + WP + every review row twice, corrupting the BoQ.
    sheet_names = list(dict.fromkeys(sheet_names))

    template_sheet_names = {
        s.sheet_name
        for s in frappe.get_all(
            "BoQ Template Sheet",
            filters={"parent": master.name, "parenttype": "BoQ Template"},
            fields=["sheet_name"],
        )
    }
    # sheet_name matched VERBATIM (#152) -- never .trim() for identity.
    unknown = [sn for sn in sheet_names if sn not in template_sheet_names]
    if unknown:
        frappe.throw(
            f"Sheet(s) {unknown} are not part of the master template.",
            title="Unknown sheet",
        )

    # --- boq_name default: {project_name}_BOQ when blank (A1-D10) ---
    if not boq_name:
        project_name = frappe.db.get_value("Projects", project, "project_name")
        boq_name = f"{project_name}_BOQ"

    # --- Create the BOQs shell (version auto by before_insert; read_only fields set
    #     programmatically, which is legal on the backend) ---
    new_boq_doc = frappe.new_doc("BOQs")
    new_boq_doc.project = project
    new_boq_doc.boq_name = boq_name
    new_boq_doc.origin = "template"
    new_boq_doc.is_template_source = 0
    new_boq_doc.source_template = master.name
    new_boq_doc.source_file_url = None  # a template clone has no source workbook (A1-D2)
    new_boq_doc.wizard_state = "Parsed"
    new_boq_doc.insert(ignore_permissions=True)

    # Commit the shell BEFORE enqueue so the (async, possibly cross-process) worker can
    # read the new BOQs row. CLAUDE.md: commit after DML in a whitelisted method.
    frappe.db.commit()

    job = frappe.enqueue(
        "nirmaan_stack.api.boq.wizard.create_from_template._clone_worker",
        queue="long",
        timeout=1200,
        new_boq=new_boq_doc.name,
        template=master.name,
        sheet_names=sheet_names,
        user=frappe.session.user,
    )

    return {"job_id": job.id if job else None, "boq_id": new_boq_doc.name}


@frappe.whitelist()
def get_clone_status(job_id=None):
    """Polling fallback for a template-clone outcome, keyed by RQ job id.

    The create flow normally learns the result via the realtime boq:template_clone_done
    event, but that event is room-targeted and not replayed -- a client that missed it
    would otherwise hang on "Building your BoQ". The worker records its terminal outcome
    via _publish_and_record(); this returns it. Mirrors upload_file.get_upload_status.

    Shapes (mirror the realtime payload so the client reuses one handler):
      {"state": "pending"}                                          -- still running / unknown
      {"state": "done", "status": "success", "boq_name": "<name>"}  -- cloned
      {"state": "done", "status": "error", "error_code": "<code>"}  -- failed
    """
    if not job_id:
        frappe.throw("job_id is required.", title="Missing field: job_id")

    cached = frappe.cache().get_value(_clone_status_key(job_id))
    if not cached:
        return {"state": "pending"}

    return {"state": "done", **cached}


# ---------------------------------------------------------------------------
# Clone worker (async, queue="long")
# ---------------------------------------------------------------------------

def _reset_clone_target(new_boq: str) -> None:
    """Idempotency guard: clear any sheets/rows a prior (double-fired) run left on new_boq.

    Delete the WP grandchildren FIRST (they reference sheet-draft child names), then the
    sheet drafts, general-specs child rows, and every BoQ Review Row for this BoQ. Mirrors
    parse_run's delete-before-insert re-parse safety so a re-enqueued clone never duplicates.
    No commit -- the worker owns the single trailing commit.
    """
    draft_names = [
        d.name
        for d in frappe.get_all(
            "BoQ Sheet Draft",
            filters={"parent": new_boq, "parenttype": "BOQs"},
            fields=["name"],
        )
    ]
    if draft_names:
        frappe.db.delete(
            "BoQ Sheet Work Package",
            {"parent": ("in", draft_names), "parenttype": "BoQ Sheet Draft"},
        )
    frappe.db.delete("BoQ Sheet Draft", {"parent": new_boq, "parenttype": "BOQs"})
    frappe.db.delete("BoQ General Specs Sheet", {"parent": new_boq, "parenttype": "BOQs"})
    frappe.db.delete("BoQ Review Row", {"boq": new_boq})


def _sheet_work_packages(tmpl_sheet) -> list:
    """The template sheet's work_packages JSON list, defensively normalized to a list[str].

    get_doc hydrates a JSON field to a Python object (usually a list); a raw JSON string is
    tolerated (read-path dependent). A dict / None / bad JSON yields []. work_packages is a
    JSON field on the template sheet precisely to dodge the WP grandchild-serialization wall.
    """
    wh_list = tmpl_sheet.work_packages
    if isinstance(wh_list, str):
        try:
            wh_list = json.loads(wh_list) if wh_list else []
        except (ValueError, TypeError):
            wh_list = []
    if not isinstance(wh_list, list):
        return []
    return [wh for wh in wh_list if wh]


def _clone_worker(new_boq, template, sheet_names, user):
    """Async worker: clone the selected master sheets into new_boq at the Parsed baseline.

    Per selected master sheet (VERBATIM #152, ordered by sheet_order): (a) create a
    BoQ Sheet Draft at wizard_status="Parsed" from the BoQ Template Sheet + re-create its WP
    grandchild rows from the sheet's work_packages JSON list; (b) if disposition="general_specs"
    carry the general_specs_sheets membership; (c) STRAIGHT-copy every BoQ Template Row for that
    sheet into a BoQ Review Row (pre-flattened -> structure-only, is_excluded=0). Commit BEFORE
    publish (CLAUDE.md rule). On exception: rollback, then cache+publish the error.
    """
    frappe.set_user(user)
    try:
        tmpl_doc = frappe.get_doc("BoQ Template", template)
        tmpl_sheets_by_name = {s.sheet_name: s for s in tmpl_doc.sheets}

        # Guard a mid-flight master edit: create_from_template validated sheet_names against
        # the master synchronously, but this worker runs later in a separate process. If an
        # admin removed/renamed a requested sheet in between, fail LOUDLY (template_changed)
        # rather than silently clone a subset and report success. No DML has run yet.
        missing = [sn for sn in dict.fromkeys(sheet_names) if sn not in tmpl_sheets_by_name]
        if missing:
            _publish_and_record(
                {"boq_name": new_boq, "status": "error", "error_code": "template_changed"},
                user,
            )
            return

        # Selected sheets (VERBATIM), ordered by the template's sheet_order.
        selected = [sn for sn in sheet_names if sn in tmpl_sheets_by_name]
        selected.sort(key=lambda sn: tmpl_sheets_by_name[sn].sheet_order or 0)
        now = frappe.utils.now()

        # Idempotency: wipe anything a prior double-fire left behind, then reload a clean doc.
        # clear_document_cache is load-bearing when the worker re-runs in the SAME process
        # (a re-enqueued job or a test double-fire): the SQL child-deletes in _reset_clone_target
        # do not evict a parent doc already in Frappe's document cache, so a stale get_doc would
        # still carry the just-deleted sheet_drafts and duplicate them on save.
        _reset_clone_target(new_boq)
        frappe.clear_document_cache("BOQs", new_boq)
        new_doc = frappe.get_doc("BOQs", new_boq)

        # (a) Clone the sheet drafts (config + order + label) at wizard_status="Parsed".
        # WP is carried EXCLUSIVELY via the grandchild re-append below (there is no scalar
        # work_package field). sheet_config is a dict-JSON; normalize a hydrated dict back to a
        # JSON string for the child assign (matches set_sheet_config).
        for sheet_name in selected:
            tmpl_sheet = tmpl_sheets_by_name[sheet_name]
            sheet_config = tmpl_sheet.sheet_config
            if isinstance(sheet_config, (dict, list)):
                sheet_config = json.dumps(sheet_config)
            new_doc.append(
                "sheet_drafts",
                {
                    "sheet_name": sheet_name,  # VERBATIM (#152)
                    "sheet_order": tmpl_sheet.sheet_order,
                    "wizard_status": "Parsed",
                    "sheet_label": tmpl_sheet.sheet_label,
                    "sheet_config": sheet_config,
                    "has_prior_parse": 1,
                    "last_parsed_at": now,
                },
            )

        # (b) Carry general_specs membership for the selected general_specs sheets.
        for sheet_name in selected:
            tmpl_sheet = tmpl_sheets_by_name[sheet_name]
            if tmpl_sheet.disposition == "general_specs":
                new_doc.append(
                    "general_specs_sheets",
                    {
                        "source_sheet_name": sheet_name,  # VERBATIM (#152)
                        "preamble_text": tmpl_sheet.preamble_text,
                    },
                )

        # Save to materialize the sheet-draft child rows (assigns their names) so the WP
        # grandchildren below can point at them.
        new_doc.save(ignore_permissions=True)

        # (a-cont.) Re-append the work_packages grandchild rows onto the new sheet drafts,
        # sourced from the template sheet's work_packages JSON list.
        new_drafts_by_name = {d.sheet_name: d for d in new_doc.sheet_drafts}
        for sheet_name in selected:
            new_draft = new_drafts_by_name.get(sheet_name)
            if not new_draft:
                continue
            for wh in _sheet_work_packages(tmpl_sheets_by_name[sheet_name]):
                pkg = frappe.new_doc("BoQ Sheet Work Package")
                pkg.parent = new_draft.name
                pkg.parenttype = "BoQ Sheet Draft"
                pkg.parentfield = "work_packages"
                pkg.work_header = wh
                pkg.insert(ignore_permissions=True)

        # (c) Copy the template rows, per sheet, ordered by row_index. Per-row insert mirrors
        # parse_run's proven review-row write path: it guarantees autoname, all field defaults,
        # and JSON handling. row_index is preserved verbatim, so effective_parent_index (a
        # template row_index) remains a valid pointer in the clone's row_index space.
        for sheet_name in selected:
            tmpl_rows = frappe.get_all(
                "BoQ Template Row",
                filters={"template": template, "sheet_name": sheet_name},
                fields=_TEMPLATE_ROW_READ_FIELDS,
                order_by="row_index asc",  # never order_by `order` (PG reserved)
            )
            for tr in tmpl_rows:
                row_dict = _copy_template_row(tr, new_boq, sheet_name)
                # Pre-serialize list-valued JSON fields (attached_notes etc.) exactly like
                # the parser insert -- frappe.get_all returns JSON columns PARSED (as lists)
                # in v15, and doc.insert() rejects a raw list on a JSON field. isinstance-
                # guarded so an already-stringified value is not double-encoded.
                for field in _LIST_JSON_FIELDS:
                    val = row_dict.get(field)
                    if isinstance(val, (list, dict)):
                        row_dict[field] = json.dumps(val)
                doc = frappe.new_doc("BoQ Review Row")
                doc.update(row_dict)
                doc.insert(ignore_permissions=True)

        # Commit BEFORE publish (CLAUDE.md: commit-before-publish avoids race conditions).
        frappe.db.commit()
        _publish_and_record({"boq_name": new_boq, "status": "success"}, user)

    except Exception:
        try:
            frappe.db.rollback()
        except Exception:
            pass
        frappe.log_error(
            title=f"BoQ template clone worker: unhandled error for {new_boq}",
            message=frappe.get_traceback(),
        )
        _publish_and_record(
            {"boq_name": new_boq, "status": "error", "error_code": "internal"}, user
        )
        raise
