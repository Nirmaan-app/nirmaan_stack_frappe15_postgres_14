# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bank-row -> settlement-target matching (Bulk Import Outflow, slice S2).

PURE MODULE -- no `frappe`, no database, no request context. Candidate pools are passed IN; this
module never queries. That is what makes it unit-testable without a bench, and it is the same
api -> service direction `services/boq_bcs/readiness.py` established.

THIS MODULE PROPOSES. IT NEVER DECIDES. Every function here returns RANKED CANDIDATES; the outcome
is derived in `status.py` and the choice is made by a person. That is not timidity, it is forced by
the data: one bank account maps to three legally distinct D.S. Ductofab companies with different
GSTs, and to two separate Siemens entities. There is no signal in a statement that separates them.

THREE TIERS, AND THE FIRST ONE THAT FINDS ANYTHING STOPS THE LADDER
-------------------------------------------------------------------
The tiers are graded by CONFIDENCE, not by convenience, and they are owner-ruled (2026-08-07). A
lower tier is never consulted to "top up" a higher one: if tier 1 found two candidates, that is an
ambiguity for a person to resolve, and reaching into tier 2 for a third would only make it worse.

TIER 0 -- bank reference. `normalize_reference(bank_reference_no) == normalize_reference(utr)`.
    A direct key, and the only tier that can discover FAN-OUT: one transfer settling several
    payments. Measured on live data: 40 such transfers covering 99 payments and 2.53% of all
    settled value, the largest a single Rs 7,289,432 IMPS across 7 payments and 6 projects.
    Grouping is by shared reference, which is why this tier groups and no other one does.

TIER 1 -- the beneficiary's bank account AND IFSC both match a vendor on file, and the amount agrees
    within `TIER1_TOLERANCE` (Re 1). This is the nearly-certain tier: the money demonstrably went to
    an account this company holds for that vendor, so the tight amount window costs nothing and the
    date is not consulted at all. Payments only -- an expense has no beneficiary account to compare.

TIER 2 -- the amount agrees within `AMOUNT_TOLERANCE` (Rs 5) AND the transfer's remark names the
    record's project. Payments AND Project Expenses. The amount alone is a weak signal, so the
    project is what makes this tier safe to suggest; `project_match.py` owns that rule, including
    its refusal to guess between two projects. `Non Project Expenses` has no project column, so it
    can never be reached here -- correctly, since nothing would corroborate it.

⚠️ EVERY TIER BELOW 0 IS DELIBERATELY SINGLE-TARGET. A fan-out group's members each hold a FRACTION
of the bank amount, so an amount-based tier can never reassemble one. Rather than guess at a
partition -- which would mean inventing an allocation nobody authorised -- an unreferenced fan-out
stays Unmatched and says so. Inferring a group from amounts alone is the one thing this must not do.

⚠️ WHAT WAS DELETED HERE, AND WHY IT IS NOT AN OVERSIGHT (owner ruling 2026-08-07). The previous
"Pass B" matched on VENDOR NAME + amount + a 3-day date window, and amount-only expense matching
stood beside it. Both were heuristics that decided things: a name-scored vendor and a round number
are not evidence that this transfer paid that record. Rows they used to catch now arrive `Unmatched`
and are linked by hand, which the decision dialog exists for. The vendor NAME scoring below is still
built and still persisted as the row's resolved vendor -- it just no longer matches anything.

WHAT IS NOT A SIGNAL: `Beneficiary Id`. It is stored nowhere in this database, so it can never
resolve to anything. It is carried on the row for provenance and ignored here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Mapping, Sequence

from nirmaan_stack.services.outflow_import.amounts import TIER1_TOLERANCE, amounts_match
from nirmaan_stack.services.outflow_import.normalize import (
    NAME_NOISE_TOKENS,
    name_tokens,
    normalize_account,
    normalize_name,
    normalize_reference,
)

