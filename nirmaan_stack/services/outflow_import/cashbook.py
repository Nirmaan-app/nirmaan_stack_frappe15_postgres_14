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

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Mapping, Sequence

from nirmaan_stack.services.outflow_import.cashbook_collect import COLLECT_PAYMENT_NOTE
from nirmaan_stack.services.outflow_import.cashbook_placement import (
    FALLBACK_EXPENSE_TYPE,
    placement as _placement,
    pick_expense_type,
)
from nirmaan_stack.services.outflow_import.cashbook_refunds import (
    COLLECT_ROW_KIND,
    CREDIT_ROW_KINDS,
    OPEN_UNPAIRED_REFUND_NOT_HERE,
    OPEN_UNPAIRED_REFUND_NOT_PAIRED,
    OPEN_UNPAIRED_REFUND_PART,
    OPEN_WALLET_CREDIT,
    REFUND_MOVED_STATUSES,
    REFUND_PREFIX,
    REFUND_ROW_KINDS,
    SKIP_PAIRED_REFUND,
    SKIP_PAIRED_SPEND,
    WALLET_CREDIT_ROW_KIND,
    line_money as _amount,
    pair_refunds,
    row_kind as _row_kind,
    unpaired_reason,
)
from nirmaan_stack.services.outflow_import.cashbook_reopen import (
    EarlierWrongSkip,
    claim_wrong_skips,
    earlier_sightings,
)
from nirmaan_stack.services.outflow_import.internal_transfers import (
    CASHBOOK_INTERNAL_KINDS,
    TransferEnds,
    cashbook_line_transfer,
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
from nirmaan_stack.services.outflow_import.repeats import KeptLine, RepeatSplit, split_repeats
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_ALREADY_IMPORTED,
    SKIP_KIND_BANK_REFUSED,
    SKIP_KIND_CASHBOOK_INTERNAL,
    SKIP_KIND_CASHBOOK_REFUND_PAIR,
    SKIP_KIND_NO_AMOUNT,
    SKIP_KIND_OUTFLOW_RECORDED,
    SKIP_KIND_REPEATED_IN_FILE,
)

__all__ = [
    "SPEND_ROW_KIND",
    "FALLBACK_EXPENSE_TYPE",
    "ACTION_CREATE",
    "ACTION_SKIP",
    "ACTION_OPEN",
    "ACTION_INTERNAL",
    "SKIP_PAIRED_REFUND",
    "SKIP_PAIRED_SPEND",
    "OPEN_UNPAIRED_REFUND_PART",
    "OPEN_UNPAIRED_REFUND_NOT_HERE",
    "OPEN_WALLET_CREDIT",
    "SKIP_ALREADY_BOOKED",
    "SKIP_ALREADY_IMPORTED_STATUS_CHANGED",
    "SKIP_REPEATED_IN_FILE_STATUS_CHANGED",
    "PlannedRow",
    "CashbookPlan",
    "plan_statement",
    "pick_expense_type",
]

# The one `Type` value that means money left on somebody's behalf. Everything else in a Cashbook
# export moves money BETWEEN our own balances -- a wallet top-up, a bank load, a refund -- and
# recording those as expenses would book the same rupee twice.
SPEND_ROW_KIND = "Wallet Spend"


# The refund and wallet-credit kinds, their sentences and the pairing walk live in `cashbook_refunds` (#1594).
ACTION_CREATE = "create"
ACTION_SKIP = "skip"
# An open line (#1594): staged at `Mismatched`, a status the job never takes, and decided on the main table.
ACTION_OPEN = "open"
# One of Cashbook's own moves (#1623, spec #1619): staged at `Internal Transfer` with one record, never an expense.
ACTION_INTERNAL = "internal"

# Every reason a row is not imported. They are constants because the preview groups by them and a
# reworded sentence would silently split one group into two.
SKIP_NOT_A_SPEND = "Moves money between our own balances, not a spend"
SKIP_NOT_SUCCESSFUL = "Did not succeed at the wallet"
SKIP_NO_AMOUNT = "No amount was debited"
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


