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

TWO RUNNERS, ONE CODE PATH. The daily job (`tasks/invoice_recheck.py`, 05:00)
sweeps the queue with no preview; the Re-check button does the same sweep (or a
single row) mid-day, preview first. Both go through `_run`, so they share the
candidate list and the per-invoice row lock below — whichever reaches an
invoice first acts on it, and the other skips it.

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

WORK ORDER INVOICES (ADR-0050 decision 5) — THE DAILY JOB AND THE WO TAB'S
BUTTON. The daily sweep also takes every Pending Work Order invoice, and so does
Re-check on the Work Order tab (its own invoices only), and judges it by rules 2 and 3
(`_wo_auto_approve.wo_rule_reasons`). A generated invoice's copy the AI found
unsigned is judged the same way, keeping its unsigned reason first
(`unsigned_copy_reasons`); a signed copy Upload signed copy left Pending before
ADR-0050 (no reason recorded) is approved by rule 1 while its Work Order is
still GST-off; once it turned GST-on, rules 2 and 3 judge it like any other
invoice on a GST-on Work Order (no signature rule there). Rules 2 and 3 are
its only rules, so its reasons are rewritten whole (an older one's PO reasons,
`not_procurement_order` and the rest, go on its first run) and it is approved
when they come back empty. Re-check on the PO tab stays PO invoices only.

CANDIDATES. A PO invoice is in scope only when it is Pending, sits on a
Procurement Order, and already carries at least one ceiling token. Anything else
— a PO invoice blocked on something unrelated, a row the gates never judged, and
for the button a Work Order invoice — is NOT A CANDIDATE and never appears in a run. This is what
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
from nirmaan_stack.api.invoices._wo_auto_approve import WORK_ORDER, unsigned_copy_reasons, wo_figures, wo_rule_reasons
from nirmaan_stack.integrations.controllers.vendor_invoices import generated_invoice_of
from nirmaan_stack.services import work_order_invoice_rules as wo_rules
from nirmaan_stack.services.role_profiles import can_action_invoice_approvals
from nirmaan_stack.services.work_order_gst import gst_is_explicitly_off

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


def is_work_order_candidate(doc_or_row):
    """True for a Pending Work Order invoice the daily re-check judges (ADR-0050 decision 5): any one, whatever it
    carries, a generated invoice's copy included."""
    get = doc_or_row.get
    return get("status") == "Pending" and get("document_type") == WORK_ORDER


def _is_unsigned_copy(doc):
    """A generated invoice's copy the AI found unsigned: Add Invoice gave it the unsigned reason."""
    names = {wo_rules.reason_name(t) for t in _parse_tokens(doc.auto_approve_skip_reasons)}
    return wo_rules.COPY_NOT_SIGNED in names


def _recheck_work_order(doc, dry_run, scheduled, signed_copy, unsigned_copy):
    """Judge a Pending Work Order invoice again (ADR-0050 decision 5). A signed copy is approved by rule 1; an
    unsigned one by rule 2 or 3, keeping its unsigned reason while neither matches. Any other's reasons are ALL its
    rules' (decision 8; an older one's PO reasons go), so they are rewritten whole, and only when they changed."""
    before = _parse_tokens(doc.auto_approve_skip_reasons)
    if signed_copy:
        after = []
    else:
        after = unsigned_copy_reasons(doc) if unsigned_copy else wo_rule_reasons(doc)
    figures = _wo_outcome_figures(doc, signed_copy)
    if not after:
        if not dry_run:
            apply_auto_approval(doc)
            doc.save(ignore_permissions=True)
            _log_approval(doc, before, scheduled)
            frappe.db.commit()
        return _outcome(doc, before, [], "approved", figures)
    if after == before:
        _release_lock(dry_run)
        return _outcome(doc, before, after, "blocked", figures)
    if not dry_run:
        apply_auto_approval(doc, fail_reasons=after)
        doc.save(ignore_permissions=True)
        frappe.db.commit()
    return _outcome(doc, before, after, "blocked", figures)


def _wo_outcome_figures(doc, signed_copy=False):
    """What the dialog shows for a Work Order invoice: Approved invoices + this one against the WO total and its
    Amount Paid (incl. TDS), and which rule matched with the figures it compared (`rules`: rule 1 for a signed copy,
    else `work_order_invoice_rules.matched_rules`). Read before any write, so this invoice is not yet Approved."""
    f = wo_figures(doc)
    return {"cumulative": f["approved_amount"] + f["invoice_amount"], "wo_total": f["total_amount"],
            "amount_paid": f["amount_paid"],
            "rules": [{"rule": 1}] if signed_copy else wo_rules.matched_rules(f)}


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
        # A Work Order invoice's: rules 2 and 3 compare `cumulative` with these.
        "wo_total": (figures or {}).get("wo_total"),
        "amount_paid": (figures or {}).get("amount_paid"),
        # Which of ADR-0050's rules matched (a Work Order invoice), each with the figures it compared.
        "rules": (figures or {}).get("rules"),
    }


