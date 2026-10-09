# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which lines of a statement are EXACT REPEATS, and so are never saved (ADR-0031).

PURE MODULE -- no `frappe`, no database. THE ONE OWNER of the exact-repeat walk (ADR-0010): the
Cashfree/ICICI upload plan (`api.outflow_import.upload._plan_lines`) and the Cashbook plan
(`cashbook.plan_statement`) both call `split_repeats`. Two copies of this loop is how one source
comes to count repeats differently from another.

An EXACT repeat has the same identity AND the same bank status as a line the system already holds --
from an earlier import, or from earlier in this file -- WHATEVER that status is, in-flight ones
included (#1359). It is left out and counted. Every other line is kept, including a repeat whose bank
status CHANGED, which is new information about the money; such a line carries the `Repeat` that says
so, for the caller to word its skip.

A status change needs a FINAL earlier line (`PriorSighting.final`): an in-flight line never makes a
different status a repeat (D4 -- a QUEUED line must never block its later SUCCESS).

WHAT STAYS WITH THE CALLER: the identity (source-aware -- `duplicates.row_identity_of`), the corpus
of earlier sightings (Cashfree narrows it by period, Cashbook deliberately does not; each sighting
says whether it is final), and which lines of the file are FINAL in-file sightings (every terminal
line on Cashfree/ICICI, `terminal_line`; only a line that will be CREATED on Cashbook). All three are
passed in as functions, so this module decides only the rule.

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

    The `is_final_in_file` rule of `split_repeats` is shown EVERY line in this shape, an exact
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
    #: How many of `repeats_not_saved` repeat only a line earlier in this file, not an earlier import
    #: -- so a message does not call them "already imported" (#1359).
    repeated_in_file: int = 0


def terminal_line(line: KeptLine) -> bool:
    """The Cashfree/ICICI in-file rule: every TERMINAL line is final, whatever its own outcome.

    It matches the D4 rule the cross-batch lookup applies (`candidates.prior_import_sightings` marks a
    stored row final only when terminal): a line still in flight may yet say something new, so it
    cannot make a later line with a DIFFERENT status a repeat. It still makes an identical copy one.
    """
    return is_terminal_status(getattr(line.row, "status_raw", "") or "")


def split_repeats(
    rows: Iterable,
    identity_of: Callable[[object], RowIdentity],
    earlier_sightings_of: Callable[[object], "tuple[PriorSighting, ...]"],
    is_final_in_file: Callable[[KeptLine], bool] = terminal_line,
) -> RepeatSplit:
    """Split `rows` into the lines to keep and a count of the exact repeats left out.

    `identity_of(row)` is the row's duplicate identity; `earlier_sightings_of(row)` is every earlier
    stored sighting of it, earliest first, each carrying its bank status and `final`.

    Every line is an in-file sighting: an identical later copy is an exact repeat (#1359).
    `is_final_in_file(line)` decides whether a line can ALSO be the basis of a STATUS CHANGE for a
    later line of this file. It is asked once per line, with `in_file` judged against the earlier FINAL
    lines, so a rule may read its `earlier` / `in_file`. The default is `terminal_line`.

    ⚠️ A LINE THAT IS NOT FINAL NEVER MAKES A FINAL LINE A REPEAT -- D4 one level up. On Cashbook a
    wallet top-up and a spend can share an identity and a status; the top-up creates nothing, so it
    must not swallow the spend that would. Only a line that is not final itself is matched against
    every earlier line. On Cashfree/ICICI this changes nothing: a non-final line is in flight, and a
    line with the same status is in flight too. ⚠️ CASHBOOK PASSES ITS OWN, AND MUST (#1358): there the
    basis is a line the plan will CREATE. Under the terminal rule, Txn X FAILED then Txn X SUCCESS made
    the SUCCESS line an in-file repeat of the failure (a status change, Unskip-locked), and the spend
    never became an expense. A Cashfree line creates nothing, so there the terminal rule stays.

    ⚠️ THE IN-FILE CHECK KEYS ON THE IDENTITY EXACTLY (no missing-date fallback), as the parser's
    `duplicate_transfer_ids` warning does -- two readers of one file must agree about which of its
    lines are the same line.
    """
    seen_in_file: dict = {}
    kept: list[KeptLine] = []
    repeats = 0
    repeated_in_file = 0
    repeat_of_batch = None
    for row in rows:
        status = getattr(row, "status_raw", "") or ""
        identity = identity_of(row)
        earlier = match_repeat(earlier_sightings_of(row), status)
        seen = seen_in_file.setdefault(identity, [])
        line = KeptLine(
            row=row,
            earlier=earlier,
            in_file=match_repeat(tuple(s for s in seen if s.final), status),
        )
        final = is_final_in_file(line)
        if not final:
            line = KeptLine(row=row, earlier=earlier, in_file=match_repeat(tuple(seen), status))
        seen.append(PriorSighting(added_on_date=None, label="", bank_status=status, final=final))
        if earlier and earlier.exact:
            repeats += 1
            if repeat_of_batch is None:
                repeat_of_batch = earlier.label
            continue
        if line.in_file and line.in_file.exact:
            repeats += 1
            repeated_in_file += 1
            continue
        kept.append(line)
    return RepeatSplit(
        kept=tuple(kept),
        repeats_not_saved=repeats,
        repeat_of_batch=repeat_of_batch,
        repeated_in_file=repeated_in_file,
    )
