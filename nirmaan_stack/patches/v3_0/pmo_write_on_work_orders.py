"""PMO Executive gains write and delete on Work Orders (#1529, spec #1528, decision Q4 option B).

PMO sees the GST switch, Edit terms, Delete and Amend on a Work Order, and the server refused them
because its Role reads Work Orders only. Approval stays refused: the Work Order lifecycle guard
(`services/work_order_lifecycle`) allows only Admin and Project Lead to approve, reject or decide an
amendment, whatever the Role's rights.

Production permissions are not shipped in the doctype JSON, so the grant goes through Frappe's own
permission store (`Custom DocPerm`, as the Role Permission Manager writes it): it survives the next
re-import of the Service Requests JSON. If the doctype has no Custom DocPerm rows yet, Frappe first
copies its DocPerm rows there, so every other role keeps exactly what it has.

Idempotent: a right PMO already holds is left alone, so a second run changes nothing.
Preview from the bench console: `missing_rights()`.
"""

import frappe
from frappe.permissions import add_permission, setup_custom_perms, update_permission_property

DOCTYPE = "Service Requests"
ROLE = "Nirmaan PMO Executive"
RIGHTS = ("read", "write", "delete")


def _pmo_rule():
    """PMO's level-0 rule in the permissions Frappe applies: Custom DocPerm when the doctype has any,
    else the doctype's own DocPerm rows."""
    table = "Custom DocPerm" if frappe.db.exists("Custom DocPerm", {"parent": DOCTYPE}) else "DocPerm"
    return frappe.db.get_value(
        table, {"parent": DOCTYPE, "role": ROLE, "permlevel": 0, "if_owner": 0}, list(RIGHTS), as_dict=True
    )


def missing_rights() -> list[str]:
    """The rights this patch would grant, in `RIGHTS` order; empty once it has run."""
    rule = _pmo_rule() or {}
    return [right for right in RIGHTS if not rule.get(right)]


def execute():
    missing = missing_rights()
    if not missing:
        print(f"{ROLE} already has {', '.join(RIGHTS)} on {DOCTYPE}: nothing to do.")
        return
    setup_custom_perms(DOCTYPE)
    if not frappe.db.exists("Custom DocPerm", {"parent": DOCTYPE, "role": ROLE, "permlevel": 0, "if_owner": 0}):
        add_permission(DOCTYPE, ROLE, 0, "read")
    for right in missing:
        update_permission_property(DOCTYPE, ROLE, 0, right, 1, validate=False)
    frappe.clear_cache(doctype=DOCTYPE)
    print(f"{ROLE} on {DOCTYPE}: granted {', '.join(missing)}.")
