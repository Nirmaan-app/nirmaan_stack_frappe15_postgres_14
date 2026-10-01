# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""How duplicate-heavy an uploaded statement is, and what to do about it (slice V3).

PURE MODULE -- no `frappe`, no database, no request context. It takes counts and returns a verdict.

THE RULE IS OWNER RULING Q2, OPTION B, and it has exactly two behaviours over one threshold:

    every row already imported   ->  REFUSE. Nothing is written: no File, no batch, no rows.
    90% or more already imported ->  WARN in the preview. Never blocks; you can always proceed.
    below 90%                    ->  import normally; the exact repeats are left out, not saved.

⚠️ "ALREADY IMPORTED" MEANS AN **EXACT REPEAT** SINCE ADR-0031: the same identity AND the same bank
status as a line the system already holds (`match_repeat`). An exact repeat is never stored -- the
import keeps only a count of them. A repeat whose bank status CHANGED is new information about the
money, so it is not counted here: it is saved (as a skipped line naming both statuses) and so it is
part of `new`, the lines this import will store. That is what keeps the refusal honest -- a file
whose only new content is a status change still has something to save, and is accepted.

⚠️ 90% IS ONE CONSTANT, and the owner said so in as many words: "say a different number and it
moves". `DUPLICATE_WARN_RATIO` is that number. Do not grow a second threshold beside it, and do not
make the refusal a ratio -- refusing is for the case where there is genuinely nothing new, which is
a COUNT (`new == 0`), not a percentage. A sheet 99.9% duplicated still has a row worth importing.

WHY REFUSE AT ALL, rather than importing an empty batch: a batch with nothing new in it is a
staging record nobody will ever action, sitting in the list looking like work. The message names the
earlier batch so the reader can go and look at the real one instead.

WHY THIS IS NOT THE SAFETY NET. The real guarantee that one transfer cannot settle the same record
twice is the DB unique constraint on `Outflow Row Match (transfer_id, target_doctype, target_name)`.
This module is ERGONOMICS -- a clear message and saved work. That is precisely what makes it safe
for the caller to narrow its duplicate lookup by period first: a missed duplicate here costs a
confusing row, not double-paid money.

⚠️ NOTE THE TWO KEYS ARE DIFFERENT, AND THAT IS DELIBERATE. `Outflow Row Match`'s constraint is on
`transfer_id` alone (with the target); THIS module's identity STARTS at `(transfer_id, amount, date)`
-- see `row_identity`. They answer different questions: the constraint asks "has this transfer
already been used to settle this record?", which is about money and must stay as tight as possible,
while the identity asks "have we seen this line of this statement before?", which is about work and
may be more discriminating. Do not "align" them -- widening the constraint to a triple would let the
same transfer settle the same record twice under a corrected amount.

⚠️ THE IDENTITY IS SOURCE-AWARE FROM SLICE B3, AND THE ASYMMETRY IS MEASURED, NOT A PREFERENCE. A
bank passbook repeats a transaction id in ways a payout export structurally cannot, so `ICICI` keys
on five fields while `Cashfree` and `Cashbook` keep the proven triple BYTE-IDENTICAL. See
`WIDE_IDENTITY_SOURCES` and `row_identity` for the numbers, and for why each extra field is
load-bearing on its own.

⚠️ THERE ARE THREE READERS OF THIS KEY AND ALL THREE NOW AGREE (the gap closed at B3a).
`upload._stage_batch` (the in-file repeat check), `candidates.find_earlier_sightings_for_rows` (the
cross-batch lookup) and `parser._duplicate_transfer_ids` (the preview warning) all pass the source
and get the same key. Keep it that way -- the D3 notes exist because a key that differs between
readers lets one call two rows duplicates while another calls them distinct, on the same file.

The gap is recorded rather than deleted because it was REAL and its shape is instructive. Between
B3 and B3a the parser was still on the triple, and the divergence pointed the SAFE way: that
function feeds only the `duplicate_transfer_ids` WARNING payload, so on an ICICI statement the
preview OVER-REPORTED -- naming ids as repeated that staging then correctly kept as distinct.
Nothing was ever dropped. Measured on the real 1,274-row statement: the preview named **5** ids
where the wide key finds **0** in-file repeats (1,274 distinct identities, against 1,269 on the
triple).

