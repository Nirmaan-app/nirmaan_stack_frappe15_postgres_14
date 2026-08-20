# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""How much does this approved record look like this transfer? (Bulk Import Outflow, slice N1.)

PURE MODULE -- no `frappe`, no database, no request context. It imports `normalize`, `amounts` and
`project_match`, all of which are themselves pure. Same shape and the same reason as `matcher.py`.

WHAT IT IS FOR. The Resolve dialog's Link-payment table is a BROWSE list: every approved record in
every ledger, offered to a person who has to find the one this transfer paid. Ordering that list by
amount alone -- which is what it did before this module -- puts 1,082 payments in front of a reviewer
in an order that says nothing about whose money it is. This ranks them by the facts a person
actually recognises a record by.

⚠️ THE ONE RULE THAT MATTERS MOST: **NOTHING HERE MAY EVER FEED THE MATCHER.** This module ranks a
list a human reads and then confirms. `matcher.py`, `disambiguate.py` and `status.py` decide what
SETTLES, and they must not import this, directly or transitively. The reason is not tidiness: these
weights exist to be tuned against reviewer feedback, and a tweak made because a list felt wrongly
ordered would otherwise silently change which transfers move money on their own. A test pins the
absence of that import.

⚠️ AND THE MIRROR OF IT: this module does NOT reuse `matcher.VendorScoringPolicy`. Its numbers are
deliberately similar -- they were derived from the same vendor master and it would be perverse to
disagree with them for no reason -- but they are a SEPARATE, independently tunable set. Sharing the
dataclass would mean retuning the matcher every time the browse list is retuned, in the direction
the rule above forbids.

THE FOUR AXES, IN THE OWNER'S PRIORITY ORDER (2026-08-11)
---------------------------------------------------------
    project  >  vendor name  >  vendor nickname / contact person  >  amount

⚠️ IT IS A WEIGHTED SUM, NOT A STRICT TIER LADDER (owner decision Q1, option b). A strict ladder
would let any project hit outrank every vendor hit -- and the project signal comes from free-typed
remark text, which is the noisiest input in this feature. A record whose vendor name matches
exactly, whose nickname matches and whose amount is identical must be able to outrank one that
shares a single loose project keyword. The weights below are what encode "project counts for most"
without letting it count for everything.

⚠️ SETTLEABILITY IS A HARD SPLIT ABOVE THE SCORE, AND IT IS NOT ONE OF THE AXES (owner decision Q2).
A record outside the settle window CANNOT be confirmed here -- `settle.py` refuses it -- so however
much it looks like the transfer, it must never sit above a record the reviewer can actually use. The
amount axis below is a small tie-shaper WITHIN each half; `ranked_records` applies the split itself.
Unsettleable records are still RETURNED and still ranked among themselves, because someone hunting a
TDS payment needs to see the one that differs by 2,000 in order to learn that it cannot be settled
here.

WHERE THE TEXT COMES FROM
-------------------------
⚠️ BOTH BANK FIELDS FEED BOTH TEXT AXES (owner decision Q3). `beneficiary_name` and `remarks` are
joined into ONE token set, and the vendor axis and the project axis both read it. The matcher keeps
them separate -- beneficiary for vendors, remarks for projects -- because it is deciding whether to
move money and each tier stands on one clean signal. Here an accountant routinely types the vendor
into the remark and the site into the beneficiary field, and a browse list that refuses to look is
just a list that fails to find things.

AMBIGUITY IS KEPT, NOT DISCARDED
--------------------------------
⚠️ THIS READS `ProjectIndex.projects_mentioned`, **NOT** `sole_project`. `sole_project` abstains the
moment two projects fit the remark, which is exactly right for tier 2 -- inventing an answer there
settles money on a coin flip. Ranking is under no such obligation: it can boost BOTH projects and
let the reviewer choose, which is strictly more useful than boosting neither. The asymmetry is
deliberate and must not be "made consistent".

WHAT A BLANK FIELD MEANS
------------------------
⚠️ A MISSING FIELD SCORES ZERO ON ITS AXIS AND IS NEVER A PENALTY. All 68 approved Non Project
Expenses have no vendor and no project at all -- not blank values, no columns -- so they can only
ever score on amount. Penalising them would push an entire ledger to the bottom of the list for
having a different shape, which is a data fact rather than evidence about this transfer.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Sequence

from nirmaan_stack.services.outflow_import.amounts import amounts_match, to_decimal
from nirmaan_stack.services.outflow_import.normalize import normalize_name
from nirmaan_stack.services.outflow_import.project_match import (
    ProjectIndex,
    comparable_tokens,
)