__all__ = [
    "VendorRef",
    "VendorIndex",
    "VendorCandidate",
    "VendorResolution",
    "TargetRef",
    "PaymentGroup",
    "PaymentMatch",
    "ExpenseCandidate",
    "RowMatchResult",
    "VendorScoringPolicy",
    "DEFAULT_VENDOR_POLICY",
    "build_vendor_index",
    "resolve_vendors",
    "account_ifsc_vendors",
    "match_by_reference",
    "match_payments",
    "match_expenses",
    "match_row",
    "BASIS_BANK_REFERENCE",
    "BASIS_ACCOUNT_IFSC",
    "BASIS_PROJECT_REMARK",
    "BASIS_ACCOUNT",
    "BASIS_NAME",
    "BASIS_NONE",
    "TIER_REFERENCE",
    "TIER_ACCOUNT",
    "TIER_PROJECT",
    "TIER_NONE",
]

BASIS_BANK_REFERENCE = "Bank reference"
BASIS_ACCOUNT_IFSC = "Account+IFSC+amount"
BASIS_PROJECT_REMARK = "Amount+project in remark"
BASIS_ACCOUNT = "account"
BASIS_NAME = "name"
BASIS_NONE = "none"

# Which tier a result came from. Carried on `RowMatchResult` so `status.py` can say WHY a row
# matched -- "the bank account matches" and "the amount agrees and the remark names the project" are
# very different claims, and the reviewer confirming the row is entitled to know which one they got.
TIER_REFERENCE = "reference"
TIER_ACCOUNT = "account+IFSC"
TIER_PROJECT = "project in remark"
TIER_NONE = ""


# ---------------------------------------------------------------------------------------------
# Inputs. These are plain value objects; `candidates.py` builds them from the database and this
# module never learns where they came from.
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class VendorRef:
    """A vendor as the matcher needs to see it. Raw values -- normalisation happens here."""

    name: str
    vendor_name: str = ""
    account_name: str = ""
    account_number: str = ""
    ifsc: str = ""


@dataclass(frozen=True)
class TargetRef:
    """A candidate settlement target: a payment, or an expense.

    `reference` is the target's own stored bank reference -- `utr` on a payment, `payment_ref` on an
    expense. `description` carries the expense free text, which is a real matching signal: the one
    clean live match in this whole exercise was found because an approved accommodation expense had
    the beneficiary's account number typed into its description.
    """

    doctype: str
    name: str
    amount: Decimal
    status: str = ""
    vendor: str | None = None
    reference: str = ""
    txn_date: date | None = None
    project: str | None = None
    description: str = ""

    decided_on: date | None = None
    """When this record was DECIDED -- the M4 nearest-date input. See `ledgers.DECIDED_ON_SQL`.

    ⚠️ NOT `txn_date`, and the two must never be conflated. `txn_date` is `payment_date`, which on an
    APPROVED record is blank or forward-looking -- it is written at fulfilment, which is the very
    event this import performs. Matching on it would compare the bank's date against a date we are
    about to write ourselves.

    ⚠️ NOTHING BUT M4 READS THIS. It is an approval date on a payment and a modification timestamp on
    an expense, so it means slightly different things per ledger; any other consumer would inherit
    that ambiguity without inheriting M4's obligation to name the source in its note.

    `None` where no date could be established, which makes M4 abstain rather than guess.
    """

    @property
    def normalized_reference(self) -> str:
        return normalize_reference(self.reference)


@dataclass(frozen=True)
class VendorIndex:
    """Pre-computed comparable forms for the whole vendor master.

    Built once per batch rather than per row: normalising 1,077 vendors for each of ~50 rows would
    be 54,000 redundant passes. Purity is unaffected -- this is a derived value, not a cache with a
    lifetime.
    """

    vendors: tuple[VendorRef, ...] = ()
    by_account: Mapping[str, tuple[VendorRef, ...]] = field(default_factory=dict)
    tokens: Mapping[str, frozenset[str]] = field(default_factory=dict)
    names: Mapping[str, frozenset[str]] = field(default_factory=dict)


