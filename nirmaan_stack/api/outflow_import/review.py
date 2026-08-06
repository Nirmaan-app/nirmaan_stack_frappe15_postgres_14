# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Match, review and report on a staged outflow batch (Bulk Import Outflow, slice S4).

Thin orchestrator (ADR-0010 B4): load pools -> call the pure matcher -> derive outcomes -> persist.
Every rule lives in `services/outflow_import`; this module owns none of them.

⚠️ THIS SLICE WRITES NOTHING TO A FINANCIAL RECORD. It writes only to the import's OWN staging
doctypes -- `Outflow Import Row.row_status` / `outcome_note`, `Outflow Row Match`, and the batch
rollup. Not one line here touches `Project Payments`, `PO Payment Terms`, a Procurement Order's
`amount_paid`, or an expense. That is the payment branch's whole contract (owner decision R1): it
READS and REPORTS. Settling an expense is S5, and it is the only write in the feature.

RE-RUNNING THE MATCH IS SAFE AND IS EXPECTED. Payments get marked Paid by hand throughout the day,
so a batch matched at 10:00 will find more at 16:00. `match_batch` therefore rebuilds a row's
matches from scratch each time -- it deletes that row's existing `Outflow Row Match` records before
writing fresh ones, which is also what keeps the (transfer_id, target) unique constraint from
tripping on the second run.

TWO ROW STATES ARE NEVER RE-MATCHED:
  * `Skipped`  -- a duplicate, a failed transfer, or a person's deliberate decision. Re-matching
                  would silently overturn all three.
  * `Settled`  -- an expense was written against this row. Re-matching would strand that audit.
