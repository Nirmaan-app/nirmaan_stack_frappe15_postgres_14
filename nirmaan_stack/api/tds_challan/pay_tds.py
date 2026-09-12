# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Pay a set of TDS deductions against one challan — the write behind the "Pay TDS" button.

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**. This repo ALSO uses "TDS" for **TECHNICAL DATA SHEET**
(`TDS Items`, `TDS Repository`, `Project TDS Setting`). Same three letters, unrelated concepts.

THE SPINE
---------
A `TDS Challan Attachment` is the receipt for tax deposited with the department. Paying means:
every selected `Payment TDS Deduction` gets `tds_challan` set and `status` = Paid, and the
challan's `reconciled_amount` is brought up to date. One transaction, all of it or none of it.

Two entry points, ONE apply path (`_apply`):
  * `pay_tds`                — against a challan that already exists (the "Adjustment By Old
                               Challan" arm), spending its unused balance.
  * `create_challan_and_pay` — mint the challan from the upload form first, then pay it in the
                               SAME transaction, so a challan can never be left created-but-unused
                               by a half-finished action.

⚠️ `reconciled_amount` IS RECOMPUTED FROM SOURCE, NEVER INCREMENTED BY A DELTA. It is re-derived as
`SUM(tds_amount)` over the deductions pointing at the challan (`_recompute_reconciled`). This is the
repo's standing rule for a derived field (CLAUDE.md): a `+= total` drifts the moment anything else
touches a link — a correction, a delete, a future unlink path — whereas a recompute means ANY later
repair pass lands on exactly the same number and a reconcile can always prove it.

⚠️ THE CLIENT'S TOTAL IS NEVER TRUSTED. The amount paid is summed from the database rows inside the
lock, because the browser's figure was computed before the lock existed and may describe rows that
have since been paid by someone else.

CONCURRENCY. `_lock_challan` takes `SELECT ... FOR UPDATE` on the challan row before anything is
read or written, so two people spending the same balance serialize: the second blocks, then reads
the REDUCED balance and is rejected rather than overspending the challan. Same shape as
`po_adjustments/_payment_utils._lock_and_assert_source_credit`. The per-deduction re-check inside
the lock is the other half — it is what stops the same deduction being paid twice.

NOT HERE, DELIBERATELY: no unlink / reversal path. Undoing a payment would have to clear both
fields AND recompute the challan, and nothing calls for it yet. When it is built, it must reuse
`_recompute_reconciled` rather than subtracting.
"""

import json

import frappe
from frappe import _
from frappe.utils import flt

DEDUCTION_DOCTYPE = "Payment TDS Deduction"
CHALLAN_DOCTYPE = "TDS Challan Attachment"

PENDING = "Pending"
PAID = "Paid"

# Rupee tolerance on the capacity comparison. Amounts are stored to 2dp, so this only absorbs
# float representation noise — never a real shortfall.
TOLERANCE = 0.01

# The challan fields a caller may supply when minting one. Anything else in the payload is dropped
# rather than trusted: `reconciled_amount` in particular is SERVER-OWNED and must start at 0.
CREATABLE_CHALLAN_FIELDS = {
    "financial_year",
    "amount",
    "mode_of_payment",
    "bank_name",
    "bank_reference_number",
    "date_of_deposit",
    "bsr_code",
    "challan_no",
    "tender_date",
    "challan_attachment",
}


def _loads(value, what):
    """Accept either a JSON string (the frappe-react-sdk wire shape) or a real Python value."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            frappe.throw(_("{0} is not valid JSON.").format(what))
    return value


def _parse_names(deductions) -> list[str]:
    names, seen = [], set()
    for raw in _loads(deductions, "deductions") or []:
        name = str(raw).strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    if not names:
        frappe.throw(_("Select at least one pending deduction to pay."))
    return names


def _require_access():
    """Both doctypes, both write. Mirrors the role set the ledger screen is gated on."""
    for doctype in (DEDUCTION_DOCTYPE, CHALLAN_DOCTYPE):
        if not frappe.has_permission(doctype, "write"):
            frappe.throw(
                _("You are not permitted to record TDS payments."), frappe.PermissionError
            )


def _lock_challan(challan: str):
    """Take the row lock, then read the balance THROUGH it.

    Order is load-bearing: reading the amounts before the lock would read a figure another
    transaction is about to change, and the capacity check below would be decided on stale data.
    """
    locked = frappe.db.get_value(CHALLAN_DOCTYPE, challan, "name", for_update=True)
    if not locked:
        frappe.throw(_("TDS challan {0} not found.").format(challan))
    return frappe.db.get_value(
        CHALLAN_DOCTYPE, challan, ["name", "amount", "reconciled_amount", "challan_no"], as_dict=True
    )


def _load_payable(names: list[str]) -> list[dict]:
    """Re-read every selected deduction INSIDE the lock and insist it is still payable."""
    rows = frappe.db.get_all(
        DEDUCTION_DOCTYPE,
        filters={"name": ["in", names]},
        fields=["name", "status", "tds_challan", "tds_amount"],
    )
    found = {row["name"]: row for row in rows}

    missing = [name for name in names if name not in found]
    if missing:
        frappe.throw(
            _("These deductions no longer exist: {0}.").format(", ".join(sorted(missing)))
        )

    # A blank status reads as Pending — the same assumption the Status column and the selection
    # gate make on the frontend. Keep the three in step.
    taken = [
        row["name"]
        for row in rows
        if (row.get("status") or PENDING) != PENDING or row.get("tds_challan")
    ]
    if taken:
        frappe.throw(
            _(
                "{0} of the selected deductions have already been paid ({1}). "
                "Refresh the ledger and try again."
            ).format(len(taken), ", ".join(sorted(taken)[:5]))
        )
    return rows


def _recompute_reconciled(challan: str) -> float:
    """Re-derive `reconciled_amount` from the links themselves. NEVER `+= amount_just_paid`.

    ⚠️ RAW `set_value`, SO NO DOC EVENTS FIRE — deliberate and safe here: `TDS Challan Attachment`
    registers no `doc_events` in hooks.py, and the one invariant its own `validate` enforces over
    this field (0 <= reconciled <= amount) is asserted below before the write.
    """
    total = frappe.db.sql(
        """
        SELECT COALESCE(SUM(tds_amount), 0)
        FROM "tabPayment TDS Deduction"
        WHERE tds_challan = %s
        """,
        (challan,),
    )[0][0]
    total = flt(total, 2)

    amount = flt(frappe.db.get_value(CHALLAN_DOCTYPE, challan, "amount"), 2)
    if total > amount + TOLERANCE:
        # Unreachable through this module (the capacity gate runs first); a loud failure beats
        # silently writing a challan that claims to have paid out more than it holds.
        frappe.throw(
            _("Challan {0} would be over-applied ({1} against {2}).").format(challan, total, amount)
        )

    frappe.db.set_value(CHALLAN_DOCTYPE, challan, "reconciled_amount", total)
    return total


def _apply(names: list[str], challan: str) -> dict:
    """The shared write. Assumes access is checked; does NOT commit (the callers do, once)."""
    challan_row = _lock_challan(challan)
    rows = _load_payable(names)

    total = flt(sum(flt(row.get("tds_amount")) for row in rows), 2)
    amount = flt(challan_row.get("amount"), 2)
    remaining = flt(amount - flt(challan_row.get("reconciled_amount")), 2)

    if total > remaining + TOLERANCE:
        frappe.throw(
            _(
                "Challan {0} has only {1} left of {2}, but the selected deductions come to {3}. "
                "Pay fewer deductions, or use a challan with more balance."
            ).format(challan_row.get("challan_no") or challan, remaining, amount, total)
        )

    for name in names:
        # Raw set_value: `Payment TDS Deduction` carries no doc_events, and these two columns feed
        # no derived field other than the challan's own total, recomputed immediately below.
        frappe.db.set_value(DEDUCTION_DOCTYPE, name, {"tds_challan": challan, "status": PAID})

    reconciled = _recompute_reconciled(challan)
    return {
        "challan": challan,
        "paid_count": len(names),
        "paid_amount": total,
        "challan_amount": amount,
        "reconciled_amount": reconciled,
        "remaining": flt(amount - reconciled, 2),
    }


@frappe.whitelist(methods=["POST"])
def pay_tds(deductions, challan):
    """Pay the selected deductions against an EXISTING challan."""
    names = _parse_names(deductions)
    challan = (challan or "").strip()
    if not challan:
        frappe.throw(_("Select a challan to pay against."))

    _require_access()
    result = _apply(names, challan)
    frappe.db.commit()
    return result


@frappe.whitelist(methods=["POST"])
def create_challan_and_pay(deductions, challan_data):
    """Create a challan from the form, then pay the selected deductions against it.

    The insert goes through `frappe.get_doc(...).insert()` ON PURPOSE, so the doctype's own
    `validate` runs: the duplicate key (amount + bank reference + BSR code + challan no), the
    financial-year format, and the reconciled-amount bound. A duplicate therefore surfaces as
    `DuplicateEntryError` naming the challan that already exists — which is the user's cue to
    switch to the "Adjustment By Old Challan" arm rather than minting a second copy of one receipt.
    """
    names = _parse_names(deductions)
    _require_access()

    payload = _loads(challan_data, "challan_data") or {}
    if not isinstance(payload, dict):
        frappe.throw(_("challan_data must be an object."))

    fields = {
        key: value for key, value in payload.items() if key in CREATABLE_CHALLAN_FIELDS
    }
    if not fields:
        frappe.throw(_("No challan details were provided."))

    doc = frappe.get_doc({"doctype": CHALLAN_DOCTYPE, **fields})
    doc.insert()

    result = _apply(names, doc.name)
    frappe.db.commit()
    result["created_challan"] = doc.name
    return result
