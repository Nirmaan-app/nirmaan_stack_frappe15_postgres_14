"""
Auto-approve eligibility evaluation for Vendor Invoices.

Called inline from update_invoice_data after invoice.insert(). When every gate
below passes, the invoice flips Pending → Approved in the same transaction
with approved_by="System". When any gate fails, behaviour is unchanged — the
invoice stays Pending for human review and the failure reasons are persisted
to `auto_approve_skip_reasons` for audit and threshold tuning.

See plan: /Users/nirmaanapple002/.claude/plans/so-in-vendor-invoice-humble-hickey.md
"""

import json

import frappe
from frappe.utils import getdate, now, today

from nirmaan_stack.api.invoices._validation import (
    existing_invoiced_sum,
    normalize_gstin,
)


# ---- Tunable knobs ----------------------------------------------------------
# Per-field AI confidence required for auto-approve (gate 5).
AUTO_APPROVE_CONFIDENCE_THRESHOLD = 0.80
# ₹ tolerance for cumulative amount checks (gates 9 & 10). Matches the
# existing `_check_po_amount_overage` tolerance in update_invoice_data.py.
AMOUNT_TOLERANCE_RUPEES = 10
# Currency comparison tolerance — guards against float wobble when comparing
# stored Currency values to extracted string amounts.
AMOUNT_EQUALITY_EPSILON = 0.01


def evaluate_auto_approve_eligibility(invoice_doc, parent_doc, autofill_source_file_url):
    """Return (eligible: bool, fail_reasons: list[str]).

    Each gate appends a short machine-readable token to fail_reasons. The
    caller persists this list to `auto_approve_skip_reasons` so reviewers can
    later see why an invoice was kicked to manual.
    """
    reasons = []

    # Gate 1: AI extraction was used (not manual typing).
    if not invoice_doc.get("autofill_used"):
        reasons.append("autofill_not_used")

    # Gate 2: PO invoice (not Service Request).
    if invoice_doc.get("document_type") != "Procurement Orders":
        reasons.append("not_procurement_order")

    # Gate 3: File is attached.
    if not invoice_doc.get("invoice_attachment"):
        reasons.append("no_attachment")

    # Gate 4: Submitted values strictly equal AI-extracted values.
    submitted_no = (invoice_doc.get("invoice_no") or "").strip()
    extracted_no = (invoice_doc.get("autofill_extracted_invoice_no") or "").strip()
    if submitted_no != extracted_no:
        reasons.append("invoice_no_edited")

    submitted_date = str(invoice_doc.get("invoice_date") or "").strip()[:10]
    extracted_date = str(invoice_doc.get("autofill_extracted_invoice_date") or "").strip()[:10]
    if submitted_date != extracted_date:
        reasons.append("invoice_date_edited")

    try:
        submitted_amount = float(invoice_doc.get("invoice_amount") or 0)
        extracted_amount = float(invoice_doc.get("autofill_extracted_amount") or 0)
        if abs(submitted_amount - extracted_amount) > AMOUNT_EQUALITY_EPSILON:
            reasons.append("invoice_amount_edited")
    except (TypeError, ValueError):
        reasons.append("invoice_amount_unparseable")

    # Gate 5: Per-field confidence ≥ threshold for invoice_no, invoice_date, amount.
    confidence = _parse_confidence(invoice_doc.get("autofill_confidence_json"))
    for field in ("invoice_no", "invoice_date", "amount"):
        try:
            field_conf = float(confidence.get(field) or 0)
        except (TypeError, ValueError):
            field_conf = 0.0
        if field_conf < AUTO_APPROVE_CONFIDENCE_THRESHOLD:
            reasons.append(f"low_confidence_{field}")

    # Resolve AI-extracted GSTINs + PO number. Prefer dedicated columns where
    # available; fall back to parsing autofill_all_entities_json for older
    # rows or for entities (like purchase_order) we don't pin to columns.
    entities = _parse_entities(invoice_doc.get("autofill_all_entities_json"))
    ai_supplier_gstin = (
        invoice_doc.get("autofill_extracted_supplier_gstin")
        or entities.get("supplier_gstin", "")
    )
    ai_receiver_gstin = (
        invoice_doc.get("autofill_extracted_receiver_gstin")
        or entities.get("receiver_gstin", "")
    )
    ai_purchase_order = entities.get("purchase_order", "")

    # Gate 6: Supplier GSTIN matches the vendor's master GSTIN.
    vendor_gst = ""
    if parent_doc and parent_doc.get("vendor"):
        vendor_gst = frappe.db.get_value("Vendors", parent_doc.get("vendor"), "vendor_gst") or ""
    if not normalize_gstin(vendor_gst):
        reasons.append("vendor_gst_not_configured")
    elif not normalize_gstin(ai_supplier_gstin):
        reasons.append("supplier_gstin_not_extracted")
    elif normalize_gstin(ai_supplier_gstin) != normalize_gstin(vendor_gst):
        reasons.append("supplier_gstin_mismatch")

    # Gate 7: Receiver GSTIN matches the PO's project_gst.
    project_gst = (parent_doc.get("project_gst") if parent_doc else "") or ""
    if not normalize_gstin(project_gst):
        reasons.append("project_gst_not_configured")
    elif not normalize_gstin(ai_receiver_gstin):
        reasons.append("receiver_gstin_not_extracted")
    elif normalize_gstin(ai_receiver_gstin) != normalize_gstin(project_gst):
        reasons.append("receiver_gstin_mismatch")

    # Gate 8: AI must have extracted a `purchase_order` entity AND it must
    # match the PO this invoice was attached to.
    docname = invoice_doc.get("document_name") or ""
    if not (ai_purchase_order or "").strip():
        reasons.append("po_number_not_extracted")
    elif _norm_compare(ai_purchase_order) != _norm_compare(docname):
        reasons.append("po_number_mismatch")

    # Gates 9 & 10: cumulative amount checks against PO total and delivered.
    # Skip if not a PO (gate 2 already failed) — but still emit the gate-level
    # reasons so the audit log is informative.
    if invoice_doc.get("document_type") == "Procurement Orders":
        po_info = (
            frappe.db.get_value(
                "Procurement Orders",
                docname,
                ["total_amount", "po_amount_delivered"],
                as_dict=True,
            )
            or {}
        )
        try:
            po_total = float(po_info.get("total_amount") or 0)
        except (TypeError, ValueError):
            po_total = 0.0
        try:
            po_delivered = float(po_info.get("po_amount_delivered") or 0)
        except (TypeError, ValueError):
            po_delivered = 0.0
        try:
            new_amount = float(invoice_doc.get("invoice_amount") or 0)
        except (TypeError, ValueError):
            new_amount = 0.0

        # The invoice has just been inserted, so it's already in
        # existing_invoiced_sum. Exclude it and add new_amount separately so
        # the math reads cleanly.
        prior_sum = existing_invoiced_sum(docname, exclude_invoice_id=invoice_doc.name)
        cumulative = prior_sum + new_amount

        # Gate 9: Cumulative ≤ PO total + tolerance.
        if po_total <= 0:
            reasons.append("po_total_invalid")
        elif cumulative > po_total + AMOUNT_TOLERANCE_RUPEES:
            reasons.append("would_exceed_po_total")

        # Gate 10: Cumulative ≤ delivered + tolerance.
        if po_delivered <= 0:
            reasons.append("nothing_delivered_yet")
        elif cumulative > po_delivered + AMOUNT_TOLERANCE_RUPEES:
            reasons.append("would_exceed_delivered")

    # Gate 11: invoice_date is not in the future.
    try:
        if getdate(invoice_doc.get("invoice_date")) > getdate(today()):
            reasons.append("invoice_date_in_future")
    except Exception:
        reasons.append("invoice_date_unparseable")

    # Gate 12: No duplicate (vendor + invoice_no) anywhere — excluding self.
    if invoice_doc.get("vendor") and invoice_doc.get("invoice_no"):
        duplicate = frappe.db.sql(
            """
            SELECT name FROM "tabVendor Invoices"
            WHERE vendor = %(vendor)s
              AND invoice_no = %(invoice_no)s
              AND name != %(self_name)s
            LIMIT 1
            """,
            {
                "vendor": invoice_doc.get("vendor"),
                "invoice_no": invoice_doc.get("invoice_no"),
                "self_name": invoice_doc.name,
            },
        )
        if duplicate:
            reasons.append("duplicate_invoice_no")

    # Gate 13: File swap guard — file_url AI extracted from must equal the
    # file_url of the saved invoice_attachment.
    if not autofill_source_file_url:
        reasons.append("source_file_url_missing")
    else:
        attached_url = None
        if invoice_doc.get("invoice_attachment"):
            attached_url = frappe.db.get_value(
                "Nirmaan Attachments",
                invoice_doc.get("invoice_attachment"),
                "attachment",
            )
        if (attached_url or "") != autofill_source_file_url:
            reasons.append("file_swap_detected")

    return (len(reasons) == 0), reasons


