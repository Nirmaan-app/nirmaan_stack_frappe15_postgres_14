# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Settle the backlog left by the removed PO-number gate, then erase its tokens.

Gate 8 of the auto-approve check read the PO number off the invoice document.
Both halves are gone from `api/invoices/_auto_approve.py` — the MATCH half on
2026-08-19 (`po_number_mismatch`), the PRESENCE half on 2026-08-21
(`po_number_not_extracted`) — because neither was evidence of a misfiling:
vendors print their own order references, quote numbers and revision suffixes
where the AI looks for a PO, and plenty of correctly-filed invoices carry no
order reference the extractor can see at all.

Deleting the gate changes nothing about invoices that already exist, because
auto-approve never re-runs after insert. This patch closes that gap in two
steps, in this order.

STEP 1 — APPROVE what the gate alone was holding.
An invoice qualifies only when EVERY token in `auto_approve_skip_reasons` is one
of the two removed ones. A single live token means a real check is still
unsatisfied and the invoice is left for a human.

The stored reasons are a snapshot from CREATION and the oldest candidate has
been Pending for weeks, so they are not trusted: each candidate is re-run
through the REAL evaluator against today's data, and one that fails any gate now
is SKIPPED, not approved. That reuses the single implementation of the rules
rather than restating them here (ADR-0010 B1), so this patch cannot drift from
the endpoint. The ceilings are the reason it matters — gates 9 and 10 compare
cumulative invoicing against the PO's value and against what has actually been
delivered, and both move while an invoice sits in the queue.

The one gate that CANNOT be re-checked is 13, the file-swap guard: its input
`autofill_source_file_url` is a request parameter that was never persisted, so
no patch can see what the extractor read from. Its token is ignored below. That
is precisely why step 1's scope is "nothing else was recorded against it at
creation" rather than a blanket re-run over every Pending invoice — gate 13
passed for these rows when it had the evidence to judge, and this patch does not
disturb that finding.

Approved rows are stamped `approved_by = "System"` / `auto_approved = 1`,
identical to a live auto-approval, because that is what the system would have
produced. `apply_auto_approval` stays the ONE definition of what that looks
like — this patch only changes how the result is PERSISTED.

BOTH STEPS LEAVE `modified` ALONE, and step 1 pays for that deliberately.
Writing with `update_modified=False` means no `doc.save()`, which means the
Vendor Invoices `on_update` doc event does NOT fire — and that event is what
keeps `amount_invoiced` (an Approved-ONLY sum) true on the parent PO/SR, with
`amount_due` derived from it. So this patch invokes the recompute EXPLICITLY,
once per affected parent, exactly as the raw-write rule in CLAUDE.md requires.
Miss that call and every parent this patch touches carries a stale total with
nothing on screen looking wrong. (`invoice_qty` counts Pending+Approved, so a
Pending -> Approved flip leaves it arithmetically unchanged — nothing to do.)

WHY `modified` IS WORTH THAT. Both invoice tables sort `modified desc`. Bumping
these rows would lift invoices that have sat untouched for weeks — one since
30-Jun — to the top of the history tab, presenting a bulk backfill as recent
activity. The parent PO's own `modified` DOES move, via the recompute's
`set_value`; that is the existing deliberate behaviour at every other write site
for these totals, and it is left as-is.

WHAT IS LOST: a raw write creates no `Version` row, so these 13 approvals leave
no entry in the change log. The record lives on the document instead —
`auto_approved = 1`, `approved_by = "System"`, `approved_on` = the moment the
patch ran — which says what happened, when, and by what, without a diff. The
Version rows that matter here are the CREATION-time ones recording the original
skip reasons, and step 2 does not touch those.

STEP 2 — ERASE the two tokens everywhere they are still stored.
Removing the gate from the code left ~244 rows literally holding its tokens in
`Vendor Invoices.auto_approve_skip_reasons`. Until now the frontend hid them
with a `RETIRED_REASONS` deny-list; this patch deletes the data instead, so that
deny-list can be deleted too and neither side has to remember a gate that no
longer exists. Step 2 covers EVERY status, not just the rows step 1 approved —
the Approved and Rejected history carries them too.

Only the two tokens are removed; other reasons on the same row survive, in
order. A row left with nothing becomes NULL, matching a row that never had a
reason recorded.

THE AUDIT TRAIL SURVIVES THIS. `Vendor Invoices` has `track_changes: 1`, so the
original write is preserved in the Version log (e.g. VI-2026-05332's version
`j96m0vh58h` records `auto_approve_skip_reasons: None -> 'po_number_not_extracted'`
at insert). Step 2 edits the current value, not the history.

