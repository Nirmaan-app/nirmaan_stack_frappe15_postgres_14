# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which bank-statement lines are NOT work for a human (Bulk Import Outflow, slice B2).

PURE MODULE -- no `frappe`, no database, no filesystem, no request context. It takes one row's
narration and its two amount columns and returns a verdict. Same shape and the same reason as
`matcher.py`, `similarity.py` and `partial_settle.py`: a rule that decides what a reviewer will
never see is worth being able to read, diff and test without a bench.

⚠️ IT MUST NOT IMPORT THE MATCHER. `matcher`, `disambiguate`, `status`, `stacks`, `claims` and
`candidates` decide what an ingested transfer PAYS. This module decides only whether a line reaches
them at all, and the two questions must not be able to lean on each other: a widening made here
because a narration looked like noise would otherwise be able to change what settles unattended.
The same fence `partial_settle` and `similarity` are held behind, and a test pins it.

THE PROBLEM IT SOLVES
---------------------
An ICICI statement of 1,274 rows carries 405 lines that are not spending at all: money moved into a
payout wallet, the bank's own general-ledger shuffles, credit-card settlements and payments that
failed and bounced home. Staged as transfers they are 405 rows of work nobody can action, sitting in
the list looking like unreconciled money.

THE THREE DESIGN RULES
----------------------
(a) FAIL OPEN. An unmatched row is INGESTED, never dropped. These rules were fitted to eight months
    of ONE account, and next month brings narration forms none of them match. The two failure modes
    are NOT symmetric, which is the whole argument: a wrongly-INGESTED row is VISIBLE -- it appears
    in the staging list and a reviewer un-maps it in seconds -- while a wrongly-DROPPED row is
    INVISIBLE, and nobody ever learns it existed. So every rule is written to catch the shape it
    knows and abstain otherwise; `should_skip` has no default-skip branch and must never grow one.

(b) DIRECTION IS PART OF THE TEST, NOT DECORATION. `Ac xfr from gl 05051 to 60010` appears TWICE in
    the file with byte-identical wording -- once as a Rs 3.19 Cr DEBIT and once as a Rs 3.19 Cr
    CREDIT. They are two different categories (`internal_gl_transfer` and `internal_gl_transfer_in`)
    and only the populated amount column tells them apart. Any rule matching on narration alone
    treats one as the other. Every rule below therefore leads with `wd` or `dp`, and none is
    direction-blind.

(c) THE IFSC BEATS THE TYPED LABEL. Three rows read `Cashbook Balanc` / `Cashbook Bal` while
    carrying Cashfree's IFSC `IDFB0020101`, and one reads `Cashfree Balanc` carrying Cashbook's
    `IDFB0080101`. A human typed the wrong platform name; the IFSC came off the beneficiary record
    and cannot be mistyped that way. So each `platform_*` rule checks the IFSC FIRST and treats the
    free-text label as a FALLBACK, and the label branch stands down when a rival platform's IFSC is
    present. For the SKIP decision this happens not to matter today -- all three platforms are
    excluded either way -- but it matters for per-category attribution, and it will matter the day
    one platform moves in or out of scope.

⚠️ WHAT SKIPPING THE PAYOUT WALLETS COSTS, AND WHY IT IS STILL RIGHT
-------------------------------------------------------------------
The three `platform_*` rules exclude Rs 11.59 Cr of debits. That money REALLY DID LEAVE THE BANK, so
after this module runs there is Rs 11.59 Cr of genuine spending this statement no longer explains.
That is the CORRECT call: what left the bank is a wallet TOP-UP, not a payment to anyone, and the
real disbursements happen inside Cashfree / Cashbook / Porter and never appear in any bank narration
at all. Ingesting the top-up would invent a payee that does not exist.