def apply_auto_approval(invoice_doc, fail_reasons=None):
    """Stamp auto-approval fields on the invoice doc. Caller saves + commits.

    Pass `fail_reasons=None` for the pass case (clears any prior skip reasons).
    Pass the list of reason tokens to persist them when staying Pending.
    """
    if fail_reasons:
        invoice_doc.auto_approve_skip_reasons = ",".join(fail_reasons)
        return
    invoice_doc.status = "Approved"
    invoice_doc.approved_by = "System"
    invoice_doc.approved_on = now()
    invoice_doc.auto_approved = 1
    invoice_doc.auto_approve_skip_reasons = None


# ---- Internal helpers -------------------------------------------------------


def _parse_confidence(json_str):
    if not json_str:
        return {}
    try:
        parsed = json.loads(json_str)
    except (TypeError, ValueError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    return parsed


def _parse_entities(json_str):
    """Flatten autofill_all_entities_json into a {type: value} dict.

    First occurrence wins for repeated types — Document AI sometimes returns
    duplicate entities for the same field type and we already pick the highest-
    confidence one upstream in invoice_autofill.py.
    """
    if not json_str:
        return {}
    try:
        parsed = json.loads(json_str)
    except (TypeError, ValueError):
        return {}
    if not isinstance(parsed, list):
        return {}
    flat = {}
    for entity in parsed:
        if not isinstance(entity, dict):
            continue
        t = (entity.get("type") or "").lower().strip()
        v = (entity.get("value") or "").strip()
        if t and v and t not in flat:
            flat[t] = v
    return flat


def _norm_compare(value):
    """Case-insensitive whitespace-trimmed equality."""
    return (value or "").strip().lower()
