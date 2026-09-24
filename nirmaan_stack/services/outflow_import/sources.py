# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What a STATEMENT SOURCE can do (Bulk Import Outflow, slice B4).

A pure leaf. It imports nothing -- not from this package, not from Frappe -- so it stays callable
from a plain unittest, and so that both the UPLOAD path and the MATCH path can read the same answer
without either of them importing the other.

⚠️ IT EXISTS BECAUSE THE QUESTION HAD TWO CALLERS AND ONE OF THEM HAD NOWHERE TO ASK IT. Until
slice B4 the set lived as `upload._BANK_STATEMENT_SOURCES`, which was fine while staging was the
only thing that cared. `review.match_batch` now has to ask the same question -- and an `api` module
may not import another `api` module's private constant, so the alternatives were a second literal
frozenset (two definitions of one fact, free to drift on the day a source is added) or this. The
set moved DOWN to the layer both sides may import; `api` -> `services` is the one legal direction,
and `upload` reads it straight back under its old private name so no call site changed.

⚠️ SOURCE CAPABILITIES ARE NAMED QUESTIONS, NOT A MEMBERSHIP TEST SPELLED OUT AT EACH CALL SITE.
`source_has_settlement_path(source)` says what the caller actually wants to know. Reading
`source in BANK_STATEMENT_SOURCES` at a match-run call site would work today and would say nothing
about WHY the run behaves differently -- and the next reader would have no way to tell a deliberate
capability gate from an incidental one.