Step 2 writes with `set_value(update_modified=False)` — a RAW write that fires no
doc event, which is correct here and is stated per the raw-write rule in
CLAUDE.md: NOTHING derives from `auto_approve_skip_reasons`. It is a display-only
snapshot; the parent totals key off `status` / `invoice_amount` / the parent link,
none of which this step touches. `modified` is deliberately left alone as well —
the pending queue sorts on `modified desc`, and bumping 244 invoices would shove
untouched history to the top of the approval queue.

IDEMPOTENT in both steps — the first clears the reasons and moves the rows out
of Pending, the second matches nothing once the tokens are gone.
"""

import frappe

from nirmaan_stack.api.invoices._auto_approve import (
    apply_auto_approval,
    evaluate_auto_approve_eligibility,
)
from nirmaan_stack.api.invoices._item_billing_sync import (
    recompute_document_amount_invoiced,
)

# The fields `apply_auto_approval` stamps on the pass path. Enumerated because
# the values are read off the in-memory doc and written raw; if that function
# ever grows a field, this list has to grow with it. Safe for a one-shot patch,
# and it keeps the RULE in one place — only the persistence differs.
_APPROVAL_FIELDS = (
    "status",
    "approved_by",
    "approved_on",
    "auto_approved",
    "auto_approve_skip_reasons",
)

# The two gate-8 tokens. Until this patch these were also listed as
# RETIRED_REASONS in frontend/src/pages/tasks/invoices/utils/autoApproveReasons.ts;
# that deny-list is removed in the same change, because after step 2 there is
# nothing left for it to hide.
REMOVED_GATE_REASONS = frozenset({"po_number_mismatch", "po_number_not_extracted"})

# Gate 13's tokens. Its input was never persisted, so the gate cannot be
# re-evaluated here and its verdict is neither trusted nor re-derived — see the
# module docstring. `file_swap_detected` is unreachable without a source URL and
# is listed only so the filter reads as "gate 13" rather than "this one token".
UNCHECKABLE_REASONS = frozenset({"source_file_url_missing", "file_swap_detected"})


def execute():
    _approve_gate_only_invoices()
    _erase_removed_tokens()
    frappe.db.commit()


# ---- Step 1: approve ---------------------------------------------------------


def _approve_gate_only_invoices():
    candidates = _candidates()
    if not candidates:
        print("  step 1: no Pending invoice is blocked solely by the removed gate")
        return

    approved, skipped = [], []
    for name in candidates:
        verdict = _recheck(name)
        if verdict is None:
            approved.append(name)
        else:
            skipped.append((name, verdict))

    parents = set()
    rows = []
    by_token = {token: 0 for token in sorted(REMOVED_GATE_REASONS)}
    total = 0.0
    for name in approved:
        invoice = frappe.get_doc("Vendor Invoices", name)
        blocked_by = [t for t in _tokens(invoice.auto_approve_skip_reasons)
                      if t in REMOVED_GATE_REASONS]
        for token in blocked_by:
            by_token[token] += 1

        apply_auto_approval(invoice)
        frappe.db.set_value(
            "Vendor Invoices",
            name,
            {field: invoice.get(field) for field in _APPROVAL_FIELDS},
            update_modified=False,
        )
        parents.add((invoice.document_type, invoice.document_name))
        amount = float(invoice.invoice_amount or 0)
        total += amount
        rows.append((name, invoice.vendor or "", invoice.document_name or "",
                     amount, ",".join(blocked_by)))

    # The doc event did not fire — see the module docstring. Recompute each
    # affected parent's Approved-only total (which re-derives amount_due too),
    # once per parent rather than once per invoice.
    for document_type, document_name in sorted(parents):
        recompute_document_amount_invoiced(document_type, document_name)

    print(f"  step 1: candidates blocked only by the removed gate : {len(candidates)}")
    print(f"          approved (status Pending -> Approved)       : {len(approved)}")
    # Per-token counts. An invoice carrying BOTH tokens is counted under each,
    # so these can sum to more than the row count above — they answer "how many
    # invoices did this token hold up", not "how many rows were written".
    for token, count in sorted(by_token.items()):
        print(f"              blocked by {token:<26}: {count}")
    if rows:
        print(f"          {'INVOICE':<16} {'VENDOR':<20} {'PO':<20} "
              f"{'AMOUNT':>12}  BLOCKED BY")
        for name, vendor, parent, amount, blocked_by in sorted(rows):
            print(f"          {name:<16} {vendor:<20} {parent:<20} "
                  f"{amount:>12.2f}  {blocked_by}")
        print(f"          approved value                              : {total:.2f}")
    print(f"          parent documents recomputed                 : {len(parents)}")
    print(f"          left Pending (a live gate fires today)      : {len(skipped)}")
    for name, why in skipped:
        print(f"              {name}  ->  {why}")


def _candidates():
    """Pending invoices whose every recorded reason is one of the removed ones.

    Matched in Python rather than SQL: `auto_approve_skip_reasons` is a
    comma-joined blob, so a `LIKE` would match a token as a SUBSTRING of a longer
    one and there is no cheap way to express "and nothing else" in it. The
    Pending set is ~100 rows, so this costs nothing.
    """
    names = []
    for row in frappe.get_all(
        "Vendor Invoices",
        filters={"status": "Pending"},
        fields=["name", "auto_approve_skip_reasons"],
        limit_page_length=0,
    ):
        tokens = _tokens(row.auto_approve_skip_reasons)
        if tokens and all(t in REMOVED_GATE_REASONS for t in tokens):
            names.append(row.name)
    return names


def _recheck(name):
    """Re-run the live gates. Returns None when clear, else why it was skipped.

    Anything that goes wrong reading the invoice or its parent is reported as a
    skip rather than raised: one unreadable row must not abort the patch and
    strand the rest, and the safe outcome for a row we cannot judge is to leave
    it Pending for a human.
    """
    try:
        invoice = frappe.get_doc("Vendor Invoices", name)
    except Exception as exc:
        return f"could not load invoice: {exc}"

    try:
        parent = frappe.get_doc(invoice.document_type, invoice.document_name)
    except Exception as exc:
        return f"could not load {invoice.document_type} {invoice.document_name}: {exc}"

    try:
        _, reasons = evaluate_auto_approve_eligibility(
            invoice_doc=invoice,
            parent_doc=parent,
            autofill_source_file_url=None,
        )
    except Exception as exc:
        frappe.log_error(
            title="retire_po_number_gate re-check failed",
            message=frappe.get_traceback(),
        )
        return f"re-check raised: {exc}"

    live = [r for r in reasons if r not in UNCHECKABLE_REASONS]
    return ", ".join(live) if live else None


# ---- Step 2: erase -----------------------------------------------------------


def _erase_removed_tokens():
    """Strip the two tokens from every row that still stores one, any status.

    A LIKE narrows the scan to rows that could match; the actual edit is decided
    on parsed tokens, so a token can never be removed as a substring of another.
    """
    rows = frappe.db.sql(
        """
        SELECT name, auto_approve_skip_reasons
        FROM "tabVendor Invoices"
        WHERE auto_approve_skip_reasons LIKE %(mismatch)s
           OR auto_approve_skip_reasons LIKE %(missing)s
        """,
        {"mismatch": "%po_number_mismatch%", "missing": "%po_number_not_extracted%"},
        as_dict=True,
    )

    cleared, trimmed = 0, 0
    by_token = {token: 0 for token in sorted(REMOVED_GATE_REASONS)}
    for row in rows:
        tokens = _tokens(row.auto_approve_skip_reasons)
        kept = [t for t in tokens if t not in REMOVED_GATE_REASONS]
        if len(kept) == len(tokens):
            continue  # matched the LIKE as a substring only — nothing to remove
        for token in tokens:
            if token in REMOVED_GATE_REASONS:
                by_token[token] += 1

        value = ",".join(kept) if kept else None
        frappe.db.set_value(
            "Vendor Invoices",
            row.name,
            "auto_approve_skip_reasons",
            value,
            update_modified=False,
        )
        if value is None:
            cleared += 1
        else:
            trimmed += 1

    print(f"  step 2: rows scanned                        : {len(rows)}")
    # Per-token again: a row holding BOTH is counted under each.
    for token, count in sorted(by_token.items()):
        print(f"              removed {token:<29}: {count}")
    print(f"          rows written                        : {trimmed + cleared}")
    print(f"              token removed, other reasons kept: {trimmed}")
    print(f"              reasons now empty (set to NULL)  : {cleared}")


# ---- shared ------------------------------------------------------------------


def _tokens(raw):
    """Split the stored comma-joined blob into tokens, dropping blanks."""
    return [t.strip() for t in (raw or "").split(",") if t.strip()]
