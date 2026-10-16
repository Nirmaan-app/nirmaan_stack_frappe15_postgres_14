# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Where a completed Porter order is suggested to go, and why (#1448, ADR-0032).

PURE MODULE -- no `frappe`, no database. The upload (`api/outflow_import/porter.py`) reads the Won
projects, their site addresses and the earlier Porter imports' placements ONCE, builds a
`PlacementMaster` with `build_placement_master`, and calls `place_orders` over the statement's completed
orders. The vocabulary it writes (`REASON_*`, `STRENGTH_*`) lives in `porter.py`, beside the review that
reads it.

NOTHING TO MAINTAIN (ADR-0032). No alias table, no AI call, no list of words or places: every signal is
counted over the project master as it stands, so a project created yesterday takes part today.

THE SIGNALS
-----------
    1  name      the existing Won-only name matcher (`project_match`): whole name, else a unique word
    2  typo      one edit off a 5+ letter word unique to one project ("cignus" -> Cygnus 2F)
    3  initials  letters typed apart, read together ("v r mall" -> VR Mall Food Court, "e y" -> Ernst
                 & Young)
    4  address   words unique to one site's address, and its pincode if unique, in the order's from or
                 to address; two pieces of evidence per address end
    5  history   the placement a person kept for the same remark and city in earlier Porter imports

How they combine is `place_orders`'s docstring.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from nirmaan_stack.services.outflow_import.ledgers import (
    NON_PROJECT_EXPENSE_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
)
from nirmaan_stack.services.outflow_import.normalize import (
    NAME_NOISE_TOKENS,
    name_tokens,
    normalize_name,
)
from nirmaan_stack.services.outflow_import.porter import (
    EXPENSE_TYPE,
    REASON_ADDRESS,
    REASON_CONFLICT,
    REASON_HISTORY,
    REASON_INITIALS,
    REASON_NAME,
    REASON_TYPO,
    STRENGTH_CHECK,
    STRENGTH_STRONG,
    remark_group_key,
)
from nirmaan_stack.services.outflow_import.project_match import (
    GENERIC_PROJECT_TOKENS,
    ProjectIndex,
    alias_haystack,
    build_project_index,
    comparable_tokens,
)

__all__ = [
    "ADDRESS_MIN_EVIDENCE",
    "EarlierPlacement",
    "MAJORITY_MIN_ORDERS",
    "OrderFacts",
    "Placement",
    "PlacementMaster",
    "REASONS_JOINED_BY",
    "SiteAddress",
    "TYPO_MIN_WORD_LENGTH",
    "address_project",
    "build_placement_master",
    "initials_project",
    "place_orders",
    "typo_project",
]

#: Signal 2 reads a typo only off a project word at least this long AS WRITTEN ("cygnus", "telus"):
#: one letter off a shorter word is too often another word.
TYPO_MIN_WORD_LENGTH = 5

#: Signal 4 needs this many pieces of evidence for one project at one address end.
ADDRESS_MIN_EVIDENCE = 2

#: The group majority: a project voted by at least max(this, half the group) of its orders.
MAJORITY_MIN_ORDERS = 2

#: A reason naming the signals that agreed: "name+address".
REASONS_JOINED_BY = "+"

_PINCODE = re.compile(r"(?<!\d)\d{6}(?!\d)")


@dataclass(frozen=True)
class Placement:
    """Where a completed order's Expense would go, and why. Blank project means Non-Project."""

    ledger: str
    project: str | None
    project_name: str
    expense_type: str
    reason: str
    strength: str


@dataclass(frozen=True)
class OrderFacts:
    """What placement reads of one completed order: its remark, city and two address ends."""

    name: str
    remarks: str
    city: str
    from_address: str
    to_address: str


@dataclass(frozen=True)
class SiteAddress:
    """A Won project's site address, as `Projects.project_address` -> `Address` holds it."""

    project: str
    address_line1: str
    address_line2: str
    city: str
    state: str
    country: str
    pincode: str


@dataclass(frozen=True)
class EarlierPlacement:
    """One earlier Porter order and where it is now: its Porter Order's remark and city, and the project
    of the live Expense that links to it (None: a Non-Project Expense).

    ⚠️ THE LIVE EXPENSE, NOT THE IMPORT ROW'S PLAN. Create writes the Expense the review kept; a Rectify
    (#1449) replaces it with one on the new placement, linking the same Porter Order; an Unreconcile
    deletes it, and the order then says nothing. So reading the Expense sees every person's decision.
    """

    remark: str
    city: str
    project: str | None


