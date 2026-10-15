# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Vendor Refunds -- what a refund may be recorded against, in one home.

A `Vendor Refund` names a vendor, a project, and what the amount was refunded against: ONE PO or Work
Order of that vendor on that project, or a MISC. EXPENSE -- no document at all (owner, 2026-09-17). A
bank credit split across three POs and the rest as misc becomes four records. Two rules:

  * `refund_document_problem` -- ONE record. Against a PO / WO: the document is that vendor's, on the
    chosen project when one is chosen, not a Merged PO, has been PAID something, and the amount is more than 0 and no more than
    is still refundable on it (paid, less what earlier Received and waiting refunds hold). A Misc. Expense names no
    document and has no cap -- only an amount more than 0. Asked by `Vendor Refunds.validate` on every
    save, and by the rule below for each part.
  * `refund_allocation_problem` -- ONE bank credit: a vendor, at least one part, no
    document twice and at most one Misc. Expense, every part passing the rule above, and the parts
    adding up EXACTLY (to the paisa) to the credit. Asked by
    `services/outflow_import/settle.create_vendor_refund_from_row` first.

`refund_documents` is the list the Bulk Import dialog offers, built from the SAME field map, status
exclusions and paid rule, so it cannot offer a document the write then refuses.

⚠️ A RECEIVED REFUND LOWERS ITS PO'S / WO'S `amount_paid` (owner, 2026-09-17, reversing the same day's
"moves no paid amount"; only Received since #1398). The rule and its one writer live in
`services/amount_paid` (`amount_paid_of`, `write_amount_paid`): the document's Paid `Project Payments`
LESS its Received Vendor Refunds, read here through `refunded_on(..., LOWERS_PAID_STATUSES)`. A refund
creates no `Project Payment`. Because the stored figure is NET, `paid_of` adds the Received refunds back
to get what was PAID -- the cap would otherwise subtract them twice.

⚠️ THE PROJECT IS OPTIONAL (owner, 2026-09-17). With none chosen the lists cover the vendor's documents
on EVERY project, and a PO / WO refund records its DOCUMENT'S project (`document_project`) -- never a
guess. A Misc. Expense records the chosen project, or none.
"""

from decimal import ROUND_HALF_UP, Decimal

import frappe
from frappe.utils import cint

from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.reference_guard import MATCH_DOCTYPE
from nirmaan_stack.services.role_profiles import REFUND_ACCOUNTANT_PROFILES, has_role_profile

VENDOR_REFUNDS = "Vendor Refunds"
PROCUREMENT_ORDERS = "Procurement Orders"
SERVICE_REQUESTS = "Service Requests"

#: The `document_type` of a refund against NO document -- the part of a credit no PO or Work Order
#: takes. Not a DocType: `document_name` stays blank, so the Dynamic Link is never resolved.
MISC_EXPENSE = "Misc. Expense"

#: A refund's status (#1398, ADR-0032). RECONCILIATION PENDING: recorded before its bank line, on the
#: vendor's word. RECEIVED: a bank credit line is matched to it, or it was recorded straight from one.
#: CANCELLED: a waiting refund that will never arrive; kept for history.
RECONCILIATION_PENDING = "Reconciliation Pending"
RECEIVED = "Received"
CANCELLED = "Cancelled"
#: The doctype's Select, in its order (pinned by `services/test_vendor_refund_status`).
REFUND_STATUSES = (RECONCILIATION_PENDING, RECEIVED, CANCELLED)

#: ⚠️ THE STATUS SPLITS WHAT `refunded_on` MEANS, so every caller names which of these it wants.
#: Only a Received refund LOWERS the paid amount (`amount_paid.amount_paid_of`), so only it is added back to get
#: what was paid (`paid_of`). The cap ("no more than is still refundable") also counts a waiting
#: refund, so the money the vendor says it sent cannot be refunded twice. Cancelled counts for nothing.
LOWERS_PAID_STATUSES = (RECEIVED,)
TAKES_REFUNDABLE_STATUSES = (RECEIVED, RECONCILIATION_PENDING)
#: A waiting refund HOLDS its amount of its PO's overpaid credit (#1400): `held_on`, read by the one
#: credit reader `_payment_utils.usable_po_credit`.
HOLDS_CREDIT_STATUSES = (RECONCILIATION_PENDING,)
#: A refund a Bulk Import credit line may be MATCHED to (#1401): one still waiting for its bank line.
#: ⚠️ The pool also holds a RECEIVED refund marked `no_bank_line` (#1403, `is_matchable`): that is a
#: second condition, not a status, so it is not listed here.
MATCHABLE_STATUSES = (RECONCILIATION_PENDING,)

#: RECEIVED WITH NO BANK LINE (#1403, ADR-0032): an Admin made a waiting refund count without its bank
#: line, giving a reason. It is Received (it lowers the paid amount, settles the adjustment, unlocks the
#: PO) and carries `no_bank_line = 1` -- the "No bank proof" badge -- until a Bulk Import credit line is
#: matched to it, which clears the mark (Unreconcile sets it back). `no_bank_line_by` / `_at` /
#: `_reason` record who marked it, when and why, and stay after the match as its history.
#: ⚠️ WHILE MARKED IT IS NOT "ALREADY RECORDED MONEY" for the bank-line duplicate guard
#: (`candidates.CONTAINS_LEDGERS`): its bank line is the one it is waiting to be matched to.
NO_BANK_LINE_FIELDS = ("no_bank_line", "no_bank_line_by", "no_bank_line_at", "no_bank_line_reason")

#: Each document type a refund may point at -> (its vendor field, its project field).
REFUND_DOCUMENT_FIELDS: dict[str, tuple[str, str]] = {
    PROCUREMENT_ORDERS: ("vendor", "project"),
    SERVICE_REQUESTS: ("vendor", "project"),
}

#: Statuses a refund may not be recorded against. A MERGED PO's payments moved to its master PO, so a
#: refund of that money belongs on the master. Cancelled and Inactive POs stay: an advance refunded on
#: a cancelled order is exactly the case a refund exists for.
EXCLUDED_STATUSES: dict[str, tuple[str, ...]] = {PROCUREMENT_ORDERS: ("Merged",)}

#: The columns each list reads, beyond `name` and `status` -- the table's own, plus what the PO / WO
#: details panel shows.
_LIST_FIELDS: dict[str, list[str]] = {
    PROCUREMENT_ORDERS: [
        "total_amount", "amount", "tax_amount", "amount_paid", "amount_invoiced", "amount_due",
        "po_amount_delivered", "latest_payment_date", "creation", "project",
    ],
    SERVICE_REQUESTS: [
        "total_amount", "amount_paid", "amount_invoiced", "amount_due", "creation", "project",
    ],
}

_PAISA = Decimal("0.01")


def money(value) -> Decimal:
    """A money figure as a Decimal rounded to the paisa -- the one precision every rule compares at."""
    return Decimal(str(value or 0)).quantize(_PAISA, rounding=ROUND_HALF_UP)


def paid_of(document_type: str, document, refunded: Decimal) -> Decimal:
    """How much has been paid on this document -- THE one definition of "paid" for a refund.

    The stored `amount_paid` is NET of the document's Received refunds (`amount_paid.amount_paid_of`), so `refunded`
    -- every RECEIVED refund stored against it (`LOWERS_PAID_STATUSES`), a record being re-saved
    included -- is added back. Adding back any other status would invent money that was never paid.
    """
    return money(document.get("amount_paid")) + refunded


def refunded_on(
    document_type: str, names, statuses: tuple[str, ...], exclude_refund: str | None = None
) -> dict[str, Decimal]:
    """The `Vendor Refunds` at one of `statuses` stored against each document, by name.

    `statuses` has no default: the caller says whether it is asking what LOWERED the paid amount
    (`LOWERS_PAID_STATUSES`) or what the cap must hold back (`TAKES_REFUNDABLE_STATUSES`).
    """
    names = [n for n in (names or []) if n]
    if not names:
        return {}
    filters = {
        "document_type": document_type,
        "document_name": ["in", names],
        "status": ["in", list(statuses)],
    }
    if exclude_refund:
        filters["name"] = ["!=", exclude_refund]
    totals: dict[str, Decimal] = {}
    for refund in frappe.get_all(
        VENDOR_REFUNDS, filters=filters, fields=["document_name", "amount"], limit_page_length=0
    ):
        totals[refund.document_name] = totals.get(refund.document_name, Decimal("0")) + money(
            refund.amount
        )
    return totals


def held_on(po_id: str) -> float:
    """How much of this PO's overpaid credit its waiting refunds hold (#1400, ADR-0032)."""
    return float(refunded_on(PROCUREMENT_ORDERS, [po_id], HOLDS_CREDIT_STATUSES).get(po_id, 0))


def waiting_refunds_of(po_id: str) -> list[dict]:
    """This PO's waiting refunds, oldest first: what holds its credit and what its lock waits for."""
    if not po_id:
        return []
    return frappe.get_all(
        VENDOR_REFUNDS,
        filters={
            "document_type": PROCUREMENT_ORDERS,
            "document_name": po_id,
            "status": ["in", list(HOLDS_CREDIT_STATUSES)],
        },
        fields=["name", "amount", "payment_date", "utr", "waiting_created_by", "creation"],
        order_by="creation asc",
        limit_page_length=0,
    )


def money_edit_problem(status_before: str | None, is_creator: bool, is_accountant: bool) -> str | None:
    """Why this user may not change a refund's amount, vendor or document, or None (#1400, ADR-0032).

    Only while it waits (Reconciliation Pending), and only by the user who recorded it as waiting or
    an Accountant. A Received refund's amount and document are fixed: a matched bank record cannot
    drift, and only Unreconcile (which sends it back to waiting) can change them. A Cancelled one is
    history. Its proof, UTR and description are not covered here: they stay editable at any status.
    """
    if status_before != RECONCILIATION_PENDING:
        return (
            f"The amount and PO of a {status_before or 'recorded'} refund cannot be changed. "
            "Only a refund still waiting for its bank line (Reconciliation Pending) can be corrected."
        )
    if not (is_creator or is_accountant):
        return "Only the person who recorded this waiting refund, or an Accountant, can change its amount or PO."
    return None


def creator_and_accountant(refund, user: str) -> tuple[bool, bool]:
    """Whether `user` recorded this refund as waiting, and whether they are an Accountant: the two ways
    to be allowed to correct its money (`money_edit_problem`) or cancel it. `refund` is the record as
    it stood before any edit being judged (a doc, or a mapping with `waiting_created_by`)."""
    creator = refund.get("waiting_created_by")
    return bool(creator) and creator == user, has_role_profile(user, REFUND_ACCOUNTANT_PROFILES)


def bank_matched(names) -> set[str]:
    """The refunds among `names` a Bulk Import credit line is matched to right now: a live (Settled)
    `Outflow Row Match` leg points at them (#1401)."""
    names = [n for n in (names or []) if n]
    if not names:
        return set()
    return set(
        frappe.get_all(
            MATCH_DOCTYPE,
            filters={"target_doctype": VENDOR_REFUNDS, "target_name": ["in", names], "match_kind": MATCH_SETTLED},
            pluck="target_name",
        )
    )


def utr_edit_problem(name: str, utr_changes: bool, is_bank_matched: bool) -> str | None:
    """Why this refund's UTR may not change now, or None (#1396 review). While a bank line is matched
    to it, its UTR is that line's reference, and Unreconcile reads it to know the match is still its
    own: a changed UTR would make the match impossible to undo. Unreconcile first, then change it."""
    if utr_changes and is_bank_matched:
        return (
            f"The UTR of {name} is the reference of the bank line matched to it. Unreconcile that line "
            "in Bulk Import first if the UTR is wrong."
        )
    return None


def cancel_problem(status: str | None) -> str | None:
    """Why this refund cannot be cancelled, or None (#1403). Only a waiting one: a Received refund is
    money that arrived (Unreconcile, not Cancel, undoes a wrong match), and a Cancelled one already is.
    Who may cancel (its creator or an Accountant) is the endpoint's check."""
    if status != RECONCILIATION_PENDING:
        return (
            f"A {status or 'recorded'} refund cannot be cancelled. Only a refund still waiting for its "
            "bank line (Reconciliation Pending) can be."
        )
    return None


def delete_problem(status: str | None, has_bank_history: bool) -> str | None:
    """Why this refund cannot be deleted, or None. Only a Cancelled one: it never counted and holds
    nothing, so deleting it moves no money. A Received refund is money that arrived and a waiting one is
    a promise still open (Cancel it first). A refund a bank line was once matched to is kept even when
    Cancelled: its Outflow Row Match legs are the audit trail. Who may (an Admin or Procurement) is the
    endpoint's check."""
    if status != CANCELLED:
        return (
            f"A {status or 'recorded'} refund cannot be deleted. Only a Cancelled refund can be; cancel a "
            "waiting refund first."
        )
    if has_bank_history:
        return "This refund was once matched to a bank line, so it is kept for the bank-match history."
    return None


def no_bank_line_problem(status: str | None, reason: str | None) -> str | None:
    """Why this refund cannot be marked Received with no bank line, or None (#1403). Only a waiting
    one, and only with a reason. Who may (an Admin) is the endpoint's check."""
    if status != RECONCILIATION_PENDING:
        return (
            f"A {status or 'recorded'} refund cannot be marked Received with no bank line. Only a "
            "refund still waiting for its bank line (Reconciliation Pending) can be."
        )
    if not (reason or "").strip():
        return "Give a reason for marking this refund Received with no bank line."
    return None


def no_bank_line_values(user: str, reason: str, at) -> dict:
    """The fields that make a refund Received with no bank line (#1403): it counts at once and carries
    the "No bank proof" mark, with who marked it, when and why. Set them on a waiting refund and save
    (the refund hook then runs the PO sync), or put them on a new refund that never had a bank line."""
    return {
        "status": RECEIVED,
        "no_bank_line": 1,
        "no_bank_line_by": user,
        "no_bank_line_at": at,
        "no_bank_line_reason": (reason or "").strip(),
    }


def document_project(document_type: str, document_name: str) -> str | None:
    """The project a PO / WO is on -- the project its refund records. None for a Misc. Expense."""
    if document_type not in REFUND_DOCUMENT_FIELDS or not document_name:
        return None
    return frappe.db.get_value(document_type, document_name, REFUND_DOCUMENT_FIELDS[document_type][1])


def refund_documents(vendor: str, project: str | None = None) -> dict[str, list[dict]]:
    """Every PAID document of this vendor a refund may point at, newest first, per type -- on `project`
    when one is given, on every project otherwise.

    Each row carries `paid`, `refunded` (what earlier Received and waiting refunds hold of it) and
    `refundable` -- the most a new refund against it may be -- plus `project` and `project_name`.
    """
    project = (project or "").strip()
    result: dict[str, list[dict]] = {}
    for document_type, (vendor_field, project_field) in REFUND_DOCUMENT_FIELDS.items():
        filters: dict = {vendor_field: vendor}
        if project:
            filters[project_field] = project
        excluded = EXCLUDED_STATUSES.get(document_type)
        if excluded:
            filters["status"] = ["not in", list(excluded)]
        filters["amount_paid"] = [">", 0]
        rows = frappe.get_all(
            document_type,
            filters=filters,
            fields=["name", "status", *_LIST_FIELDS[document_type]],
            order_by="creation desc",
            limit_page_length=0,
        )
        names = [row.name for row in rows]
        received = refunded_on(document_type, names, LOWERS_PAID_STATUSES)
        refunded = refunded_on(document_type, names, TAKES_REFUNDABLE_STATUSES)
        for row in rows:
            already = refunded.get(row.name, Decimal("0"))
            paid = paid_of(document_type, row, received.get(row.name, Decimal("0")))
            row["paid"] = float(paid)
            row["refunded"] = float(already)
            row["refundable"] = float(max(paid - already, Decimal("0")))
        result[document_type] = rows

    # One read for every project named, so a vendor-wide list can say where each document is.
    project_ids = sorted({row.project for rows in result.values() for row in rows if row.project})
    names = (
        dict(
            frappe.get_all(
                "Projects",
                filters={"name": ["in", project_ids]},
                fields=["name", "project_name"],
                as_list=True,
                limit_page_length=0,
            )
        )
        if project_ids
        else {}
    )
    for rows in result.values():
        for row in rows:
            row["project_name"] = names.get(row.project) or row.project
    return result


def refund_document_problem(
    vendor, project, document_type, document_name, amount, exclude_refund: str | None = None
) -> str | None:
    """Why ONE refund of `amount` against this document cannot be recorded, or None.

    `project` is optional: when given, a PO / WO must be on it. `exclude_refund` is the record being
    re-saved, so its own amount does not count as an earlier refund.
    """
    if not (vendor or "").strip():
        return "A vendor is required to record a vendor refund."
    project = (project or "").strip()
    document_type = (document_type or "").strip()
    document_name = (document_name or "").strip()
    if document_type == MISC_EXPENSE:
        # Against no document, so nothing to own, pay or cap -- the credit's own total is the check.
        if document_name:
            return "A Misc. Expense refund is not against a PO or Work Order; leave the document blank."
        if money(amount) <= 0:
            return "Enter an amount greater than 0 for the Misc. Expense."
        return None
    if document_type not in REFUND_DOCUMENT_FIELDS:
        return "A refund can only be against a PO, a Work Order or a Misc. Expense."
    if not document_name:
        return f"Choose the {_noun(document_type)} the refund is against."

    vendor_field, project_field = REFUND_DOCUMENT_FIELDS[document_type]
    fields = [vendor_field, project_field, "status", "amount_paid"]
    document = frappe.db.get_value(document_type, document_name, fields, as_dict=True)
    if not document:
        return f"{_noun(document_type)} '{document_name}' not found."
    if document.get(vendor_field) != vendor:
        return f"{document_name} is not {vendor}'s {_noun(document_type)}."
    if project and document.get(project_field) != project:
        return f"{document_name} is not on project {project}."
    if document.get("status") in EXCLUDED_STATUSES.get(document_type, ()):
        return f"{document_name} is {document.get('status')}; record the refund on its master PO."

    received = refunded_on(document_type, [document_name], LOWERS_PAID_STATUSES)
    paid = paid_of(document_type, document, received.get(document_name, Decimal("0")))
    if paid <= 0:
        return f"Nothing has been paid on {document_name}, so nothing can be refunded against it."
    amount = money(amount)
    if amount <= 0:
        return f"Enter an amount greater than 0 for {document_name}."
    already = refunded_on(
        document_type, [document_name], TAKES_REFUNDABLE_STATUSES, exclude_refund
    ).get(document_name, Decimal("0"))
    refundable = max(paid - already, Decimal("0"))
    if amount > refundable:
        return (
            f"{document_name} was paid {paid}"
            + (f" and {already} of it is already refunded" if already else "")
            + f", so no more than {refundable} can be refunded against it."
        )
    return None


def refund_allocation_problem(vendor, project, allocations, refund_amount) -> str | None:
    """Why this bank credit cannot be split into these refunds, or None.

    `allocations` is a list of mappings with `document_type`, `document_name`, `amount`. `project` is
    optional -- see `refund_document_problem`.
    """
    if not (vendor or "").strip():
        return "A vendor is required to record a vendor refund."
    allocations = list(allocations or [])
    if not allocations:
        return "Choose at least one PO, Work Order or Misc. Expense the refund is against."

    seen: set[tuple[str, str]] = set()
    total = Decimal("0")
    for allocation in allocations:
        document_type = (allocation.get("document_type") or "").strip()
        document_name = (allocation.get("document_name") or "").strip()
        # A Misc. Expense has no name, so its key is ("Misc. Expense", "") -- one per credit.
        if (document_name or document_type == MISC_EXPENSE) and (document_type, document_name) in seen:
            return f"{document_name or MISC_EXPENSE} is chosen twice."
        seen.add((document_type, document_name))
        problem = refund_document_problem(
            vendor, project, document_type, document_name, allocation.get("amount")
        )
        if problem:
            return problem
        total += money(allocation.get("amount"))

    refund = money(refund_amount)
    if total != refund:
        return f"The amounts add up to {total}, but the refund is {refund}. They must match."
    return None


def is_matchable(refund) -> bool:
    """May a bank credit line be matched to this refund? (#1401, #1403) It is still waiting for its
    line: Reconciliation Pending, or Received with no bank line (marked by an Admin, not matched yet)."""
    status = refund.get("status")
    return status in MATCHABLE_STATUSES or (status == RECEIVED and bool(cint(refund.get("no_bank_line"))))


def matchable_refunds(vendor: str) -> list[dict]:
    """The vendor's refunds a bank credit line may be matched to, oldest first (#1401): the pool the
    Bulk Import decision dialog lists once a vendor is chosen.

    Each row: name, amount, status, vendor, document_type, document_name, project, payment_date, utr,
    waiting_created_by, no_bank_line, creation. Waiting refunds and, since #1403, Received refunds
    marked `no_bank_line` (`is_matchable`).
    """
    vendor = (vendor or "").strip()
    if not vendor:
        return []
    return _matchable_refunds({"vendor": vendor})


def every_matchable_refund() -> list[dict]:
    """`matchable_refunds` across EVERY vendor, oldest first: the pool the Bulk Import run suggests
    from (#1402). A bank reference may name a refund before any vendor is known."""
    return _matchable_refunds({})


def _matchable_refunds(filters: dict) -> list[dict]:
    """THE POOL'S MEMBERSHIP, in one place for both readers above (#1401, #1402, #1403)."""
    rows = frappe.get_all(
        VENDOR_REFUNDS,
        filters=filters,
        or_filters=[
            ["status", "in", list(MATCHABLE_STATUSES)],
            ["no_bank_line", "=", 1],
        ],
        fields=[
            "name", "amount", "status", "vendor", "document_type", "document_name", "project",
            "payment_date", "utr", "waiting_created_by", "no_bank_line", "creation",
        ],
        order_by="creation asc",
        limit_page_length=0,
    )
    # The SQL narrows; the rule decides, so the pool and the match can never disagree.
    return [row for row in rows if is_matchable(row)]


def waiting_match_problem(refunds, line_amount) -> str | None:
    """Why one bank credit line cannot be matched to these refunds, or None (#1401).

    `refunds` are mappings with `name`, `amount`, `status`, `vendor`, `no_bank_line`, read under lock
    by the caller. Every one must still wait for its bank line (`is_matchable`: Reconciliation Pending,
    or Received with no bank line), all one vendor's, none twice, and together they
    must add up EXACTLY (to the paisa) to the line: a credit line is never partly allocated (owner,
    2026-10-13), as `refund_allocation_problem` holds a created refund's parts to the line.
    """
    refunds = list(refunds or [])
    if not refunds:
        return "Choose at least one waiting Vendor Refund to match this bank line to."
    seen: set[str] = set()
    total = Decimal("0")
    for refund in refunds:
        name = refund.get("name")
        if name in seen:
            return f"{name} is chosen twice."
        seen.add(name)
        status = refund.get("status")
        if not is_matchable(refund):
            return (
                f"{name} is {status or 'not recorded'}, not waiting for its bank line, "
                "so it cannot be matched."
            )
        total += money(refund.get("amount"))
    if len({refund.get("vendor") for refund in refunds}) > 1:
        return "The refunds chosen are from different vendors. One bank line is one vendor's refund."
    line = money(line_amount)
    if total != line:
        return (
            f"The refunds chosen add up to {total}, but the bank line is {line}. "
            "They must match exactly."
        )
    return None


def _noun(document_type: str) -> str:
    return {
        PROCUREMENT_ORDERS: "PO",
        SERVICE_REQUESTS: "Work Order",
    }.get(document_type, document_type)