⚠️ If a fourth reader appears it joins the key. Do NOT close a divergence by narrowing the staging
key back -- that direction loses rows silently, which is the one failure this module exists to
prevent.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Iterable

__all__ = [
    "DUPLICATE_WARN_RATIO",
    "DuplicateVerdict",
    "PriorSighting",
    "Repeat",
    "RowIdentity",
    "assess_duplicates",
    "bank_status_key",
    "dates_agree",
    "find_prior_sighting",
    "find_prior_sightings",
    "identity_wide_fields",
    "index_prior_sightings",
    "match_repeat",
    "row_identity",
    "row_identity_of",
    "WIDE_IDENTITY_SOURCES",
]

# Owner ruling Q2. One number, deliberately.
DUPLICATE_WARN_RATIO = 0.90


# --- what makes two staged transfers THE SAME transfer (slice D3, widened per source at B3) ------

#: Sources whose identity is the FIVE-field key rather than the triple. See `row_identity` for the
#: measurement; this constant exists so the SET is readable at a glance and a future source is one
#: word rather than a condition buried in a function.
#:
#: ⚠️ THE STRINGS ARE `parser.SUPPORTED_SOURCES` MEMBERS AND MUST STAY SPELLED AS THE PARSER SPELLS
#: THEM. They cannot be imported: `parser` imports THIS module, so the arrow only runs one way and
#: binding the name here would be a cycle. `test_duplicates.TestSourceVocabulary` pins every member
#: against `parser.SUPPORTED_SOURCES` instead, so a rename that reaches only one file fails loudly
#: rather than silently reverting a source to the triple.
WIDE_IDENTITY_SOURCES = frozenset({"ICICI Bank Statement"})

#: `(transfer_id, amount, date)` for a payout export, plus `(direction, remarks)` for a bank
#: passbook. The date is `None` when the statement's Added On was unreadable.
RowIdentity = tuple


