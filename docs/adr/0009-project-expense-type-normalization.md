# Project Expenses use only project-flagged Expense Types; legacy non-project types consolidated

Project Expenses may only be categorised with Expense Types flagged `project = 1` — the create/edit dialogs already restrict the type dropdown accordingly. Six non-project-flagged types (Printing & Stationery, Staff Welfare Expenses, Hotel Expenses, Postage & Courier, Pooja Expenses, Travel Expenses (Flight)) had been recorded on ~82 legacy Project Expenses, which broke the Outflow(Project) report's Expense-Type facet — that facet lists only project-flagged types, so those rows could never be selected and the report couldn't reconcile. We normalised the data: patch `v3_0.normalize_project_expense_types` repoints those rows' `type` to the catch-all **Other Project Related Charges** (type-only raw `UPDATE`, `modified` preserved, idempotent, Non-Project Expenses untouched) — rather than broadening the facet to list every type.

## Considered Options

- **Broaden the Outflow facet to list all Expense Types (incl. non-project)** — rejected: it would surface non-project categories on a project report and leave the underlying mis-categorisation in the data.
- **Map each legacy type to a nearest project-side equivalent** — rejected: most have no faithful project equivalent, and it would mint categories for a handful of legacy rows.

## Consequences

- The six-way category distinction is permanently merged into "Other Project Related Charges" on the affected rows (no snapshot). Acceptable: they were non-project categories misapplied to project expenses.
- Residual entry path to watch: the PO-adjustment ad-hoc expense sets `type` from a user-chosen value; if that picker is not restricted to `project = 1`, it is the only remaining way a non-project type could reach a Project Expense.