@dataclass(frozen=True)
class VendorCandidate:
    vendor: VendorRef
    score: float
    basis: str
    reasons: tuple[str, ...] = ()

    ifsc_matches: bool = False
    """Both the bank account AND the IFSC agreed. THE TIER 1 GATE.

    ⚠️ A FIELD, NOT A STRING SEARCH THROUGH `reasons`. Tier 1 is the tier that auto-suggests on the
    strongest evidence in this feature, and gating it on prose that exists to be read by a human
    would make an edit to a sentence silently change what settles.
    """


@dataclass(frozen=True)
class VendorResolution:
    candidates: tuple[VendorCandidate, ...] = ()
    basis: str = BASIS_NONE

    @property
    def ambiguous(self) -> bool:
        """More than one candidate survived. ALWAYS a human choice -- never auto-resolved."""
        return len(self.candidates) > 1

    @property
    def best(self) -> VendorCandidate | None:
        return self.candidates[0] if self.candidates else None


@dataclass(frozen=True)
class PaymentGroup:
    """One or more payments a single bank row may correspond to."""

    targets: tuple[TargetRef, ...]
    basis: str
    score: float = 0.0

    @property
    def total_amount(self) -> Decimal:
        return sum((t.amount for t in self.targets), Decimal("0"))

    @property
    def is_fan_out(self) -> bool:
        return len(self.targets) > 1

    @property
    def statuses(self) -> frozenset[str]:
        return frozenset(t.status for t in self.targets)


@dataclass(frozen=True)
class ExpenseCandidate:
    target: TargetRef
    score: float
    reasons: tuple[str, ...] = ()


@dataclass(frozen=True)
class PaymentMatch:
    """The payment ladder's result AND which tier produced it.

    The tier travels with the groups rather than being re-derived from `basis` by the caller: a
    caller that has to work out which rung it is standing on is one refactor away from getting it
    wrong, and this one decides whether expenses are consulted at all.
    """

    groups: tuple[PaymentGroup, ...] = ()
    tier: str = TIER_NONE


@dataclass(frozen=True)
class RowMatchResult:
    vendor: VendorResolution
    payment_groups: tuple[PaymentGroup, ...] = ()
    expense_candidates: tuple[ExpenseCandidate, ...] = ()
    tier: str = TIER_NONE
    project: str | None = None
    """The project the remark named, when tier 2 ran. `None` everywhere else."""

    @property
    def best_payment_group(self) -> PaymentGroup | None:
        return self.payment_groups[0] if self.payment_groups else None


# ---------------------------------------------------------------------------------------------
# Vendor scoring policy
#
# >>> OWNER DECISION POINT -- see `VendorScoringPolicy` below. <<<
#
# The values in DEFAULT_VENDOR_POLICY are my defaults, not a recommendation I can justify from the
# data alone. They encode two judgements only someone who works with this vendor master can make:
#
#   1. How much MORE does a bank-account hit count than a name hit? A shared account is a live
#      reality here (18 vendors share one with somebody), but so is a stale account -- one live
#      vendor was paid from an account the master does not hold at all, so the name was the only
#      route. Weighting account too hard buries that case; too little and the Dharmaraj L ->
#      SMB INSULATIONS match (findable ONLY by account, because the beneficiary is a person and the
#      vendor is a company) stops standing out.
#
#   2. Where is the line between "confident enough to pre-highlight" and "show as one of several"?
#      `MIN_NAME_SCORE` is that line. Set it high and a genuine trailing-space/ampersand/plural
#      variant drops out of the list entirely. Set it low and every "Sri Sai *" vendor appears on
#      every Sri Sai row, and the reviewer stops reading the list.
#
# Nothing auto-commits either way -- these weights only change the ORDER and the LENGTH of a list a
# person confirms. That is what makes them safe to tune later against real reviewer feedback.
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class VendorScoringPolicy:
    """Weights and thresholds for ranking vendor candidates.

    ACCOUNT_MATCH / ACCOUNT_AND_IFSC_MATCH -- score for a normalised bank-account hit, and for one
        where the IFSC agrees too. The IFSC bonus separates a genuine account match from a
        coincidental digit collision.
    NAME_EXACT_MATCH -- score when the normalised names are equal outright.
    NAME_TOKEN_WEIGHT -- multiplier applied to the token containment ratio for a partial name hit.
    MIN_NAME_SCORE -- below this a name candidate is dropped rather than shown.
    MIN_SIGNIFICANT_TOKENS -- a name must contribute at least this many non-noise tokens before
        token scoring is trusted at all; without it a one-word name matches far too much.
    """

    ACCOUNT_MATCH: float = 0.80
    ACCOUNT_AND_IFSC_MATCH: float = 0.95
    NAME_EXACT_MATCH: float = 0.75
    NAME_TOKEN_WEIGHT: float = 0.60
    MIN_NAME_SCORE: float = 0.35
    MIN_SIGNIFICANT_TOKENS: int = 2


