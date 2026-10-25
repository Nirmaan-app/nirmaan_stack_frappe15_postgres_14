"""
Merge a Tendering project's BoQs into a Won project, and undo it (ADR-0038).

Thin endpoints: the allow/refuse rules are the pure `services/tendering_merge`, the BoQ moves are
`controllers/boqs` (`move_boqs_into_project`, `return_merged_boqs`, `boqs_blocking_unmerge`). The
reply shape matches the other Tendering endpoints in `tendering.py`:
{"status": 200, ...} or {"status": 400 | 403, "error": str}.

`merge_into` is the one merge step. The Merge button uses it through `merge_tendering_boqs`;
Convert to Won and Create project use it through `merge_sources_into`, inside their own
transaction, for the BoQs the wizard added from other Tendering projects. Who may merge and undo:
anyone who can create projects (`tendering.is_tendering_manager`, owner 2026-10-21).
"""
import frappe

from nirmaan_stack.api.boq.wizard.pricing_lock import fresh_locks_for_boqs
from nirmaan_stack.api.projects.tendering import is_tendering_manager
from nirmaan_stack.integrations.controllers.boqs import (
    boqs_blocking_unmerge,
    move_boqs_into_project,
    return_merged_boqs,
)
from nirmaan_stack.services.tendering_merge import (
    MAY_MERGE_MESSAGE,
    MERGE_FROM_STATUSES,
    MERGED,
    TENDERING,
    UNDO_FROM_STATUSES,
    busy_lock_label,
    busy_parse_label,
    merge_refusal,
    undo_refusal,
    wizard_tick_refusal,
)

# Which BoQs each action moves: Merge takes the project's own, Undo the ones stamped from it.
_BOQ_SET_COLUMN = {"merge": "project", "undo": "merged_from"}


def _busy_labels(column, value):
    """One line per sheet someone is editing right now, and per BoQ whose parse is running,
    among the BoQs with `column = value` (ADR-0038 D9). Read only."""
    boqs = frappe.get_all(
        "BOQs",
        filters={column: value},
        fields=["name", "boq_name", "parse_in_progress"],
        order_by="name asc",
    )
    titles = {boq.name: boq.boq_name or boq.name for boq in boqs}
    labels = [
        busy_lock_label(
            titles[lock["boq"]], lock["sheet_name"], lock["committed_version"],
            lock["holder_name"], lock["seconds_ago"],
        )
        for lock in fresh_locks_for_boqs(list(titles))
    ]
    labels += [busy_parse_label(titles[boq.name]) for boq in boqs if boq.parse_in_progress]
    return labels


@frappe.whitelist()
def get_merge_blockers(project_name, action="merge"):
    """Who is editing the BoQs a Merge (or an Undo) would move, right now -- for the dialogs.

    Args:
        project_name (str): The Tendering (merge) or Merged (undo) project's docname.
        action (str): "merge" or "undo".

    Returns:
        dict: {"busy": [one line per sheet being edited / BoQ being parsed]}. Only for users who
        can create projects.
    """
    if not is_tendering_manager():
        frappe.throw(MAY_MERGE_MESSAGE, frappe.PermissionError)
    column = _BOQ_SET_COLUMN.get(action)
    if not column:
        frappe.throw(f"Unknown action '{action}'.")
    return {"busy": _busy_labels(column, project_name)}


def _refuse(message, may_merge):
    raise (frappe.ValidationError if may_merge else frappe.PermissionError)(message)


def _as_list(value):
    """A list from a whitelisted argument that may arrive as a JSON string."""
    if isinstance(value, str):
        value = frappe.parse_json(value) if value.strip().startswith("[") else [value]
    return list(dict.fromkeys(name for name in (value or []) if name))