"""

import frappe

from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.services.outflow_import import candidates as C
from nirmaan_stack.services.outflow_import.matcher import match_row, resolve_vendors
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.status import (
    OPEN_ROW_STATUSES,
    ROW_SETTLED,
    ROW_SKIPPED,
    derive_batch_counters,
    derive_batch_status,
    derive_row_outcome,
)

BATCH_DOCTYPE = "Outflow Import Batch"
ROW_DOCTYPE = "Outflow Import Row"
MATCH_DOCTYPE = "Outflow Row Match"

# A row in either of these states is left exactly as it is -- see the module docstring.
_FROZEN_ROW_STATUSES = (ROW_SKIPPED, ROW_SETTLED)


class _StagedRow:
    """Adapts a persisted import row to the shape the pure matcher and deriver read.

    They read by ATTRIBUTE, never by type, so this is the whole seam between the database and the
    pure layer. Money becomes `Decimal` here: the persisted column is a float, and the matcher
    compares amounts for exact equality.
    """

    __slots__ = (
        "name", "transfer_id", "amount", "beneficiary_name", "bank_account", "ifsc",
        "bank_reference_no", "normalized_account", "normalized_reference", "added_on",
        "status_raw", "remarks", "row_status",
    )

    def __init__(self, doc: dict):
        self.name = doc["name"]
        self.transfer_id = doc.get("transfer_id") or ""
        self.amount = normalize_amount(doc.get("amount"))
        self.beneficiary_name = doc.get("beneficiary_name") or ""
        self.bank_account = doc.get("bank_account") or ""
        self.ifsc = doc.get("ifsc") or ""
        self.bank_reference_no = doc.get("bank_reference_no") or ""
        self.normalized_account = doc.get("normalized_account") or ""
        self.normalized_reference = doc.get("normalized_reference") or ""
        self.added_on = doc.get("added_on")
        self.status_raw = doc.get("status_raw") or ""
        self.remarks = doc.get("remarks") or ""
        self.row_status = doc.get("row_status") or ""

    @property
    def is_success(self) -> bool:
        return self.status_raw.strip().upper() == "SUCCESS"

    @property
    def added_on_date(self):
        return self.added_on.date() if self.added_on else None


@frappe.whitelist(methods=["POST"])
def match_batch(batch: str):
    """Run the matcher over every unfrozen row in a batch and persist the outcomes.

    Idempotent: re-running rebuilds each row's matches from scratch.
    URL: /api/method/nirmaan_stack.api.outflow_import.review.match_batch
    """
    require_outflow_access()
    _assert_batch(batch)

    rows = [_StagedRow(r) for r in _load_rows(batch)]
    matchable = [r for r in rows if r.row_status not in _FROZEN_ROW_STATUSES]

    if matchable:
        pools = _load_pools(matchable, batch)
        for row in matchable:
            result = match_row(row, pools["vendors"], pools["payments"], pools["expenses"])
            outcome = derive_row_outcome(row, result)
            _persist_row_outcome(row, outcome, result, batch)

    statuses = _refresh_batch_rollup(batch)
    frappe.db.commit()
    return {
        "batch": batch,
        "matched_rows": len(matchable),
        "counters": derive_batch_counters(statuses),
        "status": derive_batch_status(statuses),
    }


def _load_pools(rows, batch: str) -> dict:
    """Assemble every candidate pool for the whole batch in a handful of queries.

    Per-row queries would be ~5 x N round trips for no benefit: the pure matcher filters the pools
    itself, and a batch is tens of rows, not thousands.
    """
    vendor_index = C.load_vendor_index()

    # Pass A pool: anything whose stored reference matches one of ours.
    by_reference = C.load_payments_by_reference([r.normalized_reference for r in rows])

    # Pass B pool: needs vendors resolved first, so resolve now to collect the names.
    vendor_names: set[str] = set()
    for row in rows:
        for candidate in resolve_vendors(row, vendor_index).candidates:
            vendor_names.add(candidate.vendor.name)

    period_from, period_to = frappe.db.get_value(
        BATCH_DOCTYPE, batch, ["period_from", "period_to"]
    )
    by_vendor = C.load_payments_for_vendors(
        sorted(vendor_names), [r.amount for r in rows], period_from, period_to
    )

    # The union is correct for both passes: Pass A filters it by reference, Pass B by
    # vendor + exact amount + date window.
    payments = {t.name: t for t in (*by_reference, *by_vendor)}

    return {
        "vendors": vendor_index,
        "payments": tuple(payments.values()),
        "expenses": C.load_expense_targets([r.amount for r in rows]),
    }


def _persist_row_outcome(row: _StagedRow, outcome, result, batch: str) -> None:
    """Write the derived status/note and rebuild this row's match records."""
    frappe.db.set_value(
        ROW_DOCTYPE,
        row.name,
        {
            "row_status": outcome.status,
            "outcome_note": outcome.note or None,
            "resolved_vendor": _sole_vendor(result),
        },
        update_modified=False,
    )

    # Rebuild rather than upsert: a re-run may match FEWER targets than before (a payment was
    # deleted, an amount edited), and an upsert would leave the surplus behind as a phantom match.
    frappe.db.delete(MATCH_DOCTYPE, {"import_row": row.name})

    group = result.best_payment_group
    if not group:
        return
    for target in group.targets:
        doc = frappe.new_doc(MATCH_DOCTYPE)
        doc.update(
            {
                "import_row": row.name,
                "import_batch": batch,
                "transfer_id": row.transfer_id,
                "target_doctype": target.doctype,
                "target_name": target.name,
                "target_amount": float(target.amount),
                # Read-only: nothing on the target was mutated. `Settled` is S5's kind.
                "match_kind": "Reconciled",
                "match_basis": group.basis,
                "matched_at": frappe.utils.now_datetime(),
                "matched_by": frappe.session.user,
            }
        )
        doc.insert(ignore_permissions=True)


def _sole_vendor(result):
    """Persist a resolved vendor ONLY when it is unambiguous.

    An ambiguous resolution -- a shared bank account, or several similar names -- is left blank on
    purpose. Storing the top-ranked guess would turn a suggestion the reviewer is supposed to
    settle into a recorded fact nobody chose.
    """
    resolution = result.vendor
    if resolution.ambiguous or not resolution.best:
        return None
    return resolution.best.vendor.name


