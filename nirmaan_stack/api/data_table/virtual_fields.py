"""List fields that are not columns of the list's doctype: asked for by name in `fields`, filled in after the page
is read, and filtered by through a `name in` narrowing.

Only a caller that names one gets it; every other read of the doctype is unchanged. Today: the Bill check of an
Expense on the Project Expenses and Non-Project Expenses lists (#1640, `services/expense_bills/bill_list.py`).
"""

from __future__ import annotations

from nirmaan_stack.services.expense_bills import bill_list

#: doctype -> the virtual fields it has.
VIRTUAL_FIELDS: dict[str, frozenset[str]] = {
    doctype: frozenset(bill_list.SHOWN) for doctype in bill_list.EXPENSE_DOCTYPES
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
    A virtual field takes `in` (a facet's choices) or `=`."""
    if field not in VIRTUAL_FIELDS.get(doctype, frozenset()):
        return None
    if operator == "=":
        value = [value]
    elif operator != "in" or not isinstance(value, list):
        raise ValueError(f"The {field} filter takes 'in' or '=', not {operator!r}.")
    names = bill_list.expenses_whose_latest_bill(doctype, field, value)
    return [doctype, "name", "in", names] if names else [doctype, "name", "=", _NO_MATCH]