def _boqs_outside(column, value, allowed_statuses):
    """'NAME (Status)' for each BoQ with `column = value` whose status is not allowed.

    Every BoQ in the set is read under a row lock (FOR UPDATE), so no status can change between
    this check and the move. `column` is one of two fixed names, never user input.
    """
    assert column in ("project", "merged_from")
    rows = frappe.db.sql(
        f"""
        SELECT name, status FROM "tabBOQs"
        WHERE {column} = %(value)s
        ORDER BY name
        FOR UPDATE
        """,
        {"value": value},
        as_dict=True,
    )
    return [f"{row.name} ({row.status or 'blank'})" for row in rows if row.status not in allowed_statuses]


def _set_project_merge(project_name, tendering_status, merged_into):
    # `set_value`, the same as `mark_tendering_project_lost` (ADR-0038 D8): a pre-Won project's
    # Projects hooks (milestones, cashflow, CEO Hold) concern operational projects, so skipping
    # them is correct. Each moved BoQ is saved through its document and records who moved it.
    frappe.db.set_value(
        "Projects",
        project_name,
        {"tendering_status": tendering_status, "merged_into": merged_into},
    )


def merge_into(project_name, target_project, selected_boqs, *, require_tick):
    """Merge one Tendering project into a Won project, inside the caller's transaction.

    Every check runs first (D2, D9): the user can create projects; the project is Tendering with
    at least one BoQ, every BoQ Draft and none being edited; every ticked name is one of its BoQs;
    the target is a running Won project. Then all its BoQs move -- ticked ones Selected, the rest
    Draft -- and the project becomes Merged. Raises on a refusal; does not commit.
    """
    may_merge = is_tendering_manager()
    project = frappe.db.get_value(
        "Projects", project_name, ["tendering_status"], as_dict=True, for_update=True
    ) if project_name else None
    if not project:
        _refuse(f"Project '{project_name}' does not exist.", may_merge)
    target = frappe.db.get_value(
        "Projects", target_project, ["tendering_status", "status"], as_dict=True
    ) if target_project else None

    selected = _as_list(selected_boqs)
    own = set(frappe.get_all("BOQs", filters={"project": project_name}, pluck="name"))
    refusal = merge_refusal(
        may_merge=may_merge,
        project=project_name,
        tendering_status=project.tendering_status,
        boq_count=len(own),
        target=target_project,
        target_tendering_status=target.tendering_status if target else None,
        target_status=target.status if target else None,
        boqs_not_draft=_boqs_outside("project", project_name, MERGE_FROM_STATUSES) if may_merge else [],
        busy_boqs=_busy_labels("project", project_name) if may_merge else [],
        picks_outside=[name for name in selected if name not in own],
        ticked_count=len(selected),
        require_tick=require_tick,
    )
    if refusal:
        _refuse(refusal, may_merge)

    moved = move_boqs_into_project(project_name, target_project, selected)
    _set_project_merge(project_name, MERGED, target_project)
    return moved


def parse_merge_sources(raw):
    """The wizard's `merge_sources` as [{"project", "selected_boqs"}], each project once.

    Accepts a list or its JSON string. A project added twice is refused by name; whether each
    project may be merged is `merge_into`'s check, run on Create.
    """
    if isinstance(raw, str):
        raw = frappe.parse_json(raw) if raw.strip() else []
    sources, seen = [], set()
    for entry in raw or []:
        project = (entry or {}).get("project")
        if not project:
            continue
        if project in seen:
            frappe.throw(f"Project '{project}' was added twice.")
        seen.add(project)
        sources.append({"project": project, "selected_boqs": _as_list(entry.get("selected_boqs"))})
    return sources


def assert_wizard_ticks(own_boq_count, own_selected, sources):
    """At least one BoQ ticked overall when any BoQ is involved (owner 2026-10-21). Read only;
    run before Convert / Create writes anything."""
    boq_count = own_boq_count + sum(
        frappe.db.count("BOQs", {"project": source["project"]}) for source in sources
    )
    ticked = len(_as_list(own_selected)) + sum(len(source["selected_boqs"]) for source in sources)
    refusal = wizard_tick_refusal(boq_count, ticked)
    if refusal:
        frappe.throw(refusal)


