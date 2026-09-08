# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Row and batch status derivation (Bulk Import Outflow, slice V0).

PURE MODULE -- no `frappe`, no database, no request context. It imports exactly ONE thing from its
own package, `amounts.amounts_match`, which is itself a pure leaf; see the import for why. The
property being protected is that this deriver stays callable from a plain unittest with no bench,
no site and no fixtures -- not import-count purity for its own sake.

THE SINGLE DERIVER (ADR-0010 B3). Every `row_status` and every `Outflow Import Batch.status` in this
feature comes from here. Nothing else -- no endpoint, no controller, no frontend -- may compute one.
The frontend mirrors these rules in `outflowImportStatus.ts` and is pinned to this module by a
parity test; that mirror is a convenience, and this file is the authority.

⚠️ THIS FILE WAS REWRITTEN AT THE v3 REVERSAL (owner, 2026-08-06). The v2 spine was "the payment
branch never writes"; the new spine is:

    The import pays what someone has already approved. It never approves anything, and it never
    creates a Project Payment.

All three ledgers -- `Project Payments`, `Project Expenses`, `Non Project Expenses` -- settle
`Approved -> Paid` and nothing else. Anything in the surrounding v2 code that reads as though the
payment branch is read-only is history, not instruction. Spec: `docs/outflow-import/workflow.html`
section 0.

THE VOCABULARY -- six statuses, and what a reviewer does with each:

    Pending match run   Staged from the sheet. Nothing has been looked up yet.  -> press Run match
    Matched             At least one APPROVED record was found at this amount.  -> confirm it
    Mismatched          Nothing settleable was found, OR the amounts disagree.  -> create or link
    Settled             We wrote. The record is now Paid and linked back.       -> terminal
    Skipped             Nothing to do, and the reason says which nothing.       -> terminal
    Error               The write was attempted and rolled back.                -> retry

⚠️ `Unmatched` WAS MERGED INTO `Mismatched` (owner ruling 2026-08-10) -- SEVEN STATUSES BECAME SIX.
They were separate because they have different CAUSES: one is "the match ran and found nothing
settleable", the other is "a record already recorded as Paid disagrees on amount". They are the same
THING to the person holding the statement -- a transfer that did not line up, needing a human to
create or link something -- and splitting them made the reviewer classify the reason before they
could act on either.

THE CAUSE IS NOT LOST, IT MOVED TO THE NOTE. `_nothing_found_note` and `_delta_note` are unchanged
and still say plainly which case a row is, in the sentence the Outcome column already shows. What
went is the need to read a STATUS CHIP to find out. Do not reintroduce a status to carry a
distinction a sentence carries better.

FOUR RULES THAT LOOK LIKE DETAILS AND ARE NOT:

1. ONLY `Approved` RECORDS ARE EVER MATCHED. A transfer against a `Requested` or `CEO Pending`
   payment is simply `Mismatched`. There is no "matched but not approved" status, no approval nudge
   and no deep link into an approval queue -- nothing that cannot be settled is offered. This
   REVERSES an earlier stated goal (surfacing the 111 CEO-Pending payments, Rs 88.8 L); it was
   removed deliberately and must not be re-added. Enforcing it is `candidates.py`'s job -- this
   module simply never sees a non-Approved candidate, so `Matched` cannot lie.

2. THE ALREADY-PAID DUPLICATE CHECK SURVIVES, AND IT IS A SKIP, NOT A MATCH (owner ruling Q14). It
   is fed in through `paid_duplicate`, which comes from a query kept VISIBLY SEPARATE from the
   candidate query precisely so a later reader cannot mistake one for the other. Without it, a
   payment somebody ticked Paid by hand before uploading comes back `Mismatched`, and the obvious
   next click records the same money a second time. Mixed usage -- half a statement hand-ticked --
   is the NORMAL case under owner ruling Q12, not an edge case.

3. THE AMOUNT BRANCH OF `Mismatched` IS ABOUT AMOUNTS, FULL STOP -- and about amounts that differ by
   MORE THAN THE ROUNDING WINDOW. The v2 `Reference mismatch` branch is DELETED, not folded in: the
   owner asked why the system would compare a stored reference on a payment that is already Paid,
   and there was no answer. A reference is now only ever WRITTEN into a blank, never compared. That
   deletion is also why this module no longer imports `matcher` -- the basis string was needed by
   the reference branch and by nothing else.

   The window matters as much as the axis: a sub-rupee gap is the bank rounding a paise amount, not
   a discrepancy, and reporting it as one buried 8 of 26 rows in a real statement under a note that
   suggested TDS.

4. `Mismatched` MUST STAY RESOLVABLE. It is an OPEN status, and the screen gives it the same full
   decision dialog as any other open row. Reporting a disagreement with no way to act on it was the
   defect the owner named. This matters MORE after the merge, not less: the status is now the
   productive case -- most of the work in a statement -- rather than the rare one.

PRECEDENCE IS DELIBERATE. Duplicates and failed transfers are settled before anything is matched,
because both describe money that must not be recorded again -- or at all -- whatever a lookup would
otherwise find. The already-Paid check then runs BEFORE the candidate check, which is safe because
an already-Paid record is not in the candidate pool at all (rule 1), so the two can never contend.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Sequence

# ⚠️ THE ONE IMPORT THIS MODULE MAY MAKE FROM ITS OWN PACKAGE, and it was added to fix a live defect.
# The already-Paid branch below used EXACT equality while every other amount comparison in the
# feature used the +-Re 1 window, so a payment somebody ticked Paid by hand at Rs 18,903.60 against
# an Rs 18,904.00 transfer came back `Mismatched` -- reported as a possible TDS deduction, for
# 40 paise. On one real import that was 8 of 26 rows, totalling Rs 3.12 of "discrepancy".
#
# `amounts` is itself a PURE leaf -- `from decimal import ...` and nothing else -- so this costs
# nothing that matters: the deriver stays callable from a plain unittest with no bench, no site and
# no fixtures, which is the property the purity test actually exists to protect.
from nirmaan_stack.services.outflow_import.amounts import amounts_match

# THE SECOND PERMITTED PACKAGE IMPORT, on exactly the same terms as the first. `ledgers` is a PURE
# leaf -- vocabulary, no behaviour, no `frappe` -- so the property the purity test protects (this
# deriver stays callable from a plain unittest with no bench, no site and no fixtures) is untouched.
#
# ⚠️ IT IS IMPORTED SO THAT `derive_settled_ledger_split` DOES NOT SPELL THE THREE LEDGER NAMES A
# SECOND TIME. A private list here would be free to drift from the one `candidates.py` offers from
# and `settle.py` writes to -- and the symptom would be a settled-by-ledger panel that silently
# omits a book the import had just settled into.
from nirmaan_stack.services.outflow_import.ledgers import (
    LEDGER_DOCTYPES,
    RECEIVED_LEDGER_DOCTYPES,
)

__all__ = [
    "ROW_PENDING_MATCH",
    "ROW_MATCHED",
    "ROW_MISMATCHED",
    "ROW_PARTIALLY_ALLOCATED",
    "ROW_SETTLED",
    "ROW_SKIPPED",
    "ROW_ERROR",
    "settleable_candidates",
    "ROW_STATUSES",
    "TERMINAL_ROW_STATUSES",
    "OPEN_ROW_STATUSES",
    "ACTIVE_ROW_STATUSES",
    "BATCH_DRAFT",
    "BATCH_IN_REVIEW",
    "BATCH_PARTIALLY_SETTLED",
    "BATCH_COMPLETED",
    "BATCH_STATUSES",
    "batch_is_open",
    "RowOutcome",
    "Suggestion",
    "StatusTally",
    "ORIGIN_ACCEPTED",
    "ORIGIN_OVERRIDDEN",
    "ORIGIN_NO_SUGGESTION",
    "settlement_origin",
    "derive_staged_row_outcome",
    "derive_row_outcome",
    "derive_duplicate_guard_outcome",
    "sole_suggestion",
    "derive_batch_status",
    "derive_batch_counters",
    "derive_import_summary",
    "SUMMARY_EXCLUDED_STATUSES",
    "SettledLedgerEntry",
    "derive_settled_ledger_split",
    "SETTLED_LEDGER_OTHER",
    "ROW_DIRECTION_CREDIT",
    "SETTLED_BLOCK_RECEIVED",
    "SETTLED_BLOCK_PAID",
    "is_received_direction",
    "derive_settled_direction_blocks",
    "SKIP_REASON_NOT_SUCCESSFUL",
    "SKIP_REASON_ALREADY_IMPORTED",
    "SKIP_REASON_DUPLICATE_IN_FILE",
    "SKIP_REASON_ALREADY_PAID",
    "SKIP_REASON_EXCLUDED_AT_INGEST",
    "STAGED_NOTE_NO_SETTLEMENT_PATH",
]

ROW_PENDING_MATCH = "Pending match run"
ROW_MATCHED = "Matched"
ROW_MISMATCHED = "Mismatched"
# ⚠️ MONEY IS WRITTEN AND WORK REMAINS -- the first status for which both are true (ADR-0020 D5).
# One bank transfer may settle several approved payments, allocated over several sittings; a row
# holds this status while `allocated < amount`. It is derived exactly like every other status here:
# `allocation.status_for_allocation` compares a fresh SUM over `Outflow Row Match` against the
# row's own amount. There is no leg counter and no completion flag, because a BALANCE answers
# "is this finished?" and a CARDINALITY cannot -- an aggregate over an open set needs no count,
# which is what makes an unbounded number of legs safe.
ROW_PARTIALLY_ALLOCATED = "Partially Allocated"
ROW_SETTLED = "Settled"
ROW_SKIPPED = "Skipped"
ROW_ERROR = "Error"

