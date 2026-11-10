# ADR 0046 — A list field that is no column is a virtual field of the shared list endpoint

**Status:** Accepted · 2026-11-07 (spec #1637 review) · Spec #1637, ticket #1640

The Project Expenses and Non-Project Expenses lists show each spend's Bill check and approval, which live on its
latest *Expense bill* (ADR-0045), not on the spend. Both lists read the shared data-table endpoint
(`api/data_table`, `get_list_with_count_enhanced`), which selects columns of the list's doctype.

We decided to give that endpoint **virtual fields** (`api/data_table/virtual_fields.py`): a list field that is no
column, asked for by name in `fields` like any other, filled in after the page is read (one query for the page's
rows), and filtered by a `name in` narrowing computed before the page query. Only a caller that names one pays for
it; every other read of the doctype is unchanged. Today the two virtual fields are `bill_check` and
`bill_approval` on the two Expense doctypes (`services/expense_bills/bill_list.LIST_FIELD_SQL`).

We rejected mirroring the Bill check fields onto the two Expense doctypes (the same two fields twice, written by
every path that moves a bill, and stale the moment a replaced bill is retired), and a custom list endpoint per
list (two more copies of paging, search, facets and export for one column).

The cost: a second query per page; a virtual field filters only by `in` and `=` (the facet's choices, the "not
set" value among them for "no Expense bill"), and is refused for any other operator; it cannot be sorted on. A
list that needs sorting or a range filter on such a field needs a column, and this ADR revisited.
