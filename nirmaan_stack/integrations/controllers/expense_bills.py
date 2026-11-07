# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A deleted Expense's Expense bills (spec #1637 review; GLOSSARY *Expense bills*, ADR-0045).

`on_trash` of both Expense ledgers: the Expense's bills become history (`is_latest` 0), never deleted. Frappe's
link check never holds the delete for them (`hooks.ignore_links_on_delete` names `Expense Bill`), so an ordinary
delete reaches here as an Unreconcile's `force=True` one does (`outflow_import.unreconcile_created.delete_created`);
every bill queue and list joins the Expense, so a retired orphan is in none of them.
"""

from nirmaan_stack.services.expense_bills.receive import retire_bills


def on_trash(doc, method=None):
    """Retire Expense `doc`'s bills to history as it is deleted."""
    retire_bills(doc.doctype, doc.name)
