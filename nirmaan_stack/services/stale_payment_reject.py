# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The 30-day rule: an Online Project Payment nobody approved within 30 days of its request is rejected.

Wired in hooks.py `scheduler_events["cron"]` at 02:00 (`run_nightly`). The rule:

* status Requested or CEO Pending (never Approved or later, never already Rejected);
* mode of payment Online (an empty mode counts as Online: every row was filled with Online when the
  field came in); a Cheque payment, or any payment on a live Payment cheque, is never touched;
* requested more than 30 days ago. The request date is `creation` (the queue's "Requested On"), read
  as a date in the site's time zone: a payment requested on 1 Oct can still be approved through 31 Oct
  and is rejected by the run on 1 Nov;
* not on a CEO Hold project: the payment screens move nothing there, so neither does this job. Such a
  payment is rejected by the first run after the hold is lifted.

Each payment is rejected with the same save a person's reject uses (the PO term goes to Rejected, any
withheld tax is given back, and the "Rejected: ..." timeline comment is written), with `rejection_reason` set to
`REASON`. A PO payment whose term does not reach Rejected is rolled back and reported as failed. One payment per savepoint and, when scheduled, one commit per
payment: a failure is rolled back, logged to the Error Log, and retried the next night; the rest go on.

Dry run (writes nothing; prints what would be rejected):
    bench --site <site> execute nirmaan_stack.services.stale_payment_reject.reject_stale_payments \
        --kwargs "{'dry_run': True}"
