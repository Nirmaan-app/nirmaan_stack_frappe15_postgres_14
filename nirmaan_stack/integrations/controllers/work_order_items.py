# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Work Order's item rows (`Work Order Items`): who reads them, and that they change only with their
Work Order (spec #1528 stories 4 and 12).

* Read (walk W1): `GET /api/resource/Work Order Items?parent=Service Requests` checks only read on the
  Service Requests doctype, not each row's Work Order. `get_permission_query_conditions` scopes the list to
  the Work Orders the user may read (`controllers/nirmaan_comments.readable_work_orders_sql`). A single row's
  read already goes through its parent's permission (`frappe.permissions.has_child_permission`), so no
  `has_permission` hook is needed (Frappe would not call one for a table doctype).
* Write (review round 3 V6, round 4 X3): the REST child-row PUT and DELETE save or delete the row on its
  own, then (PUT) the parent with the edit already in its before-image, past every lock. A parent's own
  save writes and removes its rows without their hooks, so a row's own `validate` or `on_trash` runs only on
  those standalone paths, and both are refused. No app code saves or deletes a row alone; patches write rows
  by SQL.
"""

import frappe
from frappe import _

from nirmaan_stack.integrations.controllers.nirmaan_comments import readable_work_orders_sql
from nirmaan_stack.services.work_order_lifecycle import WorkOrderChangeRefused

ITEM_ROW_REFUSAL = (
    "A Work Order's item rows are saved with the Work Order, never on their own: the Work Order's own rules "
    "(the Approved scope, Finalize, amendments) must see the change."
)


def refuse_saving_an_item_row_alone(doc, method=None):
    """`validate`: a row saved on its own (the REST child-row PUT)."""
    frappe.throw(_(ITEM_ROW_REFUSAL), WorkOrderChangeRefused, title=_("Not allowed"))


def refuse_deleting_an_item_row_alone(doc, method=None):
    """`on_trash`: a row deleted on its own (the REST child-row DELETE)."""
    frappe.throw(_(ITEM_ROW_REFUSAL), WorkOrderChangeRefused, title=_("Not allowed"))


def get_permission_query_conditions(user=None, doctype=None):
    """A list holds only rows of Work Orders the user may read."""
    user = user or frappe.session.user
    if user == "Administrator":
        return ""
    readable = readable_work_orders_sql(user)
    if not readable:
        return "1=0"
    return f'"tabWork Order Items".parent IN ({readable})'
