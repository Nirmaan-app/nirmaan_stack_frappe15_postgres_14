# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bank-outflow statement parser (Bulk Import Outflow, slice S1).

PURE MODULE -- no `frappe`, no database, no request context, no filesystem. It takes the uploaded
bytes and returns a `ParseResult`; persistence is the caller's job.

TWO CONTRACTS THAT LOOK LIKE DETAILS AND ARE NOT:

1. **The parser NEVER filters.** A FAILED, PENDING or REVERSED transfer is parsed and returned
   exactly like a successful one, carrying its real status. Downstream auto-skips it, and that skip
   is VISIBLE on the row. The reason is concrete: a failed transfer still carries a bank reference
   number, and its successful retry appears as a separate row in the same file -- in a real 19-row
   statement, `Sri Sai Roadlines` Rs 22,000 FAILED at 18:17:59 with reference 620918791146 and
   succeeded at 19:23 with reference 620919871893, and BOTH would otherwise match the same payment.
   A parser that dropped the failure silently would leave nobody able to see why the numbers moved.

2. **`charges_amount` sums EVERY row; `gross_amount` sums only successful ones.** The asymmetry is
   deliberate. A charge is money the bank took whatever the transfer's outcome, so excluding failed
   rows from it would understate the debit. The beneficiary amount of a failed transfer, by
   contrast, never left the account. This is the same reason the batch total can never equal the sum
   of its rows: gateway charge plus tax belongs to no settlement target at all.

MONEY IS `Decimal` THROUGHOUT. These figures are compared for exact equality against stored amounts
and then differenced; binary floating point makes both unreliable at the paisa level. The conversion
to `float` happens once, at the persistence boundary.

Adding a source is a new entry in `_ADAPTERS` -- a column map, its required set, and optionally a
DERIVATION for the fields that source has no column for. No other code in this module is
source-aware, and the derivation hook is what keeps it that way: a statement that states a fact only
inside its narration text declares how to read it beside its column map, rather than teaching
`_build_row` about a bank.

⚠️ CASHBOOK NEEDED TWO GENERAL CAPABILITIES, AND BOTH ARE DELIBERATELY GENERAL RATHER THAN
CASHBOOK-SHAPED. The parked note that adding a second source was "one adapter entry" was optimistic;
it was one adapter entry plus these two, each of which is a rule about statements in general:

1. **A field may be mapped to SEVERAL columns.** A map value may be one header or a tuple of them,
   whose non-empty values join with `_MULTI_COLUMN_JOIN`. Cashbook splits its free text across
   `Remark` and `Note` -- 7 rows in a 115-row sample carry a `Note` saying more than the `Remark`
   does ("Pay to BharatPe Merchant" / "VR mall site") -- and both feed the same matcher, so they
   have to arrive as one string. The join is visible, so the two halves stay legible; the file
   itself is attached to the batch, so the exact cells stay recoverable.

2. **A row carrying NO transfer id, NO amount and NO status is file furniture, not a transfer.**
   Statements end in a totals block -- Cashbook's is six rows reading "Opening VA Balance",
   "Ending Total Balance" and so on down the date column. Those were being reported as six
   "has no Transfer Id" warnings on every single import, which is exactly how a warning list stops
   being read. A row with no id but a real amount or status is still warned about, because that one
   is a genuine data problem: see `_build_row`.

⚠️ ICICI NEEDED A THIRD, ON THE SAME TERMS -- IT IS A RULE ABOUT STATEMENTS, NOT ABOUT ICICI.

3. **A field may be mapped to a PAIR OF COLUMNS OF WHICH EXACTLY ONE IS POPULATED -- take that
   one, and RECORD WHICH.** `_WhicheverIsPopulated` is that map form. A bank passbook does not
   carry a signed amount and a direction column; it carries `Withdrawal` and `Deposit` side by
   side, and the empty one IS the statement of direction. Reading them separately would answer
   "how much" and lose "which way" -- so the two answers are produced by one resolution, and
   `direction` is filled from the same pass that fills `amount`.

   ⚠️ THIS IS NOT CAPABILITY 1 WITH TWO COLUMNS, AND IT MUST NEVER BE COLLAPSED INTO IT. A tuple
   JOINS its columns with `_MULTI_COLUMN_JOIN`, so mapping `amount` to `("Withdrawal Amt (INR)",
   "Deposit Amt (INR)")` under that rule yields the string `"2300552.00 - "` -- which
   `normalize_amount` would strip back to a plausible-looking number while the direction stayed
   lost. The two forms mean opposite things about the same pair of cells (BOTH are the value /
   exactly ONE is the value), which is why they are told apart by a marker class rather than by
   the shape of the map value.

   BOTH populated, or NEITHER, is corrupt input: the row is staged with a blank amount and a blank
   direction, and warned about. Nothing is guessed -- picking one of two populated columns would
   post real money in a direction the statement never claimed.

4. **A source may DERIVE fields it has no column for** (`_ADAPTERS` entry 3, a callable given a
   reader over the mapped fields and returning overrides). ICICI states its counterparty only
   inside the narration text and states no status at all. The derivation is declared per source
   beside its column map, so `_build_row` stays blind to which bank it is reading.

⚠️ AND A FIFTH, WHICH IS CAPABILITY 3'S ONE-COLUMN SIBLING RATHER THAN A SPECIAL CASE OF IT.

5. **A field may be mapped to a SINGLE column that STATES A FACT BY CARRYING A FIGURE AT ALL --
   and states NOTHING when it is blank.** `_StatesWhenPopulated` is that map form. An outflow-only
   export has one money column because it only ever has one thing to say: Cashfree maps `amount` to
   `Amount` and Cashbook to `Debit`, and a figure in either IS a statement that money left.

   ⚠️ THE BLANK HALF IS THE WHOLE POINT, AND THE TEMPTING VERSION OF THIS RULE IS WRONG. "A source
   with one amount column states Debit" mislabels real money: Cashbook mixes wallet spends with
   top-ups and bank loads in ONE file, and its `Credit` column is deliberately unmapped, so a
   top-up parses with a blank `Debit` and an amount of 0. Stamping `Debit` on that row would assert
   that money left the account on a row where the opposite happened -- and it would do it
   invisibly, since the row would then read like every ordinary spend beside it. A blank direction
   means "the statement did not state one", which on a top-up is exactly true: we never mapped the
   column that would have said `Credit`.

   Like capability 3 this fills `label_field` from the SAME pass that fills the value, so the two
   can never disagree about one cell. Unlike it, a blank is NOT corrupt input and is never warned
   about -- one column has nothing to contradict.

⚠️ AND A SIXTH, WHICH IS THE ONLY ONE OF THE SIX THAT IS ABOUT A COLUMN BEING ABSENT ALTOGETHER.

6. **A field may be mapped to SEVERAL columns OF WHICH THE FIRST POPULATED ONE WINS.**
   `_FirstPopulated` is that map form: consult the columns in declared order and take the first
   whose cell is non-empty. ICICI prints BOTH a `Value Date` and a `Transaction Date`, and the
   second is the one a human means by "when did this happen" -- they differ on 11 of 1,395 real
   rows, all interest postings the bank values a day earlier than it posts them. An older 8-column
   variant of the same export carries only `Value Date`, so the field has to fall back rather than
   fail.

   ⚠️ NEITHER EXISTING MULTI-COLUMN FORM FITS, AND BOTH WOULD BE WRONG RATHER THAN MERELY CLUMSY.
   A TUPLE (capability 1) JOINS its columns, so mapping `added_on` to both would hand
   `_parse_datetime` the string `"01/Jan/2026 - 02/Jan/2026"` and every row would land undated with
   a warning. `_WhicheverIsPopulated` (capability 3) demands that EXACTLY ONE be populated and
   treats two as corrupt -- but here BOTH are populated on essentially every row, by design, and
   the second one is simply better. The three forms make three different claims about the same
   cells (all of them / exactly one of them / the first of them), which is why each is a marker
   class rather than a shape of map value.

⚠️ SOURCE AND FORMAT ARE DIFFERENT AXES -- see below. None of the capabilities above is a format
concern.

⚠️ WHERE THE TABLE IS, IS A THIRD AXIS AGAIN (slices C1-C3). A gateway export IS a table: header on
row 1, transfers to the last line. A bank passbook is a table PRINTED INSIDE A DOCUMENT -- sixteen
account-info lines above it and a balances block plus a legend below it. So reading the bytes and
finding the table are two jobs, and they are two functions: `_read_grid` turns either format into
one format-blind grid of strings, and `locate_table` decides which of its rows are the table. Which
behaviour a source gets is `sources.source_has_preamble`, and that gate is load-bearing -- read its
docstring before widening it.

FORMAT IS SNIFFED FROM THE BYTES, NOT DECLARED (Q10, slice V3). `.csv` and `.xlsx` both arrive here
as bytes and are told apart by the ZIP magic number that starts every xlsx -- a CSV cannot begin
with it. The caller does not say which it has, and neither does the accountant: "the sheet format
stops being something they have to think about" was the point of the ruling. A file whose extension
disagrees with its contents therefore still parses correctly, which is the common shape when
someone renames an export.

⚠️ SOURCE AND FORMAT ARE DIFFERENT AXES. `source` is WHOSE statement this is (Cashfree, one day
Cashbook) and selects the column map; format is how the bytes are encoded. A Cashfree export is the
same statement whether saved as .csv or .xlsx, so adding a format must never mean adding a source.
"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from nirmaan_stack.services.outflow_import.duplicates import row_identity_of
from nirmaan_stack.services.outflow_import.normalize import (
    normalize_account,
    normalize_amount,
    normalize_reference,
)
from nirmaan_stack.services.outflow_import.sources import source_has_preamble