⚠️ THE CONSEQUENCE IS THAT NOBODY MAY READ THE INGESTED OUTFLOW TOTAL AS "WHAT THE COMPANY SPENT".
It is what the company spent THROUGH THIS BANK ACCOUNT DIRECTLY. The Rs 11.59 Cr is accounted for by
the platforms' own payout reports, which are a separate import, and any figure presented as total
spend has to add them back.

WHY THE RULES ARE DATA
----------------------
`EXCLUSION_RULES` is an ordered sequence of `(category_id, predicate)` rather than a chain of `if`s,
for the same reason the classifier rulesets elsewhere in this app are JSON: the SET is then readable
at a glance and a reviewer can diff a policy change without reading mechanism. `should_skip` is the
mechanism and holds no policy at all -- it walks the sequence and returns the first hit.

⚠️ THE ORDER IS PART OF THE POLICY. First match wins, and the three `platform_*` rules come first so
that rule (c) resolves: a `Cashbook Balanc` line carrying Cashfree's IFSC must reach the Cashfree
rule before the Cashbook rule sees its label. Reordering them silently re-attributes rows.
"""

from __future__ import annotations

import re
from typing import Callable, Sequence

__all__ = [
    "EXCLUSION_RULES",
    "SKIP_CATEGORY_IDS",
    "should_skip",
]


# ---------------------------------------------------------------------------------------------
# The three payout platforms, by IFSC
# ---------------------------------------------------------------------------------------------
#
# ⚠️ THESE ARE THE PRIMARY IDENTITY, NOT AN OPTIMISATION -- design rule (c). The beneficiary IFSC
# rides the narration from the payee record; the platform NAME beside it was typed by a person and
# is wrong on four rows out of eight months.

IFSC_CASHFREE = "IDFB0020101"
IFSC_CASHBOOK = "IDFB0080101"
IFSC_PORTER = "RATN0000156"


# ---------------------------------------------------------------------------------------------
# Compiled narration shapes
# ---------------------------------------------------------------------------------------------
#
# Compiled once at import: `should_skip` is called per row over a thousand-row statement, and the
# rule bodies stay readable when the pattern is named rather than inlined.

# The typed platform labels. `\s*` because the statement carries both `Cashfree` and `Cash Free`.
_RE_CASHFREE_LABEL = re.compile(r"cash\s*free", re.I)
_RE_CASHBOOK_LABEL = re.compile(r"cash\s*book", re.I)
# ⚠️ WORD-BOUNDARIED, AND THE BOUNDARIES ARE THE WHOLE POINT (owner ruling 2026-09-07).
# A bare `porter` is a substring of `transporter`, so a debit to a transport vendor would be dropped
# as a wallet top-up -- an INVISIBLE loss, which is exactly the failure mode design rule (a) exists
# to prevent. It cost ZERO rows across the eight-month statement, but construction pays transporters
# and "site transportation charges" is an ordinary narration; the rule was tightened before it cost
# anything rather than after. `\b` still catches all 33 real Porter top-ups (measured), so this
# NARROWS the rule without losing the label fallback that rule (c) depends on.
# Do not relax it back to a bare substring.
_RE_PORTER_LABEL = re.compile(r"\bporter\b", re.I)

# Rule (c), the fallback's stand-down: a rival platform's IFSC on the row means the LABEL is the
# thing that is wrong, so the label branch must not fire. Case-sensitive -- an IFSC is upper-case.
_RE_RIVAL_OF_CASHFREE = re.compile(IFSC_CASHBOOK + "|" + IFSC_PORTER)

_RE_GATEWAY_WALLET_RETURN = re.compile(r"CASHFREEID", re.I)
_RE_GL_TRANSFER = re.compile(r"\bAc\s+xfr\s+from\s+gl\b", re.I)
_RE_NEFT_RETURN = re.compile(r"\s*NEFT-RETURN-", re.I)
_RE_CARD_ADJUSTMENT = re.compile(r"CMS/\s*CC\s+RBI", re.I)

# ⚠️ THE TWO PREFIX SHAPES ARE ANCHORED (`.match`, with leading `\s*` for a padded cell), NOT
# searched. `BIL/` and `ATD/` are ICICI's transaction-type prefixes and only mean what they mean at
# the START of the narration; searched, they would match the same three letters inside a vendor
# reference and drop a real payment. Anchoring is the difference between a rule and a coincidence.
_RE_BIL_PREFIX = re.compile(r"\s*BIL/")
_RE_ATD_PREFIX = re.compile(r"\s*ATD/")

# ⚠️ CASE-SENSITIVE ON PURPOSE, unlike its `ICICI\s*(CRED|BANK)` partner. `BIL/` and `ATD/` are the
# bank's own machine-written prefixes and are always upper-case; the payee half of the narration is
# free text and is not.

_RE_ICICI_CARD = re.compile(r"ICICI\s*(CRED|BANK)", re.I)


# ---------------------------------------------------------------------------------------------
# Reading the row
# ---------------------------------------------------------------------------------------------


def _remarks_text(remarks) -> str:
    """The narration as a string, tolerating whatever the reader handed over.

    Fail open (design rule (a)): an unreadable narration matches no rule and is INGESTED. There is
    deliberately no branch here that can turn a bad cell into a skip.
    """
    if isinstance(remarks, str):
        return remarks
    if remarks is None:
        return ""
    return str(remarks)


def _is_populated(amount) -> bool:
    """Whether this amount COLUMN carries a figure -- the direction test of design rule (b).

    ⚠️ PLAIN TRUTHINESS IS NOT ENOUGH, AND BOTH FAILURES POINT THE WRONG WAY. A spreadsheet reader
    hands a blank cell over as float `nan`, which is TRUTHY, and a CSV reader hands a zero over as
    the string `"0.00"`, which is also TRUTHY. Either would make an empty column read as populated,
    which under rule (b) is precisely how the credit leg of `Ac xfr from gl` gets filed as the debit
    leg. So: `None`, NaN, blank text and a numeric zero are all EMPTY; anything else is a figure.

    A value that looks like neither -- text that will not parse -- is treated as PRESENT rather than
    absent, because a column holding something is the weaker claim and the surrounding rules still
    have to match the narration before anything is skipped.
    """
    if amount is None:
        return False
    if isinstance(amount, str):
        text = amount.strip().replace(",", "")
        if not text:
            return False
        try:
            return float(text) != 0.0
        except ValueError:
            return True
    # NaN is the only value that is not equal to itself; this is the blank spreadsheet cell.
    if amount != amount:  # noqa: PLR0124
        return False
    try:
        return float(amount) != 0.0
    except (TypeError, ValueError):
        return True


# ---------------------------------------------------------------------------------------------
# THE POLICY -- ten rules, in order, first match wins
# ---------------------------------------------------------------------------------------------
#
# Each predicate takes `(rm, wd, dp)`: the narration text, and whether the withdrawal / deposit
# column carries a figure. Every one of them leads with a direction (rule (b)); none is allowed to
# be direction-blind.

RulePredicate = Callable[[str, bool, bool], bool]

EXCLUSION_RULES: Sequence[tuple[str, RulePredicate]] = (
    # Money parked in the Cashfree payout wallet -- a TOP-UP, not money spent. The real
    # disbursements happen inside Cashfree and never appear in any bank narration.
    # IFSC first, label as fallback, and the fallback stands down when a rival platform's IFSC is
    # on the row -- design rule (c).
    (
        "platform_cashfree",
        lambda rm, wd, dp: wd
        and (
            IFSC_CASHFREE in rm
            or (
                bool(_RE_CASHFREE_LABEL.search(rm))
                and not _RE_RIVAL_OF_CASHFREE.search(rm)
            )
        ),
    ),
    # Money parked in the Cashbook payout wallet -- same shape, same reason.
    (
        "platform_cashbook",
        lambda rm, wd, dp: wd and (IFSC_CASHBOOK in rm or bool(_RE_CASHBOOK_LABEL.search(rm))),
    ),
    # Money parked in the Porter payout wallet -- same shape, same reason.
    (
        "platform_porter",
        lambda rm, wd, dp: wd and (IFSC_PORTER in rm or bool(_RE_PORTER_LABEL.search(rm))),
    ),
    # Unspent wallet float sweeping back from the gateway -- the mirror of a top-up, and no more a
    # receipt than the top-up was a payment.
    (
        "gateway_wallet_return",
        lambda rm, wd, dp: dp and bool(_RE_GATEWAY_WALLET_RETURN.search(rm)),
    ),
    # The bank's own general-ledger move, DEBIT leg. Nothing left the company.
    (
        "internal_gl_transfer",
        lambda rm, wd, dp: wd and bool(_RE_GL_TRANSFER.search(rm)),
    ),
    # The bank's own general-ledger move, CREDIT leg. Byte-identical narration to the debit leg --
    # only the populated column separates them (design rule (b)).
    (
        "internal_gl_transfer_in",
        lambda rm, wd, dp: dp and bool(_RE_GL_TRANSFER.search(rm)),
    ),
    # A payment we made that FAILED and bounced home. The original debit is already in this file, so
    # ingesting the return would double-count the attempt.
    (
        "neft_return_failed",
        lambda rm, wd, dp: dp and bool(_RE_NEFT_RETURN.match(rm)),
    ),
    # A Rs 2 card rounding entry posted by the bank. Not a transaction anyone made.
    (
        "bank_card_adjustment",
        lambda rm, wd, dp: dp and bool(_RE_CARD_ADJUSTMENT.search(rm)),
    ),
    # ICICI credit-card settlement paid through BBPS. The card's own spending is itemised elsewhere;
    # the settlement is the balance moving, not a purchase.
    (
        "credit_card_bill_payment",
        lambda rm, wd, dp: wd
        and bool(_RE_BIL_PREFIX.match(rm))
        and bool(_RE_ICICI_CARD.search(rm)),
    ),
    # Auto-debit standing instruction against the card / credit facility. Same reasoning as the
    # settlement above; it is the facility being serviced, not a spend.
    (
        "credit_facility_auto_debit",
        lambda rm, wd, dp: wd and bool(_RE_ATD_PREFIX.match(rm)),
    ),
)

#: Every category id this module can return, in rule order. A caller writing a visible skip reason
#: can enumerate these without importing the predicates.
SKIP_CATEGORY_IDS: tuple[str, ...] = tuple(category_id for category_id, _ in EXCLUSION_RULES)


def should_skip(remarks: str, withdrawal, deposit) -> tuple[bool, str]:
    """True -> do not ingest, plus the category id that decided it.

    `(False, "")` means INGEST. That is the ONLY negative answer and it is also the DEFAULT: a row
    matching no rule falls out of the bottom and is ingested (design rule (a)). There is no
    catch-all branch here, deliberately -- see the module docstring for why a wrong ingest costs
    seconds and a wrong drop costs everything.

    The category id is returned rather than a bare boolean so the caller can put the REASON on the
    screen. "Skipped" with no reason is indistinguishable from a bug to the person reading the
    import summary, and the per-category counts are what makes a new narration form noticeable.

    ⚠️ FIRST MATCH WINS AND THE ORDER IS POLICY, NOT STYLE. The `platform_*` rules must be tried in
    the order declared or rule (c) stops resolving. Do not sort `EXCLUSION_RULES`, and do not
    short-circuit it into a dict.
    """
    text = _remarks_text(remarks)
    is_withdrawal = _is_populated(withdrawal)
    is_deposit = _is_populated(deposit)

    for category_id, matches in EXCLUSION_RULES:
        if matches(text, is_withdrawal, is_deposit):
            return True, category_id

    return False, ""
