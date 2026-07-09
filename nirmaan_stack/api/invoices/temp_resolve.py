# =============================================================================
# TEMPORARY — "Resolve Invoices" admin UI backend.
#
# A short-lived (~1 week) helper so Admins can clear the invoices whose line-item
# extraction FAILED during the invoice_qty backfill (couldn't pass the match gate),
# from the browser instead of the `manual_fix` terminal call. It RE-RUNS the same
# AI extraction the Add-Invoice dialog uses, lets the admin correct the mapping,
# then persists it exactly like a normally auto-filled invoice.
#
# Delete this whole file + the frontend page + the route + the `editableQty` prop
# on LineItemMappingReview when the cleanup window is over. Nothing else imports it.
# =============================================================================
import frappe
import json


def _require_admin():
    if frappe.session.user == "Administrator":
        return
    if "Nirmaan Admin Profile" in frappe.get_roles(frappe.session.user):
        return
   

# Autofill fields written on save so a resolved invoice is identical to a normally
# AI-autofilled one (recon UI + auto-approve gates read these). Mirrors the patch's
# backfill_invoice_qty._apply_autofill / _AF_FIELDS.
def _apply_autofill(vi, extracted, line_match, rows):
    _j = lambda v: json.dumps(v) if v else None
    vi.set("line_mappings", rows)
    vi.autofill_used = 1
    vi.autofill_processor_id = extracted.get("processor_id")
    vi.autofill_extracted_invoice_no = extracted.get("invoice_no")
    vi.autofill_extracted_invoice_date = extracted.get("invoice_date")
    vi.autofill_extracted_amount = extracted.get("amount")
    vi.autofill_extracted_supplier_gstin = extracted.get("supplier_gstin")
    vi.autofill_extracted_receiver_gstin = extracted.get("receiver_gstin")
    vi.autofill_confidence_json = _j(extracted.get("confidence"))
    vi.autofill_all_entities_json = _j(extracted.get("entities"))
    vi.autofill_line_items_json = _j(extracted.get("line_items"))
    vi.autofill_line_match_json = _j(line_match)


@frappe.whitelist()
def get_unresolved_invoices(project=None):
    """The work queue: EXTRACTION-FAILED invoices only — active (Pending/Approved,
    non-credit-note) invoices on a MISMATCH PO that still have NO line mappings
    (i.e. extraction couldn't pass the match gate). project=None -> all projects.

    Used AFTER the extraction batch runs: whatever is still unmapped on a MISMATCH
    PO is precisely the failed set."""
    _require_admin()
    from nirmaan_stack.patches.v3_0.backfill_invoice_qty import (
        _find_mismatched, _active_invoices, _has_lines,
    )

    out = []
    proj_names = {}                                       # project id -> human name (cached)
    for po in _find_mismatched(project or None):
        po_doc = frappe.get_doc("Procurement Orders", po)
        if po_doc.project not in proj_names:
            proj_names[po_doc.project] = frappe.db.get_value(
                "Projects", po_doc.project, "project_name") or po_doc.project
        for inv in _active_invoices(po):
            if _has_lines(inv.name):
                continue                                  # passed extraction -> drop from queue
            att = (frappe.db.get_value("Nirmaan Attachments", inv.invoice_attachment, "attachment")
                   if inv.invoice_attachment else None)
            out.append({
                "po": po, "project": po_doc.project,
                "project_name": proj_names[po_doc.project], "invoice": inv.name,
                "invoice_no": inv.invoice_no, "amount": inv.invoice_amount,
                "status": inv.status, "attachment_url": att,
            })
    return out


@frappe.whitelist()
def analyze_invoice(invoice):
    """Re-run the AI extraction on ONE failed invoice and return the extraction +
    proposed line->PO-item mapping so the admin can correct it in the browser.

    READ-ONLY on the invoice file (extract_invoice_fields only reads the bytes via a
    presigned GET / local get_content — it never uploads, replaces, or modifies it).
    Returns {ok: False, error} and writes NOTHING when the file is missing / unreadable
    or the model returned no line items."""
    _require_admin()
    from nirmaan_stack.api.invoice_autofill import extract_invoice_fields

    vi = frappe.get_doc("Vendor Invoices", invoice)
    fu = (frappe.db.get_value("Nirmaan Attachments", vi.invoice_attachment, "attachment")
          if vi.invoice_attachment else None)
    if not fu:
        return {"ok": False, "error": "No invoice file attached."}
    try:
        res = extract_invoice_fields(fu, docname=vi.document_name)
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}

    lm = (res or {}).get("line_match") or {}
    if not lm.get("mappings"):
        return {"ok": False, "error": "AI could not read any line items from this file."}
    return {"ok": True, "extracted": res}


@frappe.whitelist()
def resolve_invoice(invoice, line_match, extracted=None):
    """Persist the admin-corrected mapping + full autofill fields, then recompute the
    PO. Uses the SAME builder the real extraction path uses (build_line_mapping_rows)
    and mirrors _apply_autofill. `modified` is preserved (backfill, not a user edit)."""
    _require_admin()
    from nirmaan_stack.api.delivery_notes.update_invoice_data import build_line_mapping_rows
    from nirmaan_stack.api.invoices._item_billing_sync import recompute_po_invoice_qty

    if isinstance(line_match, str):
        line_match = json.loads(line_match)
    if isinstance(extracted, str):
        extracted = json.loads(extracted) if extracted else {}
    extracted = extracted or {}

    vi = frappe.get_doc("Vendor Invoices", invoice)
    po_doc = frappe.get_doc("Procurement Orders", vi.document_name)

    rows = build_line_mapping_rows(json.dumps(line_match), po_doc)
    if not rows:
        frappe.throw("Nothing to save — re-run Analyze first.")

    orig_m, orig_mb = vi.modified, vi.modified_by       # preserve modified
    _apply_autofill(vi, extracted, line_match, rows)
    vi.save(ignore_permissions=True)
    frappe.db.set_value("Vendor Invoices", vi.name,
                        {"modified": orig_m, "modified_by": orig_mb}, update_modified=False)
    recompute_po_invoice_qty(vi.document_name)
    frappe.db.commit()

    # Flip this invoice's extraction_cache.json entry from 'failed' -> 'mapped', so a fix done
    # in the UI on the test server ships to prod with the cache (best-effort: the DB is the
    # source of truth; a cache-write hiccup must not fail the resolve).
    try:
        from nirmaan_stack.patches.v3_0.backfill_invoice_qty import upsert_cache_entry, _mapped_entry
        upsert_cache_entry(_mapped_entry(vi))
    except Exception:
        frappe.log_error(frappe.get_traceback(), "temp_resolve: cache update failed")

    matched = sum(1 for r in rows if r.get("match_status") == "Matched")
    return {"ok": True, "po": vi.document_name, "mapped": matched}