__all__ = [
    "RawRow",
    "ParseResult",
    "StatementFormatError",
    "TableBounds",
    "locate_table",
    "describe_mapped_columns",
    "column_letter",
    "parse_statement",
    "SUPPORTED_SOURCES",
    "BANK_SUCCESS_STATUS",
    "BANK_TERMINAL_STATUSES",
    "DIRECTION_DEBIT",
    "DIRECTION_CREDIT",
    "is_success_status",
    "is_terminal_status",
]

# The two things a passbook row can be. They are LABELS, not a sign: `RawRow.amount` stays the
# positive figure the statement printed, exactly as every other source's does, and the direction
# sits beside it. Storing a credit as a negative amount would have made "how much" and "which way"
# the same field, and every downstream comparison against a stored expense amount would then have
# to know which source it came from.
DIRECTION_DEBIT = "Debit"
DIRECTION_CREDIT = "Credit"

# The one word the gateway uses for money that actually left the account. Everything else -- FAILED,
# PENDING, REVERSED -- is a transfer that did not happen.
BANK_SUCCESS_STATUS = "SUCCESS"

# The statuses that are the LAST WORD on a transfer -- its story is over, whichever way it went.
#
# ⚠️ THIS IS A DIFFERENT QUESTION FROM `is_success_status`, AND CONFLATING THEM COSTS MONEY IN ONE
# DIRECTION AND CLARITY IN THE OTHER. "Did money move?" decides whether a row can SETTLE anything.
# "Is this the final account of the transfer?" decides whether a stored row may be treated as an
# IMPORT -- see `candidates.find_earlier_batches_for_rows`. A transfer still QUEUED is neither: it
# settles nothing today AND tomorrow's export will say something new about it, so freezing it as
# "already imported" strands the money permanently. A FAILED transfer also settles nothing, but it
# IS final -- a retry gets a new transfer id, so that row will never say anything else -- and it must
# keep counting as a duplicate, or a re-uploaded statement stops being recognised as fully imported
# and stages a batch with nothing in it to action.
#
# ⚠️ ANYTHING NOT LISTED HERE IS TREATED AS STILL IN FLIGHT, AND THE DEFAULT LEANS THAT WAY ON
# PURPOSE. The two mistakes are not symmetric: calling an in-flight status final loses real money
# with no trace and no way back (a skipped row is frozen against re-matching), while calling a final
# status in-flight costs a re-staged row that is skipped anyway. Only one of those is recoverable,
# so an unrecognised status must fall on the recoverable side.
BANK_TERMINAL_STATUSES = frozenset({BANK_SUCCESS_STATUS, "FAILED", "REJECTED", "REVERSED"})


def is_success_status(status_raw: str | None) -> bool:
    """Did this transfer actually move money?

    ⚠️ THE SINGLE DEFINITION OF "SUCCESSFUL", AND IT HAD TO BECOME ONE. It was a property on `RawRow`
    and nothing else needed it -- until the import summary had to exclude failed transfers from every
    figure it reports, which happens long after parsing, against rows read back out of the database.
    A second copy of `== "SUCCESS"` in that query is the shape where one side later learns about
    `REVERSED` and the other does not, and the two disagree about the same statement.

    `review.get_import_summary` binds `BANK_SUCCESS_STATUS` into its `GROUP BY` for exactly this
    reason: the SQL and this function compare against the same literal, from here.
    """
    return (status_raw or "").strip().upper() == BANK_SUCCESS_STATUS


def is_terminal_status(status_raw: str | None) -> bool:
    """Is this the LAST thing the statement will ever say about this transfer?

    True for a transfer that succeeded AND for one that definitively did not. False while it is
    still in flight, and false for a status we do not recognise -- see `BANK_TERMINAL_STATUSES` for
    why the unknown case leans that way.

    Normalises identically to `is_success_status`, so the two can never disagree about the same
    cell, and the SQL that binds this set uses `UPPER(BTRIM(...))` to match.
    """
    return (status_raw or "").strip().upper() in BANK_TERMINAL_STATUSES


class StatementFormatError(ValueError):
    """The uploaded file is not a statement this source knows how to read.

    Raised only for a whole-file problem -- an unreadable encoding, an empty file, or a header that
    is missing a column the matcher depends on. A bad value in a single row is never this; it is a
    row-level finding the caller reports.
    """


@dataclass(frozen=True)
class RawRow:
    """One transfer, verbatim, plus the two identity forms the matcher needs.

    Every raw field is kept exactly as the statement wrote it. The derived fields sit BESIDE the raw
    ones rather than replacing them, so the original is always recoverable and a re-match can never
    destroy evidence.
    """

    row_number: int
    transfer_id: str
    reference_id: str
    added_on: datetime | None
    amount: Decimal
    status_raw: str
    beneficiary_name: str
    beneficiary_id: str
    bank_account: str
    ifsc: str
    remarks: str
    bank_reference_no: str
    service_charge: Decimal
    service_tax: Decimal
    added_by_raw: str
    normalized_account: str
    normalized_reference: str
    row_kind: str = ""
    """What KIND of movement the statement says this is, verbatim, or "" where it does not say.

    Cashbook mixes spends with wallet top-ups and bank loads in one file and tells them apart in a
    `Type` column; only `Wallet Spend` is money leaving on someone's behalf. Cashfree's export is
    transfers only, so it has no such column and this stays blank there.

    ⚠️ THE PARSER STILL NEVER FILTERS -- this field only RECORDS what the statement said. Deciding
    that a top-up is not importable is a downstream judgement, and it stays downstream so the skip
    is visible on a staged row rather than being an absence nobody can account for. Same contract
    the FAILED transfer above already follows, for the same reason.

    It carries a default because it is the one field a statement may genuinely not have, and every
    caller that builds a `RawRow` by hand predates it.
    """

    direction: str = ""
    """WHICH WAY the money went -- `DIRECTION_DEBIT`, `DIRECTION_CREDIT`, or "" where the statement
    does not say.

    The sibling of `row_kind`, and deliberately a separate question from it: `row_kind` records what
    KIND of movement the statement called this ("Wallet Spend", "Bank → VA"), while this records
    only which side of the account it landed on. A bank passbook says the second and never the
    first; a wallet statement says the first and expresses the second only by which of its two
    money columns it filled in.

    ⚠️ IT IS FILLED BY THE SAME RESOLUTION THAT FILLS `amount` -- capability 3 where the source has
    two money columns, capability 5 where it has one -- which is why the two can never disagree
    about the same row.

    ⚠️ A BLANK IS "THE STATEMENT DID NOT SAY", AND MUST NEVER BE READ AS "DEBIT BY DEFAULT". Since
    slice B3a a single-DEBIT-column source states `Debit` on the rows where that column carried a
    figure, so Cashfree (payouts only) fills this on every row, while Cashbook fills it only on the
    rows that actually debited: a wallet top-up leaves it blank, because Cashbook's `Credit` column
    is unmapped and we genuinely never read what it said. Labelling that row `Debit` would assert
    money left the account on a row where it arrived.

    ⚠️ THE PARSER STILL NEVER FILTERS. This RECORDS the direction; refusing to import a credit is a
    downstream judgement, and it stays downstream so the skip is visible on a staged row.
    """

    @property
    def is_success(self) -> bool:
        return is_success_status(self.status_raw)

    @property
    def added_on_date(self) -> date | None:
        return self.added_on.date() if self.added_on else None


@dataclass(frozen=True)
class ParseResult:
    """Everything the caller needs to stage a batch, and nothing it has to recompute."""

    source: str
    rows: tuple[RawRow, ...]
    period_from: date | None
    period_to: date | None
    gross_amount: Decimal
    charges_amount: Decimal
    duplicate_transfer_ids: tuple[str, ...]
    warnings: tuple[str, ...]

    bounds: "TableBounds | None" = None
    """WHERE in the sheet the table was found, or `None` for a source with no preamble.

    Populated only for a source that answers `sources.source_has_preamble` -- the one source whose
    table is not simply "the whole file". `preview_outflow_statement` reports it so a person can see
    which row was read as the header and correct it; nothing downstream of staging reads it.

    ⚠️ IT IS `None` RATHER THAN "ROW 1" FOR A GATEWAY EXPORT, DELIBERATELY. A gateway statement has
    no layout to report and no picker to drive, and the preview payload's `sheet` block is ABSENT
    for exactly those two sources. Filling this in with a trivially-true row 1 would put a header
    picker on a screen where there is nothing to pick, and make "does this source have a layout
    question?" answerable only by reading the value rather than by asking the capability.
    """

    grid: tuple[tuple[str, ...], ...] = ()
    """The whole sheet as read, for the same source and on the same terms as `bounds`.

    Carried on the result rather than re-read by the endpoint so that the rows the picker DISPLAYS
    and the rows the parser READ are the same read. A second `_read_grid` call would be the same
    pure function over the same bytes and would still be a second chance for the screen and the
    parser to disagree about which row is row 17 -- the split this module's `_read_and_parse`
    sharing already exists to prevent, one layer down.
    """

    @property
    def success_count(self) -> int:
        return sum(1 for row in self.rows if row.is_success)


# --- source adapters ---------------------------------------------------------------------------
#
# A statement may carry columns we ignore entirely (VPA, Acknowledged, Mode, Status Code, Payment
# Instrument ID, Last checked at, Status Description, Extended UTR). Unknown columns are fine;
# a MISSING required column is not, because the matcher would then silently lose a signal.


@dataclass(frozen=True)
class _WhicheverIsPopulated:
    """Map form for "exactly one of these columns holds the value -- take it, and record which".

    See capability 3 in the module docstring for why this is a marker class rather than a tuple:
    a tuple already means something else on this map (JOIN the columns), and the two rules make
    opposite claims about the same pair of cells.

    `columns` and `labels` are positional twins -- `labels[i]` is what gets recorded when
    `columns[i]` is the populated one. The label is a value the caller chose, not the column's own
    header, because the header is a phrasing ("Withdrawal Amt (INR)") and the label is a fact
    ("Debit") that has to read the same whichever bank wrote the statement.

    `label_field` names the `RawRow` field the label lands in. It is declared rather than assumed so
    that a future source can resolve some other either/or pair -- a `Sent`/`Received` pair on a
    wallet, say -- without this class growing a second special case.
    """

    columns: tuple[str, ...]
    labels: tuple[str, ...]
    label_field: str