@dataclass(frozen=True)
class PlannedRow:
    """One statement row and what will become of it. Never a partial answer.

    A `create` row always carries a ledger and an expense type; a `skip` row always carries a
    reason. Nothing here is left for a caller to work out, because the two callers -- the preview
    and the writer -- would work it out separately.
    """

    row_number: int
    transfer_id: str
    amount: Decimal
    remarks: str
    beneficiary_name: str
    spent_by: str
    action: str
    reason: str = ""
    skip_kind: str | None = None
    """A `skip_kinds.SKIP_KINDS` member on a skip row, `None` on a create row -- chosen beside `reason` by
    `_skip_reason`, so the stored kind never has to be read back out of the sentence."""
    ledger: str | None = None
    project: str | None = None
    project_name: str = ""
    expense_type: str | None = None
    matched_keyword: str = ""
    """Which rule chose the expense type, so a surprising type can be traced to the word that
    caused it. Blank when the fallback was used -- there was no rule."""
    # #1594: the statement's `Type`; `DIRECTION_CREDIT` on a refund or wallet credit (`amount` is then its Credit),
    # else blank; and the other line's Txn Id on a *Paired wallet refund*.
    row_kind: str = ""
    direction: str = ""
    partner: str = ""
    # #1596: the earlier line skipped as own balances that this line re-opens in place; it is then not staged anew.
    reopens: EarlierWrongSkip | None = None
    # #1623: on an internal line, where the money came from and went (`internal_transfers.cashbook_line_transfer`),
    # the money moved (its Debit, or its Credit where the Debit is blank, as on a top-up), whether this line makes
    # the record (False on a status-changed repeat: its earlier sighting already did), and the rule id it names.
    transfer: TransferEnds | None = None
    transfer_money: Decimal = Decimal("0")
    records_transfer: bool = False
    transfer_rule: str = ""

    @property
    def creates(self) -> bool:
        return self.action == ACTION_CREATE

    @property
    def opens(self) -> bool:
        return self.action == ACTION_OPEN

    @property
    def is_fallback_type(self) -> bool:
        return self.creates and self.expense_type == FALLBACK_EXPENSE_TYPE


@dataclass(frozen=True)
class CashbookPlan:
    rows: tuple[PlannedRow, ...] = ()
    """Every row that will be STAGED, in file order. An exact repeat is not among them (ADR-0031)."""
    split: RepeatSplit = RepeatSplit(kept=(), repeats_not_saved=0, repeat_of_batch=None)
    """The repeat walk's answer, as `split_repeats` gave it: `split.kept` are the parsed lines behind
    `rows` (same order), `split.repeats_not_saved` the exact repeats left out."""
    pairs: tuple[tuple[PlannedRow, PlannedRow], ...] = ()
    """Each *Paired wallet refund* as `(refund, spend)`, in the refunds' file order (#1594). Both are in `rows`."""

    @property
    def creating(self) -> tuple[PlannedRow, ...]:
        return tuple(row for row in self.rows if row.creates)

    @property
    def skipping(self) -> tuple[PlannedRow, ...]:
        return tuple(row for row in self.rows if row.action == ACTION_SKIP)

    @property
    def internal(self) -> tuple[PlannedRow, ...]:
        """Cashbook's own moves (#1623): staged as Internal Transfer lines, in file order."""
        return tuple(row for row in self.rows if row.action == ACTION_INTERNAL)

    @property
    def opening(self) -> tuple[PlannedRow, ...]:
        """The open lines (#1594): unpaired wallet refunds and wallet credits, in file order."""
        return tuple(row for row in self.rows if row.opens)

    @property
    def reopening(self) -> tuple[PlannedRow, ...]:
        """The lines that re-open an earlier own-balances skip in place (#1596), in file order."""
        return tuple(row for row in self.rows if row.reopens)

    @property
    def total_value(self) -> Decimal:
        return sum((row.amount for row in self.creating), Decimal("0"))

    def for_ledger(self, ledger: str) -> tuple[PlannedRow, ...]:
        return tuple(row for row in self.creating if row.ledger == ledger)


