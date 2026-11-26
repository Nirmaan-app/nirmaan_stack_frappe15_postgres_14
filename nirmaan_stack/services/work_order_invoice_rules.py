# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""When the System approves a Work Order invoice (ADR-0050; GLOSSARY *Invoice approver*).

Three rules; one match approves:

1. **Signed copy** (GST-off WOs): the signed copy of a generated invoice is always approved; rules 2 and 3 are
   not checked for it. Its two paths are `api/service_requests/generated_invoices.upload_signed_copy` and Add
   Invoice (`generated_copy_verdict` here decides when an upload is that copy). A copy Add Invoice reads as
   unsigned (`signature_signed` false) gets no rule 1: rules 2 and 3 judge it like any WO invoice, and while
   neither matches it carries `COPY_NOT_SIGNED` before their reasons.
2. **Total Amount**: Approved WO invoices + this one = the WO's total amount (GST included), ± ₹1, even when
   only part is paid.
3. **Amount Paid**: Approved WO invoices + this one = the WO's Amount Paid (incl. vendor TDS), ± ₹1. On a GST-on
   WO the base parts only: Amount Paid less its GST payments against the invoices' base (amount less GST).

"Approved WO invoices" are Approved only, never Pending (decision 4). Rules 2 and 3 compare amounts only
(decision 7). When none matches, the reasons say why, each with the two figures it compared (decision 8):
`<name>:<left>:<right>`, stored comma-joined in `Vendor Invoices.auto_approve_skip_reasons` beside the PO
tokens. They go stale as payments move, so the daily re-check rewrites them.

PURE -- no database, no request context. `api/invoices/_wo_auto_approve.py` reads the figures.
"""

from frappe.utils import cstr, flt

#: Rupees either way that still count as equal (rules 1-3).
TOLERANCE = 1

TOTAL_MISMATCH = "wo_total_mismatch"
PAID_MISMATCH = "wo_paid_mismatch"
BASE_PAID_MISMATCH = "wo_base_paid_mismatch"
COPY_NOT_SIGNED = "wo_generated_copy_not_signed"
#: Every reason name a Work Order invoice gets from these rules. The daily re-check owns them: it rewrites them.
WO_REASON_NAMES = (TOTAL_MISMATCH, PAID_MISMATCH, BASE_PAID_MISMATCH, COPY_NOT_SIGNED)


def rule_reasons(figures) -> list[str]:
    """[] when rule 2 or rule 3 matches, else one reason per rule with its figures.

    `figures`: `gst_on`, `total_amount`, `amount_paid` (incl. vendor TDS), `gst_paid` (the WO's Paid GST
    payments), `approved_amount` / `approved_gst` (its Approved invoices' totals, this one left out), and
    `invoice_amount` / `invoice_gst` (this invoice).
    """
    total, invoiced, paid_name, paid, invoiced_for_paid = _comparisons(figures)
    if _equal(invoiced, total) or _equal(invoiced_for_paid, paid):
        return []
    return [reason(TOTAL_MISMATCH, total, invoiced), reason(paid_name, paid, invoiced_for_paid)]


def matched_rules(figures) -> list[dict]:
    """Which of rules 2 and 3 match, each with the two figures it compared: {"rule": 2 or 3, "base": True when
    rule 3 compared base amounts (GST-on), "target": WO total or Amount Paid, "invoiced": Approved + this}.
    The same arithmetic as `rule_reasons`, so a screen can say why an invoice was approved."""
    total, invoiced, paid_name, paid, invoiced_for_paid = _comparisons(figures)
    out = []
    if _equal(invoiced, total):
        out.append({"rule": 2, "base": False, "target": total, "invoiced": invoiced})
    if _equal(invoiced_for_paid, paid):
        out.append({"rule": 3, "base": paid_name == BASE_PAID_MISMATCH, "target": paid, "invoiced": invoiced_for_paid})
    return out


def _comparisons(figures):
    """(total, invoiced, paid reason name, paid, invoiced as rule 3 compares it): base amounts on a GST-on WO."""
    invoiced = flt(figures["approved_amount"]) + flt(figures["invoice_amount"])
    if figures["gst_on"]:
        paid_name = BASE_PAID_MISMATCH
        paid = flt(figures["amount_paid"]) - flt(figures["gst_paid"])
        invoiced_for_paid = invoiced - flt(figures["approved_gst"]) - flt(figures["invoice_gst"])
    else:
        paid_name, paid, invoiced_for_paid = PAID_MISMATCH, flt(figures["amount_paid"]), invoiced
    return flt(figures["total_amount"]), invoiced, paid_name, paid, invoiced_for_paid


#: `generated_copy_verdict` outcomes.
LINK = "link"
DUPLICATE = "duplicate"
#: Generated-invoice statuses whose number is already booked as a Vendor Invoice.
_UPLOADED = ("Signed", "Approved")
#: What the AI answers for a printed "Authorized Signature" box that is signed (`services/extraction/gemini.py`).
SIGNED_ANSWERS = ("signed", "stamped")
SIGNATURE_ENTITY = "authorized_signature"


def generated_copy_verdict(*, submitted_no, extracted_no, ai_read, amount, gst_off, records):
    """Is this Add Invoice upload a generated invoice's signed copy (decision 1, second path)?

    `records`: the Work Order's generated invoices (`name`, `invoice_no`, `status`, `amount`). Returns
    `(LINK, name)` when the AI read the number of one still Generated (`ai_read`, and the number submitted is
    the one read) with the amount ± ₹1, on a GST-off Work Order; `(DUPLICATE, name)` when the number (read or
    submitted) is one already Signed or Approved; else `(None, None)`: a normal Work Order invoice.
    """
    submitted, extracted = _number(submitted_no), _number(extracted_no)
    for r in records:
        if r["status"] in _UPLOADED and _number(r["invoice_no"]) in (submitted, extracted):
            return DUPLICATE, r["name"]
    if not (gst_off and ai_read and extracted and submitted == extracted):
        return None, None
    for r in records:
        if r["status"] == "Generated" and _number(r["invoice_no"]) == extracted and _equal(amount, r["amount"]):
            return LINK, r["name"]
    return None, None


def signature_signed(entities) -> bool:
    """The AI found the "Authorized Signature" box signed or stamped. `entities`: the flat {type: value} read."""
    return cstr(entities.get(SIGNATURE_ENTITY)).strip().lower() in SIGNED_ANSWERS


def _number(text) -> str:
    return cstr(text).strip().upper()


def reason(name, left, right) -> str:
    """One stored reason: its name and the two figures it compared, `<name>:<left>:<right>`."""
    return f"{name}:{flt(left):.2f}:{flt(right):.2f}"


def reason_name(token) -> str:
    """The name of a stored reason, without its figures."""
    return cstr(token).split(":", 1)[0].strip()


def _equal(a, b) -> bool:
    return abs(round(flt(a) - flt(b), 2)) <= TOLERANCE