def row_identity(
    transfer_id: str,
    amount: Decimal,
    added_on_date: "date | None",
    source: str = "",
    direction: str = "",
    remarks: str = "",
) -> RowIdentity:
    """The identity of one staged transfer -- THE one definition, used by every duplicate check.

    ⚠️ THIS WIDENED FROM `transfer_id` ALONE (owner, slice D3), AND WIDENING MEANS **STRICTER**.
    It is worth stating in that direction because the instinct runs the other way: a longer key
    matches FEWER things, so this catches FEWER duplicates than it used to, not more. A statement
    re-issued with the same transfer id but a corrected amount now imports as new work instead of
    being silently skipped -- which is the point, since a different amount is a different fact.

    ⚠️ IT WIDENED AGAIN AT SLICE B3, BUT **ONLY FOR A BANK PASSBOOK**, AND THE SPLIT IS THE DESIGN.
    `source` selects the key; anything outside `WIDE_IDENTITY_SOURCES` -- which today means every
    caller that passes nothing, i.e. Cashfree and Cashbook -- gets the triple back BYTE-IDENTICALLY.
    That default is not laziness, it is the guarantee: those two sources carry live settled data
    whose duplicate behaviour is proven in production, and this slice must not be able to move it.

    THE NUMBERS, measured against the real 1,274-row ICICI statement (do not re-derive them):

        (tid, amount, date)             1269 distinct   5 rows silently LOST
        + direction                     1270 distinct   4 rows lost
        + remarks                       1273 distinct   1 row lost
        + direction + remarks           1274 distinct   0 rows lost

    ⚠️ BOTH EXTRA FIELDS ARE LOAD-BEARING AND EACH CATCHES A DIFFERENT FAILURE -- neither is
    padding, and dropping either loses real rows:

    * `remarks` catches four SGST/CGST pairs. Same id, same date, same amount, same direction,
      differing only in narration (`SGST202603186870599968` / `CGST202603186870599971`, Rs 18,630
      each). Both legs are an INGEST category, so on the triple the second leg of each pair is
      swallowed as an in-file repeat and the money it represents never reaches a reviewer.
    * `direction` catches the bank's general-ledger transfer, whose two legs carry BYTE-IDENTICAL
      narration (`Ac xfr from gl 05051 to 60010`, Rs 3.19 Cr each way). Remarks cannot separate
      them; only which money column the bank filled in can.

    ⚠️ AND THESE ARE BANK-NARRATION ARTEFACTS THAT CANNOT OCCUR IN A PAYOUT EXPORT -- a GST charge
    split into two legs, a ledger move posted both ways. That is the whole argument for keying on
    the source rather than simply widening for everybody: there is no failure on the gateway sources
    for the extra fields to fix, so widening them would be a change to proven behaviour bought with
    nothing.

    ⚠️ THE WIDE KEY IS AN **EXTENSION** OF THE TRIPLE, NOT A RE-ORDERING. The first three positions
    are the same three values in the same order, so the legacy key is a prefix of the new one and
    the two shapes can be read side by side. Only the SET of fields was measured -- a tuple's
    distinct count does not depend on the order of its members -- so the extension form is chosen
    for legibility and costs nothing.

    ⚠️ THE AMOUNT IS COMPARED EXACTLY, AND MUST NOT ACQUIRE A TOLERANCE. `AMOUNT_TOLERANCE` is the
    SETTLE window -- what may be WRITTEN against a record -- and it has no business deciding whether
    two rows are the same row: at Rs 5 two genuinely different Rs 3 transfers would collapse into
    one and the second would never import. `amounts.py` also guards this structurally, by failing
    any `Decimal` constant declared outside it, so a fourth tolerance cannot be added here quietly.
    Both sides reach this through `normalize_amount`, which returns `Decimal` precisely so an exact
    comparison is safe.

    ⚠️ `remarks` IS COMPARED VERBATIM -- no strip, no case fold, no normalisation. The parser keeps
    the narration exactly as the bank wrote it, and the staging stores it as parsed, so a stored row's
    remarks are the parsed line's. Since #1358 the cross-batch lookup compares them too (a stored
    sighting must match the FULL identity -- `find_prior_sightings`). A normalisation could only make
    two genuinely different lines collide; if a stored narration ever came back altered, the line
    would read as new and be stored again -- a copy someone can see, never a line lost.

    ⚠️ THE DATE, NOT THE DATETIME. `Outflow Import Row.added_on` is a Datetime and two exports of
    the same transfer can carry different clock times; `RawRow.added_on_date` already exists for
    exactly this. Comparing the full timestamp would make a re-export look like new work.
    """
    if source in WIDE_IDENTITY_SOURCES:
        return (transfer_id, amount, added_on_date, direction, remarks)
    return (transfer_id, amount, added_on_date)


def identity_wide_fields(identity: RowIdentity) -> tuple:
    """The fields of `identity` past `(transfer_id, amount, date)`: `(direction, remarks)` for a
    `WIDE_IDENTITY_SOURCES` source, `()` for any other. What a stored sighting must ALSO agree on
    (`find_prior_sightings`), beside the three axes the sightings index settles."""
    return tuple(identity[3:])


def row_identity_of(row, source: str = "") -> RowIdentity:
    """`row_identity` for a parsed `RawRow` -- an ADAPTER over the one rule, never a second rule.

    It exists because the widening added two fields that live ON the row, and every call site would
    otherwise have to remember to pass them. Two sites reading five attributes each is two chances
    to forget one, and forgetting `remarks` degrades ICICI silently back to the four-field key --
    it still works, it just loses four rows a statement and says nothing.

    ⚠️ IT MUST NEVER GROW A BRANCH. Every decision about which fields matter belongs in
    `row_identity`; this reads attributes and delegates. A `getattr` default covers the callers that
    build a `RawRow`-shaped object by hand and predate `direction`.
    """
    return row_identity(
        row.transfer_id,
        row.amount,
        row.added_on_date,
        source=source,
        direction=getattr(row, "direction", "") or "",
        remarks=getattr(row, "remarks", "") or "",
    )


