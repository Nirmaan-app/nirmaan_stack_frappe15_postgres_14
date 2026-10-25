# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Make the BoQs of projects Won before `Selected` existed Selected (ADR-0037 follow-up, owner 2026-10-21).

WHY THIS PATCH EXISTS
    Since ADR-0037 a Won project's BoQs tab shows Selected BoQs in its main table and every other
    BoQ under "Other BoQs", where only an Admin can edit. Projects Won before that have only Draft
    BoQs, because nobody could choose then, so all of them would land under Other BoQs and the team
    would lose edit access overnight.

WHAT IT CHANGES
    On every Won project (`tendering_status = Won`) that has NO Selected BoQ, every Draft BoQ becomes
    Selected -- every version of it. A Won project that already has a Selected BoQ is skipped whole:
    its Draft BoQs were left Draft on purpose (unticked at Convert, or unticked in a merge). Approved
    and Superseded are never touched.

    The whole rule lives in this file (owner: a one-time job keeps no code in the controllers). It
    is the one place outside `integrations/controllers/boqs.py` that writes `BOQs.status`.

IDEMPOTENT
    A second run finds nothing: every project it touched now has a Selected BoQ.

RAW UPDATE, NOT `doc.save` -- AND WHY SKIPPING THE HOOKS IS CORRECT HERE
    `set_value(..., update_modified=False)` (owner: "update modification false"): only `status`
    changes, `modified` is left alone and no Version row is written. The BOQs hooks have nothing to
    do: `validate` only guards Superseded and Approved -> Draft, and `on_update` is a no-op.

DRY RUN FIRST (writes nothing, lists every BoQ it would change)
    bench --site <site> execute nirmaan_stack.patches.v3_0.select_boqs_on_legacy_won_projects.plan

The `patches.txt` wiring sits under [post_model_sync], after the doctype sync that adds the `Selected`
option.
"""

import frappe


def boqs_to_select():
    """Draft BoQs on Won projects that have no Selected BoQ at all. Read only."""
    return frappe.db.sql(
        """
        SELECT b.name, b.project, b.boq_name, b.version
        FROM "tabBOQs" b
        JOIN "tabProjects" p ON p.name = b.project
        WHERE p.tendering_status = 'Won'
          AND b.status = 'Draft'
          AND NOT EXISTS (
              SELECT 1 FROM "tabBOQs" s WHERE s.project = b.project AND s.status = 'Selected'
          )
        ORDER BY b.project, b.name
        """,
        as_dict=True,
    )


def mark_selected(boq_names):
    """Draft -> Selected, leaving `modified` alone and writing no Version row (see above)."""
    for name in boq_names:
        frappe.db.set_value("BOQs", name, "status", "Selected", update_modified=False)


def plan():
    """The dry run: what `execute` would change. Writes nothing."""
    rows = boqs_to_select()
    return {
        "count": len(rows),
        "projects": len({row.project for row in rows}),
        "boqs": [f"{row.project} · {row.name} · {row.boq_name} v{row.version}" for row in rows],
    }


def execute():
    rows = boqs_to_select()
    mark_selected([row.name for row in rows])
    frappe.log(
        f"select_boqs_on_legacy_won_projects: {len(rows)} BoQ(s) on "
        f"{len({row.project for row in rows})} Won project(s) set to Selected"
    )