DEFAULT_VENDOR_POLICY = VendorScoringPolicy()


# ---------------------------------------------------------------------------------------------
# Vendor resolution
# ---------------------------------------------------------------------------------------------


def build_vendor_index(vendors: Sequence[VendorRef]) -> VendorIndex:
    by_account: dict[str, list[VendorRef]] = {}
    tokens: dict[str, frozenset[str]] = {}
    names: dict[str, frozenset[str]] = {}

    for vendor in vendors:
        account = normalize_account(vendor.account_number)
        if account:
            by_account.setdefault(account, []).append(vendor)

        # Both name fields feed the index. The statement's "Beneficiary Name" is an ACCOUNT name,
        # and 174 of 1,077 vendors hold an account_name that differs from their vendor_name --
        # sometimes the trading name, sometimes a person, occasionally the bank's own name.
        vendor_tokens: set[str] = set()
        vendor_names: set[str] = set()
        for candidate_name in (vendor.vendor_name, vendor.account_name):
            normalized = normalize_name(candidate_name)
            if not normalized:
                continue
            vendor_names.add(normalized)
            vendor_tokens.update(name_tokens(candidate_name))
        tokens[vendor.name] = frozenset(vendor_tokens)
        names[vendor.name] = frozenset(vendor_names)

    return VendorIndex(
        vendors=tuple(vendors),
        by_account={k: tuple(v) for k, v in by_account.items()},
        tokens=tokens,
        names=names,
    )


def resolve_vendors(
    row,
    index: VendorIndex,
    policy: VendorScoringPolicy = DEFAULT_VENDOR_POLICY,
) -> VendorResolution:
    """Rank vendor candidates for a bank row. Account first, then name; never a single answer.

    An account hit does NOT short-circuit the name pass -- when an account is shared, the name is
    the only thing that can order the tied candidates for a reviewer.
    """
    account = getattr(row, "normalized_account", "") or normalize_account(
        getattr(row, "bank_account", "")
    )
    row_ifsc = (getattr(row, "ifsc", "") or "").strip().upper()
    beneficiary = getattr(row, "beneficiary_name", "") or ""

    scored: dict[str, VendorCandidate] = {}

    for vendor in index.by_account.get(account, ()) if account else ():
        ifsc_matches = bool(row_ifsc) and (vendor.ifsc or "").strip().upper() == row_ifsc
        reasons = ["bank account matches"]
        if ifsc_matches:
            reasons.append("IFSC matches")
        scored[vendor.name] = VendorCandidate(
            vendor=vendor,
            score=policy.ACCOUNT_AND_IFSC_MATCH if ifsc_matches else policy.ACCOUNT_MATCH,
            basis=BASIS_ACCOUNT,
            reasons=tuple(reasons),
            ifsc_matches=ifsc_matches,
        )

    row_name = normalize_name(beneficiary)
    row_tokens = frozenset(t for t in name_tokens(beneficiary) if t not in NAME_NOISE_TOKENS)

    if row_name:
        for vendor in index.vendors:
            name_score, reason = _name_score(row_name, row_tokens, vendor, index, policy)
            if name_score <= 0:
                continue
            existing = scored.get(vendor.name)
            if existing is None:
                if name_score < policy.MIN_NAME_SCORE:
                    continue
                scored[vendor.name] = VendorCandidate(
                    vendor=vendor, score=name_score, basis=BASIS_NAME, reasons=(reason,)
                )
            else:
                # Corroboration: the name agrees with an account hit. Keep the account basis (it is
                # the stronger claim) and record the extra reason for the reviewer.
                #
                # ⚠️ `ifsc_matches` MUST BE CARRIED THROUGH. This branch REBUILDS the candidate, so
                # a field left off here is silently reset to False -- and the symptom would be tier 1
                # declining exactly the rows where the evidence is STRONGEST (account, IFSC and name
                # all agreeing), which is the last place anyone would look for a bug.
                scored[vendor.name] = VendorCandidate(
                    vendor=existing.vendor,
                    score=max(existing.score, name_score),
                    basis=existing.basis,
                    reasons=existing.reasons + (reason,),
                    ifsc_matches=existing.ifsc_matches,
                )

    if not scored:
        return VendorResolution(candidates=(), basis=BASIS_NONE)

    ordered = tuple(
        sorted(scored.values(), key=lambda c: (-c.score, c.vendor.vendor_name, c.vendor.name))
    )
    basis = BASIS_ACCOUNT if any(c.basis == BASIS_ACCOUNT for c in ordered) else BASIS_NAME
    return VendorResolution(candidates=ordered, basis=basis)