def dates_agree(left: "date | None", right: "date | None") -> bool:
    """Whether two staged transfers' dates are compatible -- with the MISSING-DATE FALLBACK.

    ⚠️ A MISSING DATE FALLS BACK TO `transfer_id` + amount (owner ruling, slice D3), which is what
    this function exists to say. It is deliberately NOT SQL `NULL = NULL` semantics, and the
    difference is not academic: the parser tolerates an unreadable Added On and stages the row with
    `None` anyway, so under `NULL = NULL is false` a sheet whose dates we failed to read would stop
    being recognised on re-upload and **import a second time, silently**.

    The reasoning is that a missing date is OUR failure to read the sheet, not evidence that the
    transfer is a different one. Treating it as a difference lets a parsing gap become a duplicate
    import; treating it as "cannot compare on this axis" costs at most a row skipped that a
    reviewer can see and query. Only one of those two mistakes is invisible.

    It is symmetric on purpose -- either side may be the unreadable one, since the stored row was
    parsed by this same tolerant parser on some earlier day.
    """
    if left is None or right is None:
        return True
    return left == right


# --- have we seen this transfer before? THE one lookup, over any corpus (slice CB-DUP) ----------
#
# WHY A PAIR OF FUNCTIONS RATHER THAN A DICT LOOKUP, which is what it replaced on the Cashbook path:
# a plain `dict` keyed on the whole `row_identity` triple can only answer with `==`, and `==` on the
# date is exactly what `dates_agree` exists to refuse. Bucketing on `(transfer_id, amount)` and
# settling the date separately is the ONLY shape that can apply the missing-date fallback, which is
# why `candidates.find_earlier_sightings_for_rows` already has this shape by hand.
#
# ⚠️ THE CORPUS IS THE CALLER'S BUSINESS AND THE RULE IS NOT. Cashbook asks this of two different
# populations -- earlier IMPORT ROWS, and expenses already BOOKED against a wallet reference -- and
# they must not be allowed to disagree about whether two transfers are the same transfer. Anything
# that wants to ask a third population builds entries and calls these; it does not write a third
# comparison.
#
# ⚠️ THE ORDER OF `entries` IS PART OF THE CONTRACT. `find_prior_sighting` returns the FIRST
# agreeing sighting, so a caller that wants the EARLIEST occurrence named must hand them over
# earliest-first (`ORDER BY creation ASC`). That is not decoration: the message names what it found,
# and a later batch named as the origin sends the reader to the wrong place.


@dataclass(frozen=True)
class PriorSighting:
    """One earlier occurrence of a transfer, and what a message should call it.

    `label` is deliberately opaque -- a batch id from one corpus, a ledger and record name from
    another. This module has no opinion about which; it only guarantees which one comes back.

    `bank_status` is what the bank said about that earlier line, as stored (ADR-0031). Blank for a
    corpus that has no bank status -- a booked expense -- which `match_repeat` is never asked about.

    `wide_fields` is that line's `identity_wide_fields` under the source asking (#1358): `()` on the
    triple, `(direction, remarks)` for a bank passbook.

    `final` says whether that line can be the basis of a STATUS CHANGE (#1359): a terminal stored
    line, or on Cashbook a line of the same file the plan creates. A line still in flight (QUEUED,
    PENDING, RECEIVED, Cashbook REFUNDED) is not final: it makes an IDENTICAL line an exact repeat,
    but never makes a different status a repeat -- the D4 rule, a QUEUED line must never block its
    later SUCCESS. See `match_repeat`.
    """

    added_on_date: "date | None"
    label: str
    bank_status: str = ""
    wide_fields: tuple = ()
    final: bool = True


def index_prior_sightings(
    entries: Iterable[tuple],
) -> dict[tuple[str, Decimal], tuple[PriorSighting, ...]]:
    """Bucket `(transfer_id, amount, date, label[, bank_status[, wide_fields[, final]]])` entries by
    the two `==` axes.

    The fifth element is optional: an earlier IMPORT ROW carries the bank status it was stored with
    (ADR-0031 needs it to tell an exact repeat from a status change); a booked expense has none. The
    sixth is the stored line's `identity_wide_fields` (#1358), `()` when absent. The seventh is
    `PriorSighting.final` (#1359), True when absent.

    ⚠️ A BLANK `transfer_id` IS DROPPED, NOT BUCKETED. Without this every reference-less record in
    the corpus would share one bucket keyed `("", amount)`, and a new statement row that also failed
    to carry an id would match the first of them on amount alone -- a duplicate verdict resting on
    no identity at all. Dropping them means such a row is never recognised as a repeat, which is the
    recoverable direction: a duplicate somebody can see beats a real spend silently skipped.

    The amount is keyed EXACTLY, as `row_identity` requires -- see its note on why a tolerance must
    never appear here.
    """
    index: dict[tuple[str, Decimal], list[PriorSighting]] = {}
    for transfer_id, amount, added_on_date, label, *rest in entries:
        if not transfer_id:
            continue
        index.setdefault((transfer_id, amount), []).append(
            PriorSighting(
                added_on_date=added_on_date,
                label=label,
                bank_status=rest[0] if rest else "",
                wide_fields=tuple(rest[1]) if len(rest) > 1 else (),
                final=rest[2] if len(rest) > 2 else True,
            )
        )
    return {key: tuple(sightings) for key, sightings in index.items()}


