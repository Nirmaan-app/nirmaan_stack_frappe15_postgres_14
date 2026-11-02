# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Where a Cashbook line's Expense goes: the ledger, the project and the expense type (Cashbook slice 4).

PURE MODULE, split out of `cashbook.py` to keep it under the file-size limit; `cashbook.plan_statement` calls
`placement` and re-exports `pick_expense_type` and `FALLBACK_EXPENSE_TYPE`. See `cashbook`'s module note, steps 2
and 3, for why the ledger is decided before the type.
"""

from __future__ import annotations

from typing import Mapping, Sequence

from nirmaan_stack.services.outflow_import.ledgers import (
    NON_PROJECT_EXPENSE_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
)
from nirmaan_stack.services.outflow_import.project_match import ProjectIndex, alias_haystack

__all__ = ["FALLBACK_EXPENSE_TYPE", "placement", "pick_expense_type"]

# Where a row lands when its text names no type we recognise. It must carry BOTH the `project` and
# `non_project` flags, because a row on either ledger can reach it.
FALLBACK_EXPENSE_TYPE = "Petty Cash"


def placement(
    remarks: str, index: ProjectIndex, expense_rules: Mapping[str, Sequence[tuple[str, str]]]
) -> dict:
    """Which ledger, which project, which expense type -- in that order, because type depends on it."""
    project = index.sole_project(remarks)
    if project:
        ledger, rule_key = PROJECT_EXPENSE_DOCTYPE, "Project"
    else:
        ledger, rule_key = NON_PROJECT_EXPENSE_DOCTYPE, "Non Project"

    expense_type, keyword = pick_expense_type(remarks, expense_rules.get(rule_key, ()))
    return dict(
        ledger=ledger,
        project=project,
        project_name=index.name_of(project) if project else "",
        expense_type=expense_type,
        matched_keyword=keyword,
    )


def pick_expense_type(
    remarks: str, rules: Sequence[tuple[str, str]]
) -> tuple[str, str]:
    """`(expense type, the keyword that chose it)`. Falls back rather than refusing.

    ⚠️ A KEYWORD MATCHES AT THE START OF A WORD, NOT ANYWHERE IN THE TEXT. People write "unloading"
    where the rule says "unload" and "printout" where it says "print", so a whole-word test would
    miss most of a real statement -- but a bare substring test would find "print" inside
    "blueprint" and "unload" inside a payee's name. Matching at a word START handles English
    suffixes for free and refuses the interior collisions, and it needs no regex: the haystack is
    already space-normalised and space-padded, so a word start is exactly a preceding space.

    ⚠️ THE LONGEST MATCH WINS, and `candidates.load_expense_rules` has already sorted for it. If
    two rules of the SAME length disagree, that is a genuine tie and the fallback takes it --
    the "exactly one, or nothing" rule this feature applies everywhere else. Same length AND the
    same type is not a tie: "cake" and "food" both meaning Staff Welfare is agreement.
    """
    haystack = alias_haystack(remarks)
    hits = [(keyword, expense_type) for keyword, expense_type in rules if f" {keyword}" in haystack]
    if not hits:
        return FALLBACK_EXPENSE_TYPE, ""

    longest = max(len(keyword) for keyword, _ in hits)
    contenders = {expense_type for keyword, expense_type in hits if len(keyword) == longest}
    if len(contenders) != 1:
        return FALLBACK_EXPENSE_TYPE, ""
    winner = next(keyword for keyword, _ in hits if len(keyword) == longest)
    return contenders.pop(), winner
