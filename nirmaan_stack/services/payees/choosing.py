# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Choosing a vendor's Payee (spec #1420, ADR-0033): the new-vendor form (#1425) and the vendor
page's Change account (#1426) share it.

* `suggest_for_vendor` -- "Payees that look like this vendor": Active Payees ranked by
  `matching.rank_payees` (same PAN of a linked vendor first, then name), each with its links.
* `payee_choices` / `payee_choice` -- what the confirmation shows before a vendor is pointed at a
  Payee: its summary, every linked vendor and expense, and its last payment.
* `assert_pickable` -- an Inactive Payee (or none) can't be newly picked: the form's early refusal,
  in `rules.inactive_pick_problem`'s words. `guard.check_payee_pick` refuses it on every save.
* `choose_payee` -- the vendor's Payee from the form's answer: an existing one (pickable), or new
  bank details made into a Payee by `writer.create_payee`.
* `link_vendor` -- Change account (#1426): an existing vendor to another Payee, by `choose_payee`.
* `vendor_account` -- the vendor page's Account Details card: its Payee and who else shares it.

Checks no role and never commits: the calling endpoint does both.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.links import payee_for_vendor, payee_summaries, payee_summary
from nirmaan_stack.services.payees.matching import Candidate, LinkedVendor, rank_payees
from nirmaan_stack.services.payees.rules import (
    ACTIVE,
    PAID_STATUSES,
    PAYEE_DOCTYPE,
    already_linked_problem,
    inactive_pick_problem,
)
from nirmaan_stack.services.payees.writer import create_payee

_PAID = ", ".join(f"'{status}'" for status in PAID_STATUSES)
EXPENSE_DOCTYPES = ("Project Expenses", "Non Project Expenses")


def suggest_for_vendor(vendor_name: str | None, vendor_pan: str | None, *, limit: int = 5) -> list[dict]:
    """The Active Payees that look like a vendor with this name and PAN, best first. Each is a
    `payee_choices` entry plus `match` (`matching.STRONG` | `matching.NAME_ONLY`)."""
    if not (vendor_name or "").strip() and not (vendor_pan or "").strip():
        return []
    rows = frappe.db.sql(
        """
        SELECT p.name, p.account_name, v.vendor_name, v.vendor_pan
        FROM "tabPayee" p LEFT JOIN "tabVendors" v ON v.payee = p.name
        WHERE p.status = %(active)s
        """,
        {"active": ACTIVE},
        as_dict=True,
    )
    candidates: dict[str, dict] = {}
    for row in rows:
        c = candidates.setdefault(row.name, {"account_name": row.account_name, "vendors": []})
        if row.vendor_name is not None or row.vendor_pan is not None:
            c["vendors"].append(LinkedVendor(row.vendor_name, row.vendor_pan))
    ranked = rank_payees(
        vendor_name,
        vendor_pan,
        [Candidate(name, c["account_name"], tuple(c["vendors"])) for name, c in candidates.items()],
        limit=limit,
    )
    choices = payee_choices([s.payee for s in ranked])
    return [{**choices[s.payee], "match": s.match} for s in ranked if s.payee in choices]


def payee_choices(names: list[str]) -> dict[str, dict]:
    """`{name: choice}` for each named Payee. A choice is `links.payee_summaries`' summary plus
    `linked_vendors` (`[{name, vendor_name, vendor_city, vendor_pan}]`), `linked_expenses`
    (`[{name, doctype}]`) and `last_payment` (`{date, document}` of the latest payment that left
    Approved for it, or None). A name with no Payee is left out."""
    summaries = payee_summaries(names)
    if not summaries:
        return {}
    params = {"names": tuple(summaries)}
    vendors = frappe.db.sql(
        """SELECT payee, name, vendor_name, vendor_city, vendor_pan FROM "tabVendors"
           WHERE payee IN %(names)s ORDER BY vendor_name, name""",
        params,
        as_dict=True,
    )
    expenses = frappe.db.sql(
        """SELECT payee, name, 'Project Expenses' AS doctype, creation FROM "tabProject Expenses"
               WHERE payee IN %(names)s
           UNION ALL
           SELECT payee, name, 'Non Project Expenses' AS doctype, creation FROM "tabNon Project Expenses"
               WHERE payee IN %(names)s
           ORDER BY creation DESC""",
        params,
        as_dict=True,
    )
    # The latest paid row per Payee: a Project Payment of a vendor linked to it now, or a linked expense.
    last = frappe.db.sql(
        f"""
        SELECT DISTINCT ON (payee) payee, paid_on, document FROM (
            SELECT v.payee, COALESCE(pp.payment_date, pp.modified::date) AS paid_on,
                   COALESCE(pp.document_name, pp.name) AS document
            FROM "tabProject Payments" pp JOIN "tabVendors" v ON v.name = pp.vendor
            WHERE v.payee IN %(names)s AND pp.status IN ({_PAID})
            UNION ALL
            SELECT payee, COALESCE(payment_date, modified::date), name FROM "tabProject Expenses"
            WHERE payee IN %(names)s AND status IN ({_PAID})
            UNION ALL
            SELECT payee, COALESCE(payment_date, modified::date), name FROM "tabNon Project Expenses"
            WHERE payee IN %(names)s AND status IN ({_PAID})
        ) paid
        ORDER BY payee, paid_on DESC, document
        """,
        params,
        as_dict=True,
    )
    choices = {
        name: {**summary, "linked_vendors": [], "linked_expenses": [], "last_payment": None}
        for name, summary in summaries.items()
    }
    for v in vendors:
        choices[v.payee]["linked_vendors"].append(
            {"name": v.name, "vendor_name": v.vendor_name, "vendor_city": v.vendor_city, "vendor_pan": v.vendor_pan}
        )
    for e in expenses:
        choices[e.payee]["linked_expenses"].append({"name": e.name, "doctype": e.doctype})
    for row in last:
        choices[row.payee]["last_payment"] = {"date": str(row.paid_on), "document": row.document}
    return choices


def payee_choice(name: str) -> dict | None:
    """One Payee as `payee_choices` gives it, or None."""
    return payee_choices([name]).get(name)


def assert_pickable(name: str) -> None:
    """Refuse a Payee that doesn't exist or is Inactive: neither can be newly picked."""
    status = frappe.db.get_value(PAYEE_DOCTYPE, name, "status")
    if status is None:
        frappe.throw(_("Payee {0} does not exist.").format(name))
    if status != ACTIVE:
        frappe.throw(_(inactive_pick_problem(name)))


def choose_payee(payee: str | None = None, bank: dict | None = None) -> str:
    """The Payee a vendor is to be paid into, from the form's answer: `payee`, an existing Payee
    (refused when Inactive), or `bank` (`{account_name, account_number, ifsc}`), new details that
    `writer.create_payee` makes a Payee (refusing a duplicate with `DuplicatePayeeError`)."""
    if payee and bank:
        frappe.throw(_("Pick a payee on record or enter new bank details, not both."))
    if payee:
        assert_pickable(payee)
        return payee
    if bank:
        return create_payee(bank.get("account_name"), bank.get("account_number"), bank.get("ifsc")).name
    frappe.throw(_("Pick a payee on record or enter new bank details."))


def link_vendor(vendor: str, payee: str | None = None, bank: dict | None = None) -> str:
    """Point an existing vendor at another Payee (the vendor page's Change account and Add bank
    details): `choose_payee`'s two paths, refusing the Payee it already has. Saves the vendor
    through its `validate` controllers; the other vendors on its old Payee keep it. Returns the
    vendor's new Payee."""
    current = payee_for_vendor(vendor)
    if payee and payee == current:
        frappe.throw(_(already_linked_problem(vendor, payee)))
    doc = frappe.get_doc("Vendors", vendor)
    doc.payee = choose_payee(payee, bank)
    doc.save(ignore_permissions=True)
    return doc.payee


def vendor_account(vendor: str) -> dict:
    """What the vendor page's Account Details card shows: `{payee: <summary> | None, other_vendors}`,
    `other_vendors` being how many other vendors are paid into the same Payee."""
    payee = payee_for_vendor(vendor)
    summary = payee_summary(payee) if payee else None
    return {"payee": summary, "other_vendors": summary["vendors"] - 1 if summary else 0}