# The vocabulary in the order a reviewer meets it. The doctype's `row_status` Select carries this
# exact list in this exact order, and so does the frontend mirror.
#
# ⚠️ `Unmatched` IS RETIRED (owner ruling 2026-08-10), MERGED INTO `Mismatched`. Rows staged before
# that carry the retired string until `patches/v3_0/merge_outflow_unmatched_status.py` has run --
# and `derive_import_summary` carries an unknown status rather than dropping it precisely so an
# un-migrated database reports an honest total instead of a quietly short one.
ROW_STATUSES = (
    ROW_PENDING_MATCH,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
    ROW_SKIPPED,
    ROW_ERROR,
)

# Terminal = nobody owes this row anything further.
#
# ⚠️ THIS IS NARROWER THAN v2, AND THE NARROWING IS THE POINT. Under v2 a read-only FINDING was
# terminal, because reporting it WAS the whole job. Under v3 the import settles, so a row that
# found something and has not been confirmed is unfinished work -- `Matched` and `Mismatched` are
# both OPEN. Only a row we wrote (`Settled`) or deliberately declined (`Skipped`) is done.
TERMINAL_ROW_STATUSES = frozenset({ROW_SETTLED, ROW_SKIPPED})

# Open = a person still owes this row a decision. Everything that is not terminal.
OPEN_ROW_STATUSES = frozenset({ROW_PENDING_MATCH, ROW_MATCHED, ROW_MISMATCHED, ROW_ERROR})

# Active = this row still needs a human, whether or not money has already moved against it.
#
# ⚠️ THIS IS NOT `not TERMINAL`, AND `Partially Allocated` IS WHY. That status is in NEITHER
# `OPEN_ROW_STATUSES` NOR `TERMINAL_ROW_STATUSES`, on purpose:
#
#   - putting it in OPEN would enrol it in the four cross-batch reads that walk that set
#     (`review._disambiguate_matched`, `_enforce_single_claim`, `_load_open_rows_for_keys`), so a
#     half-allocated row would start contending for records a different row already holds;
#   - putting it in TERMINAL would tell `derive_batch_status`, `batch_is_open` and the screen that
#     a transfer with money still to allocate is finished.
#
# So the "does anybody still owe this row a decision?" question moved to its OWN set, and the two
# readers that ask it -- `derive_batch_status` and `derive_import_summary`'s open figures -- read
# THIS one. `ACTIVE == OPEN` until the first partial allocation exists, so nothing already in the
# database moves; that equivalence is pinned by test rather than left to be noticed.
ACTIVE_ROW_STATUSES = OPEN_ROW_STATUSES | {ROW_PARTIALLY_ALLOCATED}

# Statuses that leave `derive_import_summary`'s STATEMENT TOTALS (`total_rows` / `total_value`).
#
# ⚠️ THIS IS NAMED RATHER THAN INLINED SO THE REASON IS GREPPABLE. An `if status == ROW_SKIPPED`
# buried in the loop reads as an implementation detail; it is an owner ruling about what a
# statement's total MEANS, and the next reader has to be able to find every place it applies.
#
# WHY SKIPPED LEAVES THE TOTALS. Most skipped rows are CROSS-BATCH DUPLICATES -- a transfer that
# already arrived in an earlier statement and was already counted there. Measured live: 544 of 640.
# Counting them again totals the same money twice across two imports, and makes `decided_percent` a
# percentage of work that was finished before this statement was uploaded.
#
# ⚠️ IT IS *NOT* `TERMINAL_ROW_STATUSES` AND MUST NEVER BE FOLDED INTO IT. That set answers a
# different question -- "does anybody still owe this row a decision?" -- and is read by
# `derive_batch_status`, `batch_is_open` and `review._FROZEN_ROW_STATUSES`. Narrowing it to make
# this exclusion fall out for free would change which statements the "Re-run match" button touches
# and which rows a re-match may overwrite. The exclusion is LOCAL to `derive_import_summary`.
#
# ⚠️ THE SKIPPED CHIP STILL RENDERS. `by_status` keeps its Skipped bucket and `skipped_rows` /
# `skipped_value` are unchanged -- the rows are excluded from the TOTALS, never hidden. That is the
# same shape option B chose for failed transfers: the evidence survives, its effect on the figures
# does not.
SUMMARY_EXCLUDED_STATUSES = frozenset({ROW_SKIPPED})

BATCH_DRAFT = "Draft"
BATCH_IN_REVIEW = "In Review"
BATCH_PARTIALLY_SETTLED = "Partially Settled"
BATCH_COMPLETED = "Completed"

# ⚠️ `Completed with exceptions` is GONE (owner ruling). It preserved a signal the three tabs --
# Pending / Settled / Skipped -- now show directly, and it made a batch closed with work
# outstanding indistinguishable from one where the work was genuinely finished only by reading a
# second field. Closing a batch is bookkeeping: it records `closed_at`, and the derived status
# stays honest about how much is actually decided.
BATCH_STATUSES = (BATCH_DRAFT, BATCH_IN_REVIEW, BATCH_PARTIALLY_SETTLED, BATCH_COMPLETED)

SKIP_REASON_NOT_SUCCESSFUL = "Transfer did not succeed at the bank ({status})."
SKIP_REASON_ALREADY_IMPORTED = "Already imported in batch {batch}."
SKIP_REASON_DUPLICATE_IN_FILE = "This transfer appears earlier in the same statement."
SKIP_REASON_ALREADY_PAID = "Already recorded as Paid on {records}."

# The bank-statement exclusion (slice B3). `{category}` is a `bank_exclusions.SKIP_CATEGORY_IDS`
# member, verbatim.
#
# ⚠️ THE CATEGORY ID IS IN THE SENTENCE ON PURPOSE, AND IT IS THE RAW ID RATHER THAN A PRETTY LABEL.
# `bank_exclusions` fits ten narration patterns to eight months of ONE account and says in as many
# words that the per-category counts are what makes a new narration form noticeable. A reviewer who
# can see `platform_porter` on the row can find the rule that fired it, count how often it fires and
# argue with it; "Skipped -- not a spend" is unauditable, and a mis-fitted rule under it would go on
# quietly dropping real payments. A second, prettier vocabulary here would also be a second thing to
# keep in step with the ruleset, which is exactly what naming the id avoids.
SKIP_REASON_EXCLUDED_AT_INGEST = (
    "Not spending -- this line is money moving inside the bank or between our own accounts. "
    "Excluded by bank-statement rule '{category}'."
)

# The landing note for a source that stages straight to `Mismatched` (slice B3, owner ruling Q31).
#
# ⚠️ IT SAYS "NO SETTLEMENT PATH", NOT "THE MATCHER NEVER RUNS", AND THE DIFFERENCE IS DELIBERATE.
# A bank statement suggests no record to settle -- measured: tier 1 is structurally unreachable,
# tier 0's Approved-only pool is empty for every row of every statement, and tier 2 fires zero times
# with all seven near-misses false positives. But the already-recorded-as-Paid DUPLICATE guard is
# kept (owner ruling Q31a; it catches 41 of 711 real debits), and that guard lives in the match run.
# A reader who took the stronger claim as a rule would have no reason to let this source reach the
# run at all, and would silently delete the guard.
STAGED_NOTE_NO_SETTLEMENT_PATH = (
    "This statement creates records rather than settling approved ones. "
    "Resolve it by creating a new record or linking an existing one."
)


@dataclass(frozen=True)
class RowOutcome:
    """A derived status plus the sentence that explains it to a reviewer.

    `note` is written for a person, not parsed. It carries the amount delta and its implied rate,
    the record already recorded as Paid, or how many approved candidates were found.
    """

    status: str
    note: str = ""

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_ROW_STATUSES


@dataclass(frozen=True)
class Suggestion:
    """The ONE record a matched row should open with already chosen.

    A pair rather than a whole target, because that is all the screen needs and all the import row
    stores: `(target_doctype, target_name)` addresses any of the three ledgers.
    """

    doctype: str
    name: str


