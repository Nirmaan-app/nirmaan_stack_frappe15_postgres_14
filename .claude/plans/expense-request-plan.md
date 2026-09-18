# Expense Request — Plan (v3)

**Status:** design; nothing built. Supersedes v1 and v2 (both discarded).

**Owner ask.** Project Managers cannot record expenses, and letting them write directly to
the ledgers is unacceptable because nobody verifies it. They raise a **request** instead; a
senior reviews it; approval **converts** it into a `Project Expenses` or
`Non Project Expenses` row. Each Expense Type carries its own **JSON form format**, exactly
the way a Commission Report Task carries `source_format`.

---

## 0. Current state

Source from earlier attempts was discarded twice; **the database was never rolled back.**

| Thing | State |
|---|---|
| All prior source | **gone** (only stale `__pycache__` remains) |
| `Expense Request` DocType + table (11 columns) | **live in the DB**, 0 rows |
| `Expense Request Template Snapshot` + table | **live in the DB**, 0 rows |
| `Expense Type.source_format` column | **live in the DB** |
| `Expense Type` rows | **40** in the DB, **38** in the fixture |

So the DB already carries most of this schema with no code owning it. Step 1 re-creates the
source to match, adjusts it to the v3 field list, and brings the fixture back to 40. Nothing
needs dropping except columns v3 removes.

---

## 1. The two JSON fields — the Commission Packages pattern

| Doctype | Field | Holds |
|---|---|---|
| `Expense Type` | `source_format` (Long Text) | **the FORM SHAPE** for that type |
| `Expense Request` | `source_data` (Long Text) | **the ANSWERS** the requester gave |

Identical in role to `Commission Report Tasks.source_format` →
`Commission Report Task Child Table.response_data`.

**Naming:** `source_format` matches Commission exactly. For the answers side, v3 uses
`source_data` rather than Commission's `response_data`, because the owner's word for it was
"source" — flag if you'd rather stay literally parallel with Commission.

**One format can serve many types.** Commission's `common-template-1` serves 5 task masters;
point all four accommodation types at one JSON here. Authoring 40 formats is not required —
2 or 3 shapes cover everything.

---

## 2. `Expense Request` fields

The owner named five: **amount · project · description · comment · source (json)**. Those
five are the *content*. Six more carry the workflow, and each is listed with what breaks
without it.

| # | field | type | why it exists |
|---|---|---|---|
| 1 | `type` | Link → Expense Type | **selects the format and the reviewer.** Without it there is no form to render and nobody to route to |
| 2 | `projects` | Link → Projects | the owner's "project" — and it also **derives the kind** (§3) |
| 3 | `amount` | Currency | |
| 4 | `description` | Text | |
| 5 | `comment` | Small Text | |
| 6 | `source_data` | Long Text | the filled format answers, JSON |
| 7 | `status` | Select | `Pending Approval` / `Approved` / `Rejected` — the workflow itself |
| 8 | `reviewed_by` | Link → User | who decided |
| 9 | `reviewed_on` | Datetime | when. **Not** `modified`, which any later edit bumps |
| 10 | `review_comment` | Small Text | why it was rejected — the only thing the requester gets back |
| 11 | `created_expense` | Data, `search_index` | which ledger row it became |

### Fields 3–5 are deliberately the ledger's own names

`Project Expenses` and `Non Project Expenses` both carry **`description` (Text)** and
**`comment` (Data)** beside `amount` and `type`. Naming the request's fields identically
makes the conversion a straight field-for-field copy with no mapping table — and it is why
`description` and `comment` are real columns here rather than JSON keys, reversing the
earlier trim.

**Everything else the requester types goes in `source_data`** — hotel name, dates,
occupants, bank details. Those never become columns.

> **The rule:** a field exists if the SYSTEM reads it — to filter, sort, permission-check,
> drive a hook, or copy onto the ledger. If only a human reads it, it lives in the JSON.

### Two open calls

- **Is `comment` the requester's or the reviewer's?** v3 treats it as the **requester's**,
  mirroring the ledger, with `review_comment` separate for the decision. If you meant the
  reviewer's, say so and field 10 disappears.
- **Attachments.** No attachment column. The bill rides the format as an attachment slot
  (§5). If you want it as a first-class field instead, that is a 12th field.
- **Audit trio (8–10)** can be cut to a single `review_comment` if who/when does not matter.
  You would lose the ability to answer "who approved this".

---

## 3. `expense_kind` is DERIVED, not stored