@frappe.whitelist(methods=["POST"])
def skip_row(row: str, reason: str):
    """Manually skip a row. A REASON IS REQUIRED (owner ruling).

    Only a MANUAL skip needs one: an automatic skip -- a duplicate transfer, a failed transfer --
    carries a system-generated reason, because making someone type "duplicate" forty times is
    theatre rather than a control.
    """
    require_outflow_access()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw("A reason is required to skip a row.", title="Missing reason")

    current = frappe.db.get_value(ROW_DOCTYPE, row, ["name", "import_batch", "row_status"], as_dict=True)
    if not current:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")
    if current.row_status == ROW_SETTLED:
        frappe.throw(
            "This row has already settled an expense and cannot be skipped.",
            title="Already settled",
        )

    frappe.db.set_value(
        ROW_DOCTYPE,
        row,
        {"row_status": ROW_SKIPPED, "skip_reason": reason,
         "decided_at": frappe.utils.now_datetime(), "decided_by": frappe.session.user},
        update_modified=False,
    )
    frappe.db.delete(MATCH_DOCTYPE, {"import_row": row})
    statuses = _refresh_batch_rollup(current.import_batch)
    frappe.db.commit()
    return {"row": row, "status": ROW_SKIPPED, "batch_status": derive_batch_status(statuses)}


@frappe.whitelist()
def get_batch_rows(batch: str):
    """Every staged row with its outcome and its matched targets, for the review screen."""
    require_outflow_access()
    _assert_batch(batch)

    rows = _load_rows(batch)
    matches = frappe.db.sql(
        """
        SELECT import_row, target_doctype, target_name, target_amount, match_kind, match_basis
        FROM "tabOutflow Row Match"
        WHERE import_batch = %s
        ORDER BY target_name ASC
        """,
        (batch,),
        as_dict=True,
    )
    by_row: dict[str, list] = {}
    for match in matches:
        by_row.setdefault(match["import_row"], []).append(match)

    return {
        "batch": batch,
        "rows": [
            {
                **row,
                "amount": float(row.get("amount") or 0),
                "service_charge": float(row.get("service_charge") or 0),
                "service_tax": float(row.get("service_tax") or 0),
                "matches": by_row.get(row["name"], []),
            }
            for row in rows
        ],
    }


@frappe.whitelist()
def get_row_candidates(row: str):
    """Ranked candidates for ONE row, fetched on demand when a reviewer opens it.

    Per-row rather than bundled into `get_batch_rows`: candidates are only ever looked at for the
    row being worked on, and shipping every row's candidate set would make the review payload
    an order of magnitude larger for information nobody reads.
    """
    require_outflow_access()
    doc = frappe.db.get_value(ROW_DOCTYPE, row, "*", as_dict=True)
    if not doc:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")

    staged = _StagedRow(doc)
    vendor_index = C.load_vendor_index()
    resolution = resolve_vendors(staged, vendor_index)
    payments = {
        t.name: t
        for t in (
            *C.load_payments_by_reference([staged.normalized_reference]),
            *C.load_payments_for_vendors(
                [c.vendor.name for c in resolution.candidates],
                [staged.amount],
                staged.added_on_date,
                staged.added_on_date,
            ),
        )
    }
    expenses = C.load_expense_targets([staged.amount])
    result = match_row(staged, vendor_index, tuple(payments.values()), expenses)

    return {
        "row": row,
        "vendor_candidates": [
            {
                "vendor": c.vendor.name,
                "vendor_name": c.vendor.vendor_name,
                "account_name": c.vendor.account_name,
                "score": round(c.score, 3),
                "basis": c.basis,
                "reasons": list(c.reasons),
            }
            for c in result.vendor.candidates
        ],
        "vendor_ambiguous": result.vendor.ambiguous,
        "payment_groups": [
            {
                "basis": g.basis,
                "is_fan_out": g.is_fan_out,
                "total_amount": float(g.total_amount),
                "targets": [
                    {
                        "doctype": t.doctype,
                        "name": t.name,
                        "amount": float(t.amount),
                        "status": t.status,
                        "reference": t.reference,
                        "project": t.project,
                    }
                    for t in g.targets
                ],
            }
            for g in result.payment_groups
        ],
        "expense_candidates": [
            {
                "doctype": c.target.doctype,
                "name": c.target.name,
                "amount": float(c.target.amount),
                "status": c.target.status,
                "project": c.target.project,
                "description": c.target.description,
                "score": round(c.score, 3),
                "reasons": list(c.reasons),
            }
            for c in result.expense_candidates
        ],
    }


