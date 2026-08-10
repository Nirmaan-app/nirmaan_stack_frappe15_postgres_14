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

from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.services.outflow_import import candidates as C
from nirmaan_stack.services.outflow_import.matcher import (
    match_by_reference,
    match_row,
    resolve_vendors,
)
from nirmaan_stack.services.outflow_import.amounts import amounts_match, rewrite_amount
from nirmaan_stack.services.outflow_import.ledgers import (
    LEDGER_DOCTYPES,
    NON_PROJECT_EXPENSE_DOCTYPE as NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE_DOCTYPE as PROJECT_EXPENSE,
    settleable_statuses,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.status import (
    ROW_ERROR,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
    ROW_STATUSES,
    StatusTally,
    derive_batch_counters,
    derive_batch_status,
    derive_import_summary,
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
            result = match_row(
                row,
                pools["vendors"],
                pools["payments"],
                pools["expenses"],
                pools["projects"],
            )
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
    project_index = C.load_project_index()
    references = [r.normalized_reference for r in rows]

    # Tier 0 pool: APPROVED payments whose stored reference matches one of ours.
    by_reference = C.load_payments_by_reference(references)

    # ⚠️ A SEPARATE POOL, AND A SEPARATE QUERY, FOR A SEPARATE QUESTION (owner ruling Q14). These
    # are PAID payments already carrying one of our references -- somebody ticked them by hand
    # before this statement was uploaded. They are a duplicate guard, never a settle candidate, and
    # merging them into `by_reference` would let the same money be recorded twice. Under Q12 that
    # is the common case, not an edge case.
    paid_duplicates = C.load_paid_payments_by_reference(references)

    # Tier 1 + tier 2 pool: APPROVED payments at these amounts, scoped by NOTHING ELSE. The matcher
    # narrows it per tier -- by vendor account at tier 1, by project at tier 2 -- so a pool scoped by
    # either axis here would be narrower than one of the tiers and would hide matches silently.
    by_amount = C.load_payments_by_amount([r.amount for r in rows])

    # The union is correct for every tier: tier 0 filters it by reference, tier 1 by vendor account
    # and the strict window, tier 2 by project.
    payments = {t.name: t for t in (*by_reference, *by_amount)}

    return {
        "vendors": vendor_index,
        "projects": project_index,
        "payments": tuple(payments.values()),
        "paid_duplicates": paid_duplicates,
        "expenses": C.load_expense_targets([r.amount for r in rows]),
    }


def _paid_duplicate_for(row, pools):
    """The already-Paid group this row duplicates, or None.

    Reuses `match_by_reference` rather than hand-rolling a reference compare, so a FAN-OUT that was
    recorded by hand is recognised as ONE already-recorded transfer instead of a shortfall against
    whichever payment happened to be found first. The matcher is untouched -- only the pool differs.

    ⚠️ IT CALLS `match_by_reference`, NOT `match_payments`, AND THE DISTINCTION IS THE GUARD. This
    must match on the bank reference ALONE: tiers 1 and 2 are SUGGESTION heuristics, and a heuristic
    hit here would SKIP a row on a guess, which is the one outcome a duplicate guard may never
    produce. It used to call `match_payments` with no vendor and rely on the lower passes being
    unable to run without one -- true at the time, but true by argument rather than by construction,
    and tier 2 needs no vendor at all. Naming the reference-only function makes it structural.
    """
    groups = match_by_reference(row, pools["paid_duplicates"])
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

    related = _related_paid_payments(rows)

    return {
        "batch": batch,
        "rows": [
            {
                **row,
                "amount": float(row.get("amount") or 0),
                "service_charge": float(row.get("service_charge") or 0),
                "service_tax": float(row.get("service_tax") or 0),
                "matches": by_row.get(row["name"], []),
                "related_payments": related.get(row.get("normalized_reference") or "", []),
            }
            for row in rows
        ],
    }


def _related_paid_payments(rows: list) -> dict[str, list]:
    """Already-Paid payments each row's bank reference points at, keyed by that reference.

    ⚠️ THIS IS WHAT MAKES A SKIPPED ROW CLICKABLE. A row skipped as an already-recorded duplicate --
    and a `Mismatched` row, which comes from the same check -- names its payment ONLY inside
    `outcome_note`, a sentence written for a person. It has no `Outflow Row Match` record (a skip
    settles nothing and deletes them) and no stored suggestion (`sole_suggestion` is gated on
    `Matched`, deliberately, so a skipped row can never render as ready to confirm). So the screen
    had the payment's NAME in prose and no way to link it.

    ⚠️ DERIVED HERE RATHER THAN PARSED FROM THE NOTE, and rather than persisted. Parsing the sentence
    back out would be guessing at a fact the database already holds exactly. Persisting it would mean
    another field and another migrate on a branch that already owes six. This reuses the SAME loader
    the matcher's duplicate guard uses, so the two can never disagree about which payment a row
    refers to -- one query for the whole batch, which is tens of rows, not thousands.

    Keyed by REFERENCE, not by row: several bank rows can share one reference (that is what a
    fan-out is), and they should all point at the same payments.

    Computing it for every row is safe. A `Matched` row cannot have a paid payment at its reference:
    the duplicate check runs FIRST and would have skipped it, so the lookup comes back empty on its
    own rather than by being excluded here.
    """
    references = [r.get("normalized_reference") or "" for r in rows]
    by_reference: dict[str, list] = {}
    for target in C.load_paid_payments_by_reference(references):
        by_reference.setdefault(target.normalized_reference, []).append(
            {"target_doctype": target.doctype, "target_name": target.name}
        )
    return by_reference


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
    project_index = C.load_project_index()
    resolution = resolve_vendors(staged, vendor_index)
    payments = {
        t.name: t
        for t in (
            *C.load_payments_by_reference([staged.normalized_reference]),
            *C.load_payments_by_amount([staged.amount]),
        )
    }
    expenses = C.load_expense_targets([staged.amount])
    result = match_row(
        staged, vendor_index, tuple(payments.values()), expenses, project_index
    )

    return {
        "row": row,
        "tier": result.tier,
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


# --- the master table (slice X3) ----------------------------------------------------------------

# The three tabs, as STATUS SETS (owner ruling 2026-08-10, replacing Pending / Settled / Skipped).
#
#   all           everything EXCEPT Skipped
#   not_matched   the work: staged, did not line up, or the write failed
#   matched       found something, or already written -- the two "this is handled" states
#
# ⚠️ `Skipped` HAS NO TAB, AND IS EXCLUDED FROM `all` TOO (owner ruling). It is not "everything";
# it is everything a person might still act on. Skipped rows are bookkeeping -- a failed transfer, a
# duplicate, a payment already ticked Paid by hand -- and on a real statement they are ~5% of the
# file that nobody will ever open again. THE IMPORT SUMMARY PANEL IS NOW THE ONLY PLACE THEY ARE
# REPORTED (its auto/manual split line); if that line is ever removed, a skipped transfer becomes
# invisible rather than merely out of the way.
#
# ⚠️ `Matched` AND `Settled` SHARE A TAB, and the pairing is the reviewer's, not the vocabulary's:
# both mean "this transfer has a record", one confirmed and one not. `Settled` is terminal and
# `Matched` is open, so this tab holds a MIX -- which is why row selection is per-row rather than
# per-tab on the screen.
SCOPE_ALL = "all"
SCOPE_NOT_MATCHED = "not_matched"
SCOPE_MATCHED = "matched"

_SCOPE_STATUSES = {
    # ⚠️ `all` CARRIES A REAL CLAUSE NOW, and it did not before. It used to fall through to "no
    # WHERE at all", which was correct when it meant every row. Excluding `Skipped` makes it an
    # actual filter, and forgetting that is exactly how skipped rows would leak back into the one
    # tab nobody would think to check.
    SCOPE_ALL: tuple(s for s in ROW_STATUSES if s != ROW_SKIPPED),
    SCOPE_NOT_MATCHED: (ROW_PENDING_MATCH, ROW_MISMATCHED, ROW_ERROR),
    SCOPE_MATCHED: (ROW_MATCHED, ROW_SETTLED),
}

# ⚠️ AN ALLOW-LIST, BECAUSE THE SORT COLUMN IS INTERPOLATED INTO SQL. A sort key cannot be a bound
# parameter, so the only safe form is a mapping from an id the client may send to a column this
# module names itself. Never widen this by passing the client's string through.
_SORTABLE_COLUMNS = {
    "added_on": "r.added_on",
    "amount": "r.amount",
    "beneficiary_name": "r.beneficiary_name",
    "bank_reference_no": "r.bank_reference_no",
    "row_status": "r.row_status",
    "import_batch": "r.import_batch",
    "remarks": "r.remarks",
}

_SEARCHABLE_COLUMNS = (
    "r.beneficiary_name",
    "r.remarks",
    "r.bank_reference_no",
    "r.transfer_id",
    "r.bank_account",
)

# ⚠️ THE FACET COLUMNS SURVIVED THE MOVE TO SERVER PAGING, AND KEEPING THEM WAS DELIBERATE. The
# batch screen offered a multi-select funnel per column, built from the distinct values of the rows
# it had loaded. Paging breaks that -- a page of fifty rows knows fifty beneficiaries -- and the
# easy answer was to drop the funnels and ship only search + date + amount. That would have been a
# silent capability cut in a refactor nobody asked to lose anything in. So the distinct values come
# from the database instead, over the WHOLE filtered table, through `get_outflow_facet_values`.
#
# An allow-list for the same reason as `_SORTABLE_COLUMNS`: the column name is interpolated.
_FACET_COLUMNS = {
    "beneficiary_name": "r.beneficiary_name",
    "row_status": "r.row_status",
    "bank_account": "r.bank_account",
    "ifsc": "r.ifsc",
    "import_batch": "r.import_batch",
    # The screen facets on the DAY, not the timestamp -- which is what a person means by "the
    # payment date". `added_on` is a Datetime, so the cast is what makes the facet's values match
    # the cell's text.
    "added_on": "CAST(r.added_on AS date)",
}

# One page. Generous enough that a whole statement usually fits on one, capped so a client cannot
# ask for the entire table and reinstate the problem this endpoint exists to solve.
_DEFAULT_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 200


@frappe.whitelist()
def get_outflow_rows(
    scope: str = SCOPE_NOT_MATCHED,
    batch: str = None,
    search: str = None,
    date_from: str = None,
    date_to: str = None,
    amount_min=None,
    amount_max=None,
    facets=None,
    sort_by: str = "added_on",
    sort_dir: str = "desc",
    limit=_DEFAULT_PAGE_SIZE,
    offset=0,
):
    """One page of transactions across EVERY import (slice X3).

    ⚠️ THIS REPLACES `get_batch_rows` AS THE SCREEN'S READ, AND THE REASON IS SIZE. The batch screen
    loaded a whole import in one call and filtered, sorted and searched it IN THE BROWSER -- correct
    for the twenty-six rows of one statement, wrong for every row ever staged. Weekly statements
    reach thousands within a couple of years. `get_batch_rows` is KEPT: the api suites read it, and
    it is still the honest way to ask for exactly one import's rows.

    ⚠️ THE DEFAULT SCOPE IS `not_matched`, WHICH IS A PRODUCT DECISION, NOT A PERFORMANCE ONE (owner
    ruling 2026-08-09, carried across the 2026-08-10 retab). The master table is a worklist first:
    what it opens on is the work somebody still owes a decision on, not months of settled history
    that happens to sort first by date. It is NARROWER than the old `open` default, which also held
    `Matched` -- those rows now live with `Settled`, because both mean "this transfer has a record".

    FILTER COMPOSITION IS `AND` ACROSS COLUMNS, `OR` WITHIN ONE -- the same rule the rest of this
    app's tables use, and the same one the client-side filters it replaces used.

    `tab_counts` comes back with every page. It is deliberately computed under the SAME filters
    minus the scope, so the three tab numbers describe the search a person is actually looking at
    rather than the whole table -- a search that matches four rows should not show "Settled 812".
    """
    require_outflow_access()

    where, params = _row_filters(
        batch=batch,
        search=search,
        date_from=date_from,
        date_to=date_to,
        amount_min=amount_min,
        amount_max=amount_max,
        facets=facets,
    )
    scoped_where, scoped_params = _scope_clause(scope)

    limit = max(1, min(int(limit or _DEFAULT_PAGE_SIZE), _MAX_PAGE_SIZE))
    offset = max(0, int(offset or 0))

    column = _SORTABLE_COLUMNS.get(sort_by or "", _SORTABLE_COLUMNS["added_on"])
    direction = "ASC" if (sort_dir or "").lower() == "asc" else "DESC"

    all_where = where + scoped_where
    all_params = params + scoped_params
    clause = (" WHERE " + " AND ".join(all_where)) if all_where else ""

    rows = frappe.db.sql(
        f"""
        SELECT r.name, r.import_batch, r.transfer_id, r.reference_id, r.added_on, r.amount,
               r.status_raw, r.beneficiary_name, r.beneficiary_id, r.bank_account, r.ifsc,
               r.remarks, r.bank_reference_no, r.service_charge, r.service_tax, r.added_by_raw,
               r.normalized_account, r.normalized_reference, r.resolved_vendor, r.resolved_project,
               r.suggested_doctype, r.suggested_name, r.row_status, r.skip_reason, r.outcome_note,
               b.original_filename AS import_filename,
               b.period_from       AS import_period_from,
               b.period_to         AS import_period_to
        FROM "tabOutflow Import Row" r
        LEFT JOIN "tabOutflow Import Batch" b ON b.name = r.import_batch
        {clause}
        ORDER BY {column} {direction}, r.name ASC
        LIMIT %s OFFSET %s
        """,
        tuple(all_params) + (limit, offset),
        as_dict=True,
    )

    total = frappe.db.sql(
        f"""SELECT COUNT(*) AS n FROM "tabOutflow Import Row" r {clause}""",
        tuple(all_params),
        as_dict=True,
    )[0]["n"]

    related = _related_paid_payments(rows)

    return {
        "rows": [
            {
                **row,
                "amount": float(row.get("amount") or 0),
                "service_charge": float(row.get("service_charge") or 0),
                "service_tax": float(row.get("service_tax") or 0),
                # Kept for shape-compatibility with `get_batch_rows`, which the decision dialog and
                # the settlement-link helpers already read. A master-table page never carries match
                # records: they mean "settled", and the Settled tab reads them per row on demand.
                "matches": [],
                "related_payments": related.get(row.get("normalized_reference") or "", []),
            }
            for row in rows
        ],
        "total": int(total or 0),
        "limit": limit,
        "offset": offset,
        "scope": scope,
        "tab_counts": _tab_counts(where, params),
    }


def _row_filters(*, batch, search, date_from, date_to, amount_min, amount_max, facets=None):
    """The WHERE fragments shared by the page query, its count, and the tab counts.

    ⚠️ ONE BUILDER FOR ALL FOUR (the facet-values query too), because a count computed under
    different filters than the page it labels is a lie that looks like a paging bug. Everything is
    a bound parameter; the only interpolated values anywhere in this endpoint are the sort column
    and the facet column, both from allow-lists.
    """
    where, params = [], []

    if batch:
        where.append("r.import_batch = %s")
        params.append(batch)

    text = (search or "").strip()
    if text:
        # OR within the one "column" a person perceives as search: they are hunting a transfer, and
        # do not know or care which field carries what they half-remember.
        needle = f"%{text}%"
        where.append(
            "(" + " OR ".join(f"COALESCE({c}, '') ILIKE %s" for c in _SEARCHABLE_COLUMNS) + ")"
        )
        params.extend([needle] * len(_SEARCHABLE_COLUMNS))

    if date_from:
        where.append("r.added_on >= %s")
        params.append(date_from)
    if date_to:
        # Inclusive of the whole end DAY. `added_on` is a Datetime, so a bare date bound would
        # silently exclude everything after midnight on the day a person typed.
        where.append("r.added_on < (%s::date + INTERVAL '1 day')")
        params.append(date_to)

    if amount_min not in (None, ""):
        where.append("r.amount >= %s")
        params.append(float(amount_min))
    if amount_max not in (None, ""):
        where.append("r.amount <= %s")
        params.append(float(amount_max))

    for column, chosen in _parsed_facets(facets).items():
        # ⚠️ AN EMPTY SELECTION MEANS "NO FILTER ON THIS COLUMN", NOT "MATCH NOTHING" -- the same
        # rule the client-side filters used. Otherwise unticking the last value blanks the table
        # instead of clearing the filter, which reads as a bug every single time.
        if not chosen:
            continue
        expression = _FACET_COLUMNS[column]
        placeholders = ", ".join(["%s"] * len(chosen))
        where.append(f"CAST({expression} AS text) IN ({placeholders})")
        params.extend([str(v) for v in chosen])

    return where, params


def _parsed_facets(facets) -> dict:
    """`{column: [values]}`, keeping only the columns on the allow-list.

    Arrives as a JSON string on a GET and as a real dict on a JSON POST, so both are accepted. An
    UNKNOWN column is dropped SILENTLY rather than throwing: a stale bookmark carrying a facet from
    a column that has since been removed should show an unfiltered table, not an error page.
    """
    if not facets:
        return {}
    if isinstance(facets, str):
        try:
            facets = frappe.parse_json(facets)
        except Exception:
            return {}
    if not isinstance(facets, dict):
        return {}
    return {
        column: list(values or [])
        for column, values in facets.items()
        if column in _FACET_COLUMNS
    }


@frappe.whitelist()
def get_outflow_facet_values(
    column: str,
    batch: str = None,
    search: str = None,
    date_from: str = None,
    date_to: str = None,
    amount_min=None,
    amount_max=None,
    scope: str = None,
    limit=500,
):
    """The distinct values one funnel offers, over the WHOLE filtered table (slice X3).

    ⚠️ THIS EXISTS SO SERVER PAGING DID NOT COST THE SCREEN ITS FUNNELS. The client used to build
    them from the rows it held; a page of fifty rows knows fifty beneficiaries, so the same code
    against a paged table would offer a funnel that quietly hides most of its own options.

    ⚠️ THE COLUMN'S OWN FACET SELECTION IS DELIBERATELY NOT APPLIED. A funnel that filtered its own
    options would collapse to whatever is already ticked the moment you opened it, and there would
    be no way back to the values you unticked. Every OTHER filter is applied, so the options stay
    relevant to what is on screen.
    """
    require_outflow_access()
    if column not in _FACET_COLUMNS:
        frappe.throw(f"'{column}' is not a filterable column.", title="Unknown column")

    where, params = _row_filters(
        batch=batch,
        search=search,
        date_from=date_from,
        date_to=date_to,
        amount_min=amount_min,
        amount_max=amount_max,
    )
    scoped_where, scoped_params = _scope_clause(scope) if scope else ([], [])
    where, params = where + scoped_where, params + scoped_params
    clause = (" WHERE " + " AND ".join(where)) if where else ""

    expression = _FACET_COLUMNS[column]
    rows = frappe.db.sql(
        f"""
        SELECT DISTINCT CAST({expression} AS text) AS value
        FROM "tabOutflow Import Row" r
        {clause}
        ORDER BY value ASC
        LIMIT %s
        """,
        tuple(params) + (max(1, min(int(limit or 500), 2000)),),
        as_dict=True,
    )
    return {
        "column": column,
        "values": [r["value"] for r in rows if (r["value"] or "").strip()],
    }


def _scope_clause(scope: str):
    """The tab, as a status set. An unknown scope falls back to `all` rather than to nothing.

    Failing open is right here: a client sending a scope this server has not heard of should see the
    whole table, which is visibly odd, rather than an empty one, which reads as "there is no work".

    ⚠️ FAILING OPEN NOW MEANS `all`, NOT "NO CLAUSE" -- and the distinction is load-bearing since
    `all` stopped meaning every row. Returning `[], []` here would let a typo'd scope show `Skipped`
    rows that every real tab excludes, in the one view nobody would think to check. `all` is the
    widest set a client may ask for, so it is also the right thing to fall back to.
    """
    statuses = _SCOPE_STATUSES.get((scope or "").lower()) or _SCOPE_STATUSES[SCOPE_ALL]
    placeholders = ", ".join(["%s"] * len(statuses))
    return [f"r.row_status IN ({placeholders})"], list(statuses)


def _tab_counts(where, params) -> dict:
    """How many rows each tab holds UNDER THE CURRENT FILTERS, in one grouped query.

    ⚠️ EVERY COUNT IS DERIVED FROM `_SCOPE_STATUSES`, never from a second list of statuses written
    out here. The counts label the tabs, so a count that disagrees with what the tab actually shows
    is worse than no count -- and with `Skipped` now excluded from `all`, a hand-written `all` count
    would over-report by exactly the rows the tab refuses to show.
    """
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    grouped = frappe.db.sql(
        f"""
        SELECT r.row_status AS status, COUNT(*) AS n
        FROM "tabOutflow Import Row" r
        {clause}
        GROUP BY r.row_status
        """,
        tuple(params),
        as_dict=True,
    )
    by_status = {(g["status"] or ""): int(g["n"] or 0) for g in grouped}
    return {
        scope: sum(n for s, n in by_status.items() if s in statuses)
        for scope, statuses in _SCOPE_STATUSES.items()
    }


@frappe.whitelist()
def get_confirmable_rows(batch: str):
    """What "Confirm all matched" can and cannot act on, for one import (slice X5).

    ⚠️ `Matched` IS NOT THE SAME AS CONFIRMABLE, AND CONFLATING THEM IS THE TRAP IN THIS FEATURE. A
    row is `Matched` when the matcher found one OR MORE approved records. When it found several it
    deliberately stores NO suggestion -- the screen never guesses between two real records -- so
    those rows have nothing to confirm them AGAINST. They come back in `needs_you`: listed, linked,
    and never auto-confirmable.

    ⚠️ EVERY READY ROW CARRIES ITS AMOUNT DELTA, and that is not decoration. Since X1 a settle
    REWRITES the record's amount to the bank's whenever they differ, so confirming forty rows can
    silently change forty approved figures. The person clicking is entitled to see
    `18,678.69 -> 18,679.00` BEFORE the click, not discover it afterwards.

    ⚠️ IT DOES NOT RE-RUN THE MATCH. The suggestions were computed whenever the match last ran, and
    a payment may have been ticked Paid by hand since. That is safe to leave: the per-row write
    guard re-asserts status and amount under a row lock, so a stale confirm FAILS rather than
    writing the wrong thing. Forcing a re-match here would be theatre over a guard that already
    holds.
    """
    require_outflow_access()
    _assert_batch(batch)

    rows = frappe.db.sql(
        """
        SELECT name, transfer_id, added_on, amount, beneficiary_name, remarks,
               bank_reference_no, suggested_doctype, suggested_name, outcome_note
        FROM "tabOutflow Import Row"
        WHERE import_batch = %s AND row_status = %s
        ORDER BY added_on ASC, name ASC
        """,
        (batch, ROW_MATCHED),
        as_dict=True,
    )

    wanted: dict[str, list] = {}
    for row in rows:
        doctype = (row.get("suggested_doctype") or "").strip()
        name = (row.get("suggested_name") or "").strip()
        if doctype and name:
            wanted.setdefault(doctype, []).append(name)

    targets: dict[tuple, dict] = {}
    for doctype, names in wanted.items():
        for name, detail in _targets_by_name(doctype, names).items():
            targets[(doctype, name)] = detail

    ready, needs_you = [], []
    for row in rows:
        doctype = (row.get("suggested_doctype") or "").strip()
        name = (row.get("suggested_name") or "").strip()
        bank_amount = normalize_amount(row.get("amount"))
        base = {
            "name": row["name"],
            "added_on": row.get("added_on"),
            "amount": float(bank_amount),
            "beneficiary_name": row.get("beneficiary_name"),
            "remarks": row.get("remarks"),
            "bank_reference_no": row.get("bank_reference_no"),
            "outcome_note": row.get("outcome_note"),
        }

        detail = targets.get((doctype, name)) if doctype and name else None
        if not detail:
            # No suggestion, or one pointing at a record that has since gone. Both mean the same
            # thing to this screen: a person has to open it.
            needs_you.append(base)
            continue

        record_amount = normalize_amount(detail.get("amount"))
        base.update(
            {
                "target_doctype": doctype,
                "target_name": name,
                "target_amount": float(record_amount),
                "target_status": detail.get("status"),
                "vendor_name": detail.get("vendor_name"),
                "project_name": detail.get("project_name"),
                # X1: what confirming will WRITE onto the record, and by how much it moves.
                "amount_delta": float(bank_amount - record_amount),
                "amount_changes": rewrite_amount(record_amount, bank_amount) is not None,
            }
        )
        ready.append(base)

    return {
        "batch": batch,
        "ready": ready,
        "needs_you": needs_you,
        "ready_value": float(sum(normalize_amount(r["amount"]) for r in ready)),
    }


def _targets_by_name(target_doctype: str, names: list) -> dict:
    """One ledger's records, by name, with the facts the confirm list shows.

    ⚠️ IT RE-READS STATUS RATHER THAN TRUSTING THE MATCH RUN. A payment ticked Paid by hand since the
    match would otherwise be offered as ready to confirm; showing its real status lets the dialog
    grey it out before somebody clicks a button that is going to be refused anyway.

    Separate queries per ledger for the same reason `_search_one_ledger` is separate: the three
    genuinely differ -- two joins on payments, one on project expenses, none on non-project ones --
    and folding them into one parametrised query would hide the asymmetries a reader needs to see.
    """
    if not names:
        return {}
    placeholders = ", ".join(["%s"] * len(names))

    if target_doctype == C.PAYMENT_DOCTYPE:
        rows = frappe.db.sql(
            f"""
            SELECT p.name, p.amount, p.status, v.vendor_name, pr.project_name
            FROM "tabProject Payments" p
            LEFT JOIN "tabVendors" v ON v.name = p.vendor
            LEFT JOIN "tabProjects" pr ON pr.name = p.project
            WHERE p.name IN ({placeholders})
            """,
            tuple(names),
            as_dict=True,
        )
    elif target_doctype == PROJECT_EXPENSE:
        rows = frappe.db.sql(
            f"""
            SELECT e.name, e.amount, e.status, v.vendor_name, pr.project_name
            FROM "tabProject Expenses" e
            LEFT JOIN "tabVendors" v ON v.name = e.vendor
            LEFT JOIN "tabProjects" pr ON pr.name = e.projects
            WHERE e.name IN ({placeholders})
            """,
            tuple(names),
            as_dict=True,
        )
    else:
        # `Non Project Expenses` has NO vendor and NO project column at all -- the third of the
        # three doctype asymmetries. Selecting either would be a hard SQL error, not a blank.
        rows = frappe.db.sql(
            f"""
            SELECT e.name, e.amount, e.status,
                   NULL AS vendor_name, NULL AS project_name
            FROM "tabNon Project Expenses" e
            WHERE e.name IN ({placeholders})
            """,
            tuple(names),
            as_dict=True,
        )

    return {r["name"]: r for r in rows}


@frappe.whitelist()
def list_imports(limit=60):
    """The import picker's options: newest first, labelled by what a person recognises.

    ⚠️ NOT THE BATCH ID. An accountant knows a statement by its file and the fortnight it covers;
    `OFI-26-00007` means nothing to them. The picker composes its label from these fields.
    """
    require_outflow_access()
    return frappe.db.sql(
        """
        SELECT name, original_filename, period_from, period_to, status,
               total_rows, uploaded_at, uploaded_by
        FROM "tabOutflow Import Batch"
        ORDER BY uploaded_at DESC NULLS LAST, creation DESC
        LIMIT %s
        """,
        (max(1, min(int(limit or 60), 200)),),
        as_dict=True,
    )


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

    ⚠️ THERE IS NO CLOSE ANY MORE. `closed_at` was already excluded from the status derivation when
    `Completed with exceptions` was retired; the close ACTION itself went at the 2026-08-10 owner
    ruling (see the note where its endpoints used to be). The field survives on the doctype holding
    the history of batches closed before then, and nothing writes or reads it.
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


@frappe.whitelist()
def get_import_summary(batch: str):
    """Everything the summary section reports about one import (slice X2).

    ⚠️ ONE `GROUP BY`, NOT A ROW LOOP. This is a count and a sum over every row of an import, which
    ADR-0010 puts in the database. `get_batch_rows` exists for the rows themselves; using it here
    would load the whole import to add up two columns, and would get slower every month the feature
    is used. The pure `derive_import_summary` assembles what the query returns.

    ⚠️ IT DERIVES NOTHING ITSELF. Every count, sum and percentage comes out of `status.py`, which is
    the only deriver in this feature (ADR-0010 B3). A summary that computed its own numbers could
    disagree with the tabs directly beneath it, which is worse than showing no summary at all.

    ⚠️ THE AUTO / MANUAL SKIP SPLIT KEYS ON `decided_by`, NOT ON THE REASON TEXT. A skip written at
    upload carries a system-generated `skip_reason` and no decider; a manual one records the person.
    That is a fact the database already holds exactly, so it needs no sentence parsed -- the same
    rule `_related_paid_payments` follows for exactly the same reason.
    """
    require_outflow_access()
    _assert_batch(batch)

    grouped = frappe.db.sql(
        """
        SELECT row_status                                        AS status,
               COUNT(*)                                          AS count,
               COALESCE(SUM(amount), 0)                          AS value,
               COALESCE(SUM(CASE WHEN COALESCE(suggested_name, '') <> ''
                                 THEN 1 ELSE 0 END), 0)          AS with_suggestion,
               COALESCE(SUM(CASE WHEN COALESCE(suggested_name, '') <> ''
                                 THEN amount ELSE 0 END), 0)     AS suggested_value,
               COALESCE(SUM(CASE WHEN COALESCE(decided_by, '') = ''
                                 THEN 1 ELSE 0 END), 0)          AS undecided_by_a_person
        FROM "tabOutflow Import Row"
        WHERE import_batch = %s
        GROUP BY row_status
        """,
        (batch,),
        as_dict=True,
    )

    summary = derive_import_summary(
        StatusTally(
            status=g["status"] or "",
            count=int(g["count"] or 0),
            value=normalize_amount(g["value"]),
            with_suggestion=int(g["with_suggestion"] or 0),
            suggested_value=normalize_amount(g["suggested_value"]),
        )
        for g in grouped
    )

    auto_skipped = sum(
        int(g["undecided_by_a_person"] or 0)
        for g in grouped
        if (g["status"] or "") == ROW_SKIPPED
    )

    meta = frappe.db.get_value(
        BATCH_DOCTYPE,
        batch,
        [
            "name", "original_filename", "source", "period_from", "period_to",
            "status", "gross_amount", "charges_amount", "overlaps_batch",
            "uploaded_by", "uploaded_at",
        ],
        as_dict=True,
    )

    return {
        "batch": batch,
        "import": meta,
        "totals": _jsonable_summary(summary),
        # Which skips were the system's and which were a person's. The screen labels them
        # differently because they mean different things: one is bookkeeping, one is a decision.
        "auto_skipped_rows": auto_skipped,
        "manually_skipped_rows": max(summary["skipped_rows"] - auto_skipped, 0),
    }


def _jsonable_summary(summary: dict) -> dict:
    """Decimals to floats for transport, without touching the deriver's own types.

    The pure module works in `Decimal` because money does; the wire does not carry one. Converting
    HERE rather than in `derive_import_summary` keeps the deriver exact and testable in the type it
    actually reasons in.
    """
    out = {}
    for key, value in summary.items():
        if key == "by_status":
            out[key] = {
                status: {"count": bucket["count"], "value": float(bucket["value"])}
                for status, bucket in value.items()
            }
        elif isinstance(value, Decimal):
            out[key] = float(value)
        else:
            out[key] = value
    return out


# ⚠️ `close_batch` / `reopen_batch` / `get_close_preview` ARE GONE (owner ruling 2026-08-10), and
# what they did is worth stating so nobody re-adds them by accident. Closing stamped `closed_at`,
# `closed_by` and `close_reason` on the batch. It changed no row status, it did not freeze anything,
# and -- since `Completed with exceptions` was retired -- it did not change the derived batch status
# either. The screen showed a banner; nothing else read the flag.
#
# At X3 an import stopped being a PLACE. There is one master table across every import, so "close
# this import" no longer marks anything as finished with: the rows stay in the same table, in the
# same tabs, doing the same work. A control that writes three fields nobody reads is worse than no
# control, because people reasonably assume it must do something.
#
# THE THREE FIELDS ARE DELIBERATELY LEFT ON `Outflow Import Batch`. Dropping them is a migrate that
# destroys the close history of every batch already closed, to save nothing. They are simply no
# longer written, and no longer returned by `get_import_summary` or `list_imports`.