v2 had an `expense_kind` field. v3 drops it: **`projects` set ⇒ Project expense; blank ⇒
Non-Project.** That one value already answers the question, and it is validated against the
type's own `project` / `non_project` flags, so a non-project-only type carrying a project is
refused rather than silently mis-filed.

This works for 39 of 40 types outright. `Petty Cash` is flagged both ways and is the only
ambiguous one — and there, whether the requester picked a project *is* the answer.

---

## 4. Workflow

```
   PM fills form ── Submit
            │
            ▼
   ┌──────────────────┐
   │ Pending Approval │   requester may edit or withdraw
   └────────┬─────────┘
            │  visible to the type's reviewer (+ Admin)
    ┌───────┴────────┐
    ▼                ▼
 Approve          Reject (review_comment required)
    │                │
    ▼                ▼
┌──────────┐    ┌──────────┐
│ Approved │    │ Rejected │  terminal
└────┬─────┘    └──────────┘
     │ creates EXACTLY ONE row, chosen by whether `projects` is set
     ▼
 Project Expenses  ─or─  Non Project Expenses      status = "Approved"
     │
     ▼
 Accountant → Mark as Paid    (existing flow, untouched)
```

**Why the created row is `Approved`, not `Requested`:** measured on live data, 99.7% of
Project Expenses and 98.9% of Non-Project are `Paid`, and **all 8 rows currently sitting at
`Requested` are stranded**, the oldest for weeks. `Approve` on the ledgers is also
Admin-only, so landing at `Requested` would demand a *second* approval from a *different*
person. The senior's decision is the approval.

**The reviewer gate runs server-side.** The rest of the expense module gates in the UI only;
that is not sufficient when the whole purpose is stopping a PM approving their own request.

---

## 5. Conversion — request → ledger row

| Request | → | Ledger row |
|---|---|---|
| `type` | → | `type` |
| `amount` | → | `amount` (cast per target — see §8) |
| `description` | → | `description` **+ the flattened `source_data`** |
| `comment` | → | `comment` |
| `projects` | → | `projects` (Project only; the non-project ledger has no such field) |
| `source_data` attachment slot | → | `invoice_attachment` |
| — | → | `status = "Approved"` |

**Flatten rule.** The JSON answers are walked deterministically and appended to
`description` as `Label: value · Label: value`, ending with the request id:

> `PG rent Aug · Occupant: Wasim Alam · Property: Sri Krishna Gents PG · Period: 01-Aug → 31-Aug [EXR-26-00012]`

The request id is load-bearing: `Non Project Expenses` has **no vendor column and no request
column**, so without it the ledger row loses all trace of who asked. `created_expense` only
points forwards.

**Attachment mapping is DECLARED, not conventional.** A format's attachment slot may carry
`"maps_to": "invoice_attachment"`; that slot's first file becomes the ledger row's
attachment. At most one slot per format may declare it — two would make the winner a coin
toss. A format declaring none carries no file, which is honest.

---

## 6. No format → degrade, never refuse

| `source_format` | The requester gets |
|---|---|
| empty (all 40 types today) | the five native fields only — a perfectly usable request |
| present | those five **plus** the format's fields |

Commission hides the Fill button when a template is unauthored (`is_active=0`). **That is
wrong here** — a PM must be able to raise a hotel bill whether or not anyone has authored a
hotel format. Because `description` and `comment` are real fields again, a format-less type
needs no default template at all; v2's built-in default format is **dropped**.

---

## 7. Authoring — the Commission Packages equivalent

Commission's pattern, to be mirrored:

| Commission | Expense |
|---|---|
| `CommissionPackagesMaster.tsx` (929 lines) — settings tab listing task masters | an **Expense Formats** settings surface listing all Expense Types |
| `SourceFormatDialog.tsx` (288 lines) — per-row JSON editor | the same dialog, per Expense Type |
| `parseTemplate()` in `report-wizard/template-parser.ts` | **reused as-is** — already generic |

The dialog's behaviour is worth copying exactly: a textarea, a **Validate** button, a
**Format JSON** button, inline error list, and a hard refusal to save an invalid template.
That last part is what keeps a broken format from reaching a requester.

**Snapshot.** `Expense Request Template Snapshot` (already in the DB) freezes the format a
request was filled against, so editing a type's format never changes how an old request
reads. Commission does the same. Keep it unless you want formats to mutate historical
requests — say so and it goes.

---

## 8. Facts verified against the running system

Carried forward so they are not rediscovered.

