# Assets — Reference

Company assets (Project tools such as meters and drills; IT devices such as laptops and tabs), who holds each one,
the holder's signed declaration, returns, the monthly audit, and every change to an asset in its history.

Users work with assets in two places:
- the Assets page (`/asset-management`, not `/assets`, which Frappe serves as static files): Project Assets / IT
  Assets tabs with sub-tabs All, Assigned, Unassigned, Pending Declaration, Return Request and Asset Audit; plus
  Categories, Departments and History;
- the holder's own profile (`/users/<id>?tab=assets`): one card per held asset with Sign declaration, Return and
  Submit audit.

The detailed rules live in the code's own docstrings, cited below; this page is the map and the owner-locked rules.

## Load-bearing invariants (owner-locked)

- **No new doctype for assets or audits.** The audit lives on fields of `Asset Management` and rows of the
  `Asset History` child table (owner, 2026-10-14). Every schema addition here was ruled field by field and is
  listed in root `CODING_STANDARDS.md` § Don't touch (the sanctioned doctype-JSON exceptions).
- **The asset history is append-only and written in one place:** `services/asset_history.add_history`.
  - `Asset History.assigned_to` / `done_by` are **Data, not Link**, so the history never blocks deleting a
    person. A rename does not follow them on its own: `services/asset_history.rename_person` (called from
    `api/users.rename_user_email`) moves them.
  - The history is a child table and access is by role profile, which DocPerms can't express, so screens read it
    through `api/assets/history.py`, never the generic list API.
- **Who sees the history:** Admin, HR Executive, HR Lead (`role_profiles.ASSET_HISTORY_PROFILES`, mirrored in
  `frontend/src/pages/Assets/utils/permissions.ts`). The audit events alone are also readable by the Asset Audit
  tab's viewers (`ASSET_AUDIT_VIEW_PROFILES`: Admin, PMO, HR Executive, HR Lead, Procurement) for its Fulfilled list.
- **Who assigns:** Admin, HR Executive, HR Lead and PMO assign and unassign every asset; Procurement only Project assets
  (`ASSET_ASSIGN_ALL_PROFILES` / `ASSET_ASSIGN_PROJECT_PROFILES`, checked by `services/asset_assign_access`). One
  holder per asset (`AssetManagement.validate`). Unassign asks a reason (`services/asset_unassign`).
- **HR Lead = HR Executive in assets** (owner, 2026-10-15): every asset permission, frontend
  (`ASSET_HR_ROLES` in `permissions.ts`, the sidebar's Assets link) and server (`ASSET_ASSIGN_ALL_PROFILES`,
  `ASSET_AUDIT_VIEW_PROFILES`). Not the Users page.
- **A project only on a Project asset, and only a Won one** (owner, 2026-10-15): `services/asset_project.check_asset_project`,
  checked by `assign_asset` before it writes and by `AssetMaster.validate` when the project changes (an asset booked
  earlier to a project no longer Won still saves). The dialogs already list only Won projects.
- **No move into an inactive department:** assigning refuses with "The X department is inactive. Report it to the
  admin." (`AssetManagement.decide_department_move`). Departments are never switched off in practice.
- **Two people at once get a plain message:** every row lock (assign, Return, Reject return, the category audit switch,
  submit audit) catches PostgreSQL's serialization failure (`asset_audit_open.is_serialization_failure`) and says
  "just changed ... Reload the page", never a database error.
- **Declarations:** every holder signs their own in the app, Admin included
  (`api/assets/declaration.sign_declaration`). No screen offers a scanned-declaration upload (owner, 2026-10-15);
  older "Declaration Uploaded" history rows stay. A declaration arriving ticks `received` and opens the month's
  audit if one is due.
- **Returns:** the holder asks (`returned`), a manager approves (the normal Unassign, which deletes the
  assignment) or rejects. The holder's Return is refused while the asset's audit is Pending; an Admin/HR
  unassign is never blocked by an audit.

### Monthly audit

- **Only assigned assets whose category has `audit_required` ticked owe an audit.** The switch is Admin only
  (`ASSET_CATEGORY_AUDIT_PROFILES`; `api/assets/audits.set_category_audit`). Ticking it opens the month's audits
  at once; unticking stops new ones and leaves open ones to be sent.
- **The 28th / 7th cycle.** From the 28th an audit belongs to the NEXT month (`services/asset_audit.cycle_month`).
  - 28th 06:00 `tasks/asset_audit.open_next_month_audits`: everyone up to date gets next month's audit.
  - 7th 06:00 `tasks/asset_audit.close_last_month_audits`: last month's unsent audits are recorded "Audit Missed"
    and move to this month; whoever sent late in the grace days gets this month's.
  - Which assignments owe an audit is decided in ONE query: `services/asset_audit_open.due_assignments` (its
    docstring lists every condition). Never add a second rule elsewhere.
- **"Already audited" is by the month an audit was FOR, not the day it was sent:** an "Audit Fulfilled" whose
  text has `for MM/YYYY` in its place (`services/asset_audit.for_month_pattern`; remarks never count).
- **No missed count is shown** (owner rejected "N missed"). Overdue = `audit_overdue_since`, the first month of an
  unbroken run of misses, cleared when an audit is sent. Never red during the grace days.