__all__ = [
    "SimilarityPolicy",
    "DEFAULT_SIMILARITY_POLICY",
    "RowSignals",
    "RecordSignals",
    "SimilarityScore",
    "build_row_signals",
    "score_record",
    "ranked_records",
]


# ---------------------------------------------------------------------------------------------
# Scoring policy
#
# >>> OWNER DECISION POINT -- the same standing invitation `matcher.VendorScoringPolicy` carries. <<<
#
# These are defaults, not values I can justify from the data alone. What they encode is how much
# more a project is worth than a vendor, and how much a nickname is worth beside a real name. Both
# are judgements about how the people who use this screen recognise a record.
#
# They are SAFE to tune, and that is the whole reason the axes are a weighted sum: nothing here
# auto-commits anything. These numbers change the ORDER of a list a person confirms, and nothing
# else. If a reviewer says the right record keeps landing eighth, this is the file to change --
# and `matcher.py` is the file NOT to change.
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class SimilarityPolicy:
    """Weights for the four axes, plus the guards that stop a weak signal counting.

    PROJECT_NAMED -- the transfer's text NAMES this record's project, by `ProjectIndex`'s own
        reading (whole name, or a keyword unique to one project). The strongest signal available.
    PROJECT_TOKEN_WEIGHT -- multiplier on the token containment ratio when the text merely SHARES
        words with the project name without naming it outright. The partial reading.
    VENDOR_NAME_EXACT -- the normalised names are equal.
    VENDOR_NAME_TOKEN_WEIGHT -- multiplier on the containment ratio for a partial vendor-name hit.
    ALIAS_TOKEN_WEIGHT -- multiplier for the nickname / contact-person axis. ONE weight for both,
        because the owner named them as ONE tier; the better of the two is taken, never the sum.
    AMOUNT_EXACT / AMOUNT_WITHIN_WINDOW -- the smallest axis, because settleability is already a
        hard split above the score. It only shapes ties.
    MIN_SIGNIFICANT_TOKENS -- the transfer's text must contribute at least this many comparable
        words before ANY token score is trusted. Without it a one-word beneficiary matches half the
        ledger. Carried over from `matcher.VendorScoringPolicy`, where it exists for the same
        reason.
    """

    PROJECT_NAMED: float = 1.00
    PROJECT_TOKEN_WEIGHT: float = 0.60
    VENDOR_NAME_EXACT: float = 0.75
    VENDOR_NAME_TOKEN_WEIGHT: float = 0.60
    ALIAS_TOKEN_WEIGHT: float = 0.40
    AMOUNT_EXACT: float = 0.30
    AMOUNT_WITHIN_WINDOW: float = 0.15
    MIN_SIGNIFICANT_TOKENS: int = 2


DEFAULT_SIMILARITY_POLICY = SimilarityPolicy()


# ---------------------------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class RowSignals:
    """The bank transfer, reduced to what the ranker compares against.

    Built once per dialog by `build_row_signals`, never per record: tokenising the same remark 1,164
    times is redundant work, and resolving the project index against it 1,164 times more so.
    """

    text_tokens: frozenset[str] = frozenset()
    """`beneficiary_name` and `remarks` together -- see the module docstring on why they are one set."""

    beneficiary_name: str = ""
    """Normalised, for the exact-name comparison only."""

    amount: Decimal = Decimal("0")

    projects_named: frozenset[str] = frozenset()
    """Project IDs the transfer's text names, by `ProjectIndex`'s reading. May hold more than one."""

    @property
    def has_significant_text(self) -> bool:
        """Whether the text is worth token-scoring at all. See `MIN_SIGNIFICANT_TOKENS`."""
        return len(self.text_tokens) >= DEFAULT_SIMILARITY_POLICY.MIN_SIGNIFICANT_TOKENS


@dataclass(frozen=True)
class RecordSignals:
    """One approved record, as the ranker needs to see it.

    ⚠️ `settleable` IS PASSED IN, NEVER DERIVED HERE. It is `amounts.amounts_match` against the
    settle window, and that rule has exactly one owner -- see the call-site list in `amounts.py`.
    A second opinion about what may be settled, computed in a ranking module, is precisely the
    inconsistency that file's docstring warns about.
    """

    doctype: str
    name: str
    amount: Decimal
    settleable: bool

    vendor_name: str = ""
    vendor_nickname: str = ""
    contact_person: str = ""

    project: str = ""
    """The project ID -- what `ProjectIndex` reports, so the two can be compared."""

    project_name: str = ""
    """The display name, for the partial token reading and for the reason text."""