- **Creating the ledger row at `Approved` is safe.** Both `project_expenses.py:22` and
  `non_project_expenses.py:22` guard `if self.status and self.status != "Requested": return`,
  so an explicit `Approved` short-circuits the ₹5,000 auto-approve.
- **`amount` is typed differently per ledger** — `Data` on Project, `Currency` on
  Non-Project. `services/outflow_import/settle.format_amount_for(doctype, Decimal)` already
  owns that split; do not cast inline.
- **A Role Profile is NOT a Frappe Role.** `Nirmaan Admin Profile` as a *Role* is assigned to
  nobody, while the *Profile* grants `Nirmaan Project Manager`. Gate on
  `Nirmaan Users.role_profile`, as the rest of the app does.
- **`frappe.get_all` bypasses permissions** (`get_list` with `ignore_permissions=True`); the
  data table reads through `reportview.execute`, which **does** apply
  `permission_query_conditions` — that is the right scoping seam.
- **`create_user_profile` fires on User `after_insert`** and creates the `Nirmaan Users` row
  itself; a test fixture that inserts one hits a PK collision.
- **`Nirmaan Users` rows are named by email**, despite the vestigial `EMP-.####` autoname.
- **A doctype JSON must carry a top-level `"name"` key** or migrate dies with `KeyError`.
- **Dropping a field does not drop its column**, and `frappe.db.has_column` reads a cached
  list — `information_schema` is the truth.
- **`description` is `Text` on both ledgers** (widened from `varchar(140)` in July after a
  long value hard-failed the save), so a flattened summary is safe.

---

## 9. Build order

1. **Schema** — `Expense Request` (11 fields per §2; drop `expense_kind` and
   `response_snapshot_id`→rename), `Expense Type.source_format`, fixture back to 40, clear
   stale `__pycache__`. Migrate; verify every column against `information_schema`.
2. **API** — the server-side reviewer gate, create / approve / reject / read,
   `permission_query_conditions`, tests.
3. **PM surface** — `Expense Request` as the first tab under `/expense`, the route, the
   sidebar gate for PM, the list on the standard data table, the create dialog.
4. **Reviewer surface** — Approve / Reject, gated by the resolved reviewer.
5. **Format authoring** — the Expense Formats settings surface + the validate-before-save
   dialog, reusing `parseTemplate`.
6. **Format rendering** — lift the generic renderer core out of `report-wizard/`
   (`schema.ts`, `template-parser.ts`, `FieldControl`, `FieldsSection` are already
   commission-free) and render the format's fields in the create dialog; snapshot on submit.
7. **Conversion** — the field copy + flatten composer, with a test proving a format-less
   request converts identically to a plain one.
8. **Author the formats** — Hotel & Accommodation, Travel.
9. **Notifications + docs.**

⚠️ Step 1 touches `fixtures/expense_type.json`, which is in `hooks.py` `fixtures` and
therefore **overwrites production Expense Type rows on migrate**. Add rows only; preserve
the existing 38 byte-for-byte and diff before and after.

---

## 10. Open decisions

| # | Question | Blocked? |
|---|---|---|
| 1 | The **reviewer per expense type** | no — everything routes to Admin until set |
| 2 | Is `comment` the requester's or the reviewer's? (§2) | **step 1** |
| 3 | Keep the audit trio `reviewed_by`/`reviewed_on`/`review_comment`? | **step 1** |
| 4 | Attachment: format slot, or a 12th field? | step 1 |

### Decided — 2026-08-18

- **Travel and Hotel keep `project=0`.** The proposed flip to `project=1, non_project=1`
  is **NOT happening** (owner: "keep the current one, we don't need change previous data").
  ADR 0009 stands: travel and hotel stay non-project, the Project field never shows for
  them, and those requests land in `Non Project Expenses`. No existing rows are touched and
  the Outflow (Project) facet ADR 0009 fixed is left intact.
- **`comment` is the REQUESTER's**, mirroring the ledgers; the reviewer's reason is
  `review_comment`.
- **The audit trio is KEPT** (`reviewed_by` / `reviewed_on` / `review_comment`).
- **Attachments ride the format** as a slot; no attachment column.
| 5 | Keep the snapshot doctype? | step 6 |
| 6 | Is PM the only requester, or Project Lead too? | no |


---

## 11. As built — 2026-08-18

