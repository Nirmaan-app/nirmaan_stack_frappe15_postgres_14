import json
import frappe
from frappe import _
# The relaxed-#7 preamble-parent predicate is SHARED with the pre-commit preflight
# (commit_validation) so this durable backstop and the previewable validator agree.
from nirmaan_stack.api.boq.wizard.commit_validation import preamble_parent_ok


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
    # Description is required only for the PRICEABLE node types (Preamble / Line Item).
    # A non-priceable "Other" node (X: note / subtotal_marker / header_repeat) may be
    # contentless (e.g. a marker), so the constraint no-ops for it -- the rest of the
    # validation already falls through both type branches for "Other".
    if doc.node_type in ("Preamble", "Line Item") and not doc.description:
        frappe.throw(_("Description is required"))

    if doc.node_type == "Preamble":
        # Level 0 is allowed (Phase 5 level-less-preamble guard fix): a preamble whose
        # source carries no level commits at the level the commit pipeline computes
        # (max(0, min child level - 1), or the sheet's shallowest defined level, else 0).
        # Only None / negative levels are rejected.
        # (The soft "level > 5" and "non-leaf preamble has qty/rate" advisories were moved
        # out of this durable backstop into the pre-commit preflight -- validate_node_plan
        # warnings #15 / #16 -- so the real commit is SILENT.)
        if doc.level is None or doc.level < 0:
            frappe.throw(_("Level must be a non-negative integer for Preamble nodes"))

    elif doc.node_type == "Line Item":
        if doc.level:
            frappe.throw(_("Level must not be set for Line Item nodes"))
        if doc.qty is None:
            frappe.throw(_("Qty is required for Line Item nodes (use 0 for rate-only items)"))
        # (The soft "no rate fields set" advisory -- old #17 -- is deleted outright: it
        # carried no preflight value and never blocked a save.)

    # (The soft combined_rate consistency advisory -- old #18 -- is deleted outright. The
    # committed tier is CAPTURE-ONLY; rate reconciliation belongs to tendering, not a
    # commit-time msgprint the user never sees.)

    if doc.parent_node:
        parent = frappe.db.get_value(
            "BOQ Nodes", doc.parent_node, ["node_type", "level"], as_dict=True
        )
        if parent:
            if doc.node_type == "Preamble":
                # RELAXED #7 (shared with the preflight via preamble_parent_ok): a section
                # heading deeper than L1 must sit under a STRICTLY shallower section heading
                # (any depth above it), not necessarily exactly one level up. L0/L1 are
                # unconstrained. Durable frappe.throw backstop; the preflight surfaces the
                # same rule as a previewable error.
                if not preamble_parent_ok(doc.level, parent.node_type, parent.level):
                    frappe.throw(_(
                        "This sub-heading must sit under a higher-level section heading "
                        "(one with a smaller level number). Re-parent it in review."
                    ))
            elif doc.node_type == "Line Item":
                if parent.node_type != "Preamble":
                    frappe.throw(_(
                        "An item must sit under a section heading, not under another "
                        "item or a note."
                    ))
    # (The soft "standalone Line Item has no parent" advisory -- the orphan msgprint -- is
    # moved into the preflight as a soft warning; the real commit no longer msgprints it.)

    _validate_qty_by_area(doc)


def before_save(doc, method):
    # Capture-only (Phase 5 Slice 2.5): the committed tier persists the reviewed values
    # VERBATIM. All money computation -- amount = rate x qty, the parent rate weighted-
    # average roll-up, and the child rate inheritance/amount compute -- was REMOVED from
    # the write chain and moves to the future tendering phase (built against that
    # consumer's shape). Only the structural path identity is derived here.
    # NOTE: is_rate_only is NO LONGER auto-set here; its value is carried through from the
    # BoQ Review Row by the Slice-3 commit pipeline (the parser sets it).
    _compute_path(doc)


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


def _validate_qty_by_area(doc):
    rows = doc.get("qty_by_area") or []
    if not rows:
        return

    # A. Duplicate area_name — hard structural throw (KEPT; #14).
    area_names = [r.area_name for r in rows if r.area_name]
    if len(area_names) != len(set(area_names)):
        frappe.throw(_("qty_by_area contains duplicate area names."))

    # The former soft advisories here are gone from this durable backstop:
    #   - sum-of-qty_by_area vs qty mismatch (old #19) -- deleted outright.
    #   - area_name not in the BoQ's declared areas (old #20) -- RELOCATED to the
    #     pre-commit preflight (validate_node_plan warning #20, grouped per area).
    #   - per-child combined_rate consistency (old #21) -- deleted outright (the dispatch
    #     loop into boq_node_qty_by_area.validate_child is removed; capture-only).


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