def _name_score(
    row_name: str,
    row_tokens: frozenset[str],
    vendor: VendorRef,
    index: VendorIndex,
    policy: VendorScoringPolicy,
) -> tuple[float, str]:
    if row_name and row_name in index.names.get(vendor.name, frozenset()):
        return policy.NAME_EXACT_MATCH, "name matches exactly"

    vendor_tokens = frozenset(
        t for t in index.tokens.get(vendor.name, frozenset()) if t not in NAME_NOISE_TOKENS
    )
    if not row_tokens or not vendor_tokens:
        return 0.0, ""
    if len(row_tokens) < policy.MIN_SIGNIFICANT_TOKENS:
        return 0.0, ""

    shared = row_tokens & vendor_tokens
    if not shared:
        return 0.0, ""

    # Containment, not Jaccard: the statement name is routinely a SUBSET of the vendor name
    # ("Md Arsad Alam" against "Md Arsad Alam Electrical Work"), and Jaccard punishes exactly that.
    containment = len(shared) / min(len(row_tokens), len(vendor_tokens))
    return policy.NAME_TOKEN_WEIGHT * containment, f"{len(shared)} name word(s) in common"


# ---------------------------------------------------------------------------------------------
# Target matching
# ---------------------------------------------------------------------------------------------


def account_ifsc_vendors(vendor: VendorResolution | None) -> frozenset[str]:
    """The vendors whose bank account AND IFSC both matched. THE TIER 1 POPULATION.

    ⚠️ NARROWER THAN `vendor.candidates`, DELIBERATELY. A resolution also carries name-scored
    candidates and account-only ones, and tier 1 must see neither: a name is a scoring form, never
    an identity (see `normalize.py`), and an account without its IFSC is a digit sequence that could
    collide. Tier 1 is allowed to auto-suggest precisely because it stands on the strong pair.
    """
    return frozenset(
        c.vendor.name for c in (vendor.candidates if vendor else ()) if c.ifsc_matches
    )


