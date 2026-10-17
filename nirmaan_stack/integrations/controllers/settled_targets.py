# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The two lifecycle hooks a record a bank line settles needs now that `Outflow Row Match.target_name`
is text (ADR-0022 Amendment G).

  * `on_trash` -- refuse the delete while a live match record names it. On every doctype a bank line
    settles bar the two expense doctypes (those use `expense_bank_links.on_trash`). Hooked FIRST in
    each `on_trash` list, so a refused delete runs no clean-up and mints no version row.
  * `after_rename` -- carry the match records to the new name. On ALL six doctypes, the expenses
    included: their own rules read the same match records.
"""

import frappe

from nirmaan_stack.services.outflow_import.expense_links import list_expense_lines
from nirmaan_stack.services.outflow_import.settled_targets import delete_while_settled_refusal


def on_trash(doc, method=None):
    """⚠️ `force=True` DOES NOT SKIP THIS -- it skips Frappe's link check, not `on_trash` -- and that is
    the point: a PO delete force-deletes its adjustment payments, and must not take a bank-settled
    one with it.

    ⚠️ THE ROW IS ALREADY LOCKED WHEN THIS RUNS: `frappe.model.delete_doc.delete_doc` reads it
    `FOR UPDATE NOWAIT` before `on_trash`, as `expense_bank_links.on_trash` relies on too. A settle
    that locks the same row either waits for this delete or makes it fail fast.
    """
    refusal = delete_while_settled_refusal(doc.name, list_expense_lines(doc.doctype, doc.name))
    if refusal:
        frappe.throw(refusal, title="A bank line is linked")


def after_rename(doc, method=None, old=None, new=None, merge=False):
    """Point every match record naming `old` at `new` -- Reversed ones too, as Frappe's own rename of
    the Dynamic Link did. Without it a renamed record's live match records name nothing: the delete
    refusal and the expense rules would read zero lines.

    ⚠️ RAW UPDATE, NO HOOKS, AND THAT IS CORRECT: the only hook on a match record is its `validate`,
    which freezes `target_name` once written -- a rename is exactly the change it must not refuse.
    Nothing is derived from the name, so there is nothing to recompute. Runs inside the rename's own
    transaction.
    """
    frappe.db.sql(
        """UPDATE "tabOutflow Row Match" SET target_name = %s
           WHERE target_doctype = %s AND target_name = %s""",
        (new, doc.doctype, old),
    )
