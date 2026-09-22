"""
Split one Project Payment into a kept half and a carried-forward remainder.

TWO CALLERS, ONE CONCEPT (generalised at slice PS-1)
----------------------------------------------------
  * ``api.payments.project_payments.ceo_approve_payment`` — PARTIAL CEO APPROVAL.
    ``CEO Pending`` in; the kept half is Approved and the balance stays CEO Pending.
  * ``api.outflow_import.expenses.settle_row_partial`` — PARTIAL SETTLEMENT from a
    bank statement. ``Approved`` in; BOTH halves come out Approved, because the
    money was already sanctioned and the import approves nothing.

AND ONE INVERSE (#1279): ``unsplit_payment`` joins a balance back into the payment it
was split from. The outflow import's Unreconcile of a part payment calls it.

⚠️ THE SECOND CALLER MUST NOT FORK THIS MODULE, AND THAT IS AN ADR-0010 B1 RULE
rather than a preference. "Split a payment, preserve the sum exactly, re-write the
PO's terms" is ONE concept, so it gets ONE owning module. Two copies would put two
implementations of the sum invariant and the term surgery on either side of the
app, free to drift — and the drift would surface as a PO whose terms stopped adding
up, months later, with no way to tell which copy wrote it.

⚠️ EVERY PARAMETER BELOW DEFAULTS TO THE CEO BEHAVIOUR, so the 26 tests in
``test_payment_split`` are the proof that generalising it changed nothing. If you
add a parameter, give it a default that reproduces today and let those tests say so.

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

# Read by `load_part_reconciled_split_families`, from the modules that own them -- the same slips
# and statuses every settle path writes, never retyped here.
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.ledgers import PAYMENT_DOCTYPE, RECONCILIATION_PENDING

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

    The ORIGINAL entry point, kept as a thin wrapper over ``split_payment`` so every
    existing caller and every existing test is untouched by the PS-1 generalisation.
    Its defaults ARE the CEO behaviour — see the module docstring.
    """
    return split_payment(payment_name, approved_amount)