@dataclass(frozen=True)
class PlacementMaster:
    """The Won project master, as every signal reads it. Built once per upload."""

    index: ProjectIndex
    history: Mapping[str, str | None]
    """Remark group key -> the placement most earlier orders of that remark and city kept (None:
    Non-Project). A key that is absent has no history. Signal 5 reads it."""
    typo_keywords: Mapping[str, str]
    """Keyword unique to one project, written with 5+ letters -> that project. Signal 2 reads it."""
    name_words: frozenset[str]
    """Every comparable word of every project name: a remark word in here is a word, not a typo."""
    initials: Mapping[str, str]
    """A project's initials, or a word of its name, claimed by that project alone -> the project.
    Signal 3 reads it."""
    site_words: Mapping[str, str]
    """A word of exactly one site's address lines -> that project. Signal 4 reads it."""
    site_pincodes: Mapping[str, str]
    """A pincode of exactly one site -> that project. Signal 4 reads it."""
    region_words: frozenset[str]
    """Every word of every site's city, state and country: they say where, never which site."""


def build_placement_master(
    projects: Sequence[tuple[str, str]],
    sites: Sequence[SiteAddress] = (),
    earlier: Sequence[EarlierPlacement] = (),
) -> PlacementMaster:
    """Index `(project_id, project_name)` of WON projects only (the caller's job, as Cashbook's
    `_build_plan`): indexing every project lets a Tendering duplicate tie a Won project's whole name.
    A site, or an earlier placement, on a project not in `projects` is ignored."""
    index = build_project_index(projects)
    sites = [site for site in sites if site.project in index.names]
    region = frozenset().union(
        *(comparable_tokens(f"{site.city} {site.state} {site.country}") for site in sites)
    )
    written_length: dict[str, int] = {}
    for _, project_name in projects:
        # `name_tokens` maps each word of `normalize_name` to its comparable form, one to one.
        for written, token in zip(normalize_name(project_name).split(), name_tokens(project_name)):
            written_length[token] = max(written_length.get(token, 0), len(written))
    return PlacementMaster(
        index=index,
        history=_kept_placements(earlier, index),
        typo_keywords={
            token: project
            for token, project in index.by_keyword.items()
            if written_length.get(token, 0) >= TYPO_MIN_WORD_LENGTH
        },
        name_words=frozenset().union(*index.token_sets.values()),
        initials=_sole_owners(
            (project, spelling)
            for project, project_name in projects
            if project in index.names
            for spelling in _initial_spellings(project_name)
        ),
        site_words=_sole_owners(
            (site.project, word)
            for site in sites
            for word in comparable_tokens(f"{site.address_line1} {site.address_line2}")
            - region
            - GENERIC_PROJECT_TOKENS
        ),
        site_pincodes=_sole_owners(
            (site.project, pincode)
            for site in sites
            for pincode in set(
                _PINCODE.findall(f"{site.pincode} {site.address_line1} {site.address_line2}")
            )
        ),
        region_words=region,
    )


def _kept_placements(
    earlier: Sequence[EarlierPlacement], index: ProjectIndex
) -> dict[str, str | None]:
    """Per remark group key, the placement held by MORE THAN HALF its earlier orders. One order moved
    on its own (a one-off) does not unseat the group; an even split says nothing. A placement on a
    project no longer Won is not counted at all."""
    kept: dict[str, Counter] = {}
    for order in earlier:
        key = remark_group_key(order.remark, order.city)
        if not key or (order.project and order.project not in index.names):
            continue
        kept.setdefault(key, Counter())[order.project or None] += 1
    history: dict[str, str | None] = {}
    for key, counts in kept.items():
        placement, count = counts.most_common(1)[0]
        if count * 2 > sum(counts.values()):
            history[key] = placement
    return history