⚠️ THIS IS A DIFFERENT SET FROM `duplicates.WIDE_IDENTITY_SOURCES` AND THEY MUST NOT BE MERGED
"because they hold the same string today". That one answers "what makes two lines of this statement
the same line?"; this one answers "what can this statement's rows DO?". A source could plausibly
need the wide identity without being a passbook, or the reverse.
"""

__all__ = [
    "BANK_STATEMENT_SOURCES",
    "NEVER_MATCHED_SOURCES",
    "TRANSFER_ID_REFERENCE_SOURCES",
    "source_has_settlement_path",
    "source_runs_the_matcher",
    "source_has_preamble",
    "source_names_its_spender",
    "source_transfer_id_is_its_reference",
    "source_writes_its_match_surface",
]

#: Sources that are a BANK PASSBOOK rather than a payout gateway.
#:
#: Four things follow from membership, and they are one decision rather than four: the statement
#: states a DIRECTION per row, its non-spending lines are EXCLUDED at stage time
#: (`services/outflow_import/bank_exclusions`), what survives exclusion lands `Mismatched` for a
#: person instead of `Pending match run` (owner ruling Q31), and the match run offers it NO
#: settlement candidate at all (owner ruling Q31/Q31a, slice B4).
#:
#: ⚠️ THE STRINGS ARE `parser.SUPPORTED_SOURCES` MEMBERS, VERBATIM, AND THEY ARE ALSO THE
#: `Outflow Import Batch.source` SELECT OPTIONS. `upload._read_and_parse` validates the posted
#: source against `SUPPORTED_SOURCES` and `_stage_batch` writes it straight into that Select, so all
#: three are the same one string; a rename has to move all three together or every upload of that
#: source fails Frappe's own Select validation with nothing on screen explaining why. `test_upload`
#: pins this set against both, and `test_review` pins the match run's reading of it.
BANK_STATEMENT_SOURCES = frozenset({"ICICI Bank Statement"})

#: Sources whose OWN transfer id is the only reference they will ever have.
#:
#: A petty-cash wallet issues no UTR and no gateway reference: `parser._CASHBOOK_COLUMNS` maps
#: neither `bank_reference_no` nor `reference_id`, deliberately and permanently. Its `Txn Id` is
#: therefore the only thing on the row an accountant can reconcile a settled record against, and
#: `settlement_reference.resolve_settlement_reference` reads this set to say so.
#:
#: ⚠️ THIS IS THE THIRD RUNG OF THE LADDER AND IT IS PER-SOURCE ON PURPOSE (ADR-0020 B9). A gateway
#: HAS a `transfer_id` too, and it is not a settlement reference -- widening the fallback to every
#: source would stamp one onto 2,237 Cashfree rows nobody asked for. Keeping the rung here, at the
#: ONE resolution, is also what stops it being re-derived at a write site: the whole point of
#: resolving once is that every write site reads one field and no path can diverge from another.
TRANSFER_ID_REFERENCE_SOURCES = frozenset({"Cashbook"})

#: Sources whose rows the match run must never reach (#1272).
#:
#: ⚠️ A DIFFERENT SET FROM `TRANSFER_ID_REFERENCE_SOURCES`, holding the same string today. That one
#: answers "which reference does a settle store?"; this one answers "may the matcher write to these
#: rows at all?". Do not merge them.
NEVER_MATCHED_SOURCES = frozenset({"Cashbook"})


def source_has_settlement_path(source: str) -> bool:
    """Can a row from this source ever be offered an existing record to SETTLE?

    `True` for a payout gateway (Cashfree): its export names transfers that were made against
    records already sitting in a ledger `Approved`, so the tier ladder has something to find.

    `False` for a bank passbook. THE MEASUREMENT, so nobody re-derives it (slice B4, 711 real
    debits of one ICICI statement):

      * TIER 1 IS STRUCTURALLY UNREACHABLE. `matcher.account_ifsc_vendors` is the tier-1 population
        and `ifsc_matches` is only ever set inside the `index.by_account` loop, so an IFSC alone can
        never set it -- and an ICICI narration carries no beneficiary account number at all.
      * TIER 0 CANNOT SETTLE. `Project Payments.utr` is written at FULFILMENT, so every UTR belongs
        to an already-`Paid` payment, while `ledgers.SETTLEABLE_STATUSES` is `Approved`-only.
        Measured DB-wide: 7,643 of 7,644 `Paid` payments carry a UTR; 0 of 1 `Approved`, 0 of 131
        `CEO Pending`, 0 of 24 `Requested` do. The pool is empty by construction, and `candidates.py`
        already records the same observation.
      * TIER 2 FIRES ZERO TIMES, AND ITS SEVEN NEAR-MISSES ARE ALL FALSE POSITIVES.
        `CLG/MR SAYED ALI/SBI` resolves to a project literally named `SBI` -- but in a `CLG/`
        narration that segment is the cheque DRAWEE BANK CODE, which `parser._ICICI_DRAWEE_BANK_CODE`
        documents as such. `CLG/XINERGY INNOVATION/PNB` matches "Schneider Innovation" off the
        PAYEE's name. Against an all-status pool of 11,128 records treated as if everything were
        Approved, the amount agrees on 497 rows (69.9%) and the full tier-2 predicate is STILL 0 --
        the PROJECT axis is dead, not the pool.

    ⚠️ THE DISABLE IS STRUCTURAL, NOT INCIDENTAL, AND THAT DISTINCTION IS THE WHOLE SLICE. "Tier 2
    never fires" is a property of today's data; "tier 2 cannot fire" is a property of the code. Only
    the second is safe: left enabled, those seven rows would auto-suggest settling Rs 1.15 lakh
    against an unrelated project through a bank code, inside the +/- Rs 5 window. `review.match_batch`
    therefore takes a DIFFERENT PATH for a source that answers `False` -- it never loads a settlement
    pool and never calls `match_row` -- rather than filtering candidates back out afterwards.

    ⚠️ IT DOES **NOT** MEAN "THE MATCH RUN MUST NOT TOUCH THESE ROWS". The already-recorded-as-Paid
    DUPLICATE GUARD is KEPT (owner ruling Q31a; it catches 41 of those 711 rows), and that guard
    lives in the match run. A reader who took this as "skip the source entirely" would silently
    delete it, and 41 transfers a fortnight would arrive as ordinary work that can be booked twice.

    ⚠️ AN UNKNOWN OR BLANK SOURCE ANSWERS `True`, AND THE DIRECTION OF THAT DEFAULT IS DELIBERATE.
    It keeps every gateway import -- including a legacy row staged before `source` was denormalised
    onto rows at all -- on the path it has always been on. A new source is opted IN to the settlement
    ladder by being absent here, which is the same default `upload` has used since slice B3; the day
    a second passbook lands, adding its string here is the whole change.
    """
    return (source or "").strip() not in BANK_STATEMENT_SOURCES


def source_runs_the_matcher(source: str) -> bool:
    """May a match run -- whole-batch or one line -- write to this source's rows? (#1272)

    `False` for the petty-cash wallet (Cashbook). Its rows carry the PLAN its own job writes from
    (`suggested_doctype`, `resolved_project`), and they sit `Pending match run` until that job runs.
    A match run clears every suggestion it does not re-find, so reaching one would erase the plan --
    and the tier ladder could only ever find an approved payment that happens to share an amount
    (see `api/outflow_import/cashbook.py`). The Cashbook import never called `match_batch`, but
    nothing stopped `match_period` from reaching an open Cashbook batch until this gate.

    `True` for everything else, a blank or unknown source included: the same default
    `source_has_settlement_path` takes, so every existing import stays on the path it is on.
    """
    return (source or "").strip() not in NEVER_MATCHED_SOURCES


#: Sources whose statement NAMES WHO SPENT the money, in its own `From` column (`added_by_raw`).
#:
#: ⚠️ A THIRD SET HOLDING "Cashbook", AND NOT TO BE MERGED WITH THE OTHER TWO. This one answers "who
#: goes in an expense's Paid by?"; a Cashfree export's `Added By` names the accountant who queued the
#: transfer, never a spender, so it keeps the actor.
SPENDER_NAMED_SOURCES = frozenset({"Cashbook"})


def source_names_its_spender(source: str) -> bool:
    """Does a Create from this source's line take Paid by from the statement? (#1314, trap 4)

    `True` for the petty-cash wallet: each line was spent by the person in its `From` column, and the
    Cashbook job has always written that (`cashbook._write_one`). A reopened Cashbook line created by
    hand must write the same, or a hand-created wallet expense claims the accountant made the purchase.

    ⚠️ AN UNKNOWN OR BLANK SOURCE ANSWERS `False`: the Paid by stays the person recording it, as it
    always has.
    """
    return (source or "").strip() in SPENDER_NAMED_SOURCES


def source_transfer_id_is_its_reference(source: str) -> bool:
    """Is this source's own transfer id the only reference it will ever have?

    `True` for the petty-cash wallet (Cashbook). It issues no UTR and the export carries no gateway
    reference column, so its `Txn Id` is the last rung of the settlement-reference ladder rather
    than a fourth identifier nobody reconciles against. All 222 of its settled expenses already
    carry it -- the expense path had been passing it by hand, which is exactly the per-path remedy
    ADR-0020 B9 replaces with one resolution at ingest.

    `False` for a payout gateway and for a bank passbook. Both have a real reference of their own,
    and a gateway `transfer_id` written into `Project Payments.utr` would be a fourth kind of
    non-bank string in a column that already holds hundreds.

    ⚠️ AN UNKNOWN OR BLANK SOURCE ANSWERS `False`, AND THE DIRECTION OF THAT DEFAULT IS THE
    OPPOSITE OF `source_has_settlement_path`'S -- deliberately, because the two defaults protect
    different things. That one keeps an unrecognised source on the path it has always been on.
    This one declines to WRITE a value into the ledger on a source nobody has thought about yet:
    such a row lands exactly where it lands today, blank and visibly so, instead of carrying an
    identifier whose meaning nobody has established.
    """
    return (source or "").strip() in TRANSFER_ID_REFERENCE_SOURCES


def source_has_preamble(source: str) -> bool:
    """Does this source's export WRAP its table in rows that are not part of the table?

    `True` for a bank passbook. ICICI's Detailed Statement opens with sixteen account-info lines
    (`Name:`, `A/C No:`, `Transaction Date from:`) before the header row, and closes with a blank
    line, a five-line balances block and thirty `Legends Used in Account Statement` lines. Measured
    on a real 1,450-row export: the header is row 17 and the transactions are rows 18-1412.

    `False` for a payout gateway. Cashfree and Cashbook write the header on row 1 and nothing after
    the last transfer, which is why both have always parsed with the table hard-coded to start
    there.

    ⚠️ MEMBERSHIP DECIDES TWO QUESTIONS, AND THEY ARE ONE DECISION RATHER THAN TWO. A source that
    answers `True` has its header row SEARCHED FOR (the first row carrying every required column)
    and its table ENDED at the first wholly blank row below it. A source that answers `False` keeps
    both halves of today's behaviour exactly: the header is row 1, and a blank row is SKIPPED rather
    than treated as the end.

    ⚠️ A UNIVERSAL END-RULE WAS CONSIDERED AND REJECTED, AND THE REASON IS THE WORST FAILURE CLASS
    IN THIS MODULE. Today a blank row anywhere in a gateway export is simply skipped -- so making
    "first blank row ends the table" universal would SILENTLY TRUNCATE any Cashfree or Cashbook
    sheet that carries one, and the import would look entirely successful with the tail of the
    statement missing. Cashfree (16 batches) and Cashbook (2) carry live settled data. The gate is
    what keeps them byte-identical, and it is load-bearing rather than decoration.

    ⚠️ THE END-RULE EXISTS BECAUSE THE TRAILER IS NOT INERT. Four of the five balance lines put
    their FIGURE in column B, which on this statement is the `Tran. Id` column -- so a table read to
    the end of the sheet stages them as transfers with ids like `-4,87,90,566.06`. Measured on a
    real 145-row export: 94 rows read where 90 are real. The `Legends` lines are harmless by
    accident (column A only, so a blank `Tran. Id` already drops them), which is exactly why the
    blank-row rule is the guard and "drop rows that look wrong" is not.

    ⚠️ SAME DEFAULT DIRECTION AS `source_has_settlement_path`: an unknown or blank source answers
    `False` and therefore keeps the row-1 behaviour every source has had since slice S1. A new
    passbook is opted IN by being added to `BANK_STATEMENT_SOURCES`.
    """
    return (source or "").strip() in BANK_STATEMENT_SOURCES


def source_writes_its_match_surface(source: str) -> bool:
    """Does a settle from this source store the line's whole MATCH SURFACE as the reference? (#1259)

    `True` for a bank passbook. Its narration is the only reference it has, and the short value the
    parser extracts from it is not always there. Storing the whole surface
    (`contains_guard.match_surface`: the narration, plus the cheque number on a cheque-clearing line)
    is what lets the ICICI contains-guard find the record again when the same money reappears.

    `False` for a payout gateway, which keeps its clean bank reference (the Cashfree guards compare
    it whole-string), and for the wallet, which keeps its transaction id.

    ⚠️ AN UNKNOWN OR BLANK SOURCE ANSWERS `False`: a narration in `utr` on a source nobody has thought
    about is a value no guard of that source has been taught to read.
    """
    return (source or "").strip() in BANK_STATEMENT_SOURCES
