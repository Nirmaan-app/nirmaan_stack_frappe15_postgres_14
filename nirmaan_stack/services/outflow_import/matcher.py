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

TWO PASSES, AND THE ORDER IS LOAD-BEARING
-----------------------------------------
Pass A -- bank reference. `normalize_reference(bank_reference_no) == normalize_reference(utr)`.
    A direct key, and the only pass that can discover FAN-OUT: one transfer settling several
    payments. Measured on live data: 40 such transfers covering 99 payments and 2.53% of all
    settled value, the largest a single Rs 7,289,432 IMPS across 7 payments and 6 projects.
    Grouping is by shared reference, which is why this pass groups and Pass B does not.

Pass B -- vendor + exact amount + a date window. Needed because 932 of 7,420 Paid payments (12.6%)
    carry a `utr` that is not a bank reference at all: PO numbers, short numbers, the literal
    string "refund". Pass A cannot see those rows, so without Pass B they read as unrecorded money.

PASS B IS DELIBERATELY SINGLE-TARGET. A fan-out group's members each hold a FRACTION of the bank
amount, so an exact-amount pass can never reassemble one. Rather than guess at a partition -- which
would mean inventing an allocation nobody authorised -- an unreferenced fan-out stays Unmatched and
says so. Inferring a group from amounts alone is the one thing this module must not do.

WHAT IS NOT A SIGNAL: `Beneficiary Id`. It is stored nowhere in this database, so it can never
resolve to anything. It is carried on the row for provenance and ignored here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Mapping, Sequence

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
    "ExpenseCandidate",
    "RowMatchResult",
    "VendorScoringPolicy",
    "DEFAULT_VENDOR_POLICY",
    "build_vendor_index",
    "resolve_vendors",
    "match_payments",
    "match_expenses",
    "match_row",
    "BASIS_BANK_REFERENCE",
    "BASIS_VENDOR_AMOUNT_DATE",
    "BASIS_ACCOUNT",
    "BASIS_NAME",
    "BASIS_NONE",
]

BASIS_BANK_REFERENCE = "Bank reference"
BASIS_VENDOR_AMOUNT_DATE = "Vendor+amount+date"
BASIS_ACCOUNT = "account"
BASIS_NAME = "name"
BASIS_NONE = "none"

# How far a payment_date may sit from the transfer date and still be the same event. A payment is
# recorded the same day 98.9% of the time, but month-end and weekend batches drift; three days
# covers a Friday transfer recorded on Monday without reaching into the next week's run.
DEFAULT_DATE_WINDOW_DAYS = 3


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
class RowMatchResult:
    vendor: VendorResolution
    payment_groups: tuple[PaymentGroup, ...] = ()
    expense_candidates: tuple[ExpenseCandidate, ...] = ()

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
                scored[vendor.name] = VendorCandidate(
                    vendor=existing.vendor,
                    score=max(existing.score, name_score),
                    basis=existing.basis,
                    reasons=existing.reasons + (reason,),
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


def match_payments(
    row,
    targets: Sequence[TargetRef],
    vendor: VendorResolution | None = None,
    date_window_days: int = DEFAULT_DATE_WINDOW_DAYS,
) -> tuple[PaymentGroup, ...]:
    """Rank payment groups for a bank row. Pass A (reference) then Pass B (vendor+amount+date)."""
    reference = getattr(row, "normalized_reference", "") or normalize_reference(
        getattr(row, "bank_reference_no", "")
    )

    groups: list[PaymentGroup] = []

    # --- Pass A: shared bank reference. The only pass that can discover fan-out. ---
    if reference:
        by_reference = [t for t in targets if t.normalized_reference == reference]
        if by_reference:
            groups.append(
                PaymentGroup(
                    targets=tuple(sorted(by_reference, key=lambda t: t.name)),
                    basis=BASIS_BANK_REFERENCE,
                    score=1.0,
                )
            )

    if groups:
        return tuple(groups)

    # --- Pass B: vendor + exact amount + date window. SINGLE TARGET ONLY. ---
    vendor_names = {c.vendor.name for c in (vendor.candidates if vendor else ())}
    amount = getattr(row, "amount", Decimal("0"))
    row_date = getattr(row, "added_on_date", None)

    # No vendor resolved => Pass B cannot run at all. It is "vendor + amount + date"; without the
    # vendor it degrades to "amount + date", which on a ledger of 7,000+ payments matches far too
    # much to put in front of a reviewer.
    if not vendor_names:
        return ()

    for target in targets:
        if target.amount != amount:
            continue
        # A target with NO vendor of its own can never satisfy a vendor correspondence either.
        # (Payments are born from PO terms and always carry one, so this is a guard rather than a
        # live case -- but "matches because it has no vendor to disagree with" is the wrong
        # reason to offer anything.)
        if target.vendor not in vendor_names:
            continue
        if not _within_window(row_date, target.txn_date, date_window_days):
            continue
        groups.append(
            PaymentGroup(targets=(target,), basis=BASIS_VENDOR_AMOUNT_DATE, score=0.5)
        )

    return tuple(sorted(groups, key=lambda g: (-g.score, g.targets[0].name)))


def match_expenses(
    row,
    targets: Sequence[TargetRef],
) -> tuple[ExpenseCandidate, ...]:
    """Rank expense candidates: exact amount, corroborated by the description free text.

    Vendor cannot filter here and that is a property of the data, not an omission:
    `Project Expenses.vendor` is populated on 0.58% of rows and `Non Project Expenses` has no vendor
    column at all. What the descriptions DO carry -- inconsistently, but often -- is the payee's
    name, account number or IFSC, typed in by whoever raised the expense. That is a real signal and
    a fragile one, so it corroborates an amount match and never stands alone.
    """
    amount = getattr(row, "amount", Decimal("0"))
    beneficiary_tokens = frozenset(
        t for t in name_tokens(getattr(row, "beneficiary_name", "")) if t not in NAME_NOISE_TOKENS
    )
    account = getattr(row, "normalized_account", "") or ""
    ifsc = (getattr(row, "ifsc", "") or "").strip().upper()

    out: list[ExpenseCandidate] = []
    for target in targets:
        if target.amount != amount:
            continue

        score = 0.4
        reasons = ["amount matches exactly"]
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
    policy: VendorScoringPolicy = DEFAULT_VENDOR_POLICY,
    date_window_days: int = DEFAULT_DATE_WINDOW_DAYS,
) -> RowMatchResult:
    """Resolve one bank row against every pool. Proposes only -- see the module docstring."""
    vendor = resolve_vendors(row, vendor_index, policy)
    return RowMatchResult(
        vendor=vendor,
        payment_groups=match_payments(row, payment_targets, vendor, date_window_days),
        expense_candidates=match_expenses(row, expense_targets),
    )


def _within_window(left: date | None, right: date | None, days: int) -> bool:
    if left is None or right is None:
        # An undated row or target cannot be excluded on date evidence we do not have.
        return True
    return abs((left - right).days) <= days


def _digits_only(text: str) -> str:
    return "".join(ch for ch in (text or "") if ch.isdigit())
