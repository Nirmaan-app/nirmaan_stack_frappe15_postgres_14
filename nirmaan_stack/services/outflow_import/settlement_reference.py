# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What reference does a SETTLED record get from this bank row? (ADR-0020 B9)

A pure leaf. It imports two pure siblings (`sources`, and `contains_guard` for the ICICI surface) and
nothing else -- not Frappe -- so it stays callable from a plain unittest and from a backfill patch alike.

WHAT IT IS FOR
    `settle_payment` used to read `bank_reference_no` and write it `if reference:` -- a blank
    reference was a SILENT SKIP, not an error. 61 Cashfree rows carry a blank one (measured
    2026-09-10; all 61 are `Skipped`, so the defect has zero live instances and is latent). Those
    rows also carry `reference_id`, the gateway's own reference, extracted at parse time and until
    now unused. With no group id by deliberate design, a shared reference is the ONLY thing linking
    the several payments of one transfer on the Payments screen -- so a blank there costs an
    accountant the only handle they had.

⚠️ RESOLVED ONCE, AT INGEST, AND THE "ONCE" IS THE DESIGN
    The five write sites in `settle.py` read ONE persisted field, `Outflow Import Row
    .settlement_reference`, and no path can diverge from another. The per-source rung of the ladder
    lives HERE, not at a write site. Putting the wallet case at a write site instead -- which is
    where it lived before, as `api/outflow_import/cashbook.py` passing `transfer_id` into the
    expense path by hand -- reintroduces exactly the per-path divergence this shape removes, AND
    misses the payment path, which is the one currently broken for that source.