def derive_staged_row_outcome(
    row,
    already_imported_in: str | None = None,
    duplicate_in_file: bool = False,
    excluded_category: str = "",
    no_settlement_path: bool = False,
) -> RowOutcome:
    """The outcome a row gets AT UPLOAD, before any matching has run.

    A separate entry point rather than a mode flag on `derive_row_outcome`, because the two answer
    genuinely different questions. At upload there IS no match, so "did this find a record?" is
    unanswerable -- and `derive_row_outcome` would answer `Mismatched`, which is a FINDING and would
    be a lie about work that has not happened yet. Only the facts knowable without matching are
    decided here; everything else stays `Pending match run`.

    `duplicate_in_file` covers the same transfer id appearing TWICE IN ONE STATEMENT, which is
    different from `already_imported_in` (the same transfer in an EARLIER batch) and has to be
    caught separately because the cross-batch lookup cannot see the file it is currently reading.
    Leaving it uncaught is not cosmetic: both copies would offer the same record, and settling both
    would violate the `Outflow Row Match` unique constraint.

    Skip reasons are shared verbatim with `derive_row_outcome`, so a row skipped at upload and a
    row skipped after matching read identically to a reviewer.

    THE TWO SLICE-B3 PARAMETERS, and why they are parameters rather than logic:

    `excluded_category` is a `bank_exclusions` category id, or `""` for a row no rule matched. THE
    VERDICT IS COMPUTED BY THE CALLER AND HANDED IN -- this module does not import
    `bank_exclusions`. Not squeamishness about a cycle (there is none; both are pure leaves): this
    deriver's stated property is that it imports exactly ONE thing from its own package, so that it
    stays callable from a plain unittest with no bench and no fixtures. It is also the shape the two
    parameters above already use -- `already_imported_in` is a database answer computed elsewhere
    and passed in, for the same reason. The deriver still owns the STATUS; the caller owns the
    lookup.

    `no_settlement_path` is a fact about the SOURCE, not about the row: a bank passbook suggests no
    approved record to settle, so `Pending match run` would promise the reviewer a run that will
    never produce a settlement, and they would press it once per statement forever. Landing straight
    on `Mismatched` states the truth -- this row needs a person -- on the day it is staged.
    ⚠️ IT DOES **NOT** MEAN "THE MATCH RUN MUST NOT TOUCH THIS ROW", and nothing here freezes it:
    `Mismatched` is in `OPEN_ROW_STATUSES` and is absent from `review._FROZEN_ROW_STATUSES`, so a
    later run still examines the row -- which is exactly what the retained already-recorded-as-Paid
    duplicate guard needs (owner ruling Q31a). Landing it `Skipped` instead would have frozen it and
    silently deleted that guard.

    ⚠️ THE EXCLUSION IS TESTED **FIRST**, AHEAD OF BOTH DUPLICATE CHECKS, AND THE ORDER IS A
    DECISION. Every branch here ends at `Skipped`, so the precedence changes no status anywhere --
    it decides only which SENTENCE the reviewer reads, which is the whole value of the field. An
    exclusion is a property of the LINE ITSELF ("this was never spending") and is true whatever the
    corpus holds; "already imported in batch X" is a property of history, and it sends a reader off
    to a batch where the row was, correctly, skipped as an exclusion too -- a wild goose chase. The
    decisive case is a re-upload: with already-imported first, 405 of 1,274 rows would read "already
    imported" instead of naming the ten rules, destroying the per-category counts that
    `bank_exclusions` says are what makes a new narration form noticeable.
    """
    if excluded_category:
        return RowOutcome(
            ROW_SKIPPED, SKIP_REASON_EXCLUDED_AT_INGEST.format(category=excluded_category)
        )
    if already_imported_in:
        return RowOutcome(
            ROW_SKIPPED, SKIP_REASON_ALREADY_IMPORTED.format(batch=already_imported_in)
        )
    if duplicate_in_file:
        return RowOutcome(ROW_SKIPPED, SKIP_REASON_DUPLICATE_IN_FILE)
    if not getattr(row, "is_success", False):
        status_raw = (getattr(row, "status_raw", "") or "unknown").strip() or "unknown"
        return RowOutcome(ROW_SKIPPED, SKIP_REASON_NOT_SUCCESSFUL.format(status=status_raw))
    if no_settlement_path:
        return RowOutcome(ROW_MISMATCHED, STAGED_NOTE_NO_SETTLEMENT_PATH)
    return RowOutcome(ROW_PENDING_MATCH, "")


def derive_row_outcome(
    row,
    match=None,
    already_imported_in: str | None = None,
    paid_duplicate=None,
) -> RowOutcome:
    """Derive one bank row's outcome from its match result.

    `already_imported_in` names an EARLIER batch that already carries this transfer id, if any.

    `paid_duplicate` is the already-Paid duplicate finding of rule 2 -- a group-shaped object with
    `.targets` and `.total_amount`, or `None`. It comes from a query that is deliberately NOT the
    candidate query. It is a group rather than a single record so that a fan-out (one transfer
    against several payments, 40 real cases covering 99 payments) is still recognised as one
    already-recorded transfer rather than reported as a partial.

    Both are the caller's to supply -- they need the database, and this module does not touch it.
    """
    # 1. Duplicates first. A transfer already handled elsewhere is not re-decided, whatever it
    #    would otherwise match -- offering it again is how the same money gets recorded twice.
    if already_imported_in:
        return RowOutcome(
            ROW_SKIPPED, SKIP_REASON_ALREADY_IMPORTED.format(batch=already_imported_in)
        )

    # 2 and 3. Money that never moved, then money already recorded as Paid by hand. Both are shared
    # verbatim with `derive_duplicate_guard_outcome` -- see `_failed_or_already_paid`.
    decided = _failed_or_already_paid(row, paid_duplicate)
    if decided is not None:
        return decided

    candidates = _settleable_candidates(match)
    if not candidates:
        # ⚠️ SAME STATUS AS THE AMOUNT DISAGREEMENT ABOVE, DIFFERENT NOTE (owner ruling 2026-08-10).
        # This used to be its own `Unmatched`. The two are one status now because they are one job
        # -- a transfer that did not line up, needing a person to create or link something -- and
        # the note is where the cause belongs.
        return RowOutcome(ROW_MISMATCHED, _nothing_found_note())

    # 4. At least one APPROVED record at this amount. One candidate is a confident suggestion the
    #    screen pre-selects; several is an ambiguity the screen presents without guessing between
    #    them (owner: the screen never guesses between two real records). Both are `Matched` --
    #    something settleable was found, and a person confirms which. The vocabulary is fixed at
    #    seven statuses and deliberately has no "Ambiguous"; the distinction is a screen concern,
    #    carried in the note rather than in the status.
    return RowOutcome(ROW_MATCHED, _matched_note(candidates, getattr(match, "tier", "")))


def _failed_or_already_paid(row, paid_duplicate) -> RowOutcome | None:
    """Rules 2 and 3, or `None` when neither fires. Shared by BOTH match-time derivers.

    ⚠️ FACTORED OUT AT SLICE B4 RATHER THAN COPIED, AND THE COPY WOULD HAVE BEEN THE DEFECT.
    `derive_duplicate_guard_outcome` needs these two branches and nothing else, and the branches
    carry two things that must never exist twice: the ROUNDING WINDOW (`amounts_match`, not `!=` --
    see the note below) and the SENTENCES a reviewer reads. Two copies would let a bank statement's
    already-Paid row read differently from a gateway's, or drift back to an exact comparison on one
    path only. Nobody would notice; both would still pass their own tests.
    """
    # 2. Money that never moved. A FAILED transfer still carries a bank reference and would match
    #    perfectly well, so this must come before any matching is considered.
    if not getattr(row, "is_success", False):
        status_raw = (getattr(row, "status_raw", "") or "unknown").strip() or "unknown"
        return RowOutcome(ROW_SKIPPED, SKIP_REASON_NOT_SUCCESSFUL.format(status=status_raw))

    # 3. Already recorded as Paid by hand (rule 2). Safe to test before the candidate pool because
    #    an already-Paid record is not IN the candidate pool (rule 1) -- the two cannot contend.
    if paid_duplicate is not None and getattr(paid_duplicate, "targets", ()):
        bank_amount = _amount_of(row)
        total = _total_of(paid_duplicate)
        if not amounts_match(total, bank_amount):
            # The AMOUNT route to `Mismatched` -- narrow and honest: the bank amount disagrees with
            # what the already-Paid record(s) claim by MORE THAN THE ROUNDING WINDOW. Since the
            # 2026-08-10 merge it is no longer the ONLY route (found-nothing lands here too), which
            # is exactly why `_delta_note` must keep naming the record and the shortfall -- the note
            # is now the only thing telling the two apart.
            #
            # ⚠️ THIS USED TO BE `total != bank_amount`, AND THE EXACTNESS WAS A DEFECT. The bank
            # rounds to the whole rupee and 31.4% of payments carry paise, so every hand-ticked
            # payment with paise on it arrived here as a "discrepancy" -- announced with a note
            # suggesting TDS, for gaps of 14 to 86 paise. The candidate passes had used the window
            # since the tolerance landed; this branch was the one call site that never got it.
            # Restoring the exact test re-breaks 8 rows in every real statement measured so far.
            return RowOutcome(ROW_MISMATCHED, _delta_note(bank_amount, total, paid_duplicate))
        return RowOutcome(
            ROW_SKIPPED,
            SKIP_REASON_ALREADY_PAID.format(records=_name_list(paid_duplicate)),
        )

    return None


def derive_duplicate_guard_outcome(row, paid_duplicate=None) -> RowOutcome:
    """The match-run outcome for a row whose SOURCE HAS NO SETTLEMENT PATH (slice B4).

    A third entry point beside `derive_staged_row_outcome` and `derive_row_outcome`, for the same
    reason the second one exists: it answers a genuinely different question. `derive_row_outcome`
    asks "what did this transfer MATCH?" -- and for a bank passbook that question has no honest
    answer, because there is nothing for it to match (`sources.source_has_settlement_path` carries
    the measurement: tier 1 unreachable, tier 0's pool empty by construction, tier 2 zero hits and
    all seven near-misses false positives). This asks the only question the run may ask of such a
    row: "is this transfer ALREADY RECORDED as Paid, or is it work?"

    ⚠️ IT TAKES NO `match` ARGUMENT, AND THAT ABSENCE IS THE POINT. A parameter would be a place for
    a caller to pass candidates in, and the whole slice is that no settlement candidate is ever
    produced for this source. The signature makes it structurally impossible to suggest a record
    from here -- there is nothing to suggest one FROM. `review.match_batch` matches the shape on its
    side: it never loads a settlement pool and never calls `match_row` for such a batch.

    ⚠️ THE ALREADY-PAID GUARD IS KEPT, AND KEEPING IT IS WHY THIS FUNCTION EXISTS AT ALL (owner
    ruling Q31a). It catches 41 of 711 real ICICI debits. Without it those 41 arrive as ordinary
    work and the obvious next click books the same money a second time.

    ⚠️ EVERYTHING ELSE GETS THE **STAGING** SENTENCE BACK, NOT `_nothing_found_note`. Both are
    `Mismatched`, so the status is identical either way; the note is the whole difference, and
    "No approved payment or expense matches this transfer" would be a finding about a search that
    never ran -- it would send a reviewer hunting for a record that does not exist. Re-writing the
    sentence the row was staged with also keeps a re-run byte-idempotent on the note, which is the
    same reasoning `review._sweep_unresolved_to_mismatched` applies with its `keep_notes` set.

    `already_imported_in` is deliberately NOT a parameter here: the cross-batch duplicate check is
    settled at UPLOAD for every source (`derive_staged_row_outcome`), and `review.match_batch` has
    never passed it either.
    """
    decided = _failed_or_already_paid(row, paid_duplicate)
    if decided is not None:
        return decided
    return RowOutcome(ROW_MISMATCHED, STAGED_NOTE_NO_SETTLEMENT_PATH)