def match_by_reference(row, targets: Sequence[TargetRef]) -> tuple[PaymentGroup, ...]:
    """TIER 0: payments sharing this transfer's bank reference, as ONE group.

    ⚠️ ALSO THE DUPLICATE GUARD'S ENTRY POINT, and that is why it is a function of its own rather
    than the first branch of `match_payments`. `review._paid_duplicate_for` must match on the
    reference ALONE -- a heuristic hit there would SKIP a row on a guess, which is the one outcome a
    duplicate guard may never produce. It used to get that property by calling `match_payments` with
    no vendor and relying on the lower passes being unable to run; with a tier ladder behind that
    name, "it cannot reach the other tiers" stopped being true by construction and became true only
    by argument. This makes it structural again.

    The group is the unit because a fan-out settles together: one transfer, several payments, one
    decision.
    """
    reference = getattr(row, "normalized_reference", "") or normalize_reference(
        getattr(row, "bank_reference_no", "")
    )
    if not reference:
        return ()

    by_reference = [t for t in targets if t.normalized_reference == reference]
    if not by_reference:
        return ()

    return (
        PaymentGroup(
            targets=tuple(sorted(by_reference, key=lambda t: t.name)),
            basis=BASIS_BANK_REFERENCE,
            score=1.0,
        ),
    )


def match_payments(
    row,
    targets: Sequence[TargetRef],
    vendor: VendorResolution | None = None,
    project: str | None = None,
) -> PaymentMatch:
    """The payment ladder: reference, then account+IFSC, then amount+project. First hit wins.

    `project` is the project the remark NAMES, already resolved -- an id, not an index. Resolving it
    is `project_match.py`'s job and doing it once per row in `match_row` keeps this function a pure
    function of plain values, which is what makes the tier boundaries testable one at a time.
    """
    groups = match_by_reference(row, targets)
    if groups:
        return PaymentMatch(groups=groups, tier=TIER_REFERENCE)

    amount = getattr(row, "amount", Decimal("0"))

    # --- TIER 1: the money went to a bank account we hold for this vendor. SINGLE TARGET ONLY. ---
    vendor_names = account_ifsc_vendors(vendor)
    if vendor_names:
        tier1 = [
            PaymentGroup(targets=(t,), basis=BASIS_ACCOUNT_IFSC, score=0.9)
            for t in targets
            # ⚠️ THE STRICT WINDOW, NOT THE SETTLE WINDOW. Tier 1 claims a rounding, and a rounding
            # cannot move a figure by more than a rupee. A Rs 4 gap is a real difference and belongs
            # to tier 2, where the project has to corroborate it.
            if amounts_match(t.amount, amount, TIER1_TOLERANCE)
            # A target with NO vendor of its own can never satisfy a vendor correspondence either.
            # (Payments are born from PO terms and always carry one, so this is a guard rather than
            # a live case -- but "matches because it has no vendor to disagree with" is the wrong
            # reason to offer anything.)
            and t.vendor in vendor_names
        ]
        if tier1:
            return PaymentMatch(
                groups=tuple(sorted(tier1, key=lambda g: g.targets[0].name)),
                tier=TIER_ACCOUNT,
            )

    # --- TIER 2: the amount agrees and the remark names this payment's project. ---
    if not project:
        return PaymentMatch()

    tier2 = [
        PaymentGroup(targets=(t,), basis=BASIS_PROJECT_REMARK, score=0.6)
        for t in targets
        if amounts_match(t.amount, amount) and t.project and t.project == project
    ]
    if not tier2:
        return PaymentMatch()
    return PaymentMatch(
        groups=tuple(sorted(tier2, key=lambda g: g.targets[0].name)), tier=TIER_PROJECT
    )