def place_orders(orders: Sequence[OrderFacts], master: PlacementMaster) -> dict[str, Placement]:
    """Each completed order's placement, by order name, in the order given.

    Orders are taken by remark group (`porter.remark_group_key`: normalised remark and city), the group
    review assigns at once; an order with no remark is a group of its own.

        name  = signal 5, else signals 1-3, on the remark -> one placement, or nothing (also when the
                remark is ambiguous)
        addr  = signal 4 per order; the group majority = the one project voted by
                >= max(2, ceil(n/2)) of its n orders
        the name gives a placement:
            a majority for ANOTHER project -> no suggestion: reason "conflict", Check
            history kept it Non-Project -> Non-Project, reason "history"
            else -> the name's project: Strong when an address agrees (the order's own vote or the
                    majority; reason "<name reason>+address"), else Check when the reading was loose
                    (a single word, a typo, initials), else Strong
        else -> the order's own address vote (reason "address", Check), else blank (Non-Project)

    ⚠️ A SINGLE NOISY ADDRESS NEVER MOVES A NAME. Only a group majority can, and then only to "decide it
    yourself", never onto the address's project.
    """
    groups: dict[str, list[OrderFacts]] = {}
    for order in orders:
        key = remark_group_key(order.remarks, order.city) or f"order:{order.name}"
        groups.setdefault(key, []).append(order)
    placed: dict[str, Placement] = {}
    for members in groups.values():
        placed.update(_place_group(members, master))
    return {order.name: placed[order.name] for order in orders}


@dataclass(frozen=True)
class _Reading:
    """What the remark says: a project, why, and whether the reading was loose -- one a person should
    check unless an address backs it."""

    project: str | None
    """None only from history: a person kept these orders Non-Project."""
    reason: str
    loose: bool


def _place_group(members: Sequence[OrderFacts], master: PlacementMaster) -> dict[str, Placement]:
    reading = _read_remark(members[0], master)
    votes = {order.name: address_project(order, master) for order in members}
    majority = _majority(list(votes.values()), len(members))

    if reading is None:
        return {
            name: _on(vote, master, REASON_ADDRESS, STRENGTH_CHECK) if vote else _NON_PROJECT
            for name, vote in votes.items()
        }
    if majority and majority != reading.project:
        return {name: _CONFLICT for name in votes}
    if reading.project is None:
        return {name: _off(reading.reason, STRENGTH_STRONG) for name in votes}

    placed = {}
    for name, vote in votes.items():
        if reading.project in (vote, majority):
            reason = f"{reading.reason}{REASONS_JOINED_BY}{REASON_ADDRESS}"
            placed[name] = _on(reading.project, master, reason, STRENGTH_STRONG)
        else:
            strength = STRENGTH_CHECK if reading.loose else STRENGTH_STRONG
            placed[name] = _on(reading.project, master, reading.reason, strength)
    return placed


def _majority(votes: list[str | None], orders: int) -> str | None:
    """The one project voted by at least max(2, ceil(n/2)) of a group's n orders, or None."""
    needed = max(MAJORITY_MIN_ORDERS, math.ceil(orders / 2))
    winners = [project for project, count in Counter(filter(None, votes)).items() if count >= needed]
    return winners[0] if len(winners) == 1 else None


def _read_remark(order: OrderFacts, master: PlacementMaster) -> _Reading | None:
    """Signal 5, then signals 1-3, on the order's remark: the one placement it points to, or None.

    ⚠️ HISTORY COMES FIRST, though it is listed last: it is a person's decision, and the name matcher
    would otherwise make the same mistake every month ("a correction is made once", story 30)."""
    key = remark_group_key(order.remarks, order.city)
    if key in master.history:
        return _Reading(master.history[key], REASON_HISTORY, loose=False)
    remarks = order.remarks
    index = master.index
    project = index.sole_project(remarks)
    if project:
        whole_name = index.token_sets.get(project) or frozenset()
        whole = bool(whole_name) and whole_name <= comparable_tokens(remarks)
        return _Reading(project, REASON_NAME, loose=not whole)
    # ⚠️ A REMARK SIGNAL 1 FOUND AMBIGUOUS STOPS HERE: a weaker reading must not break that tie.
    if index.projects_mentioned(remarks):
        return None
    found = {
        project: reason
        for project, reason in (
            (typo_project(remarks, master), REASON_TYPO),
            (initials_project(remarks, master), REASON_INITIALS),
        )
        if project
    }
    if len(found) != 1:
        return None
    project, reason = next(iter(found.items()))
    return _Reading(project, reason, loose=True)


def typo_project(remarks: str, master: PlacementMaster) -> str | None:
    """Signal 2: the ONE project with a 5+ letter keyword exactly one edit (a letter changed, added or
    dropped) from a word of the remark. A remark word that is itself a word of some project's name, or
    a generic word, is never read as a typo."""
    words = comparable_tokens(remarks) - master.name_words - GENERIC_PROJECT_TOKENS
    found = {
        project
        for word in words
        for keyword, project in master.typo_keywords.items()
        if _one_edit_apart(word, keyword)
    }
    return next(iter(found)) if len(found) == 1 else None


