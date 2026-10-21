import json
import frappe
from frappe import _

from nirmaan_stack.services.role_profiles import is_nirmaan_admin


def next_boq_version(project, boq_name, is_template_source=False, exclude=None):
    """The next `version` for a BoQ in its naming scope: COALESCE(MAX(version), 0) + 1.

    THE one owner of the version rule (M1.25). `before_insert` calls it, and so does
    `api/boq/wizard/revision.convert_revision_entry` -- which must recompute the version after
    the fact, because converting a just-uploaded BoQ between New and Revise CHANGES its
    `boq_name` (a revision reuses the original's name) and therefore its scope, long after
    `before_insert` has run against the old one. They MUST NOT drift, so there is exactly one
    query. Do not re-inline it.

    Scope: `(project, boq_name)` normally; `(is_template_source=1, boq_name)` for the
    project-less template seeds (ADR-0013 A1).

    `exclude` is a BOQs docname to leave out of the MAX. It exists for the recompute case: the
    converting doc already EXISTS and already holds a version, so counting itself would make
    every conversion bump the number by one forever. On insert there is no docname yet, so the
    caller passes nothing and the behaviour is unchanged.
    """
    if is_template_source:
        # Version-scope template-source BoQs by boq_name across the project-less namespace.
        where = 'is_template_source = 1 AND boq_name = %s'
        params = [boq_name]
    else:
        where = 'project = %s AND boq_name = %s'
        params = [project, boq_name]
    if exclude:
        where += ' AND name != %s'
        params.append(exclude)

    result = frappe.db.sql(
        f'SELECT COALESCE(MAX(version), 0) + 1 FROM "tabBOQs" WHERE {where}',
        tuple(params),
    )
    return result[0][0] if result else 1


def is_won_project(project):
    """True when `project` is Won as a bid (`tendering_status`, permanent; ADR-0001 v3).

    Not the execution `status`, which moves on from Won to WIP and beyond: a project at WIP or
    Completed is still a Won project here (ADR-0037).
    """
    return bool(project) and frappe.db.get_value("Projects", project, "tendering_status") == "Won"


def assert_can_add_boq(project, user=None):
    """Once a project is Won, only an Admin may add a BoQ to it (owner ruling 2026-09-18).

    THE one owner of the rule. The upload and create-from-template endpoints call it first so
    the user gets the refusal at once, not as a failed background job; `before_insert` calls it
    again as the backstop for every other path (Desk, REST). A project-less template seed and a
    pre-Won project are never restricted here.
    """
    if not is_won_project(project) or is_nirmaan_admin(user or frappe.session.user):
        return
    frappe.throw(_("Only an Admin can add a BoQ to a Won project."), frappe.PermissionError)


def before_insert(doc, method):
    # Template-source BoQs (Create-from-Template, ADR-0013 A1) are project-less: a
    # scratch authoring BoQ used to seed the master BoQ Template, not bound to any
    # Projects row. Only real (upload/clone) BoQs require a project -- the upload path
    # is byte-identical.
    if not doc.get("is_template_source") and not doc.project:
        frappe.throw(_("Project is required"))
    if not doc.boq_name:
        frappe.throw(_("BoQ Name is required"))
    assert_can_add_boq(doc.project)

    doc.version = next_boq_version(
        doc.project, doc.boq_name, is_template_source=bool(doc.get("is_template_source"))
    )

    # A BoQ an Admin adds to a Won project is part of its live scope at once (ADR-0037 D3):
    # a new upload, a revision and a create-from-template alike.
    doc.status = "Selected" if is_won_project(doc.project) else "Draft"
    doc.uploaded_by = frappe.session.user
    doc.uploaded_at = frappe.utils.now()


