"""
One-off reset: every project's inventory and the warehouse go to 0.

WHY THIS EXISTS
---------------
The inventory counts project managers had entered no longer matched the sites,
so the owner ruled (2026-10-22) to start every project and the warehouse from 0
and let project managers count again.

WHAT IT DOES
------------
A project's inventory is its newest Submitted Remaining Items Report
(`report_date DESC, creation DESC`, as
`integrations/controllers/internal_transfer_memo.available_quantity` reads it).
So the reset makes a report of zeros that project's newest:

- Newest report dated before ZERO_DATE (3 days ago): add a report on ZERO_DATE
  with the newest report's rows at 0. It is dated in the past so a project
  manager can still file today's count (one report per project per day).
- Newest report dated ZERO_DATE or later: zero that report's rows in place.
- Newest report before ZERO_DATE, but another report (a Draft) already on
  ZERO_DATE: zero that one and submit it, since a second report that day is
  refused.
- Never reported, or newest report already all 0: left alone.

Every Warehouse Stock Item not at 0 is set to 0, with one "Inventory Reset"
ledger row for the amount taken off (or put back, if it was below 0).

Transfers still open are listed, never touched. An Approved transfer out of the
warehouse can still be dispatched afterwards, and that drives its stock below 0.

Report mode (the default) writes nothing. Running it again is safe: a second
run finds everything at 0 and does nothing.

USAGE
-----
    bench --site <site> execute nirmaan_stack.reset_inventory.run
    bench --site <site> execute nirmaan_stack.reset_inventory.run --kwargs "{'apply': True}"
"""

from dataclasses import dataclass, field

import frappe
from frappe.utils import add_days, flt, getdate, nowdate, today

ZERO_REPORT_AGE_DAYS = 3

# Stamped onto the ledger row's `doctype_ref`. Not a real doctype: the Ledger
# tab renders it verbatim, like `add_warehouse_stock.MANUAL_LEDGER_REF`.
RESET_LEDGER_REF = "Inventory Reset"

ADD_ZERO_REPORT = "add a zero report"
ZERO_NEWEST = "zero the newest report"
ZERO_REPORT_ON_DATE = "zero and submit the report already on that date"

_ROW_FIELDS = ("item_id", "item_name", "unit", "category", "dn_quantity", "make")


@dataclass
class ProjectStep:
    project: str
    action: str
    # ADD_ZERO_REPORT: the newest report, whose rows are copied at 0.
    # Otherwise: the report zeroed in place.
    report: str


@dataclass
class Plan:
    zero_date: str
    project_steps: list = field(default_factory=list)
    already_zero: list = field(default_factory=list)
    warehouse_items: list = field(default_factory=list)
    open_transfers: list = field(default_factory=list)


def project_action(newest_date, newest_all_zero, zero_date, report_on_zero_date):
    """What the reset does to one project, or None to leave it alone."""
    if newest_all_zero:
        return None
    if getdate(newest_date) >= getdate(zero_date):
        return ZERO_NEWEST
    if report_on_zero_date:
        return ZERO_REPORT_ON_DATE
    return ADD_ZERO_REPORT


def build_plan(zero_date=None):
    """Read everything the reset would change. Writes nothing."""
    zero_date = str(zero_date or add_days(today(), -ZERO_REPORT_AGE_DAYS))
    plan = Plan(zero_date=zero_date)

    newest_reports = frappe.db.sql(
        """
        WITH newest AS (
            SELECT DISTINCT ON (project) name, project, report_date
            FROM "tabRemaining Items Report"
            WHERE status = 'Submitted'
            ORDER BY project, report_date DESC, creation DESC
        )
        SELECT n.name, n.project, n.report_date,
               NOT EXISTS (
                   SELECT 1 FROM "tabRemaining Item Entry" rie
                   WHERE rie.parent = n.name
                     AND rie.parenttype = 'Remaining Items Report'
                     AND COALESCE(rie.remaining_quantity, 0) <> 0
               ) AS all_zero
        FROM newest n
        ORDER BY n.project
        """,
        as_dict=True,
    )
    for row in newest_reports:
        report_on_zero_date = frappe.db.get_value(
            "Remaining Items Report",
            {"project": row.project, "report_date": zero_date},
            "name",
        )
        action = project_action(row.report_date, row.all_zero, zero_date, report_on_zero_date)
        if action is None:
            plan.already_zero.append(row.project)
            continue
        report = report_on_zero_date if action == ZERO_REPORT_ON_DATE else row.name
        plan.project_steps.append(ProjectStep(row.project, action, report))

    plan.warehouse_items = frappe.get_all(
        "Warehouse Stock Item",
        filters={"quantity": ["!=", 0]},
        fields=["name", "item_id", "item_name", "make", "quantity"],
        order_by="item_name asc",
    )
    plan.open_transfers = frappe.get_all(
        "Internal Transfer Memo",
        filters={"status": ["in", ["Approved", "Dispatched", "Partially Delivered"]]},
        fields=["name", "status", "source_type", "source_project", "target_type", "target_project"],
        order_by="creation asc",
    )
    return plan


