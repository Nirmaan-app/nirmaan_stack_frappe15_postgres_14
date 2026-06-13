import frappe

from nirmaan_stack.api.invoices._line_match import match_invoice_lines_to_po
from nirmaan_stack.api.invoices._validation import (
    existing_invoiced_sum,
    gstin_match,
)
from nirmaan_stack.services.extraction import extract
from nirmaan_stack.services.extraction.mapping import gemini_map_residue
from nirmaan_stack.services.extraction.files import (
    SUPPORTED_EXTS,
    fetch_file_content,
    get_extraction_settings,
)
from nirmaan_stack.services.extraction.helpers import (
    get_file_doc_by_url,
    normalize_amount,
    normalize_date,
    pick_entity,
)
from nirmaan_stack.services.extraction.validation import (
    reconcile_amounts,
    reconcile_line_items,
    validate_date,
    validate_gstin,
)

MIN_CONFIDENCE = 0.70

INVOICE_NO_KEYS = ("invoice_id", "invoice_number", "invoice_no")
INVOICE_DATE_KEYS = ("invoice_date",)
# `total_amount` (grand total, incl. tax) — never fall back to `net_amount`
# because the form field labeled "Amount (Incl. GST)" must always be the
# tax-inclusive total. If the model misses total_amount, leave it blank.
AMOUNT_KEYS = ("total_amount",)
# `net_amount` (pre-tax subtotal) — surfaced separately for forms that have
# a distinct "Amount (Excl. GST)" field (currently Project Invoices).
NET_AMOUNT_KEYS = ("net_amount",)
# Validation-only entities — used to reconcile amounts, never populated into the form.
TAX_KEYS = ("total_tax_amount",)
ROUND_OFF_KEYS = ("round_off",)
OTHER_CHARGES_KEYS = ("other_charges",)
TCS_KEYS = ("tcs_amount",)


