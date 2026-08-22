"""
Re-check the two PO-value ceilings on Pending invoices, and approve what clears.

WHY THIS EXISTS. Auto-approval runs ONCE, inline at invoice creation
(`_auto_approve.py`). Its verdict is a snapshot, and of the thirteen gates only
gates 9 & 10 read data that keeps moving afterwards — they are computed off the
PO, and the PO gets delivered, revised and invoiced against long after the
invoice was filed. The most common blocker in the queue by far is
`nothing_delivered_yet`: the invoice simply arrived before its Delivery Note.
Nothing re-opens the question when the DN lands, so the invoice sits behind a
reason that stopped being true.

SCOPE — DELIBERATELY THE TWO CEILING GATES, NOTHING ELSE (owner ruling).
Only the four `CEILING_GATE_TOKENS` are re-evaluated and rewritten:

    nothing_delivered_yet     the PO records no delivery
    would_exceed_delivered    invoiced total is past what arrived
    would_exceed_po_total     invoiced total is past the order's value
    po_total_invalid          the PO has no usable total (same gate as above)

Every OTHER stored reason is carried through UNTOUCHED. The re-check does not
re-read the invoice, re-run the AI extraction, re-check GSTINs, re-reconcile
amounts or look for duplicates — those gates read the invoice, which does not
change on its own, and re-judging them under today's rules would hold back
invoices for reasons their reviewer never saw. If a stored reason is wrong, the
fix is to correct the invoice, not to press this button.

CANDIDATES. An invoice is in scope only when it is Pending, sits on a
Procurement Order, and already carries at least one ceiling token. Anything else
— a Work Order invoice, a PO invoice blocked on something unrelated, a row the
gates never judged — is NOT A CANDIDATE and never appears in a run. This is what
keeps the result readable: the queue is mostly Work Orders and unrelated
blockers, and listing them as "still blocked" would bury the handful of rows the
run is actually about.

OUTCOMES. A run moves an invoice Pending → Approved, or leaves it Pending. It
never un-approves and never touches a row that is not Pending.

  approved   both ceilings pass AND the invoice carried no other reason →
             Approved, `approved_by` "System", reasons cleared.
  cleared    both ceilings pass but another reason survives → stays Pending on
             that reason alone. The ceiling token is dropped, so the queue stops
             showing a blocker that is no longer true. One surviving reason is
             enough to hold the invoice: the re-check has no opinion on it.
  blocked    a ceiling still fails. The token is rewritten (a partial delivery
             turns `nothing_delivered_yet` into `would_exceed_delivered`), and
             when it is unchanged NOTHING is written at all — no change, nothing
             to record, and a sweep must not bump `modified` on rows it did not
             touch, since the pending queue sorts by it.

Writes go through `doc.save()`, never `db.set_value`: this is a real
user-initiated update, so it should bump `modified`, and Vendor Invoices carries
`track_changes` so the save lands a Version row with the before/after reasons.
The save is also what fires `vendor_invoices.recompute_parent_total`, which the
approve path REQUIRES — the parent's `amount_invoiced` is an Approved-only sum.
"""

import json

import frappe
from frappe import _

from nirmaan_stack.api.invoices._auto_approve import (
    CEILING_GATE_TOKENS,
    apply_auto_approval,
    ceiling_figures,
    ceiling_reasons,
)
from nirmaan_stack.api.invoices._item_billing_sync import recompute_po_invoice_qty
from nirmaan_stack.services.role_profiles import can_action_invoice_approvals

# Upper bound on one sweep — clear of today's queue, but it stops an unbounded
# scan if the backlog ever runs away. A truncated sweep says so in the response
# rather than quietly covering less than the caller asked for.
MAX_SWEEP_INVOICES = 500


def _parse_tokens(raw):
    """`auto_approve_skip_reasons` is a comma-joined token list. Split it."""
    return [t.strip() for t in (raw or "").split(",") if t.strip()]


def is_candidate(doc_or_row):
    """True when a re-check could change this invoice's answer.

    Pending, on a PO, and already blocked on at least one ceiling. A row failing
    this is not reported as skipped — it is simply not part of the run.
    """
    get = doc_or_row.get
    if get("status") != "Pending":
        return False
    if get("document_type") != "Procurement Orders":
        return False
    tokens = set(_parse_tokens(get("auto_approve_skip_reasons")))
    return bool(tokens & set(CEILING_GATE_TOKENS))


def _outcome(doc, before, after, outcome, figures=None):
    """One row of the response — the same shape for every outcome."""
    before_set, after_set = set(before), set(after)
    return {
        "invoice_id": doc.name,
        "document_type": doc.document_type,
        "document_name": doc.document_name,
        "invoice_no": doc.invoice_no,
        "invoice_amount": float(doc.invoice_amount or 0),
        "vendor": doc.vendor,
        "before": sorted(before_set),
        "after": sorted(after_set),
        "cleared": sorted(before_set - after_set),
        "outcome": outcome,
        # The numbers the two checks compared, so the dialog can show WHY this
        # passes rather than only asserting that it does.
        "po_total": (figures or {}).get("po_total"),
        "po_delivered": (figures or {}).get("po_delivered"),
        "cumulative": (figures or {}).get("cumulative"),
    }


