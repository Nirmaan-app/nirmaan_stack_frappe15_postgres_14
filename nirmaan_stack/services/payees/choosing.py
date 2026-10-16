# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Choosing a vendor's Payee (spec #1420, ADR-0033): the new-vendor form (#1425) and the vendor
page's Use a different payee (#1426, #1435) share it.

* `suggest_for_vendor` -- "Payees that look like this vendor": Payees ranked by
  `matching.rank_payees` (same PAN of a linked vendor first, then name), each with its vendors.
* `payee_choices` / `payee_choice` -- what the confirmation shows before a vendor is pointed at a
  Payee: its summary and every vendor already linked to it (#1434: no expenses, no last payment).
* `choose_payee` -- the vendor's Payee from the form's answer: an existing one, or new bank details
  made into a Payee by `writer.create_payee`.
* `link_vendor` -- Use a different payee (#1426): an existing vendor to another Payee, by `choose_payee`.

Checks no role and never commits: the calling endpoint does both.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.links import payee_summaries
from nirmaan_stack.services.payees.matching import Candidate, LinkedVendor, rank_payees
from nirmaan_stack.services.payees.rules import PAYEE_DOCTYPE, already_linked_problem
from nirmaan_stack.services.payees.vendor_account import payee_for_vendor
from nirmaan_stack.services.payees.writer import create_payee


def suggest_for_vendor(vendor_name: str | None, vendor_pan: str | None, *, limit: int = 5) -> list[dict]:
    """The Payees that look like a vendor with this name and PAN, best first. Each is a
    `payee_choices` entry plus `match` (`matching.STRONG` | `matching.NAME_ONLY`)."""
    if not (vendor_name or "").strip() and not (vendor_pan or "").strip():
        return []
    rows = frappe.db.sql(
        """
        SELECT p.name, p.account_name, v.vendor_name, v.vendor_pan
        FROM "tabPayee" p LEFT JOIN "tabVendors" v ON v.payee = p.name
        """,
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
    `linked_vendors` (`[{name, vendor_name, vendor_city, vendor_pan}]`). A name with no Payee is left
    out."""
    summaries = payee_summaries(names)
    if not summaries:
        return {}
    vendors = frappe.db.sql(
        """SELECT payee, name, vendor_name, vendor_city, vendor_pan FROM "tabVendors"
           WHERE payee IN %(names)s ORDER BY vendor_name, name""",
        {"names": tuple(summaries)},
        as_dict=True,
    )
    choices = {name: {**summary, "linked_vendors": []} for name, summary in summaries.items()}
    for v in vendors:
        choices[v.payee]["linked_vendors"].append(
            {"name": v.name, "vendor_name": v.vendor_name, "vendor_city": v.vendor_city, "vendor_pan": v.vendor_pan}
        )
    return choices


def payee_choice(name: str) -> dict | None:
    """One Payee as `payee_choices` gives it, or None."""
    return payee_choices([name]).get(name)


def choose_payee(payee: str | None = None, bank: dict | None = None) -> str:
    """The Payee a vendor is to be paid into, from the form's answer: `payee`, an existing Payee
    (refused when there is no such Payee), or `bank` (`{account_name, account_number, ifsc}`), new details that
    `writer.create_payee` makes a Payee (refusing a duplicate with `DuplicatePayeeError`)."""
    if payee and bank:
        frappe.throw(_("Pick a payee on record or enter new bank details, not both."))
    if payee:
        if not frappe.db.exists(PAYEE_DOCTYPE, payee):
            frappe.throw(_("Payee {0} does not exist.").format(payee), frappe.DoesNotExistError)
        return payee
    if bank:
        return create_payee(bank.get("account_name"), bank.get("account_number"), bank.get("ifsc")).name
    frappe.throw(_("Pick a payee on record or enter new bank details."))


def link_vendor(vendor: str, payee: str | None = None, bank: dict | None = None) -> str:
    """Point an existing vendor at another Payee (the vendor page's Use a different payee and Add bank
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

