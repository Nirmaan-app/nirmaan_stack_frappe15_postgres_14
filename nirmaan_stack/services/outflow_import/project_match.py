# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Does this bank remark name a project? (Bulk Import Outflow, slice T2.)

PURE MODULE -- no `frappe`, no database, no request context. It imports `normalize`, which is itself
a pure leaf, and nothing else. Same shape and the same reason as `matcher.py`.

WHAT IT IS FOR. Tier 2 of the matcher settles a transfer against an approved record when the amount
agrees within the settle window AND the transfer's remark names that record's project. The amount
alone is a weak signal -- round numbers repeat across a ledger of thousands -- so the project is the
corroboration that makes tier 2 safe to auto-suggest. This module owns that corroboration, and
nothing else in the feature may re-derive it.

TWO WAYS A REMARK CAN NAME A PROJECT, TRIED IN THIS ORDER
---------------------------------------------------------
**1. It contains the project's whole name.** `Mind Studio Office` is named by a remark that says
   "mind studio office". This is the strong reading, and when several project names fit, the LONGEST
   wins: a remark saying "fujitsu chennai" names `Fujitsu Chennai`, not the separate project called
   `Fujitsu`, because the longer name is fully accounted for. Both of those are live projects, and
   this step is the only reason either is identifiable at all.

**2. Failing that, it contains a keyword unique to one project.** A remark saying only "telus" names
   `Telus GIFT City`, because no other project uses that word. This is the loose reading and it
   exists because people abbreviate: an accountant writes the word they know the job by, not the
   name as recorded.

A TIE IN STEP 1 STOPS THERE and yields nothing -- it does not fall through to step 2. Two projects
whose names fit the remark equally well is exactly the situation where a weaker rule must not be
allowed to break the deadlock.

WHY STEP 2 NEEDS A GENERIC-WORD LIST AND STEP 1 MUST NOT USE ONE
----------------------------------------------------------------
Uniqueness in step 2 measures rarity in the MASTER; it cannot measure how common a word is in
ENGLISH. `BOQ MEP SITE 3 TABLESPACE` is the only live project whose name contains "site", so
counting alone promotes "site" to a keyword -- and then a remark saying "payment for site work"
names that project outright. `GENERIC_PROJECT_TOKENS` is the answer, and it is the ONE maintained
vocabulary here.

Step 1 deliberately does NOT apply it. Dropping generic words there would shrink
`New Project at Chennai` to the single token "chennai", and the remark "payment chennai" would then
contain its whole name and match it. Step 1 is safe precisely because it demands everything.

⚠️ DISTINCTIVENESS IS DERIVED FROM THE PROJECT LIST -- CITIES ARE NOT ON ANY LIST. A hardcoded list
of place names was rejected: it would need an edit every time a project is named after a new city,
it would go stale silently, and the failure mode is a WRONG auto-match at Rs 5 tolerance. Counting
across the real names cannot go stale, because the names ARE the input. A project opened in Chennai
tomorrow simply makes "chennai" stop identifying anything, immediately and with no edit.

⚠️ AMBIGUITY YIELDS NOTHING, NOT A BEST GUESS -- the same rule `VendorResolution.ambiguous` follows
for two vendors on a shared bank account. `projects_mentioned` reports everything it found so a
caller can see the ambiguity; `sole_project` applies the rule. Tier 2 calls `sole_project`.

⚠️ SOME PROJECTS CAN NEVER BE NAMED, AND THAT IS THE DATA, NOT A GAP. Measured on the live master
(194 projects, 2026-08-07) by asking of each project "does its own name identify it?":

    172 of 194 (88%) yes
     22 of 194 (11%) no -- and EVERY ONE of those 22 is one of a pair of projects whose names are
                          token-identical: two `Fidelity Chennai`, two `SEBI Lucknow`, two
                          `Walter P Moore`, `verizon chennai` beside `Verizon Chennai`, `ANSR`
                          beside `ANSR - 2`, `Switch 1` beside `Switch 2`.

Nothing is lost to a weak rule; the 22 are lost to duplicate names, and no rule can tell such a pair
apart from a remark. Inventing an answer would settle money on a coin flip, so tier 2 declines and a
person decides. (Several of those pairs differ only by a trailing digit, which is dropped as a bare
number -- renaming them in the project master is the only thing that would make them identifiable.)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping, Sequence