@dataclass(frozen=True)
class _StatesWhenPopulated:
    """Map form for "this ONE column states a fact when it carries a figure, and nothing when blank".

    See capability 5 in the module docstring. It is capability 3 with one column instead of two, and
    it is a SEPARATE marker rather than a `_WhicheverIsPopulated` of length one because the two make
    different claims about a blank: an either/or pair with nothing in it is CORRUPT and is warned
    about, while a single column with nothing in it is a statement's ordinary silence.

    `column` is the header, exactly as a plain string map value would be, and the field's value is
    read from it unchanged. `label` is what `label_field` receives when that cell is non-blank --
    the same declared-field shape as `_WhicheverIsPopulated`, so a future source can state something
    other than a direction this way without this class growing a case.

    ⚠️ NON-BLANK, NOT NON-ZERO. The question this answers is "did the statement write in this
    column", not "was the figure worth anything": a bank that prints `0.00` in its debit column has
    still said which side of the account the posting landed on. `amount` records how much
    separately, and a downstream reader that cares about zero (`cashbook._skip_reason`, which skips
    on `amount <= 0`) already asks that question itself.
    """

    column: str
    label: str
    label_field: str


@dataclass(frozen=True)
class _FirstPopulated:
    """Map form for "consult these columns in order and take the first one that has a value".

    See capability 6 in the module docstring for why neither existing multi-column form fits: a
    tuple JOINS (`"01/Jan/2026 - 02/Jan/2026"`), and `_WhicheverIsPopulated` calls two populated
    columns CORRUPT -- while here both are populated on essentially every row and the first is
    simply the better answer.

    `columns` is a PREFERENCE ORDER, not a set: the earlier column wins whenever it carries
    anything. A column the statement does not have at all reads as blank and is passed over, which
    is what makes this the form that tolerates an older export missing its preferred column.

    ⚠️ IT STATES NOTHING AND WARNS ABOUT NOTHING. Unlike the other two markers it has no
    `label_field`, because "which of these was populated" is not a fact about the transaction here
    -- both columns mean the same kind of thing and the choice between them is a preference we
    hold, not something the statement said. All-blank is ordinary silence, handled by whatever
    reads the field (`_parse_datetime` returns `None` and the row is warned about once, for the
    real reason: no readable date).
    """

    columns: tuple[str, ...]


def _resolve_whichever(marker: _WhicheverIsPopulated, cell) -> tuple[str, str, str]:
    """(value, label, problem) for one either/or pair.

    `problem` is "" when exactly one column is populated, and otherwise names what went wrong so
    the caller can word its own warning. On a problem BOTH returns are blank: a row that filled in
    two money columns has not told us which way the money went, and choosing one of them would post
    a real amount in a direction the statement never claimed. A blank amount plus a loud warning is
    visibly wrong; a guessed direction is invisibly wrong.
    """
    populated = [
        (index, value)
        for index, value in enumerate(cell(name).strip() for name in marker.columns)
        if value
    ]
    if len(populated) == 1:
        index, value = populated[0]
        return value, marker.labels[index], ""
    return "", "", "both" if populated else "neither"


_CASHFREE_COLUMNS = {
    "transfer_id": "Transfer Id",
    "reference_id": "Reference Id",
    "added_on": "Added On",
    # Capability 5. A Cashfree export is PAYOUTS ONLY -- there is no receipt it could contain -- so
    # a figure in `Amount` is a statement that money left, and the direction is read from the same
    # cell that gives the amount.
    "amount": _StatesWhenPopulated(
        column="Amount", label=DIRECTION_DEBIT, label_field="direction"
    ),
    "status_raw": "Status",
    "beneficiary_name": "Beneficiary Name",
    "beneficiary_id": "Beneficiary Id",
    "bank_account": "Bank Account",
    "ifsc": "IFSC",
    "remarks": "Remarks",
    "bank_reference_no": "Bank Reference No",
    "service_charge": "Service Charge",
    "service_tax": "Service Tax",
    "added_by_raw": "Added by",
}

# Only the columns without which a row cannot be identified, matched or reported.
# `Beneficiary Id` is absent on purpose: it is stored nowhere in this database, so it can never
# resolve to anything and is retained for provenance only.
_CASHFREE_REQUIRED = frozenset(
    {"Transfer Id", "Added On", "Amount", "Status", "Beneficiary Name", "Bank Reference No"}
)

# Cashbook is a PETTY-CASH WALLET statement, not a bank transfer export, and the difference shows
# in what is absent: no bank reference, no beneficiary account, no IFSC, no gateway charges. Match
# tiers 0 and 1 read exactly those fields, so they can find nothing here -- which is the mechanical
# reason this source gets its own downstream path rather than a widened matcher.
#
# ⚠️ `Date` IS TAKEN WITHOUT `Time`, WHICH SITS BESIDE IT (owner ruling). `%d/%m/%Y` is already in
# `_DATETIME_FORMATS`, so the cell parses to midnight and the clock time is dropped. Two spends to
# one payee on one day therefore share a timestamp and are told apart by their transfer ids, which
# are unique -- verified across a 115-row sample.
_CASHBOOK_COLUMNS = {
    "transfer_id": "Txn Id",
    "added_on": "Date",
    # Capability 5, and this is the source that makes the blank half of it load-bearing. `Debit` is
    # blank on every top-up and bank-load row -- `Credit` is deliberately unmapped -- so those rows
    # keep a BLANK direction rather than being labelled as money going out. `_skip_reason` already
    # tells them apart on `row_kind` and on `amount <= 0`; this only stops the parser from asserting
    # the opposite of what happened on the row itself.
    #
    # ⚠️ THE PARSER IS PRECISE GOING FORWARD; THE BACKFILL APPROXIMATES HISTORY, AND THEY DIVERGE ON
    # A HANDFUL OF ROWS BY DESIGN. `patches.v3_0.backfill_outflow_row_direction` stamps `Debit` on
    # every pre-B3 Cashfree and Cashbook row, unscoped by amount, because a stored row carries no
    # trace of which cell it came from. So an old Cashbook top-up or zero-amount spend reads `Debit`
    # where a fresh parse of the same file now leaves it blank. Stated rather than reconciled: a
    # patch is append-only history and records what was true on the day it ran, and nothing reads
    # direction on these two sources today.
    "amount": _StatesWhenPopulated(
        column="Debit", label=DIRECTION_DEBIT, label_field="direction"
    ),
    "status_raw": "Payment Status",
    "beneficiary_name": "To",
    # Who spent it. On a wallet statement this is a real person holding the card, and it becomes the
    # created expense's `payment_by` -- so the record says who spent the money rather than who
    # imported the file.
    "added_by_raw": "From",
    # See capability 1 in the module docstring. `Note` is genuinely optional and often blank.
    "remarks": ("Remark", "Note"),
    "row_kind": "Type",
}

# ⚠️ `Remark` IS REQUIRED, AND IT IS THE ONE ENTRY HERE THAT IS NOT ABOUT IDENTIFYING A ROW. It is
# the ONLY signal this source carries for choosing a project or an expense type -- there is no
# account number to resolve and no reference to look up. A file missing it would parse perfectly and
# then book every single row to a fallback, which is the silent-loss-of-a-signal case the note above
# `_CASHFREE_REQUIRED` exists to prevent, in its most complete form.
#
# `Debit` is required as a COLUMN, not as a value: it is blank on every top-up row by design.
_CASHBOOK_REQUIRED = frozenset(
    {"Txn Id", "Date", "Type", "Debit", "Payment Status", "To", "Remark"}
)

# --- ICICI current-account statement (slice B1) --------------------------------------------------
#
# The bank's own passbook export, and the first source that is a BANK rather than a gateway. What
# that changes, and why almost every note in this block exists: a passbook records POSTINGS to an
# account, not transfers we instructed. So there is no status column, no beneficiary column, no
# beneficiary account, no IFSC, no charges breakdown -- everything about the counterparty is inside
# one free-text narration, and everything about the direction is in which of two money columns the
# bank filled in.
#
# Every cell arrives as a STRING, including the amounts (`'23,00,552.00'`, Indian digit grouping).
# `normalize_amount` already strips every non-digit before parsing, so the grouping needs nothing
# here -- verified against the real export rather than assumed.

# ⚠️ ICICI HAS NO STATUS COLUMN, AND A BLANK STATUS IS NOT A SAFE STAND-IN. A passbook only ever
# lists postings that ALREADY SETTLED -- a failed transfer never appears in it at all -- so
# "SUCCESS" is the truth about every row here, not a convenience.
#
# The cost of leaving it blank is concrete and one-directional: `BANK_TERMINAL_STATUSES` treats an
# unrecognised status as STILL IN FLIGHT (read the note there -- the default leans that way on
# purpose), and the D4 duplicate guard only counts a TERMINAL row as already imported. A blank
# status would therefore make every ICICI row permanently non-duplicable: re-uploading the same
# statement would stage the whole file again, every time, with nothing recognising it as already
# done. The lean that protects a gateway export is exactly wrong for a passbook, so the source
# states the fact its format leaves implicit.
_ICICI_SYNTHETIC_STATUS = BANK_SUCCESS_STATUS

