# Concurrent Edit — refusing a save made on an out-of-date copy

As-built reference for the stale-save guard (branch `feature/concurrent-edit-overwrite`, commits
`d632131de..5781700f9`, 2026-09-29). Before it, two people editing the same record meant **the
last save won**: the second save silently wrote its old copy of every field over the first
person's change. Now a screen sends the version of the record it loaded, and the server refuses
the save if the record has changed since.

⚠️ **Read "The key limitation — records with child tables" before adding this to any new
doctype.** The check watches one timestamp on the parent record. That fits small flat records and
does not fit Projects, Procurement Orders, Service Requests or Vendors.

---

## How it works

**No schema change, no migration, no new server code for plain edits.** It uses Frappe's own
optimistic-lock check:

1. The screen puts the `modified` it loaded into the save payload: `{ ...changes, modified }`.
2. Frappe's REST update (`frappe.api.v1.update_doc`) runs `doc.update(data)` then `save()`.
3. `set_user_and_timestamp` keeps the sent value as `_original_modified`.
4. `check_if_latest` takes a `SELECT ... FOR UPDATE` row lock and compares it with the stored
   `modified`. If they differ, the save is refused with **`TimestampMismatchError`** and nothing is
   written.

**Sending no `modified` keeps the old behaviour** (last save wins). So a screen that is not wired,
or a list that did not load `modified`, works exactly as before.

### The message

The server writes the words, so every screen and the bulk engines say the same thing:
`nirmaan_stack/api/last_change.py`.

- `get_stale_message(doctype, name)` — whitelisted; the screens call it after a refusal. Checks read
  permission, reads `modified_by` / `modified`.
- `stale_message(modified_by, modified)` — the builder, also used by the bulk engines.
  - another user: *"Nitesh Kumar changed this record at 29 Sep, 12:40 PM, after you opened it.
    Refresh and try again."*
  - the same user: *"You already changed this record at …, in another tab or window. Refresh and
    try again."*
  - no `modified_by`: the plain fallback, *"Someone else changed this record after you opened it.
    Refresh and try again."*
- The display name comes from Nirmaan Users, then User, then the login.

### Frontend pieces

`frontend/src/utils/frappeErrors.ts`:

| Export | Use |
|---|---|
| `staleGuard(record)` | `{ modified }` when the record has one, else `{}`. Spread into an `updateDoc` payload. |
| `isStaleRecordError(error)` | True for `TimestampMismatchError` (`exc_type` or `exception` text). |
| `staleConflictMessage(doctype, name)` | Fetches the server sentence; falls back to the plain message. |
| `writeErrorMessage(error, fallback, doctype, name)` | Toast text for a failed save: the named stale message, else `describeWriteError`. |
| `describeWriteError(error, fallback)` | Prefers the server's own `_server_messages` over the SDK's generic "There was an error." |

`frontend/src/hooks/useStaleConflict.tsx` (tests: `useStaleConflict.test.ts`):

- `useStaleConflict({ doctype, record, open, labels? })` returns `{ conflict, guard, handle }`.
  - `guard()` — spread into the save payload. Before a conflict it is `staleGuard(record)`; after
    one it carries the **latest** `modified`, so "Save again" is applied on top of the other
    person's version.
  - `handle(error, onLatest)` — on a stale refusal: fetches the message and the latest record,
    sets the banner, calls `onLatest(latest)`, returns `true` (keep the dialog open). Any other
    error returns `false` and is left to the dialog.
  - The conflict is cleared when the dialog opens/closes or the record changes.