| | |
|---|---|
| Backend | `doctype/expense_request/` · `doctype/expense_request_template_snapshot/` · `Expense Type.source_format` · `services/expense_request_catalog.py` · `api/expense_requests/{access,create,review,convert,flatten,read,masters}.py` · `hooks.py` permission hook |
| Frontend | `pages/ExpenseRequests/` (page, columns, config, 4 components, 2 format assets) · `pages/Expenses/ExpenseIndexRedirect.tsx` · `components/expense-packages.tsx` · `utils/expenseFormat.ts` · edits to ExpenseLayout / routesConfig / NewSidebar / renderRightActionButton / useDialogStore / packageSettingsTabs |
| Tests | 33 API + 13 flatten (Python) · 7 format pins (vitest) — all green, suite proven idempotent over repeated runs |

### Deviations from the plan, and why

- **Format authoring shipped EARLY** (as Packages Settings → Expense Packages) because the
  owner asked for add/edit of the Expense Type itself, not just the format. It grew into
  full master management.
- **Master writes go through admin-gated endpoints** rather than client `updateDoc`. Found
  while fixing a residence-check regression: `Expense Type` carries `write = 1` for ~15
  roles **including Project Manager**, so a raw client write would have let a requester edit
  the scope and form governing their own requests.
- **The format renderer is a compact 150-line component**, not the lifted commissioning
  renderer. It handles `fields` sections (the whole of both shipped formats) and STATES any
  unrendered section rather than dropping it silently. Adopting the full wizard renderer
  remains available and is now a smaller, separate decision.
- **The default format was dropped.** With `description` and `comment` back as real columns,
  a format-less type is already fully usable, so no built-in fallback template is needed.

### Deferred

**Notifications.** Approved/Rejected from the review endpoint and a Paid-transition hook
walking `created_expense` backwards. Bell + realtime, no push (Reminders precedent). The
requester currently learns the outcome from their own list, which is pull rather than push.

### Two traps this build hit — recorded so they are not repeated

1. **`addCleanup(..., None)` silently wiped a shipped format.** A test set `source_format`
   on a type and restored a hardcoded `None` instead of the captured original, destroying
   the Travel (Bus) format on the live site. The suite now uses a capture-and-restore helper
   (`_set_format`), and is proven idempotent across repeated runs.
2. **Dropping a doctype field does not drop its column**, and `frappe.db.has_column` reads a
   cached list that keeps reporting the column present. `information_schema` is the truth.


---

## 12. Second pass — 2026-08-18 (after the first as-built)

| Change | Why |
|---|---|
| `Expense Category` doctype + `Expense Type.expense_category` | Routing became master data; the temporary `expense_request_catalog.py` was DELETED and replaced by `expense_request_routing.py` reading the master |
| Categories created in Desk, ASSIGNED in the app | Owner ruling; the Expense Packages Edit dialog carries the select |
| One format PER expense type (5 shapes) | A staff PG, a labour dorm, a deposit, a hotel booking and a trip are different questions |
| `description` hidden when the type has a format | The format's fields ARE the description. The PAYLOAD is gated too, so a value typed before picking such a type cannot submit invisibly |
| Attachment slots actually render | The `maps_to → invoice_attachment` chain was built and tested but had no UI, and the fallback notice told the user to do something impossible |
| Notifications | approve / reject / paid — bell + realtime, no push |
| `test_fixture_completeness.py` | See below |

### ⚠️ The bug this pass found — a fixture silently destroyed live data

`bench migrate` wiped **all 40 `source_format` forms and every `expense_category`**, and
nothing errored.

`Expense Type` is in `hooks.py` `fixtures`, so every migrate re-imports each row from
`fixtures/expense_type.json` — and Frappe writes the row AS THE FILE DESCRIBES IT. Any field
the file does not carry is reset to null. Both new fields were exactly that.

It would have reached production on the first deploy: author formats, deploy, gone.

**Fix (owner chose to keep the fixture):** the fixture now carries every field, and
`Expense Category` is a fixture too so its Link cannot dangle. **After authoring a format or
re-categorising a type in the app, run `bench export-fixtures --app nirmaan_stack` and
commit** — otherwise the next migrate reverts it. That rule is inherent to keeping the
fixture, so it is written above the `hooks.py` entry where the next person will meet it.

`test_fixture_completeness.py` guards it, and was **verified by reproducing the bug** —
stripping `source_format` from the fixture turns it red with the fix command in the message.
A guard that has only ever passed proves nothing.

**A failed first attempt worth recording:** removing `Expense Type` from `hooks.py` fixtures
did NOT stop the wipe, because hooks are cached. The file edit alone was never sufficient.

### Still owed

**The three reviewer roles.** Now a single field on each `Expense Category` row in Desk —
blank means everything routes to Admin, so the routing exists but does nothing until set.