@dataclass(frozen=True)
class SimilarityScore:
    """The total, its parts, and why -- in the reviewer's words.

    ⚠️ THE PARTS TRAVEL WITH THE TOTAL ON PURPOSE. A ranked list whose order cannot be explained is
    a list people stop trusting, and this feature's standing habit is that a suggestion says what it
    stands on (`status.py` writes a sentence, the matcher carries its tier and its reasons). The
    screen renders `reasons`; nothing parses them.
    """

    total: float = 0.0
    project: float = 0.0
    vendor: float = 0.0
    alias: float = 0.0
    amount: float = 0.0
    reasons: tuple[str, ...] = ()


# ---------------------------------------------------------------------------------------------
# Building the transfer's side
# ---------------------------------------------------------------------------------------------


def build_row_signals(
    beneficiary_name: object,
    remarks: object,
    amount: object,
    project_index: ProjectIndex | None = None,
) -> RowSignals:
    """Reduce one bank row to its comparable form, once.

    `project_index` is optional so a caller with no project master -- a unit test, or a future
    surface that only wants vendor scoring -- still gets a usable result rather than an error. With
    no index, `projects_named` is empty and the project axis falls back to its partial reading,
    which is a weaker answer but never a wrong one.
    """
    text = f"{beneficiary_name or ''} {remarks or ''}"
    projects = project_index.projects_mentioned(text) if project_index else frozenset()
    return RowSignals(
        text_tokens=comparable_tokens(text),
        beneficiary_name=normalize_name(beneficiary_name),
        amount=to_decimal(amount),
        projects_named=frozenset(projects),
    )


# ---------------------------------------------------------------------------------------------
# Scoring one record
# ---------------------------------------------------------------------------------------------


def score_record(
    row: RowSignals,
    record: RecordSignals,
    policy: SimilarityPolicy = DEFAULT_SIMILARITY_POLICY,
) -> SimilarityScore:
    """How much this record looks like this transfer, and why."""
    reasons: list[str] = []

    project = _project_score(row, record, policy, reasons)
    vendor = _vendor_score(row, record, policy, reasons)
    alias = _alias_score(row, record, policy, reasons)
    amount = _amount_score(row, record, policy, reasons)

    return SimilarityScore(
        total=project + vendor + alias + amount,
        project=project,
        vendor=vendor,
        alias=alias,
        amount=amount,
        reasons=tuple(reasons),
    )


def _project_score(
    row: RowSignals,
    record: RecordSignals,
    policy: SimilarityPolicy,
    reasons: list[str],
) -> float:
    """The strong reading first, then the partial one. Never both -- they describe the same fact."""
    if record.project and record.project in row.projects_named:
        label = record.project_name or record.project
        reasons.append(f"the transfer names {label}")
        return policy.PROJECT_NAMED

    containment = _containment(row, comparable_tokens(record.project_name), policy)
    if containment.ratio <= 0:
        return 0.0
    reasons.append(f"shares {containment.shared} word(s) with the project name")
    return policy.PROJECT_TOKEN_WEIGHT * containment.ratio


def _vendor_score(
    row: RowSignals,
    record: RecordSignals,
    policy: SimilarityPolicy,
    reasons: list[str],
) -> float:
    if not record.vendor_name:
        return 0.0

    if row.beneficiary_name and row.beneficiary_name == normalize_name(record.vendor_name):
        reasons.append("the vendor name matches exactly")
        return policy.VENDOR_NAME_EXACT

    containment = _containment(row, comparable_tokens(record.vendor_name), policy)
    if containment.ratio <= 0:
        return 0.0
    reasons.append(f"shares {containment.shared} word(s) with the vendor name")
    return policy.VENDOR_NAME_TOKEN_WEIGHT * containment.ratio


def _alias_score(
    row: RowSignals,
    record: RecordSignals,
    policy: SimilarityPolicy,
    reasons: list[str],
) -> float:
    """The nickname and the contact person, as ONE axis.

    ⚠️ THE BETTER OF THE TWO, NEVER THE SUM. The owner named them as a single tier, and a vendor
    whose nickname AND contact person both happen to appear would otherwise outscore a vendor whose
    real name matched -- which inverts the priority order this module exists to implement.
    """
    best = 0.0
    best_reason = ""
    for label, value in (("nickname", record.vendor_nickname), ("contact", record.contact_person)):
        if not value:
            continue
        containment = _containment(row, comparable_tokens(value), policy)
        if containment.ratio <= 0:
            continue
        scored = policy.ALIAS_TOKEN_WEIGHT * containment.ratio
        if scored > best:
            best = scored
            best_reason = f"shares {containment.shared} word(s) with the vendor's {label}"

    if best_reason:
        reasons.append(best_reason)
    return best


