"""
BoQ "Create from Template" -- clone worker + create/list endpoints + socket (T2, ADR-0013).

A template is a project-less BOQs doc with is_template=1 (D1). This module clones a
*Published* template into a fresh project BOQs at wizard_state="Parsed" so the user lands
directly on the review-and-select screen (no Configure/Parse -- a template has no source
workbook). The clone flattens the template's EFFECTIVE classification/parent into the base
parser fields and drops the human/AI overlay, edit_log, warnings, and quantities/rates
(D2/D3) -- a clean parser baseline the user prunes (is_excluded) and prices later.

Public API:
  list_templates()                                                  [GET-capable]
  create_from_template(template_boq, project, boq_name, sheet_names) [POST] -> {job_id, boq_id}
  get_clone_status(job_id)                                          [GET-capable]

Long-job scaffolding (socket + poll fallback) MIRRORS upload_file.py exactly -- the realtime
boq:template_clone_done event is room-targeted + not replayed, so the worker also records its
terminal outcome in a Redis cache keyed by RQ job id for get_clone_status() to poll.
"""
from __future__ import annotations

import json

import frappe
from frappe import _

from nirmaan_stack.api.boq.wizard.review_screen import resolve_effective
from nirmaan_stack.api.boq.wizard.update_sheet_draft import get_boq_work_packages
# The list-valued JSON fields that MUST be json.dumps()'d before doc.insert() -- Frappe
# rejects a Python list on a JSON field ("Value for X cannot be a list"). Single source
# of truth in parse_run; the clone mirrors the parser's insert path (CLAUDE.md gotcha).
from nirmaan_stack.api.boq.wizard.parse_run import _LIST_JSON_FIELDS


# ---------------------------------------------------------------------------
# Authorization -- create-from-template is gated to the 5 wizard role profiles
# (ADR-0013 D10). Read the profile off Nirmaan Users.role_profile (this app's
# Nirmaan Users doctype stores the full "... Profile" strings; mirrors
# sidebar_counts.py / draft_lock._is_admin). The Administrator user is always
# allowed. UI gates are not enough -- these endpoints can be called directly.
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
# Review-row clone -- fields read off each template row + flatten rules (D2/D3)
# ---------------------------------------------------------------------------

# Fields fetched from each template BoQ Review Row. Includes the resolve_effective
# inputs (so the human/AI overlay is folded into the effective value) PLUS the
# structural fields copied verbatim onto the clone. frappe.get_all returns JSON
# fields (attached_notes) as RAW STRINGS, which is exactly what the clone insert
# needs (a JSON string is accepted for a JSON field; a Python list is not).
_TEMPLATE_ROW_READ_FIELDS = [
    "name",
    "row_index",
    "source_row_number",
    # resolve_effective inputs (human > AI-accepted > parser)
    "classification",
    "human_classification",
    "parent_index",
    "human_parent",
    "human_is_root",
    "ai_suggestion_status",
    "ai_suggested_classification",
    "ai_suggested_parent",
    "ai_suggested_is_root",
    # structural fields copied verbatim
    "sl_no_value",
    "description",
    "unit",
    "make_model",
    "is_rate_only",
    "path",
    "level",
    "attached_to_index",
    "attached_notes",
]