def split_payment(
    payment_name: str,
    keep_amount: float,
    *,
    expect_status: str = SOURCE_STATUS,
    keep_status: str = APPROVED_STATUS,
    remainder_status: str = SOURCE_STATUS,
    stamp_ceo_approval: bool = True,
) -> dict:
    """Keep ``keep_amount`` on this payment; carry the balance forward as a new one.

    ``expect_status``
        The status the payment must be in NOW, or the split is refused. ``CEO Pending``
        for a partial approval; ``Approved`` for a partial settlement.
    ``keep_status``
        What the kept half is left at. It also drives the kept PO TERM's status, for the same
        1:1-mirror reason as ``remainder_status`` below. ``Approved`` by default, which is what
        both callers wanted until #1283: the CEO is approving it now, and a settlement's half was
        approved before the bank moved.

        ⚠️ IT WAS HARD-CODED, AND THE DOCSTRING CALLED THAT DELIBERATE, UNTIL #1284. The payment
        lifecycle gained ``Reconciliation Pending`` after ``Approved`` (#1282), and a split there
        that forced the kept half back to ``Approved`` moved a payment BACKWARDS -- and on a Work
        Order payment, any save into ``Approved`` withholds tax again. Keep the default: the CEO
        path and every existing test depend on it.
    ``remainder_status``
        What the balance half is created at. It also drives the balance PO TERM's
        status, because the controller mirrors payment status to term status 1:1 —
        one parameter for both is what stops the two drifting apart here.
    ``stamp_ceo_approval``
        Whether to write ``ceo_approval_date`` on the kept half. TRUE for a CEO
        approval, because that IS the approval. ⚠️ FALSE for a partial settlement:
        the CEO's date, if there is one, already sits on the record, and stamping
        today's date would rewrite an approval fact to record a payment event.

    Returns a dict describing what moved. Raises (rolling the savepoint back) on any
    guard failure or write error — callers get all of it or none of it.
    """
    approved = flt(keep_amount)

    # ── Lock the payment row before reading it ──────────────────────────────
    frappe.db.sql(
        'SELECT name FROM "tabProject Payments" WHERE name = %s FOR UPDATE',
        payment_name,
    )
    pay = frappe.get_doc("Project Payments", payment_name)

    original = flt(pay.amount)

    # ── Guards (all before any write) ───────────────────────────────────────
    # ⚠️ THE MESSAGE NAMES BOTH STATUSES rather than saying "awaiting CEO approval".
    # With two callers expecting two different statuses, the old sentence would be a
    # confident lie on half the paths. Nothing asserts this text — the CEO endpoint
    # carries its own pre-check with its own wording, and this is the backstop.
    if pay.status != expect_status:
        frappe.throw(
            _("This payment is '{0}', not '{1}', so it cannot be split.").format(
                pay.status, expect_status
            )
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

    # ⚠️ THESE TWO SENTENCES DROPPED THE WORD "Approved" AT PS-1. A partial settlement
    # keeps an amount without approving anything, so "approved amount" was wrong on
    # that path. Both are backstops — each caller validates before it gets here — and
    # neither is asserted by any test.
    if approved < MIN_SPLIT_AMOUNT:
        frappe.throw(
            _("The amount kept must be at least {0}. To keep nothing, do not split at all.").format(
                frappe.format_value(MIN_SPLIT_AMOUNT, "Currency")
            )
        )

    if approved > original:
        frappe.throw(
            _("The amount kept cannot exceed the payment's {0}.").format(
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
        # ⚠️ `split_child` IS LOAD-BEARING ON BOTH PATHS, and the reason is sharper on
        # the settlement one. `after_insert` has an `if doc.status == "Approved"`
        # branch that fans out accountant + admin notifications and calls
        # `frappe.db.commit()` PER RECIPIENT. A partial settlement inserts this
        # remainder AS Approved, from inside the outflow import's per-row savepoint —
        # so without this flag a commit lands mid-savepoint and "Confirm 8" can leave
        # four rows written and four not, with nothing recording which.
        remainder_doc = frappe.new_doc("Project Payments")
        remainder_doc.update({
            "document_type": pay.document_type,
            "document_name": pay.document_name,
            "project": pay.project,
            "vendor": pay.vendor,
            "amount": remainder,
            "status": remainder_status,
            "split_from": pay.name,
            "approval_date": pay.approval_date,
        })
        remainder_doc.flags.split_child = True
        remainder_doc.insert(ignore_permissions=True)

        # ── 2. The original, trimmed ────────────────────────────────────────
        pay.amount = approved
        pay.status = keep_status
        if stamp_ceo_approval:
            pay.ceo_approval_date = nowdate()
        # ⚠️ SET ON BOTH PATHS, including the one where it is currently redundant. On a
        # partial settlement the status does not change (Approved -> Approved), so
        # `on_update` early-returns and `_find_and_update_po_term` never runs anyway.
        # Relying on an early return in another function to keep this PO lock safe is
        # agreement by coincidence — it survives exactly until someone makes that
        # function fire on an amount change.
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
                kept_term_status=keep_status,
                remainder_term_status=remainder_status,
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


def _split_po_term(
    po_doc,
    original_payment,
    remainder_payment,
    approved,
    remainder,
    kept_term_status: str = APPROVED_STATUS,
    remainder_term_status: str = SOURCE_STATUS,
) -> bool:
    """Shrink the original term and append a balance term. In memory — caller saves.

    Returns True when a matching term was found and both edits were applied.

    The two amounts sum to what the single term held before, so the PO's
    "terms must add up to the PO total" check is untouched by construction.

    ⚠️ ``kept_term_status`` MIRRORS THE KEPT PAYMENT'S STATUS and ``remainder_term_status``
    THE BALANCE PAYMENT'S. ``split_payment`` passes the SAME variable to a payment and to
    its term on purpose — the controller's own contract is that a PO term's status tracks
    its payment's 1:1, so letting a term's status be set apart from its payment's would
    be a way to break that invariant from inside the function that exists to preserve it.
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
    term.term_status = kept_term_status

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
        "term_status": remainder_term_status,
        "project_payment": remainder_payment,
    })
    return True


def unsplit_payment(
    original_name: str,
    leftover_name: str,
    *,
    expect_leftover_status: str | tuple[str, ...] = APPROVED_STATUS,
) -> dict:
    """The inverse of ``split_payment``: join ``leftover_name`` back into ``original_name`` (#1279).

    Deletes the leftover, sets the original's amount to kept + leftover, and folds a PO's balance term
    back into the original's. The original's STATUS is the caller's (the outflow import reverts it next).
    One implementation of the sum invariant in each direction, side by side (ADR-0010 B1).

    ``expect_leftover_status``: ``Approved`` (a partial settlement's balance) by default. It accepts a
    TUPLE as well as one status, because a settlement's balance has been created at two different
    statuses over this feature's life -- see the caller in ``api/outflow_import/unreconcile_split.py``.
    Both are refused the same way; the message lists whichever were allowed.

    ⚠️ WHETHER THE LEFTOVER IS SAFE TO DELETE IS THE CALLER'S QUESTION
    (``services/outflow_import/unsplit.py``). This refuses only what breaks the inverse: a leftover not
    this payment's, at another status, or split again, or a balance term with no term to fold into.

    The split's transaction shape: both payments and the PO ``FOR UPDATE``, one savepoint, one PO save.
    Nothing commits; the caller holds shut any trash hook that would (``_outflow_import_write``).
    """
    frappe.db.sql(
        'SELECT name FROM "tabProject Payments" WHERE name IN %s ORDER BY name FOR UPDATE',
        ((original_name, leftover_name),),
    )
    pay = frappe.get_doc("Project Payments", original_name)
    leftover = frappe.get_doc("Project Payments", leftover_name)

    if (leftover.split_from or "") != pay.name:
        frappe.throw(
            _("{0} is not the balance carried forward from {1}, so it cannot be joined back.").format(
                leftover.name, pay.name
            )
        )
    allowed = (
        (expect_leftover_status,)
        if isinstance(expect_leftover_status, str)
        else tuple(expect_leftover_status)
    )
    if leftover.status not in allowed:
        frappe.throw(
            _("The balance {0} is '{1}', not '{2}', so the split cannot be undone.").format(
                leftover.name, leftover.status, " or ".join(allowed)
            )
        )
    if frappe.db.exists("Project Payments", {"split_from": leftover.name}):
        frappe.throw(
            _("The balance {0} was split again. Undo that split first.").format(leftover.name)
        )

    kept = flt(pay.amount)
    carried = flt(leftover.amount)
    # NOT re-rounded, mirroring the split's plain subtraction.
    restored = kept + carried

    po_doc = None
    if pay.document_type == "Procurement Orders":
        frappe.db.sql(
            'SELECT name FROM "tabProcurement Orders" WHERE name = %s FOR UPDATE',
            pay.document_name,
        )
        po_doc = frappe.get_doc("Procurement Orders", pay.document_name)

    savepoint = f"pay_unsplit_{frappe.generate_hash(length=12)}"
    frappe.db.savepoint(savepoint)
    try:
        # ── 1. The PO terms first: the balance term's Link names the leftover ──
        terms_merged = None
        if po_doc is not None:
            terms_merged = _merge_po_terms(po_doc, pay.name, leftover.name)
            if terms_merged:
                po_doc.save(ignore_permissions=True)

        # ── 2. The original, restored ───────────────────────────────────────
        pay.amount = restored
        # ⚠️ The same PO-lock reason `split_payment` sets it for: the controller must not re-load
        # and re-save the PO this function holds.
        pay.flags.split_approval = True
        pay.save(ignore_permissions=True)

        # ── 3. The leftover, gone ───────────────────────────────────────────
        _delete_leftover(leftover.name)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise

    frappe.db.release_savepoint(savepoint)

    return {
        "original_payment": pay.name,
        "leftover_payment": leftover.name,
        "kept_amount": kept,
        "leftover_amount": carried,
        "restored_amount": restored,
        "po_name": po_doc.name if po_doc is not None else None,
        "terms_merged": terms_merged,
    }


def _merge_po_terms(po_doc, original_payment, leftover_payment) -> bool:
    """Fold the leftover's term back into the original's. In memory -- caller saves. False when there
    is no balance term (the split's orphan case). ⚠️ AMOUNTS ARE ADDED, never re-derived from the
    payment, so the terms still sum to the PO total; the label is the original's (no " (Balance)")."""
    terms = po_doc.get("payment_terms") or []
    kept = next((t for t in terms if t.project_payment == original_payment), None)
    balance = next((t for t in terms if t.project_payment == leftover_payment), None)
    if balance is None:
        return False
    if kept is None:
        frappe.throw(
            _("PO {0} has a term for the balance {1} but none for {2}, so the terms cannot be "
              "joined back.").format(po_doc.name, leftover_payment, original_payment)
        )

    kept.amount = flt(kept.amount) + flt(balance.amount)
    kept.percentage = _percentage(kept.amount, flt(po_doc.total_amount) or 1)
    po_doc.remove(balance)
    for idx, term in enumerate(po_doc.get("payment_terms") or [], start=1):
        term.idx = idx
    return True


def _delete_leftover(name: str) -> None:
    """Delete the balance payment. Its own function so a test can fail it mid-way.

    ⚠️ `force=True` SKIPS THE LINK CHECK, AND THAT IS NEEDED: a Reversed outflow match record (a transfer
    that paid this balance and was unreconciled) keeps a Dynamic Link to it forever. The trash hooks
    still run -- the term was folded away first, so the controller's term sync finds nothing to touch.
    """
    frappe.delete_doc("Project Payments", name, force=True, ignore_permissions=True)


def _percentage(amount: float, po_total: float) -> str:
    """Mirror the PO card's formula exactly: (amount / po_total) * 100, unrounded.

    The field is Data and live rows hold raw floats ("99.99998495582105"), so
    rounding here would make split rows visibly unlike every other row.
    """
    return str(flt(amount) / flt(po_total) * 100)


# --- how much of a split request the bank has reconciled -----------------------------------------


def load_part_reconciled_split_families(payment_names) -> list[dict]:
    """The split payment families the given payments belong to that a bank line has reached but
    not finished. Empty in, empty out.

    A family is every payment reachable through `split_from` from one root: a bank part-payment
    (`settle_row_partial`, whose balance waits at Reconciliation Pending for its own line), a CEO
    part-approval, and any re-split of either. It is PART-RECONCILED when a member carries a live
    bank-line slip AND a member is still `Reconciliation Pending`.

    One dict per such family:
      * `members` -- every payment in it, sorted;
      * `line_count` / `reconciled` -- its members' live slips, counted and totalled;
      * `pending` -- its Reconciliation Pending members' amounts.

    ⚠️ BUILT FROM THE SPLIT LINKS, NOT A RECURSIVE QUERY. `split_from` carries no index, so walking
    it in SQL scans every payment at every step (~35ms a queue page). Instead the handful of split
    links are read in ONE filtered scan and the families put together here; a page none of whose
    payments is in a family -- nearly every page -- stops there. Only when one is do two lookups by
    NAME (the primary key) read the members' statuses and their slips.

    ⚠️ A ROOT IS A PAYMENT WHOSE `split_from` NAMES NOTHING THAT EXISTS, not merely a blank one, so a
    family whose first payment was deleted is still found from what is left.
    """
    names = {n for n in (payment_names or ()) if n}
    if not names:
        return []

    parent_of = {
        child: parent
        for child, parent in frappe.db.sql(
            f"""SELECT name, split_from FROM "tab{PAYMENT_DOCTYPE}"
                WHERE COALESCE(split_from, '') <> ''"""
        )
    }
    if not parent_of:
        return []
    existing = set(
        frappe.db.sql_list(
            f'SELECT name FROM "tab{PAYMENT_DOCTYPE}" WHERE name IN %s',
            (tuple(set(parent_of.values())),),
        )
    )

    def root_of(name):
        seen = set()
        while parent_of.get(name) in existing and name not in seen:
            seen.add(name)
            name = parent_of[name]
        return name

    families: dict[str, set] = {}
    for child in parent_of:
        root = root_of(child)
        families.setdefault(root, {root}).add(child)
    wanted = [members for members in families.values() if members & names]
    if not wanted:
        return []

    everyone = tuple(set().union(*wanted))
    status_amount = {
        r["name"]: r
        for r in frappe.db.sql(
            f'SELECT name, status, amount FROM "tab{PAYMENT_DOCTYPE}" WHERE name IN %s',
            (everyone,),
            as_dict=True,
        )
    }
    slips = {
        r["target_name"]: r
        for r in frappe.db.sql(
            """
            SELECT target_name, COUNT(name) AS line_count, SUM(target_amount) AS reconciled
            FROM "tabOutflow Row Match"
            WHERE target_doctype = %s AND match_kind = %s AND target_name IN %s
            GROUP BY target_name
            """,
            (PAYMENT_DOCTYPE, MATCH_SETTLED, everyone),
            as_dict=True,
        )
    }

    result = []
    for members in wanted:
        line_count = sum(int(slips[m]["line_count"] or 0) for m in members if m in slips)
        waiting = [
            m for m in members
            if (status_amount.get(m) or {}).get("status") == RECONCILIATION_PENDING
        ]
        if not line_count or not waiting:
            continue
        result.append({
            "members": sorted(members),
            "line_count": line_count,
            "reconciled": flt(sum(flt(slips[m]["reconciled"]) for m in members if m in slips)),
            "pending": flt(sum(flt(status_amount[m]["amount"]) for m in waiting)),
        })
    return result


def part_reconciled_split_family_of(payment_name: str) -> dict | None:
    """The part-reconciled split family `payment_name` belongs to, or `None` -- the same read the
    queue's Amount cell uses, so the Bank lines card and the cell describe one payment alike."""
    families = load_part_reconciled_split_families([payment_name])
    return families[0] if families else None