⚠️ THE BANK-STATEMENT RUNG COMES FIRST, AND FOR THAT SOURCE THE STORED VALUE IS A GUARD KEY (#1259)
    For a bank passbook (ICICI) the value is the line's whole MATCH SURFACE --
    `contains_guard.match_surface`: the narration, plus the cheque number on a cheque-clearing line
    with no long number. That is BY DESIGN what the ICICI contains-guard later searches for on the
    ledger: a record written with this text is found again when the same money reappears on a later
    statement. One function builds both texts, so the two can never diverge.

    ⚠️ ORDERING RULE: this write may never ship ahead of the contains-match. An exact-match guard
    comparing a short reference against a stored narration finds nothing, so every exact guard goes
    blind to an ICICI-settled record. The guards that read a stored reference therefore all see a
    narration now: the contains-guard (#1257), `reference_guard` (containment, #1259) and the
    Create-inflow duplicate check (contains-match, #1259).

    ⚠️ IT WINS OVER THE STORED COLUMN, SO THERE IS NO BACKFILL. A passbook row staged before #1259
    stored the short extracted reference; `settlement_reference_of_row` recomputes the surface from
    the row's own `remarks` and `reference_id` for that source. `settlement_references_of_row` still
    offers the old value, because a payment settled before #1259 carries it and a reversal must
    recognise it.

⚠️ FOR EVERY OTHER SOURCE -- THE MATCHER MUST NEVER READ THIS
    Reference MATCHING and the re-import DUPLICATE GUARD compare the BANK's real reference. Feeding
    a gateway id into either risks matching an unrelated stored value: `Project Payments.utr`
    already holds hundreds of non-bank strings (purchase order numbers, short numbers, the literal
    word "refund"), and `reference_id` is NOT unique -- 2,237 Cashfree rows carry 523 distinct
    values. FIVE surfaces therefore stay byte-unchanged and none of them may ever be pointed here:

      * `normalize_reference`                        -- the caller chooses the field; it must not
      * `candidates._payments_by_reference`          -- `Project Payments.utr` only
      * `matcher.match_by_reference`                 -- `normalized_reference`, else
                                                        `bank_reference_no`
      * the parser's stored `normalized_reference`   -- derived from `bank_reference_no` alone
      * `reference_guard.assert_reference_is_free`   -- filters `Project Payments` on `utr`

    The guard is where a mis-wire bites FIRST, because of that non-uniqueness: two unrelated
    transfers sharing a `reference_id` would have the second refused outright. `settle_payment`
    therefore GUARDS on `bank_reference_no` and WRITES `settlement_reference` -- two values, two
    jobs, and collapsing them back into one variable is the mistake this paragraph exists to stop.

    This is also why the field is not called anything with "bank" in it. `settlement_reference`
    names what it is FOR -- the value a settlement writes -- rather than where it came from, so a
    reader looking for the bank's reference does not land on it.

ACCEPTED COST (owner, unchanged)
    A gateway id written into `utr` is invisible to reference matching and to the duplicate guard.
    Invisible-but-present loses nothing against today's blank, and gives an accountant something to
    reconcile with.
"""

from nirmaan_stack.services.outflow_import.contains_guard import match_surface
from nirmaan_stack.services.outflow_import.sources import (
    source_transfer_id_is_its_reference,
    source_writes_its_match_surface,
)

__all__ = [
    "resolve_settlement_reference",
    "settlement_reference_of_row",
    "settlement_references_of_row",
]


def _stripped(value) -> str:
    """⚠️ A WHITESPACE-ONLY VALUE IS AN ABSENCE. 226 stored references on the live ledger are
    whitespace-padded; a padded blank that survived the ladder would land on a payment as a
    reference nobody can see or search for -- worse than the blank it replaced. `None` arrives from
    a persisted row's empty column, which is what a backfill reads."""
    return (value or "").strip()


def resolve_settlement_reference(
    *, bank_reference_no, reference_id, transfer_id, remarks, source
) -> str:
    """PURE. The ONE ladder: for a bank passbook, the line's match surface (#1259); otherwise the
    bank's reference, else the gateway's, else -- for a source whose transfer id is its only
    reference -- that. `""` when the row has nothing to offer, which is an honest blank rather than
    a silent skip.

    Every argument is keyword-only: the candidate values are interchangeable strings, and a
    positional call that swapped two of them would resolve to a plausible wrong answer in silence.
    `remarks` is REQUIRED rather than defaulted, so a caller that forgets it cannot silently drop the
    passbook rung. On a passbook `reference_id` is the cheque column.
    """
    return _passbook_surface(source, remarks, reference_id) or _ladder(
        bank_reference_no=bank_reference_no,
        reference_id=reference_id,
        transfer_id=transfer_id,
        source=source,
    )


def _passbook_surface(source, remarks, reference_id) -> str:
    """The match surface for a bank-passbook row; `""` for any other source or a blank narration."""
    if not source_writes_its_match_surface(source):
        return ""
    return match_surface(remarks, reference_id)


def _ladder(*, bank_reference_no, reference_id, transfer_id, source) -> str:
    """The pre-#1259 ladder, which is still every non-passbook source's whole answer."""
    return (
        _stripped(bank_reference_no)
        or _stripped(reference_id)
        or (_stripped(transfer_id) if source_transfer_id_is_its_reference(source) else "")
    )


def settlement_reference_of_row(doc) -> str:
    """PURE. The settlement reference of a PERSISTED row: the stored column if it has one, else the
    ladder recomputed from the row's own fields.

    ⚠️ THE RECOMPUTE IS A DEPLOY-WINDOW FLOOR, AND WITHOUT IT B9 IS A REGRESSION. By this repo's
    convention a patch's `patches.txt` wiring is added separately by the maintainer, so the code can
    be live while `settlement_reference` is still NULL on every existing row -- and a reader taking
    the column alone would then settle every one of them with a BLANK, which is strictly worse than
    the defect being fixed, and silent.

    ⚠️ IT RECOMPUTES THROUGH `resolve_settlement_reference`, NEVER THROUGH A SHORTER LADDER OF ITS
    OWN. An earlier draft floored on `bank_reference_no` alone, which looked harmless and quietly
    dropped the WALLET rung: a pre-backfill wallet row would have written a blank where the old
    per-site override wrote its transaction id -- the very source B9 exists to reach. One ladder,
    one function, both callers.

    ⚠️ REMOVAL CONDITION: this recompute may be deleted once
    `nirmaan_stack.patches.v3_0.backfill_outflow_settlement_reference` is wired into `patches.txt`
    AND has run everywhere. Until then it is load-bearing; after that it is dead weight that costs
    nothing. Deleting it is safe exactly when `settlement_reference` is non-blank on every row that
    can resolve to one.

    ⚠️ A BANK PASSBOOK ROW RECOMPUTES EVEN WHEN THE COLUMN IS FILLED (#1259). One staged before
    #1259 stored the short extracted reference, and that is not what its settle writes now.

    `doc` is any mapping with `.get` -- a `frappe._dict` from `get_value(..., "*")`, or a plain dict.
    A projection that omits a field simply loses that rung, so a caller that can SETTLE must select
    `bank_reference_no`, `reference_id`, `transfer_id`, `remarks` and `source`.
    """
    surface = _passbook_surface(doc.get("source"), doc.get("remarks"), doc.get("reference_id"))
    if surface:
        return surface
    stored = _stripped(doc.get("settlement_reference"))
    if stored:
        return stored
    return _ladder(
        bank_reference_no=doc.get("bank_reference_no"),
        reference_id=doc.get("reference_id"),
        transfer_id=doc.get("transfer_id"),
        source=doc.get("source"),
    )


def settlement_references_of_row(doc) -> tuple[str, ...]:
    """PURE. Every value a settle of this persisted row may have written, current first (#1259).

    What a REVERSAL compares a payment's `utr` against. A passbook payment settled before #1259
    carries the old value (the stored column, else the old ladder); one settled after carries the
    match surface. Refusing the old one would make every earlier ICICI settle un-reversible, with a
    message blaming somebody for re-pointing it. Deduplicated; blanks dropped.
    """
    current = settlement_reference_of_row(doc)
    legacy = _stripped(doc.get("settlement_reference")) or _ladder(
        bank_reference_no=doc.get("bank_reference_no"),
        reference_id=doc.get("reference_id"),
        transfer_id=doc.get("transfer_id"),
        source=doc.get("source"),
    )
    return tuple(dict.fromkeys(v for v in (current, legacy) if v))