@frappe.whitelist()
def get_reconciliation_report(batch: str):
    """The batch's read-only findings, plus the payments this statement does NOT account for.

    THE REVERSE VIEW IS THE POINT. Matching a bank row to a payment answers "is this transfer
    recorded?"; it cannot answer "is every payment we recorded backed by a real transfer?". The
    second list is informational, not an alarm -- a payment may legitimately have gone out through
    another channel entirely.
    """
    require_outflow_access()
    _assert_batch(batch)

    period_from, period_to = frappe.db.get_value(
        BATCH_DOCTYPE, batch, ["period_from", "period_to"]
    )
    rows = _load_rows(batch)
    statuses = [r.get("row_status") or "" for r in rows]

    matched_payments = {
        r["target_name"]
        for r in frappe.db.sql(
            """
            SELECT target_name FROM "tabOutflow Row Match"
            WHERE import_batch = %s AND target_doctype = 'Project Payments'
            """,
            (batch,),
            as_dict=True,
        )
    }

    unmatched_payments = []
    if period_from and period_to:
        candidates = frappe.db.sql(
            """
            SELECT p.name, p.amount, p.utr, p.payment_date, p.project, v.vendor_name
            FROM "tabProject Payments" p
            LEFT JOIN "tabVendors" v ON v.name = p.vendor
            WHERE p.status = 'Paid'
              AND p.payment_date BETWEEN %s AND %s
            ORDER BY p.payment_date ASC, p.name ASC
            """,
            (period_from, period_to),
            as_dict=True,
        )
        unmatched_payments = [
            {
                "name": c["name"],
                "amount": float(c["amount"] or 0),
                "utr": c["utr"],
                "payment_date": str(c["payment_date"]) if c["payment_date"] else None,
                "project": c["project"],
                "vendor_name": c["vendor_name"],
            }
            for c in candidates
            if c["name"] not in matched_payments
        ]

    exceptions = [
        {
            "name": r["name"],
            "transfer_id": r.get("transfer_id"),
            "amount": float(r.get("amount") or 0),
            "beneficiary_name": r.get("beneficiary_name"),
            "row_status": r.get("row_status"),
            "outcome_note": r.get("outcome_note"),
        }
        for r in rows
        if r.get("row_status")
        in ("Amount mismatch", "Reference mismatch", "Control exception")
    ]

    return {
        "batch": batch,
        "period_from": str(period_from) if period_from else None,
        "period_to": str(period_to) if period_to else None,
        "counters": derive_batch_counters(statuses),
        "status": derive_batch_status(statuses),
        "exceptions": exceptions,
        "unmatched_payments": unmatched_payments,
        "unmatched_payment_total": sum(p["amount"] for p in unmatched_payments),
    }


# --- helpers -----------------------------------------------------------------------------------


def _assert_batch(batch: str) -> None:
    if not batch or not frappe.db.exists(BATCH_DOCTYPE, batch):
        frappe.throw(f"Import batch '{batch}' not found.", title="Not found")


def _load_rows(batch: str) -> list:
    return frappe.db.sql(
        """
        SELECT name, transfer_id, reference_id, added_on, amount, status_raw, beneficiary_name,
               beneficiary_id, bank_account, ifsc, remarks, bank_reference_no, service_charge,
               service_tax, added_by_raw, normalized_account, normalized_reference,
               resolved_vendor, resolved_project, row_status, skip_reason, outcome_note
        FROM "tabOutflow Import Row"
        WHERE import_batch = %s
        ORDER BY added_on ASC, name ASC
        """,
        (batch,),
        as_dict=True,
    )