from nirmaan_stack.services.outflow_import.normalize import NAME_NOISE_TOKENS, name_tokens

__all__ = [
    "MIN_TOKEN_LENGTH",
    "GENERIC_PROJECT_TOKENS",
    "ProjectIndex",
    "build_project_index",
    "distinctive_tokens",
]

# A token shorter than this identifies nothing on its own. It drops "2F", "CE", "09" and the like --
# real fragments of real project names, but far too collidable against free-typed remark text.
MIN_TOKEN_LENGTH = 3

# ⚠️ THE ONE MAINTAINED VOCABULARY IN THIS MODULE, AND IT IS CONSULTED BY STEP 2 ONLY -- see the
# docstring for why it has to exist and why step 1 must not use it. These are words that are COMMON
# IN A TYPED REMARK and rare in the project master, which is the one thing counting cannot detect.
# Every entry is a generic place-or-works noun taken from the live names: `site` (from `BOQ MEP SITE
# 3 TABLESPACE`), `depot` and `material` (the Material Depots), `downtown` (`DLF Downtown @
# Chennai`), and so on.
#
# ⚠️ DO NOT ADD CITY NAMES. Counting already handles them correctly and for free -- "chennai" stops
# identifying anything the moment a second Chennai project exists, with no edit here. A city added
# by hand is maintenance that buys nothing and would suppress a genuinely single-city name.
#
# Singularised forms only, because `name_tokens` singularises before this set is consulted.
GENERIC_PROJECT_TOKENS = frozenset(
    {
        "block",
        "building",
        "city",
        "depot",
        "downtown",
        "floor",
        "main",
        "material",
        "new",
        "office",
        "phase",
        "plant",
        "project",
        "site",
        "tower",
        "unit",
        "upcoming",
        "warehouse",
        "work",
    }
)


@dataclass(frozen=True)
class ProjectIndex:
    """Pre-computed comparable forms for the whole project master.

    Built once per batch, like `matcher.VendorIndex` and for the same reason: tokenising 194 project
    names for each of ~50 rows would be redundant work, and this is a derived value rather than a
    cache with a lifetime, so purity is unaffected.
    """

    token_sets: Mapping[str, frozenset[str]] = field(default_factory=dict)
    """Project id -> its full comparable tokens. STEP 1 reads this."""

    by_keyword: Mapping[str, str] = field(default_factory=dict)
    """Keyword unique to one project -> that project id. STEP 2 reads this."""

    names: Mapping[str, str] = field(default_factory=dict)
    """Project id -> display name, so a caller can say which project it recognised."""

    def projects_mentioned(self, remarks: object) -> frozenset[str]:
        """Every project this text could be naming, by either reading.

        Reports more than one when the remark is genuinely ambiguous, so a caller can explain itself
        rather than silently seeing nothing. `sole_project` is what applies the rule.
        """
        remark_tokens = _comparable_tokens(remarks)
        return frozenset(
            {p for p, _ in self._whole_name_matches(remark_tokens)}
            | self._keyword_matches(remark_tokens)
        )

    def sole_project(self, remarks: object) -> str | None:
        """The ONE project this remark names, or `None`.

        ⚠️ EXACTLY ONE, OR NOTHING. This is the predicate tier 2 gates on, so "nothing" has to mean
        "do not auto-suggest" rather than "try the first one". Same shape as `status.sole_suggestion`
        and `VendorResolution.best` behind `.ambiguous`, and for the same reason: the alternative is
        the machine choosing between two real answers.
        """
        remark_tokens = _comparable_tokens(remarks)

        # STEP 1 -- the remark contains a project's whole name.
        matches = self._whole_name_matches(remark_tokens)
        if matches:
            winners = _most_specific(matches)
            # ⚠️ ANYTHING BUT A SINGLE WINNER STOPS HERE rather than falling through to step 2. Two
            # names fitting the remark is precisely when a weaker rule must not break the deadlock.
            return winners[0] if len(winners) == 1 else None

        # STEP 2 -- a keyword unique to one project. The loose reading, for abbreviated remarks.
        found = self._keyword_matches(remark_tokens)
        return next(iter(found)) if len(found) == 1 else None

    def name_of(self, project: str | None) -> str:
        """The project's display name, for a note written to a reviewer. Falls back to the id."""
        if not project:
            return ""
        return self.names.get(project) or project

    def _whole_name_matches(self, remark_tokens: frozenset[str]) -> list[tuple[str, frozenset[str]]]:
        """`(project, its tokens)` for every project whose whole name is inside these tokens.

        ⚠️ AN EMPTY TOKEN SET IS EXCLUDED. The empty set is a subset of everything, so a project
        whose name survives tokenising as nothing at all would otherwise match every remark ever
        typed -- and there are two such projects in the live master.
        """
        return [
            (project, tokens)
            for project, tokens in self.token_sets.items()
            if tokens and tokens <= remark_tokens
        ]

    def _keyword_matches(self, remark_tokens: frozenset[str]) -> frozenset[str]:
        return frozenset(
            self.by_keyword[token]
            for token in remark_tokens
            if token in self.by_keyword and token not in GENERIC_PROJECT_TOKENS
        )