def _recheck_one(invoice_id, dry_run, scheduled=False):
    """Re-evaluate one candidate's ceilings. Writes (and commits) unless dry_run.

    Returns None when the invoice stopped being a candidate after the list was
    read — approved, rejected or re-checked by someone else in the meantime.
    """
    # The candidate list is read before the loop, so re-test the row here, under
    # a lock when writing. Without it the loop acts on whatever it loads: a
    # manual approve / reject keeps the old reason tokens, so an invoice rejected
    # mid-sweep would come out Approved, and one approved by hand would have its
    # approver overwritten with "System".
    doc = frappe.get_doc("Vendor Invoices", invoice_id, for_update=not dry_run)
    if doc.document_type == WORK_ORDER:
        if not is_work_order_candidate(doc):
            _release_lock(dry_run)
            return None
        is_copy = bool(generated_invoice_of(doc.name))
        unsigned_copy = is_copy and _is_unsigned_copy(doc)
        signed_copy = is_copy and not unsigned_copy
        # Rule 1 (the signature) is for a GST-off Work Order only: a copy uploaded before its WO turned GST-on is
        # judged by rules 2 and 3, as every invoice on a GST-on WO is.
        if signed_copy and not gst_is_explicitly_off(frappe.db.get_value(WORK_ORDER, doc.document_name, "gst")):
            signed_copy = False
        return _recheck_work_order(doc, dry_run, scheduled, signed_copy, unsigned_copy)
    if not is_candidate(doc):
        _release_lock(dry_run)
        return None

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
            _log_approval(doc, before, scheduled)
            frappe.db.commit()
        return _outcome(doc, before, [], "approved", figures)

    if set(after) == set(before):
        # Nothing changed — nothing to write.
        _release_lock(dry_run)
        return _outcome(doc, before, after, "blocked", figures)

    if not dry_run:
        apply_auto_approval(doc, fail_reasons=after)
        doc.save(ignore_permissions=True)
        frappe.db.commit()
    return _outcome(
        doc, before, after, "cleared" if not ceilings else "blocked", figures
    )


def _release_lock(dry_run):
    """End the transaction holding the row lock on a path that writes nothing.

    Otherwise the lock rides along until the next invoice commits, blocking a
    reviewer's approve on that row for the rest of the sweep. A dry run takes no
    lock and must not commit.
    """
    if not dry_run:
        frappe.db.commit()


def _log_approval(doc, before, scheduled=False):
    """Timeline note naming what ran the re-check and what cleared.

    Auto-approval at creation, on the daily job and on the button all land as
    `auto_approved = 1, approved_by = "System"` — correct each time, the system
    approved it — but that leaves nothing saying which run did it, or that a
    person pressed a button. The comment carries it, with no schema change.
    """
    cleared = ", ".join(sorted(before)) or "no recorded reason"
    if scheduled:
        message = _("Auto-approved on the daily re-check. Cleared: {0}.").format(cleared)
    else:
        message = _("Auto-approved on re-check by {0}. Cleared: {1}.").format(
            frappe.session.user, cleared
        )
    doc.add_comment("Info", message)


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


def _run(invoice_ids, dry_run, truncated=0, scheduled=False):
    """Shared driver. Each invoice is isolated — one failure cannot abort a run."""
    results = []
    for invoice_id in invoice_ids:
        try:
            row = _recheck_one(invoice_id, dry_run, scheduled)
            if row is not None:
                results.append(row)
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
    """Re-check the given invoices: a PO invoice's ceilings, a Work Order invoice's rules 2 and 3 (ADR-0050
    decision 5). Non-candidates are dropped."""
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
    candidates = [r.name for r in rows if is_candidate(r) or is_work_order_candidate(r)]
    truncated = max(0, len(candidates) - MAX_SWEEP_INVOICES)
    return _run(candidates[:MAX_SWEEP_INVOICES], dry_run, truncated)


@frappe.whitelist()
def recheck_pending_queue(dry_run=False, document_type=None):
    """Re-check every candidate in the Pending queue of one tab: `document_type` "Service Requests" sweeps the
    Work Order invoices (rules 2 and 3, as the daily job does), anything else the PO invoices' ceilings.

    Deliberately NOT scoped to the caller's current table filters: this is
    pressed to clear the backlog, and a sweep covering only the rows a facet
    happened to be showing would report a queue total it had not checked.
    """
    _require_access()

    dry_run = frappe.parse_json(dry_run) if isinstance(dry_run, str) else bool(dry_run)
    return run_pending_queue(dry_run, document_type=document_type)


def pending_queue_candidates(work_orders=False, purchase_orders=True):
    """Every Pending invoice a re-check could change, oldest first: PO invoices on a ceiling (`purchase_orders`)
    and Pending Work Order invoices (`work_orders`, ADR-0050 decision 5). The daily job takes both; the PO tab's
    button the first, the WO tab's the second."""
    rows = frappe.get_all(
        "Vendor Invoices",
        filters={"status": "Pending"},
        fields=["name", "status", "document_type", "auto_approve_skip_reasons"],
        order_by="creation asc",
        limit_page_length=0,
    )
    return [r.name for r in rows
            if (purchase_orders and is_candidate(r)) or (work_orders and is_work_order_candidate(r))]


def run_pending_queue(dry_run, scheduled=False, document_type=None):
    """The queue sweep behind both the button and the daily job. No access check —
    the whitelisted caller does its own, and the scheduler is not a user. The daily
    job (`scheduled`) takes PO and Work Order invoices; the button its tab's
    (`document_type` "Service Requests": Work Orders; else POs)."""
    if scheduled:
        candidates = pending_queue_candidates(work_orders=True)
    elif document_type == WORK_ORDER:
        candidates = pending_queue_candidates(work_orders=True, purchase_orders=False)
    else:
        candidates = pending_queue_candidates()
    truncated = max(0, len(candidates) - MAX_SWEEP_INVOICES)
    return _run(candidates[:MAX_SWEEP_INVOICES], dry_run, truncated, scheduled)