def match_expenses(
    row,
    targets: Sequence[TargetRef],
    project: str | None = None,
) -> tuple[ExpenseCandidate, ...]:
    """TIER 2 ONLY: expenses whose amount agrees AND whose project the remark names.

    ⚠️ THE PROJECT IS NOW A GATE, NOT A BONUS, AND THIS REVERSES THE PREVIOUS RULE (owner ruling
    2026-08-07). This function used to match on AMOUNT ALONE, which meant a round-number transfer
    with an approved payment and an unrelated approved expense at the same figure honestly had two
    candidates and pre-selected nothing -- the practical ceiling on how often a row opened ready.
    An expense with no project named in the remark is now simply not offered.

    ⚠️ NO PROJECT NAMED => NOTHING, and the early return says so before any target is examined. It
    is not "match everything when we have no project to filter by", which is what an unguarded
    filter would quietly become.

    Vendor still cannot filter here and that is a property of the data, not an omission:
    `Project Expenses.vendor` is populated on 0.58% of rows and `Non Project Expenses` has no vendor
    column at all -- which is also why the latter can never be matched here, since it has no project
    column either. What the descriptions DO carry -- inconsistently, but often -- is the payee's
    name, account number or IFSC, typed in by whoever raised the expense. That remains a RANKING
    signal only: it orders the candidates the project gate already admitted.
    """
    if not project:
        return ()

    amount = getattr(row, "amount", Decimal("0"))
    beneficiary_tokens = frozenset(
        t for t in name_tokens(getattr(row, "beneficiary_name", "")) if t not in NAME_NOISE_TOKENS
    )
    account = getattr(row, "normalized_account", "") or ""
    ifsc = (getattr(row, "ifsc", "") or "").strip().upper()

    out: list[ExpenseCandidate] = []
    for target in targets:
        # The SETTLE window, same as tier 2's payment half -- see `amounts.py`.
        if not amounts_match(target.amount, amount):
            continue
        if not target.project or target.project != project:
            continue

        score = 0.4
        exact = target.amount == amount
        reasons = [
            "amount matches exactly" if exact else "amount matches within the tolerance",
            "the remark names this project",
        ]
        description = target.description or ""
        description_tokens = frozenset(
            t for t in name_tokens(description) if t not in NAME_NOISE_TOKENS
        )

        # Substring over the description's digits, so an account written with separators or a
        # leading zero ("Account Number: 39088842277") still hits.
        if account and account in _digits_only(description):
            score += 0.4
            reasons.append("account number appears in the description")
        if ifsc and ifsc in description.upper():
            score += 0.1
            reasons.append("IFSC appears in the description")
        if beneficiary_tokens & description_tokens:
            score += 0.2
            reasons.append("payee name appears in the description")

        out.append(ExpenseCandidate(target=target, score=min(score, 1.0), reasons=tuple(reasons)))

    return tuple(sorted(out, key=lambda c: (-c.score, c.target.name)))


def match_row(
    row,
    vendor_index: VendorIndex,
    payment_targets: Sequence[TargetRef] = (),
    expense_targets: Sequence[TargetRef] = (),
    project_index=None,
    policy: VendorScoringPolicy = DEFAULT_VENDOR_POLICY,
) -> RowMatchResult:
    """Run the tier ladder for one bank row. Proposes only -- see the module docstring.

    ⚠️ THIS IS WHERE "THE FIRST TIER THAT FINDS ANYTHING STOPS THE LADDER" IS ENFORCED, and it is
    the reason expenses are not simply matched alongside payments. Expenses live at tier 2, so a row
    that matched at tier 0 or tier 1 must not also be handed an expense candidate -- that would turn
    a confident single suggestion into a two-candidate ambiguity that pre-selects nothing, which is
    exactly the failure the tiers were introduced to remove.

    `project_index` is optional so every existing caller and test keeps working without one; with no
    index there is no tier 2 at all, and the ladder honestly stops after tier 1.
    """
    vendor = resolve_vendors(row, vendor_index, policy)

    # Resolved ONCE per row and passed down as a plain id. `sole_project` returns None when the
    # remark names two projects, which is what keeps tier 2 from guessing between them.
    project = (
        project_index.sole_project(getattr(row, "remarks", "")) if project_index else None
    )

    payments = match_payments(row, payment_targets, vendor, project)
    if payments.tier in (TIER_REFERENCE, TIER_ACCOUNT):
        return RowMatchResult(
            vendor=vendor, payment_groups=payments.groups, tier=payments.tier
        )

    expenses = match_expenses(row, expense_targets, project)
    if payments.groups or expenses:
        return RowMatchResult(
            vendor=vendor,
            payment_groups=payments.groups,
            expense_candidates=expenses,
            tier=TIER_PROJECT,
            project=project,
        )

    return RowMatchResult(vendor=vendor, tier=TIER_NONE)


def _digits_only(text: str) -> str:
    return "".join(ch for ch in (text or "") if ch.isdigit())