def apply_plan(plan):
    """Write the plan. Does not commit: `run` commits once, after every write."""
    for step in plan.project_steps:
        if step.action == ADD_ZERO_REPORT:
            _add_zero_report(step.project, step.report, plan.zero_date)
        else:
            _zero_in_place(step.report)
    for item in plan.warehouse_items:
        _zero_warehouse_item(item.name)


def run(apply=False):
    """Print what the reset does; with `apply`, do it in one transaction."""
    plan = build_plan()
    _print_plan(plan)
    if not apply:
        print("\nReport only: nothing written. Pass apply=True to write.")
        return _counts(plan)
    try:
        apply_plan(plan)
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        raise
    print("\nApplied and committed.")
    return _counts(plan)


def _add_zero_report(project, source_report, zero_date):
    rows = frappe.db.sql(
        f"""
        SELECT {", ".join(_ROW_FIELDS)}
        FROM "tabRemaining Item Entry"
        WHERE parent = %s AND parenttype = 'Remaining Items Report'
        ORDER BY idx
        """,
        source_report,
        as_dict=True,
    )
    doc = frappe.new_doc("Remaining Items Report")
    doc.project = project
    doc.report_date = zero_date
    doc.submitted_by = frappe.session.user
    doc.status = "Submitted"
    for row in rows:
        doc.append("items", {**row, "remaining_quantity": 0})
    doc.insert(ignore_permissions=True)


def _zero_in_place(report):
    # Raw writes on purpose: a save runs RemainingItemsReport.validate, whose
    # same-day edit window refuses any report not dated today, and these are
    # the reports it must zero. Nothing else is skipped: the doctype has no
    # doc_events, 0 passes the non-negative rule, and its `make` stamp is
    # moot on a row at 0. `modified` moves to now because transfer
    # availability deducts only dispatches made after it, and the zero is as
    # of now.
    frappe.db.sql(
        """
        UPDATE "tabRemaining Item Entry" SET remaining_quantity = 0
        WHERE parent = %s AND parenttype = 'Remaining Items Report'
        """,
        report,
    )
    frappe.db.set_value(
        "Remaining Items Report",
        report,
        {"status": "Submitted", "submitted_by": frappe.session.user},
        update_modified=True,
    )


def _zero_warehouse_item(name):
    wsi = frappe.get_doc("Warehouse Stock Item", name)
    qty = flt(wsi.quantity)
    if qty == 0:
        return
    wsi.append("ledger", {
        "doctype_ref": RESET_LEDGER_REF,
        "docname_ref": frappe.session.user,
        "source_project": "Warehouse" if qty > 0 else "",
        "target_project": "" if qty > 0 else "Warehouse",
        "impact": "Decrease" if qty > 0 else "Increase",
        "quantity": abs(qty),
        "date": nowdate(),
    })
    wsi.quantity = 0
    wsi.save(ignore_permissions=True)


def _counts(plan):
    return {
        "zero_date": plan.zero_date,
        "projects_reset": len(plan.project_steps),
        "projects_already_zero": len(plan.already_zero),
        "warehouse_items_reset": len(plan.warehouse_items),
        "open_transfers": len(plan.open_transfers),
    }


def _print_plan(plan):
    print(f"Zero reports are dated {plan.zero_date}.\n")

    print(f"Projects to reset: {len(plan.project_steps)}")
    for step in plan.project_steps:
        print(f"  {step.project}: {step.action} ({step.report})")
    print(f"Projects already at 0, left alone: {len(plan.already_zero)}")

    print(f"\nWarehouse items to set to 0: {len(plan.warehouse_items)}")
    for item in plan.warehouse_items:
        make = f" [{item.make}]" if item.make else ""
        print(f"  {item.item_name}{make}: {flt(item.quantity):g} -> 0")

    print(f"\nOpen transfers, NOT touched: {len(plan.open_transfers)}")
    for itm in plan.open_transfers:
        source = itm.source_project or itm.source_type
        target = itm.target_project or itm.target_type
        print(f"  {itm.name} ({itm.status}): {source} -> {target}")
    if any(i.status == "Approved" and i.source_type == "Warehouse" for i in plan.open_transfers):
        print("  An Approved transfer out of the warehouse, dispatched after the reset,"
              " takes its items below 0.")