def _settleable_candidates(match) -> tuple:
    """Every approved record this row could settle, payments and expenses alike.

    Both ledgers reach the same final step, so both are `Matched`. Payments arrive grouped (one
    transfer may cover several, and the group is what settles together); expenses arrive as
    individual candidates.

    ⚠️ IT READS **EVERY** PAYMENT GROUP. IT USED TO READ ONLY `best_payment_group`, AND THAT WAS THE
    WORST DEFECT THIS FEATURE HAS SHIPPED -- found on the first 1,043-row real statement, 2026-08-10.

    `best_payment_group` is `payment_groups[0]`. Taking only it collapsed N equally-good payment
    candidates into ONE list entry, so `len(candidates)` was 1 and everything downstream believed
    the row was unambiguous:

      * `sole_suggestion` pre-selected the arbitrary first one -- breaking its own owner-locked rule
        that two real records must yield NOTHING, because the screen never guesses between them.
      * `_matched_note` announced "One approved record at this amount: PAY-X" when there were six.
        That sentence is the reviewer's entire basis for ticking a row without opening it.

    Measured on the real statement: a vendor with SIX approved payments of Rs 9,000 and SEVEN
    transfers of Rs 9,000 had all seven rows pre-selected onto the SAME payment. One settled; the
    other six failed with `AlreadyPaidError`, and the vendor's five other approved payments were
    never offered to anybody. Across the batch that was 124 doomed confirmations, and 58 of the 117
    rows still reading "One approved record" genuinely had several.

    The bug was invisible because the ONLY ambiguity the old list could express was payment-vs-
    expense (or expense-vs-expense) -- which is why exactly 5 rows in 1,043 ever read as ambiguous.
    Payment-vs-payment, the common case on the main ledger, could not be represented at all.

    ⚠️ A GROUP IS STILL ONE CANDIDATE. A fan-out -- one transfer covering several payments, found at
    tier 0 by shared reference -- is a single group with several targets, and it counts ONCE here.
    That is correct: the group settles together, so there is nothing for a person to choose between.
    Tiers 1 and 2 are single-target by construction, so N candidates there means N separate records.
    """
    if match is None:
        return ()
    out: list = []
    for group in getattr(match, "payment_groups", ()) or ():
        if getattr(group, "targets", ()):
            out.append(group)
    out.extend(getattr(match, "expense_candidates", ()) or ())
    return tuple(out)


def settleable_candidates(match) -> tuple:
    """The public name for `_settleable_candidates`, for callers outside this module.

    ⚠️ IT IS AN ALIAS, NOT A SECOND IMPLEMENTATION, and that is the entire point of it. The docstring
    above records the worst defect this feature has shipped, and its cause was a second, narrower
    idea of "the candidates" (`best_payment_group`) living beside the real one. Option B's
    disambiguation needs exactly this list -- so it gets exactly this list, rather than a copy that
    could drift from the one `sole_suggestion` and `_matched_note` read.
    """
    return _settleable_candidates(match)


def sole_suggestion(outcome: RowOutcome, match=None) -> Suggestion | None:
    """The one record to pre-select for this row, or `None` to pre-select nothing.

    ⚠️ IT TAKES THE OUTCOME, NOT JUST THE MATCH, AND THE GATE IS THE POINT. `derive_row_outcome`
    short-circuits on a duplicate, a failed transfer and an already-Paid record BEFORE it ever looks
    at candidates -- so a match result can hold perfectly good candidates for a row that was
    correctly Skipped. Deciding from the match alone would pre-select a record on a row nobody may
    settle. Only `Matched` yields a suggestion, and the caller cannot forget the gate because it is
    not the caller's to apply.

    ⚠️ IT READS THE SAME CANDIDATE LIST `_matched_note` COUNTS, on purpose. Before this existed the
    screen re-derived its own pre-selection from `payment_groups` -- ALL of them -- while the note
    counted `best_payment_group` plus expenses, so a row could read "One approved record at this
    amount" and still refuse to pre-select it. One list, one answer.

    ⚠️ EXACTLY ONE, OR NOTHING (owner ruling, re-affirmed 2026-08-06). Two approved records is an
    ambiguity and the screen never guesses between two real records. A FAN-OUT -- one transfer
    settling several payments -- returns `None` for the same reason from the other direction: there
    is no single record to name, and the shape of a `(doctype, name)` pair enforces that rather than
    trusting a caller to notice.
    """
    if outcome.status != ROW_MATCHED:
        return None

    candidates = _settleable_candidates(match)
    if len(candidates) != 1:
        return None

    only = candidates[0]
    targets = getattr(only, "targets", None)
    if targets is not None:
        if len(targets) != 1:
            return None
        return Suggestion(targets[0].doctype, targets[0].name)

    target = getattr(only, "target", None)
    if target is None:
        return None
    return Suggestion(target.doctype, target.name)


# How each tier reads to a reviewer. The tier is the reviewer's whole basis for trusting a
# suggestion -- "the bank account matches" and "the amount agrees and the remark names the project"
# are very different claims, and the person confirming the settlement is entitled to know which one
# they are being shown.
#
# ⚠️ AN UNKNOWN TIER ADDS NOTHING RATHER THAN GUESSING. `derive_row_outcome` reads the tier with
# `getattr`, so a match object that predates tiers (or a future tier nobody taught this map) yields
# an empty clause and the note is exactly what it always was, rather than a wrong explanation.
_TIER_CLAUSE = {
    "reference": "The bank reference is recorded on it.",
    "account+IFSC": "The transfer went to this vendor's bank account, and the amounts agree.",
    "project in remark": "The amounts agree and the remark names its project.",
}


def _matched_note(candidates: Sequence, tier: str = "") -> str:
    because = _TIER_CLAUSE.get(tier, "")
    if len(candidates) == 1:
        only = candidates[0]
        names = _name_list(only)
        targets = getattr(only, "targets", None)
        if targets and len(targets) > 1:
            return _joined(
                f"One transfer settling {len(targets)} approved payments: {names}.", because
            )
        return _joined(f"One approved record at this amount: {names}.", because)
    listed = ", ".join(_name_list(c) for c in candidates[:3])
    more = "" if len(candidates) <= 3 else f" and {len(candidates) - 3} more"
    return _joined(
        f"{len(candidates)} approved records match this amount: {listed}{more}.",
        because,
        "Choose which one this transfer settled.",
    )


def _joined(*sentences: str) -> str:
    return " ".join(s for s in sentences if s)


def _nothing_found_note() -> str:
    """The `Mismatched` note for the FOUND-NOTHING case.

    ⚠️ THIS SENTENCE IS NOW THE ONLY THING SEPARATING THE TWO CAUSES OF `Mismatched`, since the
    status merge took the chip away. It has to say what happened AND what to do about it, because
    the reader has nothing else to go on.
    """
    return (
        "No approved payment or expense matches this transfer. Record a new expense, or link one "
        "by hand."
    )


def several_found_note(count: int) -> str:
    """The `Mismatched` note for the THIRD cause: several records found, none chosen.

    ⚠️ `Mismatched` NOW CARRIES THREE FACTS, AND THE SENTENCES MUST NEVER CONVERGE. The merge that
    folded `Unmatched` in was allowed on the explicit condition that `outcome_note` keeps the causes
    apart, because the status no longer can:

        `_nothing_found_note`  nothing matched at all           -> record or link one
        `_delta_note`          already Paid, amounts disagree    -> a deduction such as TDS
        `several_found_note`   several matched, none chosen      -> pick which one

    ⚠️ THE FAILURE THIS PREVENTS IS SPECIFIC AND EXPENSIVE. Before the sweep that uses it, a row
    that found six approved records sat under `Matched` -- the tab meaning "this transfer has a
    record" -- carrying a note that read as a successful match. Moving it to `Not-Matched` without
    a note of its own would swing it to the opposite lie: "no approved payment or expense matches
    this transfer", said about a transfer that matched six. Both readings send the reviewer to
    create a duplicate expense for money that is already approved and waiting.
    """
    return (
        f"{count} approved records match this transfer and nothing could separate them. "
        f"Open the row and pick which one it settled."
    )


