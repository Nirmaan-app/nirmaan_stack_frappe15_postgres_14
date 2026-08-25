# ADR 0016 — An Expense Request is an ask, not money

**Status:** Accepted · 2026-08-18

## Context

Project Managers had no way to record an expense — they were absent from the `/expense`
role gate entirely. Simply adding them was rejected: the two expense ledgers are *money*, a
row there flows into project financials and gets paid, and nobody would be checking what a
PM entered.

Two further facts shaped the design.

- **Every expense type wants a different set of details.** A hotel stay needs dates and an
  occupant; travel needs an origin and a destination; most types need nothing beyond a note.
  Encoding that as columns would mean a very wide table that is mostly NULL.
- **The `Requested` status on both ledgers is dead.** Measured 2026-08-17: 99.7% of Project
  Expenses and 98.9% of Non-Project are `Paid`, and **all 8 rows sitting at `Requested` were
  stranded**, the oldest for over three weeks.

## Decision

**A new `Expense Request` doctype, separate from the ledgers.** It is an *ask*: it appears
in no financial rollup and can never reach `Paid`. Approval creates the real ledger row.

1. **Per-type JSON forms.** `Expense Type.source_format` holds the form shape;
   `Expense Request.source_data` holds the answers; a content-addressed
   `Expense Request Template Snapshot` freezes the shape a request was filled against. The
   same three-tier arrangement the commissioning report uses.
2. **The template is ADDITIVE.** `type`, `projects`, `amount`, `description` and `comment`
   stay native columns — the ledger row is built from them and the data table sorts on them.
   Only the extra detail is templated.
3. **No `expense_kind` field.** The PRESENCE of `projects` decides the target ledger,
   validated against the type's own `project` / `non_project` flags.
4. **Approval creates the row at `Approved`, not `Requested`.** The senior's decision *is*
   the approval; `Approve` on the ledgers is Admin-only, so landing at `Requested` would
   demand a second approval from a different person, into a queue nothing drains.
5. **The reviewer gate is server-side.** Unlike the rest of the expense module, which gates
   in the UI only.
6. **No format means degrade, never refuse.** The commissioning system hides its Fill button
   for an unauthored template; here a PM must be able to raise a hotel bill regardless.

## Consequences

- **Neither ledger changes shape.** Approval writes a row through their existing schema.
- **The structured answers reach the accountant as prose**, flattened into `description`
  with the request id appended — `Non Project Expenses` has no vendor column and no request
  column, so without the id the row loses every trace of who asked. The full structure stays
  on the request.
- **Two copies of a value exist by design** — the answers on the request, a rendering of them
  on the ledger. The request is the record; the description is never authority.
- **Travel and Hotel stay non-project** (owner, 2026-08-18), so a PM's travel lands in
  `Non Project Expenses` and does not attribute to a project. This preserves ADR 0009.
- **A field only exists if the SYSTEM reads it.** Anything a Long Text blob holds is
  invisible to SQL, so a value earns a column only when it must drive a query, a permission
  or a hook.

## Amendment — 2026-08-18

- **Categories became master data.** The provisional Python map graduated to an
  `Expense Category` doctype with a `reviewer_role`, so changing who reviews what is an edit,
  not a deploy. Created in Desk; assigned from the app.
- **⚠️ A fixture destroyed live data, once.** `Expense Type` is a fixture, so the file — not
  the database — is authoritative, and a migrate reset every field the file did not carry.
  Adding a field to a fixture-backed doctype now REQUIRES regenerating the fixture, guarded by
  a test that was verified by reproducing the failure.
- **One format per expense type**, replacing a shared accommodation shape: a staff PG, a labour
  dorm, a deposit and a hotel booking are four different questions.
- **⚠️ AMENDED 2026-08-18 — the `description` FIELD IS GONE; `source_data` is the only home
  for the detail.** It was previously a native column hidden when the type had a format. The
  owner ruled one home: with a format `source_data` holds the answers, without one it holds
  the typed description under a synthetic `detail.description` key. The ledger description is
  composed wholly from it — values-only for a format-less request (the key is ours, not the
  requester's), labelled for a formatted one. The orphan DB column was dropped explicitly
  after migrate, guarded on zero rows carrying data.
- **Notifications shipped** (bell + realtime, no push).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Let PMs write to the ledgers directly | The whole problem — nobody verifies it. |
| Reuse `Requested` on the ledgers as the request state | Needs a second Admin approval, into a queue with a measured multi-week backlog; and the `<₹5,000` auto-approve would sanction a PM's small expense with nobody looking. |
| A column per detail field | Mostly-NULL wide table; every new expense type becomes a migration. |
| Reuse `Commission Report Template Snapshot` | Structurally identical but wrongly named for this data, and the two lifecycles are unrelated. Separate table, **shared** hash-and-upsert logic. |
| Separate doctypes per request category | The taxonomy is provisional; categories are data, not schema. |
