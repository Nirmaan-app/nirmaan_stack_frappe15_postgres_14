# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read and edit endpoints for Material Test Certificates (MTC).

Create and delete go through the SDK (`createDoc` / `deleteDoc`); the controller
`integrations/controllers/material_test_certificate.py` enforces every rule on all paths.

Project scope (owner, 2026-10-07): Project Managers and Project Leads see ONLY the projects
assigned to them through `User Permission`. A PM / PL with no assignment sees nothing --
deliberately stricter than Frappe's default, which shows such a user everything.
"""

import frappe
from frappe import _

from nirmaan_stack.services.role_profiles import MTC_PROJECT_SCOPED_PROFILES, get_role_profile

MTC = "Material Test Certificate"
MTC_ITEM = "Material Test Certificate Item"

_PARENT_FIELDS = [
    "name", "procurement_order", "project", "vendor", "attachment", "certificate_date", "owner", "creation",
]


def mtc_allowed_projects(user):
    """Projects `user` may see on the MTC list page.

    None  -> not a project-scoped profile; normal Frappe permissions apply.
    set() -> a PM / PL with no project assigned: sees nothing.

    Reads the PROFILE alone, never `has_role_profile`: that helper's second chance matches
    Role names, and Administrator holds every Role -- including ones named like these
    profiles -- so it would wrongly scope Administrator down to nothing.
    """
    if get_role_profile(user) not in MTC_PROJECT_SCOPED_PROFILES:
        return None
    return set(
        frappe.get_all(
            "User Permission", filters={"user": user, "allow": "Projects"}, pluck="for_value"
        )
    )


@frappe.whitelist()
def get_mtc_projects():
    """Feeds the MTC list page's project picker.

    Returns {scoped, has_projects, projects: [{project, mtc_count}]}. `scoped` is True for a
    PM / PL; `has_projects` is False when such a user has no project assigned.
    """
    allowed = mtc_allowed_projects(frappe.session.user)
    if allowed is not None and not allowed:
        return {"scoped": True, "has_projects": False, "projects": []}

    rows = frappe.get_list(
        MTC,
        fields=["project", "count(*) as mtc_count"],
        group_by="project",
        order_by="project asc",
        limit_page_length=0,
    )
    projects = [
        {"project": r.project, "mtc_count": r.mtc_count}
        for r in rows
        if allowed is None or r.project in allowed
    ]
    return {"scoped": allowed is not None, "has_projects": True, "projects": projects}


@frappe.whitelist()
def get_mtcs(procurement_order=None, project=None):
    """MTCs of one PO (the PO page card) or one project (the list page), newest first.

    Pass exactly one of `procurement_order` / `project`.
    """
    if bool(procurement_order) == bool(project):
        frappe.throw(_("Pass either a Purchase Order or a Project."))

    if procurement_order:
        filters = {"procurement_order": procurement_order}
    else:
        allowed = mtc_allowed_projects(frappe.session.user)
        if allowed is not None and project not in allowed:
            return []
        filters = {"project": project}

    parents = frappe.get_list(
        MTC,
        filters=filters,
        fields=_PARENT_FIELDS,
        order_by="creation desc",
        limit_page_length=0,
    )
    if not parents:
        return []

    names = {p.name for p in parents}
    column = "procurement_order" if procurement_order else "project"
    # One join on the same filter instead of an IN-list over the names (large IN-lists trip
    # sqlparse's token cap in production); rows are then narrowed to the permitted parents.
    item_rows = frappe.db.sql(
        f"""
        SELECT i.parent, i.item_id, i.item_name, i.make, i.category, i.procurement_package
        FROM "tabMaterial Test Certificate Item" i
        JOIN "tabMaterial Test Certificate" m ON m.name = i.parent
        WHERE i.parenttype = %s AND m.{column} = %s
        ORDER BY i.parent, i.idx
        """,
        (MTC, procurement_order or project),
        as_dict=True,
    )
    items_by_parent = {}
    for row in item_rows:
        if row.parent in names:
            items_by_parent.setdefault(row.parent, []).append(
                {k: row[k] for k in ("item_id", "item_name", "make", "category", "procurement_package")}
            )

    # The PO's PR: Project Managers reach a PO through `/prs&milestones/procurement-requests/<pr>/<po>`.
    po_prs = dict(
        frappe.db.sql(
            f"""
            SELECT DISTINCT po.name, po.procurement_request
            FROM "tabProcurement Orders" po
            JOIN "tabMaterial Test Certificate" m ON m.procurement_order = po.name
            WHERE m.{column} = %s
            """,
            (procurement_order or project,),
        )
    )

    vendor_ids = {p.vendor for p in parents if p.vendor}
    vendor_names = (
        dict(
            frappe.get_all(
                "Vendors",
                filters={"name": ["in", list(vendor_ids)]},
                fields=["name", "vendor_name"],
                as_list=True,
            )
        )
        if vendor_ids
        else {}
    )

    return [
        {
            **p,
            "vendor_name": vendor_names.get(p.vendor),
            "procurement_request": po_prs.get(p.procurement_order),
            "items": items_by_parent.get(p.name, []),
        }
        for p in parents
    ]


@frappe.whitelist(methods=["POST"])
def update_mtc(name, items, attachment=None, certificate_date=None):
    """Edit an MTC: replace its items and, when given, its file and Certificate Date.

    `items` is a list (or JSON string) of {item_id, make}; the controller fills the rest from
    the PO. The old file's `File` row is left in place, so a replaced file is kept in storage
    (owner ruling Q31). `doc.save()` runs the controller checks and writes a Version row.
    """
    if isinstance(items, str):
        items = frappe.parse_json(items)

    doc = frappe.get_doc(MTC, name)
    doc.check_permission("write")
    doc.set("items", [])
    for item in items or []:
        doc.append("items", {"item_id": item.get("item_id"), "make": item.get("make")})
    if attachment:
        doc.attachment = attachment
    if certificate_date:
        doc.certificate_date = certificate_date
    # Explicit: Frappe defaults ignore_version to `flags.in_test`, which would leave the
    # edit history (owner ruling Q33) untested.
    doc.save(ignore_version=False)
    frappe.db.commit()
    return {"name": doc.name}