def _delta_note(bank_amount: Decimal, total: Decimal, group) -> str:
    delta = total - bank_amount
    if delta > 0:
        implied = (delta / total * 100) if total else Decimal("0")
        shortfall = (
            f"The bank paid {delta} less than the recorded total of {total} "
            f"({implied:.2f}% of it). A deduction such as TDS would look like this."
        )
    else:
        shortfall = (
            f"The bank paid {-delta} MORE than the recorded total of {total}. "
            f"More money left the account than any matched record claims."
        )
    return f"{shortfall} Already recorded as Paid on {_name_list(group)}."


def _name_list(candidate) -> str:
    """The record name(s) behind a group or a single candidate, as a reviewer would read them."""
    targets = getattr(candidate, "targets", None)
    if targets:
        return ", ".join(t.name for t in targets)
    target = getattr(candidate, "target", None)
    if target is not None:
        return target.name
    return getattr(candidate, "name", "") or "an unnamed record"


def _amount_of(row) -> Decimal:
    return getattr(row, "amount", Decimal("0")) or Decimal("0")


def _total_of(group) -> Decimal:
    total = getattr(group, "total_amount", None)
    if total is not None:
        return total
    return sum((t.amount for t in getattr(group, "targets", ())), Decimal("0"))


def derive_batch_status(row_statuses: Iterable[str]) -> str:
    """Derive a batch's status from its rows' statuses.

    ⚠️ THE `force_closed` PARAMETER IS GONE with `Completed with exceptions` (owner ruling). Closing
    a batch no longer changes what its status SAYS -- it records `closed_at` and nothing more, so a
    batch closed with rows outstanding still reads `Partially Settled`, which is the truth. The
    three tabs show the outstanding work directly, which is what the retired status was standing in
    for.
    """
    statuses = list(row_statuses)
    if not statuses:
        return BATCH_DRAFT

    # ⚠️ `active`, NOT `open`. A status in neither OPEN nor TERMINAL would make the branch below
    # fire on a batch full of unfinished work and report `Completed` -- and `batch_is_open` would
    # then drop that statement out of `match_period` forever. See `ACTIVE_ROW_STATUSES`.
    active_rows = [s for s in statuses if s in ACTIVE_ROW_STATUSES]
    # `banked` = money has landed, or a decision was taken. A partially allocated row qualifies:
    # some of its money HAS been written, which is precisely what `Partially Settled` means.
    banked_rows = [
        s
        for s in statuses
        if s in TERMINAL_ROW_STATUSES or s == ROW_PARTIALLY_ALLOCATED
    ]

    if not active_rows:
        return BATCH_COMPLETED
    if banked_rows:
        return BATCH_PARTIALLY_SETTLED
    return BATCH_IN_REVIEW


def batch_is_open(status: str | None) -> bool:
    """Has this statement still got work in it? (slice CF/S5)

    ⚠️ THIS IS THE WHOLE OF "AUTO-CLOSE", AND IT REVERSES NOTHING. The 2026-08-10 ruling deleted
    `close_batch` because it stamped `closed_at` / `closed_by` / `close_reason` and nothing read
    them -- a control that writes three fields nobody consults is worse than no control, because
    people reasonably assume it must do something. Those fields are still on the doctype, still
    never written, and MUST STAY THAT WAY.

    A batch closes ITSELF instead: `derive_batch_status` already returns `Completed` when no row is
    open, and `_refresh_batch_rollup` runs on every settle and every skip. So there is no field to
    add, no patch to write and no backfill -- a statement whose last transfer was settled a year ago
    already reads `Completed` today.

    ⚠️ EXCLUDING A COMPLETED BATCH FROM A RE-MATCH IS A COST FIX, NEVER A CORRECTNESS ONE, and
    saying so is what stops somebody later "improving" it into something that skips real work.
    `match_batch` already skips `_FROZEN_ROW_STATUSES` per row, so re-matching a finished statement
    was ALWAYS a no-op -- it just walked every row to discover that. What this changes is the time
    spent and the count reported, not the outcome.

    ⚠️ AN UNKNOWN OR MISSING STATUS IS OPEN. A batch whose rollup has never run carries no status,
    and treating that as finished would silently drop it from every re-match -- exactly the class of
    invisible exclusion this feature keeps having to fix. Failing towards "still has work" costs one
    wasted pass; failing the other way loses the work.
    """
    return (status or "").strip() != BATCH_COMPLETED


# --- did a settlement take the machine's pick? (slice Q1) ----------------------------------------

ORIGIN_ACCEPTED = "Suggestion accepted"
ORIGIN_OVERRIDDEN = "Suggestion overridden"
ORIGIN_NO_SUGGESTION = "No suggestion"


def settlement_origin(suggested_name, settled_name) -> str:
    """Did this settlement take the machine's suggestion? THE one definition.

    ⚠️ PURE, AND SHARED BY THREE CALLERS: the settle path (`api/outflow_import/expenses.py`), the
    summary aggregate, and the backfill patch that recovered 849 historical settlements. A second
    copy of this three-way test is how the history and the future come to disagree about one row.

    ⚠️ 'ACCEPTED', NEVER 'AUTO'. A human clicks confirm on every settlement this feature makes, so
    "the machine's pick was accepted" is true where "automatic" would not be. The distinction is
    the point of the field: it separates *the matcher found this* from *nobody checked it*.

    ⚠️ A BLANK SUGGESTION IS NOT A MISMATCHED ONE. A fan-out has no single suggestion by design
    (`sole_suggestion` abstains) and a row the matcher never touched has none either -- both are
    "the person found it", which is a different fact from "the person disagreed with us".
    Collapsing them would report every hand-found settlement as a disagreement with a machine that
    never spoke.

    ⚠️ IT LIVES HERE RATHER THAN IN `api/`, and it had to. `api/outflow_import/expenses.py` imports
    from `review.py`, so `review.py` importing back from `expenses.py` for the summary's count
    would be a cycle. This module is the deriver both may import -- api -> service is the one legal
    direction -- and the verdict is a derivation, which is what this file is for.
    """
    suggested = (suggested_name or "").strip()
    settled = (settled_name or "").strip()
    if not suggested:
        return ORIGIN_NO_SUGGESTION
    return ORIGIN_ACCEPTED if suggested == settled else ORIGIN_OVERRIDDEN


@dataclass(frozen=True)
class StatusTally:
    """One `row_status` group of an import, ALREADY AGGREGATED BY THE DATABASE.

    ⚠️ THE SHAPE IS THE POINT, AND IT IS WHY THIS IS NOT A LIST OF ROWS. A summary over a whole
    import is a count and a sum over many rows, and ADR-0010 puts those in the database -- one
    `GROUP BY`, not a `get_all` and a Python loop that gets slower every month the feature is used.
    So the endpoint aggregates and this module assembles. The deriver stays pure and unit-testable;
    the query stays a query.

    `with_suggestion` / `suggested_value` count and total the rows in this group carrying the match
    run's single pick. They are only ever non-zero for `Matched`, and they are what separates "the
    matcher was sure" from "the matcher found several and deliberately chose none" -- the split the
    bulk confirm is built on.

    ⚠️ `suggested_value` IS ITS OWN SUM, NOT A SHARE OF `value`. Apportioning the group's total by
    row count would invent a number: three matched rows of Rs 10, Rs 10 and Rs 90,000 where only the
    last is confirmable are not "two thirds of the value". The query sums the subset directly, which
    costs one more `CASE` in a query that was already grouping.

    ⚠️ `failed` SPLITS A GROUP THAT `row_status` CANNOT. A transfer the bank rejected is `Skipped`,
    and so is a duplicate, and so is a payment somebody ticked Paid by hand -- three different facts
    under one status. Only the first is money that NEVER LEFT THE ACCOUNT, and the owner ruled it out
    of every figure this summary reports. The query therefore groups by `(row_status, failed)` and
    hands over two tallies for one status where both kinds exist. This module stays ignorant of the
    bank's vocabulary: `parser.is_success_status` decides, in the query.
    """

    status: str
    count: int
    value: Decimal = Decimal("0")
    with_suggestion: int = 0
    suggested_value: Decimal = Decimal("0")
    failed: bool = False
    #: Settlements in this group that took the matcher's own pick (slice Q1).
    #
    # ⚠️ THIS IS NOT `with_suggestion`, AND THE TWO ANSWER DIFFERENT QUESTIONS. `with_suggestion`
    # counts rows that CARRY a pick and is only ever non-zero on `Matched` -- it describes work
    # waiting to be confirmed. This counts settlements where a person confirmed that pick
    # UNCHANGED, and is only ever non-zero on `Settled`. A row moves from one to the other by being
    # confirmed, so summing them would double-count the same transfer at two moments of its life.
    from_suggestion: int = 0
    #: The raw `Outflow Import Row.direction` -- `Debit`, `Credit`, or BLANK.
    #
    # ⚠️ IT DEFAULTS TO `""` SO EVERY PRE-SPLIT CALLER -- and every existing test -- keeps
    # constructing this tally positionally and lands, correctly, on the PAID side. That is the
    # same disposition `SettledLedgerEntry.direction` already took, for the same reason: a blank
    # direction is structurally incapable of having become a receipt, because
    # `settle.create_inflow_from_row` refuses anything that is not `Credit` at the write.
    #
    # ⚠️ THE GROUPED QUERY THEREFORE CUTS ON `(row_status, failed, direction)`. It is a plain
    # column on the row table, so nothing about `review._row_filters` changes to select it --
    # ONE query gains ONE group key, and the split can never be computed under a different WHERE
    # clause than the tab counts beside it.
    direction: str = ""


