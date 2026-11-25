"""The figures ADR-0050's rules 2 and 3 compare for a Work Order invoice, read as they stand now.

The rules are the pure `services/work_order_invoice_rules.rule_reasons`; this reads the Work Order and its
invoices and payments for them. Used at upload (`_auto_approve.evaluate_auto_approve_eligibility`) and by the
05:00 re-check (`recheck_auto_approve`), so both judge the same figures.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.invoices._item_billing_sync import invoiced_of
from nirmaan_stack.services import work_order_invoice_rules as rules
from nirmaan_stack.services.amount_paid import gst_part_of_amount_paid
from nirmaan_stack.services.work_order_gst import gst_is_on

WORK_ORDER = "Service Requests"


def wo_rule_reasons(invoice_doc) -> list[str]:
    """[] when rule 2 or 3 approves `invoice_doc`, else the reasons with their figures."""
    return rules.rule_reasons(wo_figures(invoice_doc))


def unsigned_copy_reasons(invoice_doc) -> list[str]:
    """[] when rule 2 or 3 approves a generated invoice's copy the AI found unsigned (rule 1 can't), else the
    unsigned reason first, then the two rules' reasons with their figures (ADR-0050 decision 1)."""
    reasons = wo_rule_reasons(invoice_doc)
    return [rules.COPY_NOT_SIGNED, *reasons] if reasons else []


def wo_figures(invoice_doc) -> dict:
    """The figures `rule_reasons` takes, for a Pending invoice (the only kind judged), so the Approved sums
    never hold it."""
    wo = frappe.db.get_value(WORK_ORDER, invoice_doc.document_name, ["total_amount", "amount_paid", "gst"],
                             as_dict=True) or {}
    approved_amount, approved_gst = invoiced_of(WORK_ORDER, invoice_doc.document_name)
    return {
        "gst_on": gst_is_on(wo.get("gst")),
        "total_amount": flt(wo.get("total_amount")),
        "amount_paid": flt(wo.get("amount_paid")),
        "gst_paid": gst_part_of_amount_paid(WORK_ORDER, invoice_doc.document_name),
        "approved_amount": approved_amount,
        "approved_gst": approved_gst,
        "invoice_amount": flt(invoice_doc.get("invoice_amount")),
        "invoice_gst": flt(invoice_doc.get("invoice_gst_amount")),
    }