def merge_sources_into(target_project, sources):
    """Merge every Tendering project the wizard added into the project just converted or created.
    Inside the caller's transaction: one refusal rolls the whole Convert / Create back."""
    for source in sources:
        merge_into(source["project"], target_project, source["selected_boqs"], require_tick=False)


@frappe.whitelist(methods=["POST"])
def merge_tendering_boqs(project_name, target_project, selected_boqs=None):
    """Move every BoQ of a Tendering project into a Won project and mark the project Merged (D2).
    Ticked BoQs become Selected, the rest Draft; at least one must be ticked.

    Args:
        project_name (str): The Tendering project's docname.
        target_project (str): The Won project's docname (not Completed).
        selected_boqs (list[str] | str): The ticked BoQs (a JSON list is accepted).

    Returns:
        dict: {"status": 200, "message": str, "project_name": str, "merged_into": str,
               "boqs": [names], "selected": [names]} on success, or
              {"status": 400 | 403, "error": str}.

    Example:
        POST nirmaan_stack.api.projects.tendering_merge.merge_tendering_boqs
        {"project_name": "BENGALURU-PROJ-00262", "target_project": "BENGALURU-PROJ-00080",
         "selected_boqs": ["BOQ-26-00267"]}
    """
    try:
        frappe.db.begin()
        selected = _as_list(selected_boqs)
        moved = merge_into(project_name, target_project, selected, require_tick=True)
        frappe.db.commit()

        return {
            "status": 200,
            "message": f"{len(moved)} BoQ{'' if len(moved) == 1 else 's'} merged into {target_project}.",
            "project_name": project_name,
            "merged_into": target_project,
            "boqs": moved,
            "selected": selected,
        }

    except frappe.PermissionError as pe:
        frappe.db.rollback()
        return {"status": 403, "error": str(pe)}
    except frappe.ValidationError as ve:
        frappe.db.rollback()
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(title="merge_tendering_boqs exception", message=frappe.get_traceback())
        return {"status": 400, "error": f"Failed to merge BoQs: {str(e)}"}


@frappe.whitelist(methods=["POST"])
def undo_tendering_merge(project_name):
    """Move a Merged project's BoQs back as Draft and return it to Tendering (D3/D4).

    Args:
        project_name (str): The Merged project's docname.

    Returns:
        dict: {"status": 200, "message": str, "project_name": str, "boqs": [names]} on success,
              or {"status": 400 | 403, "error": str}.
    """
    try:
        frappe.db.begin()
        may_merge = is_tendering_manager()
        project = frappe.db.get_value(
            "Projects", project_name, ["tendering_status"], as_dict=True, for_update=True
        ) if project_name else None
        if not project:
            _refuse(f"Project '{project_name}' does not exist.", may_merge)

        refusal = undo_refusal(
            may_merge=may_merge,
            project=project_name,
            tendering_status=project.tendering_status,
            boqs_in_other_status=(
                _boqs_outside("merged_from", project_name, UNDO_FROM_STATUSES) if may_merge else []
            ),
            blocking_revisions=boqs_blocking_unmerge(project_name) if may_merge else [],
            busy_boqs=_busy_labels("merged_from", project_name) if may_merge else [],
        )
        if refusal:
            _refuse(refusal, may_merge)

        returned = return_merged_boqs(project_name)
        _set_project_merge(project_name, TENDERING, None)
        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Merge undone: {len(returned)} BoQ{'' if len(returned) == 1 else 's'} moved back as Draft.",
            "project_name": project_name,
            "boqs": returned,
        }

    except frappe.PermissionError as pe:
        frappe.db.rollback()
        return {"status": 403, "error": str(pe)}
    except frappe.ValidationError as ve:
        frappe.db.rollback()
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(title="undo_tendering_merge exception", message=frappe.get_traceback())
        return {"status": 400, "error": f"Failed to undo the merge: {str(e)}"}