def _flatten_template_row(tr: dict, new_boq: str, sheet_name: str) -> dict:
    """Build a NEW BoQ Review Row field-dict from a template row (D2/D3).

    - classification / parent_index come from the EFFECTIVE value (human/AI overlay folded
      in via resolve_effective); parent_index keeps the -1 "no parent" sentinel.
    - source_row_number / row_index / sl_no_value / description / unit / make_model /
      is_rate_only / path / level / attached_to_index / attached_notes are copied verbatim.
    - qty/rate/amount are BLANK (left unset -> None).
    - is_excluded=0, is_synthetic=0, chosen_source="parser".
    - The whole human/AI/gemini/edit_log/warnings/dismissal overlay is DROPPED. human_parent
      MUST be the -1 sentinel (NOT the Frappe Int default 0 -- 0 is a valid row index and
      resolve_effective treats human_parent >= 0 as a real override, which would falsely
      re-parent every clone row to row 0; identical rationale to flatten_resolved_row).
    """
    eff = resolve_effective(tr)
    epi = eff["effective_parent_index"]
    row = {
        "boq": new_boq,
        "sheet_name": sheet_name,  # VERBATIM (#152)
        "classification": eff["effective_classification"],
        "parent_index": epi if epi is not None else -1,
        # --- copied structural fields ---
        "source_row_number": tr.get("source_row_number"),
        "row_index": tr.get("row_index"),
        "sl_no_value": tr.get("sl_no_value"),
        "description": tr.get("description"),
        "unit": tr.get("unit"),
        "make_model": tr.get("make_model"),
        "is_rate_only": tr.get("is_rate_only") or 0,
        "path": tr.get("path") or "",
        "level": tr.get("level"),
        "attached_to_index": tr.get("attached_to_index"),
        # --- clean parser baseline ---
        "is_excluded": 0,
        "is_synthetic": 0,
        "chosen_source": "parser",
        # human layer explicitly at the "no override" baseline (-1 sentinel, NOT 0)
        "human_parent": -1,
        "human_is_root": 0,
    }
    # attached_notes is a JSON list-field. get_all returns it as a raw JSON STRING
    # (never a Python list), which the insert accepts as-is. Only carry it when present.
    an = tr.get("attached_notes")
    if an is not None:
        row["attached_notes"] = an
    return row


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist()
def list_templates():
    """List Published BoQ templates for the Create-from-Template picker (Wave-3 contract).

    Returns (role-gated to the 5 wizard profiles + Administrator):
      [
        {
          "name": "<BOQs docname>",
          "boq_name": "<display name>",
          "sheets": [
            {"sheet_name": "<verbatim>", "sheet_order": <int>, "work_packages": ["WH-...", ...]},
            ...
          ],
        },
        ...
      ]

    Only BOQs with is_template=1 AND template_status='Published' are returned. All of a
    template's sheet drafts are listed (ordered by sheet_order) -- the picker chooses the
    subset to clone. work_packages come from the grandchild read path (get_boq_work_packages);
    a sheet with no assigned packages yields [].
    """
    _ensure_wizard_role()

    templates = frappe.get_all(
        "BOQs",
        filters={"is_template": 1, "template_status": "Published"},
        fields=["name", "boq_name"],
        order_by="boq_name asc",
    )

    result = []
    for tmpl in templates:
        drafts = frappe.get_all(
            "BoQ Sheet Draft",
            filters={"parent": tmpl.name, "parenttype": "BOQs"},
            fields=["sheet_name", "sheet_order"],
            order_by="sheet_order asc",
        )
        # {sheet_name: [work_header, ...]} -- sheets with no WP omitted; default to [].
        wp_by_sheet = get_boq_work_packages(tmpl.name)
        sheets = [
            {
                "sheet_name": d.sheet_name,  # VERBATIM (#152)
                "sheet_order": d.sheet_order,
                "work_packages": wp_by_sheet.get(d.sheet_name, []),
            }
            for d in drafts
        ]
        result.append(
            {"name": tmpl.name, "boq_name": tmpl.boq_name, "sheets": sheets}
        )
    return result


@frappe.whitelist(methods=["POST"])
def create_from_template(template_boq=None, project=None, boq_name=None, sheet_names=None):
    """Create a fresh project BOQs from a Published template, then enqueue the clone worker.

    Validates the template (exists + is_template=1 + Published), the project (exists), and
    that sheet_names is a NON-EMPTY subset of the template's sheet-draft sheet names. Creates
    the BOQs shell (origin="template", source_template, project-bound, wizard_state="Parsed",
    tax_treatment copied from the template; version auto-computed by BOQs.before_insert),
    commits it so the (async, possibly cross-process) worker can read it, then enqueues
    _clone_worker.

    Returns {"job_id": <RQ id>, "boq_id": <new BOQs docname>}.
    """
    _ensure_wizard_role()

    if not template_boq:
        frappe.throw("template_boq is required.", title="Missing field: template_boq")
    if not project:
        frappe.throw("project is required.", title="Missing field: project")

    # --- Validate template: exists + is a template + Published ---
    tmpl = frappe.db.get_value(
        "BOQs",
        template_boq,
        ["name", "is_template", "template_status", "tax_treatment"],
        as_dict=True,
    )
    if not tmpl:
        frappe.throw(f"Template '{template_boq}' not found.", title="Not found")
    if not tmpl.is_template:
        frappe.throw(
            f"BOQs '{template_boq}' is not a template.", title="Not a template"
        )
    if tmpl.template_status != "Published":
        frappe.throw(
            f"Template '{template_boq}' is not Published (status: {tmpl.template_status or 'Draft'}).",
            title="Template not Published",
        )

    # --- Validate project ---
    if not frappe.db.exists("Projects", project):
        frappe.throw(f"Project '{project}' not found.", title="Not found")

    # --- Normalize + validate sheet_names (non-empty subset of the template's sheets) ---
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
    # sheet's drafts + WP + every review row twice, corrupting the BoQ (verify finding).
    sheet_names = list(dict.fromkeys(sheet_names))

    template_sheet_names = {
        d.sheet_name
        for d in frappe.get_all(
            "BoQ Sheet Draft",
            filters={"parent": template_boq, "parenttype": "BOQs"},
            fields=["sheet_name"],
        )
    }
    # sheet_name matched VERBATIM (#152) -- never .trim() for identity.
    unknown = [sn for sn in sheet_names if sn not in template_sheet_names]
    if unknown:
        frappe.throw(
            f"Sheet(s) {unknown} are not part of template '{template_boq}'.",
            title="Unknown sheet",
        )

    # --- boq_name default: {project_name}_BOQ when blank (D10) ---
    if not boq_name:
        project_name = frappe.db.get_value("Projects", project, "project_name")
        boq_name = f"{project_name}_BOQ"

    # --- Create the BOQs shell (version auto by before_insert; read_only fields set
    #     programmatically, which is legal on the backend) ---
    new_boq_doc = frappe.new_doc("BOQs")
    new_boq_doc.project = project
    new_boq_doc.boq_name = boq_name
    new_boq_doc.origin = "template"
    new_boq_doc.is_template = 0
    new_boq_doc.source_template = template_boq
    new_boq_doc.tax_treatment = tmpl.tax_treatment or "Pre-tax"
    new_boq_doc.source_file_url = None  # a template clone has no source workbook (D2)
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
        template_boq=template_boq,
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


