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
