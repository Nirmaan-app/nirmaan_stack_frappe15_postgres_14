# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What a Cashbook statement will create (Bulk Import Outflow, Cashbook slice 4).

PURE MODULE -- no `frappe`, no database, no request context. Same shape and the same reason as
`matcher.py` and `project_match.py`: everything it needs is handed in, so the whole decision is
testable against a real statement with no bench, no site and no fixtures.

⚠️ THIS IS NOT A MATCHER, AND THE DIFFERENCE IS THE WHOLE FEATURE. `matcher.py` finds an existing
approved record that a bank transfer PAYS. There is nothing to find here: a petty-cash spend has no
counterpart in any ledger, so this module decides what to CREATE. That inverts the feature's
standing rule that the import never creates -- an owner ruling, taken deliberately, and narrower
than it sounds because `Project Expenses` already auto-approves anything under Rs 5,000 on
creation, which on a measured statement was 113 of 115 rows.

ONE PLAN, TWO READERS. The dialog renders this and the background job executes it. That is
deliberate: two passes over the same rows -- one to preview, one to write -- is how a screen comes
to promise one thing and a worker to do another, and there is no per-row review here to catch it.

WHAT IT DECIDES, IN ORDER
-------------------------
1. **Is this row importable at all?** Four ways it is not, each a VISIBLE skip carrying its own
   sentence, never a silent drop -- the statement's own totals block is already gone by now
   (`parser`), so everything reaching here was a real line in the file.
2. **Which ledger?** A remark naming exactly one project makes it a Project Expense; anything else
   makes it a Non-Project Expense. There is no third answer: an owner ruling puts a row nobody can
   place into Non-Project rather than holding it back, so nothing here ever refuses to decide.
3. **Which expense type?** Read from the same text, against the rules for THAT ledger -- see
   `pick_expense_type`. Nothing found gives the fallback.

⚠️ STEPS 2 AND 3 ARE ORDERED, NOT INDEPENDENT. The two expense ledgers have almost separate
vocabularies (12 project-only types, 25 non-project-only, 2 shared), so the type cannot be chosen
until the ledger is known. "Courier charges veeva project" is Material Transportation Charges;
"Courier charges" alone is Postage & Courier. The same words, a different answer, because the first
type does not exist on the other side.

