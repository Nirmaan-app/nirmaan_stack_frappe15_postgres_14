import frappe
from frappe import _


def apply_before_save(child, parent_doc):
    """Apply rate fallback from parent + auto-compute child amounts. Called by boq_nodes.before_save."""
    _apply_rate_fallback(child, parent_doc)
    if not child.amount_override:
        _compute_child_amounts(child)


def validate_child(child):
    """Validate combined_rate == supply_rate + install_rate when all three are set. Called by boq_nodes.validate."""
    _validate_combined_rate(child)


def _apply_rate_fallback(child, parent_doc):
    for field in ("supply_rate", "install_rate", "combined_rate"):
        if child.get(field) is None:
            parent_val = parent_doc.get(field)
            if parent_val is not None:
                child.set(field, parent_val)


def _compute_child_amounts(child):
    qty = child.qty or 0

    if child.supply_rate is not None:
        child.supply_amount = qty * child.supply_rate
    else:
        child.supply_amount = None

    if child.install_rate is not None:
        child.install_amount = qty * child.install_rate
    else:
        child.install_amount = None

    # Mirror parent §7.14 rule: combined_rate path wins; else sum; else None
    if child.combined_rate is not None:
        child.total_amount = qty * child.combined_rate
    elif child.supply_rate is not None and child.install_rate is not None:
        child.total_amount = child.supply_amount + child.install_amount
    else:
        child.total_amount = None


def _validate_combined_rate(child):
    sr = child.supply_rate
    ir = child.install_rate
    cr = child.combined_rate
    # Only validate when all three are explicitly set (including 0.0)
    if sr is not None and ir is not None and cr is not None:
        if abs(cr - (sr + ir)) >= 0.01:
            frappe.throw(
                _(
                    f"BOQ Node Qty By Area row for area {child.area_name}: "
                    f"combined_rate ({cr}) must equal supply_rate ({sr}) + install_rate ({ir})"
                )
            )
