"""List fields that are not columns of the list's doctype: asked for by name in `fields`, filled in after the page
is read, and filtered by through a `name in` narrowing (ADR-0046).

Only a caller that names one gets it; every other read of the doctype is unchanged. Today: the Bill check of an
Expense on the Project Expenses and Non-Project Expenses lists (#1640, `services/expense_bills/bill_list.py`).
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.api.data_table.constants import NOT_SET_FACET_VALUE as NOT_SET
from nirmaan_stack.services.expense_bills import bill_list

#: doctype -> the virtual fields it has.
VIRTUAL_FIELDS: dict[str, frozenset[str]] = {
    doctype: frozenset(bill_list.LIST_FIELD_SQL) for doctype in bill_list.EXPENSE_DOCTYPES
}


def split_virtual_fields(doctype: str, fields: list[str]) -> tuple[list[str], list[str]]:
    """(the fields the doctype's query reads, the virtual fields asked for)."""
    virtual = VIRTUAL_FIELDS.get(doctype, frozenset())
    return [f for f in fields if f not in virtual], [f for f in fields if f in virtual]


def fill_virtual_fields(doctype: str, rows: list[dict], asked: list[str]) -> None:
    """Set each asked-for virtual field on each row (None where the row has no value)."""
    if not asked or not rows:
        return
    values = bill_list.latest_bill_checks(doctype, [r["name"] for r in rows])
    for row in rows:
        found = values.get(row["name"], {})
        for field in asked:
            row[field] = found.get(field)


#: A `name` value no row has: the narrowing of a virtual filter that matches nothing.
_NO_MATCH = "NoMatchFound_Virtual_Filter"


def virtual_filter(doctype: str, field: str, operator: str, value) -> list | None:
    """The `name` narrowing that stands for a filter on a virtual field, or None when `field` is not one.
    A virtual field takes `in` (a facet's choices, the data table's "not set" value among them for "no Expense
    bill") or `=`.

    Every narrowing lists only Expenses that hold an Expense bill: with "no Expense bill" chosen it is a `not in`
    over the ones whose latest bill shows none of the other choices, never a list of every Expense without one."""
    if field not in VIRTUAL_FIELDS.get(doctype, frozenset()):
        return None
    if operator == "=":
        value = [value]
    elif operator != "in" or not isinstance(value, list):
        frappe.throw(_("The {0} filter takes 'in' or '=', not {1}.").format(field, operator))
    shown = [v for v in value if v != NOT_SET]
    if NOT_SET in value:
        others = bill_list.expenses_with_latest_bill(doctype, field, shown, showing=False)
        return [doctype, "name", "not in", others] if others else [doctype, "name", "is", "set"]
    names = bill_list.expenses_with_latest_bill(doctype, field, shown)
    return [doctype, "name", "in", names] if names else [doctype, "name", "=", _NO_MATCH]