def _set_boq_status(name, status):
    """Save one BoQ with a new status. Through `doc.save()`, not `set_value`, so validate() runs
    and -- BOQs has `track_changes` -- the change leaves a Version row naming who made it. Link
    re-validation is skipped: only `status` changes, and a stale link elsewhere on the BoQ (a
    removed uploader, a deleted template) must not block it.
    """
    doc = frappe.get_doc("BOQs", name)
    doc.status = status
    doc.flags.ignore_links = True
    doc.save(ignore_permissions=True)


def select_project_boqs(project, selected_boqs):
    """Record which BoQs a Tendering project was won on (Convert to Won, ADR-0037 D2).

    THE one owner of the rule: every BoQ in `selected_boqs` -> Selected. Every other BoQ of the
    project stays as it is (Draft). A project with no BoQ needs no selection; one with any BoQ
    that is not Superseded must name at least one of them.

    Called by `api/projects/tendering.convert_tendering_to_won` INSIDE its transaction and does
    not commit, so the statuses land or roll back together with the conversion. Every pick is
    checked before anything is written.
    """
    if isinstance(selected_boqs, str):
        selected_boqs = [selected_boqs]
    selected = list(dict.fromkeys(name for name in (selected_boqs or []) if name))

    if not selected:
        if frappe.db.exists("BOQs", {"project": project, "status": ["!=", "Superseded"]}):
            frappe.throw(_("Select at least one BoQ this project was won on."))
        return {"selected": []}

    statuses = {}
    for name in selected:
        boq = frappe.db.get_value("BOQs", name, ["project", "status"], as_dict=True, for_update=True)
        if not boq:
            frappe.throw(_("BoQ '{0}' does not exist.").format(name))
        if boq.project != project:
            frappe.throw(_("BoQ '{0}' does not belong to project '{1}'.").format(name, project))
        if boq.status == "Superseded":
            frappe.throw(_("BoQ '{0}' is Superseded and cannot be selected.").format(name))
        statuses[name] = boq.status

    for name in selected:
        if statuses[name] != "Selected":
            _set_boq_status(name, "Selected")

    return {"selected": selected}


# Each Admin action, keyed by the status it moves a BoQ TO, with the one status it moves it FROM.
_SELECTION_MOVES = {"Selected": "Draft", "Draft": "Selected"}


def change_boq_selection(project, boq_names, to_status):
    """Move a Won project's BoQs between Selected and Draft -- the Admin's "Mark as Selected"
    (Draft -> Selected) and "Move to Draft" (Selected -> Draft), ADR-0037 D4/D7.

    THE one owner of the rule; `api/projects/boq_selection.set_boq_selection` is its thin endpoint. Only an
    Admin, only on a Won project, and only from the status the move expects: a BoQ found in any
    other status (already moved by someone else, or Approved / Superseded) is refused by name.
    Every BoQ is read under a row lock and checked before any is written, so the whole batch moves
    or none of it does. Moving the last Selected BoQ to Draft is allowed (the screen warns).
    Does not commit.
    """
    from_status = _SELECTION_MOVES.get(to_status)
    if not from_status:
        frappe.throw(_("Unknown BoQ status '{0}'.").format(to_status))
    if not is_nirmaan_admin(frappe.session.user):
        frappe.throw(_("Only an Admin can change which BoQs are Selected."), frappe.PermissionError)
    if not is_won_project(project):
        frappe.throw(_("Project '{0}' is not Won.").format(project))

    if isinstance(boq_names, str):
        boq_names = [boq_names]
    names = list(dict.fromkeys(name for name in (boq_names or []) if name))
    if not names:
        frappe.throw(_("Choose at least one BoQ."))

    for name in names:
        boq = frappe.db.get_value(
            "BOQs", name, ["project", "status"], as_dict=True, for_update=True
        )
        if not boq:
            frappe.throw(_("BoQ '{0}' does not exist.").format(name))
        if boq.project != project:
            frappe.throw(_("BoQ '{0}' does not belong to project '{1}'.").format(name, project))
        if boq.status != from_status:
            frappe.throw(
                _("BoQ '{0}' is {1}, not {2}; refresh the page and try again.").format(
                    name, boq.status or "blank", from_status
                )
            )

    for name in names:
        _set_boq_status(name, to_status)

    return {"status": to_status, "boqs": names}