def _amount_score(
    row: RowSignals,
    record: RecordSignals,
    policy: SimilarityPolicy,
    reasons: list[str],
) -> float:
    """The smallest axis. Settleability is already decided above it -- this only shapes ties.

    ⚠️ AMOUNT COMPARISON SITE. It reads the SETTLE window (`AMOUNT_TOLERANCE`, the default), via
    `amounts.amounts_match`. Registered in that module's call-site list, which is not optional
    bookkeeping: the one time a site went unlisted, every hand-ticked payment carrying paise came
    back Mismatched.
    """
    if to_decimal(record.amount) == row.amount:
        reasons.append("the amount is identical")
        return policy.AMOUNT_EXACT
    if amounts_match(record.amount, row.amount):
        reasons.append("the amount is within the settle window")
        return policy.AMOUNT_WITHIN_WINDOW
    return 0.0


# ---------------------------------------------------------------------------------------------
# Ranking the whole list
# ---------------------------------------------------------------------------------------------


def ranked_records(
    row: RowSignals,
    records: Sequence[RecordSignals],
    policy: SimilarityPolicy = DEFAULT_SIMILARITY_POLICY,
) -> tuple[tuple[RecordSignals, SimilarityScore], ...]:
    """Every record, scored, in the order the screen shows them.

    THE SORT KEY, and every part of it is load-bearing:

        (not settleable, -total, |amount - bank|, doctype, name)

    1. `not settleable` -- the hard split. A record the write path would refuse can never sit above
       one it would accept, whatever it looks like. See the module docstring.
    2. `-total` -- the similarity ranking, within each half.
    3. `|amount - bank|` -- the first tie-break, and the one a reviewer can see with their own eyes.
    4. `doctype`, then `name` -- ⚠️ IT ENDS IN A UNIQUE FIELD ON PURPOSE. `(doctype, name)` is
       unique across all three ledgers, so the order is TOTAL: the same input always produces the
       same list. A ranking that reshuffles equal-scoring rows between two loads of the same dialog
       is one a reviewer cannot trust, and it would make every test of this function flaky.

    NOTHING IS FILTERED OUT HERE. Filtering is the screen's job and the reviewer's choice; a ranker
    that quietly dropped rows would make a record look as though it does not exist.
    """
    scored = [(record, score_record(row, record, policy)) for record in records]
    scored.sort(
        key=lambda pair: (
            not pair[0].settleable,
            -pair[1].total,
            abs(to_decimal(pair[0].amount) - row.amount),
            pair[0].doctype,
            pair[0].name,
        )
    )
    return tuple(scored)


# ---------------------------------------------------------------------------------------------
# Shared token comparison
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class _Containment:
    """How much of the smaller token set the two sides share, and how many words that was.

    A tiny value object rather than a bare float because every caller wants BOTH numbers: the ratio
    scores, and the count is what the reason sentence says. Returning a tuple made three call sites
    unpack in the same order and one of them was going to get it wrong.
    """

    ratio: float = 0.0
    shared: int = 0


def _containment(
    row: RowSignals,
    other_tokens: frozenset[str],
    policy: SimilarityPolicy,
) -> _Containment:
    """Containment of the smaller side, exactly as `matcher._name_score` computes it.

    ⚠️ CONTAINMENT, NOT JACCARD, AND FOR THE MATCHER'S OWN REASON: the statement's text is routinely
    a SUPERSET here (a remark carrying an invoice number, a site and a vendor) or a SUBSET there
    ("Md Arsad Alam" against "Md Arsad Alam Electrical Work"). Jaccard punishes both. Dividing by the
    smaller set asks "is one of these contained in the other", which is the question.

    ⚠️ THE `MIN_SIGNIFICANT_TOKENS` GUARD IS ON THE TRANSFER'S SIDE ONLY, matching the matcher. A
    one-word RECORD name is fine -- `Telus` is a real project and a real vendor, and a keyword unique
    to one of them is strong evidence. A one-word TRANSFER is not: it has nothing to be specific
    with, and it would score against half the ledger.
    """
    if not row.has_significant_text or not other_tokens:
        return _Containment()
    if len(row.text_tokens) < policy.MIN_SIGNIFICANT_TOKENS:
        return _Containment()

    shared = row.text_tokens & other_tokens
    if not shared:
        return _Containment()

    smaller = min(len(row.text_tokens), len(other_tokens))
    return _Containment(ratio=len(shared) / smaller, shared=len(shared))