@frappe.whitelist()
def extract_invoice_fields(file_url, docname=None):
    """Extract invoice number, date, total amount and line items from an invoice.

    Called from the Add Invoice dialog when the user picks a file in Auto-fill
    mode. Extracted values populate the form; a deterministic validation layer
    (GSTIN checksum, amount reconciliation, line-item self-reconcile) surfaces soft
    warnings and gates auto-approval. The response is never persisted server-side.

    When `docname` is a Procurement Order, the response also includes `line_match`
    (each invoice line mapped to a PO item — fuzzy-first, Gemini-resolved residue)
    and `po_items` (the PO's items, so the dialog can render/correct the mapping).
    """
    if not file_url:
        frappe.throw("file_url is required")

    file_doc = get_file_doc_by_url(file_url)
    if not file_doc:
        frappe.throw(f"No File record found for url: {file_url}")

    if not file_doc.file_name:
        frappe.throw("File has no file_name; cannot determine type.")

    file_ext = file_doc.file_name.rsplit(".", 1)[-1].lower()
    if file_ext not in SUPPORTED_EXTS:
        frappe.throw(f"Unsupported file type: .{file_ext}. Allowed: {sorted(SUPPORTED_EXTS)}")

    settings = get_extraction_settings()
    if not settings.get("enabled"):
        frappe.throw("Document extraction is disabled. Please enable it in Document AI Settings.")

    content = fetch_file_content(file_doc, file_doc.name)
    if not content:
        frappe.throw("Could not read file content.")

    _, entities, line_items = extract(content, file_ext, settings, doc_kind="invoice")

    invoice_no, invoice_no_conf = pick_entity(entities, INVOICE_NO_KEYS)
    invoice_date, invoice_date_conf = pick_entity(entities, INVOICE_DATE_KEYS, prefer_normalized=True)
    amount, amount_conf = pick_entity(entities, AMOUNT_KEYS, prefer_normalized=True)
    net_amount, net_amount_conf = pick_entity(entities, NET_AMOUNT_KEYS, prefer_normalized=True)
    supplier_gstin, _ = pick_entity(entities, ("supplier_gstin",))
    receiver_gstin, _ = pick_entity(entities, ("receiver_gstin",))
    # Validation-only picks (not returned as form fields).
    tax_amount, _ = pick_entity(entities, TAX_KEYS, prefer_normalized=True)
    round_off, _ = pick_entity(entities, ROUND_OFF_KEYS, prefer_normalized=True)
    other_charges, _ = pick_entity(entities, OTHER_CHARGES_KEYS, prefer_normalized=True)
    tcs_amount, _ = pick_entity(entities, TCS_KEYS, prefer_normalized=True)

    # Slimmed-down view of every entity returned. Persisted on Vendor Invoices
    # on submit so reviewers (and the auto-approve gates) can see the full
    # extraction without re-running it.
    all_entities = [
        {
            "type": (entity.get("type") or "").strip(),
            "value": (entity.get("normalized_text") or entity.get("mention_text") or "").strip(),
            "confidence": round(float(entity.get("confidence") or 0), 3),
        }
        for entity in (entities or [])
        if (entity.get("type") or "").strip()
        and ((entity.get("normalized_text") or entity.get("mention_text") or "").strip())
    ]

    normalized_amount = normalize_amount(amount) if amount_conf >= MIN_CONFIDENCE else ""
    normalized_net_amount = normalize_amount(net_amount) if net_amount_conf >= MIN_CONFIDENCE else ""
    validation = _build_validation(
        file_doc,
        normalized_amount,
        supplier_gstin,
        receiver_gstin,
        net=net_amount,
        tax=tax_amount,
        total=amount,
        invoice_date=invoice_date,
        round_off=round_off,
        other_charges=other_charges,
        tcs=tcs_amount,
    )

    # Self-consistency scorecard for the extracted line-item table (per-line
    # qty*rate ≈ amount + Σ ≈ net_amount). Computed trust, not model-reported —
    # surfaced for the Review UI. net_amount is the raw extracted subtotal.
    line_item_validation = reconcile_line_items(line_items, net_amount)

    # PO line-item mapping — only when the invoice is attached to a PO and we got
    # line items. Fuzzy-match locally first; Gemini resolves the leftover residue
    # (re-verified numerically). po_items is returned so the dialog can render the
    # mapping + power the per-row correction dropdown without a second fetch.
    line_match = None
    po_items_out = []
    if docname and line_items and frappe.db.exists("Procurement Orders", docname):
        po_items_out = _po_items_for_match(docname)
        if po_items_out:
            line_match = match_invoice_lines_to_po(
                line_items,
                po_items_out,
                residue_mapper=lambda rl, cp: gemini_map_residue(rl, cp, settings),
            )

    return {
        "invoice_no": invoice_no if invoice_no_conf >= MIN_CONFIDENCE else "",
        "invoice_date": normalize_date(invoice_date) if invoice_date_conf >= MIN_CONFIDENCE else "",
        "amount": normalized_amount,
        "net_amount": normalized_net_amount,
        # Surface the raw extracted GSTINs so the frontend can persist them to
        # the Vendor Invoice on submit (auto-approve gates 6 & 7 read them).
        "supplier_gstin": (supplier_gstin or "").strip(),
        "receiver_gstin": (receiver_gstin or "").strip(),
        "confidence": {
            "invoice_no": round(invoice_no_conf, 3),
            "invoice_date": round(invoice_date_conf, 3),
            "amount": round(amount_conf, 3),
            "net_amount": round(net_amount_conf, 3),
        },
        "entities": all_entities,
        "line_items": line_items,
        "line_item_validation": line_item_validation,
        "line_match": line_match,
        "po_items": po_items_out,
        "min_confidence": MIN_CONFIDENCE,
        "processor_id": settings.get("gemini_model"),
        "validation": validation,
    }


