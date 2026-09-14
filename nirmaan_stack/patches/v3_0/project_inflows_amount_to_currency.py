# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Convert `Project Inflows.amount` from text to Currency, proving nothing was lost (#1255).

WHY PRE-MODEL-SYNC
    The doctype JSON now says Currency, so model sync wants `decimal(21,9)`. Frappe's PostgreSQL
    `alter()` only writes a `USING` cast for Datetime and Check -- for Currency it emits a bare
    `ALTER COLUMN amount TYPE decimal(21,9)`, which PostgreSQL refuses for a varchar column
    ("cannot be cast automatically"). So this runs FIRST and does the cast itself; by the time
    model sync looks, the column is already numeric and its re-alter is numeric -> numeric.

REFUSE, NEVER COERCE
    Every value must be a clean decimal that fits `decimal(21,9)` exactly. An empty string, a
    thousands separator, a word, `NaN` or an exponent is REFUSED, and the error names every such
    row. Nothing is ever turned into 0: a junk amount that silently became 0 would under-state
    receipts with no error anywhere. NULL stays NULL -- that cast is lossless.

PROVE IT
    Row count, non-null count and the exact Decimal SUM are recorded before the ALTER and
    re-asserted after it. PostgreSQL DDL is transactional, so a mismatch rolls the ALTER back.

IDEMPOTENT
    An already-numeric column (a second run, or a fresh site created as Currency) is a no-op.
"""

import re
from decimal import Decimal, InvalidOperation

import frappe

TABLE = "tabProject Inflows"
COLUMN = "amount"

# Frappe's PostgreSQL type for Currency: `decimal(21,9)` -- 12 integer digits, 9 fraction digits.
_TARGET_TYPE = "decimal(21,9)"
_MAX_ABS = Decimal(10) ** 12
_QUANTUM = Decimal("1e-9")
_TEXT_TYPES = {"character varying", "text", "character"}
# ASCII digits only, on purpose: Python's `\d` and `Decimal` accept e.g. Arabic-Indic digits, which
# PostgreSQL's cast refuses -- the ALTER would then fail without naming the row.
_CLEAN = re.compile(r"[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)")
# The whitespace PostgreSQL's numeric input skips. `str.strip()` would also eat e.g. a no-break space.
_ASCII_SPACE = " \t\n\r\f\v"


def execute():
    result = convert_text_column_to_currency(TABLE, COLUMN)
    if result["status"] == "converted":
        print(
            f"    {TABLE}.{COLUMN} -> {_TARGET_TYPE}: "
            f"{result['count']} rows, SUM {result['sum']} (unchanged)"
        )
    else:
        print(f"    {TABLE}.{COLUMN} already numeric -- nothing to do")


def _parse_clean(value: str) -> Decimal | None:
    """The exact Decimal a clean amount holds, or None when it is not clean."""
    text = value.strip(_ASCII_SPACE)
    if not _CLEAN.fullmatch(text):
        return None
    try:
        amount = Decimal(text)
    except InvalidOperation:
        return None
    if abs(amount) >= _MAX_ABS or amount != amount.quantize(_QUANTUM):
        return None
    return amount


def _column_type(table: str, column: str) -> str | None:
    rows = frappe.db.sql(
        """SELECT data_type FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = %s AND column_name = %s""",
        (table, column),
    )
    return rows[0][0] if rows else None


def _measure(table: str, column: str) -> tuple[int, int, Decimal]:
    # SUM is read as TEXT: Frappe's PostgreSQL adapter hands numerics back as floats, and a float
    # SUM could compare "equal" across a real loss in the ninth decimal place.
    count, non_null, total = frappe.db.sql(
        f'SELECT COUNT(*), COUNT("{column}"), SUM("{column}")::text FROM "{table}"'
    )[0]
    return count, non_null, Decimal(total) if total is not None else Decimal(0)


def convert_text_column_to_currency(table: str, column: str) -> dict:
    """Cast a text column to `decimal(21,9)` with zero loss, or refuse and alter nothing."""
    data_type = _column_type(table, column)
    if data_type is None or data_type == "numeric":
        return {"status": "skipped"}
    if data_type not in _TEXT_TYPES:
        frappe.throw(f"{table}.{column} is {data_type}; expected text or numeric, refusing to convert")

    rows = frappe.db.sql(f'SELECT name, "{column}" FROM "{table}" ORDER BY name')
    offenders = []
    before_sum = Decimal(0)
    before_non_null = 0
    for name, value in rows:
        if value is None:
            continue
        amount = _parse_clean(value)
        if amount is None:
            offenders.append(f"{name} ({value!r})")
            continue
        before_non_null += 1
        before_sum += amount

    if offenders:
        frappe.throw(
            f"{table}.{column} holds {len(offenders)} value(s) that are not clean numbers; "
            f"fix them before migrating (nothing was changed): " + ", ".join(offenders)
        )

    before_count = len(rows)

    # ⚠️ RAW DDL, SO NO `doc_events` FIRE -- AND THAT IS CORRECT. `Project Inflows` carries hooks, but
    # this rewrites no value (the count + SUM re-assert below proves it), so there is nothing derived
    # to recompute.
    #
    # A text default (if any) cannot be cast by ALTER TYPE, so it is dropped. Model sync does NOT add
    # a Currency one back (its decimal default check sees None == None), so the migrated column stays
    # nullable with no default -- unlike a fresh site's `not null default 0`. Harmless: every document
    # insert writes the amount through `flt`.
    frappe.db.sql(
        f'ALTER TABLE "{table}" ALTER COLUMN "{column}" DROP DEFAULT, '
        f'ALTER COLUMN "{column}" TYPE {_TARGET_TYPE} USING btrim("{column}")::{_TARGET_TYPE}'
    )

    after_count, after_non_null, after_sum = _measure(table, column)
    if (after_count, after_non_null, after_sum) != (before_count, before_non_null, before_sum):
        frappe.db.rollback()
        frappe.throw(
            f"{table}.{column} conversion did not preserve the data and was rolled back: "
            f"before {before_count} rows / {before_non_null} non-null / SUM {before_sum}, "
            f"after {after_count} / {after_non_null} / SUM {after_sum}"
        )

    return {"status": "converted", "count": after_count, "sum": after_sum}
