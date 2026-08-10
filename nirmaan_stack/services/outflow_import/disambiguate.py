"""Several approved records, and a rule that can tell them apart -- the pure half (Option B).

WHAT THIS IS FOR. `status.sole_suggestion` pre-selects a record when the matcher found EXACTLY ONE.
When it found several it deliberately picks nothing, because the screen must never guess between two
real records. That rule is right, and on the first real statement it left 56 transfers with no
pre-selection. Measuring those 56 showed the refusal was mostly unnecessary: the evidence needed to
separate the candidates was already on the row, and nothing was looking at it.

    19  the candidates are TWINS -- same project, same vendor, same amount to the paise
    19  one candidate is strictly nearest the amount the bank actually moved
     7  the remark names a project, and only one candidate is on it
    11  genuinely need a person

⚠️ THIS DOES NOT WIDEN WHAT MAY BE MATCHED. Every candidate here was already offered by the matcher
and already passed the settle window. This module only decides BETWEEN them. It cannot introduce a
record the tier ladder did not admit, which is why it is not a fourth tier and does not live in
`matcher.py`.

⚠️ IT ALSO DOES NOT WIDEN WHAT MAY BE SETTLED. A pick is a PRE-SELECTION. The person still confirms
it, `settle_row` still re-asserts status and amount under a row lock, and a wrong pick is refused by
the same guard that has always refused one.

THE THREE RULES, AND THE FENCE ON EACH.

  M1  project in remark   The remark names exactly one project (`project_match`, the same predicate
                          tier 2 gates on) and exactly one candidate belongs to it. This is the only
                          rule that may fire when the candidates span several projects, because it
                          is the only one holding evidence about WHICH project.

  M2  nearest amount      FENCED TO A SINGLE PROJECT. One candidate is strictly nearer the bank's
                          amount than every other. The fence is what makes this safe rather than
                          clever: across projects, being 8 paise closer is not evidence about which
                          job the money was for, and a wrong pick there bills the wrong job. Within
                          one project the worst case is the wrong document on the right job.

  M3  interchangeable     FENCED HARDER. Every candidate is on the SAME project and carries the SAME
                          amount, so no downstream figure can tell the outcomes apart. This is the
                          reasoning already accepted for balanced stacks, applied to records instead
                          of transfers -- and, like that pairing, it is deterministic and it says so
                          on the row.

⚠️ A BLANK PROJECT IS NOT A PROJECT. If any candidate has no project the single-project fence FAILS,
so M2 and M3 stay out. Treating blanks as equal would let a missing value stand in for evidence,
which is the whole failure this fence exists to prevent.

⚠️ M3 MUST BE SWITCHED OFF FOR A STACK MEMBER, AND THIS IS NOT A DETAIL -- IT IS AN OWNER RULING
(2026-08-10) THAT M3 OTHERWISE BREAKS IN SILENCE. A stack is several transfers that are identical to
each other against several records that are identical to each other, and the ruling is that an
UNBALANCED stack pairs NOTHING, not even partially: with 7 transfers and 6 records some transfer
settles nothing, and choosing which one is a judgement about money that belongs to a person.

M3 applied per row does exactly the partial pairing that ruling forbids -- the first six transfers
each take a record and the seventh finds them all claimed. Measured when this shipped unfenced: 62 of
65 interchangeable picks landed on stack members, and the leftovers screen fell from 6 stacks to 3
because the pass had quietly consumed the difference. The caller passes `allow_interchangeable=False`
for any row that belongs to a stack, which hands those rows back to `stacks.pair_stack`, where
balanced pairs and unbalanced refuses.

M1 and M2 stay ON for stack members, and the distinction is the whole basis of the ruling: they act
on EVIDENCE about one specific transfer -- the project its remark names, the paise the bank actually
moved -- rather than choosing arbitrarily between things nothing distinguishes. Arbitrary-among-
interchangeable is the case the stack machinery owns; evidence is not.

⚠️ CLAIM-AWARENESS IS NOT OPTIONAL, IT IS WHAT MAKES M3 WORK. Seven transfers against eight twin
records only resolve if each transfer takes a DIFFERENT one, so the caller feeds back what it has
already handed out. Without it every twin row would pick the same record and `_enforce_single_claim`
would release all but one -- turning the best-covered rule into the worst.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Sequence

__all__ = [
    "Candidate",
    "Pick",
    "RULE_SOLE",
    "RULE_STACK_PAIRING",
    "RULE_PROJECT_IN_REMARK",
    "RULE_NEAREST_AMOUNT",
    "RULE_INTERCHANGEABLE",
    "RULE_LABELS",
    "pick_from_several",
    "pick_note",
]

# ⚠️ TWO VALUES THAT THIS MODULE NEVER PRODUCES, and they live here anyway because the FIELD needs
# one vocabulary rather than one per writer. `suggestion_rule` answers "how was ONE record chosen
# from what the matcher found", and there are five answers -- three of them are Option B's, and two
# come from elsewhere:
#
#   RULE_SOLE          the matcher found exactly one approved record. `status.sole_suggestion`.
#   RULE_STACK_PAIRING several identical transfers against the same number of identical records,
#                      zipped in a deterministic but ARBITRARY order. `review._resolve_stacks`.
#
# ⚠️ BLANK USED TO MEAN BOTH "no rule" AND "no suggestion", and that ambiguity had a measurable cost:
# the 112 stack-paired rows on the first real statement carried a blank rule, so the confirm dialog's
# "Picked by" filter showed them under **Only candidate** -- filing the arbitrary pairings, the ones
# a reviewer would most want to isolate, as the safest kind there is. Blank now means exactly one
# thing: there is no suggestion.
RULE_SOLE = "sole"
RULE_STACK_PAIRING = "stack-pairing"

RULE_PROJECT_IN_REMARK = "project-in-remark"
RULE_NEAREST_AMOUNT = "nearest-amount"
RULE_INTERCHANGEABLE = "interchangeable"

# What each rule is called on screen. The vocabulary lives HERE, not in a Select field on the
# doctype: a Select that narrows leaves stored values Frappe will not rewrite -- the lesson the
# `Unmatched` merge had to be patched for. The stored field is plain Data and this map is the
# authority on what a value means.
RULE_LABELS = {
    RULE_SOLE: "Only candidate",
    RULE_STACK_PAIRING: "Identical set, paired arbitrarily",
    RULE_PROJECT_IN_REMARK: "Remark named the project",
    RULE_NEAREST_AMOUNT: "Nearest amount",
    RULE_INTERCHANGEABLE: "Interchangeable records",
}


@dataclass(frozen=True)
class Candidate:
    """One approved record the matcher already offered for this transfer."""

    doctype: str
    name: str
    amount: Decimal
    project: str = ""

    @property
    def key(self) -> tuple[str, str]:
        return (self.doctype, self.name)


@dataclass(frozen=True)
class Pick:
    doctype: str
    name: str
    rule: str

    @property
    def key(self) -> tuple[str, str]:
        return (self.doctype, self.name)


def _one_project(candidates: Sequence[Candidate]) -> str:
    """The single project every candidate belongs to, or `""` if they do not share exactly one.

    A blank on ANY candidate fails the test -- see the module docstring. `""` is therefore both
    "they disagree" and "at least one does not say", which is correct: neither is a basis for the
    fences that consult it.
    """
    projects = {(c.project or "").strip() for c in candidates}
    if len(projects) != 1:
        return ""
    only = projects.pop()
    return only or ""


def _ordered(candidates: Iterable[Candidate]) -> list[Candidate]:
    """Deterministic order: doctype then name, both ending in a unique field.

    The same ordering `pair_stack` gives its records, and for the same reason -- a reshuffle between
    two runs would move a pre-selection out from under a reviewer mid-decision.
    """
    return sorted(candidates, key=lambda c: (c.doctype, c.name))


def pick_from_several(
    *,
    bank_amount: Decimal,
    candidates: Sequence[Candidate],
    remark: str,
    project_index=None,
    claimed: frozenset | set = frozenset(),
    allow_interchangeable: bool = True,
) -> Pick | None:
    """Choose ONE of several approved records, or return `None` and leave it to a person.

    `claimed` holds the `(doctype, name)` keys already handed to another transfer. Candidates in it
    are invisible to every rule -- but the FENCES are evaluated over the FULL candidate set, which
    is a deliberate asymmetry and the subtle part of this function.

    ⚠️ WHY THE FENCES READ ALL CANDIDATES AND THE CHOICE READS ONLY THE FREE ONES. Take three
    candidates on three different projects, two of them already claimed. Judged on what is left,
    the single survivor trivially "shares one project" and trivially "has one amount", so M3 would
    fire and stamp the row `interchangeable` -- a claim that the records were indistinguishable,
    made about a set that spanned three projects. The fence has to describe the situation the
    matcher actually found, not the residue of who got there first.

    The same asymmetry is what lets the LAST of a set of twins be picked: eight twin records, seven
    already taken, one free -- the fence still sees eight twins, so M3 fires honestly and the
    seventh transfer takes the last one.
    """
    if not candidates:
        return None

    available = [c for c in candidates if c.key not in claimed]
    if not available:
        return None

    # -- M1: the remark names a project, and one candidate is on it -----------------------------
    if project_index is not None:
        named = project_index.sole_project(remark or "")
        if named:
            on_project = [c for c in available if (c.project or "").strip() == named]
            if len(on_project) == 1:
                only = on_project[0]
                return Pick(only.doctype, only.name, RULE_PROJECT_IN_REMARK)

    # Both remaining rules are fenced to a single project, evaluated over EVERY candidate.
    if not _one_project(candidates):
        return None

    amounts = {c.amount for c in candidates}

    # -- M3: every candidate is the same amount on the same project, so nothing can tell them apart
    if len(amounts) == 1:
        if not allow_interchangeable:
            return None
        first = _ordered(available)[0]
        return Pick(first.doctype, first.name, RULE_INTERCHANGEABLE)

    # -- M2: one free candidate is strictly nearest what the bank actually moved -----------------
    by_gap = sorted(
        _ordered(available), key=lambda c: (abs(c.amount - bank_amount), c.doctype, c.name)
    )
    if len(by_gap) == 1:
        # One free candidate out of a set that was NOT twins. "Nearest" is vacuous with nothing to
        # be nearer than, so this is left to a person rather than dressed up as a measurement.
        return None
    nearest, runner_up = by_gap[0], by_gap[1]
    if abs(nearest.amount - bank_amount) < abs(runner_up.amount - bank_amount):
        return Pick(nearest.doctype, nearest.name, RULE_NEAREST_AMOUNT)

    return None


def pick_note(pick: Pick, candidates: Sequence[Candidate], bank_amount: Decimal) -> str:
    """What a rule-picked row says in the Outcome column.

    ⚠️ IT SAYS WHICH RULE PICKED, AND WHY THAT RULE IS SAFE. A pre-selection made by a rule is not
    the same fact as one made because there was only ever one record, and a reviewer confirming 800
    rows at once is entitled to know which they are looking at. The stack pass sets the precedent:
    every auto-paired row states that the pairing was arbitrary and tells the reader what to check.
    """
    total = len(candidates)
    if pick.rule == RULE_PROJECT_IN_REMARK:
        why = (
            f"{pick.name} was selected because the remark names its project and no other candidate "
            f"is on that project."
        )
    elif pick.rule == RULE_NEAREST_AMOUNT:
        gap = next(
            (abs(c.amount - bank_amount) for c in candidates if c.key == pick.key), Decimal("0")
        )
        why = (
            f"{pick.name} was selected because it is the closest to the amount the bank moved "
            f"({gap} apart) and every candidate is on the same project."
        )
    else:
        why = (
            f"{pick.name} was selected arbitrarily: every candidate is the same amount on the same "
            f"project, so nothing distinguishes them. Check the project before confirming."
        )
    return f"{total} approved records match this amount. {why}"