def _po_items_for_match(po_name):
    """The PO's item rows, shaped for matching + the frontend correction dropdown.

    Reads via the parent doc (get_doc) rather than get_all on the child table:
    `Purchase Order Item` is an istable child with no DocPerm, so a direct child
    read raises PermissionError for non-admin autofill users — but the parent PO
    read respects the access the invoicing user already has. (Same approach as
    api/procurement_orders.generate_po_summary.)
    """
    po = frappe.get_doc("Procurement Orders", po_name)
    return [
        {
            "item_id": it.item_id,
            "item_name": it.item_name,
            "unit": it.unit,
            "quantity": it.quantity,
            "received_quantity": it.received_quantity,
            "quote": it.quote,
            "amount": it.amount,
        }
        for it in (po.items or [])
    ]


def _build_validation(
    file_doc,
    extracted_amount,
    extracted_supplier_gstin,
    extracted_receiver_gstin,
    *,
    net="",
    tax="",
    total="",
    invoice_date="",
    round_off="",
    other_charges="",
    tcs="",
):
    """Compute validation status for the frontend banners + auto-approve.

    Two kinds of check:
      * PO cross-checks (amount overage, GSTIN vs vendor/project master) — only
        when the file is attached to a Procurement Order.
      * Deterministic intrinsic checks (GSTIN checksum, amount reconciliation,
        date sanity) — always, independent of the parent doctype.
    """
    parent_doctype = (file_doc.attached_to_doctype or "").strip()
    parent_name = (file_doc.attached_to_name or "").strip()

    result = {
        "applicable": False,
        "doctype": parent_doctype,
        "docname": parent_name,
        "amount": None,
        "supplier_gstin": None,
        "receiver_gstin": None,
        # Deterministic, always present:
        "gstin_checksum": {
            "supplier": validate_gstin(extracted_supplier_gstin),
            "receiver": validate_gstin(extracted_receiver_gstin),
        },
        "amount_reconciliation": reconcile_amounts(
            net, tax, total, round_off=round_off, other_charges=other_charges, tcs=tcs
        ),
        "date_validity": validate_date(invoice_date, normalize_date),
    }

    # Only POs have full cross-check context; SR / Project Invoices skip it.
    if parent_doctype != "Procurement Orders" or not parent_name:
        return result

    try:
        po = frappe.db.get_value(
            "Procurement Orders",
            parent_name,
            ["total_amount", "project_gst", "vendor"],
            as_dict=True,
        )
    except Exception:
        return result
    if not po:
        return result

    result["applicable"] = True

    # --- Amount overage check ---
    po_total = float(po.get("total_amount") or 0)
    existing_sum = existing_invoiced_sum(parent_name)
    new_amount = 0.0
    try:
        new_amount = float(extracted_amount) if extracted_amount else 0.0
    except (TypeError, ValueError):
        new_amount = 0.0
    would_be_total = existing_sum + new_amount
    # Tolerate up to ₹10 of rounding drift — must match the hard-block threshold
    # in update_invoice_data._check_po_amount_overage.
    would_exceed = po_total > 0 and would_be_total > po_total + 10
    result["amount"] = {
        "po_total": round(po_total, 2),
        "existing_invoiced_sum": round(existing_sum, 2),
        "new_amount": round(new_amount, 2),
        "would_be_total": round(would_be_total, 2),
        "would_exceed": would_exceed,
        "message": (
            f"Total invoiced would be ₹{would_be_total:,.2f}, exceeds PO total "
            f"₹{po_total:,.2f}. Revise the amount or upload less."
            if would_exceed
            else None
        ),
    }

    # --- Supplier GSTIN check (extracted vs vendor's vendor_gst) ---
    vendor_gst = ""
    if po.get("vendor"):
        vendor_gst = (frappe.db.get_value("Vendors", po["vendor"], "vendor_gst") or "").strip()
    result["supplier_gstin"] = gstin_match(extracted_supplier_gstin, vendor_gst, "supplier")

    # --- Receiver GSTIN check (extracted vs PO.project_gst) ---
    project_gst = (po.get("project_gst") or "").strip()
    result["receiver_gstin"] = gstin_match(extracted_receiver_gstin, project_gst, "receiver")

    return result