def initials_project(remarks: str, master: PlacementMaster) -> str | None:
    """Signal 3: the ONE project named by letters typed apart ("v r mall", "e y", "e.y"): two or more
    single letters in a row, read together. Letters typed together ("ey") are not read -- "to", "at"
    and "in" are somebody's initials too."""
    found = {
        master.initials[spelled] for spelled in _spaced_initials(remarks) if spelled in master.initials
    }
    return next(iter(found)) if len(found) == 1 else None


def address_project(order: OrderFacts, master: PlacementMaster) -> str | None:
    """Signal 4: the ONE project whose site the order's from or to address names. Two ends naming two
    projects name neither."""
    found = {_site_named(address, order.city, master) for address in (order.from_address, order.to_address)}
    found.discard(None)
    return next(iter(found)) if len(found) == 1 else None


def _site_named(address: str, city: str, master: PlacementMaster) -> str | None:
    """The one project with at least two pieces of evidence in this address end: words unique to its
    site's address lines, and its pincode if no other site has it. City, state and country words are
    never evidence: every address in that city carries them."""
    if not (address or "").strip():
        return None
    words = comparable_tokens(address) - master.region_words - comparable_tokens(city)
    evidence = Counter(master.site_words[word] for word in words if word in master.site_words)
    evidence.update(
        master.site_pincodes[pincode]
        for pincode in set(_PINCODE.findall(address))
        if pincode in master.site_pincodes
    )
    named = [project for project, count in evidence.items() if count >= ADDRESS_MIN_EVIDENCE]
    return named[0] if len(named) == 1 else None


def _initial_spellings(project_name: str) -> set[str]:
    """What spaced initials can spell to mean this project: any word of its name ("vr" of VR Mall Food
    Court), and its initials, noise words aside ("ey" of Ernst & Young)."""
    words = alias_haystack(project_name).split()
    initials = "".join(
        word[0] for word in words if word not in NAME_NOISE_TOKENS and word[0].isalpha()
    )
    return {word for word in words if word.isalpha() and len(word) > 1} | (
        {initials} if len(initials) > 1 else set()
    )


def _spaced_initials(remarks: str) -> list[str]:
    """Each run of two or more single letters in the remark, read as one word."""
    runs: list[str] = []
    run = ""
    for word in alias_haystack(remarks).split() + [""]:
        if len(word) == 1 and word.isalpha():
            run += word
            continue
        if len(run) > 1:
            runs.append(run)
        run = ""
    return runs


def _sole_owners(claims: Iterable[tuple[str, str]]) -> dict[str, str]:
    """`(owner, key)` pairs -> key: owner, for the keys exactly one owner claims.

    ⚠️ DISTINCTIVENESS IS COUNTED, NEVER LISTED (as in `project_match`): a project added tomorrow takes
    part at once, and a word two projects share stops meaning either, with no edit anywhere."""
    owners: dict[str, set[str]] = {}
    for owner, key in claims:
        owners.setdefault(key, set()).add(owner)
    return {key: next(iter(found)) for key, found in owners.items() if len(found) == 1}


def _one_edit_apart(a: str, b: str) -> bool:
    """Levenshtein distance exactly 1."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long = (a, b) if len(a) < len(b) else (b, a)
    return any(long[:i] + long[i + 1 :] == short for i in range(len(long)))


def _on(project: str, master: PlacementMaster, reason: str, strength: str) -> Placement:
    return Placement(
        ledger=PROJECT_EXPENSE_DOCTYPE,
        project=project,
        project_name=master.index.name_of(project),
        expense_type=EXPENSE_TYPE,
        reason=reason,
        strength=strength,
    )


def _off(reason: str, strength: str) -> Placement:
    return Placement(
        ledger=NON_PROJECT_EXPENSE_DOCTYPE,
        project=None,
        project_name="",
        expense_type=EXPENSE_TYPE,
        reason=reason,
        strength=strength,
    )


#: Nothing placed it: a Non-Project Expense unless a person places it.
_NON_PROJECT = _off("", "")
#: The name and most of the group's addresses disagree: no suggestion, looked at first.
_CONFLICT = _off(REASON_CONFLICT, STRENGTH_CHECK)
