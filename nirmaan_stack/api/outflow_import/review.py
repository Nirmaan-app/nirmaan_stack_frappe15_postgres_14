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
from nirmaan_stack.services.outflow_import.claims import (
    Claim,
    claim_note,
    resolve_claims,
)
from nirmaan_stack.services.outflow_import.disambiguate import (
    RULE_SOLE,
    RULE_STACK_NEAREST_DATE,
    RULE_STACK_PAIRING,
    Candidate,
    pick_from_several,
    pick_note,
)
from nirmaan_stack.services.outflow_import.ledgers import (
    LEDGER_DOCTYPES,
    NON_PROJECT_EXPENSE_DOCTYPE as NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE_DOCTYPE as PROJECT_EXPENSE,
    settleable_statuses,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.parser import BANK_SUCCESS_STATUS
# ⚠️ THE BROWSE LIST'S RANKING, AND NOTHING ELSE IN THIS MODULE MAY USE IT. `similarity` orders the
# records a person chooses from in the Resolve dialog; it must never reach `match_batch` or anything
# it calls. See the rule at the top of `similarity.py` -- its weights exist to be tuned against
# reviewer feedback, and a tuning change must not be able to alter what settles unattended.
from nirmaan_stack.services.outflow_import.similarity import (
    RecordSignals,
    build_row_signals,
    ranked_records,
)
from nirmaan_stack.services.outflow_import.stacks import (
    Stack,
    group_into_stacks,
    pair_stack,
    stack_key,
    stack_note,
    stack_surplus_note,
)
from nirmaan_stack.services.outflow_import.status import (
    ORIGIN_ACCEPTED,
    OPEN_ROW_STATUSES,
    settleable_candidates,
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
    several_found_note,
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

    paired = 0
    released = 0
    picked = 0
    swept = 0
    if matchable:
        pools = _load_pools(matchable, batch)
        results: dict = {}
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
            # Kept so the Option B pass below can reuse them. Re-running `match_row` per row would
            # be the same work twice over pools that are already loaded.
            results[row.name] = (row, result, outcome)

        # ⚠️ BEFORE THE STACK PASS, AND AFTER THE LOOP. The per-row loop asks a question about ONE
        # row -- "did this transfer find exactly one approved record?" -- and answers it
        # independently for every row, so two transfers can each correctly find the SAME single
        # record. The stack pass reads a `claimed` set built from those suggestions, so it must run
        # against a set that has already been made consistent, or it inherits the duplicates.
        released = _enforce_single_claim(matchable)

        # ⚠️ AFTER THE CLAIM PASS. That pass frees records up, and choosing between candidates while
        # another row still held one of them would only produce a pick for it to release.
        picked = _disambiguate_matched(results, pools)

        # ⚠️ AFTER THE PER-ROW LOOP, NEVER INSIDE IT. The loop CLEARS every suggestion it does not
        # re-find (see `_persist_row_outcome`), so a pairing written mid-loop would be wiped by the
        # next row's clear. The stack pass also needs the loop's finished output -- which rows ended
        # up with a sole suggestion -- to know which records are already spoken for.
        paired, noted_surplus = _resolve_stacks(matchable, pools)

        # ⚠️ LAST, AFTER ALL THREE PASSES. "Several candidates and nobody picked one" only becomes
        # a fact once every pass entitled to pick has declined -- deciding it in the per-row loop
        # would sweep rows the stack pass was about to pair.
        swept = _sweep_unresolved_to_mismatched(results, noted_surplus)

    statuses = _refresh_batch_rollup(batch)
    frappe.db.commit()
    return {
        "batch": batch,
        "matched_rows": len(matchable),
        "stack_paired_rows": paired,
        # How many rows gave up a record another transfer had an equal hold on. Reported so a run
        # that releases a lot is visible rather than silently producing "needs a choice" rows.
        "released_rows": released,
        # Rows where a rule separated several approved records (Option B). Reported so a run that
        # leans hard on the rules is visible rather than silently pre-selecting more than usual.
        "rule_picked_rows": picked,
        # Rows that found approved records but ended with no pre-selection, and now read as
        # Not-Matched. Reported so a run leaving a lot of decisions on the table is visible.
        "swept_to_mismatched_rows": swept,
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
            # ⚠️ THE THREE PROVENANCE FIELDS ARE WRITTEN IN THIS ONE CALL, ALWAYS, INCLUDING AS
            # BLANK. They describe the SUGGESTION -- what was chosen, how the counterpart was found,
            # and that a machine chose it -- so they live and die with the pair beside them. Writing
            # any of them separately is how a Check that means "suggested_name is set" starts
            # disagreeing with whether suggested_name is set.
            "auto_matched": 1 if suggestion else 0,
            "match_basis": (getattr(result, "tier", "") or None) if suggestion else None,
            # ⚠️ WRITTEN ON EVERY RUN, and only ever overwritten by `_disambiguate_matched` or the
            # stack pass afterwards. A sole match now SAYS SO (`sole`) rather than leaving the field blank. Blank used to
            # mean both "no rule" and "no suggestion", and that ambiguity filed the 112 arbitrary
            # stack pairings under "Only candidate" in the confirm dialog's filter. Blank now means
            # exactly one thing: there is no suggestion.
            "suggestion_rule": RULE_SOLE if suggestion else None,
        },
        update_modified=False,
    )

    # Still a delete, for a narrower reason: a batch staged under v2 carries legacy suggestion rows,
    # and re-running the match is how they get cleared. It cannot touch a settlement -- `Settled` is
    # in `_FROZEN_ROW_STATUSES`, so a settled row never reaches this function at all.
    frappe.db.delete(MATCH_DOCTYPE, {"import_row": row.name})


# --- Option B: the database half of `services/outflow_import/disambiguate.py` ---------------------


def _disambiguation_candidates(result) -> list:
    """The candidate list Option B may choose between, or `[]` to abstain.

    ⚠️ A FAN-OUT DISQUALIFIES THE WHOLE SET, exactly as it disqualifies a whole stack (ruling Q4).
    One transfer covering several payments is a single candidate with several targets and NO single
    name to pre-select, so a set containing one is not a set of comparable alternatives. Abstaining
    on the whole row is the narrow reading; picking around the fan-out would silently decide that
    the fan-out was not the answer, which is a judgement about money this has no basis for.

    Everything here comes from `status.settleable_candidates` -- the SAME list `sole_suggestion` and
    `_matched_note` read. Building a second one is the defect that list's docstring exists about.
    """
    out = []
    for candidate in settleable_candidates(result):
        targets = getattr(candidate, "targets", None)
        if targets is not None:
            if len(targets) != 1:
                return []
            target = targets[0]
        else:
            target = getattr(candidate, "target", None)
            if target is None:
                return []
        out.append(
            Candidate(
                doctype=target.doctype,
                name=target.name,
                amount=normalize_amount(target.amount),
                project=(getattr(target, "project", "") or ""),
                decided_on=getattr(target, "decided_on", None),
            )
        )
    return out


def _disambiguate_matched(results: dict, pools: dict) -> int:
    """Pre-select a record on rows the matcher left ambiguous, where a rule can tell them apart.

    THE MEASUREMENT THIS EXISTS FOR. `sole_suggestion` refuses to choose between two real records,
    which is right, and on the first real statement it left 56 transfers with nothing pre-selected.
    45 of those 56 could be separated by evidence already sitting on the row -- the project named in
    the remark, the paise the bank actually moved, or the fact that the candidates were identical in
    every dimension that reaches a ledger. `disambiguate.py` owns the rules and the fences; this
    function owns the database and the ordering.

    ⚠️ IT RUNS AFTER `_enforce_single_claim`, NOT BEFORE. That pass cleans up contests between SOLE
    suggestions, and its releases free records up. Running first would mean choosing between
    candidates while another row still held one of them, and then having that pick released.

    ⚠️ IT FEEDS ITS OWN PICKS BACK IN, WHICH IS WHAT MAKES M3 WORK. Seven transfers against eight
    identical records only resolve if each takes a DIFFERENT one. Without the running claim set every
    twin row would pick the same record and `_enforce_single_claim` -- which has already run -- would
    not be there to catch it.

    ⚠️ THE ROW ORDER IS DETERMINISTIC, and it has to be for the same reason `pair_stack` re-sorts
    both its sides: which transfer gets which of several identical records must not depend on
    dictionary order, or a re-run moves a pre-selection out from under a reviewer mid-decision.
    """
    if not results:
        return 0

    claimed = {
        (r["suggested_doctype"] or "", r["suggested_name"] or "")
        for r in frappe.db.sql(
            """
            SELECT suggested_doctype, suggested_name
            FROM "tabOutflow Import Row"
            WHERE row_status IN %(open)s AND COALESCE(suggested_name, '') <> ''
            """,
            {"open": tuple(OPEN_ROW_STATUSES)},
            as_dict=True,
        )
    }

    fresh = {
        r["name"]: r
        for r in frappe.db.sql(
            """
            SELECT name, added_on, suggested_name
            FROM "tabOutflow Import Row"
            WHERE name IN %(names)s
            """,
            {"names": tuple(results)},
            as_dict=True,
        )
    }

    # ⚠️ WHICH ROWS BELONG TO A STACK, BECAUSE M3 MUST NOT TOUCH THEM. An unbalanced stack pairs
    # NOTHING by owner ruling -- some transfer settles nothing and choosing which is a judgement
    # about money. M3 applied row by row does precisely that partial pairing: the first N transfers
    # take the records and the last one finds them claimed. Measured when this shipped unfenced: 62
    # of 65 interchangeable picks landed on stack members and the leftovers screen fell from 6
    # stacks to 3. Counted over EVERY open row, not just this batch, for the same reason
    # `_resolve_stacks` reads across imports -- a stack does not respect batch boundaries.
    stack_sizes: dict = {}
    for r in frappe.db.sql(
        """
        SELECT normalized_account, amount FROM "tabOutflow Import Row"
        WHERE row_status IN %(open)s
        """,
        {"open": tuple(OPEN_ROW_STATUSES)},
        as_dict=True,
    ):
        account = (r["normalized_account"] or "").strip()
        if account:
            key = (account, str(r["amount"]))
            stack_sizes[key] = stack_sizes.get(key, 0) + 1

    def _in_a_stack(row) -> bool:
        account = (getattr(row, "normalized_account", "") or "").strip()
        if not account:
            # ⚠️ A ROW WITH NO ACCOUNT IS NEVER STACKED (`stacks.stack_key`), so M3 is free to act on
            # it -- there is no set of interchangeable transfers for it to partially pair.
            return False
        return stack_sizes.get((account, str(row.amount)), 0) >= 2

    ordered = sorted(
        results.values(),
        key=lambda item: (str(fresh.get(item[0].name, {}).get("added_on") or ""), item[0].name),
    )

    picked = 0
    for row, result, outcome in ordered:
        if outcome.status != ROW_MATCHED:
            continue
        if (fresh.get(row.name, {}).get("suggested_name") or "").strip():
            continue

        candidates = _disambiguation_candidates(result)
        if len(candidates) < 2:
            # One candidate means `sole_suggestion` already spoke, or the claim pass took it away.
            # Either way there is nothing here to disambiguate.
            continue

        # ⚠️ `added_on_date`, NOT `added_on`. M4 subtracts this from a candidate's `date`, and a
        # `datetime` on either side raises rather than comparing.
        transfer_date = getattr(row, "added_on_date", None)

        pick = pick_from_several(
            bank_amount=normalize_amount(row.amount),
            candidates=candidates,
            remark=row.remarks or "",
            project_index=pools.get("projects"),
            claimed=claimed,
            allow_interchangeable=not _in_a_stack(row),
            transfer_date=transfer_date,
        )
        if pick is None:
            continue

        frappe.db.set_value(
            ROW_DOCTYPE,
            row.name,
            {
                "suggested_doctype": pick.doctype,
                "suggested_name": pick.name,
                "suggestion_rule": pick.rule,
                "auto_matched": 1,
                # The tier that FOUND the candidates. Option B chose between them; it did not find
                # them, so the basis is still the ladder's.
                "match_basis": (getattr(result, "tier", "") or None),
                "outcome_note": pick_note(
                    pick, candidates, normalize_amount(row.amount), transfer_date
                ),
            },
            update_modified=False,
        )
        claimed.add(pick.key)
        picked += 1
    return picked


# --- a record is claimed once: the database half of `services/outflow_import/claims.py` -----------


def _enforce_single_claim(matchable) -> int:
    """Clear the suggestion on every row that lost a contest for a record. Returns how many.

    THE DEFECT THIS EXISTS FOR, measured on the first real statement: five approved records each
    carried a suggestion on several transfers, across 15 rows. A record can be settled once, so ten
    of the 807 confirms were going to fail with `AlreadyPaidError` before anybody pressed the
    button. `sole_suggestion` is not wrong -- it answers a question about ONE row, and answers it
    correctly for each of them. Nothing was asking the question about the SET.

    ⚠️ THE SCOPE FENCE IS THE FIRST THING TO UNDERSTAND HERE. This pass may only clear rows that
    THIS RUN is responsible for -- the batch it is matching. A row in another batch that already
    holds the record keeps it, and this batch's rows give way (`Claim.releasable`). The alternative
    is a match run silently stripping the pre-selection off a screen in a different import, for a
    reason nobody looking at that screen could discover. `_resolve_stacks` writes across imports on
    exactly one condition -- it only ever FILLS A BLANK. Clearing is not filling a blank, so it does
    not get the same licence.

    ⚠️ IT READS ACROSS IMPORTS EVEN THOUGH IT ONLY WRITES INSIDE ONE. The contest is global -- the
    rival transfer may have arrived in last fortnight's statement -- so a pass that only looked at
    this batch would leave exactly the cross-batch duplicates it exists to catch. Read wide, write
    narrow.

    ⚠️ IT CLEARS THE PAIR AND REWRITES THE NOTE, AND CHANGES NO STATUS. The row stays `Matched`,
    which is true: it still found approved records. What it no longer has is a pre-selection, which
    is the honest state for a transfer with an equal claim on a record somebody else also matched.
    Leaving the old note would be worse than leaving the suggestion -- it would still say "One
    approved record at this amount", of a row that now shows nothing.
    """
    mine = {row.name for row in matchable}
    if not mine:
        return 0

    held = frappe.db.sql(
        """
        SELECT name, added_on, suggested_doctype, suggested_name
        FROM "tabOutflow Import Row"
        WHERE row_status IN %(open)s
          AND COALESCE(suggested_name, '') <> ''
        """,
        {"open": tuple(OPEN_ROW_STATUSES)},
        as_dict=True,
    )

    outcome = resolve_claims(
        Claim(
            row=r["name"],
            record=(r["suggested_doctype"] or "", r["suggested_name"] or ""),
            added_on=str(r["added_on"] or ""),
            releasable=r["name"] in mine,
        )
        for r in held
    )
    if not outcome.releases:
        return 0

    lost_record = {
        r["name"]: (r["suggested_name"] or "") for r in held if r["name"] in set(outcome.releases)
    }
    for row_name in outcome.releases:
        frappe.db.set_value(
            ROW_DOCTYPE,
            row_name,
            {
                "suggested_doctype": None,
                "suggested_name": None,
                # Provenance must never outlive the pick it explains. Blank here today because the
                # loop already wrote it and Option B has not run yet -- written anyway, because that
                # ordering is a fact about the caller and this function should not depend on it.
                "suggestion_rule": None,
                "auto_matched": 0,
                "match_basis": None,
                "outcome_note": claim_note(
                    lost_record.get(row_name, ""), outcome.rivals.get(row_name, 2)
                ),
            },
            update_modified=False,
        )
    return len(outcome.releases)


# --- stacks: several interchangeable transfers against several interchangeable records (E2) ------


def _resolve_stacks(matchable, pools) -> int:
    """Auto-pair BALANCED stacks and write their suggestions. Returns how many rows were paired.

    THE CASE. A vendor with six approved payments of Rs 9,000 and six transfers of Rs 9,000. Every
    transfer matches every payment equally well, so `sole_suggestion` correctly refuses to pick one
    and all six rows arrive with nothing pre-selected -- 58 such rows on the first real statement.
    Refusing to guess is right ROW BY ROW and wrong for the SET: six against six has exactly one
    sensible outcome. `services/outflow_import/stacks.py` owns the grouping and the pairing; this
    function owns the database.

    ⚠️ IT WRITES ACROSS IMPORTS, AND THAT IS THE POINT OF IT (owner ruling 2026-08-10). A stack does
    not respect batch boundaries -- three of the six transfers may have arrived in last fortnight's
    statement. So running the match on batch B can change rows belonging to batch A. Three things
    keep that safe rather than surprising:

      * It only ever writes a suggestion onto an OPEN row that has NONE. A settled, skipped or
        already-suggested row is never touched.
      * It changes no STATUS, so no other batch's rollup counters go stale. The only fields written
        are the two suggestion fields and the note.
      * Both batches compute the same stacks from the same rows, so whichever one is matched second
        reproduces the identical pairing rather than reshuffling it (`pair_stack` is deterministic).

    ⚠️ A RECORD IS CLAIMED ONCE. `zip` guarantees that inside one stack; this function guards
    ACROSS stacks and against the per-row matcher, which may already have handed a record to a 1:1
    row. Without it, a payment could be suggested to two different transfers and the second confirm
    would fail with `AlreadyPaidError` -- which is exactly the failure the whole candidate-collapse
    fix was written to stop producing.
    """
    keys = {k for k in (stack_key(row) for row in matchable) if k is not None}
    if not keys:
        return 0

    rows = _load_open_rows_for_keys(keys)
    if not rows:
        return 0

    # Everything the per-row matcher already spoke for, anywhere in the table. Read BEFORE any
    # pairing so the pass cannot hand out a record a 1:1 row is holding.
    claimed = {r["suggested_name"] for r in rows if (r.get("suggested_name") or "").strip()}

    staged = [_StagedRow(r) for r in rows if not (r.get("suggested_name") or "").strip()]

    # ⚠️ CAPTURED FROM THE ONE CALL `group_into_stacks` ALREADY MAKES. It asks for a stack's records
    # exactly once, so the tier that produced them is recorded on the way past rather than by
    # matching a second time. Keyed by the stack key because a basis belongs to the SET -- every
    # member returns the same records, which is the property `_stack_records` relies on.
    basis_by_key: dict = {}

    def _records_for(key, transfers):
        targets, tier = _stack_records_with_basis(transfers[0], pools)
        basis_by_key[key] = tier
        return targets

    stacks = group_into_stacks(staged, _records_for)

    paired = 0
    # Rows this pass explained as an unbalanced stack. Handed back so the final sweep does not
    # overwrite the specific reason with its generic one -- it runs after this and would.
    noted_surplus: set[str] = set()
    for stack in stacks:
        available = tuple(t for t in stack.records if t.name not in claimed)
        candidate = Stack(key=stack.key, transfers=stack.transfers, records=available)
        pairs = pair_stack(candidate)
        if not pairs:
            # Unbalanced: some transfer would settle nothing, or some record would go unclaimed.
            # Choosing which is a judgement about money, and it belongs to a person -- so nothing is
            # paired and no suggestion is written.
            #
            # ⚠️ THE ROWS DO GET A NOTE, AND THAT NOTE IS WHAT THE DELETED "Resolve N stacks" SCREEN
            # USED TO SAY. Its rows now land in the ordinary worklist, where "several matched and
            # nothing separated them" would send a reviewer hunting for a record that does not
            # exist. Only the STATUS is left alone here; the explanation is the point.
            #
            # ⚠️ ONLY WHEN THE STACK ACTUALLY HAS RECORDS, and this guard cost a red test to find.
            # An EMPTY record set means one of two things and this pass cannot tell them apart:
            # every record was claimed by another transfer, OR the stack was DISQUALIFIED because
            # its candidates include a fan-out (`_stack_records` returns nothing for one, ruling
            # Q4). In the second case the row is a perfectly good fan-out MATCH carrying
            # `_matched_note` -- "one transfer settling 2 approved payments" -- and writing a
            # surplus note over it replaces a true statement with a false one, on a row that needs
            # no attention at all. A note that cannot tell those two apart must assert neither.
            if not candidate.records:
                continue
            surplus = stack_surplus_note(candidate)
            for transfer in candidate.transfers:
                frappe.db.set_value(
                    ROW_DOCTYPE, transfer.name, {"outcome_note": surplus}, update_modified=False
                )
                noted_surplus.add(transfer.name)
            continue
        for pair in pairs:
            transfer, record = pair.transfer, pair.record
            frappe.db.set_value(
                ROW_DOCTYPE,
                transfer.name,
                {
                    "suggested_doctype": record.doctype,
                    "suggested_name": record.name,
                    # ⚠️ THIS IS THE ROW CLASS THE PROVENANCE FIELDS WERE ADDED FOR. A stack pairing
                    # is deterministic but was ALWAYS ARBITRARY -- identical transfers zipped against
                    # identical records -- and until the fields existed it carried a blank rule, so
                    # the confirm dialog filed all 112 of them under "Only candidate": the arbitrary
                    # picks presented as the safest kind there is.
                    #
                    # ⚠️ TWO VALUES NOW, AND THEY MUST NOT BE COLLAPSED. A pair the decision dates
                    # actually separated is not the same fact as a coin flip between twins, and the
                    # whole reason this field exists is that one value covering two facts is how the
                    # arbitrary ones hid. Measured on the live statement: of 112 stack pairings, 25
                    # are evidence, 76 arbitrary, 11 in stacks that no longer balance.
                    "suggestion_rule": (
                        RULE_STACK_NEAREST_DATE if pair.is_evidence else RULE_STACK_PAIRING
                    ),
                    "auto_matched": 1,
                    "match_basis": basis_by_key.get(stack.key) or None,
                    "outcome_note": stack_note(candidate, record.name, pair.basis),
                },
                update_modified=False,
            )
            claimed.add(record.name)
            paired += 1
    return paired, noted_surplus


def _sweep_unresolved_to_mismatched(results: dict, keep_notes: set) -> int:
    """Any row still `Matched` with NO suggestion becomes `Mismatched` (owner ruling 2026-08-11).

    ⚠️ IT CANNOT LIVE IN `derive_row_outcome`, AND THAT IS WHY IT IS A SWEEP. That function runs in
    the per-row loop, BEFORE the claim pass, Option B and the stack pass have had their say -- at
    that moment "several candidates and no pick" is not yet a fact, because three passes are still
    entitled to make one. The status can only be decided once they have all finished.

    WHY THE ROWS MOVE AT ALL. `Matched` shares a tab with `Settled` under the reviewer's heading
    "this transfer has a record". A row that found six records and chose none has NOT got a record;
    it has a decision waiting, and it belongs in the worklist with the rest of the open work.

    ⚠️ IT NEVER TOUCHES A ROW THAT HAS A SUGGESTION. A pre-selected row is exactly the case
    `Matched` is for, and sweeping one into `Not-Matched` would hide the confirmable work.

    ⚠️ NOR A FAN-OUT, NOR A SINGLE-CANDIDATE ROW. Both are `Matched` with no suggestion for reasons
    that are not "nothing could be chosen" -- see the guard in the loop. Only a row the matcher gave
    SEVERAL comparable records, none of which any pass would pick, has a decision genuinely waiting.

    ⚠️ `keep_notes` IS NOT AN OPTIMISATION. The stack pass has already written the SPECIFIC reason
    on unbalanced-stack rows -- seven transfers, six records -- and this pass's generic sentence is
    strictly less informative. Overwriting it would delete the explanation that the deleted stack
    screen was replaced by, one pass after writing it.

    ⚠️ THE COUNT COMES FROM THE MATCH RESULT, NOT FROM A STORED COLUMN -- there is no
    `candidate_count` field on the doctype, and adding one to carry a sentence would be a migrate
    for a number this function already holds. `settleable_candidates` is the SAME list
    `_matched_note` counts and `sole_suggestion` reads, so the note cannot disagree with the one the
    row carried a moment earlier.
    """
    names = [name for name, (_row, _res, outcome) in results.items() if outcome.status == ROW_MATCHED]
    if not names:
        return 0

    placeholders = ", ".join(["%s"] * len(names))
    stale = frappe.db.sql(
        f"""
        SELECT name FROM "tabOutflow Import Row"
        WHERE name IN ({placeholders})
          AND row_status = %s
          AND COALESCE(suggested_name, '') = ''
        """,
        (*names, ROW_MATCHED),
        as_dict=True,
    )
    swept = 0
    for row in stale:
        _row, result, _outcome = results[row["name"]]

        # ⚠️ A FAN-OUT IS `Matched` WITH NO SUGGESTION *BY DESIGN*, AND MUST NOT BE SWEPT. One
        # transfer covering several approved payments is a genuine match -- it carries no
        # `suggested_name` only because a `(doctype, name)` pair cannot hold a GROUP, not because
        # nothing could be chosen. Fan-out is report-only by ruling Q4, so the row is meant to sit
        # in `Matched` and say what it found; moving it to `Not-Matched` would report a successful
        # match as an unresolved one and invite someone to book the money a second time.
        #
        # `_disambiguation_candidates` returns [] for a set containing a fan-out -- the same
        # abstention Option B makes -- so this reuses that judgement rather than re-deriving
        # "is this a fan-out", which is exactly the second opinion that list's docstring warns of.
        candidates = _disambiguation_candidates(result)
        if len(candidates) < 2:
            continue

        payload = {"row_status": ROW_MISMATCHED}
        if row["name"] not in keep_notes:
            payload["outcome_note"] = several_found_note(len(candidates))
        frappe.db.set_value(ROW_DOCTYPE, row["name"], payload, update_modified=False)
        swept += 1
    return swept


def _stack_records_with_basis(representative, pools) -> tuple:
    """`_stack_records`, plus the tier that found the records.

    ⚠️ THE TIER IS TAKEN FROM THE SAME `match_row` CALL, not from a second one. Re-running the
    matcher to ask "and which tier was that?" would be a second opinion about a question already
    answered, over pools that may have moved -- the same reasoning that put `tier` on the result in
    the first place rather than letting callers re-derive it from `basis`.
    """
    targets, tier = _stack_records(representative, pools, want_basis=True)
    return targets, tier


def _stack_records(representative, pools, want_basis: bool = False) -> tuple:
    """The candidate records a whole stack shares, via the SAME matcher every other row goes
    through.

    ⚠️ IT RUNS THE MATCHER ON ONE MEMBER RATHER THAN RE-DERIVING "approved records at this account
    and amount". Re-deriving would be a second opinion about what a candidate is, sitting beside
    `matcher.py` and free to disagree with it the day either changes (ADR-0010 F1/F3). One member is
    enough because the stack key IS the pair of axes the pool is filtered on: every member returns
    the same set.

    ⚠️ A FAN-OUT DISQUALIFIES THE WHOLE STACK. A group with several targets is one transfer covering
    several payments -- report-only, settled by hand (owner ruling Q4) -- and it cannot be one end
    of a 1:1 pairing. Returning nothing makes the stack unbalanced, so it falls through to a person
    untouched, which is the correct handling for something this module has no answer for.

    The pools already cover these rows: they were loaded for the amounts and accounts of this
    batch's rows, and a stack key is BY CONSTRUCTION one of those pairs.
    """
    result = match_row(
        representative,
        pools["vendors"],
        pools["payments"],
        pools["expenses"],
        pools["projects"],
    )
    targets = []
    for group in result.payment_groups or ():
        if len(group.targets) != 1:
            # A fan-out disqualifies the whole stack -- see the docstring. The basis goes with it.
            return ((), "") if want_basis else ()
        targets.append(group.targets[0])
    targets.extend(c.target for c in (result.expense_candidates or ()))
    if want_basis:
        return tuple(targets), (getattr(result, "tier", "") or "")
    return tuple(targets)


def _load_open_rows_for_keys(keys) -> list:
    """Every OPEN row in the WHOLE table whose (account, amount) is one of these.

    ⚠️ NOT SCOPED TO A BATCH, deliberately -- that is what makes a stack able to span imports. It IS
    scoped to the keys this batch actually touches, so matching one statement never walks every
    stack in the table.

    The `(normalized_account, amount) IN ((...), (...))` form is a row-constructor comparison, which
    PostgreSQL supports and which the `(normalized_account, amount)` index serves directly.
    """
    pairs = sorted((k.account, k.amount) for k in keys)
    key_ph = ", ".join(["(%s, %s)"] * len(pairs))
    status_ph = ", ".join(["%s"] * len(OPEN_ROW_STATUSES))
    params = [value for pair in pairs for value in pair]
    params.extend(sorted(OPEN_ROW_STATUSES))

    return frappe.db.sql(
        f"""
        SELECT name, transfer_id, added_on, amount, status_raw, beneficiary_name, bank_account,
               ifsc, remarks, bank_reference_no, normalized_account, normalized_reference,
               resolved_vendor, suggested_doctype, suggested_name, row_status
        FROM "tabOutflow Import Row"
        WHERE (normalized_account, amount) IN ({key_ph})
          AND row_status IN ({status_ph})
        """,
        tuple(params),
        as_dict=True,
    )


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
    # Stamps `order_name` onto matches and related payments in place, and gives us the map the
    # suggestion needs below -- see `_with_order_names` for why all three share one lookup.
    suggested_orders = _payment_order_names(
        [
            r.get("suggested_name")
            for r in rows
            if (r.get("suggested_doctype") or "") == C.PAYMENT_DOCTYPE
        ]
    )
    _with_order_names(rows, by_row, related)

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
                # The suggestion is a pair of scalar columns on the row, not a list, so it takes
                # its own key rather than being stamped in place like the two lists above.
                "suggested_order_name": suggested_orders.get(row.get("suggested_name") or "", ""),
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


def _payment_order_names(names) -> dict:
    """`Project Payments` name -> the ORDER it is against (`document_name`), for LINKING (slice E3).

    ⚠️ THE SCREEN LINKS TO THE ORDER, NOT TO THE PAYMENT, because that is what every other screen in
    this app does: twelve call sites navigate to `/project-payments/<PO-or-SR id>` with the slashes
    escaped as `&=`. The outflow feature had invented its own scheme instead -- pre-seeding the
    payments TABLE's search params with the payment name -- which only lands correctly while four
    separate things agree (the tab name, the url-sync key format, `name` being a searchable field,
    and the table reading the seeded params before overwriting them). `paymentHref`'s own docstring
    already recorded that it "fails SILENTLY by landing on an unfiltered table".

    ⚠️ SO THE ID THE SCREEN NEEDS IS THE ORDER'S, AND THE ROW PAYLOAD DID NOT CARRY IT. Matches,
    related payments and the stored suggestion all travel as `(doctype, name)` pairs naming the
    PAYMENT. One query per page adds the order beside them; without it the row table could not use
    the app's own route at all and would have been left on the scheme this slice exists to retire.

    A payment with no `document_name` maps to nothing and the client falls back -- see
    `settlementLink`. Blank rather than absent is not distinguished: both mean "no order to open".
    """
    wanted = sorted({str(n).strip() for n in names if n and str(n).strip()})
    if not wanted:
        return {}
    placeholders = ", ".join(["%s"] * len(wanted))
    rows = frappe.db.sql(
        f"""
        SELECT name, document_name
        FROM "tabProject Payments"
        WHERE name IN ({placeholders})
        """,
        tuple(wanted),
        as_dict=True,
    )
    return {r["name"]: (r.get("document_name") or "") for r in rows if r.get("document_name")}


def _with_order_names(rows: list, by_row: dict, related: dict) -> None:
    """Stamp `order_name` onto every payment link source, IN PLACE (slice E3).

    ⚠️ ONE LOOKUP FOR ALL THREE SOURCES. A row can link through a match, through an already-Paid
    related payment, or through its stored suggestion, and all three end up in the same
    `rowSettlementLinks` on the client. Enriching them separately would be three queries and, worse,
    three chances for one of them to be forgotten -- which presents as a link that silently keeps
    the old behaviour on some rows and not others.
    """
    payment_names = []
    for matches in by_row.values():
        payment_names += [
            m["target_name"] for m in matches if m.get("target_doctype") == C.PAYMENT_DOCTYPE
        ]
    for entries in related.values():
        payment_names += [
            e["target_name"] for e in entries if e.get("target_doctype") == C.PAYMENT_DOCTYPE
        ]
    payment_names += [
        r.get("suggested_name")
        for r in rows
        if (r.get("suggested_doctype") or "") == C.PAYMENT_DOCTYPE
    ]

    orders = _payment_order_names(payment_names)
    if not orders:
        return
    for matches in by_row.values():
        for m in matches:
            if m.get("target_doctype") == C.PAYMENT_DOCTYPE:
                m["order_name"] = orders.get(m["target_name"], "")
    for entries in related.values():
        for e in entries:
            if e.get("target_doctype") == C.PAYMENT_DOCTYPE:
                e["order_name"] = orders.get(e["target_name"], "")


@frappe.whitelist()
def get_row_candidates(row: str):
    """Ranked candidates for ONE row, fetched on demand when a reviewer opens it.

    Per-row rather than bundled into `get_batch_rows`: candidates are only ever looked at for the
    row being worked on, and shipping every row's candidate set would make the review payload
    an order of magnitude larger for information nobody reads.

    ⚠️ `settleable_candidates` WAS ADDED AT N3, AND IT IS THE ONE KEY THE SCREEN READS. It is the
    list `_disambiguation_candidates` builds -- which is `status.settleable_candidates`, the SAME
    list `sole_suggestion` reads and `_matched_note` / `several_found_note` count. It is emphatically
    NOT re-derived from `payment_groups` below, in this function or in the client: the note says "6
    approved records match this transfer and nothing could separate them", and a second list built
    from a different source is exactly how the sentence and the marks come to disagree about the
    same row. That failure has a name in this feature's history -- it is the `best_payment_group`
    collapse, the worst defect it has shipped.

    ⚠️ IT IS `[]` FOR A FAN-OUT, inheriting Option B's abstention rather than restating it: one
    transfer covering several payments is a genuine match with no single name to offer, so it is not
    a set of comparable alternatives.

    ⚠️ A SINGLE CANDIDATE COMES BACK AS A LIST OF ONE, NOT AS `[]`. The `< 2` threshold belongs to
    `_sweep_unresolved_to_mismatched`, which is asking a different question ("is there a decision
    genuinely waiting?"). Copying it here would put a screen's rule inside an endpoint and give this
    feature a second place to change it.

    ⚠️ THIS RE-RUNS THE MATCH LIVE AND DOES NOT APPLY THE FOUR GLOBAL PASSES -- no claim pass, no
    Option B, no stack pairing. So a candidate here may ALREADY BE CLAIMED by another open row. That
    is honest (it WAS a candidate for this transfer) but it is not a promise, which is why the
    screen's wording is "the match run found these" and never "you may pick these".
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
        # N3. Additive -- every key above is untouched, so no existing caller can break. Only the
        # (doctype, name) pair is sent: it is what the screen matches a browse row on, and a bare
        # name is not unique across three ledgers. The amounts and projects these candidates carry
        # are already on the browse row the mark lands on.
        "settleable_candidates": [
            {"doctype": c.doctype, "name": c.name}
            for c in _disambiguation_candidates(result)
        ],
    }


@frappe.whitelist()
def search_settleable_records(
    row: str, target_doctype: str = "", search: str = "", limit: int = 0
):
    """Approved records a reviewer may link to this row BY HAND (slice V4a; all-ledger at R2).

    URL: /api/method/nirmaan_stack.api.outflow_import.review.search_settleable_records

    ⚠️ `target_doctype` IS NOW OPTIONAL, AND BLANK MEANS ALL THREE LEDGERS (owner, slice R2). The
    dialog used to make you pick a ledger FIRST -- three cards, one per doctype -- and only then
    showed you records. That asked the reviewer to answer a question they often cannot: a transfer
    to a vendor may have been raised as a Project Payment or booked as a Project Expense, and the
    only way to find out was to open each card in turn. One list lets them recognise the record
    instead of classifying it first.

    ⚠️ IT RETURNS THE WHOLE APPROVED POOL, AND THE CAP IS NOW A SAFETY CEILING (slice N1, owner
    decision Q6). `limit=0` -- the default -- means everything, bounded only by `_MAX_BROWSE`. The
    pool is small enough to hand over once and let the screen filter and sort it with no further
    round trip.

    ⚠️ HOW SMALL IS NOT A FIXED FACT, AND MEASURING IT ONCE IS A TRAP. It is whatever is APPROVED
    and not yet paid, so it DRAINS as an import is confirmed and refills as approvals happen. It was
    measured twice on 2026-08-11, five hours apart: 1,164 records, then 322 -- the same pool, after
    a batch was settled. Both are comfortably inside the ceiling and either would be fine to send;
    what would NOT be fine is sizing a future decision on one reading of a number that moves by 4x
    in an afternoon.

    THE OLD BEHAVIOUR WAS A REAL DEFECT, NOT MERELY A LIMIT. It asked each ledger for 50 rows
    ORDERED BY AMOUNT CLOSENESS and cut the merge to 50. Two consequences, both live:
      * the record a reviewer wanted was INVISIBLE unless its amount happened to be near -- the
        vendor could be right, the project could be right, and it would not be in the list;
      * 50 near-amount payments filled the merge before the 14 approved project expenses could get
        in, so an entire ledger could vanish from a list that claims to span all three.
    A positive `limit` still caps, so the existing callers and tests are unaffected.

    ⚠️ THE ORDER IS NOW A SIMILARITY RANKING, NOT AMOUNT CLOSENESS (owner decision Q1b, slice N1).
    `similarity.ranked_records` weighs project, vendor name, vendor nickname / contact person and
    amount, in that priority -- INSIDE a hard settleable/unsettleable split, so a record the write
    path would refuse can never sit above one it would accept. Every record carries its own
    `similarity` and `similarity_reasons` so the screen can say why it is where it is.

    ⚠️ THE RANKING MUST NOT LEAK INTO THE MATCHER. `similarity` decides nothing; it orders a list a
    person confirms. See the import comment at the top of this module.

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
    doc = frappe.db.get_value(
        ROW_DOCTYPE, row, ["amount", "beneficiary_name", "remarks"], as_dict=True
    )
    if not doc:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")

    bank_amount = normalize_amount(doc.get("amount"))
    cap = _browse_cap(limit)

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
        records.extend(_search_one_ledger(ledger, bank_amount, search, cap))

    return _rank_browse_records(records, doc, bank_amount)[:cap]


# The ceiling `limit=0` resolves to. Not a page size -- a guard, so that a ledger which grows by an
# order of magnitude degrades into a truncated list rather than an unbounded query. The live pool
# has been measured between 322 and 1,164 (it drains as an import is confirmed), so it does not bind
# today; it exists for the day the shape of the ledger changes and nobody re-checks this file.
_MAX_BROWSE = 5000


def _browse_cap(limit) -> int:
    """How many records to return. `0` or blank means "everything", up to `_MAX_BROWSE`.

    ⚠️ `0` MEANS EVERYTHING, WHICH IS THE OPPOSITE OF WHAT `int(limit or 50)` USED TO DO. The old
    expression turned a falsy limit into the default page of 50; the browse list now wants the whole
    pool by default, and a caller that genuinely wants a page still passes a positive number.
    """
    try:
        wanted = int(limit or 0)
    except (TypeError, ValueError):
        wanted = 0
    if wanted <= 0:
        return _MAX_BROWSE
    return min(wanted, _MAX_BROWSE)


def _rank_browse_records(records: list[dict], doc: dict, bank_amount) -> list[dict]:
    """Order the merged pool by how much each record looks like this transfer.

    ⚠️ THE PROJECT INDEX IS BUILT ONCE PER CALL, not per record. It is 194 names; tokenising them
    1,164 times over would be the redundant work `candidates.load_project_index` exists to avoid.

    ⚠️ THE SCORE AND ITS REASONS ARE ATTACHED TO THE RECORD THE SCREEN ALREADY RENDERS, rather than
    returned alongside. A parallel array indexed by position is one filter or sort away from
    describing the wrong row, and this list is about to be filtered and sorted by the client.
    """
    row_signals = build_row_signals(
        doc.get("beneficiary_name"),
        doc.get("remarks"),
        bank_amount,
        C.load_project_index(),
    )

    # `(doctype, name)` -- a bare name is not unique across three ledgers, which is the same reason
    # the frontend's `recordKey` carries both halves.
    by_key = {(r["target_doctype"], r["name"]): r for r in records}
    ordered: list[dict] = []
    for signals, score in ranked_records(row_signals, [_record_signals(r) for r in records]):
        record = by_key[(signals.doctype, signals.name)]
        record["similarity"] = round(score.total, 3)
        record["similarity_reasons"] = list(score.reasons)
        ordered.append(record)
    return ordered


def _record_signals(record: dict) -> RecordSignals:
    """One row of the browse payload, as the ranker needs to see it.

    ⚠️ `settleable` IS THE PAYLOAD'S OWN `suggested` FLAG, never a second amount comparison. That
    flag is `amounts.amounts_match` against the settle window, computed where the record was built;
    re-deriving it here would be a second opinion about what may be settled, which is exactly what
    `amounts.py` warns its call-site list against.
    """
    return RecordSignals(
        doctype=record["target_doctype"],
        name=record["name"],
        amount=normalize_amount(record.get("amount")),
        settleable=bool(record.get("suggested")),
        vendor_name=record.get("vendor_name") or "",
        vendor_nickname=record.get("vendor_nickname") or "",
        contact_person=record.get("contact_person") or "",
        project=record.get("project") or "",
        project_name=record.get("project_name") or "",
    )


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
        # ⚠️ THE COLUMN LIST DRIVES THE PLACEHOLDER COUNT, exactly as the two expense branches below
        # already do. It was a hand-written OR chain with a hand-counted `[needle] * 5` beside it,
        # and slice N1 had to add two more columns to it -- which is the moment a hand-counted
        # parameter list silently goes wrong.
        search_cols = [
            "p.name", "v.vendor_name", "p.document_name", "pr.project_name", "p.project",
            # The nickname and the contact person are how a payment is FOUND by someone who knows
            # the vendor by neither its registered name nor its id. Same two fields the similarity
            # ranking reads.
            "v.vendor_nickname", "v.vendor_contact_person_name",
        ]
        search_sql = (
            " AND (" + " OR ".join(f"lower(coalesce({c}::text,'')) LIKE %s" for c in search_cols)
            + ")"
            if has_search
            else ""
        )
        sql = f"""
            SELECT p.name, p.amount, p.status, p.project,
                   p.document_type, p.document_name,
                   v.vendor_name, v.vendor_nickname, v.vendor_contact_person_name,
                   pr.project_name,
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
            params.extend([needle] * len(search_cols))
        params.extend([float(bank_amount), limit])
        return [
            {
                "target_doctype": C.PAYMENT_DOCTYPE,
                "name": r["name"],
                "amount": float(normalize_amount(r.get("amount"))),
                # The facts a reviewer picks a payment BY (owner ruling 2026-08-06), each its own
                # field so the dropdown can lay them out rather than parse a joined string.
                "vendor_name": r.get("vendor_name") or "",
                "vendor_nickname": r.get("vendor_nickname") or "",
                "contact_person": r.get("vendor_contact_person_name") or "",
                # ⚠️ THE ID, BESIDE THE DISPLAY NAME AND NOT INSTEAD OF IT. `project_name` falls
                # back to the id when the join finds nothing, so it cannot be compared against what
                # `ProjectIndex` reports -- that speaks in ids. The ranking needs the id; the screen
                # needs the name; conflating them loses one of the two.
                "project": r.get("project") or "",
                "project_name": r.get("project_name") or r.get("project") or "",
                # ⚠️ `document_type` IS THE PARENT (Procurement Orders / Service Requests). IT IS
                # NOT `target_doctype`, WHICH IS THE LEDGER and is always "Project Payments" here.
                # Two lookalike keys one line apart, and the deduction gate (slice TD) turns on this
                # one: reading the other would make every payment pass the service check silently.
                "document_type": r.get("document_type") or "",
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
            "v.vendor_nickname", "v.vendor_contact_person_name",
        ]
        where_search = (
            " AND (" + " OR ".join(f"lower(coalesce({c}::text,'')) LIKE %s" for c in search_cols)
            + ")"
            if has_search
            else ""
        )
        sql = f"""
            SELECT e.name, e.amount, e.status, e.description, e.type,
                   e.projects AS project, v.vendor_name,
                   v.vendor_nickname, v.vendor_contact_person_name,
                   pr.project_name, e.modified
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
        # ⚠️ THIS LEDGER HAS NO VENDOR AND NO PROJECT AT ALL -- not blank values, no columns and no
        # join to make. All 68 approved Non Project Expenses therefore score ZERO on three of the
        # ranking's four axes, and that is a fact about the data rather than evidence about the
        # transfer: `similarity` treats a missing field as no signal, never as a penalty.
        sql = f"""
            SELECT name, amount, status, description, type,
                   NULL AS project, NULL AS vendor_name,
                   NULL AS vendor_nickname, NULL AS vendor_contact_person_name,
                   NULL AS project_name, modified
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
            "vendor_nickname": r.get("vendor_nickname") or "",
            "contact_person": r.get("vendor_contact_person_name") or "",
            "project": r.get("project") or "",
            "project_name": r.get("project_name") or r.get("project") or "",
            # Blank on both expense ledgers -- an expense has no parent order at all, which is also
            # why neither can carry a deduction (slice TD, ruling R6).
            "document_type": "",
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
SCOPE_SKIPPED = "skipped"

_SCOPE_STATUSES = {
    # ⚠️ `all` CARRIES A REAL CLAUSE NOW, and it did not before. It used to fall through to "no
    # WHERE at all", which was correct when it meant every row. Excluding `Skipped` makes it an
    # actual filter, and forgetting that is exactly how skipped rows would leak back into the one
    # tab nobody would think to check.
    SCOPE_ALL: tuple(s for s in ROW_STATUSES if s != ROW_SKIPPED),
    SCOPE_NOT_MATCHED: (ROW_PENDING_MATCH, ROW_MISMATCHED, ROW_ERROR),
    SCOPE_MATCHED: (ROW_MATCHED, ROW_SETTLED),
    # ⚠️ A SCOPE, AND DELIBERATELY NOT A TAB (owner confirmed 2026-08-11). The ruling that "All means
    # everything a person might still act on, not every row" is UNCHANGED, and no tab reaches a
    # skipped transfer -- `test_no_tab_scope_will_show_a_skipped_row` still pins that. What this adds
    # is a way to go LOOKING for them: the Skipped chip on the import summary opens a dialog that
    # asks for this scope by name. Out of the way is not the same as invisible, and the summary line
    # is no longer the only place they are reported.
    #
    # ⚠️ IT IS THE ONLY SCOPE THAT RETURNS THEM, and it returns nothing else. A scope that mixed
    # skipped rows into a working view would be the thing the ruling forbids, arrived at sideways.
    SCOPE_SKIPPED: (ROW_SKIPPED,),
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
    # ⚠️ ONE LINE, AND EVERY CONSUMER INHERITS IT (slice Q1) -- the page query, its count, the tab
    # counts, the facet values AND the summary all read `_row_filters`. That is the whole payoff of
    # the shared builder, and the reason this needed no new query.
    #
    # It reads the row's DENORMALISED copy, not a join to `Outflow Row Match`. The copy exists for
    # exactly this: a facet over a joined table would need an EXISTS subquery in a builder whose
    # every other clause is single-table, and the two tiers are written in one call so they cannot
    # disagree. Blank on every unsettled row, which is honest -- an open transfer has no settlement
    # to have an origin.
    "settlement_origin": "r.settlement_origin",
    # ⚠️ THE ROW'S OWN COPY, NOT `b.source` THROUGH THE JOIN, for the reason two entries above:
    # `_row_filters` builds single-table clauses shared by the page query, its count, the tab
    # counts, the facet values and the summary, and not all of those carry the batch join. A
    # denormalised column keeps every one of them working with no new query. It is written at
    # staging by both sources, and `v3_0.backfill_outflow_row_source` fills the rows that predate
    # the field -- without which the funnel would draw itself over 1,043 blanks.
    "source": "r.source",
    # ⚠️ `added_on` WAS REMOVED AT P1 AND MUST NOT COME BACK. The payment date is a DATE FILTER now
    # (`date_from` / `date_to`, applied in `_row_filters`), which is the one shape a facet cannot
    # serve: an IN list over distinct days grows without limit as the table does, and cannot express
    # "everything after the 14th" at all. It also became the SCREEN'S PERIOD, so offering a second
    # way to filter the same column would let two controls contradict each other.
    #
    # Removing it is safe rather than breaking: `_parsed_facets` drops an unknown column SILENTLY, so
    # a stale bookmark carrying an `added_on` facet shows an unfiltered table instead of an error.
    # `get_outflow_facet_values("added_on")` now throws, which is correct -- nothing asks for it.
}

# One page. Generous enough that a whole statement usually fits on one, capped so a client cannot
# ask for the entire table and reinstate the problem this endpoint exists to solve.
_DEFAULT_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 200

# The most rows "Confirm all matched" will assemble in one go (slice P1).
#
# ⚠️ IT IS A REVIEWABILITY LIMIT, NOT A PERFORMANCE ONE, AND IT REFUSES RATHER THAN TRUNCATING. The
# confirm dialog is a SAFETY CONTROL: it states what the button will write, including how many
# approved amounts the click will REWRITE. Before P1 the set was bounded by one statement -- the
# largest real one to date is 1,043 rows -- and a period can now select months of them. Past a few
# thousand nobody reads the tree, and a control nobody reads is a control that is not there.
#
# Sized so that any single real statement always fits, so narrowing to one import is always a way
# through. See `_assert_confirmable_size` for why truncating would be the dangerous alternative.
_MAX_CONFIRMABLE = 2000


@frappe.whitelist()
def get_outflow_rows(
    scope: str = SCOPE_NOT_MATCHED,
    batch: str = None,
    failed=None,
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
        failed=failed,
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
               r.suggested_doctype, r.suggested_name, r.suggestion_rule, r.match_basis,
               r.auto_matched, r.row_status, r.skip_reason, r.outcome_note,
               -- ⚠️ ADDING A COLUMN TO `_FACET_COLUMNS` DOES NOT SHIP IT TO THE SCREEN. That map
               -- governs FILTERING; this list governs what the row CARRIES, and slice Q1 initially
               -- changed only the first -- so the "Settled via" column rendered an em dash on all
               -- 849 settled rows while the summary beside it reported 843 auto-matched. Caught in
               -- the browser, by nothing else: every suite was green.
               r.settlement_origin, r.source,
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
    # ⚠️ THE SAME ENRICHMENT AS `get_batch_rows`, AND IT HAS TO BE. This is the MASTER TABLE -- the
    # surface most of the feature's payment links are actually clicked on -- so enriching only the
    # batch view would leave the app's own route working in one place and not the other, which is
    # harder to diagnose than it not working at all. `matches` is empty here by design, so only the
    # related payments and the suggestion carry an order.
    suggested_orders = _payment_order_names(
        [
            r.get("suggested_name")
            for r in rows
            if (r.get("suggested_doctype") or "") == C.PAYMENT_DOCTYPE
        ]
    )
    _with_order_names(rows, {}, related)
    tab_counts, status_counts = _tab_counts(where, params)

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
                "suggested_order_name": suggested_orders.get(row.get("suggested_name") or "", ""),
            }
            for row in rows
        ],
        "total": int(total or 0),
        "limit": limit,
        "offset": offset,
        "scope": scope,
        "tab_counts": tab_counts,
        # The same population as `tab_counts`, broken down by status rather than by tab. See
        # `_tab_counts`: one tab holds two statuses and its single number cannot say which.
        "status_counts": status_counts,
    }


def _row_filters(*, batch, search, date_from, date_to, amount_min, amount_max, facets=None,
                 failed=None):
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

    # ⚠️ THE ONE SPLIT `row_status` CANNOT EXPRESS, and the reason the Skipped dialog needed it.
    # `Skipped` covers three different facts, and only one of them -- a transfer the bank REFUSED --
    # is money that never left the account. The owner ruled it out of every figure the import summary
    # reports (option B), so the Skipped chip counts 20 while every row with that status is 47. Both
    # are right; nothing could ask for one of them until now.
    #
    # ⚠️ THE DEFINITION OF "successful" IS BOUND, NEVER SPELLED. `parser.BANK_SUCCESS_STATUS` is the
    # single source, exactly as `get_import_summary` binds it rather than writing 'SUCCESS' a second
    # time -- two spellings of the bank's vocabulary is how the chip and the dialog would drift again.
    if failed is not None:
        wanted = str(failed).strip().lower() not in ("0", "false", "no", "")
        where.append(
            f"UPPER(COALESCE(r.status_raw, '')) {'<>' if wanted else '='} %s"
        )
        params.append(BANK_SUCCESS_STATUS)

    text = (search or "").strip()
    if text:
        # OR within the one "column" a person perceives as search: they are hunting a transfer, and
        # do not know or care which field carries what they half-remember.
        needle = f"%{text}%"
        where.append(
            "(" + " OR ".join(f"COALESCE({c}, '') ILIKE %s" for c in _SEARCHABLE_COLUMNS) + ")"
        )
        params.extend([needle] * len(_SEARCHABLE_COLUMNS))

    # ⚠️ A ROW WITH NO `added_on` SURVIVES EVERY PERIOD (slice P1), AND THE `IS NULL` IS THE WHOLE
    # POINT OF THESE TWO CLAUSES.
    #
    # The bank's date column is free text and does not always parse -- the parser stores NULL rather
    # than guessing, and the test fixture carries a literal `not-a-date` for exactly this case. Under
    # plain `>=` / `<` such a row matches NO period at all, so once the period became the SCREEN'S
    # SCOPE (P1) it would have disappeared from the summary, from all three tabs and from the Skipped
    # dialog simultaneously -- with no filter on screen that could bring it back, because every
    # window excludes it equally.
    #
    # That is the worst available outcome for a worklist about money: the transfer still moved, it
    # still needs settling, and a parse failure in one column is precisely the kind of row that needs
    # a person. Showing it in every period is noisy in the rare case; hiding it is silent in the
    # dangerous one.
    #
    # ⚠️ IT IS SAFE TO WIDEN THESE HERE because nothing shipped depended on the narrow reading:
    # `date_from` / `date_to` existed on the endpoint before P1 but `serverQuery` never emitted them,
    # so this is the first release in which any client sends a date at all.
    if date_from:
        where.append("(r.added_on >= %s OR r.added_on IS NULL)")
        params.append(date_from)
    if date_to:
        # Inclusive of the whole end DAY. `added_on` is a Datetime, so a bare date bound would
        # silently exclude everything after midnight on the day a person typed.
        where.append("(r.added_on < (%s::date + INTERVAL '1 day') OR r.added_on IS NULL)")
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


def _tab_counts(where, params) -> tuple[dict, dict]:
    """How many rows each tab holds UNDER THE CURRENT FILTERS, in one grouped query.

    ⚠️ EVERY COUNT IS DERIVED FROM `_SCOPE_STATUSES`, never from a second list of statuses written
    out here. The counts label the tabs, so a count that disagrees with what the tab actually shows
    is worse than no count -- and with `Skipped` now excluded from `all`, a hand-written `all` count
    would over-report by exactly the rows the tab refuses to show.

    ⚠️ IT RETURNS THE PER-STATUS COUNTS AS WELL, AND THAT IS THE POINT OF THE SECOND RETURN VALUE.
    One tab holds TWO statuses -- `Matched` (open) beside `Settled` (terminal) -- so its single
    number cannot say which. Live-observed: 863 sat under a tab labelled "Matched / Settled" while
    nothing at all had been settled, and the tab read as 863 finished. The split is already computed
    here to derive the scopes; returning it costs nothing and no second query, and it is what lets
    the tab show `863 matched · 0 settled` instead of one number that means two things.

    ⚠️ ZERO-FILLED OVER `ROW_STATUSES`, so a status with no rows comes back as `0` rather than
    absent. A missing key would render as an em dash, which reads as "unknown" when the truth is
    "none" -- and "0 settled" is precisely the fact this split exists to make visible.

    ⚠️ THE STATUS COUNTS ARE RAW AND INCLUDE `Skipped`, which no tab shows. They are a breakdown OF
    the population, not a fourth scope; never sum them expecting a tab's number. Only `tab_counts`
    is derived from `_SCOPE_STATUSES`, and it stays the one thing a tab is labelled with.
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
    tabs = {
        scope: sum(n for s, n in by_status.items() if s in statuses)
        for scope, statuses in _SCOPE_STATUSES.items()
    }
    status_counts = {status: by_status.get(status, 0) for status in ROW_STATUSES}
    # An unrecognised status -- a row staged under an older vocabulary -- is CARRIED rather than
    # dropped, on the same reasoning as `derive_import_summary`: a breakdown that quietly omitted it
    # would report fewer rows than the population it claims to describe.
    for status, n in by_status.items():
        if status and status not in status_counts:
            status_counts[status] = n
    return tabs, status_counts


@frappe.whitelist()
def get_confirmable_rows(
    batch: str = None,
    failed=None,
    search: str = None,
    date_from: str = None,
    date_to: str = None,
    amount_min=None,
    amount_max=None,
    facets=None,
):
    """What "Confirm all matched" can and cannot act on, over the current filters (X5, widened P1).

    ⚠️ IT TAKES THE SAME FILTERS AS `get_outflow_rows` AND `get_outflow_summary`, THROUGH THE SAME
    `_row_filters`. The button is labelled with `confirmable_rows` from the summary, so the two must
    select the same population or the button offers a number this endpoint cannot produce -- which
    is the defect the `stale` bucket was invented to explain, and it would come straight back if
    these two ever filtered differently. `batch=X` alone reproduces the pre-P1 behaviour exactly.

    ⚠️ IT IS CAPPED (`_MAX_CONFIRMABLE`), AND THE CAP REFUSES RATHER THAN TRUNCATES. Before P1 this
    was bounded by one statement; a period can select months. A silently truncated list would show
    "Confirm 2,000" over a set that is not the set the summary counted, and the person clicking
    would have no way to know. Refusing names the number and tells them to narrow -- see
    `_assert_confirmable_size`.

    ⚠️ `Matched` IS NOT THE SAME AS CONFIRMABLE, AND CONFLATING THEM IS THE TRAP IN THIS FEATURE. A
    row is `Matched` when the matcher found one OR MORE approved records. When it found several it
    deliberately stores NO suggestion -- the screen never guesses between two real records -- so
    those rows have nothing to confirm them AGAINST. They come back in `needs_you`: listed, linked,
    and never auto-confirmable.

    ⚠️ THE RETURN IS A FUNNEL, IN THREE BUCKETS, AND THE THIRD EXISTS BECAUSE TWO SCREENS DISAGREED.
    The summary panel's button reads `confirmable_rows` from `get_import_summary`, which counts
    `Matched` rows carrying a `suggested_name` -- it never checks that the name still resolves to a
    live record. This endpoint does check. So a row whose suggested record has since been deleted was
    counted by the button and silently absent from the dialog, and nothing on either screen accounted
    for the difference. `stale` is that set, named:

        matched_rows = len(ready) + len(stale) + len(needs_you)
        confirmable_rows (the button) = len(ready) + len(stale)

    Splitting it does NOT make the two numbers equal -- they measure different things and should not
    be forced to -- it makes the gap between them visible and explainable on the dialog itself.

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
    if batch:
        _assert_batch(batch)

    where, params = _row_filters(
        batch=batch,
        search=search,
        date_from=date_from,
        date_to=date_to,
        amount_min=amount_min,
        amount_max=amount_max,
        facets=facets,
        failed=failed,
    )
    # The scope is NOT taken from the caller. "Confirm all matched" acts on `Matched` rows by
    # definition, so the status is this endpoint's own, not a tab's -- reading a scope here would
    # let a person on the Settled tab ask to confirm nothing, or on `all` ask to confirm the same
    # set under a name that does not say so.
    where = where + ["r.row_status = %s"]
    params = params + [ROW_MATCHED]
    clause = " WHERE " + " AND ".join(where)

    _assert_confirmable_size(clause, params)

    rows = frappe.db.sql(
        f"""
        SELECT r.name, r.transfer_id, r.added_on, r.amount, r.beneficiary_name, r.remarks,
               r.bank_reference_no, r.suggested_doctype, r.suggested_name, r.outcome_note,
               r.suggestion_rule, r.match_basis, r.auto_matched
        FROM "tabOutflow Import Row" r
        {clause}
        ORDER BY r.added_on ASC, r.name ASC
        """,
        tuple(params),
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

    ready, needs_you, stale = [], [], []
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
            # WHY this record was pre-selected, when it was not simply the only one. Blank is the
            # ordinary case (exactly one approved candidate) and carries no doubt -- see
            # `services/outflow_import/disambiguate.RULE_LABELS` for the vocabulary.
            "suggestion_rule": row.get("suggestion_rule"),
            # How the counterpart was FOUND, as opposed to how one was chosen from what was found.
            "match_basis": row.get("match_basis"),
            "auto_matched": bool(row.get("auto_matched")),
        }

        detail = targets.get((doctype, name)) if doctype and name else None
        if not detail:
            # ⚠️ TWO CAUSES THAT USED TO SHARE A BUCKET, AND SPLITTING THEM IS WHAT MAKES THE
            # NUMBERS ADD UP. "The matcher found several records and deliberately picked none" and
            # "the one record it picked has since been deleted" both end here, but only the SECOND
            # is counted by the summary panel's `confirmable_rows` -- which counts rows carrying a
            # `suggested_name`, without checking that the name still resolves.
            #
            # Collapsed, the button offered "Confirm 688" and the dialog listed fewer, with nothing
            # on screen accounting for the gap. Kept apart, `len(ready) + len(stale)` IS that 688,
            # and the dialog can show where the rest went.
            (stale if (doctype and name) else needs_you).append(base)
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
                # The order this payment is against. NOT always a PO -- see `_targets_by_name`.
                # The pair travels together so the screen can label the id honestly.
                "order_doctype": detail.get("document_type"),
                "order_name": detail.get("document_name"),
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
        # Rows the match run picked a record for, whose record no longer resolves. See the split
        # above: these are inside the summary panel's `confirmable_rows` and outside `ready`, and
        # naming them is what lets the dialog account for the difference instead of hiding it.
        "stale": stale,
        # The whole funnel in one payload, so the dialog states it rather than the reader inferring
        # it from three list lengths: matched -> (ready + stale) confirmable -> ready actionable.
        "matched_rows": len(rows),
        "ready_value": float(sum(normalize_amount(r["amount"]) for r in ready)),
    }


def _assert_confirmable_size(clause: str, params) -> None:
    """Refuse a confirm set too large to be reviewed, naming the number (slice P1).

    ⚠️ IT REFUSES; IT DOES NOT TRUNCATE, AND THAT IS THE WHOLE VALUE OF IT. A `LIMIT` would hand
    back a list shorter than the count on the button that opened it, over a set nobody chose --
    exactly the "button 688, table 893" defect that the `stale` bucket exists to explain, except
    unexplainable because the missing rows would have no property in common. Refusing keeps the two
    numbers honest and hands the person a lever: narrow the period.

    ⚠️ THE CAP IS ABOUT REVIEWABILITY, NOT PERFORMANCE. The dialog is a SAFETY CONTROL -- it states
    what the button will write, including how many approved amounts it will rewrite. Past a few
    thousand rows nobody reads it, and a control nobody reads is a control that is not there.
    """
    total = frappe.db.sql(
        f"""SELECT COUNT(*) AS n FROM "tabOutflow Import Row" r {clause}""",
        tuple(params),
        as_dict=True,
    )[0]["n"]
    if int(total or 0) > _MAX_CONFIRMABLE:
        frappe.throw(
            f"{int(total):,} matched transfers are in view — too many to review in one go "
            f"(the limit is {_MAX_CONFIRMABLE:,}). Narrow the period, or filter to one import, "
            "and confirm in smaller batches.",
            title="Too many to confirm at once",
        )


@frappe.whitelist(methods=["POST"])
def match_period(
    batch: str = None,
    failed=None,
    search: str = None,
    date_from: str = None,
    date_to: str = None,
    amount_min=None,
    amount_max=None,
    facets=None,
):
    """Re-run the match for every import the current filters touch (slice P1).

    ⚠️ IT LOOPS `match_batch` PER BATCH AND CHANGES NOTHING ABOUT IT. `match_batch` runs a per-row
    loop and then FOUR global passes -- claims, Option B, stacks, the sweep -- whose ORDER is
    load-bearing at every joint, and three of which reason over the whole batch's results at once.
    Matching "just the rows in the period" would hand those passes a partial picture: the claim pass
    could not see a rival row outside the window, and the stack pass could not tell a balanced stack
    from an unbalanced one. So the unit of matching stays the BATCH, and this only decides which
    batches.

    ⚠️ CONSEQUENCE, STATED RATHER THAN DISCOVERED: a batch that STRADDLES the period is re-matched
    IN FULL, including its transfers outside it. That is wider than the filter implies, and the
    screen says so before the click -- `get_outflow_summary().imports` carries each batch's
    `row_count` (in scope) beside its `total_rows` (in the batch) for exactly that sentence. Do not
    "fix" this by narrowing the match; fix it by keeping the warning honest.

    ⚠️ SEQUENTIAL, AND THAT IS ALREADY THE SUPPORTED SHAPE. Re-running a batch is normal and safe
    (see the module docstring), and matching batch A then batch B is precisely what a person does
    today clicking Re-run on each import in turn. The cross-import passes are built for it:
    `_enforce_single_claim` READS across imports and WRITES only inside the batch being matched, and
    `_resolve_stacks` computes the same pairing from either side.
    """
    require_outflow_access()
    if batch:
        _assert_batch(batch)

    where, params = _row_filters(
        batch=batch,
        search=search,
        date_from=date_from,
        date_to=date_to,
        amount_min=amount_min,
        amount_max=amount_max,
        facets=facets,
        failed=failed,
    )
    batches = [b["name"] for b in _imports_in_scope(where, params)]

    # ⚠️ ORDERED OLDEST-FIRST, DELIBERATELY. `_imports_in_scope` returns newest-first because that is
    # how a picker reads; matching wants the opposite. A record contested by two imports goes to the
    # EARLIER transfer under `resolve_claims`' `(added_on, row name)` ordering, and matching oldest
    # first means the later batch sees that claim already placed rather than placing and releasing
    # it. The outcome is the same either way -- the claim pass is order-independent by construction
    # -- but the run does less work and its per-batch counters read in the order things happened.
    batches.reverse()

    results = []
    for name in batches:
        results.append({"batch": name, **(match_batch(name) or {})})

    return {
        "batches": batches,
        "batches_matched": len(batches),
        "results": results,
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
        # ⚠️ `document_type` / `document_name` ARE THE ORDER THIS PAYMENT IS AGAINST, AND IT IS NOT
        # ALWAYS A PO. Measured across the 802 payments of the first real statement: 602
        # `Procurement Orders`, 193 `Service Requests`. The pair travels together for that reason --
        # the id alone cannot say which it is, and a screen labelling an SR as a PO would be wrong
        # on a quarter of its rows. `document_name` is a Dynamic Link, so the type is the thing that
        # gives the id meaning, not decoration beside it.
        rows = frappe.db.sql(
            f"""
            SELECT p.name, p.amount, p.status, v.vendor_name, pr.project_name,
                   p.document_type, p.document_name
            FROM "tabProject Payments" p
            LEFT JOIN "tabVendors" v ON v.name = p.vendor
            LEFT JOIN "tabProjects" pr ON pr.name = p.project
            WHERE p.name IN ({placeholders})
            """,
            tuple(names),
            as_dict=True,
        )
    elif target_doctype == PROJECT_EXPENSE:
        # ⚠️ NULLED, NOT OMITTED. `Project Expenses` carries no order reference at all -- it has
        # `invoice_ref` and `payment_ref`, which are different facts. Selecting the columns as NULL
        # keeps the three ledgers' payload shape identical, so a caller never has to ask which
        # ledger it is holding before reading a key. The same reason the non-project branch below
        # spells out its two missing columns rather than dropping them.
        rows = frappe.db.sql(
            f"""
            SELECT e.name, e.amount, e.status, v.vendor_name, pr.project_name,
                   NULL AS document_type, NULL AS document_name
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
                   NULL AS vendor_name, NULL AS project_name,
                   NULL AS document_type, NULL AS document_name
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
               row_status, skip_reason, outcome_note, settlement_origin
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
def get_outflow_summary(
    batch: str = None,
    failed=None,
    search: str = None,
    date_from: str = None,
    date_to: str = None,
    amount_min=None,
    amount_max=None,
    facets=None,
):
    """The summary of EVERY transfer the current filters select (slice P1).

    ⚠️ THE SCOPE REVERSED HERE, AND THE OLD SHAPE IS WORTH STATING SO THE CHANGE IS LEGIBLE. Until
    P1 this was `get_import_summary(batch)` -- hard-scoped to ONE import, sitting above a table that
    spanned all of them, which the 2026-08-10 ruling called the design ("how did that statement go?"
    and "what do I still owe a decision on?" are different questions). The owner REVERSED that on
    2026-08-12: the panel now summarises a PERIOD, and the table shows the transfers inside it.

    ⚠️ IT TAKES THE SAME FILTERS AS `get_outflow_rows` AND BUILDS THEM WITH `_row_filters`, WHICH IS
    THE WHOLE POINT. The old objection to a panel that disagreed with its table was a POPULATION
    mismatch, and the fix is not to argue about which population is right -- it is to make there be
    only one. This runs the identical WHERE clause the page query, its count, the tab counts and the
    facet values all run, so the panel and the tabs beneath it cannot disagree by construction.
    Adding a second filter path here would reinstate exactly the defect `_row_filters` exists to
    prevent.

    ⚠️ EVERY FILTER EXCEPT THE SCOPE. The scope is the TAB -- a partition OF this population, not a
    narrowing of it -- so applying it would make the panel describe whichever tab happened to be
    open. This is the same rule `_tab_counts` follows, for the same reason.

    ⚠️ ONE `GROUP BY`, NOT A ROW LOOP. This is a count and a sum over potentially every row ever
    staged, which ADR-0010 puts in the database. `get_batch_rows` exists for the rows themselves.

    ⚠️ IT DERIVES NOTHING ITSELF. Every count, sum and percentage comes out of `status.py`, which is
    the only deriver in this feature (ADR-0010 B3), and `derive_import_summary` needed NO change to
    serve a period -- it folds a stream of tallies and has never known what a batch is. A summary
    that computed its own numbers could disagree with the tabs directly beneath it.

    ⚠️ THE AUTO / MANUAL SKIP SPLIT KEYS ON `decided_by`, NOT ON THE REASON TEXT. A skip written at
    upload carries a system-generated `skip_reason` and no decider; a manual one records the person.
    That is a fact the database already holds exactly, so it needs no sentence parsed -- the same
    rule `_related_paid_payments` follows for exactly the same reason.
    """
    require_outflow_access()
    if batch:
        _assert_batch(batch)

    where, params = _row_filters(
        batch=batch,
        search=search,
        date_from=date_from,
        date_to=date_to,
        amount_min=amount_min,
        amount_max=amount_max,
        facets=facets,
        failed=failed,
    )
    clause = (" WHERE " + " AND ".join(where)) if where else ""

    # ⚠️ GROUPED BY `(row_status, failed)`, NOT BY STATUS ALONE. A transfer the bank rejected is
    # `Skipped` -- and so is a duplicate, and so is a payment ticked Paid by hand. The owner ruled
    # (2026-08-10, option B) that only the first leaves every figure this summary reports, so the
    # split has to happen here, in the aggregate, rather than by subtracting a second query later.
    #
    # ⚠️ `BANK_SUCCESS_STATUS` IS BOUND, NOT SPELLED OUT. The literal lives in `parser.py` beside
    # `is_success_status`, which is what the parse path uses; writing `'SUCCESS'` into this SQL
    # would be a second definition of "successful" that stays right only until one of them learns
    # about a status word the other has not.
    #
    # ⚠️ THE `r.` ALIAS IS REQUIRED, NOT DECORATION. `_row_filters` writes every fragment against
    # `r`, so the FROM clause has to bind that alias or the shared builder cannot be used here at
    # all -- which is the one thing this endpoint must not fall back on.
    grouped = frappe.db.sql(
        f"""
        SELECT r.row_status                                        AS status,
               UPPER(TRIM(COALESCE(r.status_raw, ''))) <> %s        AS failed,
               COUNT(*)                                            AS count,
               COALESCE(SUM(r.amount), 0)                          AS value,
               COALESCE(SUM(CASE WHEN COALESCE(r.suggested_name, '') <> ''
                                 THEN 1 ELSE 0 END), 0)            AS with_suggestion,
               COALESCE(SUM(CASE WHEN COALESCE(r.suggested_name, '') <> ''
                                 THEN r.amount ELSE 0 END), 0)     AS suggested_value,
               COALESCE(SUM(CASE WHEN COALESCE(r.decided_by, '') = ''
                                 THEN 1 ELSE 0 END), 0)            AS undecided_by_a_person,
               -- Settlements that took the matcher's own pick (slice Q1). Reads the row's
               -- denormalised copy, so this stays ONE grouped query over ONE table.
               COALESCE(SUM(CASE WHEN r.settlement_origin = %s
                                 THEN 1 ELSE 0 END), 0)            AS from_suggestion
        FROM "tabOutflow Import Row" r
        {clause}
        GROUP BY r.row_status, UPPER(TRIM(COALESCE(r.status_raw, ''))) <> %s
        """,
        (BANK_SUCCESS_STATUS, ORIGIN_ACCEPTED) + tuple(params) + (BANK_SUCCESS_STATUS,),
        as_dict=True,
    )

    summary = derive_import_summary(
        StatusTally(
            status=g["status"] or "",
            count=int(g["count"] or 0),
            value=normalize_amount(g["value"]),
            with_suggestion=int(g["with_suggestion"] or 0),
            suggested_value=normalize_amount(g["suggested_value"]),
            failed=bool(g["failed"]),
            from_suggestion=int(g["from_suggestion"] or 0),
        )
        for g in grouped
    )

    # ⚠️ FAILED GROUPS ARE EXCLUDED HERE TOO, AND THEY HAVE TO BE. `manually_skipped_rows` below is
    # `skipped_rows - auto_skipped`, and `skipped_rows` no longer counts failed transfers -- so
    # leaving them in this sum would subtract rows the minuend does not contain and report a
    # manual-skip count that is too low, or `max(..., 0)` masking a negative. Both figures must
    # count the same population.
    auto_skipped = sum(
        int(g["undecided_by_a_person"] or 0)
        for g in grouped
        if (g["status"] or "") == ROW_SKIPPED and not g["failed"]
    )

    return {
        "batch": batch,
        "imports": _imports_in_scope(where, params),
        # ⚠️ THE STATEMENT'S OWN METADATA, ONLY WHEN ONE IS SELECTED. A period spanning several
        # imports has no single filename, uploader or declared period, and inventing one would be a
        # caption that quietly describes the wrong statement. Absent is the honest shape there; the
        # screen reads the `imports` list instead.
        "import": _batch_meta(batch) if batch else None,
        "totals": _jsonable_summary(summary),
        # Which skips were the system's and which were a person's. The screen labels them
        # differently because they mean different things: one is bookkeeping, one is a decision.
        "auto_skipped_rows": auto_skipped,
        "manually_skipped_rows": max(summary["skipped_rows"] - auto_skipped, 0),
    }


def _batch_meta(batch: str) -> dict:
    """One statement's own facts, for the header shown when it is the selected import."""
    return frappe.db.get_value(
        BATCH_DOCTYPE,
        batch,
        [
            "name", "original_filename", "source", "period_from", "period_to",
            "status", "gross_amount", "charges_amount", "overlaps_batch",
            "uploaded_by", "uploaded_at",
        ],
        as_dict=True,
    )


def _imports_in_scope(where, params) -> list:
    """Which statements the selected transfers actually came from.

    ⚠️ DERIVED FROM THE ROWS, NEVER BY SELECTING BATCHES ON `period_from` / `period_to`. There are
    THREE different "periods" in this schema and they do not coincide: a row's `added_on` (when the
    money moved), a batch's declared period, and its `uploaded_at`. The screen filters on
    `added_on`, so asking the batch table for "batches whose declared period overlaps" would return
    a DIFFERENT set -- late uploads straddle boundaries, and `overlaps_batch` exists precisely
    because declared periods overlap. Reading the imports back off the rows we already selected is
    the only answer that cannot disagree with the figures beside it.

    ⚠️ THIS IS WHAT `match_period` ACTS ON, so it is a fact about the action and not only a caption:
    re-running the match touches these batches IN FULL, including their transfers outside the
    filter. `row_count` is how many of each batch's rows are actually in scope, which is what lets
    the screen say so honestly instead of implying the action is as narrow as the period.
    """
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return [
        {
            "name": g["name"],
            "original_filename": g["original_filename"],
            "period_from": g["period_from"],
            "period_to": g["period_to"],
            "uploaded_at": g["uploaded_at"],
            "row_count": int(g["row_count"] or 0),
            # How many rows the batch holds in TOTAL, so a caller can see at a glance that acting on
            # it reaches further than the filter does.
            "total_rows": int(g["total_rows"] or 0),
        }
        for g in frappe.db.sql(
            f"""
            SELECT b.name, b.original_filename, b.period_from, b.period_to, b.uploaded_at,
                   COUNT(*) AS row_count,
                   COALESCE(MAX(b.total_rows), 0) AS total_rows
            FROM "tabOutflow Import Row" r
            JOIN "tabOutflow Import Batch" b ON b.name = r.import_batch
            {clause}
            GROUP BY b.name, b.original_filename, b.period_from, b.period_to, b.uploaded_at
            ORDER BY b.uploaded_at DESC NULLS LAST, b.name DESC
            """,
            tuple(params),
            as_dict=True,
        )
    ]


@frappe.whitelist()
def get_import_summary(batch: str):
    """One import's summary. KEPT as a thin wrapper over the period-scoped read (slice P1).

    ⚠️ IT IS NOT DEAD CODE AND MUST NOT BE DELETED. `test_review` reads it, and it is still the
    honest way to ask "how did that one statement go?" -- the question the 2026-08-10 ruling was
    about. What changed is that it is no longer the ONLY question the panel can answer.

    ⚠️ IT IS ALSO THE REGRESSION PIN. Because it delegates rather than keeping its own query, a
    filtered summary and a batch summary can never drift apart: `batch=X` and nothing else IS the
    old WHERE clause, so every number here is the number this endpoint returned before P1. A test
    asserts exactly that.

    The `import:` block it is named for now comes straight from `get_outflow_summary`, which fills it
    whenever a batch is selected -- so this really is a pure delegate, and there is no second query
    anywhere that could answer the same question differently.
    """
    require_outflow_access()
    _assert_batch(batch)
    return get_outflow_summary(batch=batch)


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