_ICICI_COLUMNS = {
    "transfer_id": "Tran. Id",
    # Capability 6, and the two halves of it are here for two different reasons.
    #
    # ⚠️ `Transaction Date` IS THE DATE A HUMAN MEANS, AND IT IS NOT ALWAYS THE `Value Date`. They
    # differ on 11 of 1,395 rows of the real export, all of them interest postings the bank VALUES a
    # day before it POSTS them (`S47648361`: value 01/Jan/2026, transaction 02/Jan/2026). The value
    # date is an interest-calculation artefact; the transaction date is when the money moved, which
    # is what a reviewer reconciles against and what the batch period should say.
    #
    # ⚠️ THE SWITCH IS SAFE ONLY BECAUSE THERE IS NO HISTORY TO DISAGREE WITH IT, AND THAT WAS
    # MEASURED RATHER THAN ASSUMED (2026-09-08): ZERO `ICICI Bank Statement` batches exist in the
    # live database -- 16 Cashfree and 2 Cashbook, and nothing else. The date is part of
    # `duplicates.row_identity_of`, so on a source with stored rows this change would silently
    # re-open every row whose two dates differ and stage it a second time. Do not port this form to
    # a source that has already imported anything without re-running that count.
    #
    # ⚠️ `Value Date` IS THE FALLBACK, NOT A LEFTOVER. An older 8-column variant of this same export
    # carries no `Transaction Date` column at all, and `_ICICI_REQUIRED` deliberately still names
    # only `Value Date` so that variant keeps importing. Both formats read `%d/%b/%Y` -- see
    # `_DATETIME_FORMATS`. There is no time of day anywhere in this export, so every row lands at
    # midnight, as Cashbook's does.
    "added_on": _FirstPopulated(("Transaction Date", "Value Date")),
    # Capability 3. The pair yields the amount AND the direction in one resolution.
    "amount": _WhicheverIsPopulated(
        columns=("Withdrawal Amt (INR)", "Deposit Amt (INR)"),
        labels=(DIRECTION_DEBIT, DIRECTION_CREDIT),
        label_field="direction",
    ),
    # Populated on 32 of 1,274 rows in the real export -- a cheque number, essentially. It is kept
    # because when it IS there it is the strongest thing on the row, not because it is reliable.
    "reference_id": "Cheque. No./Ref. No.",
    "remarks": "Transaction Remarks",
    # `status_raw`, `beneficiary_name` and `bank_reference_no` have no column at all; they are
    # produced by `_icici_derive` below. `bank_account` and `ifsc` genuinely do not exist in this
    # export -- an IFSC appears inside SOME narrations and is the REMITTER's, never the payee's, so
    # lifting it into `ifsc` would populate an identity field with the wrong bank's code.
}

# Only what a row cannot be identified, dated or read without.
#
# ⚠️ `beneficiary_name` IS DELIBERATELY NOT REQUIRED HERE, AND THAT IS A DIFFERENT DECISION FROM
# CASHFREE'S. Cashfree HAS a beneficiary column, so a file without it is the wrong file. ICICI has
# none, and 141 of 1,274 real rows have no counterparty to name at all: a GST challan
# (`GIB/002058226122/DTAX ...`), an FD closure, an interest posting, a general-ledger transfer
# between our own accounts. A blank is the TRUTH on those rows, and synthesizing a placeholder would
# hand the matcher a party that does not exist. Both money columns are required as COLUMNS, not as
# values -- exactly one of them is blank on every row by design.
#
# ⚠️ `Transaction Date` IS DELIBERATELY ABSENT FROM THIS SET EVEN THOUGH `added_on` NOW PREFERS IT.
# The required set is what decides which row of the sheet IS the header (see `locate_table`) and
# whether a file is this source at all -- requiring the preferred column would refuse the older
# 8-column export outright, which still parses correctly through the `Value Date` fallback. The
# committed `icici_sample.csv` fixture IS that older format, and it stays in the suite as the
# legacy-format guard rather than being regenerated to the current one.
_ICICI_REQUIRED = frozenset(
    {
        "Tran. Id",
        "Value Date",
        "Transaction Remarks",
        "Withdrawal Amt (INR)",
        "Deposit Amt (INR)",
    }
)


def _icici_derive(raw: Callable[[str], str]) -> dict[str, str]:
    """The three fields ICICI states without a column for them.

    Declared here rather than in `_build_row` so that nothing in the row builder knows there is a
    bank called ICICI -- see capability 4 in the module docstring.
    """
    beneficiary_name, bank_reference_no = _icici_counterparty(raw("remarks"))
    return {
        "status_raw": _ICICI_SYNTHETIC_STATUS,
        "beneficiary_name": beneficiary_name,
        "bank_reference_no": bank_reference_no,
    }


_ADAPTERS = {
    "Cashfree": (_CASHFREE_COLUMNS, _CASHFREE_REQUIRED, None),
    "Cashbook": (_CASHBOOK_COLUMNS, _CASHBOOK_REQUIRED, None),
    "ICICI Bank Statement": (_ICICI_COLUMNS, _ICICI_REQUIRED, _icici_derive),
}

# --- ICICI narration parsing ---------------------------------------------------------------------
#
# ⚠️ EVERY RULE BELOW WAS MEASURED AGAINST THE REAL 1,274-ROW STATEMENT AND THE ROW COUNTS ARE
# QUOTED. They are not a reading of a bank's format documentation and they should not be "improved"
# to look more principled -- the narration is a fixed-width field a dozen different clearing
# channels each write differently, and the only test that means anything is how many rows come out
# with the right party on them.
#
# ⚠️ THE PAYEE TEXT IS TRUNCATED PER CHANNEL AND THE CAP IS SILENT -- no ellipsis, no marker. IMPS
# cuts at 10 characters (`CASHFREEID`, `HarshithaG`, `AbdulHanna`), the ICICI internal channels at
# 15-20, cheque clearing at about 25 (`INGENIOUS CONTRACTORS I`). ANY downstream match of this
# value against a vendor master must therefore allow a PREFIX match and must never require
# equality; a full name will simply never arrive here.

_ICICI_NEFT_RTGS = re.compile(r"^(?:NEFT|RTGS)-([^-]+)-([^-]+)")

# The OTHER RTGS narration, which uses slashes instead of hyphens and which nothing reached until
# it was measured against the live payment ledger -- see the branch below.
_ICICI_RTGS_SLASH = re.compile(r"^RTGS/([^/]+)/")

# An Indian IFSC: four letters, a literal `0`, then six alphanumerics. Used ONLY to recognise a
# segment that is a BANK, so it can be skipped when hunting for a party name.
_ICICI_IFSC = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")

# The three-letter DRAWEE BANK CODE a cheque-clearing narration puts where a longer one puts the
# cheque number -- `HSB`, `KMB`, `UTI`, `HDF`, `ICI`, `SBI`, `PNB`, `KCU` on the real file.
_ICICI_DRAWEE_BANK_CODE = re.compile(r"^[A-Z]{3}$")


def _seg(parts: list[str], index: int) -> str:
    """One `/`-separated segment, stripped, or "" when the narration is shorter than expected."""
    if -len(parts) <= index < len(parts):
        return parts[index].strip()
    return ""