def _recheck_one(invoice_id, dry_run):
    """Re-evaluate one candidate's ceilings. Writes (and commits) unless dry_run."""
    doc = frappe.get_doc("Vendor Invoices", invoice_id)
    before = _parse_tokens(doc.auto_approve_skip_reasons)

    # Everything the re-check does not own, kept exactly as recorded.
    carried = [t for t in before if t not in CEILING_GATE_TOKENS]
    figures = ceiling_figures(doc, doc.document_name)
    ceilings = ceiling_reasons(figures)
    after = carried + ceilings

    if not ceilings and not carried:
        if not dry_run:
            apply_auto_approval(doc)
            doc.save(ignore_permissions=True)
            # `_item_billing_sync` counts a PO fully billed only when every
            # counted invoice is Approved, so the status change matters there.
            recompute_po_invoice_qty(doc.document_name)
            _log_approval(doc, before)
            frappe.db.commit()
        return _outcome(doc, before, [], "approved", figures)

    if set(after) == set(before):
        # Nothing changed — nothing to write.
        return _outcome(doc, before, after, "blocked", figures)

    if not dry_run:
        apply_auto_approval(doc, fail_reasons=after)
        doc.save(ignore_permissions=True)
        frappe.db.commit()
    return _outcome(
        doc, before, after, "cleared" if not ceilings else "blocked", figures
    )


def _log_approval(doc, before):
    """Timeline note naming who ran the re-check and what cleared.

    Auto-approval at creation and auto-approval on re-check both land as
    `auto_approved = 1, approved_by = "System"` — correct either way, the system
    approved it — but that leaves nothing saying a person pressed a button to
    make it happen. The comment carries it, with no schema change.
    """
    cleared = ", ".join(sorted(before)) or "no recorded reason"
    doc.add_comment(
        "Info",
        _("Auto-approved on re-check by {0}. Cleared: {1}.").format(
            frappe.session.user, cleared
        ),
    )


def _summarise(results, dry_run, truncated=0):
    counts = {"approved": 0, "cleared": 0, "blocked": 0, "failed": 0}
    approved_value = 0.0
    for row in results:
        counts[row["outcome"]] = counts.get(row["outcome"], 0) + 1
        if row["outcome"] == "approved":
            approved_value += row["invoice_amount"]
    return {
        "status": 200,
        "dry_run": bool(dry_run),
        "checked": len(results),
        "truncated": truncated,
        "counts": counts,
        "approved_value": approved_value,
        "results": results,
    }


def _require_access():
    user = frappe.session.user
    if user == "Guest":
        frappe.throw(_("You must be logged in to perform this action."))
    if not can_action_invoice_approvals(user):
        frappe.throw(
            _("You are not permitted to re-check invoice approvals."),
            frappe.PermissionError,
        )


def _run(invoice_ids, dry_run, truncated=0):
    """Shared driver. Each invoice is isolated — one failure cannot abort a run."""
    results = []
    for invoice_id in invoice_ids:
        try:
            results.append(_recheck_one(invoice_id, dry_run))
        except Exception as exc:
            frappe.db.rollback()
            frappe.log_error(
                title="Invoice ceiling re-check failed",
                message=f"{invoice_id}\n{frappe.get_traceback()}",
            )
            results.append({
                "invoice_id": invoice_id,
                "outcome": "failed",
                "before": [],
                "after": [],
                "cleared": [],
                "invoice_amount": 0.0,
                "detail": str(exc),
            })
    return _summarise(results, dry_run, truncated)


@frappe.whitelist()
def recheck_auto_approve(invoice_ids, dry_run=False):
    """Re-check the ceilings on the given invoices. Non-candidates are dropped."""
    _require_access()

    if isinstance(invoice_ids, str):
        invoice_ids = json.loads(invoice_ids)
    if not invoice_ids:
        frappe.throw(_("At least one invoice ID is required."))

    dry_run = frappe.parse_json(dry_run) if isinstance(dry_run, str) else bool(dry_run)

    rows = frappe.get_all(
        "Vendor Invoices",
        filters={"name": ["in", invoice_ids]},
        fields=["name", "status", "document_type", "auto_approve_skip_reasons"],
        limit_page_length=0,
    )
    candidates = [r.name for r in rows if is_candidate(r)]
    truncated = max(0, len(candidates) - MAX_SWEEP_INVOICES)
    return _run(candidates[:MAX_SWEEP_INVOICES], dry_run, truncated)


@frappe.whitelist()
def recheck_pending_queue(dry_run=False):
    """Re-check the ceilings across every candidate in the Pending queue.

    Deliberately NOT scoped to the caller's current table filters: this is
    pressed to clear the backlog, and a sweep covering only the rows a facet
    happened to be showing would report a queue total it had not checked.
    """
    _require_access()

    dry_run = frappe.parse_json(dry_run) if isinstance(dry_run, str) else bool(dry_run)

    rows = frappe.get_all(
        "Vendor Invoices",
        filters={"status": "Pending"},
        fields=["name", "status", "document_type", "auto_approve_skip_reasons"],
        order_by="creation asc",
        limit_page_length=0,
    )
    candidates = [r.name for r in rows if is_candidate(r)]
    truncated = max(0, len(candidates) - MAX_SWEEP_INVOICES)
    return _run(candidates[:MAX_SWEEP_INVOICES], dry_run, truncated)