def derive_import_summary(tallies: Iterable[StatusTally]) -> dict:
    """Everything the summary section reports about ONE import.

    Counts AND money, per status, plus the four derived figures a reviewer actually reads.

    ⚠️ EVERY STATUS IS ZERO-FILLED, on purpose. A screen that renders only the statuses present
    reads as though the missing ones do not apply, when what they mean is "none of these, right
    now" -- and "Mismatched 0" is a genuinely useful thing to see, because it is the one that says
    the import is finished finding work.

    ⚠️ `open_value` IS SUMMED FROM THE OPEN STATUSES, NOT SUBTRACTED FROM THE TOTAL. Subtraction
    would be arithmetically identical while the statuses partition, and would silently go NEGATIVE
    the day one does not -- a legacy v2 value on an old row, say. Summing what is actually open
    cannot lie, and an unrecognised status simply falls out of both sets rather than corrupting one.

    ⚠️ AN UNKNOWN STATUS IS CARRIED, NOT DROPPED. It counts toward the totals and appears in
    `by_status` under its own name. Rows staged under v2 hold retired values, and a summary that
    quietly omitted them would report a total smaller than the import.

    ⚠️ A FAILED TRANSFER IS EXCLUDED FROM EVERY FIGURE HERE (owner ruling 2026-08-10, option B). It
    is money the bank refused to move, so counting it in `total_value` overstates the statement by
    exactly the amount that never left the account -- and counting it in `total_rows` makes
    `decided_percent` a percentage of work that does not exist. It comes back ONLY as
    `failed_rows` / `failed_value`, which the panel renders as a footnote.

    THE ROW IS STILL STAGED, and that is the whole of what option B chose over option A: the
    evidence that the bank rejected a transfer survives on the row, where a reviewer who goes
    looking can find it. What was removed is its effect on the numbers, not its existence.

    ⚠️ THESE TALLIES ARE EXCLUDED BEFORE `by_status` TOO. Leaving them in `by_status` while dropping
    them from the total would make the Skipped chip and the Statement total disagree by the failed
    count -- one visible number contradicting another on the same panel, which is worse than either
    choice made consistently.

    ⚠️ `sum(by_status counts) == total_rows` NO LONGER HOLDS, AND IS NOT THE INVARIANT ANY MORE.
    What holds instead, exactly:

        total_rows == open_rows + settled_rows

    `Skipped` is counted in `by_status` and reported as `skipped_rows` / `skipped_value`, but it is
    kept OUT of `total_rows` / `total_value` -- see `SUMMARY_EXCLUDED_STATUSES`. The reason is that
    most skipped rows are CROSS-BATCH DUPLICATES: a transfer that arrived in an earlier statement
    and was already counted there. Measured live: 544 of 640. Totalling them again reports the same
    money twice across two imports.

    ⚠️ `decided_rows` IS SETTLED ONLY, and had to change in the same edit. It used to be the sum
    over `TERMINAL_ROW_STATUSES`, which is Settled + Skipped; leaving it there while removing
    Skipped from `total_rows` would let `decided_percent` exceed 100 on a statement with more
    duplicates than settlements -- a percentage of a denominator its own numerator is not drawn
    from. Settled and open now partition the total, so the percentage is a real fraction again.

    ⚠️ THE TOTAL IS ALSO CUT BY DIRECTION, AND THE CUT PARTITIONS IT EXACTLY:

        paid_rows + received_rows == total_rows
        paid_value + received_value == total_value

    The panel showed ONE "Total transferred" tile summing both directions; the owner split it into
    "Total paid out" + "Total received". The two halves are accumulated inside the SAME branch that
    decides `total_*`, so both exclusions -- failed transfers and `SUMMARY_EXCLUDED_STATUSES` --
    apply to them identically and the tiles describe the population they replaced. Membership is
    `is_received_direction`, the ONE definition of the axis; a blank direction is Paid.

    ⚠️ AND SO IS **STILL OPEN**, ON THE SAME AXIS AND WITH THE SAME GUARANTEE:

        open_paid_rows + open_received_rows == open_rows
        open_paid_value + open_received_value == open_value

    This is the one figure the panel's two direction BANDS needed that nothing already sent. Each
    band reads Total (`paid_*` / `received_*`), Settled (its `derive_settled_direction_blocks`
    block) and Still open (these) -- three populations of ONE direction, which is what lets a band's
    three cards reconcile. `by_status` alone could not answer it: it is keyed by status, so both
    directions were already folded together by the time `open_rows` was summed from it.

    ⚠️ `TERMINAL_ROW_STATUSES` ITSELF IS UNTOUCHED, and must stay that way. `derive_batch_status`,
    `batch_is_open` and `review._FROZEN_ROW_STATUSES` all read it, and narrowing it to make this
    exclusion fall out for free would change which statements the "Re-run match" button touches.
    """
    by_status: dict[str, dict] = {
        status: {"count": 0, "value": Decimal("0")} for status in ROW_STATUSES
    }
    # ⚠️ THE SAME BUCKETS, CUT AGAIN BY DIRECTION -- and it exists because `by_status` CANNOT answer
    # the question. That dict is keyed by STATUS ALONE, so "how much of what is still open is money
    # out?" is unanswerable from it: `open_rows` is a sum over the open statuses, and every one of
    # those buckets has already folded both directions together.
    #
    # ⚠️ IT IS NOT ZERO-FILLED, AND IT DOES NOT NEED TO BE. Nothing renders this dict; the four
    # figures read off it are zero-filled by being SUMS, which are 0 over an empty selection. The
    # zero-fill on `by_status` exists so the CHIPS render a status that is absent -- a different job.
    by_status_direction: dict[tuple[str, bool], dict] = {}
    confirmable_rows = 0
    confirmable_value = Decimal("0")

    total_rows = 0
    total_value = Decimal("0")

    failed_rows = 0
    failed_value = Decimal("0")
    settled_from_suggestion = 0

    paid_rows = 0
    paid_value = Decimal("0")
    received_rows = 0
    received_value = Decimal("0")

    for tally in tallies:
        if tally.failed:
            failed_rows += tally.count
            failed_value += tally.value
            continue
        bucket = by_status.setdefault(
            tally.status, {"count": 0, "value": Decimal("0")}
        )
        bucket["count"] += tally.count
        bucket["value"] += tally.value
        # ⚠️ FILLED IN LOCKSTEP WITH THE BUCKET ABOVE, ON THE SAME SIDE OF THE `failed` `continue`
        # AND ABOVE THE SAME `SUMMARY_EXCLUDED_STATUSES` TEST. That is what makes the two agree: for
        # every status, the two direction buckets here sum EXACTLY to the one bucket above, so the
        # figures derived from them partition the figures derived from it. Moving this line -- past
        # the exclusion, or above the `continue` -- would ship halves that do not add up to the whole
        # they sit beside, which is the one number nobody thinks to doubt.
        #
        # Membership is `is_received_direction`, the ONE definition of the axis. A blank or
        # unrecognised direction is PAID, and it is a consequence rather than a guess -- see that
        # predicate.
        split_bucket = by_status_direction.setdefault(
            (tally.status, is_received_direction(tally.direction)),
            {"count": 0, "value": Decimal("0")},
        )
        split_bucket["count"] += tally.count
        split_bucket["value"] += tally.value
        # ⚠️ THE BUCKET IS FILLED FIRST, THEN THE TOTAL IS DECIDED. A `Skipped` tally still lands in
        # `by_status` -- the chip reads it -- and only the statement TOTALS skip it. Reordering
        # these two so the exclusion `continue`s past the bucket would blank the Skipped chip, which
        # is the opposite of what the ruling asked for.
        if tally.status not in SUMMARY_EXCLUDED_STATUSES:
            total_rows += tally.count
            total_value += tally.value
            # ⚠️ THE SPLIT SITS INSIDE THIS EXACT BRANCH, AND THAT IS WHAT MAKES IT A PARTITION.
            # Both exclusions above it -- the `failed` `continue` and `SUMMARY_EXCLUDED_STATUSES`
            # -- therefore apply to the two halves identically, so the tiles are drawn from the
            # same population as the one figure they replace. Moving either line out of this
            # branch would ship two tiles that sum to something other than the total beside them.
            if is_received_direction(tally.direction):
                received_rows += tally.count
                received_value += tally.value
            else:
                paid_rows += tally.count
                paid_value += tally.value
        if tally.status == ROW_MATCHED:
            confirmable_rows += tally.with_suggestion
            confirmable_value += tally.suggested_value
        if tally.status == ROW_SETTLED:
            settled_from_suggestion += tally.from_suggestion

    def rows(status: str) -> int:
        return by_status.get(status, {}).get("count", 0)

    def value(status: str) -> Decimal:
        return by_status.get(status, {}).get("value", Decimal("0"))

    # ⚠️ ACTIVE, NOT OPEN -- a partially allocated row's money is NOT settled, so it must stay in
    # the "still open" figure or the summary panel's `Total = Settled + Still open` band silently
    # stops adding up. `settled_rows + open_rows == total_rows` is the invariant being preserved.
    open_rows = sum(rows(s) for s in ACTIVE_ROW_STATUSES)
    open_value = sum((value(s) for s in ACTIVE_ROW_STATUSES), Decimal("0"))

    def open_side(received: bool) -> tuple[int, Decimal]:
        """One direction's share of what is still open.

        ⚠️ SUMMED FROM THE OPEN STATUSES, NEVER SUBTRACTED FROM ANYTHING -- the same rule
        `open_value` above states in full, applied to the halves. Subtracting the received half from
        `open_value` would be arithmetically identical while the two partition, and would go
        silently NEGATIVE the day they did not. Summing what is actually open on this side cannot
        lie, and an unrecognised status falls out of both halves exactly as it falls out of
        `open_rows`.

        ⚠️ IT WALKS THE SAME `ACTIVE_ROW_STATUSES` SET, so the halves inherit every exclusion the
        whole already has: a failed transfer never reached the dict, and `Skipped` is terminal and
        so is absent from the set. `SUMMARY_EXCLUDED_STATUSES` therefore needs no second mention
        here -- stating it again would be a second rule to keep in step with the first.
        """
        selected = [
            bucket
            for (status, is_received), bucket in by_status_direction.items()
            if status in ACTIVE_ROW_STATUSES and is_received == received
        ]
        return (
            sum(bucket["count"] for bucket in selected),
            sum((bucket["value"] for bucket in selected), Decimal("0")),
        )

    open_paid_rows, open_paid_value = open_side(False)
    open_received_rows, open_received_value = open_side(True)
    # ⚠️ SETTLED ONLY -- NOT `TERMINAL_ROW_STATUSES`, which also holds `Skipped`. Skipped rows are no
    # longer in `total_rows`, so counting them here would divide by a denominator they are absent
    # from and let `decided_percent` run past 100. `settled_rows + open_rows == total_rows` exactly.
    decided_rows = rows(ROW_SETTLED)

    return {
        "total_rows": total_rows,
        "total_value": total_value,
        # The statement total CUT BY DIRECTION -- the two tiles that replaced one "Total
        # transferred" (owner ruling). Money out and money in are different facts, and a single
        # figure summing both is "money out plus money in added together", which means nothing.
        #
        # ⚠️ THEY PARTITION THE TOTAL, EXACTLY:
        #
        #     paid_rows + received_rows == total_rows
        #     paid_value + received_value == total_value
        #
        # on EVERY input, and that is the whole reason the split is safe to render beside figures
        # derived from the total. It follows from `is_received_direction` being a single POSITIVE
        # test -- every row is `Credit` or it is not, there is no third answer -- and from the two
        # accumulations sitting inside the one branch that decides the total.
        #
        # ⚠️ A BLANK OR UNRECOGNISED DIRECTION IS PAID, and it is a consequence rather than a
        # guess: `settle.create_inflow_from_row` refuses anything that is not `Credit` at the
        # write, so such a row is structurally incapable of being a receipt.
        #
        # ⚠️ THIS IS NOT `derive_settled_direction_blocks`, WHICH CUTS THE SAME AXIS OVER A
        # DIFFERENT POPULATION -- SETTLED rows only, broken down by ledger. These two are the
        # WHOLE statement. Two keys totalling the same money would be two chances to disagree;
        # these deliberately total DIFFERENT money, and the naming has to keep saying so.
        "paid_rows": paid_rows,
        "paid_value": paid_value,
        "received_rows": received_rows,
        "received_value": received_value,
        "by_status": by_status,
        "open_rows": open_rows,
        # The number a reviewer is actually asking for: how much of this statement is still
        # unaccounted for. It is the one figure that says whether the import is finished.
        "open_value": open_value,
        # STILL OPEN, CUT BY DIRECTION -- the third figure each of the panel's two direction bands
        # needs, and the ONLY genuinely new number the band layout required.
        #
        # ⚠️ THEY PARTITION `open_rows` / `open_value`, EXACTLY:
        #
        #     open_paid_rows + open_received_rows == open_rows
        #     open_paid_value + open_received_value == open_value
        #
        # on EVERY input, for the same two reasons the paid/received totals partition the statement
        # total: `is_received_direction` is a single POSITIVE test with no third answer, and the two
        # direction buckets are filled in the same branch as the status bucket they are cut from.
        #
        # ⚠️ THEY ARE A CUT OF **OPEN**, NOT OF THE STATEMENT. `paid_value` is every row the panel
        # counts whatever its status; this is only what somebody still owes a decision on. A band on
        # the panel reads `Total` = `paid_value`, `Settled` = the `settled_by_direction` block, and
        # `Still open` = these -- three figures over three different populations of the same
        # direction, which is exactly why the band adds up.
        #
        # ⚠️ AND THE SETTLED HALF IS DELIBERATELY ABSENT FROM HERE. `derive_settled_direction_blocks`
        # already computes it, WITH the per-ledger lines the panel renders, and two keys totalling
        # the same money are two chances to disagree about it.
        "open_paid_rows": open_paid_rows,
        "open_paid_value": open_paid_value,
        "open_received_rows": open_received_rows,
        "open_received_value": open_received_value,
        "decided_rows": decided_rows,
        "decided_percent": (
            0.0 if total_rows == 0 else round(decided_rows / total_rows * 100, 1)
        ),
        "settled_rows": rows(ROW_SETTLED),
        "settled_value": value(ROW_SETTLED),
        # ⚠️ HOW MANY SETTLEMENTS THE MATCHER ACTUALLY FOUND (slice Q1). Until then nothing on this
        # screen could answer it: `Outflow Row Match.match_basis` was hardcoded to "Manual" on every
        # settlement, so the money record claimed a person had found all 849 when the machine had
        # found 843. The remainder -- `settled_rows - settled_from_suggestion` -- is the hand-found
        # count, and is deliberately NOT reported as its own key: two numbers that must sum to a
        # third are two chances to disagree with it.
        "settled_from_suggestion": settled_from_suggestion,
        "skipped_rows": rows(ROW_SKIPPED),
        "skipped_value": value(ROW_SKIPPED),
        # ⚠️ REPORTED BESIDE THE TOTALS, NOT INSIDE THEM. A failed transfer is excluded from every
        # figure above; these two are the only place it is visible after import, and they are what
        # stops option B from becoming option A by accident. If the panel ever drops this line, a
        # rejected transfer stops being merely out of the way and becomes invisible.
        "failed_rows": failed_rows,
        "failed_value": failed_value,
        "matched_rows": rows(ROW_MATCHED),
        "matched_value": value(ROW_MATCHED),
        # ⚠️ `unmatched_rows` / `unmatched_value` ARE GONE WITH THE STATUS (owner ruling
        # 2026-08-10), and `mismatched_*` ABSORBED THEM. It used to be the rare figure -- a payment
        # hand-ticked Paid that disagrees on amount, 0 on almost every import -- and is now the
        # PRODUCTIVE one, carrying most of a statement's work. Any screen still reading
        # `unmatched_rows` gets `None`, which is the intended loud failure: silently reporting 0
        # transfers needing a person would be far worse.
        "mismatched_rows": rows(ROW_MISMATCHED),
        "mismatched_value": value(ROW_MISMATCHED),
        "pending_rows": rows(ROW_PENDING_MATCH),
        "error_rows": rows(ROW_ERROR),
        # What "Confirm all matched" can actually act on, and what it cannot.
        "confirmable_rows": confirmable_rows,
        "confirmable_value": confirmable_value,
        "ambiguous_rows": max(rows(ROW_MATCHED) - confirmable_rows, 0),
    }