def _icici_counterparty(remarks: str) -> tuple[str, str]:
    """(beneficiary name, bank reference) read out of an ICICI narration.

    Returns ("", "") for a narration with no counterparty in it, which is the RIGHT answer on 141
    of 1,274 real rows -- see `_ICICI_REQUIRED`. Nothing is synthesized to fill the gap.
    """
    text = (remarks or "").strip()
    if not text:
        return "", ""

    # NEFT / RTGS -- 103 rows. `NEFT-<ref>-<name>-...`, e.g.
    # `NEFT-AXISP00758480935-HIDECOR PRIVATE LIMITED-STRATOSINFRAPAY6643-...`. The name field itself
    # may contain no hyphen, which is what makes `[^-]+` safe here.
    match = _ICICI_NEFT_RTGS.match(text)
    if match:
        return match.group(2).strip(), match.group(1).strip()

    parts = text.split("/")

    # ⚠️ RTGS ALSO HAS A SLASH FORM, AND IT WAS INVISIBLE UNTIL IT WAS MEASURED AGAINST THE LIVE
    # PAYMENT LEDGER. It fell through to the no-counterparty branch at the bottom, so 9 rows carried
    # no reference at all -- and 6 of them match a `Project Payments.utr` EXACTLY, amount and all
    # (ICICR42026030500502311, ...347, ...349, ...533034, ...533033, ...612013). That took live
    # tier-0 hits from 35 to 41 at zero risk, which is the whole argument for this branch existing.
    #
    #   RTGS/ICICR42026030200538462/IDFB0020101/Cashfree
    #   RTGS/ICICR42026030500502311/UTIB0000468/67453750/BULD67453750  /TARANGFIRESOLUTI/BULD67
    #
    # ⚠️ IT IS TESTED AFTER THE HYPHEN FORM, DELIBERATELY. The two cannot collide -- `^RTGS-` and
    # `^RTGS/` differ on the fifth character -- but the ordering is the thing a reader checks first,
    # and putting the older, higher-volume form ahead of the newer one makes "did this change any
    # existing row?" answerable by inspection rather than by re-running the corpus.
    #
    # The payer is the LAST segment that is neither an IFSC nor a `BULD` batch id: the tail of this
    # narration is a batch id, so counting from either end fails on one of the two shapes. Where
    # nothing qualifies the answer is BLANK -- a `Cashfree`-style single-segment tail is a real
    # party, a run of bank codes is not, and synthesizing one from the latter would hand the matcher
    # a party no human could confirm.
    if _ICICI_RTGS_SLASH.match(text):
        payer = ""
        for segment in reversed([_seg(parts, index) for index in range(2, len(parts))]):
            if segment and not _ICICI_IFSC.match(segment) and not segment.startswith("BULD"):
                payer = segment
                break
        return payer, _seg(parts, 1)

    # IMPS -- 881 rows, 69% of the file, so this is the one rule that decides whether the source is
    # usable at all.
    #
    # ⚠️ THE PAYER IS THE SECOND-TO-LAST SEGMENT. Two shapes occur and only that rule reads both:
    #   5 segments (123 rows): `MMT/IMPS/600219693408/CASHFREEIDFC/IDFB0020101`
    #                          -> payer `CASHFREEIDFC`, last segment is an IFSC
    #   6 segments (758 rows): `MMT/IMPS/601211625341/STRATOS REFUND /SAFETYWALA/Kotak Mahindra`
    #                          -> payer `SAFETYWALA`, segment 3 is a purpose note, last is a bank
    #
    # ⚠️ TWO RULES THAT WERE TRIED AND MEASURED WRONG -- recorded so neither is reintroduced:
    #   * `parts[4]` (fixed position): returns the IFSC `IDFB0020101` on the 122 five-segment rows.
    #   * "the last segment that is not an IFSC": returns the BANK NAME `Kotak Mahindra` on every
    #     six-segment row, because a bank name is not IFSC-shaped.
    # Second-to-last yields 0 blanks across all 881.
    if text.startswith("MMT/IMPS/"):
        return (_seg(parts, -2) if len(parts) >= 5 else ""), _seg(parts, 2)

    # ICICI internal fund transfer -- 73 rows.
    # `INF/INFT/042842249341/BULD64033078   /WIB Office acco`
    if text.startswith("INF/INFT/"):
        return _seg(parts, 4), _seg(parts, 2)

    # NEFT initiated from ICICI's own net banking -- 23 rows, and a DIFFERENT shape from
    # `INF/INFT/` despite the shared prefix. It runs to either 5 or 7 segments and the payee is the
    # last one in both:
    #   `INF/NEFT/IN42602057112627/IDFB0020101/CASHFREEIDFC`
    #   `INF/NEFT/IN42603353754658/KKBK0008071/65659556 /BULD65659556  /RanjanSanjeevKu`
    if text.startswith("INF/NEFT/"):
        return (_seg(parts, -1) if len(parts) >= 4 else ""), _seg(parts, 2)

    # Cash-management collections -- 3 rows.
    # `CMS/ 2000007800/SERENE VIBES PRIVATE LIMITED`
    if text.startswith("CMS/"):
        return (_seg(parts, -1) if len(parts) >= 3 else ""), _seg(parts, 1)

    # Cheque clearing, inward and outward -- 37 `CLG/` rows and 4 `TRF/` rows.
    #
    # ⚠️ THESE WERE MISSING FROM THE ORIGINAL SPEC AND THEY CARRY CLIENT NAMES, which makes them the
    # most valuable rows in the file per row: an inbound cheque is a customer paying us. The name is
    # in the same place in both shapes, which is why it is read positionally rather than by counting
    # segments:
    #   `CLG/DAI SPACES PVT LTD/000190/HDF/23.02.2026...`  (10 rows, all CREDITS -- inbound cheques)
    #   `CLG/SUMAN ELECTRIC UDYOGS P/HSB`                  (31 rows, all DEBITS -- outbound cheques)
    #
    # ⚠️ THE REFERENCE SLOT IS NOT ONE THING, AND TAKING IT BLIND IS WRONG ON THREE ROWS IN FOUR.
    # On the short form segment 2 holds a three-letter DRAWEE BANK CODE, not a transaction
    # reference: `HSB`, `KMB`, `UTI`, `HDF`, `ICI`, `SBI`, `PNB`, `KCU` across all 31 of those rows.
    # A three-letter token is unsafe as an IDENTITY key -- `normalize_reference` would hand the
    # matcher `KMB` as a bank reference, where it can collide with anything and means nothing. It
    # matched nothing in a live tier-0 run, which is the correct outcome and also the reason nobody
    # would have noticed it was garbage. These rows are clearing movements and are meant to reach
    # the matcher on NAME (tier 2), never on reference (tier 0).
    #
    # ⚠️ THE LONG FORM'S SEGMENT 2 IS A GENUINE CHEQUE NUMBER AND IS KEPT. Blanking it wholesale
    # would be a real loss, not a tidy-up: the `Cheque. No./Ref. No.` COLUMN is empty on every one
    # of those 10 rows, so the narration is the only place the cheque number exists. The
    # discriminator is the measured hazard itself -- a bare three-letter alphabetic token is a bank,
    # anything else is a reference -- and not a segment count, because it is the token's SHAPE that
    # makes it dangerous.
    if text.startswith("CLG/") or text.startswith("TRF/"):
        reference = _seg(parts, 2)
        if _ICICI_DRAWEE_BANK_CODE.match(reference):
            reference = ""
        return _seg(parts, 1), reference

    # Everything else -- 141 rows, and a blank is CORRECT for them: government tax challans
    # (`GIB/002058226122/DTAX      /2601...`), interest postings (`Int on FD/RD XXX1083...`), FD
    # closures (`742910001083 FD clos...`), internal ledger moves (`Ac xfr from gl 05051 to 60010`),
    # ATM and bill-payment rows. None of these has a counterparty; inventing one would put a party
    # in front of the matcher that no human could ever confirm.
    return "", ""


# Visible on purpose: a reader of a joined remark can see where one cell ended and the next began,
# and it matches the separator `settle._default_description` already composes with.
_MULTI_COLUMN_JOIN = " - "

SUPPORTED_SOURCES = tuple(sorted(_ADAPTERS))

_DATETIME_FORMATS = (
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%d-%m-%Y %H:%M:%S",
    "%d/%m/%Y %H:%M:%S",
    "%d-%m-%Y",
    "%d/%m/%Y",
    # ICICI writes its `Value Date` as `01/Jan/2026`. It is listed AFTER the numeric forms because
    # it can never collide with them -- `%b` will not read `08` as a month -- so its position costs
    # nothing and the numeric majority keeps matching first.
    "%d/%b/%Y",
)


def parse_statement(
    content: bytes, source: str = "Cashfree", header_row: int | None = None
) -> ParseResult:
    """Parse an uploaded statement into rows plus the batch-level figures.

    Raises `StatementFormatError` for a whole-file problem. Row-level oddities become warnings.

    `header_row` is a 1-BASED override of which sheet row is the header, for the one case
    auto-detection cannot cover: a statement whose header row is not the first row carrying every
    required column. `None` (the default) auto-detects, which is what every caller did before slice
    C3. It is only meaningful for a source with a preamble -- see `locate_table`, which refuses an
    override on any other source rather than accepting one it would have to ignore.
    """
    if source not in _ADAPTERS:
        raise StatementFormatError(
            f"Unsupported outflow source {source!r}. Supported: {', '.join(SUPPORTED_SOURCES)}."
        )
    column_map, required, derive = _ADAPTERS[source]

    has_preamble = source_has_preamble(source)
    grid = _read_grid(content)
    bounds = locate_table(
        grid,
        required=required,
        has_preamble=has_preamble,
        header_row_override=header_row,
        source_label=source,
    )

    fieldnames = list(grid[bounds.header_row - 1])
    records = _records_from_grid(grid, bounds, fieldnames, skip_blank_rows=not has_preamble)

    header_lookup = {h.strip(): h for h in fieldnames}
    rows: list[RawRow] = []
    warnings: list[str] = []

    for position, record in enumerate(records, start=1):
        row = _build_row(position, record, column_map, header_lookup, warnings, derive)
        if row is None:
            continue
        rows.append(row)

    if not rows:
        raise StatementFormatError("The uploaded statement contains no transaction rows.")

    duplicates = _duplicate_transfer_ids(rows, source)
    if duplicates:
        warnings.append(
            f"{len(duplicates)} transfer id(s) appear more than once in this file: "
            + ", ".join(duplicates[:5])
            + ("..." if len(duplicates) > 5 else "")
        )

    dates = [row.added_on_date for row in rows if row.added_on_date]
    # Charges across EVERY row, gross across successful ones only -- see the module docstring.
    gross = sum((row.amount for row in rows if row.is_success), Decimal("0"))
    charges = sum((row.service_charge + row.service_tax for row in rows), Decimal("0"))

    return ParseResult(
        source=source,
        rows=tuple(rows),
        period_from=min(dates) if dates else None,
        period_to=max(dates) if dates else None,
        gross_amount=gross,
        charges_amount=charges,
        duplicate_transfer_ids=duplicates,
        warnings=tuple(warnings),
        # ⚠️ GATED, ON THE SAME CAPABILITY THAT CHOSE THE LAYOUT RULES. A gateway export has no
        # layout question to report and no picker to drive, so it carries neither -- which is what
        # makes the preview's `sheet` block ABSENT for Cashfree and Cashbook rather than present and
        # trivially true. It also keeps a 1,450-row grid off two sources that have no use for one.
        bounds=bounds if has_preamble else None,
        grid=tuple(tuple(row) for row in grid) if has_preamble else (),
    )


