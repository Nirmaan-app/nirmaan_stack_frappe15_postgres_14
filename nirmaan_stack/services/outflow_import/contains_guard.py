# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The ICICI contains-guard: is this bank-statement line's money ALREADY RECORDED? (#1257, #1252)

PURE MODULE -- no `frappe`, no database, no request context. It imports three pure leaves from its
own package (`amounts`, `ledgers`, `normalize`) and nothing else; `test_contains_guard.TestPurity`
holds it there. The one query that feeds it is `candidates.load_recorded_by_contains`.

⚠️ THIS IS A HEURISTIC SKIP, AND IT IS ALLOWED BY A FRESH OWNER RULING, FOR ICICI ONLY (2026-09-13/14).
The older principle of this feature -- "a duplicate guard never skips on a heuristic" (see
`review._paid_duplicate_for`) -- still governs every OTHER guard. It is superseded here and nowhere
else, because a bank passbook carries no clean reference of its own: the reference a person typed
onto a payment sits somewhere INSIDE a long narration (`MMT/IMPS/600219693408/...`), so an exact
compare found 40 of the real statement's already-recorded lines where this finds 196 (every
one of the 40 among them). Do not port any of
these rules to the Cashfree guards (`candidates.load_paid_*_by_reference` stay whole-string exact),
and do not widen `matcher.match_by_reference`.