# The slot every ledger outside the three falls into. A LABEL, not a doctype -- nothing settles
# into a book called "Other"; it is where an unrecognised `target_doctype` is made visible rather
# than silently dropped.
SETTLED_LEDGER_OTHER = "Other"


@dataclass(frozen=True)
class SettledLedgerEntry:
    """One `target_doctype` group of the settled rows, ALREADY AGGREGATED BY THE DATABASE.

    Same shape and same reasoning as `StatusTally`: a count and a sum over many rows belongs in one
    `GROUP BY` (ADR-0010), so the endpoint aggregates and this module assembles. The deriver stays
    pure and unit-testable; the query stays a query.

    `ledger` is the raw `target_doctype` off `ledgers.SETTLED_LEDGER_SQL` -- unnormalised, and
    possibly blank or unrecognised on a row whose match record is missing or points somewhere
    unexpected. Deciding what to do with that is this module's job, not the query's.

    `direction` is the raw `Outflow Import Row.direction` -- `Debit`, `Credit`, or BLANK. It is the
    axis the two settled blocks are cut on (slice B8b), and it comes off the ROW rather than being
    guessed from `ledger`, because the ledger genuinely cannot answer it: a non-project RECEIPT is
    stored as a NEGATIVE `Non Project Expense` (B7), so that one doctype appears on BOTH sides.
    It defaults to `""` so every pre-B8b caller -- and every existing test -- keeps constructing
    this entry positionally with three arguments and lands, correctly, on the paid side.
    """

    ledger: str
    count: int
    value: Decimal = Decimal("0")
    direction: str = ""


