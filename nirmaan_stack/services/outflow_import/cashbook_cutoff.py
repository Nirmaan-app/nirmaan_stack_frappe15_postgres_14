# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The date a Cashbook statement line must be on or after to be imported (#1707, spec #1711).

PURE, split out of `cashbook.py` (file size); `cashbook.plan_statement` asks `is_before_cutoff` of every line first.
The business tracks wallet spends only from 1 Apr 2026. An earlier line is left out of the plan, never stored, and
only counted (`CashbookPlan.before_cutoff`). Owner decisions (2026-11-18): a fixed date, not a setting; Cashbook only;
a line with no readable date is left out too, because nothing shows it is on or after the date (counted in
`CashbookPlan.undated` as well, so the note can say so).
"""

from __future__ import annotations

from datetime import date

# ⚠️ THE ONE COPY OF THE DATE (owner decision 1). The #1649 marker patch holds it, and `patches/` is append-only, so it
# is read from there rather than written a second time. Importing the patch runs only its module top.
from nirmaan_stack.patches.v3_0.mark_this_year_cashbook_expenses import FROM_DATE as _FROM_DATE

__all__ = ["CASHBOOK_FROM_DATE", "is_before_cutoff", "is_undated", "before_cutoff_note", "only_before_cutoff_message"]

CASHBOOK_FROM_DATE = date.fromisoformat(_FROM_DATE)
_WHEN = f"{CASHBOOK_FROM_DATE.day} {CASHBOOK_FROM_DATE:%b %Y}"


def is_before_cutoff(raw) -> bool:
    """Whether a parsed line is left out by date: dated before the cutoff, or with no readable date."""
    when = getattr(raw, "added_on_date", None)
    return when is None or when < CASHBOOK_FROM_DATE


def is_undated(raw) -> bool:
    return getattr(raw, "added_on_date", None) is None


def before_cutoff_note(count: int, undated: int = 0) -> str:
    """What the preview and the import say about the lines left out by date: "14 lines before 1 Apr 2026 left out".

    The stored count (`lines_before_cutoff`) holds both kinds, so Import History, which has no `undated`, names the date
    only."""
    if count <= 0:
        return ""
    no_date = " or with no date" if undated > 0 else ""
    return f"{count} {'line' if count == 1 else 'lines'} before {_WHEN}{no_date} left out"


def only_before_cutoff_message(count: int, filename: str) -> str:
    """Why a statement of nothing but lines before the cutoff is refused."""
    return (
        f"Not imported. All {count} lines in '{filename}' are dated before {_WHEN}, and the Cashbook import leaves "
        "those out. Nothing was created."
    )