def validate(doc, method):
    _validate_area_dimensions(doc)

    old_doc = doc.get_doc_before_save()
    if old_doc is None:
        return

    if old_doc.status != "Superseded" and doc.status == "Superseded":
        frappe.throw(_(
            "Status cannot be manually set to Superseded. "
            "This transitions automatically when a new version is uploaded."
        ))

    if old_doc.status == "Superseded" and doc.status != "Superseded":
        frappe.throw(_("A Superseded BoQ cannot be reopened."))

    if old_doc.status == "Approved" and doc.status == "Draft":
        frappe.throw(_("An Approved BoQ cannot go back to Draft."))


def after_delete(doc, method):
    """The BoQ delete cascade (CU-A AC2, owner ruling 2026-10-18 "children only").

    Frappe deletes a BoQ's own child rows (sheet drafts, general specs) but nothing below them, and
    nothing of the documents that LINK the BoQ. This removes the rows that would otherwise be left
    with no parent:
      * always: the drafts' `BoQ Sheet Work Package` grandchildren;
      * when the delete was FORCED past linked documents: each linked BoQ Sheet's work packages and
        each linked BoQ Committed Sheet Grid's rows.
    It NEVER deletes the BoQ Sheet / Grid / Review Row / BOQ Nodes documents themselves: a forced
    delete still leaves those (and every other `boq` link) behind, for services/orphans.report() to count.

    ⚠️ `after_delete`, NOT `on_trash`: `delete_doc` runs `on_trash` BEFORE its link check and never
    tells the document whether it was forced, so an `on_trash` cascade would already have deleted
    the sheet and grid rows of a BoQ whose (unforced) delete is then refused. `after_delete` runs only
    once the delete went through -- an unforced delete of a linked BoQ is refused before it, with
    nothing removed. The drafts are already gone from the table by now, so their names come from the
    in-memory document. Raw deletes on purpose: these are child rows with no doc_events of their own.
    """
    draft_names = [d.name for d in (doc.get("sheet_drafts") or [])]
    if draft_names:
        frappe.db.delete(
            "BoQ Sheet Work Package", {"parent": ("in", draft_names), "parenttype": "BoQ Sheet Draft"}
        )
    sheet_names = frappe.get_all("BoQ Sheet", filters={"boq": doc.name}, pluck="name")
    if sheet_names:
        frappe.db.delete(
            "BoQ Sheet Work Package", {"parent": ("in", sheet_names), "parenttype": "BoQ Sheet"}
        )
    grid_names = frappe.get_all("BoQ Committed Sheet Grid", filters={"boq": doc.name}, pluck="name")
    if grid_names:
        frappe.db.delete(
            "BoQ Committed Sheet Grid Row",
            {"parent": ("in", grid_names), "parenttype": "BoQ Committed Sheet Grid"},
        )


def on_update(doc, method):
    # parent_boq (the master/sub BoQ link) was retired in Phase 4 P4-FINAL, and the
    # Draft->Approved approval cascade it drove was removed with it. on_update has no
    # remaining work; kept as a wired no-op so hooks.py needs no change.
    pass


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _validate_area_dimensions(doc):
    if not doc.area_dimensions:
        return

    try:
        dims = json.loads(doc.area_dimensions)
    except (json.JSONDecodeError, ValueError):
        frappe.throw(_("area_dimensions must be valid JSON, e.g. [\"B1\", \"B3\"]."))

    if not isinstance(dims, list):
        frappe.throw(_("area_dimensions must be a JSON array, e.g. [\"B1\", \"B3\"]."))

    if not dims:
        return  # empty list [] is valid

    for item in dims:
        if not isinstance(item, str):
            frappe.throw(_("area_dimensions must contain only strings."))

    if len(dims) != len(set(dims)):
        frappe.throw(_("area_dimensions must not contain duplicate area names."))
