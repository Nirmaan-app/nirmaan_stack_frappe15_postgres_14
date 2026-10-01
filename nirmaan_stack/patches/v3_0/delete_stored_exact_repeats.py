# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Delete the exact repeats past imports stored, and recompute what each import says about itself (#1356).

WHY IT IS NEEDED
    Until ADR-0031 every line of an uploaded statement was saved, so a line the system already held
    was stored again as a Skipped row: *Already imported* (an earlier statement holds it) or *Repeated
    in same file*. Statements overlap by design, so these copies are most of the Skipped list
    (2,964 of 4,537 rows on the 2026-10-01 production copy). New uploads no longer save them
    (#1353 / #1355); this clears the ones already stored, so the Skipped list is clean for past
    imports too.

WHAT COUNTS AS AN EXACT REPEAT HERE
    A row that is `Skipped` with skip kind *Already imported* or *Repeated in same file*, whose
    ORIGINAL row has the same bank status (trimmed, upper-cased: `duplicates.bank_status_key`). The
    original is found exactly the way the Skipped popup finds it -- `skip_sources.earlier_import_sightings`
    and `skip_sources.earlier_lines`, imported, never re-written -- so the cleanup can never delete a row
    against a different original than the one a person sees named on screen.

    A STATUS-CHANGED repeat (original SUCCESS, this one REVERSED) is news about the money and is KEPT,
    as a new upload keeps it. On the production copy that is one transfer, three rows.

⚠️ THE ORIGINAL MUST BE STRICTLY EARLIER, AND THAT IS WHAT GUARANTEES A SURVIVOR
    An *Already imported* original must sit in a batch created BEFORE this row's batch; a *Repeated in
    same file* original is the lowest-named line of the same batch, so it is earlier by construction.
    Every deleted row therefore points at a strictly earlier row with the same bank status, so every
    chain of deletions ends at a row that is NOT deleted: the transfer is always still held once. The
    popup's lookup does not ask "earlier?" -- it takes the earliest OTHER batch holding the transfer --
    and on a healthy site the two agree, because a line could only have been skipped against a batch
    that already existed. They differ only when that earlier batch is gone; then the popup's answer is
    a LATER batch, two rows could each name the other, and deleting both would lose the transfer. Such
    a row is kept. Keeping is the recoverable direction: a copy someone can see beats a transfer gone.

⚠️ A ROW SOMETHING STILL POINTS AT IS KEPT
    `Outflow Row Match.import_row` is the only Link to this doctype. A Skipped row should never carry a
    match, and on the production copy none does, but a row that does is evidence this patch does not
    understand, so it is left alone and counted in the summary rather than deleted from under its match.

ORDER, PER IMPORT (the ticket's order)
    1. find its exact repeats -- ALL imports are planned from one snapshot BEFORE anything is deleted,
       so one import's deletions cannot change what another import's rows are judged against;
    2. record the count: ADDED to `repeats_not_saved`, not written over it. An old import holds 0, so
       this is the count; an import staged after #1353 has none of these rows, so it gains nothing --
       but if it ever did, overwriting would erase the repeats its own upload already left out;
    3. hard-delete the rows;
    4. recompute counters, status, `gross_amount` and `charges_amount` FROM THE REMAINING ROWS -- never
       by subtracting the deleted rows' share (root CLAUDE.md rule 2), so a later ordinary refresh lands
       on the same figures and a reconcile can always prove them.

RAW `DELETE`, NOT `frappe.delete_doc` -- HOW THE LIFECYCLE IS TREATED, AND WHY THAT IS CORRECT
    (root CLAUDE.md rule 1.) No document hook runs for the deleted rows, and none needs to:
    * `Outflow Import Row` has no `doc_events` (nothing under `integrations/controllers/`) and its
      controller has only a `validate`, which a delete never calls -- there is no `on_trash` or
      `after_delete` to skip;
    * the ONE value derived from these rows is the batch's rollup, and step 4 recomputes it from
      source right here, through the same `review._refresh_batch_rollup` every other path uses;
    * `frappe.delete_doc` would copy every row into Deleted Document unless told not to, and would
      enqueue one background job per row (2,964 of them) to clear dynamic links. Removing the copies
      is the point (#1352 user story 23), so the dynamic links it would clear -- `Version` and
      `Comment`, the only ones an import row is ever given -- are deleted here in the same statement
      batch instead.
    The batch writes use `update_modified=False`: nobody edited these imports, a stale derivation was
    corrected, and moving `modified` would make history read as an edit someone made.

MONEY TOTALS -- THE SAME TWO RULES THE UPLOAD USES, OVER THE STORED ROWS
    `parser.gross_by_direction` (successful debits) and `parser.charges_of` (every line), imported, so
    the patch and the upload are one rule over two populations. Before ADR-0031 every parsed line was
    stored, so for an import with no repeats this reproduces the figure it already holds.

IDEMPOTENT -- BECAUSE `run_cleanup` REPEATS UNTIL A PLAN IS EMPTY
    One pass is not enough on its own. Deleting a row can change which row a *Repeated in same file*
    line names as its original: line 1 goes (an exact repeat of an earlier import), and line 3, which
    named line 1 (SUCCESS) and so read as a status change, now names line 2 -- REVERSED, like itself.
    So `run_cleanup` plans and applies again until a plan deletes nothing, and the first run already
    lands where a second run would. It ends: every pass deletes at least one row or stops. Only
    imports that HAD rows deleted are touched at all. On the 2026-10-01 production copy one pass was
    enough.

⚠️ `batches=` IS FOR THE TEST SUITE. The suites run against the LIVE site database; a test calling
    `execute()` would clean every real import on the developer's site. `run_cleanup(batches=...)` (and
    the `plan_cleanup` / `apply_cleanup` it repeats) take a scope, exactly as `recompute_icici_gross_outflow` does. Originals are
    still looked up across ALL imports -- that is a read, and it is what the popup does.

The owner takes a database backup before this runs in production.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import.review import _refresh_batch_rollup
from nirmaan_stack.api.outflow_import.skip_sources import earlier_import_sightings, earlier_lines
from nirmaan_stack.services.outflow_import.duplicates import bank_status_key
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.parser import (
    charges_of,
    gross_by_direction,
    is_success_status,
)
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_ALREADY_IMPORTED,
    SKIP_KIND_REPEATED_IN_FILE,
)
from nirmaan_stack.services.outflow_import.status import ROW_SKIPPED

ROW_DOCTYPE = "Outflow Import Row"
BATCH_DOCTYPE = "Outflow Import Batch"
_REPEAT_KINDS = (SKIP_KIND_ALREADY_IMPORTED, SKIP_KIND_REPEATED_IN_FILE)


@dataclass
class CleanupPlan:
    """What the patch will do. `delete` is `{batch: [row names]}`; the rest is for the report."""

    delete: dict[str, list[str]] = field(default_factory=dict)
    #: Repeat rows kept because their bank status changed since the original -- news, not a copy.
    kept_status_changed: list[str] = field(default_factory=list)
    #: Repeat rows kept because no strictly earlier original could be found for them.
    kept_no_earlier_original: list[str] = field(default_factory=list)
    #: Exact repeats kept because an `Outflow Row Match` still points at them.
    kept_linked: list[str] = field(default_factory=list)
    #: `{source: rows to delete}`.
    by_source: Counter = field(default_factory=Counter)

    @property
    def row_count(self) -> int:
        return sum(len(names) for names in self.delete.values())


@dataclass(frozen=True)
class _StoredLine:
    """A stored row in the shape `gross_by_direction` / `charges_of` read."""

    amount: Decimal
    status_raw: str
    direction: str
    service_charge: Decimal
    service_tax: Decimal

    @property
    def is_success(self) -> bool:
        return is_success_status(self.status_raw)


def plan_cleanup(batches: list[str] | None = None) -> CleanupPlan:
    """Find every stored exact repeat -- in `batches` only, or on the whole site when `None`. Reads only."""
    plan = CleanupPlan()
    if batches is not None and not batches:
        return plan
    if not frappe.db.has_column(BATCH_DOCTYPE, "repeats_not_saved"):
        # The field ships with #1353; a database that has not synced it cannot record the count, and a
        # row deleted without its count is a repeat nobody can ever account for.
        return plan

    scope = "" if batches is None else " AND import_batch IN %(batches)s"
    repeats = frappe.db.sql(
        f"""
        SELECT name, import_batch, transfer_id, amount, added_on, source, direction, remarks,
               status_raw, skip_kind
          FROM "tabOutflow Import Row"
         WHERE row_status = %(skipped)s
           AND skip_kind IN %(kinds)s{scope}
         ORDER BY name
        """,
        {"skipped": ROW_SKIPPED, "kinds": _REPEAT_KINDS, "batches": tuple(batches or ())},
        as_dict=True,
    )
    if not repeats:
        return plan

    imported = [r for r in repeats if r.skip_kind == SKIP_KIND_ALREADY_IMPORTED]
    in_file = [r for r in repeats if r.skip_kind == SKIP_KIND_REPEATED_IN_FILE]
    import_originals = earlier_import_sightings(imported)
    line_originals = earlier_lines(in_file)

    batch_created = _batch_creation(
        {r.import_batch for r in imported} | {s.label for s in import_originals.values()}
    )

    exact: list[dict] = []
    for row in imported:
        original = import_originals.get(row.name)
        earlier = (
            original is not None
            and original.label in batch_created
            and batch_created[original.label] < batch_created[row.import_batch]
        )
        _classify_repeat(plan, exact, row, original.bank_status if earlier else None)
    for row in in_file:
        original = line_originals.get(row.name)
        _classify_repeat(plan, exact, row, original.status_raw if original else None)

    linked = _linked_rows([r.name for r in exact])
    for row in exact:
        if row.name in linked:
            plan.kept_linked.append(row.name)
            continue
        plan.delete.setdefault(row.import_batch, []).append(row.name)
        plan.by_source[row.source or ""] += 1
    return plan


def _classify_repeat(plan: CleanupPlan, exact: list, row, original_status: str | None) -> None:
    """File one repeat row: an exact repeat, a status change, or one with no earlier original."""
    if original_status is None:
        plan.kept_no_earlier_original.append(row.name)
    elif bank_status_key(original_status) == bank_status_key(row.status_raw):
        exact.append(row)
    else:
        plan.kept_status_changed.append(row.name)


def _batch_creation(names: set[str]) -> dict[str, object]:
    if not names:
        return {}
    return {
        b.name: b.creation
        for b in frappe.get_all(
            BATCH_DOCTYPE, filters={"name": ["in", sorted(names)]}, fields=["name", "creation"]
        )
    }


def _linked_rows(names: list[str]) -> set[str]:
    if not names:
        return set()
    return {
        r[0]
        for r in frappe.db.sql(
            """SELECT DISTINCT import_row FROM "tabOutflow Row Match" WHERE import_row IN %(names)s""",
            {"names": tuple(names)},
        )
    }


def apply_cleanup(plan: CleanupPlan) -> None:
    """Record, delete and recompute, per import, in that order. Commits nothing -- `execute()` does."""
    for batch, names in sorted(plan.delete.items()):
        frappe.db.sql(
            """UPDATE "tabOutflow Import Batch"
                  SET repeats_not_saved = COALESCE(repeats_not_saved, 0) + %(count)s
                WHERE name = %(batch)s""",
            {"count": len(names), "batch": batch},
        )
        # Raw DELETE on purpose -- see the module docstring: no hook exists to skip, the rollup is
        # recomputed below, and no Deleted Document copy is wanted. Version / Comment are the dynamic
        # links `frappe.delete_doc` would have cleared.
        frappe.db.sql(
            """DELETE FROM "tabVersion" WHERE ref_doctype = %(dt)s AND docname IN %(names)s""",
            {"dt": ROW_DOCTYPE, "names": tuple(names)},
        )
        frappe.db.sql(
            """DELETE FROM "tabComment" WHERE reference_doctype = %(dt)s AND reference_name IN %(names)s""",
            {"dt": ROW_DOCTYPE, "names": tuple(names)},
        )
        frappe.db.sql(
            """DELETE FROM "tabOutflow Import Row" WHERE name IN %(names)s""",
            {"names": tuple(names)},
        )
        _refresh_batch_rollup(batch)
        gross, charges = _money_of_stored_rows(batch)
        frappe.db.set_value(
            BATCH_DOCTYPE,
            batch,
            {"gross_amount": float(gross), "charges_amount": float(charges)},
            update_modified=False,
        )


def _money_of_stored_rows(batch: str) -> tuple[Decimal, Decimal]:
    """`(gross_amount, charges_amount)` over the rows `batch` holds now, by the upload's own two rules."""
    lines = [
        _StoredLine(
            amount=normalize_amount(r.amount),
            status_raw=r.status_raw or "",
            direction=r.direction or "",
            service_charge=normalize_amount(r.service_charge),
            service_tax=normalize_amount(r.service_tax),
        )
        for r in frappe.db.sql(
            """SELECT amount, status_raw, direction, service_charge, service_tax
                 FROM "tabOutflow Import Row" WHERE import_batch = %s""",
            (batch,),
            as_dict=True,
        )
    ]
    gross, _ = gross_by_direction(lines)
    return gross, charges_of(lines)


def _report(plan: CleanupPlan) -> str:
    sources = ", ".join(f"{src or '(blank)'}: {n}" for src, n in sorted(plan.by_source.items())) or "none"
    return (
        f"delete_stored_exact_repeats: {plan.row_count} exact repeat row(s) across "
        f"{len(plan.delete)} import(s) [{sources}]; kept {len(plan.kept_status_changed)} status-changed, "
        f"{len(plan.kept_no_earlier_original)} with no earlier original, {len(plan.kept_linked)} linked"
    )


def run_cleanup(batches: list[str] | None = None) -> CleanupPlan:
    """Plan and apply until a plan deletes nothing -- see IDEMPOTENT. Commits nothing.

    Returns everything deleted across the passes, and the rows the LAST plan kept.
    """
    done = CleanupPlan()
    while True:
        plan = plan_cleanup(batches)
        if not plan.delete:
            done.kept_status_changed = plan.kept_status_changed
            done.kept_no_earlier_original = plan.kept_no_earlier_original
            done.kept_linked = plan.kept_linked
            return done
        apply_cleanup(plan)
        for batch, names in plan.delete.items():
            done.delete.setdefault(batch, []).extend(names)
        done.by_source.update(plan.by_source)


def execute():
    if not frappe.db.table_exists(ROW_DOCTYPE):
        return
    plan = run_cleanup()
    frappe.db.commit()
    message = _report(plan)
    print(message)
    frappe.logger("outflow_import").info(message)
