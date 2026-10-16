# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Re-uploading a Porter Statement: which invoices are repeats, and what each repeat does (#1447).

PURE MODULE -- no `frappe`, no database. `api/outflow_import/porter.py` reads, for each invoice number in
the file, the Porter Invoice already holding it (`HeldInvoice`), calls `leave_out_repeats` BEFORE it saves
anything, and stages only what comes back. A Porter Invoice is named by its invoice number, so a number
is held by at most one import.

THE RULES, AT INVOICE LEVEL (ADR-0032; the shape of ADR-0031's exact repeats):
  * an invoice whose import has CREATED something, listing the same orders (CRNs): left out, never
    downloaded or read again, and its orders counted in the new import's `repeats_not_saved`;
  * the same, but listing DIFFERENT orders: a re-issued invoice. Blocks the upload, naming it -- a silent
    double count or a silent miss is worse than a person looking;
  * an invoice held by an import that has created NOTHING (Validating, Validated, Validation failed):
    blocks the upload with "Already uploaded in OFI-…: open it or discard it". Two drafts of one month
    must never both be created; Discard (`porter_discard`) is the way to start again;
  * a file in which every invoice is left out: refused, nothing saved (ADR-0031: nothing new).

"Created" is judged per IMPORT, not per invoice: once Create has written anything, the whole import is
past Discard, and its own Create re-run finishes whatever it still owes -- a new upload must not.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from nirmaan_stack.services.outflow_import.porter import PorterStatement, PorterStatementError

__all__ = ["HeldInvoice", "PorterRepeatRefusal", "RepeatJudgement", "leave_out_repeats"]

# How many CRNs a "different orders" refusal names on each side before it says "and N more".
_CRNS_NAMED = 5


class PorterRepeatRefusal(PorterStatementError):
    """The file repeats invoices it may not repeat. The message names each one and why."""


@dataclass(frozen=True)
class HeldInvoice:
    """A Porter Invoice already in the database under an invoice number this file also lists."""

    invoice_number: str
    import_batch: str
    #: The holding import has created something (any line settled, any Porter Order written).
    created: bool
    #: Every order (CRN) the holding import staged under this invoice, cancelled ones included.
    crns: frozenset[str]


@dataclass(frozen=True)
class RepeatJudgement:
    """What the upload stages: the new invoices only, and the count of orders it left out."""

    statement: PorterStatement
    #: Invoice numbers already created, left out, in file order.
    left_out: tuple[str, ...]
    #: Their orders, cancelled ones included: lines of this file that are not saved.
    repeats_not_saved: int


def leave_out_repeats(
    statement: PorterStatement, held: Mapping[str, HeldInvoice], filename: str | None = None
) -> RepeatJudgement:
    """Apply the repeat rules to an accepted statement, or raise `PorterRepeatRefusal`.

    `held` maps an invoice number of this file to the Porter Invoice already holding it; a number not in
    it is new. Every blocking invoice is named in one refusal, re-issued ones first.
    """
    changed: list[str] = []
    uncreated: dict[str, list[str]] = {}
    left_out: list[str] = []
    for invoice in statement.invoices:
        prior = held.get(invoice.invoice_number)
        if prior is None:
            continue
        if not prior.created:
            uncreated.setdefault(prior.import_batch, []).append(invoice.invoice_number)
            continue
        crns = frozenset(line.crn for line in invoice.lines)
        if crns != prior.crns:
            changed.append(_reissued(invoice.invoice_number, prior, crns))
            continue
        left_out.append(invoice.invoice_number)

    blocks = changed + [
        f"Already uploaded in {batch}: open it or discard it "
        f"({'invoice' if len(numbers) == 1 else 'invoices'} {', '.join(numbers)})."
        for batch, numbers in uncreated.items()
    ]
    if blocks:
        raise PorterRepeatRefusal(" ".join(blocks + ["Nothing in this file was saved."]))

    if left_out and len(left_out) == len(statement.invoices):
        what = f"'{filename}'" if filename else "this file"
        batches = ", ".join(sorted({held[number].import_batch for number in left_out}))
        raise PorterRepeatRefusal(
            f"Not imported. All {len(left_out)} invoices in {what} were already created in {batches}. "
            "Nothing in this file is new, so nothing was saved."
        )

    skip = set(left_out)
    kept = PorterStatement(
        lines=tuple(line for line in statement.lines if line.invoice_number not in skip),
        invoices=tuple(invoice for invoice in statement.invoices if invoice.invoice_number not in skip),
    )
    return RepeatJudgement(
        statement=kept,
        left_out=tuple(left_out),
        repeats_not_saved=len(statement.lines) - len(kept.lines),
    )


def _reissued(number: str, prior: HeldInvoice, crns: frozenset[str]) -> str:
    added, missing = sorted(crns - prior.crns), sorted(prior.crns - crns)
    parts = []
    if added:
        parts.append(f"not in that import: {_named(added)}")
    if missing:
        parts.append(f"missing from this file: {_named(missing)}")
    return (
        f"Invoice {number} was already created in {prior.import_batch}, and this file lists different "
        f"orders on it ({'; '.join(parts)}). Porter may have re-issued it: check it with Porter."
    )


def _named(crns: list[str]) -> str:
    shown = ", ".join(crns[:_CRNS_NAMED])
    more = len(crns) - _CRNS_NAMED
    return f"{shown} and {more} more" if more > 0 else shown
