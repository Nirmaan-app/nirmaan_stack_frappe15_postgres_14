"""
Partial CEO approval — split one Project Payment into an approved half and a
still-pending remainder.

WHY THIS EXISTS
---------------
The CEO must be able to approve *less* than what was requested without losing
the balance. Editing the amount in place would silently destroy the difference:
the vendor is still owed it, but nothing on the PO would say so any more. So the
approval SPLITS instead — the typed figure is approved, and the leftover becomes
a fresh payment sitting at the SAME stage it was already at, plus its own PO
payment-term row so the PO still reads as a complete allocation.

THE SUM INVARIANT IS THE WHOLE POINT
------------------------------------
approved + remainder == the original amount, EXACTLY. Nothing is re-rounded on
the way through — ``remainder`` is a plain subtraction, never an independently
rounded figure — because the PO card warns when its terms stop adding up to the
PO total, and ``services.finance.get_total_pending`` derives the "how much may
still be requested" ceiling from these same rows. A split that loses a rupee
would quietly widen that ceiling.

TRANSACTION SHAPE
-----------------
Copied deliberately from ``api.payments.bulk_actions._process_group``, which is
the one place in this app that already gets concurrent payment writes right:

  * ``SELECT ... FOR UPDATE`` on the payment row AND on the parent PO row, so a
    bulk run or another single-row approver serialises behind us instead of
    racing us into a last-write-wins divergence between the payment status and
    the PO term status.
  * ONE savepoint around the whole thing — three documents move together
    (original payment, new payment, PO child rows) and a late failure must not
    leave an orphan remainder payment behind.
  * ONE ``po_doc.save()`` covering both term mutations.

⚠️ THE HOOK-SUPPRESSION FLAGS ARE LOAD-BEARING, NOT AN OPTIMISATION.
``pay.flags.split_approval`` and ``remainder.flags.split_child`` are read by
``integrations/controllers/project_payments.py``. Without them:
  * ``_find_and_update_po_term`` would re-load the PO and save it a second time,
    on top of the copy we already hold locked — a TimestampMismatchError, or
    worse, a silent overwrite of the term rows we just wrote.
  * ``on_update``'s accountant notification and ``after_insert``'s admin fan-out
    both call ``frappe.db.commit()`` mid-flight, which ends our savepoint's
    isolation. That is the same reason ``from_adjustment`` and ``bulk_approval``
    exist. The accountant notification is not dropped — the CALLER emits it
    after the commit.

This module performs DB work but never reads request context: the CEO
permission gate lives in the endpoint, and so does the commit + the notify
(``lock -> load -> call -> persist -> commit -> publish``, ADR-0010 B4).
"""

import frappe
from frappe import _
from frappe.utils import flt, nowdate

# A split must leave something meaningful on BOTH sides. Below this the action
# is not a partial approval — it is a full approval or a rejection, and both of
# those already have their own button.
MIN_SPLIT_AMOUNT = 1.0

SOURCE_STATUS = "CEO Pending"
APPROVED_STATUS = "Approved"

# Appended to the balance term's label. Checked before appending so a
# re-split does not produce "Advance (Balance) (Balance)".
BALANCE_LABEL_SUFFIX = " (Balance)"


