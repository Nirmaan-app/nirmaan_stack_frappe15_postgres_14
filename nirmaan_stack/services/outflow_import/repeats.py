# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which lines of a statement are EXACT REPEATS, and so are never saved (ADR-0031).

PURE MODULE -- no `frappe`, no database. THE ONE OWNER of the exact-repeat walk (ADR-0010): the
Cashfree/ICICI upload plan (`api.outflow_import.upload._plan_lines`) and the Cashbook plan
(`cashbook.plan_statement`) both call `split_repeats`. Two copies of this loop is how one source
comes to count repeats differently from another.

An EXACT repeat has the same identity AND the same bank status as a line the system already holds --
from an earlier import, or from earlier in this file. It is left out and counted. Every other line is
kept, including a repeat whose bank status CHANGED, which is new information about the money; such a
line carries the `Repeat` that says so, for the caller to word its skip.

WHAT STAYS WITH THE CALLER: the identity (source-aware -- `duplicates.row_identity_of`), the corpus
of earlier sightings (Cashfree narrows it by period, Cashbook deliberately does not), and which lines
of the file count as IN-FILE sightings (every terminal line on Cashfree/ICICI, `terminal_line`; only a
line that will be CREATED on Cashbook). All three are passed in as functions, so this module decides
only the rule.

The cleanup patch `patches/v3_0/delete_stored_exact_repeats` replays stored imports through this same
walk, so what it deletes is what an upload today would have left out.

It lives here rather than in `duplicates` because it needs `parser.is_terminal_status`, and `parser`
imports `duplicates` -- the arrow can only run one way.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable

from nirmaan_stack.services.outflow_import.duplicates import (
    PriorSighting,
    Repeat,
    RowIdentity,
    match_repeat,
)
from nirmaan_stack.services.outflow_import.parser import is_terminal_status

__all__ = ["KeptLine", "RepeatSplit", "split_repeats", "terminal_line"]


@dataclass(frozen=True)
class KeptLine:
    """A line that WILL be saved, and what repeats it (if anything).

    `earlier` / `in_file` are set only for a repeat whose bank status CHANGED -- an exact repeat is
    never kept. When both are set the earlier IMPORT is the one a message names.

    The `is_in_file_sighting` rule of `split_repeats` is shown EVERY line in this shape, an exact
    repeat included (one of its two `Repeat`s then says `exact`).
    """

    row: object
    earlier: Repeat | None
    in_file: Repeat | None


@dataclass(frozen=True)
class RepeatSplit:
    kept: tuple[KeptLine, ...]
    #: How many exact repeats were left out -- the one trace they leave, stored on the batch.
    repeats_not_saved: int
    #: The earlier batch the first exact repeat came from -- the one a refusal message names. `None`
    #: when every exact repeat was only repeated within this file.
    repeat_of_batch: str | None


def terminal_line(line: KeptLine) -> bool:
    """The Cashfree/ICICI in-file rule: every TERMINAL line is a sighting, whatever its own outcome.

    It matches the D4 rule the cross-batch lookup applies in SQL (`candidates.prior_import_sightings`):
    a line still in flight may yet say something new, so it cannot make a later line a repeat. A
    terminal line is recorded whatever its outcome, as the stored rows the cross-batch lookup reads are.
    """
    return is_terminal_status(getattr(line.row, "status_raw", "") or "")


def split_repeats(
    rows: Iterable,
    identity_of: Callable[[object], RowIdentity],
    earlier_sightings_of: Callable[[object], "tuple[PriorSighting, ...]"],
    is_in_file_sighting: Callable[[KeptLine], bool] = terminal_line,
) -> RepeatSplit:
    """Split `rows` into the lines to keep and a count of the exact repeats left out.

    `identity_of(row)` is the row's duplicate identity; `earlier_sightings_of(row)` is every earlier
    stored sighting of it, earliest first, each carrying its bank status.

    `is_in_file_sighting(line)` decides whether a line can make a LATER line of this file a repeat. It
    is asked after the line is judged, so a rule may read its `earlier` / `in_file`. The default is
    `terminal_line`. ⚠️ CASHBOOK PASSES ITS OWN, AND MUST (#1358): there a sighting is a line the plan
    will CREATE. Under the terminal rule, Txn X FAILED then Txn X SUCCESS made the SUCCESS line an
    in-file repeat of the failure (a status change, Unskip-locked), and the spend never became an
    expense. A Cashfree line creates nothing, so there the terminal rule stays.

    ⚠️ THE IN-FILE CHECK KEYS ON THE IDENTITY EXACTLY (no missing-date fallback), as the parser's
    `duplicate_transfer_ids` warning does -- two readers of one file must agree about which of its
    lines are the same line.
    """
    seen_in_file: dict = {}
    kept: list[KeptLine] = []
    repeats = 0
    repeat_of_batch = None
    for row in rows:
        status = getattr(row, "status_raw", "") or ""
        identity = identity_of(row)
        earlier = match_repeat(earlier_sightings_of(row), status)
        in_file = match_repeat(tuple(seen_in_file.get(identity, ())), status)
        line = KeptLine(row=row, earlier=earlier, in_file=in_file)
        if is_in_file_sighting(line):
            seen_in_file.setdefault(identity, []).append(
                PriorSighting(added_on_date=None, label="", bank_status=status)
            )
        if (earlier and earlier.exact) or (in_file and in_file.exact):
            repeats += 1
            if repeat_of_batch is None and earlier and earlier.exact:
                repeat_of_batch = earlier.label
            continue
        kept.append(line)
    return RepeatSplit(
        kept=tuple(kept), repeats_not_saved=repeats, repeat_of_batch=repeat_of_batch
    )