def _refresh_batch_rollup(batch: str) -> list:
    """Recompute the batch's counters and status from its rows. `status.py` is the only deriver.

    `closed_at` is read on every refresh rather than only at close time, because the status has to
    stay correct as the batch keeps changing: a closed batch whose last abandoned row is later
    settled becomes plainly `Completed`, and one that is reopened drops back to `In Review`. Reading
    the flag here is what makes both happen without either action knowing about the other.
    """
    statuses = [
        r["row_status"] or ""
        for r in frappe.db.sql(
            """SELECT row_status FROM "tabOutflow Import Row" WHERE import_batch = %s""",
            (batch,),
            as_dict=True,
        )
    ]
    closed_at = frappe.db.get_value(BATCH_DOCTYPE, batch, "closed_at")
    values = dict(derive_batch_counters(statuses))
    values["status"] = derive_batch_status(statuses, force_closed=bool(closed_at))
    frappe.db.set_value(BATCH_DOCTYPE, batch, values, update_modified=False)
    return statuses


@frappe.whitelist(methods=["POST"])
def close_batch(batch: str, reason: str = None):
    """Close a batch, accepting that its remaining rows will not be decided.

    ⚠️ CLOSING DOES NOT CONVERT THE OPEN ROWS TO `Skipped`, and that is a deliberate reversal of
    what the v1 design described. A skip is a DECISION -- which is exactly why a manual one requires
    a typed reason (owner ruling) -- and auto-skipping on close would manufacture decisions nobody
    made, replacing "never decided" with a fabricated "deliberately skipped" on every row.

    Instead the abandonment is recorded ONCE, on the batch. `derive_batch_status` then reports
    `Completed with exceptions`, which is the signal someone scanning the import list actually
    needs: this batch was closed with work outstanding. Converting the rows would have made the
    batch read as a plain `Completed`, indistinguishable from one where everything really was
    resolved.

    Closing is bookkeeping, NOT a freeze. An abandoned row can still be settled afterwards, and the
    status re-derives when it is.
    """
    require_outflow_access()
    _assert_batch(batch)

    frappe.db.set_value(
        BATCH_DOCTYPE,
        batch,
        {
            "closed_at": frappe.utils.now_datetime(),
            "closed_by": frappe.session.user,
            "close_reason": (reason or "").strip() or None,
        },
        update_modified=False,
    )
    statuses = _refresh_batch_rollup(batch)
    frappe.db.commit()
    return {
        "batch": batch,
        "status": derive_batch_status(statuses, force_closed=True),
        "counters": derive_batch_counters(statuses),
        "abandoned_rows": sum(1 for s in statuses if s in OPEN_ROW_STATUSES),
    }


@frappe.whitelist(methods=["POST"])
def reopen_batch(batch: str):
    """Clear the close, putting the batch back into review. A mis-click must not be permanent."""
    require_outflow_access()
    _assert_batch(batch)

    frappe.db.set_value(
        BATCH_DOCTYPE,
        batch,
        {"closed_at": None, "closed_by": None, "close_reason": None},
        update_modified=False,
    )
    statuses = _refresh_batch_rollup(batch)
    frappe.db.commit()
    return {"batch": batch, "status": derive_batch_status(statuses)}


@frappe.whitelist()
def get_close_preview(batch: str):
    """What closing this batch would abandon, so the confirmation can say it rather than imply it."""
    require_outflow_access()
    _assert_batch(batch)

    rows = [
        r
        for r in _load_rows(batch)
        if (r.get("row_status") or "") in OPEN_ROW_STATUSES
    ]
    return {
        "batch": batch,
        "abandoned_rows": len(rows),
        "abandoned_amount": float(sum(float(r.get("amount") or 0) for r in rows)),
        "rows": [
            {
                "name": r["name"],
                "beneficiary_name": r.get("beneficiary_name"),
                "amount": float(r.get("amount") or 0),
                "row_status": r.get("row_status"),
            }
            for r in rows
        ],
    }