"""

import frappe
from frappe import _
from frappe.utils import add_days, flt, getdate, nowdate

from nirmaan_stack.services.cheques.decide import live_cheque_of
from nirmaan_stack.services.settlement import STATUS_CEO_PENDING, STATUS_REJECTED, STATUS_REQUESTED

PAYMENT = "Project Payments"
PO = "Procurement Orders"
CEO_HOLD = "CEO Hold"
ONLINE = "Online"

#: A payment waits at most this many days after its request.
REJECT_AFTER_DAYS = 30
#: The statuses the rule rejects from.
WAITING_STATUSES = (STATUS_REQUESTED, STATUS_CEO_PENDING)
#: Written to `rejection_reason`, and as "Rejected: <REASON>" on the timeline.
REASON = "System rejected: Request is older than 30 days and was not approved."


def cutoff_for(today=None):
    """The first request date the rule leaves alone on `today`: a payment requested before it is stale."""
    return add_days(getdate(today or nowdate()), -REJECT_AFTER_DAYS)


def select_stale(today=None) -> list[dict]:
    """Every payment the rule rejects on `today`, oldest request first. Reads only."""
    return frappe.db.sql(
        """
        SELECT p.name, p.status, p.amount, p.document_type, p.document_name, p.project, p.owner, p.creation
        FROM "tabProject Payments" p
        LEFT JOIN "tabProjects" pr ON pr.name = p.project
        WHERE p.status IN %(statuses)s
          AND COALESCE(NULLIF(p.mode_of_payment, ''), %(online)s) = %(online)s
          AND p.creation < %(cutoff)s
          AND COALESCE(pr.status, '') != %(hold)s
        ORDER BY p.creation ASC, p.name ASC
        """,
        {
            "statuses": WAITING_STATUSES,
            "online": ONLINE,
            "cutoff": str(cutoff_for(today)),
            "hold": CEO_HOLD,
        },
        as_dict=True,
    )


def reject_stale_payments(*, dry_run: bool = False, today=None, commit: bool = True) -> dict:
    """Reject every payment `select_stale` names. `dry_run` writes nothing and lists them instead.

    `commit` (the scheduled run) commits after each payment, so one failure never undoes another.
    Returns a summary: `selected`, `amount`, and the `rejected`, `skipped` and `failed` payment lists.
    """
    today = getdate(today or nowdate())
    cutoff = cutoff_for(today)
    rows = select_stale(today)
    summary = {
        "today": str(today),
        "cutoff": str(cutoff),
        "dry_run": bool(dry_run),
        "selected": len(rows),
        "amount": sum(flt(r.amount) for r in rows),
        "rejected": [],
        "skipped": [],
        "failed": [],
    }
    if dry_run:
        summary["rows"] = [
            {
                "name": r.name, "status": r.status, "amount": flt(r.amount), "document_type": r.document_type,
                "document_name": r.document_name, "project": r.project, "owner": r.owner,
                "requested_on": str(getdate(r.creation)),
            }
            for r in rows
        ]
        return summary

    for row in rows:
        savepoint = f"stale_reject_{frappe.generate_hash(length=10)}"
        frappe.db.savepoint(savepoint)
        try:
            skipped_because = _reject_one(row, cutoff)
        except Exception as exc:
            frappe.db.rollback(save_point=savepoint)
            summary["failed"].append({"name": row.name, "reason": str(exc) or exc.__class__.__name__})
            frappe.log_error(title=f"Stale payment reject failed ({row.name})", message=frappe.get_traceback())
            if commit:
                frappe.db.commit()
            continue
        frappe.db.release_savepoint(savepoint)
        if skipped_because:
            summary["skipped"].append({"name": row.name, "reason": skipped_because})
        else:
            summary["rejected"].append(row.name)
        if commit:
            frappe.db.commit()
    return summary


def _reject_one(row, cutoff) -> str | None:
    """Reject one selected payment under its row locks. Returns why it was skipped, or None once rejected.

    The PO row is locked before the payment, in the order bulk approve locks them, so the two never
    deadlock. The payment is re-read under its lock: an approval that landed after the selection wins.
    """
    if row.document_type == PO and row.document_name:
        frappe.db.sql('SELECT name FROM "tabProcurement Orders" WHERE name = %s FOR UPDATE', row.document_name)
    frappe.db.sql('SELECT name FROM "tabProject Payments" WHERE name = %s FOR UPDATE', row.name)
    pay = frappe.get_doc(PAYMENT, row.name)

    if pay.status not in WAITING_STATUSES:
        return f"Status is now {pay.status}"
    if (pay.mode_of_payment or ONLINE) != ONLINE:
        return f"Mode of payment is now {pay.mode_of_payment}"
    if getdate(pay.creation) >= getdate(cutoff):
        return "Requested within the last 30 days"
    if live_cheque_of(pay.name):
        return "On a live Payment cheque"
    if pay.project and frappe.db.get_value("Projects", pay.project, "status") == CEO_HOLD:
        return "Project is on CEO Hold"

    pay.status = STATUS_REJECTED
    pay.rejection_reason = REASON
    # The save runs every reject hook a person's reject runs, the "Rejected: <reason>" timeline comment included
    # (`integrations/controllers/project_payments._add_rejection_comment`).
    pay.save(ignore_permissions=True)
    _refuse_unless_term_rejected(pay)
    return None


def _refuse_unless_term_rejected(pay) -> None:
    """A PO payment's term must follow it to Rejected. The save's term sync
    (`integrations/controllers/project_payments._find_and_update_po_term`) only LOGS a PO save that fails, so
    without this check a payment could be Rejected while its term still waits. Raising rolls the payment back to
    its savepoint, the run reports it under `failed`, and the next night tries again."""
    if pay.document_type != PO or not pay.document_name:
        return
    terms = frappe.get_all(
        "PO Payment Terms",
        filters={"parent": pay.document_name, "parenttype": PO, "project_payment": pay.name},
        pluck="term_status",
    )
    stuck = [status for status in terms if status != STATUS_REJECTED]
    if stuck:
        frappe.throw(
            _("Its PO payment term stayed {0} instead of moving to Rejected, so the payment was left as it was.").format(stuck[0])
        )


def run_nightly() -> dict:
    """The 02:00 job."""
    from nirmaan_stack.tasks.janitor_log import janitor_log

    summary = reject_stale_payments()
    janitor_log(
        f"[stale-payment-reject] cutoff {summary['cutoff']} · selected {summary['selected']} "
        f"(Rs {summary['amount']:,.0f}) · rejected {len(summary['rejected'])} · "
        f"skipped {len(summary['skipped'])} · failed {len(summary['failed'])}"
    )
    return summary