def _clone_worker(new_boq, template_boq, sheet_names, user):
    """Async worker: deep-clone the selected template sheets into new_boq at Parsed baseline.

    Per selected sheet (VERBATIM #152): (a) clone the BoQ Sheet Draft at wizard_status=Parsed
    + its work_packages grandchild rows; (b) flatten+strip every template BoQ Review Row into
    a clean parser baseline; (c) carry the matching general_specs_sheets membership. Commit
    BEFORE publish (CLAUDE.md rule). On exception: rollback, then cache+publish the error.
    """
    frappe.set_user(user)
    try:
        template_doc = frappe.get_doc("BOQs", template_boq)
        # Lookup template sheet drafts by sheet_name (VERBATIM). {sheet_name: draft child doc}
        tmpl_drafts_by_name = {d.sheet_name: d for d in template_doc.sheet_drafts}
        # Grandchild WP read path (get_doc does NOT hydrate grandchildren): {sheet_name: [wh]}
        template_wps = get_boq_work_packages(template_boq)

        selected = list(sheet_names)
        selected_set = set(selected)
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
        # NOTE: the singular `work_package` field was retired from BoQ Sheet Draft in favor
        # of the `work_packages` child table, so WP is carried EXCLUSIVELY via the grandchild
        # re-append below -- there is no scalar work_package field to copy.
        for sheet_name in selected:
            tmpl_draft = tmpl_drafts_by_name.get(sheet_name)
            if tmpl_draft is None:
                continue  # validated in the endpoint; defensive
            sheet_config = tmpl_draft.sheet_config
            # sheet_config is stored as a JSON string; get_doc may hydrate it to a dict.
            # Normalize back to a JSON string for the child assign (matches set_sheet_config).
            if isinstance(sheet_config, (dict, list)):
                sheet_config = json.dumps(sheet_config)
            new_doc.append(
                "sheet_drafts",
                {
                    "sheet_name": sheet_name,  # VERBATIM (#152)
                    "sheet_order": tmpl_draft.sheet_order,
                    "wizard_status": "Parsed",
                    "sheet_label": tmpl_draft.sheet_label,
                    "sheet_config": sheet_config,
                    "has_prior_parse": 1,
                    "last_parsed_at": now,
                },
            )

        # (c) Carry general_specs membership for the selected sheets.
        for gs in template_doc.general_specs_sheets:
            if gs.source_sheet_name in selected_set:
                new_doc.append(
                    "general_specs_sheets",
                    {
                        "source_sheet_name": gs.source_sheet_name,
                        "preamble_text": gs.preamble_text,
                    },
                )

        # Save to materialize the sheet-draft child rows (assigns their names) so the WP
        # grandchildren below can point at them.
        new_doc.save(ignore_permissions=True)

        # (a-cont.) Re-append the work_packages grandchild rows onto the new sheet drafts.
        new_drafts_by_name = {d.sheet_name: d for d in new_doc.sheet_drafts}
        for sheet_name in selected:
            new_draft = new_drafts_by_name.get(sheet_name)
            if not new_draft:
                continue
            for wh in template_wps.get(sheet_name, []):
                pkg = frappe.new_doc("BoQ Sheet Work Package")
                pkg.parent = new_draft.name
                pkg.parenttype = "BoQ Sheet Draft"
                pkg.parentfield = "work_packages"
                pkg.work_header = wh
                pkg.insert(ignore_permissions=True)

        # (b) Flatten + strip the review rows, per sheet, ordered by row_index.
        # Per-row insert mirrors parse_run's proven review-row write path (correctness
        # first, per the task): it guarantees autoname (BOQRR-.YY.-.#####), all field
        # defaults, and JSON handling at the same ~1700-rows/sheet scale the parse worker
        # already sustains. row_index is preserved verbatim, so effective_parent_index
        # (a template row_index) remains a valid pointer in the clone's row_index space.
        for sheet_name in selected:
            tmpl_rows = frappe.get_all(
                "BoQ Review Row",
                filters={"boq": template_boq, "sheet_name": sheet_name},
                fields=_TEMPLATE_ROW_READ_FIELDS,
                order_by="row_index asc",  # never order_by `order` (PG reserved)
            )
            for tr in tmpl_rows:
                row_dict = _flatten_template_row(tr, new_boq, sheet_name)
                # Pre-serialize list-valued JSON fields (attached_notes etc.) exactly like
                # the parser insert (parse_run:842) -- frappe.get_all returns JSON columns
                # PARSED (as lists) in v15, and doc.insert() rejects a raw list on a JSON
                # field. isinstance-guarded so an already-stringified value is not double-encoded.
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
