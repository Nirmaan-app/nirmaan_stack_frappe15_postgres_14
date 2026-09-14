# Non-Project Inflows

Money the company receives that belongs to **no project and no customer** — interest, FD closures,
loan drawdowns, and (until they get their own workflow) vendor refunds and returned labour advances.
Decision record: `docs/adr/0016-bank-statement-import-creates-inflows.md` **Amendment A**. Glossary:
root `CONTEXT.md` § Inflows. Built in #1265 (doctype + page); the import wiring, dashboard figure and
tab split are separate slices of #1263 (`frontend/.claude/plans/non-project-inflows-plan.md`).

## Doctype `Non Project Inflows`

| Field | Type | Notes |
|---|---|---|
| `inflow_type` | Select | `Interest Payouts` / `FD Closures` / `Loan Received` / `Others`. **Options start with a blank line on purpose** — without it Frappe fills a *missing* type with the first option and books an unknown receipt as Interest Payouts. |
| `description` | Text | Required when the type is `Others`. |
| `utr` | Text | Copied from Project Inflows' *Inflow Details* section. |
| `inflow_attachment` | Attach | 〃 |
| `amount` | Currency | 〃 — always positive. |
| `payment_date` | Date | 〃 |

- **No project, customer, invoice or status.** It counts the moment it is saved. No project,
  customer, CEO Hold or Reports "Inflow Report" figure reads this table.
- Autoname `NPI-.YY.-.#####`; `track_changes: 1` (the owner's control over edits — every change lands
  in `Version`).
- `validate` (doctype `.py`): `amount > 0`; type must be one of the four; description required for
  Others. Tests: `doctype/non_project_inflows/test_non_project_inflows.py`.

## Access

| Profile | Roles it carries | Can |
|---|---|---|
| Admin | System Manager + Nirmaan Accountant + … | everything incl. delete |
| Accountant Lead | Nirmaan Accountant + Nirmaan Accountant Lead | create + edit |
| Accountant | Nirmaan Accountant | create only |
| Sales (Exec/Lead), everyone else | — | nothing (list API 403) |

**Enforcement is two layers, and the second one is load-bearing.**

1. Doctype role rows: System Manager = all; Nirmaan Accountant = read/create; Nirmaan Accountant
   Lead = read/create/write.
2. ⚠️ **A per-PROFILE narrowing**, because role rows cannot say "Admin only": `System Manager` — the
   only deleting role — also rides on the PMO, Project Lead, Estimates, HR and Design Lead profiles
   (verified on localhost and in `fixtures/role_profile.json`). Without layer 2 all of them could
   read, edit and delete through the REST API. `hooks.py` wires `has_permission` (doc-level: read,
   create, write, delete — a hook can only DENY) and `permission_query_conditions` (empties the list)
   to `integrations/controllers/non_project_inflows.py`, which reads
   `services/role_profiles.NON_PROJECT_INFLOWS_{READ,WRITE,DELETE}_PROFILES`. Live-checked: a PMO
   user gets an empty list and 403 on get / create / put / delete.

The frontend mirrors the same three sets in `frontend/src/constants/roles.ts`
(`NON_PROJECT_INFLOWS_ACCESS` / `_EDIT` / `_DELETE`) via `pages/non-project-inflows/nonProjectInflowModel.ts`
(Add button, row menu) and directly (route guard, sidebar item). Change a set on both sides together.

⚠️ Server-side code that creates these records for another user (the bank-statement import slice)
must either run as a permitted profile or use `ignore_permissions` deliberately — the profile gate
applies to every document-level check.

## Receipt upload — the loose-File adoption (load-bearing)

Frappe's `upload_file` checks **write** on the target doctype even for a record that does not exist
yet, and an Accountant holds **create only**. So the add/edit dialog uploads the receipt with **no
doctype** (a loose private File), then saves the record with its URL. The `on_update` hook
`integrations/controllers/non_project_inflows.adopt_receipt_file` then claims that File
(`attached_to_doctype/name/field`). Frappe's own `attach_files_to_document` would do this, but it only
handles `/files` / `/private/files` URLs and **skips the GCP attachment app's `/api/method/...` URLs**,
which every real receipt on this site has. Only an unlinked File is claimed (a File belongs to one
document). Do not "tidy" the dialog back to a doctype-bound upload — Accountants would be refused.

Autofill of amount / reference / date uses `api/payment_autofill.extract_payment_fields`, the same as
In-Flow Payments.

## Page `/non-project-inflows`

`frontend/src/pages/non-project-inflows/`: list (payment date, type facet, description, UTR, amount,
proof), sum aggregate, `InflowSummaryCard` reused with a `title` prop, CSV export; one parametric
`NonProjectInflowDialog` for add and edit. Sidebar item sits directly under In-Flow Payments.

## Accepted risks (Amendment A)

- **AR1** a vendor refund booked as Others reduces no PO / vendor paid amount.
- **AR2** old negative Non-Project Expenses still exist beside this doctype; a "total non-project
  received" figure must read both until the owner's follow-up.
- **AR3** a record the import created cannot be deleted (Frappe's link check on `Outflow Row Match`);
  correct it by editing.