def build_project_index(projects: Sequence[tuple[str, str]]) -> ProjectIndex:
    """Index `(project_id, project_name)` pairs for both readings.

    A keyword claimed by two or more projects is dropped entirely -- not weighted down, not kept as a
    weak signal, not used as a tie-break. There is no scoring anywhere in this module, because tier
    2's other axis (the amount) is already the weak one and two weak axes do not make a strong pair.
    """
    owners: dict[str, set[str]] = {}
    token_sets: dict[str, frozenset[str]] = {}
    names: dict[str, str] = {}

    for project_id, project_name in projects:
        if not project_id:
            continue
        names[project_id] = (project_name or "").strip()
        tokens = _comparable_tokens(project_name)
        token_sets[project_id] = tokens
        for token in tokens:
            if token not in GENERIC_PROJECT_TOKENS:
                owners.setdefault(token, set()).add(project_id)

    by_keyword = {
        token: next(iter(claimants))
        for token, claimants in owners.items()
        if len(claimants) == 1
    }
    return ProjectIndex(token_sets=token_sets, by_keyword=by_keyword, names=names)


def distinctive_tokens(index: ProjectIndex, project: str) -> frozenset[str]:
    """Which keywords identify this project on their own. For tests and for explaining a match."""
    return frozenset(token for token, owner in index.by_keyword.items() if owner == project)


def _most_specific(matches: Sequence[tuple[str, frozenset[str]]]) -> list[str]:
    """The match(es) that account for every other match, or all of them when none does.

    ⚠️ IT IS SET INCLUSION, NOT LENGTH, AND THE DIFFERENCE IS A REAL CASE EITHER WAY.

    `Fujitsu` and `Fujitsu Chennai` are both live projects, and a remark saying "fujitsu chennai"
    matches both. The second CONTAINS the first, so nothing is being discarded by preferring it --
    every word that made `Fujitsu` match is still accounted for. That is a genuine refinement.

    A remark saying "covering Toshiba and SEBI Lucknow" also matches two projects, and `SEBI
    Lucknow` is the longer name -- but it does not contain `Toshiba`, so preferring it would silently
    drop a project the remark plainly names. Length alone cannot tell those two situations apart;
    inclusion can, and this returns both, which `sole_project` reads as ambiguous.
    """
    dominators = [
        project
        for project, tokens in matches
        if all(other <= tokens for _, other in matches)
    ]
    return dominators or [project for project, _ in matches]


def _comparable_tokens(value: object) -> frozenset[str]:
    """The comparable token set of a project name or a bank remark.

    BOTH SIDES GO THROUGH THIS ONE FUNCTION, which is the point: `name_tokens` case-folds, expands
    legal-form abbreviations and singularises, so `Absolute Air Solutions` in a remark meets
    `Absolute Air Solution` in the master. If the two sides were tokenised differently they would
    agree only by luck.

    Note it does NOT apply `GENERIC_PROJECT_TOKENS` -- that belongs to step 2 alone, and applying it
    here would shrink `New Project at Chennai` to "chennai" and let the remark "payment chennai"
    contain its whole name.

    Purely numeric tokens are dropped along with the noise words. A remark routinely carries an
    invoice number, a PO number or an amount, and a bare number agreeing with a project name's "09"
    is a coincidence dressed up as evidence.
    """
    return frozenset(
        token
        for token in name_tokens(value)
        if len(token) >= MIN_TOKEN_LENGTH
        and token not in NAME_NOISE_TOKENS
        and not token.isdigit()
    )