def _build_row(
    position: int,
    record: dict,
    column_map: dict,
    header_lookup: dict,
    warnings: list[str],
    derive=None,
) -> RawRow | None:
    def cell(header: str) -> str:
        value = record.get(header_lookup.get(header, header))
        return "" if value is None else str(value)

    # Every either/or pair is resolved ONCE, up front. `raw()` needs the value and the row body
    # needs the label that came with it; resolving twice would be two chances to disagree about the
    # same two cells, which is precisely what capability 3 exists to prevent.
    resolved_pairs = {
        field: _resolve_whichever(mapped, cell)
        for field, mapped in column_map.items()
        if isinstance(mapped, _WhicheverIsPopulated)
    }

    # Capability 5, resolved in the same one-pass spirit: the label a single column states by being
    # populated at all. Blank is a legitimate answer here and carries no warning -- see the class.
    stated_labels = {
        field: (mapped.label if cell(mapped.column).strip() else "")
        for field, mapped in column_map.items()
        if isinstance(mapped, _StatesWhenPopulated)
    }

    # Filled by the adapter's derivation, once the row is known to be a real transfer -- see below.
    overrides: dict[str, str] = {}

    def raw(field: str) -> str:
        """This field's value, however its source states it.

        Read in the order they are tested: a value the adapter DERIVED for this row; each marker
        form; a tuple, which joins several columns into one; and a plain header. A tuple joins only
        the parts that carry something, so a blank optional column leaves no dangling separator and
        a row with one of the two reads exactly as it would have if the other column did not exist.

        The either/or markers were resolved above; here they are only read. `_WhicheverIsPopulated`
        yields the cell its resolution chose, while a `_StatesWhenPopulated` field reads its one
        column exactly as a plain header would -- the marker changes what the row LEARNS from that
        cell, never what the field's value is.

        `_FirstPopulated` is resolved HERE rather than up front, unlike the other two, and the
        difference is that it learns nothing: it produces a value and no label, so there is no
        second reader that could disagree with it about the same cells. A column the file does not
        have reads blank and is passed over, which is how an older export missing its preferred
        column still resolves -- see capability 6.
        """
        if field in overrides:
            return overrides[field]
        header = column_map.get(field)
        if header is None:
            return ""
        if field in resolved_pairs:
            return resolved_pairs[field][0]
        if isinstance(header, _StatesWhenPopulated):
            return cell(header.column)
        if isinstance(header, _FirstPopulated):
            for name in header.columns:
                value = cell(name)
                if value.strip():
                    return value
            return ""
        if isinstance(header, tuple):
            parts = [part for part in (cell(name).strip() for name in header) if part]
            return _MULTI_COLUMN_JOIN.join(parts)
        return cell(header)

    transfer_id = raw("transfer_id").strip()
    if not transfer_id:
        # ⚠️ TWO DIFFERENT THINGS ARRIVE HERE AND ONLY ONE IS WORTH A WARNING. A row with no id but
        # a real amount or status is a TRANSFER WE CANNOT IDENTIFY -- a genuine defect in the export
        # and exactly what this warning was written for. A row with no id, no amount and no status
        # is the totals block at the foot of the sheet: it was never a transfer, so reporting it
        # says nothing and, at six lines per import, trains people to skip the warning list
        # entirely. See capability 2 in the module docstring.
        if raw("amount").strip() or raw("status_raw").strip():
            warnings.append(f"Row {position} has no Transfer Id and was not staged.")
        return None

    # ⚠️ THE DERIVATION RUNS AFTER THE TRANSFER-ID GATE, NOT BEFORE IT, AND THE ORDER IS
    # LOAD-BEARING. The gate above suppresses the totals block by testing that a row has no amount
    # AND no status; a derivation that synthesized a status would make every trailer line look like
    # a transfer missing its id, and bring back the six warnings per import that capability 2 was
    # written to remove.
    if derive is not None:
        overrides.update(derive(raw))

    added_on = _parse_datetime(raw("added_on"))
    if added_on is None:
        warnings.append(f"Row {position} ({transfer_id}) has an unreadable Added On value.")

    # What the row's columns STATED, keyed by the field each marker declared it lands in. Both
    # marker forms write here, so `direction` has one assembly point rather than one per capability
    # -- which is what keeps a single-column source and a two-column one from answering the same
    # question in two places.
    #
    # A pair that is not exactly-one-populated is corrupt input, and the row is staged with the
    # amount and direction BLANK rather than with a guess -- see `_resolve_whichever`.
    labels: dict[str, str] = {}
    for field, label in stated_labels.items():
        labels[column_map[field].label_field] = label
    for field, (_value, label, problem) in resolved_pairs.items():
        marker = column_map[field]
        labels[marker.label_field] = label
        if problem == "both":
            warnings.append(
                f"Row {position} ({transfer_id}) has a value in both "
                f"{' and '.join(marker.columns)}; only one of them can be this transaction, so its "
                f"{field} and {marker.label_field} were left blank."
            )
        elif problem == "neither":
            warnings.append(
                f"Row {position} ({transfer_id}) has no value in either "
                f"{' or '.join(marker.columns)}."
            )

    direction = labels.get("direction", "")

    bank_account = raw("bank_account").strip()
    bank_reference_no = raw("bank_reference_no").strip()

    return RawRow(
        row_number=position,
        transfer_id=transfer_id,
        reference_id=raw("reference_id").strip(),
        added_on=added_on,
        amount=normalize_amount(raw("amount")),
        status_raw=raw("status_raw").strip(),
        beneficiary_name=raw("beneficiary_name").strip(),
        beneficiary_id=raw("beneficiary_id").strip(),
        bank_account=bank_account,
        ifsc=raw("ifsc").strip(),
        # Remarks is kept VERBATIM -- no strip, no truncation. It is stored in a Text column
        # precisely so a long remark survives; as Data it is varchar(140) and Frappe throws
        # CharacterLengthExceededError rather than truncating.
        remarks=raw("remarks"),
        bank_reference_no=bank_reference_no,
        service_charge=normalize_amount(raw("service_charge")),
        service_tax=normalize_amount(raw("service_tax")),
        added_by_raw=raw("added_by_raw").strip(),
        normalized_account=normalize_account(bank_account),
        normalized_reference=normalize_reference(bank_reference_no),
        row_kind=raw("row_kind").strip(),
        direction=direction,
    )


# --- where the table IS, as opposed to what the bytes ARE (slices C1-C3) --------------------------
#
# Two jobs that used to be one function, split because they answer different questions and only one
# of them is source-aware. `_read_grid` turns either format into a grid of strings; `locate_table`
# decides which of that grid's rows are the table. A gateway export makes the second job invisible
# (the whole file IS the table), which is exactly why it was never separated before.


@dataclass(frozen=True)
class TableBounds:
    """WHICH ROWS OF THE SHEET ARE THE TABLE. Every number is 1-BASED, like the sheet's own row
    numbers and like the row number a person reads off the screen.

    ⚠️ 1-BASED THROUGHOUT, WITH NO OFFSET FIELD ANYWHERE. The grid is indexed from 0 and the sheet
    is numbered from 1, and the one place that conversion happens is at the `grid[row - 1]` call
    sites. A second convention here -- or a stored offset for the caller to apply -- is how a header
    picker ends up highlighting the row above the one it read.
    """

    total_rows: int
    """Rows present in the sheet as read, blank ones included. `len(grid)`."""

    detected_header_row: int
    """Where AUTO-DETECTION found the header, independently of any override.

    ⚠️ ON A RETURNED `TableBounds` THIS IS ALWAYS A REAL ROW, NEVER 0, AND SAYING SO SAVES THE NEXT
    READER FROM DEFENDING AGAINST A CASE THAT CANNOT ARISE. Detection failing is a REFUSAL, not a
    result, and an override cannot rescue that: an override is validated against the SAME predicate
    detection searches for -- the row must carry every required column -- so a header row an
    override accepts is by construction one detection would have found. What an override is for is
    DISAGREEMENT, where two rows qualify and the first is not the table.

    Reported anyway, and separately from `header_row`, because that disagreement is the screen's
    whole question: "we read row 17, you asked for row 34" is the only sentence that lets someone
    see they overrode something.
    """

    header_row: int
    """The row actually read as the header."""

    was_overridden: bool
    """True when the CALLER supplied a header row, whether or not it differs from the detected one.

    It reports what the REQUEST said, not what the outcome was: someone who confirms row 17 by hand
    has still made a decision, and a screen that quietly relabels that as auto-detected removes the
    only evidence that a person looked.
    """

    first_data_row: int
    """The first row read as a transaction. Always `header_row + 1`."""

    last_data_row: int
    """The last row read as a transaction. Less than `first_data_row` when the table has no rows."""

    trailing_non_blank_rows: int
    """How many NON-BLANK rows sit below `last_data_row` and were therefore ignored.

    Reported rather than merely dropped because "we ignored 37 rows" is the sentence that lets a
    reader confirm the table ended where they think it did. A count of blank rows would say nothing;
    a count of rows carrying text is the thing worth checking.
    """


def locate_table(
    grid: list[list[str]],
    required,
    has_preamble: bool,
    header_row_override: int | None = None,
    source_label: str = "statement",
) -> TableBounds:
    """Find the header row and the last data row of the table inside `grid`. PURE.

    `required` is the source's required-column set; a row IS the header when its non-blank cells,
    stripped, contain every one of them. Matching is EXACT after strip, and that is what makes the
    search safe on a real passbook: row 8 of an ICICI Detailed Statement reads
    `Transaction Date from:`, which a substring or a prefix rule would happily accept as the
    `Transaction Date` column and place the header nine rows too high.

    `has_preamble` is `sources.source_has_preamble` and decides BOTH halves of the layout, because
    they are one decision -- read that docstring before changing either:

      * `True`  -- SEARCH for the header row, and END the table at the first wholly blank row below
                   it.
      * `False` -- the header is row 1, exactly as it has been since slice S1, and a blank row is
                   SKIPPED rather than treated as the end.

    `header_row_override` is a 1-based row number from the caller. It is VALIDATED rather than
    trusted: in range, and still carrying every required column. A refusal names what is missing,
    because "row 12 is not the header" is not actionable and "row 12 has no Tran. Id column" is.

    Raises `StatementFormatError` when there is no header row to be had. The message names the
    CLOSEST candidate row and exactly which required columns it lacks -- the previous message was a
    bare "The uploaded statement has no header row.", which is true of a wrong file, a wrong source
    and a perfectly good statement with a preamble alike.
    """
    required = frozenset(required)
    total = len(grid)

    # ⚠️ AN OVERRIDE ON A SOURCE WITH NO PREAMBLE IS REFUSED, NOT IGNORED. There is nothing to pick
    # on such a sheet, so a header row arriving for one means the caller believes something about
    # this file that is not true, and quietly reading row 1 anyway would hide that. Row 1 itself is
    # accepted, because it is not a disagreement -- it is the same answer, stated.
    if header_row_override is not None and not has_preamble:
        if _as_row_number(header_row_override, source_label) != 1:
            raise StatementFormatError(
                f"A {source_label} statement writes its header on row 1, so row "
                f"{header_row_override} cannot be it."
            )

    detected = _detect_header_row(grid, required, search=has_preamble)

    if header_row_override is not None:
        header = _as_row_number(header_row_override, source_label)
        if header > total:
            raise StatementFormatError(
                f"This sheet has {total} row(s), so row {header} cannot be its header row."
            )
        missing = sorted(required - _named_cells(grid[header - 1]))
        if missing:
            raise StatementFormatError(
                f"Row {header} is not the header row of a {source_label} statement. "
                f"Missing column(s): {', '.join(missing)}."
            )
    elif detected:
        header = detected
    else:
        raise StatementFormatError(_no_header_message(grid, required, has_preamble, source_label))

    if has_preamble:
        # ⚠️ THE FIRST WHOLLY BLANK ROW ENDS THE TABLE, AND THE ROWS BELOW IT ARE NOT INERT. Four of
        # the five balance lines an ICICI statement closes with put their FIGURE in column B, which
        # on this sheet is the `Tran. Id` column -- so a table read to the end of the file stages
        # them as transfers with ids like `-4,87,90,566.06`. Measured on a real 145-row export: 94
        # rows read where 90 are real.
        last_data = total
        for index in range(header, total):
            if _is_blank_row(grid[index]):
                last_data = index
                break
        trailing = sum(1 for index in range(last_data, total) if not _is_blank_row(grid[index]))
    else:
        # The table runs to the end of the sheet, as it always has. `last_data` is the sheet's last
        # row whether or not it carries anything -- a blank row inside the range is SKIPPED when the
        # records are built, so a trailing blank costs nothing. Nothing surfaces this value on these
        # sources anyway: `ParseResult.bounds` is `None` for them.
        last_data = total
        trailing = 0

    return TableBounds(
        total_rows=total,
        detected_header_row=detected,
        header_row=header,
        was_overridden=header_row_override is not None,
        first_data_row=header + 1,
        last_data_row=last_data,
        trailing_non_blank_rows=trailing,
    )