def find_prior_sighting(
    index: dict[tuple[str, Decimal], tuple[PriorSighting, ...]],
    transfer_id: str,
    amount: Decimal,
    added_on_date: "date | None",
) -> "str | None":
    """The label of the first earlier sighting of this transfer, or `None`.

    The date is settled by `dates_agree`, so an unreadable date on EITHER side does not break the
    match. That is the whole point of routing both Cashbook lookups through here.
    """
    sightings = find_prior_sightings(index, transfer_id, amount, added_on_date)
    return sightings[0].label if sightings else None


def find_prior_sightings(
    index: dict[tuple[str, Decimal], tuple[PriorSighting, ...]],
    transfer_id: str,
    amount: Decimal,
    added_on_date: "date | None",
    wide_fields: tuple = (),
) -> tuple[PriorSighting, ...]:
    """EVERY earlier sighting of this transfer, in the index's order (earliest first).

    `find_prior_sighting` is the first of these. All of them are needed to answer ADR-0031's
    question -- does the system already hold this line WITH THIS BANK STATUS? -- because the earliest
    sighting may carry an older status while a later one already carries this one.

    ⚠️ A SIGHTING COUNTS ONLY ON THE SOURCE'S FULL IDENTITY (#1358). `wide_fields` is this line's
    `identity_wide_fields`; a sighting whose own differ is a different line. On ICICI the other leg of
    an SGST/CGST pair or a GL transfer shares the id, the amount and the date, and before this it read
    as a sighting -- since ADR-0031 that dropped a real line silently. `()` on both sides for the
    triple sources, so Cashfree and Cashbook are unchanged.
    """
    if not transfer_id:
        return ()
    wide_fields = tuple(wide_fields)
    return tuple(
        sighting
        for sighting in index.get((transfer_id, amount), ())
        if dates_agree(sighting.added_on_date, added_on_date)
        and sighting.wide_fields == wide_fields
    )


# --- an exact repeat, or a status change? (ADR-0031) -------------------------------------------


def bank_status_key(value: "str | None") -> str:
    """A bank status as it is compared: trimmed and upper-cased.

    ⚠️ THE SAME NORMALISATION AS `parser.is_terminal_status` (`.strip().upper()`), which is the filter
    that decides which stored rows are sightings at all. It is spelled here rather than imported
    because `parser` imports this module. Two lines that differ only in padding or case are the same
    status, and treating them as a status change would save a row for news that is not news.
    """
    return (value or "").strip().upper()


@dataclass(frozen=True)
class Repeat:
    """An earlier sighting of a line, and whether this line is an EXACT repeat of it.

    `exact` is True when the system already holds this line with the same bank status: the line is
    not saved, only counted. False means the bank status changed since (for example SUCCESS earlier,
    REVERSED now): the line is saved as a skipped repeat whose reason names both statuses.

    `label` names the earlier sighting to point a reader at; `earlier_status` is that sighting's
    status, normalised by `bank_status_key`.
    """

    label: str
    earlier_status: str
    exact: bool