- **The questions live ONLY in the frontend:** `frontend/src/utils/assetAuditQuestions.ts`, one fixed set per
  category type (Project / IT), 4 questions each, plain wording (owner, 2026-10-15). No JSON file, no server copy,
  no questions endpoint.
  - Each answer is sent WITH its question and choice text (`[{id, q, a, flag?, text?}]`) and kept as sent, so
    rewording a question never changes an old audit.
  - The server checks the SHAPE only (`services/asset_audit.clean_answers`: 1–10 answers, id/q/a present, ≤300
    characters, no id twice, a note ≤200 characters kept only on a red answer).
  - A red (`flag`) choice opens an optional one-line note.
- **The audit never sets the asset's condition** (owner, 2026-10-15): the answers show any issue and managers read
  them. Old history rows that start with a condition (`Poor · was Good · for 11/2026`) are still read correctly.
- **Answers are stored as `{"answers": [...]}`, never a bare list** — on the assignment (latest audit, replaced
  each month, gone on unassign) and on the month's "Audit Fulfilled" history row. A bare list breaks every later
  save of the document (root `CODING_STANDARDS.md` § Writing backend Python, the JSON-field gotcha).
- **A photo is required; remarks are optional.** The photo is kept in the history row's `declaration` field
  (labelled "File").

## Doctypes

| Doctype | What it holds |
|---|---|
| **Asset Category** | `category_type` Project / IT; `audit_required` (Admin switch) |
| **Asset Master** | The asset; `current_assignee` (read-only, synced from the assignment), `department`, `asset_condition`, IT credentials (Password fields); `asset_history` child table |
| **Asset Management** | The current assignment: holder, declaration, `received`/`returned` (+ dates), and the open audit: `audit_status`, `audit_month` (`MM/YYYY`), `last_audit_on`, `audit_proof`, `audit_overdue_since`, `audit_answers` |
| **Asset History** (child of Asset Master) | One row per change: `event`, `assigned_to`, `done_by`, `done_on`, `declaration` ("File"), `from_department` / `to_department`, `reason`, `audit_answers` |

History events: Asset Added, Assigned, Declaration Signed, Declaration Uploaded, Unassigned, Department Set,
Return Requested, Return Rejected, Audit Requested, Audit Fulfilled, Audit Missed.

`audit_month` is Data `MM/YYYY`: compare it for equality or as a date (`to_date(audit_month, 'MM/YYYY')`), never in
text order.

## Backend map

| Where | What |
|---|---|
| `api/assets/assign.py` | `assign_asset`, `unassign_asset` |
| `api/assets/declaration.py` | `sign_declaration` (holder; Redis lock while the PDF renders), `read_declaration_form` (holder; the blank form, whatever the project) |
| `api/assets/returns.py` | `request_return` (holder), `approve_return`, `reject_return` |
| `api/assets/audits.py` | `submit_audit` (holder), `set_category_audit` (Admin) |
| `api/assets/history.py` | `get_asset_history` (named filters; the Fulfilled list), `get_asset_history_table` + `get_asset_history_facets` (the History tab's data table and its filter counts; share `_table_conditions`) |
| `api/assets/mine.py` | `get_my_assets`: the caller's own assets, whatever project they are booked against |
| `api/assets/projects.py` | `get_won_projects`: the Assign dialog's project picker |
| `services/asset_audit.py` | Pure audit rules: cycle month, history texts, `clean_answers`, `submit_refusal` |
| `services/asset_audit_open.py` | Opens / rolls audits: `due_assignments`, `open_due_audits`, `roll_missed_audits` |
| `services/asset_history.py` | `add_history`, `rename_person` |
| `tasks/asset_audit.py` | The 28th and 7th jobs (`hooks.py` scheduler) |
| `integrations/controllers/asset_management.py`, `asset_master.py`, `asset_category.py` | Doc events: history rows, holder sync, audits opening on a declaration or a category switch |

## Frontend map

| Where | What |
|---|---|
| `src/pages/Assets/AssetsPage.tsx`, `AssetsRoute.tsx` | The Assets page and its route guard (`canViewAssets`) |
| `src/pages/Assets/utils/permissions.ts` | Every asset permission; mirrors `services/role_profiles.py` |
| `src/pages/Assets/components/SubmitAuditDialog.tsx` | The holder's audit form (questions, photo, remarks) |
| `src/pages/Assets/components/AssetAuditList.tsx`, `AuditFulfilledList.tsx` | Asset Audit tab: Pending / Fulfilled (List and Answers views) |
| `src/pages/Assets/components/AssetHistoryList.tsx` (+ `hooks/useAssetHistoryFacets.ts`) | History tab: server data table, header filters with counts |
| `src/pages/Assets/components/AssetHistoryCard.tsx`, `AuditAnswers.tsx`, `AuditStatusRow.tsx` | The asset page's history, the answers dialog, the audit line on a card |
| `src/pages/users/components/UserAssetsTab.tsx` | The holder's profile cards |
| `src/utils/assetAuditQuestions.ts` | The audit questions (the only copy) |
| `src/utils/assetAudit.ts`, `assetHistory.ts` | Audit / history display rules (cycle mirrors `services/asset_audit.py`) |

## Tests

Backend (run each with `--module`; they hit the live localhost DB and roll back their own fixtures):
`services.test_asset_audit`, `services.test_asset_unassign`, `services.test_asset_department`,
`api.assets.test_audits`, `test_history`, `test_returns`, `test_declaration`, `test_mine`, `test_assign_access`,
`test_projects`, and the doctype tests `asset_master`, `asset_category`, `asset_management`.

Frontend (vitest, in the container): `src/utils/assetAudit.test.ts`, `assetAuditAnswers.test.ts`,
`assetHistory.test.ts`, `assetDeclaration.test.ts`, `assetDepartment.test.ts`, `assetUnassign.test.ts`,
`ownAssets.test.ts`.
