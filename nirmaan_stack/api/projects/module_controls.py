import frappe
from frappe import _

from nirmaan_stack.services.role_profiles import (
    ADMIN_PROFILE,
    PMO_EXECUTIVE_PROFILE,
    has_role_profile,
)

# Admin + PMO may enable/disable a project module. These are ROLE PROFILE names,
# resolved by `has_role_profile` — never by `frappe.get_roles()` alone, which
# matched nobody and locked out every real Admin and PMO user.
MODULE_CONTROL_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE)


def _require_module_control_access(action: str) -> None:
    """Admin/PMO gate for the module enable/disable endpoints."""
    if has_role_profile(frappe.session.user, MODULE_CONTROL_PROFILES):
        return

    frappe.throw(
        _("You are not authorized to {0} modules.").format(action),
        frappe.PermissionError,
    )


@frappe.whitelist()
def enable_module(project, module_type):
    """
    Re-enables a specific module for a given project.
    
    Args:
        project (str): The project ID (name)
        module_type (str): The module to enable ('dpr', 'inventory', 'pmo', 'snag_list', 'design_tracker', 'commission_report')
    """
    if not project or not module_type:
        frappe.throw(_("Project and Module Type are required."))

    # Check for permissions (Admin or PMO)
    _require_module_control_access("enable")

    try:
        if module_type == 'dpr':
            frappe.db.set_value("Projects", project, {
                "disabled_dpr": 0,
                "disabled_dpr_date": None
            })
        elif module_type == 'inventory':
            frappe.db.set_value("Projects", project, {
                "disabled_inventory": 0,
                "disabled_inventory_date": None
            })
        elif module_type == 'pmo':
            frappe.db.set_value("Projects", project, "disabled_pmo", 0)
        elif module_type == 'snag_list':
            # On PROJECTS, not on a snag document: a snag list has no document of its
            # own (a Project Snag is standalone -- ADR-0017), so unlike design_tracker
            # and commission_report below there is nothing else to carry the flag.
            frappe.db.set_value("Projects", project, "disabled_snag_list", 0)
        elif module_type == 'design_tracker':
            # Update all Design Trackers for this project
            frappe.db.set_value("Project Design Tracker", {"project": project}, "hide_design_tracker", 0)
        elif module_type == 'commission_report':
            # Update all Commission Reports for this project
            frappe.db.set_value("Project Commission Report", {"project": project}, "hide_commission_report", 0)
        else:
            frappe.throw(_("Invalid module type: {0}").format(module_type))

        frappe.db.commit()
        return {"status": "success", "message": _("{0} module enabled successfully.").format(module_type.replace('_', ' ').title())}

    except Exception as e:
        frappe.log_error(f"Error enabling module {module_type} for project {project}: {str(e)}", "Enable Module Error")
        frappe.throw(_("Failed to enable module: {0}").format(str(e)))

@frappe.whitelist()
def disable_module(project, module_type):
    """
    Deactivates a specific module for a given project.
    
    Args:
        project (str): The project ID (name)
        module_type (str): The module to disable ('dpr', 'inventory', 'pmo', 'snag_list', 'design_tracker', 'commission_report')
    """
    if not project or not module_type:
        frappe.throw(_("Project and Module Type are required."))

    # Check for permissions (Admin or PMO)
    _require_module_control_access("disable")

    from frappe.utils import today

    try:
        if module_type == 'dpr':
            frappe.db.set_value("Projects", project, {
                "disabled_dpr": 1,
                "disabled_dpr_date": today()
            })
        elif module_type == 'inventory':
            frappe.db.set_value("Projects", project, {
                "disabled_inventory": 1,
                "disabled_inventory_date": today()
            })
        elif module_type == 'pmo':
            frappe.db.set_value("Projects", project, "disabled_pmo", 1)
        elif module_type == 'snag_list':
            # Hides the project's CARD on the /snag-list grid for everyone below
            # Admin/PMO. It does NOT close the snags, hide the project's own Snag List
            # tab, or block a write -- same reach `hide_design_tracker` has.
            frappe.db.set_value("Projects", project, "disabled_snag_list", 1)
        elif module_type == 'design_tracker':
            # Update all Design Trackers for this project
            frappe.db.set_value("Project Design Tracker", {"project": project}, "hide_design_tracker", 1)
        elif module_type == 'commission_report':
            # Update all Commission Reports for this project
            frappe.db.set_value("Project Commission Report", {"project": project}, "hide_commission_report", 1)
        else:
            frappe.throw(_("Invalid module type: {0}").format(module_type))

        frappe.db.commit()
        return {"status": "success", "message": _("{0} module disabled successfully.").format(module_type.replace('_', ' ').title())}

    except Exception as e:
        frappe.log_error(f"Error disabling module {module_type} for project {project}: {str(e)}", "Disable Module Error")
        frappe.throw(_("Failed to disable module: {0}").format(str(e)))