THE RULES, IN THE ORDER A LINE MEETS THEM

  1. LEDGER BY DIRECTION. A withdrawal (Debit) is checked against Paid Project Payments, Paid
     Project Expenses and Paid Non Project Expenses; a deposit (Credit) against every Project Inflow
     (inflows have no status). Direction is never crossed. A line with NO direction is checked
     against nothing -- the parser leaves it blank only when it refuses to guess, and guessing here
     would be the crossing the ruling forbids.
  2. ELIGIBLE TOKENS. A stored reference is split on non-alphanumerics into pieces, and the whole
     string (upper-cased, whitespace removed) is kept too. A token counts only if it is at least 6
     characters, holds a digit, and is not a `BULD` batch id; a reference beginning `DUMMY-` yields
     no token at all. So `ICICI`, `Cashbook`, `refund`, `TDS Receivable` and short codes never hit.
  3. A HIT is an eligible token that EQUALS the line's transfer id, or APPEARS INSIDE the line's
     match surface (both normalised the same way).
  4. THE DATE WINDOW. A hit counts only when the record's payment date is within
     `CONTAINS_GUARD_WINDOW_DAYS` of the line. It applies to THIS guard only.
  5. THE VERDICT. Skip when one hit record, or a same-reference group, or the sum of all hits
     agrees with the line within the SETTLE window (`amounts.amounts_match`, +-Rs 5 -- never
     stretched to reach TDS). Otherwise the line is `Mismatched` with a note naming every hit. The
     sentences are `status`'s; this module only picks the group they describe.
  6. ONE RECORD JUSTIFIES ONE LINE, ACROSS ALL IMPORTS (#1258). A record already accounting for a
     statement line -- the basis of another line's duplicate skip, or settled / created by an import
     row -- is a `RecordClaim`, and it cannot skip a DIFFERENT line. The pick is tried on the
     unclaimed hits first, so a genuine second payment recorded under the same reference still
     skips on its own record; only when nothing but a claimed record would agree is the line
     `Mismatched`, its group carrying `used_by` so the note names the record and where it was used.
     A line's own claim never blocks it.

     Why it exists: a counterparty's bank ACCOUNT NUMBER typed as a reference sits in every
     narration to that counterparty, so without this last month's record would silently hide next
     month's genuine payment of the same amount. It applies to THIS guard only -- the exact guards
     keep their behaviour -- and re-importing the same statement line is still caught at upload.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Iterable, Sequence

from nirmaan_stack.services.outflow_import.amounts import amounts_match
from nirmaan_stack.services.outflow_import.ledgers import (
    INFLOW_DOCTYPE,
    NON_PROJECT_EXPENSE_DOCTYPE,
    PAYMENT_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_reference

__all__ = [
    "CONTAINS_GUARD_WINDOW_DAYS",
    "MIN_TOKEN_LENGTH",
    "RecordedGroup",
    "RecordClaim",
    "claims_of_skip",
    "skip_basis",
    "BASIS_DOCTYPE_KEY",
    "BASIS_NAME_KEY",
    "basis_entries",
    "encode_basis",
    "decode_basis",
    "ledgers_for_direction",
    "match_surface",
    "line_surface",
    "reference_tokens",
    "find_hits",
    "pick_recorded_group",
]

#: Days either side of the statement line a record's payment date may sit (owner ruling, #1252).
#: Measured on the real statement: every genuine skip was 7 days apart or less.
CONTAINS_GUARD_WINDOW_DAYS = 15

#: The shortest token that may hit. Short codes (`0003`, cheque suffixes) collide with any narration.
MIN_TOKEN_LENGTH = 6

# ⚠️ SPELLED HERE, NOT IMPORTED FROM `parser` (which is not a leaf) -- the precedent
# `status.ROW_DIRECTION_CREDIT` sets. `test_contains_guard` drives both values through the rules.
_DEBIT = "Debit"
_CREDIT = "Credit"

_LEDGERS_BY_DIRECTION: dict[str, tuple[str, ...]] = {
    _DEBIT: (PAYMENT_DOCTYPE, PROJECT_EXPENSE_DOCTYPE, NON_PROJECT_EXPENSE_DOCTYPE),
    _CREDIT: (INFLOW_DOCTYPE,),
}

# The order a group's records are listed in: the note's own ledger order, then by name.
_LEDGER_ORDER = {d: i for i, d in enumerate(
    (PAYMENT_DOCTYPE, PROJECT_EXPENSE_DOCTYPE, NON_PROJECT_EXPENSE_DOCTYPE, INFLOW_DOCTYPE)
)}

_PIECE_SPLIT = re.compile(r"[^A-Za-z0-9]+")
_HAS_DIGIT = re.compile(r"\d")
_BATCH_ID = re.compile(r"^BULD\d+$")
_DUMMY_PREFIX = "DUMMY-"
_LONG_NUMBER = re.compile(r"\d{6,}")


@dataclass(frozen=True)
class RecordClaim:
    """One record already accounting for one statement line (#1258).

    `settled` is False for the basis of a duplicate skip (read from `Outflow Import Row.
    duplicate_basis`) and True for a record an import row settled or created (a `Settled`
    `Outflow Row Match`). `import_row` is what lets a line ignore its own claim.
    """

    doctype: str
    name: str
    import_row: str
    import_batch: str
    settled: bool = False


@dataclass(frozen=True)
class RecordedGroup:
    """The records a line duplicates, in the shape `status._failed_or_already_paid` reads.

    `used_by` is empty unless the group WOULD skip the line but a record in it already accounts
    for another line (#1258); `status.derive_duplicate_guard_outcome` then reads it as `Mismatched`.
    """

    targets: tuple
    used_by: tuple = ()

    @property
    def total_amount(self) -> Decimal:
        return sum((Decimal(str(t.amount or 0)) for t in self.targets), Decimal("0"))


def ledgers_for_direction(direction: str | None) -> tuple[str, ...]:
    """The ledgers a line of this direction is checked against; `()` for no or an unknown direction."""
    return _LEDGERS_BY_DIRECTION.get((direction or "").strip(), ())


def match_surface(narration: str | None, cheque_number: str | None) -> str:
    """The text a line's references are searched in -- and, from #1259, the text a settle stores.

    ⚠️ ONE FUNCTION FOR BOTH, SO THEY CAN NEVER DIVERGE. A record written with this text must be found
    again by this guard when the same money reappears on a later statement.

    The narration, unless it carries no run of 6+ digits and the cheque column is filled -- a cheque
    clearing line (`CLG/SUMAN ELECTRIC UDYOGS P/HSB`) -- in which case the cheque number is appended.
    Without it two such lines for the same payee and amount are the same text, and the second
    cheque would be hidden as a duplicate of the first.
    """
    text = (narration or "").strip()
    cheque = (cheque_number or "").strip()
    if cheque and not _LONG_NUMBER.search(text):
        return f"{text} {cheque}".strip()
    return text


def line_surface(row) -> str:
    """A staged line's match surface, NORMALISED -- the one form both the pure hit test and the
    query compare against. Reads `remarks` (the narration) and `reference_id` (the cheque column)."""
    return normalize_reference(
        match_surface(getattr(row, "remarks", ""), getattr(row, "reference_id", ""))
    )


def reference_tokens(stored_reference: str | None) -> frozenset[str]:
    """Every normalised token of a stored reference that may hit. Empty when none is eligible."""
    whole = normalize_reference(stored_reference)
    if not whole or whole.startswith(_DUMMY_PREFIX):
        return frozenset()
    pieces = {p.upper() for p in _PIECE_SPLIT.split(str(stored_reference)) if p}
    return frozenset(t for t in (whole, *pieces) if _is_eligible(t))


def _is_eligible(token: str) -> bool:
    return (
        len(token) >= MIN_TOKEN_LENGTH
        and bool(_HAS_DIGIT.search(token))
        and not _BATCH_ID.match(token)
    )


def find_hits(row, records: Iterable) -> tuple:
    """The records this line hits: right ledger for its direction, a token hit, inside the window.

    `row` is read by attribute: `direction`, `transfer_id`, `remarks` (the narration),
    `reference_id` (the cheque column) and `added_on`. A record needs `doctype`, `name`, `amount`,
    `reference` and `txn_date` (its payment date). The result is in a stable order, so the pick
    never depends on the order a query happened to return rows in.
    """
    ledgers = ledgers_for_direction(getattr(row, "direction", ""))
    row_date = _as_date(getattr(row, "added_on", None))
    if not ledgers or row_date is None:
        return ()
    transfer_id = normalize_reference(getattr(row, "transfer_id", ""))
    surface = line_surface(row)

    hits = []
    for rec in records:
        if rec.doctype not in ledgers or not _within_window(row_date, _as_date(rec.txn_date)):
            continue
        tokens = reference_tokens(rec.reference)
        if any(t == transfer_id or t in surface for t in tokens):
            hits.append(rec)
    return tuple(sorted(hits, key=_record_order))


def pick_recorded_group(
    row, hits: Sequence, claims: Iterable[RecordClaim] = ()
) -> RecordedGroup | None:
    """The group this line duplicates, or the group its `Mismatched` note names, or `None`.

    In precedence order, the first that agrees with the line inside the settle window:
      1. one record (the closest amount, then the nearest date, then the name);
      2. records sharing one stored reference (a transfer split across several records);
      3. every hit together (one line covering several differently-referenced records).
    When none agrees, every hit comes back, so the note names them all.

    ⚠️ ONE RECORD, ONE LINE (#1258). `claims` are the records already accounting for some line; a
    claim whose `import_row` is this line's own `name` is ignored, so re-running a batch never
    blocks the skip it already made. The precedence above runs over the UNCLAIMED hits first. Only
    if that finds nothing agreeing, and the same precedence over EVERY hit would agree, is the group
    returned carrying `used_by` -- the claims on its records -- which reads as `Mismatched`.
    An amount-off hit is unaffected: whether or not its record is used, it would not skip.

    ⚠️ AN AMOUNT-WINDOW SITE, listed in `amounts.py`. It picks with `amounts_match`, the same window
    `status._failed_or_already_paid` then judges the group with, so the pick and the verdict can
    never disagree.
    """
    if not hits:
        return None
    own = getattr(row, "name", "") or ""
    used: dict[tuple[str, str], list[RecordClaim]] = {}
    for c in claims:
        if c.import_row != own:
            used.setdefault((c.doctype, c.name), []).append(c)

    free = tuple(h for h in hits if _key(h) not in used)
    if free and len(free) < len(hits):
        group = _pick(row, free)
        if _agrees(row, group):
            return group

    group = _pick(row, hits)
    blocking = [c for t in group.targets for c in used.get(_key(t), ())]
    if blocking and _agrees(row, group):
        return RecordedGroup(targets=group.targets, used_by=tuple(sorted(set(blocking), key=_claim_order)))
    return group


def claims_of_skip(row, batch: str, group: RecordedGroup) -> tuple[RecordClaim, ...]:
    """The claims a line's duplicate skip on `group` makes -- one per record, so a later line in the
    same run sees them exactly as it would see a skip persisted by an earlier batch."""
    return tuple(
        RecordClaim(doctype=t.doctype, name=t.name, import_row=row.name, import_batch=batch)
        for t in group.targets
    )


def skip_basis(row, group: RecordedGroup | None, skipped: bool) -> tuple:
    """The records a line's SKIP was based on, or `()` (#1258).

    `skipped` is whether the line's outcome is `Skipped`. A successful line reaches `Skipped` from
    this guard only by agreeing with an unblocked group; `is_success` is checked because a failed
    line is also `Skipped` -- for a reason that used no record, so it must claim none.
    """
    if not skipped or group is None or group.used_by or not getattr(row, "is_success", False):
        return ()
    return tuple(group.targets)


# ⚠️ THE ONE OWNER OF THE `Outflow Import Row.duplicate_basis` SHAPE (#1258, ADR-0010 B2): a JSON list
# of `{target_doctype, target_name}`, the same entry shape the row links use. The SQL reader
# (`candidates.load_record_claims`) reads these two key names from here.
BASIS_DOCTYPE_KEY = "target_doctype"
BASIS_NAME_KEY = "target_name"


def basis_entries(targets) -> list[dict]:
    """Records as `{target_doctype, target_name}` entries, in the order given."""
    return [{BASIS_DOCTYPE_KEY: t.doctype, BASIS_NAME_KEY: t.name} for t in targets]


def encode_basis(targets) -> str | None:
    """The stored `duplicate_basis` for these records: a JSON list, or `None` when there are none."""
    return json.dumps(basis_entries(targets)) if targets else None


def decode_basis(value) -> list[dict]:
    """A stored `duplicate_basis` (JSON text, or already parsed) back as entries; `[]` for blank or
    malformed data, so a hand-edited value can never fail a page."""
    if isinstance(value, str):
        try:
            value = json.loads(value) if value.strip() else []
        except ValueError:
            return []
    if not isinstance(value, list):
        return []
    return [
        {BASIS_DOCTYPE_KEY: e[BASIS_DOCTYPE_KEY], BASIS_NAME_KEY: e[BASIS_NAME_KEY]}
        for e in value
        if isinstance(e, dict) and e.get(BASIS_DOCTYPE_KEY) and e.get(BASIS_NAME_KEY)
    ]


def _pick(row, hits: Sequence) -> RecordedGroup:
    bank = Decimal(str(getattr(row, "amount", 0) or 0))
    row_date = _as_date(getattr(row, "added_on", None))

    # `sorted` is stable and `hits` arrives in `_record_order`, so the name is the last tie-break.
    singles = sorted(
        (h for h in hits if amounts_match(h.amount, bank)),
        key=lambda h: (
            abs(Decimal(str(h.amount or 0)) - bank),
            abs((_as_date(h.txn_date) - row_date).days) if row_date else 0,
        ),
    )
    if singles:
        return RecordedGroup(targets=(singles[0],))

    by_reference: dict[str, list] = {}
    for hit in hits:
        by_reference.setdefault(normalize_reference(hit.reference), []).append(hit)
    for reference in sorted(by_reference):
        group = RecordedGroup(targets=tuple(by_reference[reference]))
        if len(group.targets) > 1 and amounts_match(group.total_amount, bank):
            return group

    return RecordedGroup(targets=tuple(hits))


def _agrees(row, group: RecordedGroup) -> bool:
    return amounts_match(group.total_amount, Decimal(str(getattr(row, "amount", 0) or 0)))


def _key(rec) -> tuple[str, str]:
    return (rec.doctype, rec.name)


def _claim_order(c: RecordClaim) -> tuple:
    return (_LEDGER_ORDER.get(c.doctype, len(_LEDGER_ORDER)), c.name, c.import_batch, c.import_row)


def _within_window(row_date: date, record_date: date | None) -> bool:
    return record_date is not None and abs((record_date - row_date).days) <= CONTAINS_GUARD_WINDOW_DAYS


def _as_date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def _record_order(rec) -> tuple:
    return (_LEDGER_ORDER.get(rec.doctype, len(_LEDGER_ORDER)), rec.doctype, rec.name)