def _as_row_number(value, source_label: str) -> int:
    """A caller-supplied header row as a positive int, or a refusal naming what arrived.

    ⚠️ `bool` IS REJECTED EXPLICITLY because `True` is an `int` in Python and `isinstance(True, int)`
    is `True` -- so a caller that passed a flag where a row number belongs would silently read row 1
    and look like it worked.
    """
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise StatementFormatError(
            f"{value!r} is not a row number. Give the 1-based row of the {source_label} "
            "statement's header, for example 17."
        )
    return value


def _named_cells(row) -> set:
    """The row's non-blank cells, stripped. What a header row's column NAMES are."""
    return {text for text in ((cell or "").strip() for cell in row) if text}


def _is_blank_row(row) -> bool:
    return not any((cell or "").strip() for cell in row)


def _detect_header_row(grid, required, search: bool) -> int:
    """The 1-based header row, or 0 when there is none to be found.

    ⚠️ THE SEARCH IS GATED, NOT MERELY SHORT-CIRCUITED FOR SPEED. Without `search` this looks at
    row 1 and nowhere else, which is what keeps Cashfree and Cashbook byte-identical: a gateway
    export whose row 1 is wrong must keep failing with a missing-column error rather than quietly
    finding a matching row further down and importing part of a file nobody meant to send.
    """
    if not grid:
        return 0
    candidates = range(len(grid)) if search else range(1)
    for index in candidates:
        if required <= _named_cells(grid[index]):
            return index + 1
    return 0


def _no_header_message(grid, required, has_preamble: bool, source_label: str) -> str:
    """Why no row of this sheet is the header, naming the closest row that tried.

    The old message was `"The uploaded statement has no header row."` on every one of these cases,
    which reads the same for a wrong file, a wrong source and a good statement whose header the
    caller has to point at. Naming the closest candidate and its missing columns is what turns it
    into an instruction.
    """
    if not grid:
        return "The uploaded statement has no header row."

    searched = range(len(grid)) if has_preamble else range(1)
    best_index, best_hits = -1, 0
    for index in searched:
        hits = len(required & _named_cells(grid[index]))
        if hits > best_hits:
            best_index, best_hits = index, hits

    if best_index < 0:
        return (
            f"This does not look like a {source_label} statement. "
            f"Missing column(s): {', '.join(sorted(required))}."
        )

    missing = sorted(required - _named_cells(grid[best_index]))
    where = (
        f" The closest row is row {best_index + 1}, which has {best_hits} of the "
        f"{len(required)} column(s) we need."
        if has_preamble
        else ""
    )
    return (
        f"This does not look like a {source_label} statement. "
        f"Missing column(s): {', '.join(missing)}.{where}"
    )


# --- what the reader will actually read (slice C5) ------------------------------------------------


def column_letter(index: int) -> str:
    """A 0-based grid column index as its spreadsheet letter -- 0 -> `A`, 26 -> `AA`.

    Written here rather than imported from `openpyxl.utils` because this module's openpyxl import is
    deliberately LAZY and inside `_read_xlsx_grid` (see its ImportError branch: a server without
    openpyxl must still read CSVs). A CSV has letters too -- they are the columns of the sheet the
    accountant is looking at, whichever way the file was saved.
    """
    letters = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(ord("A") + remainder) + letters
    return letters


#: What a mapped field is CALLED on screen. The map's key is the `RawRow` field, so a field that
#: gains a column later gets its label here and nowhere else.
_FIELD_LABELS = {
    "transfer_id": "Transfer id",
    "reference_id": "Reference",
    "added_on": "Date",
    "amount": "Amount & direction",
    "status_raw": "Status",
    "beneficiary_name": "Beneficiary",
    "beneficiary_id": "Beneficiary id",
    "bank_account": "Bank account",
    "ifsc": "IFSC",
    "remarks": "Remarks",
    "bank_reference_no": "Bank reference",
    "service_charge": "Service charge",
    "service_tax": "Service tax",
    "added_by_raw": "Added by",
    "row_kind": "Type",
}


def _mapped_column_names(mapped) -> tuple[list[str], str]:
    """(the columns this map value reads, in the order they are consulted; a note or "").

    One place that knows every map form, so the screen's account of what will be read comes from the
    same five capabilities `_build_row` implements rather than from a reader's summary of them.
    """
    if isinstance(mapped, _WhicheverIsPopulated):
        return list(mapped.columns), "whichever one is filled in"
    if isinstance(mapped, _StatesWhenPopulated):
        return [mapped.column], ""
    if isinstance(mapped, _FirstPopulated):
        return list(mapped.columns), "the first one that has a value"
    if isinstance(mapped, tuple):
        return list(mapped), "joined together, in this order"
    return [mapped], ""


def describe_mapped_columns(source: str, header_names) -> list[dict]:
    """"These are the columns I will read", DERIVED FROM THE ADAPTER'S OWN COLUMN MAP.

    ⚠️ DERIVED, NEVER A SECOND HAND-WRITTEN LIST. This is display copy for a screen that exists to
    let someone confirm the parser is reading the right row -- so a hand-maintained list would be
    free to say `Value Date` on the day the map started preferring `Transaction Date`, and the
    screen would then confirm something that is not happening. The one list is `_ADAPTERS`.

    `header_names` is the located header row, verbatim, so the letters are the sheet's own columns.
    A mapped column that this file does NOT have is OMITTED rather than listed without a letter --
    on the older 8-column ICICI export there genuinely is no `Transaction Date` to read, and saying
    so by absence is truer than showing it greyed out.

    A field with no column at all never reaches here: `status_raw`, `beneficiary_name` and
    `bank_reference_no` are DERIVED from the narration on this source (capability 4) and simply are
    not in the map.
    """
    column_map, _required, _derive = _ADAPTERS[source]

    # First occurrence wins: a sheet that repeats a header name has one column we can actually read
    # (the record dict is keyed by name), and it is the first.
    letters: dict[str, str] = {}
    for index, name in enumerate(header_names):
        key = (name or "").strip()
        if key and key not in letters:
            letters[key] = column_letter(index)

    described: list[dict] = []
    for field, mapped in column_map.items():
        names, note = _mapped_column_names(mapped)
        present = [
            {"header": name, "letter": letters[name]} for name in names if name in letters
        ]
        if not present:
            continue
        entry = {
            "label": _FIELD_LABELS.get(field, field.replace("_", " ").capitalize()),
            "columns": present,
        }
        # The note explains a CHOICE between columns, so it is dropped when only one survived --
        # "the first one that has a value" over a single column would describe a decision that is
        # not being made.
        if note and len(present) > 1:
            entry["note"] = note
        described.append(entry)
    return described


def _records_from_grid(grid, bounds: TableBounds, fieldnames, skip_blank_rows: bool) -> list[dict]:
    """The table's data rows as records keyed by header name. ONE builder for both formats.

    ⚠️ A COLUMN WITH A BLANK HEADER IS SKIPPED, because nothing can map to it and Excel leaves a
    trail of them behind every cleared column.

    ⚠️ `skip_blank_rows` IS THE NON-PREAMBLE HALF OF THE LAYOUT GATE, and it is what keeps a blank
    line in a gateway export costing nothing. Where the table ends at the first blank row there can
    be no blank row inside it, so the flag is inert on that path by construction rather than by
    accident.
    """
    records: list[dict] = []
    for index in range(bounds.first_data_row - 1, min(bounds.last_data_row, bounds.total_rows)):
        cells = grid[index]
        if skip_blank_rows and _is_blank_row(cells):
            continue
        record: dict = {}
        for position, name in enumerate(fieldnames):
            if not (name or "").strip():
                continue
            record[name] = cells[position] if position < len(cells) else ""
        records.append(record)
    return records


