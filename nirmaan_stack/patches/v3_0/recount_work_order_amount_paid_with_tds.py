# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Recount every Work Order's Amount Paid and Amount Due under the new rule (spec #1508, #1513).

WHY
    ADR-0034 Amendment A (owner, 2026-10-19/20): a Work Order's stored `amount_paid` is its Paid payments
    PLUS the TDS withheld from the vendor on them, less its Received refunds, and its Amount Due is
    `total_amount - amount_paid` (#1509, `services/amount_paid`). Every Work Order stored before that
    holds the old figure, net of the vendor's tax. Each is recounted from source. The same spec makes
    project outflow count the TDS on Paid WO payments, both kinds (#1510, `services/project_money`), so a
    project's cashflow gap grows by that tax and some projects go over their cashflow limit.

HOW
    `services/amount_paid_drift.recount_work_orders`: every Work Order the mismatch judge finds wrong
    (stored paid, due or `total_tds` Rs 1 or more off source) is written through the one writer,
    `services/amount_paid.write_amount_paid` (paid, `total_tds`, due). It throws if any still differs
    after, so the Amount Paid Mismatch report (WO) shows no Work Orders once it has run. Idempotent: a
    second run finds nothing to change. It changes Work Orders only; Purchase Orders take no TDS.

THE CEO HOLD PREVIEW (for the owner, before the run on production)
    `preview` also lists each project the larger outflow newly puts over its cashflow limit: its gap
    without the TDS on its Paid WO payments (old) and with it (new, `project_money` today), decided by
    the owner's hold rule (`services/ceo_hold/rules.over_cashflow_limit`). A project marked
    "already on CEO Hold" is held for another reason and only gains the cashflow reason; one marked
    "recheck scheduled" is decided at its recheck date (`tasks/ceo_hold_recheck`), not before.

HOOKS
    The writer uses `set_value`, so no Service Requests doc_events fire. Skipping them is correct: the
    WO hooks (`integrations/controllers/service_requests`) recompute nothing from `amount_paid`, and the
    one writer runs everything that does (`total_tds`, `amount_due`). A Work Order has no vendor credit.
    CEO Hold is NOT re-checked, on purpose (owner, #1513): the run only recounts. It could not move a
    gap anyway: the gap reads a WO's payments and deductions, never its stored `amount_paid`. The gap
    grew when #1510's code was deployed; CEO Hold catches up through its normal check, which runs per
    project on the project's next money event (a payment entering or leaving Paid or changing amount,
    a Paid expense, an inflow, a PO's delivered / paid / status change, a cashflow limit change), and
    at the recheck date of a project in scheduled-recheck mode. The weekly bulk evaluator
    (`update_projects_cashflow_hold`) is switched off in `hooks.py`, so nothing re-checks every
    project at once.

RUN BY HAND, before migrate (preview first; send its CEO Hold list to the owner before the run)
    bench --site <site> execute nirmaan_stack.patches.v3_0.recount_work_order_amount_paid_with_tds.preview
    bench --site <site> execute nirmaan_stack.patches.v3_0.recount_work_order_amount_paid_with_tds.execute
`preview` only reads. `bench execute` commits after `execute` returns; on a throw it writes nothing. The
`patches.txt` line then makes `migrate` run it again, which finds nothing to change.
"""

from typing import NamedTuple

import frappe
from frappe.utils import flt

from nirmaan_stack.services.amount_paid_drift import Mismatch, mismatches, recount_work_orders
from nirmaan_stack.services.ceo_hold import core as ceo_hold
from nirmaan_stack.services.ceo_hold.rules import over_cashflow_limit
from nirmaan_stack.services.project_money import project_money, work_order_tds_by_project

WO = "Service Requests"
TAG = "recount_work_order_amount_paid_with_tds"


class NewHold(NamedTuple):
    """A project the WO tax newly puts over its cashflow limit."""

    project: str
    project_name: str | None
    status: str | None
    limit: float
    old_gap: float
    new_gap: float
    recheck_scheduled: bool


def new_ceo_holds(projects=None) -> list[NewHold]:
    """Every project (only those in `projects` when given) that is over its cashflow limit with the TDS
    on its Paid WO payments counted and was not without it. Reads only."""
    tax = work_order_tds_by_project(projects)
    if not tax:
        return []
    money = project_money(list(tax))
    rows = frappe.get_all(
        "Projects",
        filters={"name": ["in", list(tax)]},
        fields=["name", "project_name", "status", "cashflow_gap_limit", ceo_hold.RECHECK_SCHEDULED_FIELD],
    )
    holds = []
    for row in rows:
        new_gap = money[row.name].cashflow_gap
        old_gap = new_gap - tax[row.name]
        limit = flt(row.cashflow_gap_limit)
        if over_cashflow_limit(row.status, limit, new_gap) and not over_cashflow_limit(row.status, limit, old_gap):
            holds.append(NewHold(
                row.name, row.project_name, row.status, limit, old_gap, new_gap,
                bool(row.get(ceo_hold.RECHECK_SCHEDULED_FIELD)),
            ))
    return sorted(holds, key=lambda h: h.project)


def preview(names=None, projects=None):
    """Print what `execute` would change, and the projects that would newly go on CEO Hold. Writes nothing."""
    # The judge's mismatches are exactly what `execute` changes.
    _print_work_orders("would change", mismatches(WO, names))
    holds = new_ceo_holds(projects)
    print(f"{TAG}: {len(holds)} projects newly over their cashflow limit (old gap: without WO TDS; new: with it)")
    for h in holds:
        notes = [n for n, on in (("already on CEO Hold", h.status == ceo_hold.CEO_HOLD_STATUS),
                                 ("recheck scheduled", h.recheck_scheduled)) if on]
        print(
            f"  {h.project:<14} {(h.project_name or '')[:40]:<40} limit {h.limit:>14,.2f}"
            f"  gap {h.old_gap:>14,.2f} -> {h.new_gap:>14,.2f}  (+{h.new_gap - h.old_gap:,.2f})"
            + (f"  [{'; '.join(notes)}]" if notes else "")
        )


def execute(names=None) -> list[Mismatch]:
    """Recount every Work Order (only those in `names` when given) the judge finds wrong. Returns them."""
    changed = recount_work_orders(names)
    _print_work_orders("changed", changed)
    return changed


def _print_work_orders(verb, rows):
    print(f"{TAG}: {verb} {len(rows)} Work Orders")
    for m in rows:
        line = (
            f"  {m.name:<22} paid {m.stored_paid:>14,.2f} -> {m.correct_paid:>14,.2f}"
            f"  due {m.stored_due:>14,.2f} -> {m.correct_due:>14,.2f}"
        )
        if abs(m.stored_tds - m.correct_tds) >= 0.01:
            line += f"  total_tds {m.stored_tds:,.2f} -> {m.correct_tds:,.2f}"
        print(line)
