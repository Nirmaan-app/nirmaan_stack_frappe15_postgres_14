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
from nirmaan_stack.services.outflow_import.matcher import (
    match_payments,
    match_row,
    resolve_vendors,
)
from nirmaan_stack.services.outflow_import.amounts import amounts_match
from nirmaan_stack.services.outflow_import.ledgers import (
    LEDGER_DOCTYPES,
    settleable_statuses,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.status import (
    OPEN_ROW_STATUSES,
    ROW_SETTLED,
    ROW_SKIPPED,
    derive_batch_counters,
    derive_batch_status,
    derive_row_outcome,
    sole_suggestion,
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
            outcome = derive_row_outcome(
                row, result, paid_duplicate=_paid_duplicate_for(row, pools)
            )
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
    references = [r.normalized_reference for r in rows]

    # Pass A pool: APPROVED payments whose stored reference matches one of ours.
    by_reference = C.load_payments_by_reference(references)

    # ⚠️ A SEPARATE POOL, AND A SEPARATE QUERY, FOR A SEPARATE QUESTION (owner ruling Q14). These
    # are PAID payments already carrying one of our references -- somebody ticked them by hand
    # before this statement was uploaded. They are a duplicate guard, never a settle candidate, and
    # merging them into `by_reference` would let the same money be recorded twice. Under Q12 that
    # is the common case, not an edge case.
    paid_duplicates = C.load_paid_payments_by_reference(references)

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
        "paid_duplicates": paid_duplicates,
        "expenses": C.load_expense_targets([r.amount for r in rows]),
    }


def _paid_duplicate_for(row, pools):
    """The already-Paid group this row duplicates, or None.

    Reuses `match_payments` rather than hand-rolling a reference compare, so a FAN-OUT that was
    recorded by hand is recognised as ONE already-recorded transfer instead of a shortfall against
    whichever payment happened to be found first. The matcher is untouched -- only the pool differs.

    No vendor resolution is passed: this must match on the bank reference alone. `match_payments`
    Pass B (vendor + amount + date) is a SUGGESTION heuristic, and a heuristic hit here would skip a
    row on a guess, which is the one outcome a duplicate guard must never produce.
    """
    groups = match_payments(row, pools["paid_duplicates"])
    return groups[0] if groups else None


def _persist_row_outcome(row: _StagedRow, outcome, result, batch: str) -> None:
    """Write the derived status and note. A match run records NO `Outflow Row Match` rows.

    ⚠️ THIS STOPPED WRITING MATCH ROWS AT V1, AND THE REASON IS THE UNIQUE CONSTRAINT. v2 minted a
    `Reconciled` match row per matched target here, and a `Settled` one at settlement -- which never
    collided only because v2's payment branch could not write, so the two paths always addressed
    DIFFERENT targets. Under the v3 spine they address the SAME one: a row matched to PAY-X would
    take the `(transfer_id, target_doctype, target_name)` key at match time, and confirming it would
    then fail the unique insert on exactly the happy path.

    Resolving it the other way -- keeping suggestions in the table and letting the settle update
    them -- would have cost the constraint its meaning, and that constraint IS this feature's
    idempotency guarantee. So the table now records ONE thing: what a row SETTLED. `match_kind` has
    a single value to match, and a Match row present means money was written.

    Nothing is lost from the screen. `outcome.note` already names the suggested record(s) in the
    reviewer's own words, and the decision dialog loads full details on demand through
    `get_row_candidates` -- which is what the signed-off design specifies anyway ("a dropdown that
    LOADS the chosen record's details").

    ⚠️ THE SUGGESTION PAIR IS NOT A MATCH ROW, AND THE DISTINCTION IS THE WHOLE REASON IT LIVES HERE
    (slice R1). The paragraph above forbids writing a SUGGESTION into `Outflow Row Match`, because
    it would take the `(transfer_id, target_doctype, target_name)` unique key before the settlement
    that needs it and fail the confirm on the happy path. Two read-only fields on the import row go
    nowhere near that key. Do not "restore consistency" by moving them into the match table.

    ⚠️ BOTH FIELDS ARE WRITTEN ON EVERY RUN, INCLUDING AS `None`. Re-running the match is normal --
    payments get ticked Paid by hand all day, so a batch matched at 10:00 finds different things at
    16:00. Writing the pair only when one is found would leave yesterday's pick sitting on a row
    that no longer has a candidate, and the screen would open it pre-ticked against a record the
    matcher has since rejected. Clearing is the load-bearing half.
    """
    suggestion = sole_suggestion(outcome, result)
    frappe.db.set_value(
        ROW_DOCTYPE,
        row.name,
        {
            "row_status": outcome.status,
            "outcome_note": outcome.note or None,
            "resolved_vendor": _sole_vendor(result),
            "suggested_doctype": suggestion.doctype if suggestion else None,
            "suggested_name": suggestion.name if suggestion else None,
        },
        update_modified=False,
    )

    # Still a delete, for a narrower reason: a batch staged under v2 carries legacy suggestion rows,
    # and re-running the match is how they get cleared. It cannot touch a settlement -- `Settled` is
    # in `_FROZEN_ROW_STATUSES`, so a settled row never reaches this function at all.
    frappe.db.delete(MATCH_DOCTYPE, {"import_row": row.name})


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
def search_settleable_records(
    row: str, target_doctype: str = "", search: str = "", limit: int = 50
):
    """Approved records a reviewer may link to this row BY HAND (slice V4a; all-ledger at R2).

    URL: /api/method/nirmaan_stack.api.outflow_import.review.search_settleable_records

    ⚠️ `target_doctype` IS NOW OPTIONAL, AND BLANK MEANS ALL THREE LEDGERS (owner, slice R2). The
    dialog used to make you pick a ledger FIRST -- three cards, one per doctype -- and only then
    showed you records. That asked the reviewer to answer a question they often cannot: a transfer
    to a vendor may have been raised as a Project Payment or booked as a Project Expense, and the
    only way to find out was to open each card in turn. One list, ordered by how close the amount
    is, lets them recognise the record instead of classifying it first.

    ⚠️ THE CAP IS APPLIED AFTER THE MERGE, NOT PER LEDGER. Each ledger is asked for `limit` rows and
    the merged list is cut to `limit` -- so the records you get are the globally closest, not a
    third from each. Sorting before the cut is what makes the cut meaningful, and it uses the same
    order the screen renders in (suggested first, then closest) so the two never disagree about
    which records "the top of the list" means.

    ⚠️ THIS EXISTS BECAUSE `get_row_candidates` IS THE MATCHER'S OUTPUT, NOT A BROWSABLE LIST, and
    the decision dialog was built on it. When the matcher found nothing the dropdowns were EMPTY --
    so "link one by hand", which is the entire escape hatch for everything the matcher cannot see,
    could not be done at all. Found on the owner's first real import.

    That is not a case the tolerance fixes either. A TDS payment differs by THOUSANDS and will never
    match; a beneficiary whose name resolves to no vendor cannot reach Pass B at all. Those rows are
    exactly the ones a person has to resolve by hand, and this is what lets them.

    ⚠️ IT IS STILL `Approved` ONLY. Browsing is not a way around the ladder -- the same
    `ledgers.SETTLEABLE_STATUSES` governs here as everywhere, so nothing offered can be refused by
    the write path for its status. What CAN still be refused is the amount, which is why every row
    carries its own difference rather than being silently filtered out: a reviewer looking for a
    TDS payment needs to SEE the one that differs by 2,000 in order to learn that it cannot be
    settled here.

    `suggested` marks the records within the matching tolerance, so the screen can float them to the
    top without hiding anything else.
    """
    require_outflow_access()
    doc = frappe.db.get_value(ROW_DOCTYPE, row, ["amount", "beneficiary_name"], as_dict=True)
    if not doc:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")

    bank_amount = normalize_amount(doc.get("amount"))
    limit = max(1, min(int(limit or 50), 200))

    wanted = (target_doctype or "").strip()
    if wanted:
        if not settleable_statuses(wanted):
            frappe.throw(
                f"'{wanted}' is not a ledger this import can settle.",
                title="Not settleable",
            )
        ledgers = (wanted,)
    else:
        ledgers = LEDGER_DOCTYPES

    records: list[dict] = []
    for ledger in ledgers:
        records.extend(_search_one_ledger(ledger, bank_amount, search, limit))

    # The SAME order the screen renders in -- suggested first, then closest by amount -- so the cut
    # below keeps the records a reviewer would actually have looked at.
    records.sort(key=lambda r: (not r["suggested"], abs(r["amount"] - float(bank_amount))))
    return records[:limit]


def _search_one_ledger(target_doctype: str, bank_amount, search: str, limit: int) -> list[dict]:
    """One ledger's approved records, already in the shared record shape.

    Split out of `search_settleable_records` when that endpoint went all-ledger: the three queries
    genuinely differ -- two joins on payments, one on project expenses, none on non-project ones,
    and two different amount expressions -- and folding them into one parametrised query would hide
    exactly the asymmetries a reader needs to see.
    """
    statuses = settleable_statuses(target_doctype)
    status_ph = ", ".join(["%s"] * len(statuses))
    needle = f"%{(search or '').strip().lower()}%"
    has_search = bool((search or "").strip())

    if target_doctype == C.PAYMENT_DOCTYPE:
        # ⚠️ TWO LEFT JOINS, not inner ones. A payment whose vendor or project link is broken must
        # still be findable -- dropping it would hide a settleable record for a reason invisible on
        # the screen. Both names are resolved server-side so the dropdown does not have to make N
        # more round trips to render N options.
        search_sql = (
            "AND (lower(p.name) LIKE %s OR lower(coalesce(v.vendor_name,'')) LIKE %s"
            " OR lower(coalesce(p.document_name,'')) LIKE %s"
            " OR lower(coalesce(pr.project_name,'')) LIKE %s"
            " OR lower(coalesce(p.project,'')) LIKE %s)"
            if has_search
            else ""
        )
        sql = f"""
            SELECT p.name, p.amount, p.status, p.project, p.document_name,
                   v.vendor_name, pr.project_name,
                   COALESCE(p.ceo_approval_date, p.approval_date) AS approved_on
            FROM "tabProject Payments" p
            LEFT JOIN "tabVendors" v ON v.name = p.vendor
            LEFT JOIN "tabProjects" pr ON pr.name = p.project
            WHERE p.status IN ({status_ph})
              {search_sql}
            ORDER BY abs(p.amount - %s) ASC, p.modified DESC
            LIMIT %s
        """
        params = [*statuses]
        if has_search:
            params.extend([needle] * 5)
        params.extend([float(bank_amount), limit])
        return [
            {
                "target_doctype": C.PAYMENT_DOCTYPE,
                "name": r["name"],
                "amount": float(normalize_amount(r.get("amount"))),
                # The facts a reviewer picks a payment BY (owner ruling 2026-08-06), each its own
                # field so the dropdown can lay them out rather than parse a joined string.
                "vendor_name": r.get("vendor_name") or "",
                "project_name": r.get("project_name") or r.get("project") or "",
                "document_name": r.get("document_name") or "",
                "approved_on": str(r["approved_on"]) if r.get("approved_on") else "",
                "updated_on": "",
                "detail": " · ".join(
                    [p for p in (r.get("vendor_name"), r.get("document_name"),
                                 r.get("project_name") or r.get("project")) if p]
                ),
                "suggested": amounts_match(normalize_amount(r.get("amount")), bank_amount),
            }
            for r in frappe.db.sql(sql, tuple(params), as_dict=True)
        ]

    # ⚠️ NEITHER EXPENSE DOCTYPE HAS AN APPROVAL DATE -- not a field, not an approver, nothing.
    # Only `Project Payments` records one. So `approved_on` is empty here and `updated_on` carries
    # the record's last-changed timestamp instead, under its OWN key: the screen labels the two
    # differently ("approved" vs "updated") because a modification date is not an approval date and
    # must never be read as one (owner ruling 2026-08-06).
    #
    # ⚠️ `Project Expenses.amount` is a Data column of numeric STRINGS and the non-project one is
    # real Currency, so the ordering expression differs -- the same asymmetry the candidate queries
    # carry.
    if target_doctype == C.PROJECT_EXPENSE_DOCTYPE:
        # ⚠️ THE JOINS ARE THE FIX FOR AN ID LEAKING INTO A NAME COLUMN. `vendor` and `projects` are
        # LINK fields, so the raw value is `VEN-0001`, not a vendor a person recognises -- and these
        # are now the columns a reviewer picks BY, in one merged list beside payments that always
        # showed real names.
        search_cols = [
            "e.name", "e.description", "e.type", "e.projects",
            "v.vendor_name", "pr.project_name",
        ]
        where_search = (
            " AND (" + " OR ".join(f"lower(coalesce({c}::text,'')) LIKE %s" for c in search_cols)
            + ")"
            if has_search
            else ""
        )
        sql = f"""
            SELECT e.name, e.amount, e.status, e.description, e.type,
                   e.projects AS project, v.vendor_name, pr.project_name, e.modified
            FROM "tabProject Expenses" e
            LEFT JOIN "tabVendors" v ON v.name = e.vendor
            LEFT JOIN "tabProjects" pr ON pr.name = e.projects
            WHERE e.status IN ({status_ph})
              AND e.amount IS NOT NULL AND btrim(e.amount) <> ''
              {where_search}
            ORDER BY abs(CAST(NULLIF(btrim(e.amount), '') AS numeric) - %s) ASC, e.modified DESC
            LIMIT %s
        """
    else:
        search_cols = ["name", "description", "type"]
        where_search = (
            " AND (" + " OR ".join(f"lower(coalesce({c}::text,'')) LIKE %s" for c in search_cols)
            + ")"
            if has_search
            else ""
        )
        sql = f"""
            SELECT name, amount, status, description, type,
                   NULL AS project, NULL AS vendor_name, NULL AS project_name, modified
            FROM "tabNon Project Expenses"
            WHERE status IN ({status_ph})
              AND amount IS NOT NULL
              {where_search}
            ORDER BY abs(amount - %s) ASC, modified DESC
            LIMIT %s
        """

    params = [*statuses]
    if has_search:
        params.extend([needle] * len(search_cols))
    params.extend([float(bank_amount), limit])
    return [
        {
            "target_doctype": target_doctype,
            "name": r["name"],
            "amount": float(normalize_amount(r.get("amount"))),
            "vendor_name": r.get("vendor_name") or "",
            "project_name": r.get("project_name") or r.get("project") or "",
            "document_name": r.get("type") or "",
            "approved_on": "",
            "updated_on": str(r["modified"]) if r.get("modified") else "",
            "detail": " · ".join(
                [
                    p
                    for p in (
                        r.get("type"),
                        r.get("project_name") or r.get("project"),
                        r.get("description"),
                    )
                    if p
                ]
            )[:120],
            "suggested": amounts_match(normalize_amount(r.get("amount")), bank_amount),
        }
        for r in frappe.db.sql(sql, tuple(params), as_dict=True)
    ]


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
               resolved_vendor, resolved_project, suggested_doctype, suggested_name,
               row_status, skip_reason, outcome_note
        FROM "tabOutflow Import Row"
        WHERE import_batch = %s
        ORDER BY added_on ASC, name ASC
        """,
        (batch,),
        as_dict=True,
    )


def _refresh_batch_rollup(batch: str) -> list:
    """Recompute the batch's counters and status from its rows. `status.py` is the only deriver.

    ⚠️ v3: `closed_at` NO LONGER FEEDS THE STATUS. `Completed with exceptions` is retired, so
    closing is pure bookkeeping -- a batch closed with rows outstanding reads `Partially Settled`,
    which is the truth, and the three tabs show exactly which rows are outstanding. The flag is
    still recorded and still read by the screen; it just no longer changes what the status says.
    """
    statuses = [
        r["row_status"] or ""
        for r in frappe.db.sql(
            """SELECT row_status FROM "tabOutflow Import Row" WHERE import_batch = %s""",
            (batch,),
            as_dict=True,
        )
    ]
    values = dict(derive_batch_counters(statuses))
    values["status"] = derive_batch_status(statuses)
    frappe.db.set_value(BATCH_DOCTYPE, batch, values, update_modified=False)
    return statuses


@frappe.whitelist(methods=["POST"])
def close_batch(batch: str, reason: str = None):
    """Close a batch, accepting that its remaining rows will not be decided.

    ⚠️ CLOSING DOES NOT CONVERT THE OPEN ROWS TO `Skipped`, and that is a deliberate reversal of
    what the v1 design described. A skip is a DECISION -- which is exactly why a manual one requires
    a typed reason (owner ruling) -- and auto-skipping on close would manufacture decisions nobody
    made, replacing "never decided" with a fabricated "deliberately skipped" on every row.

    Instead the abandonment is recorded ONCE, on the batch, as `closed_at`.

    ⚠️ v3: that flag NO LONGER CHANGES THE DERIVED STATUS. `Completed with exceptions` is retired
    (owner ruling) -- a batch closed with work outstanding reads `Partially Settled`, and the three
    tabs show which rows are outstanding directly, which is what the retired status was standing in
    for. V5 simplifies this endpoint and its dialog to a single button.

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
        "status": derive_batch_status(statuses),
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