def _read_grid(content: bytes) -> list[list[str]]:
    """Turn statement bytes into ONE format-blind grid of strings. `grid[0]` is sheet row 1.

    THE FORMAT SEAM, and it is now lower than it was: everything downstream -- finding the header,
    the required-column check, the column map, `_build_row` -- sees a grid and cannot tell which
    format it came from. A format is a way of encoding a table; it must not become a second parser,
    and it must not become a second answer to "which row is the header" either.

    A wholly blank row is PRESERVED as a row (an empty list from a CSV, an all-blank row from a
    workbook), because for a source with a preamble a blank row is the most load-bearing thing in
    the file -- it is where the table ends.
    """
    if _is_xlsx(content):
        return _read_xlsx_grid(content)
    return _read_csv_grid(content)


# --- the .xlsx read bounds (slice XLS-DIM) --------------------------------------------------------
#
# ⚠️ THESE EXIST BECAUSE A REAL CASHFREE EXPORT LIES ABOUT ITS OWN SIZE, and until 2026-08-21 that
# lie made EVERY real .xlsx upload fail -- both sources -- while the committed fixtures passed.
# Cashfree writes `<dimension ref="A1"/>` into the sheet XML: it declares the used range as ONE
# CELL. `read_only=True` TRUSTS that declaration, so openpyxl clipped every row to column A and the
# required-column check reported five of six columns missing while `Added On` -- column A -- was
# found. The "everything except the first column" shape is the signature.
#
# ⚠️ `reset_dimensions = True` DOES NOT FIX IT and must not be reached for: on openpyxl 3.1.5 a
# `ReadOnlyWorksheet` caches `max_row` / `max_column` from the parsed dimension at load time, and
# the flag is only consulted by the non-read-only reader. Measured: still 1 row, 1 column.
#
# PASSING EXPLICIT BOUNDS TO `iter_rows` OVERRIDES THE DECLARATION, which is what these are for.
# Dropping `read_only=True` also works but costs 44 MB against 8 MB on a 5,000-row sheet, for no
# gain -- so the mode stays and the bounds do the work.
#
# ⚠️ `_MAX_SCAN_ROWS` IS EXCEL'S OWN ROW CEILING, DELIBERATELY. It can therefore never truncate a
# workbook that Excel could open, which is the whole point: a cap that silently drops the tail of a
# real statement would be a worse defect than the one this fixes. It is not a performance guard and
# does NOT cost a million iterations -- openpyxl stops at the last row that actually holds data
# (measured: 5,001 rows read in the same 5.0s as an unbounded pass).
_MAX_SCAN_ROWS = 1_048_576

# ⚠️ `_MAX_SCAN_COLUMNS` IS A REAL CEILING AND SO IT IS GUARDED, unlike the row one. Every cell up
# to it is materialised per row, so it cannot be set to Excel's 16,384 -- at 5,000 rows the cost is
# 14 MB at 200 against 8 MB at the true width. A statement with more columns than this would be
# silently short-read, so `_read_xlsx_grid` REFUSES rather than proceeding when a row fills the
# scan width. Loud beats quiet: a missing-column error naming a real cause is recoverable, a
# statement parsed with its tail chopped off is not.
_MAX_SCAN_COLUMNS = 200


def _is_xlsx(content: bytes) -> bool:
    """An .xlsx is a ZIP archive, so it starts with the ZIP local-file-header magic.

    Sniffing beats trusting the extension: a renamed export is common, and the failure mode of
    guessing wrong is a baffling "missing column" error rather than an honest one.
    """
    return isinstance(content, (bytes, bytearray)) and bytes(content[:4]) == b"PK\x03\x04"


def _read_csv_grid(content: bytes) -> list[list[str]]:
    """Every line of the CSV as a row of cells. A blank line comes back as an EMPTY row.

    `csv.reader` rather than `csv.DictReader`, which is the whole C1 change on this side: a
    DictReader has already decided that row 1 is the header, which is precisely the decision that
    had to move out of the format layer.
    """
    text = _decode(content)
    if not text.strip():
        raise StatementFormatError("The uploaded statement is empty.")
    return [list(row) for row in csv.reader(io.StringIO(text))]


def _read_xlsx_grid(content: bytes) -> list[list[str]]:
    """Every row of the FIRST worksheet of an .xlsx, as strings.

    ⚠️ `data_only=True` returns a formula cell's CACHED VALUE. A workbook saved by a tool that never
    calculated would hand us `None` there -- which surfaces as an empty field and a row-level
    warning, not a wrong number. Reading the formula TEXT instead would be far worse: it would
    parse as a garbage amount.

    ⚠️ Values arrive TYPED here and as text from a CSV -- a date cell is a `datetime`, an amount a
    `float`. Everything is stringified so `_build_row` sees exactly what it sees from a CSV and
    there is one set of coercion rules, not two. `str(datetime)` yields "YYYY-MM-DD HH:MM:SS",
    which `_parse_datetime` already accepts; that is why the format list carries it.

    ⚠️ THE ITERATION IS BOUNDED AND THAT IS LOAD-BEARING, NOT TIDINESS. A real Cashfree export
    declares `<dimension ref="A1"/>` and `read_only=True` believes it. See `_MAX_SCAN_ROWS` /
    `_MAX_SCAN_COLUMNS` above for the full account; do not "simplify" the bounds away.
    """
    try:
        from openpyxl import load_workbook
    except ImportError as exc:  # pragma: no cover -- openpyxl ships with Frappe
        raise StatementFormatError(
            "This server cannot read .xlsx statements. Save the sheet as .csv and upload that."
        ) from exc

    try:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise StatementFormatError(
            "The uploaded file looks like a spreadsheet but could not be opened."
        ) from exc

    grid: list[list[str]] = []
    try:
        if not workbook.sheetnames:
            raise StatementFormatError("The uploaded workbook has no sheets.")
        sheet = workbook[workbook.sheetnames[0]]

        # ⚠️ BOUNDED ON PURPOSE -- an unbounded `iter_rows()` obeys the sheet's DECLARED dimension,
        # and a real Cashfree export declares `A1`. See `_MAX_SCAN_ROWS` / `_MAX_SCAN_COLUMNS`.
        for cells in sheet.iter_rows(
            values_only=True, max_row=_MAX_SCAN_ROWS, max_col=_MAX_SCAN_COLUMNS
        ):
            row = [("" if cell is None else str(cell)) for cell in (cells or ())]
            # Trailing empties are the padding out to `_MAX_SCAN_COLUMNS` plus whatever Excel left
            # behind when a column was cleared. Trimming them here is what makes a wholly blank row
            # come back as `[]`, which is how `locate_table` recognises the end of the table.
            while row and not row[-1].strip():
                row.pop()
            # ⚠️ NOTHING WAS TRIMMED => THIS ROW REACHED THE SCAN WIDTH, so there may be columns
            # beyond it that were never read. Refuse rather than parse a statement with its tail
            # silently chopped off.
            #
            # ⚠️ IT NOW GUARDS EVERY ROW, WHERE BEFORE SLICE C1 IT GUARDED THE HEADER ROW ONLY, and
            # the widening is forced rather than gratuitous: which row is the header is no longer
            # known at read time. A full row is the same evidence of a short read wherever it sits,
            # and this direction is the safe one -- it refuses a file we could not have read whole.
            if len(row) >= _MAX_SCAN_COLUMNS:
                raise StatementFormatError(
                    f"This statement has more than {_MAX_SCAN_COLUMNS} columns, which is more than "
                    "we can read. Remove the unused columns, or save it as .csv and upload that."
                )
            grid.append(row)
    finally:
        workbook.close()

    return grid


def _duplicate_transfer_ids(rows: list[RawRow], source: str = "") -> tuple[str, ...]:
    """Transfer ids that appear MORE THAN ONCE AS THE SAME TRANSFER within this one statement.

    ⚠️ IT REPEATS ON IDENTITY BUT REPORTS THE ID (slice D3). The two halves are deliberate:

    * Repeats are counted on `duplicates.row_identity_of`, because `_stage_batch` marks its
      `duplicate_in_file` rows on exactly that key. Leaving this on `transfer_id` alone would let
      the preview call two rows repeated while staging called them distinct -- the same file,
      two answers.
    * What comes BACK is still the transfer id, because `duplicate_transfer_ids` is an API payload
      field typed `string[]` on the client. Returning tuples would be a wire change for a list
      nothing currently renders.

    ⚠️ AND THE KEY IS SOURCE-AWARE, WHICH IS WHY `source` IS THREADED IN FROM `parse_statement`
    (slice B3a). Slice B3 widened the identity for a bank passbook to five fields and moved the
    other two readers onto it; this one was left on the triple, so an ICICI statement's preview
    over-reported -- it named 5 ids as repeated on the real 1,274-row export while staging, on the
    wide key, correctly kept all 1,274 rows distinct. The divergence pointed the safe way (nothing
    was dropped, a reviewer was merely sent to look at rows that were all present) but it is exactly
    the "same file, two answers" the note above exists to forbid, so it is closed here rather than
    by narrowing the staging key back.

    ⚠️ THE DEFAULT IS THE TRIPLE, NOT A GUESS. `source=""` is outside `WIDE_IDENTITY_SOURCES`, so a
    caller that passes nothing gets the legacy key byte-identically -- and so do Cashfree and
    Cashbook, whose duplicate behaviour is proven in production and must not move.

    A consequence worth being explicit about: one id carried twice at two DIFFERENT amounts is no
    longer reported here, because those are now two different transfers that happen to share an id.
    """
    seen: set = set()
    repeated: list[str] = []
    for row in rows:
        identity = row_identity_of(row, source)
        if identity in seen and row.transfer_id not in repeated:
            repeated.append(row.transfer_id)
        seen.add(identity)
    return tuple(repeated)


def _decode(content: bytes) -> str:
    """Decode statement bytes, preferring UTF-8 and falling back rather than failing.

    `utf-8-sig` first because a spreadsheet-exported CSV routinely carries a BOM, which would
    otherwise become part of the first header name and break the required-column check with a
    baffling message.
    """
    if isinstance(content, str):
        return content
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise StatementFormatError("The uploaded statement could not be decoded as text.")


def _parse_datetime(value: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        pass
    for fmt in _DATETIME_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None
