import json
import frappe
from frappe import _
from nirmaan_stack.integrations.controllers import boq_node_qty_by_area as _area_ctrl


def validate(doc, method):
    # The BoQ Sheet is the primary upward tie (Phase 4 P4-2). The boq link is kept
    # DENORMALIZED on the node (Frappe cannot filter/sort across two Link hops, and
    # boq carries search_index + in_standard_filter the Desk UI + index depend on).
    # Sync invariant: node.boq MUST equal its sheet's boq. We auto-fill boq from the
    # sheet when blank (one source of truth = the sheet) and throw on a real mismatch.
    # This runs FIRST so the denormalized boq is populated before any downstream read
    # of doc.boq (e.g. _validate_qty_by_area's area_dimensions lookup).
    if not doc.sheet:
        frappe.throw(_("BoQ Sheet is required"))
    sheet_boq = frappe.db.get_value("BoQ Sheet", doc.sheet, "boq")
    if doc.boq and doc.boq != sheet_boq:
        frappe.throw(
            _("Node BoQ ({0}) does not match its sheet's BoQ ({1})").format(doc.boq, sheet_boq)
        )
    if not doc.boq:
        doc.boq = sheet_boq

    if not doc.node_type:
        frappe.throw(_("Node Type is required"))
    if not doc.description:
        frappe.throw(_("Description is required"))

    if doc.node_type == "Preamble":
        if doc.level is None or doc.level < 1:
            frappe.throw(_("Level must be a positive integer for Preamble nodes"))
        if doc.level > 5:
            frappe.msgprint(
                _("Preamble level {0} is unusually deep (> 5). Verify the hierarchy is correct.").format(doc.level),
                alert=True,
            )
        if not doc.amount_override and any([doc.qty, doc.supply_rate, doc.install_rate, doc.combined_rate]):
            has_children = frappe.db.exists("BOQ Nodes", {"parent_node": doc.name})
            if has_children:
                frappe.msgprint(
                    _("Non-leaf Preamble node has qty/rate values set. Set Amount Override to suppress this warning."),
                    alert=True,
                )

    elif doc.node_type == "Line Item":
        if doc.level:
            frappe.throw(_("Level must not be set for Line Item nodes"))
        if doc.qty is None:
            frappe.throw(_("Qty is required for Line Item nodes (use 0 for rate-only items)"))
        if not any([doc.supply_rate, doc.install_rate, doc.combined_rate]):
            frappe.msgprint(_("No rate fields are set on this Line Item"), alert=True)

    # Rate consistency: combined_rate must equal supply_rate + install_rate when all are set.
    # combined_rate of 0 is treated as "not set" (matches Currency field UI behaviour).
    if doc.combined_rate and (doc.supply_rate or doc.install_rate):
        expected = (doc.supply_rate or 0) + (doc.install_rate or 0)
        if doc.combined_rate != expected:
            frappe.throw(
                _("Combined Rate must equal Supply Rate + Install Rate when all are set. "
                  "Either remove Combined Rate or use only Combined Rate.")
            )

    if doc.parent_node:
        parent = frappe.db.get_value(
            "BOQ Nodes", doc.parent_node, ["node_type", "level"], as_dict=True
        )
        if parent:
            if doc.node_type == "Preamble":
                if doc.level > 1 and (parent.node_type != "Preamble" or parent.level != doc.level - 1):
                    frappe.throw(
                        _("An L{0} Preamble's parent must be an L{1} Preamble").format(
                            doc.level, doc.level - 1
                        )
                    )
            elif doc.node_type == "Line Item":
                if parent.node_type != "Preamble":
                    frappe.throw(_("A Line Item's parent must be a Preamble"))
    elif doc.node_type == "Line Item":
        frappe.msgprint(
            _("This Line Item has no parent Preamble. It will be saved as a standalone node."),
            alert=True,
        )

    _validate_qty_by_area(doc)


def before_save(doc, method):
    _compute_path(doc)
    _process_qty_by_area_rows(doc)
    _recompute_parent_rates_from_areas(doc)
    _compute_amounts(doc)


def after_insert(doc, method):
    _compute_path(doc)
    frappe.db.set_value("BOQ Nodes", doc.name, "path", doc.path, update_modified=False)


def on_update(doc, method):
    old_doc = doc.get_doc_before_save()
    if old_doc is None:
        return
    _write_audit(doc, old_doc)
    # Clear the transient field so it does not carry over to the next save
    frappe.db.set_value("BOQ Nodes", doc.name, "edit_reason", None, update_modified=False)


def on_trash(doc, method):
    if not doc.boq:
        return
    boq_status = frappe.db.get_value("BOQs", doc.boq, "status")
    if boq_status == "Approved":
        frappe.throw(_("Cannot delete nodes from an Approved BoQ"))


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _compute_path(doc):
    if not doc.parent_node:
        doc.path = doc.name
        return

    parent_path = frappe.db.get_value("BOQ Nodes", doc.parent_node, "path")
    if not parent_path:
        # Parent exists but has no path yet — treat this node as a root temporarily
        frappe.log_error(
            f"BOQ Node {doc.parent_node} has no path set; treating {doc.name} as root temporarily.",
            "BOQ Node Path Computation",
        )
        doc.path = doc.name
        return

    doc.path = f"{parent_path}/{doc.name}"


