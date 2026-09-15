# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Undo settled legs of one import line, all or nothing (issue #1271, parent #1270).

Thin orchestrator (ADR-0010 B4): authorize -> lock -> read facts -> ask the pure decision module
(`services/outflow_import/unreconcile.py`) -> write -> re-derive -> commit.

⚠️ NOT WHITELISTED YET, ON PURPOSE. The parent spec exposes this behind a narrower access check
(Admin + Accountant Lead) that a later slice adds. Until then the ONE way in from the screen is
`expenses.reverse_allocation`, which calls this with a single leg -- so there is exactly one write
path for a reversal, and widening who can reach it stays that slice's decision.

⚠️ ALL OR NOTHING. Every requested leg's verdict is computed under the locks BEFORE anything is
written; one refused leg throws that leg's sentence and nothing is written. The writes then happen
in ONE savepoint, so a failure half way through (a concurrent writer, a hook) rolls every leg back.

⚠️ LOCK ORDER IS ROW, THEN LEGS, THEN TARGETS (sorted by name) -- the same row-then-payment order
`expenses._load_allocatable_row` takes, so a reversal and an allocation on one transfer queue behind
each other instead of deadlocking. Before #1271 the reversal took no row lock at all.

⚠️ THE CONCURRENT-WRITER REFUSAL IS A SENTENCE HERE TOO, through the same
`_concurrent_writer_refusal_as_sentence` `settle_row` and `allocate_row` share, and it ends at the
commit for the same reason: "nothing was saved" is false after it.
"""

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    _concurrent_writer_refusal_as_sentence,
    _live_legs,
    _refresh_row_allocation,
)
from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.review import (
    MATCH_DOCTYPE,
    ROW_DOCTYPE,
    _refresh_batch_rollup,
)
from nirmaan_stack.services.outflow_import.allocation import (
    MATCH_REVERSED,
    MATCH_SETTLED,
    allocated_of,
    remaining_of,
)
from nirmaan_stack.services.outflow_import.ledgers import PAYMENT_DOCTYPE
from nirmaan_stack.services.outflow_import.settle import _outflow_import_write
from nirmaan_stack.services.outflow_import.settlement_reference import (
    settlement_references_of_row,
)
from nirmaan_stack.services.outflow_import.unreconcile import (
    VERDICT_REVERT_PAYMENT,
    LegFacts,
    first_refusal,
    leg_verdict,
)

ALL_LEGS = "all"

REASON_REQUIRED = "A reason is required to reverse an allocation."

_ROW_FIELDS = [
    "name", "amount", "import_batch", "bank_reference_no", "reference_id", "transfer_id",
    "source", "remarks", "settlement_reference",
]
_LEG_FIELDS = [
    "name", "import_row", "import_batch", "target_doctype", "target_name", "target_amount",
    "match_kind",
]


def unreconcile_row(row: str, legs, reason: str) -> dict:
    """Reverse `legs` (a list of match-record names, or `"all"`) on import line `row`.

    Returns the line's re-derived status, what is allocated and remaining on it now, and one entry
    per reversed leg with the verdict that was carried out.
    """
    actor = require_outflow_access()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw(REASON_REQUIRED, title="Missing reason")

    with _concurrent_writer_refusal_as_sentence("unreconcile_row", row):
        line = _lock_row(row)
        requested = _lock_legs(line, legs)
        references = settlement_references_of_row(line)
        facts = _lock_targets_and_read_facts(requested, references)

        verdicts = [leg_verdict(facts[leg.name]) for leg in requested]
        refused = first_refusal(verdicts)
        if refused:
            frappe.throw(refused.reason, title=refused.title)

        savepoint = f"ofi_unrec_{frappe.generate_hash(length=10)}"
        frappe.db.savepoint(savepoint)
        try:
            for leg, verdict in zip(requested, verdicts):
                _carry_out(verdict.verdict, leg)
                _stamp_reversed(leg.name, actor, reason)
            new_status = _refresh_row_allocation(line.name, actor)
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise
        frappe.db.release_savepoint(savepoint)

        _refresh_batch_rollup(line.import_batch)
        frappe.db.commit()

    remaining_legs = _live_legs(line.name)
    return {
        "row": line.name,
        "row_status": new_status,
        "allocated": float(allocated_of(remaining_legs)),
        "remaining": float(remaining_of(line.amount, remaining_legs)),
        "reversed": [
            {
                "match": leg.name,
                "target_doctype": leg.target_doctype,
                "target_name": leg.target_name,
                "verdict": verdict.verdict,
                # Ruling O: the leg's own figure, for comparison against the target's Version log.
                "reversed_amount": float(leg.target_amount),
            }
            for leg, verdict in zip(requested, verdicts)
        ],
    }


def _carry_out(verdict: str, leg) -> None:
    """Perform one verdict on its target.

    ⚠️ AN UNKNOWN VERDICT RAISES. The decision module will grow new verdicts (#1270); one that is
    not wired here would otherwise stamp the leg Reversed while its target stays settled. Raising
    inside the savepoint rolls every leg back.
    """
    if verdict == VERDICT_REVERT_PAYMENT:
        _revert_payment(leg.target_name)
        return
    raise NotImplementedError(f"No write for verdict '{verdict}' on match record '{leg.name}'.")


def _lock_row(row: str):
    """The import line, under `FOR UPDATE`. The first lock taken; see the module docstring."""
    line = frappe.db.get_value(ROW_DOCTYPE, row, _ROW_FIELDS, as_dict=True, for_update=True)
    if not line:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")
    return line


def _parse_legs(legs) -> list[str] | str:
    """`"all"`, a JSON array of names (what a form POST sends), a list, or one bare name."""
    if isinstance(legs, str):
        text = legs.strip()
        if text == ALL_LEGS:
            return ALL_LEGS
        legs = frappe.parse_json(text) if text.startswith("[") else [text]
    # A repeat names the same leg twice; reversing it once is what was meant.
    return list(dict.fromkeys((name or "").strip() for name in (legs or []) if name))


def _lock_legs(line, legs) -> list:
    """The requested legs, each under `FOR UPDATE`, in the order they were asked for.

    ⚠️ A leg that is not on THIS line is refused BEFORE it is locked. The row lock serialises
    writers of this line only, so locking another line's leg would take a lock out of order -- and
    that leg would be written without its own line's lock. `import_row` never changes on a match
    record (`Outflow Row Match.validate` freezes it), so reading it unlocked is safe.
    """
    names = _parse_legs(legs)
    if names == ALL_LEGS:
        names = [leg["name"] for leg in _live_legs(line.name)]
        if not names:
            frappe.throw(
                "Nothing on this line is settled, so there is nothing to reverse.",
                title="Nothing to reverse",
            )
    if not names:
        frappe.throw("Choose at least one record to reverse.", title="Nothing selected")

    for name in names:
        import_row = frappe.db.get_value(MATCH_DOCTYPE, name, "import_row")
        if not import_row:
            frappe.throw(f"Match record '{name}' not found.", title="Not found")
        if import_row != line.name:
            frappe.throw(
                f"Match record '{name}' belongs to a different import row, not '{line.name}'.",
                title="Not on this line",
            )
    return [
        frappe.db.get_value(MATCH_DOCTYPE, name, _LEG_FIELDS, as_dict=True, for_update=True)
        for name in names
    ]


def _lock_targets_and_read_facts(legs, references) -> dict:
    """One `LegFacts` per leg, keyed by leg name. Targets are locked in name order (deadlock-safe).

    ⚠️ ONLY A SETTLED PAYMENTS LEG IS READ. Anything else is refused by the decision on facts the leg
    itself carries, and locking a record that will not be written would only widen the lock.
    """
    facts = {}
    for leg in sorted(legs, key=lambda leg: (leg.target_doctype, leg.target_name)):
        base = {
            "leg": leg.name,
            "match_kind": leg.match_kind,
            "target_doctype": leg.target_doctype,
            "target_name": leg.target_name,
            "leg_amount": leg.target_amount,
            "settlement_references": references,
        }
        if leg.match_kind != MATCH_SETTLED or leg.target_doctype != PAYMENT_DOCTYPE:
            facts[leg.name] = LegFacts(**base)
            continue
        payment = frappe.db.get_value(
            PAYMENT_DOCTYPE,
            leg.target_name,
            ["status", "utr", "amount", "tds", "split_from"],
            as_dict=True,
            for_update=True,
        )
        if not payment:
            facts[leg.name] = LegFacts(**base, target_exists=False)
            continue
        facts[leg.name] = LegFacts(
            **base,
            target_exists=True,
            target_status=payment.status,
            target_amount=payment.amount,
            target_reference=payment.utr,
            tds=payment.tds,
            split_from=payment.split_from,
            split_balance=frappe.db.get_value(
                PAYMENT_DOCTYPE, {"split_from": leg.target_name}, "name"
            ),
        )
    return facts


def _revert_payment(name: str) -> None:
    """Put a payment back to Approved. The verdict already said it may; this only writes.

    ⚠️ `doc.save()`, NOT `db.set_value`. `Paid -> Approved` is exactly the transition
    `update_parent_amount_paid` watches, and it SUMS the Paid payments rather than incrementing, so
    the PO's `amount_paid` self-corrects. A `set_value` would fire no hooks.

    ⚠️ IT CLEARS STATUS / `utr` / `payment_date` AND NOTHING ELSE. That is why the decision module
    refuses a payment carrying TDS or either half of a split: add a field here and check those
    refusals, the two live and die together. The amount is NOT restored (Ruling O).

    `from_outflow_import` + `_outflow_import_write` suppress the hooks that commit mid-save; a commit
    inside the savepoint would make the all-or-nothing rollback a silent no-op.
    """
    doc = frappe.get_doc(PAYMENT_DOCTYPE, name)
    doc.status = "Approved"
    doc.utr = None
    doc.payment_date = None
    doc.flags.from_outflow_import = True
    with _outflow_import_write():
        doc.save(ignore_permissions=True, ignore_version=False)


def _stamp_reversed(match: str, actor: str, reason: str) -> None:
    """SOFT, NOT A DELETE (ADR-0020 D3): the record is kept, so "this was settled and undone" is
    never lost, and a Reversed leg stops holding the partial unique key."""
    doc = frappe.get_doc(MATCH_DOCTYPE, match)
    doc.match_kind = MATCH_REVERSED
    doc.reversed_at = frappe.utils.now_datetime()
    doc.reversed_by = actor
    doc.reversal_reason = reason
    doc.save(ignore_permissions=True)