MEASURED on the real 137-row export: 115 importable rows, 87 to a project and 28 not, with 26 (22%)
falling back to `Petty Cash`.
"""

from __future__ import annotations

from dataclasses import asdict
from decimal import Decimal
from typing import Iterable, Mapping, Sequence

from nirmaan_stack.services.outflow_import.cashbook_cutoff import is_before_cutoff, is_undated
from nirmaan_stack.services.outflow_import.cashbook_plan import (
    ACTION_CREATE,
    ACTION_INTERNAL,
    ACTION_SKIP,
    CashbookPlan,
    PlannedRow,
)
from nirmaan_stack.services.outflow_import.cashbook_placement import (
    FALLBACK_EXPENSE_TYPE,
    placement as _placement,
    pick_expense_type,
)
from nirmaan_stack.services.outflow_import.cashbook_refunds import (
    COLLECT_ROW_KIND,
    CREDIT_ROW_KINDS,
    REFUND_MOVED_STATUSES,
    REFUND_PREFIX,
    REFUND_ROW_KINDS,
    SKIP_PAIRED_REFUND,
    SKIP_PAIRED_SPEND,
    line_money as _amount,
    pair_refunds,
    refunded_spend_id,
    row_kind as _row_kind,
)
from nirmaan_stack.services.outflow_import.cashbook_refund_expense import SpendExpense, refund_placement
from nirmaan_stack.services.outflow_import.cashbook_reopen import EarlierWrongSkip, claim_wrong_skips, earlier_sightings
from nirmaan_stack.services.outflow_import.internal_transfers import (
    CASHBOOK_INTERNAL_KINDS,
    cashbook_move,
    cashbook_raw_transfer,
    name_refused_moves,
    transfer_sentence,
)
from nirmaan_stack.services.outflow_import.duplicates import (
    PriorSighting,
    bank_status_key,
    find_prior_sighting,
    row_identity,
)
from nirmaan_stack.services.outflow_import.parser import DIRECTION_CREDIT
from nirmaan_stack.services.outflow_import.project_match import ProjectIndex
from nirmaan_stack.services.outflow_import.repeats import KeptLine, split_repeats
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_ALREADY_IMPORTED,
    SKIP_KIND_BANK_REFUSED,
    SKIP_KIND_CASHBOOK_REFUND_PAIR,
    SKIP_KIND_CASHBOOK_UNKNOWN_TYPE,
    SKIP_KIND_NO_AMOUNT,
    SKIP_KIND_OUTFLOW_RECORDED,
    SKIP_KIND_REPEATED_IN_FILE,
)

__all__ = [
    "SPEND_ROW_KIND",
    "SPEND_ROW_KINDS",
    "FALLBACK_EXPENSE_TYPE",
    "ACTION_CREATE",
    "ACTION_SKIP",
    "ACTION_INTERNAL",
    "SKIP_PAIRED_REFUND",
    "SKIP_PAIRED_SPEND",
    "SKIP_ALREADY_BOOKED",
    "SKIP_ALREADY_IMPORTED_STATUS_CHANGED",
    "SKIP_REPEATED_IN_FILE_STATUS_CHANGED",
    "PlannedRow",
    "CashbookPlan",
    "plan_statement",
    "pick_expense_type",
]

# The `Type` values that mean money left on somebody's behalf; a Collect Payment too since #1708 (ADR-0015
# Amendment C). Everything else moves money BETWEEN our own balances, and booking it would count a rupee twice.
SPEND_ROW_KIND = "Wallet Spend"
SPEND_ROW_KINDS = frozenset({SPEND_ROW_KIND, COLLECT_ROW_KIND})
# The three actions, `PlannedRow` and `CashbookPlan` live in `cashbook_plan` (#1709, file size).


# Every reason a row is not imported. They are constants because the preview groups by them and a
# reworded sentence would silently split one group into two.
SKIP_NOT_A_SPEND = "Moves money between our own balances, not a spend"
SKIP_NOT_SUCCESSFUL = "Did not succeed at the wallet"
SKIP_NO_AMOUNT = "No amount was debited"
# Owner decision 4 (#1619): a Type the app does not know. Before it, such a line was filed as `SKIP_NOT_A_SPEND`.
SKIP_UNKNOWN_TYPE = "A Cashbook Type this app does not know: {kind}"
# ⚠️ NO LONGER WRITTEN (ADR-0031), KEPT BECAUSE STORED ROWS CARRY IT. An exact repeat -- same identity
# AND same bank status -- is now left out of the plan and only counted, so nothing new reads this
# sentence; but every Cashbook repeat staged before that does, and `skip_kind_backfill` reads a kind
# back out of it. Same disposition as `status.SKIP_REASON_ALREADY_IMPORTED`.
SKIP_ALREADY_IMPORTED = "Already imported in {batch}"
# The only repeat still staged is one whose bank status CHANGED, and its reason names both statuses.
# ⚠️ WORD FOR WORD CASHFREE'S `status.SKIP_REASON_ALREADY_IMPORTED_STATUS_CHANGED` (#1359) -- one line,
# one sentence, whatever the source. Spelled here because this module does not import `status`;
# `test_cashbook` pins the two equal. It still starts with `SKIP_ALREADY_IMPORTED`'s "Already imported
# in ", which is the prefix `skip_kind_backfill` reads a kind back out of.
_STATUS_CHANGED = ", bank status changed {earlier} → {now}"
SKIP_ALREADY_IMPORTED_STATUS_CHANGED = "Already imported in batch {batch}" + _STATUS_CHANGED + "."
# ⚠️ A DIFFERENT FACT FROM `SKIP_ALREADY_IMPORTED`, AND THE TWO MUST STAY APART. That one means an
# earlier BATCH staged this transfer; this one means an EXPENSE already exists for it -- typically
# keyed in by hand, outside this import entirely. Measured 2026-08-21: 17 live Non Project Expenses
# carry a wallet transfer id nobody imported. Collapsing the two would send a reader to a batch that
# does not exist.
# ⚠️ ONE placeholder, and the caller composes it. `find_prior_sighting` hands back a single opaque
# label by contract, so a two-placeholder message would have to SPLIT that label back apart on a
# separator -- and a record name containing that separator would then be silently truncated.
SKIP_ALREADY_BOOKED = "Already booked as {record}"
# No longer written, kept for stored rows -- see `SKIP_ALREADY_IMPORTED`.
SKIP_REPEATED_IN_FILE = "The same transfer appears earlier in this file"
SKIP_REPEATED_IN_FILE_STATUS_CHANGED = SKIP_REPEATED_IN_FILE + _STATUS_CHANGED


def plan_statement(
    rows: Iterable,
    index: ProjectIndex,
    expense_rules: Mapping[str, Sequence[tuple[str, str]]],
    already_imported: Mapping[tuple, tuple[PriorSighting, ...]] | None = None,
    already_booked: Mapping[tuple, tuple[PriorSighting, ...]] | None = None,
    wrong_skips: Sequence[EarlierWrongSkip] = (),
    refunded_spends: Mapping[str, SpendExpense] | None = None,
) -> CashbookPlan:
    """Decide what every parsed row becomes.

    `rows` are `parser.RawRow`s. Both lookups are `duplicates.index_prior_sightings` indexes, and
    each one's LABEL is what its message names: a batch id for `already_imported`, a ledger and
    record name for `already_booked`. They report WHERE the transfer was seen before rather than
    merely that it was -- the difference between a message somebody can act on and one they cannot.

    ⚠️ `already_imported` IS AN INDEX, NOT THE OLD `row_identity -> batch` DICT. The triple-keyed
    dict could only compare dates with `==`, which is precisely what `duplicates.dates_agree`
    exists to refuse: one unreadable Added On on either side and a spend imported a SECOND time,
    silently. The shape changed because the rule could not be applied in the old one.

    ⚠️ AN EXACT REPEAT IS NOT PLANNED AT ALL (ADR-0031), and that is decided before any skip test.
    A line the system already holds with the same bank status -- from an earlier import, or from
    earlier in this file -- is left out and counted in `repeats_not_saved`, whatever skip its first
    sighting got. The walk is `repeats.split_repeats`, the SAME one the Cashfree/ICICI upload plan
    calls; only the identity and the corpus of earlier sightings are this source's own.
    `already_imported` must therefore carry each sighting's bank status
    (`candidates.prior_import_sightings` does).

    ⚠️ A FINAL IN-FILE SIGHTING HERE IS A LINE THE PLAN WILL **CREATE** (#1358), not every terminal
    line as on Cashfree/ICICI. That was this path's rule before ADR-0031, and losing it was a
    regression: Txn X FAILED then Txn X SUCCESS in one file read the SUCCESS line as a status-changed
    in-file repeat of the failure -- skipped, Unskip-locked -- and the spend never became an expense.
    SUCCESS then SUCCESS is still an exact repeat. So is any IDENTICAL copy of a line earlier in the
    file, whatever it became (#1359): FAILED then FAILED, or a second copy of an already-booked line.

    ⚠️ THE ORDER OF THE SKIP TESTS IS THE MESSAGE. A failed top-up is not a spend AND did not
    succeed; reporting it as "did not succeed" would send somebody looking for a failed payment
    that never existed. Kind first, then a STATUS-CHANGED repeat (an earlier batch, then further up
    this sheet), then outcome, then amount, then an existing expense.

    ⚠️ A LINE THAT RE-OPENS AN EARLIER OWN-BALANCES SKIP (`wrong_skips`) IS NOT A REPEAT (#1596, `cashbook_reopen`):
    it carries that line as `reopens`, which is re-opened in place, never staged again.

    The status change sits ABOVE the outcome on purpose -- as it does on the Cashfree path. A spend
    imported SUCCESS and now REVERSED also "did not succeed", but that sentence is a Bank-refused
    skip, says nothing about what changed, and is not Unskip-locked; the repeat is locked (ADR-0022
    Amendment C). An earlier BATCH is still named ahead of an existing EXPENSE: when a previous
    import created the expense both are true, and the batch is a screen in this feature.
    """
    already = dict(already_imported or {})
    booked = dict(already_booked or {})
    every_row = list(rows)  # ⚠️ #1707: THE DATE FIRST, AND ONLY HERE. A line before the cutoff is only counted.
    rows = [raw for raw in every_row if not is_before_cutoff(raw)]
    claims = claim_wrong_skips(
        rows, wrong_skips, lambda raw: _decide(KeptLine(raw, None, None), _amount(raw), booked)[0] == ACTION_CREATE
    )

    # ⚠️ THE IN-FILE CHECK STAYS ON THE EXACT TRIPLE, AND THAT IS NOT AN OVERSIGHT. Three places ask
    # "is this row repeated within one file" -- here, `parser.duplicate_transfer_ids` (which feeds the
    # preview's warning) and the Cashfree `upload._plan_lines`. All three key on `row_identity`, and
    # the parser's own note says why: two of them disagreeing would call the same pair of rows repeated
    # in one surface and distinct in another.
    #
    # ⚠️ SINCE B3 THE KEY IS SOURCE-AWARE, AND "THE EXACT TRIPLE" IS NOW A STATEMENT ABOUT CASHBOOK,
    # NOT ABOUT EVERY SOURCE. `duplicates.WIDE_IDENTITY_SOURCES` gives a bank statement a wider key.
    # Cashbook is not in that set, so this call is unchanged and stays correct. The invariant that
    # matters is that every reader asks `row_identity` / `row_identity_of` with the SAME source.
    split = split_repeats(
        rows,
        identity_of=lambda raw: row_identity(
            getattr(raw, "transfer_id", "") or "", _amount(raw), _row_date(raw)
        ),
        earlier_sightings_of=lambda raw: earlier_sightings(raw, already, claims),
        # An internal line is not final here, exactly as when it was a skip (#1623 changes no repeat).
        is_final_in_file=lambda line: _decide(line, _amount(line.row), booked)[0] not in (ACTION_SKIP, ACTION_INTERNAL),
    )

    bases = [{**_base(line.row), "reopens": claims.get(id(line.row))} for line in split.kept]
    decisions = [_decide(line, base["amount"], booked) for line, base in zip(name_refused_moves(split.kept), bases)]
    pairs = pair_refunds(
        split.kept, [action == ACTION_CREATE for action, _, _ in decisions], lambda line: _pairable_spend(line, booked)
    )

    # Each line of a pair: the sentence it gets and the other line's Txn Id.
    partner_of: dict[int, tuple[str, str]] = {}
    for refund_at, spend_at in pairs:
        partner_of[refund_at] = (SKIP_PAIRED_REFUND, bases[spend_at]["transfer_id"])
        partner_of[spend_at] = (SKIP_PAIRED_SPEND, bases[refund_at]["transfer_id"])

    # Each spend this statement creates, by Txn Id: a part refund of it goes where it goes (#1709).
    # A Wallet Credit is placed the same way (#1720) but is no spend a refund could name.
    placements = {
        at: _placement(bases[at]["remarks"], index, expense_rules)
        for at, (action, _, _) in enumerate(decisions)
        if action == ACTION_CREATE and at not in partner_of and bases[at]["row_kind"] not in REFUND_ROW_KINDS
    }
    spends_here = {
        bases[at]["transfer_id"]: place for at, place in placements.items() if bases[at]["row_kind"] in SPEND_ROW_KINDS
    }
    planned: list[PlannedRow] = []
    for position, (base, (action, reason, skip_kind)) in enumerate(zip(bases, decisions)):
        if position in partner_of:
            template, partner = partner_of[position]
            action, reason, skip_kind = ACTION_SKIP, template.format(partner=partner), SKIP_KIND_CASHBOOK_REFUND_PAIR
            planned.append(PlannedRow(action=action, reason=reason, skip_kind=skip_kind, partner=partner, **base))
        elif action == ACTION_CREATE and base["row_kind"] in REFUND_ROW_KINDS:
            # ⚠️ #1709 (ADR-0015 Amendment D): an unpaired refund is a *Wallet refund expense*, placed where its spend is.
            spend = refunded_spend_id(base["transfer_id"])
            place = refund_placement(
                base["transfer_id"], base["remarks"], (refunded_spends or {}).get(spend), spends_here.get(spend),
                expense_rules, index,
            )
            planned.append(PlannedRow(action=action, reason=reason, **base, **asdict(place)))
        elif action == ACTION_CREATE:
            planned.append(PlannedRow(action=action, reason=reason, **base, **placements[position]))
        elif action == ACTION_INTERNAL:
            move = cashbook_move(split.kept[position].row)
            planned.append(PlannedRow(action=action, reason=reason, move=move, **base))
        else:
            planned.append(PlannedRow(action=action, reason=reason, skip_kind=skip_kind, **base))

    return CashbookPlan(
        rows=tuple(planned),
        split=split,
        pairs=tuple((planned[r], planned[sp]) for r, sp in pairs),
        before_cutoff=len(every_row) - len(rows),
        undated=sum(1 for raw in every_row if is_undated(raw)),
    )


def _decide(
    line: KeptLine,
    amount: Decimal,
    booked: Mapping[tuple, tuple[PriorSighting, ...]],
) -> tuple[str, str, str | None]:
    """`(action, reason, skip_kind)` for one line, BEFORE refunds are paired (`cashbook_refunds.pair_refunds`).

    By the statement's `Type` (#1594, spec #1585 "Planning (pure module)"):

      * a Wallet Spend or a Collect Payment creates (#1708), unless `_skip_reason` skips it;
      * a refund (Refund to Wallet, Credit Adjustment) creates its *Wallet refund expense* (#1709, at minus its
        Credit), unless the same repeat / outcome / amount tests skip it or its negative Expense is already booked.
        Pairing may then turn a refund and its spend into a skip (`pair_refunds`);
      * a Wallet Credit creates its *Wallet credit expense* (#1720, at minus its Credit), on the same tests as a
        refund; it never pairs;
      * Bank → VA, VA → Wallet, Wallet → VA: an Internal Transfer when this line says SUCCESS, else Bank refused
        (`repeat_sentence` names an earlier sighting); any other Type is an Unknown Cashbook type skip (#1619).
    """
    raw = line.row
    kind = _row_kind(raw)
    if kind in SPEND_ROW_KINDS:
        reason, skip_kind = _skip_reason(line, amount, booked, moved=bool(getattr(raw, "is_success", False)))
        return (ACTION_SKIP, reason, skip_kind) if reason else (ACTION_CREATE, "", None)
    if kind in CASHBOOK_INTERNAL_KINDS:
        if getattr(raw, "is_success", False):
            return ACTION_INTERNAL, transfer_sentence(cashbook_raw_transfer(raw)), None
        return ACTION_SKIP, refused_move_reason(repeat_sentence(line)), SKIP_KIND_BANK_REFUSED
    if kind in CREDIT_ROW_KINDS:
        if kind in REFUND_ROW_KINDS:
            moved = bank_status_key(getattr(raw, "status_raw", "")) in REFUND_MOVED_STATUSES
        else:
            moved = bool(getattr(raw, "is_success", False))
        reason, skip_kind = _skip_reason(line, amount, None, moved=moved)
        if reason:
            return ACTION_SKIP, reason, skip_kind
        # #1709, #1720: a refund's or a Wallet Credit's Expense is minus its Credit.
        record = find_prior_sighting(booked, raw.transfer_id or "", -amount, _row_date(raw))
        if record:
            return ACTION_SKIP, SKIP_ALREADY_BOOKED.format(record=record), SKIP_KIND_OUTFLOW_RECORDED
        return ACTION_CREATE, "", None
    return ACTION_SKIP, SKIP_UNKNOWN_TYPE.format(kind=kind or "blank"), SKIP_KIND_CASHBOOK_UNKNOWN_TYPE


def refused_move_reason(repeat: str = "") -> str:
    """A Cashbook move whose own line is not a success is Bank refused, naming `repeat`'s sighting (decision 3)."""
    return f"{SKIP_NOT_SUCCESSFUL}. {repeat}" if repeat else SKIP_NOT_SUCCESSFUL


def repeat_sentence(line: KeptLine) -> str:
    """A STATUS-CHANGED repeat's sentence, naming its earlier sighting and both statuses; blank on any other line."""
    now = bank_status_key(getattr(line.row, "status_raw", ""))
    if line.earlier:
        return SKIP_ALREADY_IMPORTED_STATUS_CHANGED.format(
            batch=line.earlier.label, earlier=line.earlier.earlier_status, now=now
        )
    if line.in_file:
        return SKIP_REPEATED_IN_FILE_STATUS_CHANGED.format(earlier=line.in_file.earlier_status, now=now)
    return ""


def _skip_reason(
    line: KeptLine,
    amount: Decimal,
    booked: Mapping[tuple, tuple[PriorSighting, ...]] | None,
    *,
    moved: bool | None = None,
) -> tuple[str, str | None]:
    """`(reason, skip_kind)` for a line to skip, `("", None)` for one the plan may act on.

    `line.earlier` / `line.in_file` are set only for a STATUS-CHANGED repeat on a kept line. It is
    also asked of every line by the in-file rule, an exact repeat included -- any repeat answers with
    a skip, so an exact one is never a line that creates. See `plan_statement` for the order.
    `moved` is whether the wallet says the money moved (default: the line's SUCCESS); `booked=None` skips the
    existing-expense test.

    Each kind is the owner-confirmed `skip_kinds.SKIP_KINDS` label for that sentence: a wallet failure is
    Bank refused, and an expense that already exists is Outflow Already Recorded.
    """
    raw = line.row
    if moved is None:
        moved = bool(getattr(raw, "is_success", False))
    repeat = repeat_sentence(line)
    if repeat:
        return repeat, SKIP_KIND_ALREADY_IMPORTED if line.earlier else SKIP_KIND_REPEATED_IN_FILE
    if not moved:
        return SKIP_NOT_SUCCESSFUL, SKIP_KIND_BANK_REFUSED
    # ⚠️ ZERO IS A SKIP, NOT AN ERROR. `settle.create_expense_from_row` THROWS on an amount of zero
    # or less, and it is right to -- but reaching it would fail one row's slot in a batch of a
    # hundred for something visible here, where it costs a sentence instead.
    if amount <= 0:
        return SKIP_NO_AMOUNT, SKIP_KIND_NO_AMOUNT
    if booked is None:
        return "", None

    record = find_prior_sighting(
        booked, getattr(raw, "transfer_id", "") or "", amount, _row_date(raw)
    )
    if record:
        # The label already reads "<ledger> <name>" -- composed by the caller, which is the layer
        # that knows which ledger it queried.
        return SKIP_ALREADY_BOOKED.format(record=record), SKIP_KIND_OUTFLOW_RECORDED
    return "", None


def _pairable_spend(line: KeptLine, booked: Mapping[tuple, tuple[PriorSighting, ...]]) -> bool:
    """A Wallet Spend or Collect Payment that, unpaired, nothing would skip but its kind."""
    if _row_kind(line.row) not in SPEND_ROW_KINDS:
        return False
    return not _skip_reason(line, _amount(line.row), booked)[0]


def _base(raw) -> dict:
    """The fields every planned line carries, whatever the plan decides."""
    kind = _row_kind(raw)
    return dict(
        row_number=getattr(raw, "row_number", 0),
        transfer_id=getattr(raw, "transfer_id", "") or "",
        amount=_amount(raw),
        remarks=(getattr(raw, "remarks", "") or "").strip(),
        beneficiary_name=(getattr(raw, "beneficiary_name", "") or "").strip(),
        spent_by=(getattr(raw, "added_by_raw", "") or "").strip(),
        row_kind=kind,
        direction=DIRECTION_CREDIT if kind in CREDIT_ROW_KINDS else "",
    )


def _row_date(raw):
    return getattr(raw, "added_on_date", None)
