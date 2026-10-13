# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Lifecycle controller for the Cheques doctype (spec #1407).

`validate` holds the Cheque's own rules on EVERY write path (the cheques service, a patch, Desk):
the header rules in `services/cheques/rules.header_problem`, the line rules in
`services/cheques/lines.lines_problem` (a payment or expense on one live Cheque only, each PO/WO the
Vendor's so a typed payee takes expense lines only, a Project Expense in its line's project),
and the bank + cheque number uniqueness.
It also keeps the stored identity in step: `cheque_no` without spaces, `bank_key` derived from the
bank, and no bank name on an ICICI Bank cheque. The unique constraint on `bank_key` + `cheque_no`
(`Cheques.on_doctype_update`) backs this up against two saves racing.

A backfilled Cheque (#1419) has no photo: its writer sets `doc.flags.cheque_without_photo`.
"""

import frappe
from frappe import _

from nirmaan_stack.services.cheques.lines import lines_problem, normalise_lines
from nirmaan_stack.services.cheques.rules import duplicate_problem, header_problem, parse_header
from nirmaan_stack.services.cheques.writer import existing_cheque


def validate(doc, method=None):
    header = parse_header(doc.as_dict())
    doc.cheque_no = header.cheque_no
    doc.bank_name = header.bank_name
    doc.bank_key = header.bank_key

    problem = header_problem(
        header,
        line_count=len(doc.get("lines") or []),
        photo_required=doc.is_new() and not doc.flags.cheque_without_photo,
    )
    if problem:
        frappe.throw(_(problem))

    normalise_lines(doc)
    problem = lines_problem(doc)
    if problem:
        frappe.throw(_(problem))

    existing = existing_cheque(header.bank, header.bank_name, header.cheque_no, exclude=None if doc.is_new() else doc.name)
    if existing:
        frappe.throw(_(duplicate_problem(header, existing)))