def derive_settled_ledger_split(
    entries: Iterable[SettledLedgerEntry],
    ledgers: Sequence[str] = LEDGER_DOCTYPES,
) -> list[dict]:
    """The settled rows broken down by the ledger the money actually landed in.

    ⚠️ `ledgers` IS A PARAMETER SO THAT THE TWO BLOCKS OF THE B8b PANEL SHARE **ONE** IMPLEMENTATION
    of ordering, zero-filling and the `Other` slot. The received block holds different books from
    the paid one (`ledgers.RECEIVED_LEDGER_DOCTYPES` vs `LEDGER_DOCTYPES` -- a credit can never be
    a `Project Payment`), and the alternative was a second copy of this function differing only in
    which tuple it walks. The DEFAULT is `LEDGER_DOCTYPES`, so every pre-B8b caller is
    byte-identical and the fixed-order rule below still governs them both.

    ⚠️ THE ORDER IS FIXED AND IS NEVER SORTED BY VALUE. It is `ledgers.LEDGER_DOCTYPES` order --
    Project Payments, Project Expenses, Non Project Expenses -- which is the order a reviewer meets
    the three books. Sorting by value would rearrange the panel between statements, so the same
    figure sits in a different place each time it is read and nothing is comparable at a glance.

    ⚠️ ALL THREE ARE ZERO-FILLED, for the reason `derive_import_summary` already gives about
    statuses: a panel that renders only the ledgers present reads as though the missing ones do not
    apply, when what they mean is "nothing settled here, this time". "Non Project Expenses 0" is a
    useful cell -- it says the statement touched only the other two books.

    ⚠️ THE THREE NAMES ARE BOUND FROM `ledgers.LEDGER_DOCTYPES`, NEVER SPELLED HERE. A private copy
    would be free to drift from the list `candidates.py` offers from and `settle.py` writes to, and
    the symptom is a breakdown that silently omits a book the import had just settled into.

    ⚠️ `Other` IS AN ANOMALY SLOT, NOT A CATEGORY, WHICH IS WHY IT IS INCLUDED ONLY WHEN NON-ZERO.
    Live data has 0. Zero-filling it like the real three would put a permanent empty row on the
    panel inviting the question "what is Other?", every time, for a case that should never occur;
    rendering it when it DOES occur is how an unrecognised `target_doctype` becomes visible instead
    of vanishing from a breakdown that would then no longer add up to `settled_rows`. Blank and
    whitespace-only ledgers fold in here too -- a settled row whose match record could not be read
    is exactly the fact worth surfacing.

    Everything is summed as `Decimal`, never float: these are money figures and the summary they sit
    beside is `Decimal` throughout.
    """
    order = tuple(ledgers)
    buckets: dict[str, dict] = {
        ledger: {"ledger": ledger, "rows": 0, "value": Decimal("0")} for ledger in order
    }
    other = {"ledger": SETTLED_LEDGER_OTHER, "rows": 0, "value": Decimal("0")}

    for entry in entries:
        bucket = buckets.get((entry.ledger or "").strip(), other)
        bucket["rows"] += entry.count
        bucket["value"] += entry.value

    split = [buckets[ledger] for ledger in order]
    if other["rows"]:
        split.append(other)
    return split


# --- which way did the money go? (slice B8b) ------------------------------------------------------

# The one `Outflow Import Row.direction` value that means money ARRIVED. The doctype's Select offers
# exactly `"" | Debit | Credit`.
#
# ⚠️ SPELLED HERE RATHER THAN IMPORTED FROM `parser` OR `settle`, on the precedent
# `settle.DIRECTION_CREDIT` already set for the identical reason: `settle.py` imports `frappe`, and
# this module's stated property is that it stays callable from a plain unittest with no bench and no
# fixtures. `test_status` pins this against `parser.DIRECTION_CREDIT` (also bench-free), so a rename
# cannot reach only one of them.
ROW_DIRECTION_CREDIT = "Credit"

# The two blocks, as a reviewer reads them. LABELS, and the panel renders them verbatim -- exactly
# as it renders `ledger` verbatim -- so the wording of the split has ONE owner and the client cannot
# invent a third name for a side.
SETTLED_BLOCK_RECEIVED = "Received"
SETTLED_BLOCK_PAID = "Paid"


def is_received_direction(direction: str | None) -> bool:
    """Did this transfer bring money IN? THE one definition of the axis (slice B8b).

    ⚠️ IT IS A SINGLE **POSITIVE** TEST, AND THAT IS WHAT MAKES THE TWO BLOCKS A PARTITION. Every
    settled row is `Credit` or it is not; there is no third answer, so no row can land in neither
    block. The failure mode this shape rules out is a figure that appears in NEITHER total -- money
    that is settled, visible in `settled_value`, and missing from both breakdowns beside it.

    ⚠️ A BLANK DIRECTION IS **PAID**, AND IT IS A CONSEQUENCE RATHER THAN A GUESS. The receipt paths
    refuse anything that is not `Credit` at the WRITE -- `settle.create_inflow_from_row` throws
    `InflowNotRecordableError` naming "a transfer with no stated direction" -- so a blank-direction
    row is structurally incapable of having become a receipt. Calling it received would put a row in
    a block it could not have reached; calling it paid states what it is, which on live data is all
    809 staged rows (every one `Debit`, 0 blank, 0 credit as of 2026-09-07). Blanks are real
    nonetheless: `parser` leaves direction blank on a bank line with BOTH money columns populated
    (it refuses to guess), and on a Cashbook top-up whose `Debit` cell is empty.

    ⚠️ AN UNRECOGNISED VALUE IS PAID TOO, for the same reason and by the same branch. There is no
    `Other` slot on this axis -- the owner ruled TWO blocks -- so falling to the side that cannot
    lie about a receipt is the only disposition that keeps both totals complete.
    """
    return (direction or "").strip() == ROW_DIRECTION_CREDIT


def derive_settled_direction_blocks(
    entries: Iterable[SettledLedgerEntry],
) -> list[dict]:
    """The settled money as TWO blocks -- Paid and Received -- each with its OWN total (B8b).

    ⚠️ NEVER NETTED (owner ruling Q14, option a). A single figure would hide both halves; folding
    receipts into the paid total would make one number "money out plus money in added together",
    which means nothing; and dropping receipts would make the money this screen ingested invisible
    on the screen that ingested it.

    ⚠️ EACH BLOCK'S TOTAL IS THE SUM OF THE LINES IT RENDERS, so the reconciliation is EXACT BY
    CONSTRUCTION rather than by two numbers agreeing. It is computed from the split this function
    just built -- including its `Other` slot -- so there is no arrangement of input entries under
    which a block's lines can fail to add up to the figure above them. That is strictly stronger
    than the pre-B8b guarantee, which was one query's sum reconciling to a DIFFERENT query's
    `settled_value`. That cross-check survives as `received.value + paid.value == settled_value`,
    which the endpoint's tests assert against a real batch.

    ⚠️ THE PAID BLOCK IS ALWAYS PRESENT, ZERO-FILLED; THE RECEIVED BLOCK ONLY WHEN IT HOLDS ROWS.
    The asymmetry is deliberate and the two halves have different reasons:

      * Paid is the successor of the single `Settled` tile, whose zero-fill is load-bearing -- "0
        settled" is exactly the fact a reviewer needs when nothing has been settled yet, and
        suppressing it would take the settled figure off the panel entirely.
      * Received is suppressed when empty on the `SETTLED_LEDGER_OTHER` reasoning, only stronger.
        Cashfree and Cashbook are SINGLE-DIRECTION sources: they cannot produce a credit, ever. A
        zero-filled received block on those imports would be a permanent empty heading over two
        zero ledger lines, on every panel, for something that cannot occur -- and it would change
        how every existing import renders. Suppressed, a gateway import looks exactly as it does
        today.

    ⚠️ RECEIVED IS **APPENDED**, NOT PREPENDED, so the paid block never moves. This is the fixed-
    order rule of `derive_settled_ledger_split` applied one level up: a block whose position depends
    on whether some other block exists has to be re-found every time the period changes. It is also
    what `SETTLED_LEDGER_OTHER` already does with the one conditional bucket it owns. The owner's
    ruling names the blocks "Received and Paid"; that is what they ARE, not the order they sit in.

    ⚠️ NOTHING HERE ORDERS, ZERO-FILLS OR TOTALS A LEDGER LIST -- `derive_settled_ledger_split` does
    all three, called once per block with that block's own `ledgers` order. A second copy differing
    only in which tuple it walks is how one of them would come to be missing a book.
    """
    received_entries: list[SettledLedgerEntry] = []
    paid_entries: list[SettledLedgerEntry] = []
    for entry in entries:
        target = received_entries if is_received_direction(entry.direction) else paid_entries
        target.append(entry)

    paid = _settled_block(SETTLED_BLOCK_PAID, paid_entries, LEDGER_DOCTYPES)
    received = _settled_block(SETTLED_BLOCK_RECEIVED, received_entries, RECEIVED_LEDGER_DOCTYPES)
    return [paid, received] if received["rows"] else [paid]


def _settled_block(direction: str, entries: Sequence[SettledLedgerEntry], ledgers) -> dict:
    """One block: its ledger lines, and the total THOSE LINES add up to.

    The total is summed from `split`, never from `entries`, and the difference is the whole point:
    summing the input would produce a figure the rendered lines could disagree with the day an entry
    stopped reaching a bucket. Summing the output cannot.
    """
    split = derive_settled_ledger_split(entries, ledgers)
    return {
        "direction": direction,
        "rows": sum(bucket["rows"] for bucket in split),
        "value": sum((bucket["value"] for bucket in split), Decimal("0")),
        "ledgers": split,
    }


def derive_batch_counters(row_statuses: Sequence[str]) -> dict:
    """The denormalised counters on the batch. Derived here so the list page and the review screen
    can never disagree about how much of a batch is done.

    ⚠️ `reconciled_rows` and `exception_rows` were REMOVED with the statuses they counted (owner
    ruling: remove the dead fields). Every key here still maps to a live field on
    `Outflow Import Batch`; adding one without adding the field would write nothing and report
    nothing, silently.
    """
    statuses = list(row_statuses)
    return {
        "total_rows": len(statuses),
        "reviewed_rows": sum(1 for s in statuses if s != ROW_PENDING_MATCH),
        "settled_rows": sum(1 for s in statuses if s == ROW_SETTLED),
        "skipped_rows": sum(1 for s in statuses if s == ROW_SKIPPED),
        "error_rows": sum(1 for s in statuses if s == ROW_ERROR),
    }
