"""Lifecycle of a BOQ Line Estimate (New Estimations): the materials one BOQ line item needs.

Registered in hooks.py `doc_events`. The rules themselves are pure, in `services/estimations/rules.py`;
this module loads what they need, fills the copied fields, and throws the first problem.

SCOPE RULE (plan "BOQ Estimates", owner 2026-11-06): the BOQ and Estimates (pricing) workflows stay
unchanged. This module only READS the BOQ tables (`BOQ Nodes`, `BOQs`, `Projects`) and never writes them.
`boq` and `boq_sheet` are copied from the line item on every save, for filtering only. A BOQ delete is not
blocked by an estimate's links: the doctype is in hooks.py `ignore_links_on_delete`.
"""

import frappe
from frappe import _
from frappe.permissions import has_user_permission

from nirmaan_stack.services.estimations import rules
from nirmaan_stack.services.role_profiles import ESTIMATE_EDIT_PROFILES, has_role_profile


def assert_can_edit() -> None:
    """Decision C: only Admin, PMO and Estimates Executive (and Administrator) change estimates. The one copy of
    this gate: the write endpoints (`api/estimations/estimate_writes.py`) import it."""
    if not has_role_profile(frappe.session.user, ESTIMATE_EDIT_PROFILES):
        frappe.throw(
            _("Only Admin, PMO and Estimates Executive can add, change or delete estimates."),
            frappe.PermissionError,
        )


def assert_project_access(project: str | None) -> None:
    """WHERE a user may read or change estimates: the projects their User Permissions on Projects allow, the same
    rule that limits which projects (and so which BOQ tabs) they can open. A user with no Projects rules is
    unrestricted, as everywhere else in the app (the snag API's `require_project_access` is the same check).
    The role gates say WHAT a user may do; this says WHERE. Every read endpoint and every save/delete calls it."""
    probe = frappe.get_doc({"doctype": "BOQs", "project": project})
    if not project or not has_user_permission(probe):
        frappe.throw(_("You do not have access to this project's estimates."), frappe.PermissionError)


def project_of_boq(boq: str | None) -> str | None:
    return frappe.db.get_value("BOQs", boq, "project") if boq else None


def _project_status(project: str | None) -> str | None:
    return frappe.db.get_value("Projects", project, "status") if project else None


def _fill_from_items(doc) -> None:
    """Copy name, unit and category from the Items record onto each Normal row that is new or now points to
    another item (decision: an estimate keeps what was chosen even if the Items record changes later). A saved row
    that still points to the same item keeps its stored name, unit and category, whatever the request sent."""
    before = doc.get_doc_before_save()
    saved = {row.name: row for row in (before.items if before else [])}
    for row in doc.items:
        if row.item_type != rules.ITEM_TYPE_NORMAL or not row.item_id:
            continue
        old = saved.get(row.name)
        if old and old.item_id == row.item_id and old.item_name:
            row.item_name, row.unit, row.category = old.item_name, old.unit, old.category
            continue
        item = frappe.db.get_value("Items", row.item_id, ["item_name", "unit_name", "category"], as_dict=True)
        if item:
            row.item_name = item.item_name
            row.unit = item.unit_name
            row.category = item.category


def _fill_packages(doc) -> None:
    """Each row's procurement package is its category's work package."""
    categories = {row.category for row in doc.items if row.category}
    packages = dict(
        frappe.get_all("Category", filters={"name": ["in", list(categories)]}, fields=["name", "work_package"], as_list=True)
    ) if categories else {}
    for row in doc.items:
        row.procurement_package = packages.get(row.category) or None
        if row.item_type == rules.ITEM_TYPE_CUSTOM:
            row.make = None  # a custom item has no make
            row.item_name = (row.item_name or "").strip()


def validate(doc, method=None):
    """Gate, check the line item and the project, fill the copied fields, then check every row."""
    assert_can_edit()

    if doc.is_new() and frappe.db.exists("BOQ Line Estimate", {"boq_node": doc.boq_node}):
        frappe.throw(_("This line item already has an estimate. Reload the page to edit it."))

    node = frappe.db.get_value("BOQ Nodes", doc.boq_node, ["node_type", "is_current", "boq", "sheet"], as_dict=True)
    problem = rules.line_problem(node)
    if problem:
        frappe.throw(_(problem))
    doc.boq = node.boq
    doc.boq_sheet = node.sheet

    boq = frappe.db.get_value("BOQs", doc.boq, ["project", "status"], as_dict=True) or {}
    assert_project_access(boq.get("project"))
    problem = rules.boq_problem(boq.get("status")) or rules.project_problem(_project_status(boq.get("project")))
    if problem:
        frappe.throw(_(problem))

    _fill_from_items(doc)
    _fill_packages(doc)
    for row in doc.items:
        problem = rules.item_row_problem(row.as_dict())
        if problem:
            frappe.throw(_("Row {0}: {1}").format(row.idx, _(problem)))
    problem = rules.duplicate_problem([row.as_dict() for row in doc.items])
    if problem:
        frappe.throw(_(problem))

    doc.item_count = len(doc.items)


def on_trash(doc, method=None):
    """Only the editing profiles delete, and not on a read-only project. An estimate whose BOQ is gone is
    removable by them, so a deleted BOQ's leftovers can be cleared."""
    assert_can_edit()
    if doc.boq and frappe.db.exists("BOQs", doc.boq):
        project = project_of_boq(doc.boq)
        assert_project_access(project)
        problem = rules.project_problem(_project_status(project))
        if problem:
            frappe.throw(_(problem))