def _compute_amounts(doc):
    if doc.amount_override:
        return

    # Reset before recomputing to prevent stale values from a prior save leaking through
    doc.supply_amount = None
    doc.install_amount = None
    doc.total_amount = None

    qty = doc.qty if doc.qty is not None else 0

    if doc.supply_rate is not None:
        doc.supply_amount = qty * doc.supply_rate

    if doc.install_rate is not None:
        doc.install_amount = qty * doc.install_rate

    if doc.combined_rate:  # 0 treated as not-set, consistent with validation
        doc.total_amount = qty * doc.combined_rate
    elif any([doc.supply_rate, doc.install_rate]):
        supply = doc.supply_amount or 0
        install = doc.install_amount or 0
        doc.total_amount = supply + install

    # Auto-set is_rate_only: qty is explicitly zero and at least one rate is present
    doc.is_rate_only = 1 if (
        doc.qty == 0 and any([doc.supply_rate, doc.install_rate, doc.combined_rate])
    ) else 0


def _validate_qty_by_area(doc):
    rows = doc.get("qty_by_area") or []
    if not rows:
        return

    # A. Duplicate area_name
    area_names = [r.area_name for r in rows if r.area_name]
    if len(area_names) != len(set(area_names)):
        frappe.throw(_("qty_by_area contains duplicate area names."))

    # B. Sum vs qty mismatch — warning only
    if doc.qty is not None:
        total = sum(r.qty or 0 for r in rows)
        if total != doc.qty:
            frappe.msgprint(
                _("Sum of qty_by_area ({0}) does not match Qty ({1}).").format(total, doc.qty),
                alert=True,
            )

    # C. area_name not declared in BOQ's area_dimensions — warning only
    if doc.boq:
        raw = frappe.db.get_value("BOQs", doc.boq, "area_dimensions")
        if raw:
            try:
                declared = set(json.loads(raw))
            except (json.JSONDecodeError, ValueError):
                declared = set()
            if declared:
                for row in rows:
                    if row.area_name and row.area_name not in declared:
                        frappe.msgprint(
                            _("Area '{0}' in qty_by_area is not declared in the BoQ's area_dimensions.").format(
                                row.area_name
                            ),
                            alert=True,
                        )

    # D. Per-child combined_rate consistency — blocking
    for row in rows:
        _area_ctrl.validate_child(row)


def _process_qty_by_area_rows(doc):
    rows = doc.get("qty_by_area") or []
    for row in rows:
        _area_ctrl.apply_before_save(row, doc)


def _recompute_parent_rates_from_areas(doc):
    rows = doc.get("qty_by_area") or []
    if not rows:
        return

    for rate_field in ("supply_rate", "install_rate", "combined_rate"):
        relevant = [
            (r.qty or 0, r.get(rate_field))
            for r in rows
            if r.get(rate_field) is not None and (r.qty or 0) > 0
        ]
        if len(relevant) < 2:
            continue

        rates = [entry[1] for entry in relevant]
        if len(set(rates)) <= 1:
            continue  # all per-area rates are uniform — leave parent untouched

        total_qty = sum(entry[0] for entry in relevant)
        if total_qty == 0:
            continue

        doc.set(rate_field, sum(entry[0] * entry[1] for entry in relevant) / total_qty)


_NULLABLE_NUMERIC_FIELDS = frozenset({
    "qty", "level",
    "supply_rate", "install_rate", "combined_rate",
    "supply_amount", "install_amount", "total_amount",
})


def _write_audit(doc, old_doc):
    tracked_fields = [
        "description", "qty", "unit", "make_model", "supply_rate", "install_rate", "combined_rate",
        "supply_amount", "install_amount", "total_amount", "code", "level", "node_type",
        "parent_node", "notes",
    ]
    changed = []
    for field in tracked_fields:
        raw_old = old_doc.get(field)
        raw_new = doc.get(field)
        # Frappe stores Currency/Int None as 0 in DB; normalize for comparison only
        cmp_old = (raw_old or 0) if field in _NULLABLE_NUMERIC_FIELDS else raw_old
        cmp_new = (raw_new or 0) if field in _NULLABLE_NUMERIC_FIELDS else raw_new
        if cmp_old != cmp_new:
            changed.append([field, raw_old, raw_new])

    if not changed:
        return

    data = {
        "added": [],
        "changed": changed,
        "data_import": None,
        "removed": [],
        "row_changed": [],
        "updater_reference": None,
    }

    nv = frappe.new_doc("Nirmaan Versions")
    nv.ref_doctype = "BOQ Nodes"
    nv.docname = doc.name
    nv.data = json.dumps(data)
    nv.previous_state = "Active"
    nv.new_state = "Edited"
    nv.reason = doc.edit_reason or "Desk edit"
    nv.insert(ignore_permissions=True)
    frappe.db.commit()