- `describeChanges(opened, latest, labels)` — pure; one line per changed field ("Amount: 20,000 →
  45,000"). Skips system fields, `_` fields, child tables / JSON, and fields the screen never
  loaded. Attachments read "added / removed / replaced".
- `keepTyped(current, opened, latest)` — pure; each field the user left as opened takes the latest
  value, each field the user edited keeps their typing.
- `<StaleConflictBanner conflict={stale.conflict} />` — the warning banner inside the dialog.

### Server endpoints that act on what the user saw

A plain `updateDoc` gets the check for free. Endpoints that change a record through their own code
take the version explicitly as **`expected_modified`**:

| Endpoint | Behaviour |
|---|---|
| `api/payments/bulk_actions.bulk_lead_approve_payments` / `bulk_ceo_approve_payments` | `expected_modified` = `{name: modified}` JSON. Each row is checked under its row lock; a changed row is refused on its own with the named reason, the rest of the batch goes through. |
| `api/approvals/expense_actions.bulk_lead_approve_expenses` / `bulk_ceo_approve_expenses` | Same, per expense. The L1 tier (Approved vs CEO Pending) is now read from the amount **under the lock**, not from the list read before it. |
| `api/payments/project_payments.ceo_approve_payment` | `expected_modified` = the payment's version. `_lock_and_check_ceo_approvable` locks the row first, refuses a stale payment with `TimestampMismatchError`, and also refuses a project on **CEO Hold** (the plain full approve used to rely on the screen alone). |

Shared helpers in `bulk_actions.py`:
- `_parse_expected_modified` — JSON string or dict → `{name: modified}`; `{}` when not sent.
- `_is_stale(doc, expected)` — `cstr(doc.modified) != expected[name]`, the same comparison
  `check_if_latest` makes. A row absent from the map is not checked.
- `_stale_reason(doc)` — `stale_message(doc.modified_by, doc.modified)`.

**Separate concurrency fix in the same branch:** `api/tds_challan/pay_tds._apply` now locks the
selected deduction rows (`SELECT ... FOR UPDATE`, sorted by name so two payers cannot deadlock)
after the challan lock. Two people paying the same deduction against two different challans used
to take two different challan locks and both see it Pending. See `payment-tds.md` § Paying.

---

## What the user sees — one rule per kind of screen

| Screen kind | On a stale refusal |
|---|---|
| **Edit form** (dialog with fields) | The dialog stays open. `StaleConflictBanner` names who changed it and when, and lists what changed. Fields the user did not touch take the other person's values (`keepTyped`); what the user typed is kept. The button reads **"Save again"**, and that save carries the latest version. |
| **One-click action** (approve, reject, mark paid, assign, unassign) | A toast naming who changed it and when; the dialog closes and the list reloads, so the user acts on the current record. |
| **Bulk action** | A summary toast ("2 succeeded, 4 failed") and a failure list with each row's reason. Unchanged rows still go through. |

**Which fields the form fills in after a refusal (`keepTyped`):** a field the user did **not** touch
takes the other person's value; a field the user **typed in** keeps the user's value, and the banner
shows the other person's value next to its name. So when both people changed the **same** field
(e.g. both edited Amount), nothing in the form changes — the banner is where the other value shows.

**The list behind the dialog re-fetches on a refusal** (`useStaleConflict.handle`). It fires
`RECORD_CHANGED_EVENT` (every `useServerDataTable` list of that doctype re-fetches) and revalidates
every SWR cache entry whose key names the doctype (the SDK's default `useFrappeGetDoc` /
`useFrappeGetDocList` keys, `Items <id>`, `Asset Master_<id>`, …). A list with a custom key that
does not name the doctype passes `onRefresh` (the Commission tabs pass their `mutate`). A dialog
that refills its form when its record re-fetches skips that while `stale.conflict` is set, or the
refresh would wipe what the user typed.

---

## ⚠️ Known gaps — read before testing

These are real and expected. They are not caused by the check, and a tester should not report them
as failures of these commits.

### 1. Other people's tables do not update live (frappe-react-sdk bug, NOT fixed here)

The re-fetch above runs **in the browser whose save was refused only** — `RECORD_CHANGED_EVENT` is a
`window` event and never leaves that tab.

| Who | Their table after someone else's save | What updates it |
|---|---|---|
| The person whose save was **refused** | ✅ updates | the refusal's re-fetch in their own tab |
| The person whose save **succeeded** | ✅ updates | their own save's success refresh |
| **Anyone else** just viewing the list | ❌ **stays stale until reload** | would need Frappe's live `list_update` socket event — dropped by the SDK bug |

Measured in Chrome (2026-09-29, In-Flow Payments): Priyanka saved ₹19,60,003; her table showed it,
while Nitesh, only watching the same list, still showed ₹19,60,000 eight seconds later.

**Cause:** frappe-react-sdk's `useFrappeEventListener` cleans up with `socket.off(event)` **without
the handler**, which removes **every** component's handler for that event; the last component to
register is the only one still listening. `useFrappeDocTypeEventListener` also sends
`doctype_unsubscribe` when any one listener unmounts, taking the whole tab out of the doctype room.
Frappe does send the event (a second component on the same page logs it), the table just no longer
has a handler. Pre-existing, app-wide (42 files use these hooks), and **out of scope for this
branch** — the fix is a separate job (our own event hook: remove only its own handler, ref-count
the room subscription).

**Why this is still safe:** the viewer's stale table cannot cause an overwrite — if they open the
record and save, the check refuses it, and the refusal then refreshes their table.

#### How to solve (planned — a separate branch, not part of this one)

The fix is ours to make: Frappe already sends the right events; only the frontend drops them.

1. **Add one event hook of our own** — `frontend/src/hooks/useRealtimeEvent.ts`, same call
   signatures as the SDK hooks so the switch is mechanical:
   - `useRealtimeEvent(event, handler)` — registers a **stable wrapper** (it reads the latest
     `handler` from a ref) with `socket.on(event, wrapper)` and cleans up with
     `socket.off(event, wrapper)`: **removes only its own handler**, never another component's.
     The stable wrapper also stops the listener being re-registered on every render.
   - `useDoctypeListUpdates(doctype, handler)` — replaces `useFrappeDocTypeEventListener`. The
     room subscription is **reference-counted** in a module-level `Map<doctype, count>`:
     `doctype_subscribe` is sent only when the count goes 0 → 1 and `doctype_unsubscribe` only
     when it goes 1 → 0, so one component unmounting no longer pulls the whole tab out of the
     room. Re-subscribe every room with a count > 0 once on socket `reconnect`.
   - `useDocumentUpdates(doctype, name, handler)` — the same for `useFrappeDocumentEventListener`
     (`doc_subscribe` / `doc_unsubscribe`, ref-counted per `doctype/name`).
2. **Switch the callers.** 78 call sites in 42 files use the three SDK hooks. Start with
   `hooks/useServerDataTable.ts` — one change fixes every DataTable list — then the rest, which is
   an import swap per file. Also fix our own handler-less cleanup in
   `pages/projects/TDSRepository/TDSRepositoryView.tsx` (lines ~216–218: `socket.off("tds_export_…")`
   → pass the handler).
3. **Stop it coming back:** a residence / lint check that fails on a new import of
   `useFrappeEventListener` / `useFrappeDocTypeEventListener` / `useFrappeDocumentEventListener`
   from `frappe-react-sdk`, and on `socket.off("<event>")` with no handler.
4. **Before building, check whether a newer `frappe-react-sdk` (we are on 1.17.0) already fixes
   `off(event)`.** If it does, upgrading is an option, but it brings other changes and still leaves
   the room-unsubscribe problem to verify. Patching `node_modules` is not an option (lost on every
   install).
5. **Test (two or three browsers):** a viewer's table updates within a few seconds of someone else's
   save, with the page also holding a second listener for the same doctype (In-Flow Payments has
   one in `NewInflowPayment`); closing a dialog that listens does not stop the table updating; a
   socket reconnect keeps updates flowing.

Once this lands, the refusal re-fetch in `useStaleConflict` stays — it still gives the refused user
an immediate refresh even if a live event is slow or missed.

### 2. A direct database update is invisible

A write that does not move `modified` — raw SQL, `frappe.db.set_value(..., update_modified=False)`,
a data fix run in the console — is **not refused, not listed in the banner, not in the Version
history, and not pushed to open pages** (no live event is sent). Test by changing records **through
the app or Desk** (`/app/<doctype>/<name>`), never directly in the table, or the results will look
wrong. Known writers of this kind: TDS bulk linking (`api/tds/linking.py`, `Items.linked_tds_item`,
`update_modified=False`) — a user who has Edit Product open with the Linked TDS Item field can put
the old link back — and CEO Hold (`services/ceo_hold/core.py`, Projects, not covered).

#### How to solve

The rule: **a server write to a field that some screen also sends must move `modified`.** Then the
check, the banner, the Version history and live refresh all see it.
- **TDS bulk linking** — `api/tds/linking.py` lines ~311 and ~373 write `Items.linked_tds_item`
  with `update_modified=False`. Change both to the default (`update_modified=True`); the product
  then shows as changed in the TDS module too. Needs the owner's OK (it changes TDS behaviour).
- **CEO Hold** — `update_modified=False` there is a standing owner ruling (a system hold must not
  restamp the project). Leave it; it is safe while no screen sends `status` / `ceo_hold_by` back
  (the Edit Project form does not). Re-check this whenever a Projects screen starts sending them.
- **Data fixes by hand** — run them as a normal save (`doc.save()` in the console) or `set_value`
  without `update_modified=False`, never raw SQL, when users may have the record open.
- **New code** — follow root `CLAUDE.md` "Raw SQL and `frappe.db.set_value` BYPASS the document
  lifecycle"; add "does a screen send this field?" to that review.

### 3. Records with child tables

Not covered by this method — see **"⚠️ The key limitation — records with child tables"** below.

#### How to solve

Build the **scoped check** described under "What this means" in that section: the screen sends the
values it loaded for the fields / child rows it is saving; one server helper compares only those with
the database under the row lock and refuses when they differ. It sees the changes the parent version
misses (point 2 there) and gives no false alarm for unrelated changes (point 1). First user: Vendors
(4 save points), then Projects, Procurement Orders, Work Orders.

---

## Covered

### Money
- **Project Payments** — single approve / reject (`ApprovePayments.tsx`), bulk lead / CEO approve,
  CEO approve (`ceo_approve_payment`), Mark as Paid (`AccountantTabs.tsx`, per row).
- **Project Expenses, Non Project Expenses** — edit, update payment, update invoice dialogs; list
  status actions; bulk approve.
- **Project Inflows** (`EditInflowPayment`), **Non Project Inflows** (`NonProjectInflowDialog`).
- **Project Invoices** — edit dialog (`EditProjectInvoiceDialog`).

### Assets
- Asset Master edit (`AssetOverview`), Asset Category edit (`AssetCategoryView`,
  `AssetCategoriesList`).
- Assign / unassign on the asset pages and on the user profile Assets tab.
  - Assign now updates **Asset Master first**, then creates the Asset Management record. A refusal
    therefore leaves no orphan assignment, and the Asset Management `after_insert` write to the
    asset cannot move the version before the user's save.
  - The user profile reloads the asset list after assign / unassign, so the next action on the same
    asset carries the current version.

### Other masters
- **PR Tag Headers** (`PRHeaderTagMaster`), **Help Repository** edit (`EditHelpDialog`).
- **Items (Products)** — the Edit Product dialog (`pages/Items/components/EditItemDialog.tsx`),
  opened from the product page, the Products list and the TDS Repository items tab. The Products
  list query now loads `modified` (`ITEM_LIST_FIELDS_TO_FETCH`; before/after 3,537 rows, DIFF 0).
  The daily `item_status_update` job moves the version, which is a real conflict: the dialog sends
  `item_status`.
- **Package settings tabs:** Product (Category edit — the category is saved before its makes are
  changed, so a refusal leaves the makes alone), Design Tracker Category / Tasks, Commission Report
  Category / Tasks + the template editor (`SourceFormatDialog`), PMO Task Category / Master,
  Critical PO Category / Items.
  - A save that also **renames** the record skips the check (see Gotchas).
  - Task / item dialogs that filled their form once now refill it on every open, so the form and
    the version sent always belong together.

---

## Not covered, and why (owner decisions 2026-09-29)

**Reverted by the owner** — records with child tables, or not worth it now:
- User edit
- Reminder Schedule
- Expense Type (frontend and its backend)
- Work Milestones / Work Headers (the whole Milestones Packages tab)

**Not guarded by design:**
- Creates and deletes.
- Drag-reorders (they change display order only).
- Attachment-only uploads.
- Push / FCM settings.
- File re-links written right after a create.
- The Critical PO **"Link Milestones"** dialog. Its trigger has been commented out since
  `f1787eb75`. ⚠️ Its endpoint syncs the **full** link set, so it needs a guard before it is
  switched back on.

**Rejected alternative — "Plan C", a central axios interceptor** that attaches the last version the
tab saw of each record. Rejected because background refreshes (tab focus, socket updates) give the
tab a **newer** version than the data the open dialog holds. The interceptor would send that newer
version, and a real conflict would be accepted silently. The version must come from the data the
form was filled from, which only the screen knows.

---

## ⚠️ The key limitation — records with child tables

**The check watches ONE timestamp: the parent record's `modified`.** It knows nothing about which
fields or child rows changed. For a record with child tables, JSON fields or background writers,
that produces three problems.

Examples used below:
- **Projects** — child tables `drive_links`, `customer_po_details`, `project_zones`,
  `project_work_header_entries`, `project_wp_category_makes`; JSON fields such as `project_scopes`.
- **Procurement Orders** — child tables `items`, `payment_terms`, `critical_po_tasks`.

### 1. False alarms

Any change anywhere in the record moves the parent version: another tab's child-table edit, a
server `set_value` (e.g. `api/po_adjustments/_payment_utils.py` writing PO `amount_paid`), module
controls toggling Projects flags. An unrelated save on another screen is then refused.

> Nitesh edits a project's drive links while Priyanka adds a Customer PO row. Priyanka saves first;
> Nitesh's save is refused, although the two edits never touched the same data.

### 2. Blind spots

Server code that changes child rows or fields **without moving the parent version** is invisible
to the check:
- Critical PO task links are inserted / deleted directly as PO child rows; the PO is never saved
  and its `modified` does not move (root `CLAUDE.md` → Domain Gotchas).
- The `invoice_qty` recompute on PO item rows.
- `services/ceo_hold/core.py` writes with `update_modified=False` (standing owner rule).

This is safe only while no screen sends those same fields or tables back in a save.

### 3. Whole-table replace

When a save sends a child table, Frappe **replaces the whole table**: a row missing from the sent
list is deleted. The check catches this only because the parent version moved. If the other change
came through a path that does not move it (point 2), those rows are lost silently.

### What this means

- **This method is NOT applied to big multi-part records:** Projects, Procurement Orders, Service
  Requests / Work Orders, Vendors.
- They need a **scoped check**: compare only the fields and child rows the save sends against the
  database (for example, the `payment_terms` rows the dialog started from), and refuse only when
  those differ. **Not built yet.**
- **Small records without child tables are a good fit.** All the money records and masters above
  qualify, and none of them has hidden background writes (checked: no `set_value` / `db_set` / raw
  `UPDATE` outside patches).

---

## Adding the guard to a new screen

First check the record against the limitation above: no child tables the screen sends, no
background writer that skips `modified`.

1. **The list or query must load `modified`.** Add it to `fields`. Without it `staleGuard` sends
   nothing and the save is unguarded.
2. **One line in the save payload:** `...staleGuard(record)` (or `...stale.guard()` with the hook).
3. **On error:** for a one-click action, `writeErrorMessage(...)` in the toast, and on
   `isStaleRecordError` close and reload. For an edit form, the banner is optional:

   ```tsx
   const stale = useStaleConflict({ doctype, record, open });
   await updateDoc(doctype, record.name, { ...changes, ...stale.guard() });
   if (await stale.handle(error, latest => setForm(f => keepTyped(f, formFrom(record), formFrom(latest))))) return;
   <StaleConflictBanner conflict={stale.conflict} />
   ```

   `formFrom(record)` is the pure record-to-form mapping the dialog already uses to fill itself.
4. **A custom endpoint** that changes the record takes `expected_modified`, locks the row, and uses
   `_is_stale` / `_stale_reason` from `bulk_actions.py`. Not sent = no check.

---

## Gotchas

- **A rename skips the guard.** `rename_doc` / `update_document_title` can move the version, so a
  save that also renames sends no `modified` (`...(nameChanged ? {} : stale.guard())`).
- **A handler that writes the same record twice** must send the version returned by the first
  write on the second one. Sending the loaded version again refuses the user's own second write.
- **Asset Management `after_insert` bumps Asset Master.** Creating an assignment writes to the
  asset. Hence the assign order (asset first) and the user-profile reload after assign / unassign.
- **`frappe.db.set_value(..., update_modified=False)` is invisible.** The version does not move, so
  the check cannot see that write.
- **A dialog that refills its form from its record** (an effect on `[open, record]`) must return
  early while `stale.conflict` is set — the refusal re-fetches the record, and the refill would
  wipe what the user typed.
- **`describeChanges` only reports fields the screen loaded.** A list query that fetched a few
  columns shows only those in the banner; child tables and JSON are never listed.

---

## Behaviour changes users may notice without a conflict

- Error toasts show the server's actual reason instead of a generic one (`describeWriteError`).
- Four expense AlertDialogs stay open on an error instead of closing.
- Assign asset: Asset Master is updated before the Asset Management record is created.
- Product category: the category is saved before its makes are changed.
- Task / item dialogs in the package settings tabs refill their form each time they open.
- Commission mutations no longer report an expected stale refusal to Sentry.

---

## Testing

- **Frontend:** 4,539 unit tests pass, including `useStaleConflict.test.ts` (`describeChanges`,
  `keepTyped`).
- **Server (rolled back, localhost):** for every covered doctype — a save with the loaded version
  passes; a save after someone else saved is refused; a save without a version works as before.
  Bulk with a mixed batch: the fresh row is processed, the stale row is refused and left untouched.
  CEO approve checked the same way.
- **Residence check:** adds 0 violations (F5 117 / F2 219, identical on HEAD).
- **Browser, money screens (2026-09-29):** edit banner, approve toast, bulk "2 succeeded, 4 failed"
  — all as described above.
- **Browser, 2026-09-29, two real sessions (Nitesh / Priyanka):**
  - Help, PR tags, Design task, Products: refused with the banner naming Priyanka and the changed
    field; untouched fields filled in; typed fields kept; "Save again" saved both changes; a
    normal save with no conflict went through with no banner.
  - In-Flow: refused save keeps the typed amount; the table behind the dialog re-fetches to the
    other person's value; "Save again" saves and the table follows.
  - Design task (SWR list): the row behind the dialog shows the other person's change; the typed
    offset is kept.
  - Known gap 1 reproduced (a third viewer's table stays stale).
- **Not yet clicked through in a browser:** Commission, PMO, Critical PO, Product Packages
  category, Assets (edit, assign / unassign), Invoices, Non Project Inflows. Server tests cover
  them.
- **Found while testing, pre-existing, not fixed:** the Help edit dialog opens with empty fields
  (it fills itself in `handleOpenChange`, which does not run when the parent opens it); a Help
  article's title cannot be changed (the record is named after its title).

To reproduce a conflict by hand: open the record in two windows (two logins for the "Name changed
this record" text, one login for the "another tab or window" text), save in one, then save in the
other.
