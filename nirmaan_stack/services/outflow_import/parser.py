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

Adding a source (e.g. Cashbook) is a new entry in `_ADAPTERS` -- a column map plus its required
set. No other code in this module is source-aware.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from nirmaan_stack.services.outflow_import.normalize import (
    normalize_account,
    normalize_amount,
    normalize_reference,
)

__all__ = [
    "RawRow",
    "ParseResult",
    "StatementFormatError",
    "parse_statement",
    "SUPPORTED_SOURCES",
]


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

    @property
    def is_success(self) -> bool:
        return self.status_raw.strip().upper() == "SUCCESS"

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

    @property
    def success_count(self) -> int:
        return sum(1 for row in self.rows if row.is_success)


# --- source adapters ---------------------------------------------------------------------------
#
# A statement may carry columns we ignore entirely (VPA, Acknowledged, Mode, Status Code, Payment
# Instrument ID, Last checked at, Status Description, Extended UTR). Unknown columns are fine;
# a MISSING required column is not, because the matcher would then silently lose a signal.

_CASHFREE_COLUMNS = {
    "transfer_id": "Transfer Id",
    "reference_id": "Reference Id",
    "added_on": "Added On",
    "amount": "Amount",
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

_ADAPTERS = {
    "Cashfree": (_CASHFREE_COLUMNS, _CASHFREE_REQUIRED),
}

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
)


def parse_statement(content: bytes, source: str = "Cashfree") -> ParseResult:
    """Parse an uploaded statement into rows plus the batch-level figures.

    Raises `StatementFormatError` for a whole-file problem. Row-level oddities become warnings.
    """
    if source not in _ADAPTERS:
        raise StatementFormatError(
            f"Unsupported outflow source {source!r}. Supported: {', '.join(SUPPORTED_SOURCES)}."
        )
    column_map, required = _ADAPTERS[source]

    text = _decode(content)
    if not text.strip():
        raise StatementFormatError("The uploaded statement is empty.")

    reader = csv.DictReader(io.StringIO(text))
    headers = [h.strip() for h in (reader.fieldnames or [])]
    if not headers:
        raise StatementFormatError("The uploaded statement has no header row.")

    missing = sorted(required - set(headers))
    if missing:
        raise StatementFormatError(
            f"This does not look like a {source} statement. Missing column(s): {', '.join(missing)}."
        )

    header_lookup = {h.strip(): h for h in (reader.fieldnames or [])}
    rows: list[RawRow] = []
    warnings: list[str] = []

    for position, record in enumerate(reader, start=1):
        row = _build_row(position, record, column_map, header_lookup, warnings)
        if row is None:
            continue
        rows.append(row)

    if not rows:
        raise StatementFormatError("The uploaded statement contains no transaction rows.")

    duplicates = _duplicate_transfer_ids(rows)
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
    )


def _build_row(
    position: int,
    record: dict,
    column_map: dict,
    header_lookup: dict,
    warnings: list[str],
) -> RawRow | None:
    def raw(field: str) -> str:
        header = column_map.get(field)
        if header is None:
            return ""
        value = record.get(header_lookup.get(header, header))
        return "" if value is None else str(value)

    transfer_id = raw("transfer_id").strip()
    if not transfer_id:
        warnings.append(f"Row {position} has no Transfer Id and was not staged.")
        return None

    added_on = _parse_datetime(raw("added_on"))
    if added_on is None:
        warnings.append(f"Row {position} ({transfer_id}) has an unreadable Added On value.")

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
    )


def _duplicate_transfer_ids(rows: list[RawRow]) -> tuple[str, ...]:
    seen: set[str] = set()
    repeated: list[str] = []
    for row in rows:
        if row.transfer_id in seen and row.transfer_id not in repeated:
            repeated.append(row.transfer_id)
        seen.add(row.transfer_id)
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
