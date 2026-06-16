import frappe
from frappe import _


# Capture-only (Phase 5 Slice 2.5): child rows persist their given qty / rate / amount
# VERBATIM. The former write-chain compute -- _apply_rate_fallback (a blank child rate
# inheriting the parent's) and _compute_child_amounts (child amount = rate x qty) -- was
# REMOVED; those calculations move to the future tendering phase. The parent no longer
# calls apply_before_save (its _process_qty_by_area_rows reach was removed too). Only the
# structural per-row combined_rate tolerance check remains, called from boq_nodes.validate.


def validate_child(child):
    """Validate combined_rate == supply_rate + install_rate when all three are set. Called by boq_nodes.validate."""
    _validate_combined_rate(child)


def _validate_combined_rate(child):
    sr = child.supply_rate
    ir = child.install_rate
    cr = child.combined_rate
    # Only validate when all three are explicitly set (including 0.0). With the rate
    # fallback removed, a blank child rate stays None, so this guard short-circuits and
    # never spuriously trips on an inherited value.
    if sr is not None and ir is not None and cr is not None:
        if abs(cr - (sr + ir)) >= 0.01:
            frappe.throw(
                _(
                    f"BOQ Node Qty By Area row for area {child.area_name}: "
                    f"combined_rate ({cr}) must equal supply_rate ({sr}) + install_rate ({ir})"
                )
            )