def match_repeat(sightings: "tuple[PriorSighting, ...]", bank_status: "str | None") -> "Repeat | None":
    """Classify a line against its earlier sightings, or `None` when there are none.

    An EXACT repeat needs ANY sighting with the same bank status, not just the earliest -- the glossary
    term is a line "the system already holds". Without that, a transfer imported SUCCESS and later
    REVERSED would save a fresh REVERSED row on every overlapping statement after that, because the
    earliest sighting would always still say SUCCESS. The first same-status sighting is the one named.

    Any sighting counts for an exact repeat, an in-flight one included (#1359): an identical copy of a
    QUEUED line is already held, and saving it again on every overlapping statement was the gap.

    With no same-status sighting it is a STATUS CHANGE, named against the earliest FINAL sighting (the
    order the index keeps, `ORDER BY creation ASC`), which is where the line was first imported.
    ⚠️ ONLY A FINAL SIGHTING CAN BE THAT BASIS -- the D4 rule. A QUEUED line followed by its SUCCESS is
    new work, not a status change; with no final sighting the answer is `None`.
    """
    status = bank_status_key(bank_status)
    for sighting in sightings:
        if bank_status_key(sighting.bank_status) == status:
            return Repeat(label=sighting.label, earlier_status=status, exact=True)
    for sighting in sightings:
        if sighting.final:
            return Repeat(
                label=sighting.label,
                earlier_status=bank_status_key(sighting.bank_status),
                exact=False,
            )
    return None


@dataclass(frozen=True)
class DuplicateVerdict:
    """What an upload should do about the duplicates it found.

    `refuse` and `warn` are mutually exclusive: a refusal is not a loud warning, it is a different
    outcome, and a caller that treated both as "show a message" would import a batch with nothing
    in it.
    """

    total: int
    duplicates: int
    new: int
    refuse: bool
    warn: bool
    message: str
    earliest_batch: str | None = None

    @property
    def ratio(self) -> float:
        """Share of this statement already imported. 0.0 for an empty statement -- an empty file
        is a format problem, reported elsewhere, and must not read as 100% duplicated."""
        return (self.duplicates / self.total) if self.total else 0.0


def assess_duplicates(
    total: int,
    duplicates: int,
    earliest_batch: str | None = None,
    filename: str | None = None,
    repeated_in_file: int = 0,
) -> DuplicateVerdict:
    """Decide refuse / warn / proceed for a statement with `duplicates` of `total` rows seen before.

    `duplicates` counts EXACT repeats only (ADR-0031) -- the lines that will not be saved -- so `new`
    is what this import will store, status-changed repeats included, and `new == 0` is "nothing to
    store".

    `earliest_batch` names the batch to point the reader at. It is optional because the message has
    to stay honest when the caller could not identify one -- a vague "already imported" beats naming
    the wrong batch.

    `repeated_in_file` is how many of `duplicates` repeat only a line earlier in this file
    (`repeats.RepeatSplit.repeated_in_file`). Those are not "already imported", and the message must
    not say they are (#1359).
    """
    total = max(int(total or 0), 0)
    duplicates = min(max(int(duplicates or 0), 0), total)
    new = total - duplicates
    repeated_in_file = min(max(int(repeated_in_file or 0), 0), duplicates)

    if total == 0 or duplicates == 0:
        return DuplicateVerdict(
            total=total, duplicates=duplicates, new=new,
            refuse=False, warn=False, message="", earliest_batch=earliest_batch,
        )

    where = f" in batch {earliest_batch}" if earliest_batch else ""
    what = f"'{filename}'" if filename else "this file"
    if repeated_in_file == duplicates:
        seen = "are repeated in this file"
    elif repeated_in_file:
        seen = f"were already imported{where} or repeated in this file"
    else:
        seen = f"were already imported{where}"

    if new == 0:
        return DuplicateVerdict(
            total=total, duplicates=duplicates, new=0,
            refuse=True, warn=False, earliest_batch=earliest_batch,
            message=(
                f"Not imported. All {total} transfers in {what} {seen}. "
                f"Nothing in this file is new, so no records were created."
            ),
        )

    if duplicates / total >= DUPLICATE_WARN_RATIO:
        return DuplicateVerdict(
            total=total, duplicates=duplicates, new=new,
            refuse=False, warn=True, earliest_batch=earliest_batch,
            message=(
                f"Only {new} of {total} transfers in {what} are new. "
                f"The other {duplicates} {seen} and will not be saved."
            ),
        )

    return DuplicateVerdict(
        total=total, duplicates=duplicates, new=new,
        refuse=False, warn=False, earliest_batch=earliest_batch,
        message=(
            f"{duplicates} of {total} transfers {seen}. "
            f"They will not be saved."
        ),
    )
