"""Move GST payments still waiting for L1 or the CEO to Approved (ADR-0030 Amendment B, decision B2; owner 2026-11-18).

Since Amendment B, an approved GST Payment Request's payment is born Approved: the Accountant's approval is its
only one. A GST payment whose request was approved BEFORE that change was born through the amount rule and may
still sit at Requested (waiting for L1) or CEO Pending. This moves each of them to Approved, so it shows in
"Payment need to paid".

WHICH PAYMENTS: a Project Payment with `is_gst_payment = 1`, status Requested or CEO Pending, linked from a GST
Payment Request (`project_payment`) that is Approved and has a review time. Nothing else: an L1- or CEO-rejected
GST payment (someone rejected it on purpose), a settled one, a GST payment made before GST requests existed (no
request, so no Accountant ever approved it) and every base payment stay exactly as they are.

WHAT IS WRITTEN (owner, 2026-11-18): status = Approved, and BOTH `approval_date` and `ceo_approval_date` = the date
of the GST request's review (`reviewed_on`): the day the Accountant approved it, which Amendment B makes the only
approval. `modified` does NOT move (`update_modified=False`, owner). One comment on each payment says why; a
comment does not move `modified` either (Frappe writes the comment cache by SQL for that reason).

RAW WRITE, HOOKS SKIPPED ON PURPOSE (CODING_STANDARDS, raw SQL / set_value). A save would run the payment's
`validate` and `on_update`, and none of it has anything to do for this move:
- the payment-step guard: this is the system's own move, which Amendment B allows;
- the PO payment-term sync: a GST payment is a Work Order payment, and that sync only touches POs;
- the TDS deduction on approval: a GST payment never carries TDS (ADR-0030);
- Amount Paid, the cashflow re-check and the payment-date copy: they move only into or out of Paid;
- the GST request's own sync: the request is already Approved, which is what an Approved payment gives it;
- the "ready to fulfil" bell to the Accountants: deliberately not sent (owner), so old payments do not arrive as
  a burst of notifications; they simply appear in Payment need to paid.
Re-running is safe: a moved payment is Approved and no longer matches.

Dry run -- prints every payment it would move, saves nothing (run this first):
    bench --site <site> execute nirmaan_stack.patches.v3_0.gst_payments_waiting_to_approved.run --kwargs "{'dry_run': True}"
The real run happens in `bench migrate` (this module is in patches.txt).
"""

import frappe
from frappe.utils import getdate

WAITING = ("Requested", "CEO Pending")
APPROVED = "Approved"
COMMENT = ("Moved to Approved by the one-time patch for ADR-0030 Amendment B: the Accountant's approval of {request} "
           "on {day} is a GST payment's only approval. No L1 or CEO approval needed. Was: {was}.")


def execute():
    run(dry_run=False)


def find_waiting() -> list:
    """Every GST payment at Requested / CEO Pending whose GST request is Approved and reviewed, oldest first."""
    return frappe.db.sql(
        """
        select p.name as payment, p.status as was, p.amount, p.document_name as work_order, p.project,
               g.name as request, g.reviewed_on, g.reviewed_by
        from "tabProject Payments" p
        join "tabGST Payment Request" g on g.project_payment = p.name
        where p.is_gst_payment = 1
          and p.status in %(waiting)s
          and g.status = %(approved)s
          and g.reviewed_on is not null
        order by p.creation
        """,
        {"waiting": WAITING, "approved": APPROVED},
        as_dict=True,
    )


def find_left_alone() -> list:
    """GST payments still waiting that this patch does NOT move (no approved, reviewed request), for the report."""
    return frappe.db.sql(
        """
        select p.name as payment, p.status, p.amount, p.document_name as work_order, g.name as request,
               g.status as request_status
        from "tabProject Payments" p
        left join "tabGST Payment Request" g on g.project_payment = p.name
        where p.is_gst_payment = 1
          and p.status in %(waiting)s
          and not (coalesce(g.status, '') = %(approved)s and g.reviewed_on is not null)
        order by p.creation
        """,
        {"waiting": WAITING, "approved": APPROVED},
        as_dict=True,
    )


def move(row) -> None:
    """One payment to Approved, both approval dates the request's review day, `modified` untouched."""
    day = getdate(row.reviewed_on)
    # Raw write: see the module docstring for every hook this skips and why skipping it is correct.
    frappe.db.set_value(
        "Project Payments", row.payment,
        {"status": APPROVED, "approval_date": day, "ceo_approval_date": day},
        update_modified=False,
    )
    frappe.get_doc({
        "doctype": "Comment", "comment_type": "Comment",
        "reference_doctype": "Project Payments", "reference_name": row.payment,
        "content": COMMENT.format(request=row.request, day=day.strftime("%d-%b-%Y"), was=row.was),
    }).insert(ignore_permissions=True)


def run(dry_run: bool = True) -> dict:
    """Move every waiting GST payment; with dry_run, print what would move and roll everything back."""
    rows = find_waiting()
    left_alone = find_left_alone()
    for row in rows:
        move(row)

    _print_report(rows, left_alone, dry_run)
    if dry_run:
        frappe.db.rollback()
    else:
        frappe.db.commit()
    return {"moved": [r.payment for r in rows], "left_alone": [r.payment for r in left_alone]}


def _print_report(rows, left_alone, dry_run) -> None:
    head = "DRY RUN, nothing saved" if dry_run else "DONE"
    print(f"\nGST payments waiting for L1 / CEO -> Approved ({head}): {len(rows)}")
    for r in rows:
        print(f"  {r.payment}  {r.was:<12} -> Approved  Rs {r.amount:,.2f}  {r.work_order}  "
              f"request {r.request} reviewed {getdate(r.reviewed_on)} by {r.reviewed_by}")
    total = sum((r.amount or 0) for r in rows)
    print(f"  total Rs {total:,.2f}")
    print(f"\nGST payments still waiting, NOT moved (no approved, reviewed request): {len(left_alone)}")
    for r in left_alone:
        print(f"  {r.payment}  {r.status:<12} Rs {r.amount:,.2f}  {r.work_order}  "
              f"request {r.request or '-'} ({r.request_status or 'none'})")