def plan_statement(
    rows: Iterable,
    index: ProjectIndex,
    expense_rules: Mapping[str, Sequence[tuple[str, str]]],
    already_imported: Mapping[tuple, tuple[PriorSighting, ...]] | None = None,
    already_booked: Mapping[tuple, tuple[PriorSighting, ...]] | None = None,
    wrong_skips: Sequence[EarlierWrongSkip] = (),
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
    # Read twice: by the repeat walk, and by `unpaired_reason` (is a refund's spend on this statement?).
    rows = list(rows)
    claims = claim_wrong_skips(
        rows, wrong_skips, lambda raw: _decide(KeptLine(raw, None, None), _amount(raw), booked)[0] == ACTION_OPEN
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
    decisions = [_decide(line, base["amount"], booked) for line, base in zip(split.kept, bases)]
    pairs = pair_refunds(
        split.kept, [action == ACTION_OPEN for action, _, _ in decisions], lambda line: _pairable_spend(line, booked)
    )

    # Each line of a pair: the sentence it gets and the other line's Txn Id.
    partner_of: dict[int, tuple[str, str]] = {}
    for refund_at, spend_at in pairs:
        partner_of[refund_at] = (SKIP_PAIRED_REFUND, bases[spend_at]["transfer_id"])
        partner_of[spend_at] = (SKIP_PAIRED_SPEND, bases[refund_at]["transfer_id"])

    planned: list[PlannedRow] = []
    for position, (base, (action, reason, skip_kind)) in enumerate(zip(bases, decisions)):
        if position in partner_of:
            template, partner = partner_of[position]
            action, reason, skip_kind = ACTION_SKIP, template.format(partner=partner), SKIP_KIND_CASHBOOK_REFUND_PAIR
            planned.append(PlannedRow(action=action, reason=reason, skip_kind=skip_kind, partner=partner, **base))
        elif action == ACTION_CREATE or base["row_kind"] == COLLECT_ROW_KIND:  # #1595: Create opens pre-filled
            placement = _placement(base["remarks"], index, expense_rules)
            planned.append(PlannedRow(action=action, reason=reason, **base, **placement))
        elif action == ACTION_INTERNAL:
            planned.append(PlannedRow(action=action, reason=reason, **base, **_internal(split.kept[position])))
        else:
            if action == ACTION_OPEN and base["row_kind"] in REFUND_ROW_KINDS:
                reason = unpaired_reason(base["transfer_id"], base["amount"], rows)
            planned.append(PlannedRow(action=action, reason=reason, skip_kind=skip_kind, **base))

    return CashbookPlan(
        rows=tuple(planned),
        split=split,
        pairs=tuple((planned[r], planned[sp]) for r, sp in pairs),
    )


def _decide(
    line: KeptLine,
    amount: Decimal,
    booked: Mapping[tuple, tuple[PriorSighting, ...]],
) -> tuple[str, str, str | None]:
    """`(action, reason, skip_kind)` for one line, BEFORE refunds are paired (`cashbook_refunds.pair_refunds`).

    By the statement's `Type` (#1594, spec #1585 "Planning (pure module)"):

      * a Wallet Spend creates, and a Collect Payment is an OPEN line (#1595), unless `_skip_reason` skips it;
      * a refund (Refund to Wallet, Credit Adjustment) and a Wallet Credit are OPEN lines, unless the same
        repeat / outcome / amount tests skip them. Pairing may then turn a refund and its spend into a skip;
      * everything else -- Bank → VA, VA → Wallet, Wallet → VA -- moves money between our own balances, as before.

    The reason of an open refund is filled in after pairing (`cashbook_refunds.unpaired_reason`); a wallet credit's is fixed.
    """
    raw = line.row
    kind = _row_kind(raw)
    if kind in (SPEND_ROW_KIND, COLLECT_ROW_KIND):  # #1595: a Collect payment opens where a spend creates
        reason, skip_kind = _skip_reason(line, amount, booked, moved=bool(getattr(raw, "is_success", False)))
        opened = (ACTION_CREATE, "", None) if kind == SPEND_ROW_KIND else (ACTION_OPEN, COLLECT_PAYMENT_NOTE, None)
        return (ACTION_SKIP, reason, skip_kind) if reason else opened
    if kind in CASHBOOK_INTERNAL_KINDS and (line.earlier or line.in_file or bool(getattr(raw, "is_success", False))):
        # #1623: Cashbook's own moves are Internal Transfers, a status-changed repeat included (it records nothing:
        # see `_internal`). One the wallet says did not happen keeps today's skip: no money moved.
        ends = _ends(raw)
        return ACTION_INTERNAL, transfer_sentence(ends), None
    if kind in CREDIT_ROW_KINDS:
        if kind in REFUND_ROW_KINDS:
            moved = bank_status_key(getattr(raw, "status_raw", "")) in REFUND_MOVED_STATUSES
        else:
            moved = bool(getattr(raw, "is_success", False))
        # No "already booked" test: that asks the EXPENSE ledgers, and money in is never an Expense.
        reason, skip_kind = _skip_reason(line, amount, None, moved=moved)
        if reason:
            return ACTION_SKIP, reason, skip_kind
        return ACTION_OPEN, OPEN_WALLET_CREDIT if kind == WALLET_CREDIT_ROW_KIND else "", None
    return ACTION_SKIP, SKIP_NOT_A_SPEND, SKIP_KIND_CASHBOOK_INTERNAL


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
    now = bank_status_key(getattr(raw, "status_raw", ""))
    if line.earlier:
        return (
            SKIP_ALREADY_IMPORTED_STATUS_CHANGED.format(
                batch=line.earlier.label, earlier=line.earlier.earlier_status, now=now
            ),
            SKIP_KIND_ALREADY_IMPORTED,
        )
    if line.in_file:
        return (
            SKIP_REPEATED_IN_FILE_STATUS_CHANGED.format(earlier=line.in_file.earlier_status, now=now),
            SKIP_KIND_REPEATED_IN_FILE,
        )
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


def _ends(raw) -> TransferEnds:
    """Where an internal line's money came from and went: by its Type, naming the employee from `From` / `To`."""
    return cashbook_line_transfer(
        _row_kind(raw),
        from_party=getattr(raw, "added_by_raw", "") or "",
        to_party=getattr(raw, "beneficiary_name", "") or "",
    )


def _internal(line: KeptLine) -> dict:
    """An internal line's transfer facts (#1623). A STATUS-CHANGED repeat (`line.earlier` / `line.in_file`) is still
    an Internal Transfer line, but makes no record: its earlier sighting already recorded the move."""
    raw = line.row
    debit = getattr(raw, "amount", Decimal("0")) or Decimal("0")
    credit = getattr(raw, "credit_amount", Decimal("0")) or Decimal("0")
    return {
        "transfer": _ends(raw),
        "transfer_money": debit if debit > 0 else credit,
        "records_transfer": not (line.earlier or line.in_file),
        "transfer_rule": CASHBOOK_INTERNAL_KINDS[_row_kind(raw)],
    }


def _pairable_spend(line: KeptLine, booked: Mapping[tuple, tuple[PriorSighting, ...]]) -> bool:
    """A Wallet Spend or Collect Payment that, unpaired, nothing would skip but its kind."""
    if _row_kind(line.row) not in (SPEND_ROW_KIND, COLLECT_ROW_KIND):
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
