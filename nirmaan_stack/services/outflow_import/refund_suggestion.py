# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bank credit line -> the waiting Vendor Refund(s) it may be (#1402, spec #1396, ADR-0032).

PURE MODULE, beside `matcher.py` and on its types: no `frappe`, no database. The caller passes the
line, its vendor resolution and the pool of refunds waiting for a bank line
(`services/vendor_refunds.every_matchable_refund`). It PROPOSES; the accountant confirms through the
decision dialog, which posts to `waiting_refund_match.match_waiting_refunds` (owner ruling 2026-08-07: every match
needs a person).

The same evidence as outgoing payments, and nothing weaker:

  (a) BANK REFERENCE. The line's reference equals the UTR typed on one or more waiting refunds. The
      only rule that may suggest a GROUP: several refunds sharing the line's reference are one split
      transfer. All of one vendor's, or nothing (one bank line is one vendor's refund).
  (b) ACCOUNT + IFSC. The line's bank account and IFSC both belong to a vendor on file, and EXACTLY ONE
      of that vendor's waiting refunds has the line's amount within `TIER1_TOLERANCE` (Re 1). Two such
      refunds are an ambiguity for a person. No credit source carries an account or IFSC today
      (ICICI's passbook has neither column), so this fires only when the data has them.

⚠️ NEVER A GROUP FROM AMOUNTS. Refunds whose amounts add up to the line are not evidence that the line
paid them (owner ruling 2026-08-07, the rule `matcher.py` states for payments). A vendor known only by
NAME never suggests: a name is a scoring form, never an identity (`matcher.account_ifsc_vendors`).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Mapping, Sequence

from nirmaan_stack.services.outflow_import.amounts import TIER1_TOLERANCE, amounts_match
from nirmaan_stack.services.outflow_import.matcher import (
    BASIS_ACCOUNT_IFSC,
    BASIS_BANK_REFERENCE,
    TargetRef,
    VendorResolution,
    account_ifsc_vendors,
    match_by_reference,
)
from nirmaan_stack.services.outflow_import.parser import DIRECTION_CREDIT

__all__ = [
    "RefundSuggestion",
    "encode_suggestion",
    "shown_suggestion",
    "suggest_waiting_refunds",
    "suggestion_note",
]


@dataclass(frozen=True)
class RefundSuggestion:
    """The waiting refund(s) a credit line is suggested to match, and the rule that found them."""

    refunds: tuple[TargetRef, ...]
    basis: str

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(r.name for r in self.refunds)

    @property
    def vendor(self) -> str | None:
        return self.refunds[0].vendor if self.refunds else None


def suggest_waiting_refunds(
    line, vendor: VendorResolution | None, waiting: Sequence[TargetRef]
) -> RefundSuggestion | None:
    """The suggestion for this credit line, or `None`. See the module docstring for the two rules.

    ⚠️ RULE (a) STOPS THE LADDER EVEN WHEN IT SUGGESTS NOTHING. A reference typed on two vendors'
    refunds is an ambiguity for a person; falling through to rule (b) would let a weaker rule overrule
    the strongest evidence on the line, as `matcher.match_payments` never lets a lower tier top up.
    """
    if (getattr(line, "direction", "") or "") != DIRECTION_CREDIT:
        return None

    by_reference = match_by_reference(line, waiting)
    if by_reference:
        refunds = by_reference[0].targets
        if len({r.vendor for r in refunds}) != 1:
            return None
        return RefundSuggestion(refunds=refunds, basis=BASIS_BANK_REFERENCE)

    vendors = account_ifsc_vendors(vendor)
    if not vendors:
        return None
    amount = getattr(line, "amount", None)
    same_amount = [
        r for r in waiting
        if r.vendor in vendors and amounts_match(r.amount, amount, TIER1_TOLERANCE)
    ]
    if len(same_amount) != 1:
        return None
    return RefundSuggestion(refunds=(same_amount[0],), basis=BASIS_ACCOUNT_IFSC)


# ---------------------------------------------------------------------------------------------
# Stored on the line (`Outflow Import Row.suggested_refunds`) and shown back to the decision dialog.
# ---------------------------------------------------------------------------------------------


def encode_suggestion(suggestion: RefundSuggestion | None) -> str | None:
    """The stored `suggested_refunds`: JSON `{vendor, basis, refunds: [names]}`, or `None`.

    Names only: amounts and POs are read fresh when the line is shown (`shown_suggestion`), so a
    refund edited after the run never shows its old figure.
    """
    if suggestion is None:
        return None
    return json.dumps(
        {"vendor": suggestion.vendor, "basis": suggestion.basis, "refunds": list(suggestion.names)}
    )


def shown_suggestion(stored, pool: Mapping[str, Mapping]) -> dict | None:
    """A stored suggestion as the decision dialog seeds it, or `None`.

    `stored` is the column's value (JSON text, or already parsed). `pool` maps each refund name still
    waiting for a bank line to its pool row (`vendor_refunds.every_matchable_refund`). Returns
    `{vendor, basis, refunds: [{name, amount, label}]}` with each refund's CURRENT amount and its PO as
    the label.

    ⚠️ ALL OR NOTHING. A group with one refund that stopped waiting (matched elsewhere, cancelled) or
    moved to another vendor is no longer what the run found, and a part of it was never suggested. A
    malformed value shows nothing rather than failing the page.
    """
    if isinstance(stored, str):
        try:
            stored = json.loads(stored) if stored.strip() else None
        except ValueError:
            return None
    if not isinstance(stored, Mapping):
        return None
    vendor, names = stored.get("vendor"), stored.get("refunds")
    if not vendor or not isinstance(names, list) or not names:
        return None

    refunds = []
    for name in names:
        current = pool.get(name) if isinstance(name, str) else None
        if current is None or current.get("vendor") != vendor:
            return None
        refunds.append(
            {
                "name": name,
                "amount": float(current.get("amount") or 0),
                "label": current.get("document_name") or name,
            }
        )
    return {"vendor": vendor, "basis": stored.get("basis") or "", "refunds": refunds}


def suggestion_note(suggestion: RefundSuggestion) -> str:
    """The line's outcome note while it carries a suggestion: what was found, and that a person confirms."""
    names = ", ".join(suggestion.names)
    if suggestion.basis == BASIS_BANK_REFERENCE:
        found = (
            f"Waiting Vendor Refund {names} carries this bank reference."
            if len(suggestion.refunds) == 1
            else f"Waiting Vendor Refunds {names} carry this bank reference."
        )
    else:
        found = (
            f"Waiting Vendor Refund {names} is at this amount, and the money came from its vendor's "
            "bank account."
        )
    return f"{found} Confirm the match to mark it Received."
