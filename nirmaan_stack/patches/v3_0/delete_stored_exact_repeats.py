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

WHAT COUNTS AS AN EXACT REPEAT HERE -- THE UPLOAD'S OWN RULE (#1358)
    A row that is `Skipped` with skip kind *Already imported* or *Repeated in same file*, which the
    UPLOAD'S OWN WALK calls an exact repeat. Each import holding such a row is REPLAYED, its rows in
    file order (row name), through `repeats.split_repeats` -- the walk both upload paths call -- with:
    * the same identity (`duplicates.row_identity` for the import's source -- the FULL identity, so on
      ICICI the other leg of a tax pair or a GL transfer is a different line);
    * the same earlier sightings: every stored row (`candidates.prior_import_sightings`, in-flight
      ones included since #1359, never final) matching that identity, in an import created BEFORE
      this one -- and the line is exact when ANY of them has its bank status
      (`duplicates.match_repeat`), not only the earliest;
    * the same in-file rule: every line is a sighting for an identical copy; a final one (the basis of
      a status change) is every terminal line, except on Cashbook, where it is a line the plan CREATED
      (`_was_created`).
    The patch never re-implements the rule. In its default mode it never deletes a row of any other
    kind, even one the replay calls a repeat (the upload narrows its earlier sightings by period; this
    replay does not).

    ⚠️ `any_kind=True` (#1359) DROPS THAT LAST GUARD ON PURPOSE. Its candidates were never repeat-checked
    by their own upload (an exclusion rule or Cashbook "not a spend" was asked first), so they are
    judged against ALL earlier imports, not a period-narrowed set -- this can delete a copy the upload
    would have kept only because its period missed the original. That is the intended cleanup: the
    copy is still an identical, strictly earlier line, so the guarantee below holds and no transfer is
    lost.

    A STATUS-CHANGED repeat (no earlier sighting with its bank status) is news about the money and is
    KEPT, as a new upload keeps it.

⚠️ EVERY DELETED ROW REPEATS A STRICTLY EARLIER ONE, AND THAT IS WHAT GUARANTEES A SURVIVOR
    An earlier sighting must sit in an import created BEFORE this row's import; an in-file sighting is
    a line before it in the same file. So every deleted row matches a strictly earlier row with the
    same identity and bank status, every chain of deletions ends at a row that is NOT deleted, and the
    transfer is always still held once. A stored repeat whose only "original" is in a LATER import (its
    real original is gone) is not a repeat under this rule, and is kept. Keeping is the recoverable
    direction: a copy someone can see beats a transfer gone.

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
       on the same figures and a reconcile can always prove them. An import left with NO rows is kept
       -- it still records that the file was uploaded, and carries its `repeats_not_saved` -- and is
       marked `Completed`: the deriver calls an empty import `Draft`, which reads as open work (#1358).

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

MONEY TOTALS -- THE ONE HELPER THE UPLOAD USES, OVER THE STORED ROWS
    `parser.stored_money` (successful debits; every line's charges), the same call both staging paths
    make. Before ADR-0031 every parsed line was stored, so for an import with no repeats this
    reproduces the figure it already holds.

IDEMPOTENT -- `run_cleanup` REPEATS UNTIL A PLAN IS EMPTY
    The replay judges every line against ALL earlier sightings, deleted ones included, as the upload
    did, so one pass is expected to be enough: deleting a row only removes sightings, and a kept row
    had no same-status sighting to lose. `run_cleanup` still plans and applies again until a plan
    deletes nothing, so the first run lands where a second run would whatever that argument misses.
    It ends: every pass deletes at least one row or stops. Only imports that HAD rows deleted are
    touched at all.

ANY KIND (#1359) -- `any_kind=True`, run by `delete_stored_exact_repeats_of_any_kind`
    The old staging checked bank-exclusion rules, and Cashbook "not a spend", BEFORE "already
    imported", so many exact repeats were stored under another kind (*Cashfree wallet top-up*,
    *Cashbook internal movement*, ...), and old in-flight copies under whatever their skip was. This
    patch looked only at the two repeat kinds. `any_kind=True` widens the candidates to every Skipped
    row of ANY kind that is:
    * `skip_origin = System` -- a hand skip is a person's decision and is never touched;
    * carrying no `duplicate_basis` claim (#1258) -- a claim means that row is the one line a record
      justifies, so deleting it would free the record for a second line.
    Settled, Mismatched, Matched and pending rows are never candidates in either mode, and the replay,
    the linked-row guard, the count, the delete and the recompute are this module's, unchanged.

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
from frappe.utils import getdate

from nirmaan_stack.api.outflow_import.cashbook import SOURCE as CASHBOOK_SOURCE
from nirmaan_stack.api.outflow_import.review import _refresh_batch_rollup
from nirmaan_stack.services.outflow_import.candidates import prior_import_sightings
from nirmaan_stack.services.outflow_import.duplicates import (
    find_prior_sightings,
    identity_wide_fields,
    row_identity,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.parser import (
    DIRECTION_DEBIT,
    is_success_status,
    source_can_carry_credit,
    stored_money,
)
from nirmaan_stack.services.outflow_import.repeats import (
    KeptLine,
    RepeatSplit,
    split_repeats,
    terminal_line,
)
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_ALREADY_IMPORTED,
    SKIP_KIND_REPEATED_IN_FILE,
)
from nirmaan_stack.services.outflow_import.status import (
    BATCH_COMPLETED,
    ROW_SKIPPED,
    SKIP_ORIGIN_SYSTEM,
)

ROW_DOCTYPE = "Outflow Import Row"
BATCH_DOCTYPE = "Outflow Import Batch"
_REPEAT_KINDS = (SKIP_KIND_ALREADY_IMPORTED, SKIP_KIND_REPEATED_IN_FILE)
#: A row whose `duplicate_basis` claims no record (#1258) -- the reading `duplicate_preview` uses.
_UNCLAIMED_SQL = "COALESCE(duplicate_basis::text, '') IN ('', 'null', '[]')"


@dataclass
class CleanupPlan:
    """What the patch will do. `delete` is `{batch: [row names]}`; the rest is for the report."""

    delete: dict[str, list[str]] = field(default_factory=dict)
    #: Repeat rows kept because their bank status changed since the original -- news, not a copy.
    kept_status_changed: list[str] = field(default_factory=list)
    #: Repeat rows kept because the upload's rule finds no earlier sighting of them at all.
    kept_no_earlier_original: list[str] = field(default_factory=list)
    #: Exact repeats kept because an `Outflow Row Match` still points at them.
    kept_linked: list[str] = field(default_factory=list)
    #: `{source: rows to delete}`.
    by_source: Counter = field(default_factory=Counter)
    #: `{skip kind: rows to delete}`.
    by_kind: Counter = field(default_factory=Counter)

    @property
    def row_count(self) -> int:
        return sum(len(names) for names in self.delete.values())


@dataclass(frozen=True)
class _StoredLine:
    """A stored row in the shape `parser.stored_money` reads."""

    amount: Decimal
    status_raw: str
    direction: str
    service_charge: Decimal
    service_tax: Decimal

    @property
    def is_success(self) -> bool:
        return is_success_status(self.status_raw)


def plan_cleanup(batches: list[str] | None = None, any_kind: bool = False) -> CleanupPlan:
    """Find every stored exact repeat -- in `batches` only, or on the whole site when `None`. Reads only.

    `any_kind` widens the candidates from the two repeat kinds to every System skip with no claim --
    see ANY KIND in the module docstring.
    """
    plan = CleanupPlan()
    if batches is not None and not batches:
        return plan
    if not frappe.db.has_column(BATCH_DOCTYPE, "repeats_not_saved"):
        # The field ships with #1353; a database that has not synced it cannot record the count, and a
        # row deleted without its count is a repeat nobody can ever account for.
        return plan

    scope = "" if batches is None else " AND import_batch IN %(batches)s"
    candidate = (
        f"skip_origin = %(system)s AND {_UNCLAIMED_SQL}" if any_kind else "skip_kind IN %(kinds)s"
    )
    targets = [
        r[0]
        for r in frappe.db.sql(
            f"""
            SELECT DISTINCT import_batch FROM "tabOutflow Import Row"
             WHERE row_status = %(skipped)s AND {candidate}{scope}
            """,
            {
                "skipped": ROW_SKIPPED, "kinds": _REPEAT_KINDS, "system": SKIP_ORIGIN_SYSTEM,
                "batches": tuple(batches or ()),
            },
        )
    ]
    if not targets:
        return plan

    imports = {
        b.name: b for b in frappe.get_all(BATCH_DOCTYPE, fields=["name", "creation", "source"])
    }
    rows_by_batch: dict[str, list] = defaultdict(list)
    for row in frappe.db.sql(
        f"""
        SELECT name, import_batch, transfer_id, amount, added_on, direction, remarks, status_raw,
               row_status, skip_kind, skip_origin, {_UNCLAIMED_SQL} AS unclaimed
          FROM "tabOutflow Import Row"
         WHERE import_batch IN %(targets)s
         ORDER BY name
        """,
        {"targets": tuple(targets)},
        as_dict=True,
    ):
        rows_by_batch[row.import_batch].append(row)

    by_source: dict[str, list[str]] = defaultdict(list)
    for batch in sorted(targets):
        by_source[imports[batch].source or ""].append(batch)

    exact: list = []
    for source, members in by_source.items():
        # One read per source: the sightings carry the source's wide identity fields.
        index = prior_import_sightings(
            sorted({r.transfer_id for b in members for r in rows_by_batch[b] if r.transfer_id}),
            source=source,
            in_flight=True,
        )
        for batch in members:
            split = _replay(rows_by_batch[batch], imports[batch], imports, index)
            kept = {line.row.name: line for line in split.kept}
            for row in rows_by_batch[batch]:
                if not _is_candidate(row, any_kind):
                    continue
                line = kept.get(row.name)
                if line is None:
                    exact.append(row)
                elif line.earlier or line.in_file:
                    plan.kept_status_changed.append(row.name)
                else:
                    plan.kept_no_earlier_original.append(row.name)

    linked = _linked_rows([r.name for r in exact])
    for row in exact:
        if row.name in linked:
            plan.kept_linked.append(row.name)
            continue
        plan.delete.setdefault(row.import_batch, []).append(row.name)
        plan.by_source[imports[row.import_batch].source or ""] += 1
        plan.by_kind[row.skip_kind or ""] += 1
    return plan


def _is_candidate(row, any_kind: bool) -> bool:
    """A row this cleanup may delete if the replay calls it an exact repeat -- the SQL filter above,
    asked again of each row of a target import."""
    if row.row_status != ROW_SKIPPED:
        return False
    if any_kind:
        return row.skip_origin == SKIP_ORIGIN_SYSTEM and bool(row.unclaimed)
    return row.skip_kind in _REPEAT_KINDS


def _replay(rows: list, batch, imports: dict, index: dict) -> RepeatSplit:
    """Walk one stored import's rows (file order) through the upload's own `split_repeats`.

    Earlier sightings are restricted to imports created BEFORE this one -- what existed when it was
    uploaded, and what makes every deletion point strictly backwards (see the module docstring).
    """
    source = batch.source or ""

    def identity(row):
        return row_identity(
            row.transfer_id or "", normalize_amount(row.amount), _date(row.added_on),
            source=source, direction=row.direction or "", remarks=row.remarks or "",
        )

    def earlier(row):
        sightings = find_prior_sightings(
            index, row.transfer_id or "", normalize_amount(row.amount), _date(row.added_on),
            identity_wide_fields(identity(row)),
        )
        return tuple(
            s for s in sightings
            if s.label in imports and imports[s.label].creation < batch.creation
        )

    return split_repeats(
        rows,
        identity_of=identity,
        earlier_sightings_of=earlier,
        is_final_in_file=_was_created if source == CASHBOOK_SOURCE else terminal_line,
    )


def _was_created(line: KeptLine) -> bool:
    """Cashbook's in-file rule over STORED rows: a line the plan CREATED is final (#1358).

    The upload asks this of the plan (`cashbook.plan_statement`: a line with no skip reason); a stored
    line answers it by how it was staged -- every line the plan did not skip, so anything but a
    System skip. A line created and later skipped by hand was still created.
    """
    row = line.row
    return not (row.row_status == ROW_SKIPPED and row.skip_origin == SKIP_ORIGIN_SYSTEM)


def _date(value):
    return getdate(value) if value else None


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
        values = {}
        if not _refresh_batch_rollup(batch):
            # Every row was a repeat. The import stays (it records the upload and its count), and an
            # import with nothing left to do is Completed -- the deriver's empty-import Draft reads as
            # open work (`status.batch_is_open`).
            values["status"] = BATCH_COMPLETED
        gross, charges = stored_money(_stored_lines(batch))
        values.update({"gross_amount": float(gross), "charges_amount": float(charges)})
        frappe.db.set_value(BATCH_DOCTYPE, batch, values, update_modified=False)


def _stored_lines(batch: str) -> list[_StoredLine]:
    """The rows `batch` holds now, in the shape `parser.stored_money` reads.

    ⚠️ A BLANK DIRECTION ON A SOURCE THAT CANNOT STATE MONEY IN IS READ AS `Debit`. Cashbook staging
    never writes `direction`, and `backfill_outflow_row_direction` (which stamps exactly this rule on
    Cashfree / Cashbook) is not wired in `patches.txt`, so such rows can be blank -- and
    `gross_by_direction` leaves a blank out, which would re-sum the import's gross to 0. The parser
    leaves a Cashbook direction blank only on an amount-less line (a top-up), so reading it as a
    debit adds nothing the upload did not count. A source that CAN state money in keeps its blank.
    """
    source = frappe.db.get_value(BATCH_DOCTYPE, batch, "source") or ""
    blank_means = "" if source_can_carry_credit(source) else DIRECTION_DEBIT
    return [
        _StoredLine(
            amount=normalize_amount(r.amount),
            status_raw=r.status_raw or "",
            direction=r.direction or blank_means,
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


def report(plan: CleanupPlan, name: str = "delete_stored_exact_repeats") -> str:
    def counts(counter: Counter) -> str:
        return ", ".join(f"{key or '(blank)'}: {n}" for key, n in sorted(counter.items())) or "none"

    return (
        f"{name}: {plan.row_count} exact repeat row(s) across {len(plan.delete)} import(s) "
        f"[by source: {counts(plan.by_source)}] [by kind: {counts(plan.by_kind)}]; kept "
        f"{len(plan.kept_status_changed)} status-changed, {len(plan.kept_no_earlier_original)} with no "
        f"earlier original, {len(plan.kept_linked)} linked"
    )


def run_cleanup(batches: list[str] | None = None, any_kind: bool = False) -> CleanupPlan:
    """Plan and apply until a plan deletes nothing -- see IDEMPOTENT. Commits nothing.

    Returns everything deleted across the passes, and the rows the LAST plan kept.
    """
    done = CleanupPlan()
    while True:
        plan = plan_cleanup(batches, any_kind=any_kind)
        if not plan.delete:
            done.kept_status_changed = plan.kept_status_changed
            done.kept_no_earlier_original = plan.kept_no_earlier_original
            done.kept_linked = plan.kept_linked
            return done
        apply_cleanup(plan)
        for batch, names in plan.delete.items():
            done.delete.setdefault(batch, []).extend(names)
        done.by_source.update(plan.by_source)
        done.by_kind.update(plan.by_kind)


def execute():
    if not frappe.db.table_exists(ROW_DOCTYPE):
        return
    plan = run_cleanup()
    frappe.db.commit()
    message = report(plan)
    print(message)
    frappe.logger("outflow_import").info(message)