def split_and_approve(payment_name: str, approved_amount: float) -> dict:
    """Approve ``approved_amount`` of a CEO Pending payment; carry the rest forward.

    Returns a dict describing what moved. Raises (rolling the savepoint back)
    on any guard failure or write error — callers get all of it or none of it.
    """
    approved = flt(approved_amount)

    # ── Lock the payment row before reading it ──────────────────────────────
    frappe.db.sql(
        'SELECT name FROM "tabProject Payments" WHERE name = %s FOR UPDATE',
        payment_name,
    )
    pay = frappe.get_doc("Project Payments", payment_name)

    original = flt(pay.amount)

    # ── Guards (all before any write) ───────────────────────────────────────
    if pay.status != SOURCE_STATUS:
        frappe.throw(
            _("Payment is not awaiting CEO approval (current status: {0})").format(pay.status)
        )

    # ⚠️ THIS GUARD IS ALSO WHAT KEEPS THE SAVEPOINT ISOLATED — do not demote it
    # to "the frontend already checks this". Saving the payment and the PO both
    # fire `project_cashflow_hold_update.trigger_check`, whose
    # `_notify_manual_hold_releasable` branch inserts a notification and CALLS
    # `frappe.db.commit()`. That branch is reachable ONLY when the project is on
    # CEO Hold with a human holder — which this throw makes unreachable. A commit
    # there would turn the rollback below into a silent no-op and leave a
    # half-written split with nothing recording which half.
    if pay.project:
        project_status = frappe.db.get_value("Projects", pay.project, "status")
        if project_status == "CEO Hold":
            frappe.throw(_("This project is on CEO Hold. Payments cannot be approved."))

    # ⚠️ REFUNDS ARE NOT SPLITTABLE, AND THEY ARE COMMON.
    # A NEGATIVE payment is a credit raised after a negative-rate amendment.
    # `create_payment_request_for_service` allows `amount < 0` on purpose, and the
    # sub-threshold auto-approval deliberately excludes it (`0 < amount < ...`), so
    # every refund travels this exact CEO queue — 127 exist on the live database.
    # Splitting one is meaningless, and the guards below would refuse it with a
    # message about "exceeding" an amount that is negative. Say the real thing
    # instead. The frontend already declines to offer the box (`isSplittable`);
    # this covers a direct API call.
    if original < 2 * MIN_SPLIT_AMOUNT:
        frappe.throw(
            _("A payment of {0} cannot be split. Approve or reject it in full.").format(
                frappe.format_value(original, "Currency")
            )
        )

    if approved < MIN_SPLIT_AMOUNT:
        frappe.throw(
            _("Approved amount must be at least {0}. To approve nothing, reject the payment instead.").format(
                frappe.format_value(MIN_SPLIT_AMOUNT, "Currency")
            )
        )

    if approved > original:
        frappe.throw(
            _("Approved amount cannot exceed the requested amount of {0}.").format(
                frappe.format_value(original, "Currency")
            )
        )

    # NOT re-rounded — see the sum-invariant note in the module docstring.
    remainder = original - approved

    if remainder < MIN_SPLIT_AMOUNT:
        frappe.throw(
            _("The balance left over would be less than {0}. Approve the full amount instead.").format(
                frappe.format_value(MIN_SPLIT_AMOUNT, "Currency")
            )
        )

    # ── Lock the parent PO too, so the term rows move under one lock ────────
    # Service Requests carry no payment terms at all, so there is nothing to
    # lock and nothing to append — the payment still splits (owner ruling).
    po_doc = None
    if pay.document_type == "Procurement Orders":
        frappe.db.sql(
            'SELECT name FROM "tabProcurement Orders" WHERE name = %s FOR UPDATE',
            pay.document_name,
        )
        po_doc = frappe.get_doc("Procurement Orders", pay.document_name)

    savepoint = f"pay_split_{frappe.generate_hash(length=12)}"
    frappe.db.savepoint(savepoint)

    try:
        # ── 1. The remainder payment, at the SAME stage ─────────────────────
        # `approval_date` is carried over: the project lead already approved
        # this money once and that fact is not undone by the CEO trimming it.
        # `ceo_approval_date` is deliberately left blank — the CEO has not
        # approved this half. `auto_approved` stays 0 even when the remainder
        # falls under PAYMENT_AUTO_APPROVAL_THRESHOLD: that threshold is for
        # brand-new requests, and letting it fire here would allow a large
        # payment to be salami-sliced past the approval gate.
        remainder_doc = frappe.new_doc("Project Payments")
        remainder_doc.update({
            "document_type": pay.document_type,
            "document_name": pay.document_name,
            "project": pay.project,
            "vendor": pay.vendor,
            "amount": remainder,
            "status": SOURCE_STATUS,
            "split_from": pay.name,
            "approval_date": pay.approval_date,
        })
        remainder_doc.flags.split_child = True
        remainder_doc.insert(ignore_permissions=True)

        # ── 2. The original, trimmed and approved ───────────────────────────
        pay.amount = approved
        pay.status = APPROVED_STATUS
        pay.ceo_approval_date = nowdate()
        pay.flags.split_approval = True
        pay.save(ignore_permissions=True)

        # ── 3. The PO terms — both edits, one save ──────────────────────────
        term_synced = False
        if po_doc is not None:
            term_synced = _split_po_term(
                po_doc=po_doc,
                original_payment=pay.name,
                remainder_payment=remainder_doc.name,
                approved=approved,
                remainder=remainder,
            )
            if term_synced:
                po_doc.save(ignore_permissions=True)
            else:
                # Not fatal: the payments are correct and are the financial
                # record. The PO term simply has nothing to point at, which is
                # already possible for legacy payments created before terms
                # existed. Log loudly rather than refusing the approval.
                frappe.log_error(
                    title=f"Payment Split Orphan Term ({pay.name})",
                    message=(
                        f"Payment {pay.name} was split (approved {approved}, "
                        f"remainder {remainder} as {remainder_doc.name}) but no "
                        f"payment_terms row on PO {pay.document_name} links to it. "
                        f"The PO term allocation will not reflect the split."
                    ),
                )
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise

    frappe.db.release_savepoint(savepoint)

    return {
        "approved_payment": pay.name,
        "remainder_payment": remainder_doc.name,
        "approved_amount": approved,
        "remainder_amount": remainder,
        "original_amount": original,
        "po_name": po_doc.name if po_doc is not None else None,
        "term_synced": term_synced if po_doc is not None else None,
    }


def _split_po_term(po_doc, original_payment, remainder_payment, approved, remainder) -> bool:
    """Shrink the original term and append a balance term. In memory — caller saves.

    Returns True when a matching term was found and both edits were applied.

    The two amounts sum to what the single term held before, so the PO's
    "terms must add up to the PO total" check is untouched by construction.
    """
    term = next(
        (t for t in (po_doc.get("payment_terms") or []) if t.project_payment == original_payment),
        None,
    )
    if term is None:
        return False

    # `|| 1` mirrors the PO card's own guard against a zero PO total.
    po_total = flt(po_doc.total_amount) or 1

    label = (term.label or "Payment").strip()
    balance_label = label if label.endswith(BALANCE_LABEL_SUFFIX) else f"{label}{BALANCE_LABEL_SUFFIX}"

    term.amount = approved
    term.percentage = _percentage(approved, po_total)
    term.term_status = APPROVED_STATUS

    po_doc.append("payment_terms", {
        "label": balance_label,
        "amount": remainder,
        "percentage": _percentage(remainder, po_total),
        # Carried, not re-derived: a Credit term's due date is what makes it
        # requestable, and `create_project_payment` refuses a Credit term with
        # no due date. A blank one here would strand the balance forever.
        "payment_type": term.payment_type,
        "due_date": term.due_date,
        "vendor": term.vendor,
        "project": term.project,
        "term_status": SOURCE_STATUS,
        "project_payment": remainder_payment,
    })
    return True


def _percentage(amount: float, po_total: float) -> str:
    """Mirror the PO card's formula exactly: (amount / po_total) * 100, unrounded.

    The field is Data and live rows hold raw floats ("99.99998495582105"), so
    rounding here would make split rows visibly unlike every other row.
    """
    return str(flt(amount) / flt(po_total) * 100)
