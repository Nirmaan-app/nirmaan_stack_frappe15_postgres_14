# "Expense Request" — top-bar action on /project-payments

Owner ask, 15 Sep 2026: a right-side action button named **Expense Request** in the top bar of
`/project-payments`, opening a **dropdown** with two options — *Project Expense* and *Non-Project
Expense* — each opening that ledger's existing creation dialog.

Every claim below is from a read of the actual files (7 parallel investigators, adversarially
verified). File:line cited throughout.

---

## 1. What we're building

One new `else if` branch in the shared header-action helper, rendering a `DropdownMenu` with two
items that flip the two existing zustand flags — **plus** mounting the two existing creation
dialogs on the payments page, because nothing there listens to those flags today.

## 2. Where it goes

`frontend/src/components/helpers/renderRightActionButton.tsx`.

- It already imports **both** toggles: `toggleNewProjectExpenseDialog`,
  `toggleNewNonProjectExpenseDialog` (`:55`).
- It already has the exact dropdown pattern to copy — "Add New PR" → Normal / Custom (`:77-93`).
- `/project-payments` currently renders **nothing** in that slot: it falls through to the final
  `else`, which needs `projectData` the index route has no way to supply (`:186-194`). **The slot
  is free.**
- ⚠️ The match is an **exact string compare**, so `/project-payments/:id` (the payment-summary
  detail route) will NOT match and correctly shows no button.
- ⚠️ This helper is invoked as a **plain function** inside `MainLayout`, not as a component — any
  hook added here becomes a MainLayout hook. The branch must use only what is already destructured
  at the top. Do not add `useState` here.

## 3. The chooser — dropdown, decided

`DropdownMenu` / `DropdownMenuTrigger` / `DropdownMenuContent` / `DropdownMenuItem`, mirroring
`:77-93` verbatim.

Two reasons it beats a modal, both evidenced:
- It is this file's own idiom for "one button, two creation targets" (the PR split).
- ⚠️ **Both creation dialogs are `AlertDialog`.** A modal chooser would be one Radix modal opening
  another; a dropdown closes on select and leaves a single modal on screen. Avoids the whole
  focus / `pointer-events` class of problem.

```
Expense Request  ▾
  ├─ Project Expense       → toggleNewProjectExpenseDialog()
  └─ Non-Project Expense   → toggleNewNonProjectExpenseDialog()
```

Use `CirclePlus` + `className="sm:mr-4 mr-2"` to match every other button in the file.

## 4. Wiring the dialogs — THE ACTUAL WORK

⚠️ **The button alone does nothing.** Each dialog is mounted only inside its own list page:

| Dialog | Mounted at | Opens on |
|---|---|---|
| `NewProjectExpenseDialog` | `ProjectExpensesList.tsx:505` | `newProjectExpenseDialog` |
| `NewNonProjectExpense` | `NonProjectExpensesPage.tsx:522` | `newNonProjectExpenseDialog` |

Neither renders a trigger; both are bare controlled `AlertDialog`s driven by the store. Flipping a
flag from `/project-payments` with nothing mounted = a button that looks wired and silently does
nothing.

**So mount both in `RenderProjectPaymentsComponent.tsx`.** Notes that make this safe:

- **Props differ and are not interchangeable** — `NewProjectExpenseDialog({ projectId?, onSuccess? })`
  vs `NewNonProjectExpense({ refetchList? })`. They may point at the same function, but one generic
  prop cannot be threaded.
- **Omit `projectId`.** With it absent the dialog renders its own `ProjectSelect`
  (`NewProjectExpenseDialog.tsx:362-370`) and `projects` is hard-required. `RenderProjectPaymentsComponent`
  has no project in scope at all, so the picker is the only path — and no new picker is needed.
- **Both self-reset on every open** (`NewNonProjectExpense.tsx:329-347`, `NewProjectExpenseDialog.tsx:318-327`),
  so one permanently-mounted instance behind the flag is correct. No unmount/remount.

## 5. Refresh after create

⚠️ `RenderProjectPaymentsComponent` **owns no refetch handle today** — its ledger lists are
`React.lazy` children with their own fetches, and the only fetch it owns is the counts call keyed
`"approval-queue-counts"`.

Three things go stale on create:

| Stale | How to refresh |
|---|---|
| Tab badges | `mutate("approval-queue-counts")` via `useSWRConfig` |
| The queue table | child-owned; needs a `mutate` by SWR key or a lifted handle |
| Payment Summary card | check its existing `useFrappeDocTypeEventListener` registrations first |

Simplest correct first cut: `useSWRConfig().mutate(...)` for the counts key, and verify whether the
card already listens for the two expense doctypes before adding anything.

## 6. Permissions

**No role gate**, matching the existing precedent exactly: the two expense buttons at
`renderRightActionButton.tsx:150-165` carry an explicit comment that there is no role gate, and
neither dialog contains any role check. `/project-payments` and `/expense/*` both have **no route
guard** (`routesConfig.tsx:590-596`, `:368-375`) — access is sidebar visibility only, and the server
permission is the real boundary (every profile in the payments sidebar array has `create=1` on both
doctypes).

⚠️ **One genuine capability grant:** *Nirmaan Project Lead Profile* sees `/project-payments` but has
**no Expense sidebar entry** (`NewSidebar.tsx:551` vs `:569`) — today they have no route to either
dialog. This button gives them one. That is a product decision, not a side effect. Flag it.

Unaffected: *HR Executive* sees Expense but not payments. Do **not** derive the audience from
`PP_PROJECT_ROLES` — it lists Project Manager, who is not in the payments sidebar gate at all.

## 7. Traps

⚠️ **The ₹15,000 cap makes the button nearly pointless for Project Expense.**
`NewProjectExpenseDialog.tsx:62` `AMOUNT_LIMIT = 15000`, exempt only when the expense type's label
or docname contains "accommodation" (`:70-79`). The backend auto-approves **below** 15,000
(`approval_tiers.py` `TIER_AUTO_APPROVE_BELOW = 15000.0`). So every non-Accommodation project
expense creatable here is **auto-approved on save** except one priced at exactly ₹15,000 — a button
called "Expense **Request**" that almost never produces a request. **Decide: raise the cap, or name
the button honestly.**

⚠️ **CEO Hold blocks the Project arm — at submit, not at open.** `NewProjectExpenseDialog.tsx:101,232-233`.
With no project in scope the user picks the project *inside* the dialog, so they fill the entire
form before a toast refuses it. (Non-Project has no such guard and correctly so — no project.)
*This corrects a standing note that claimed the guard had been removed.*

⚠️ **Submit label vs reality.** Both dialogs label the button from `utils/expenseApproval.ts`, whose
threshold is **10,000 inclusive** — stale against the 15,000 backend rule. Between ₹10,000 and
₹14,999.99 the button says "Send for Approval" and then toasts "Auto-approved" in the same click.
One-import fix to `approvalTiers.ts`, but it is a behaviour change to a shared util.

⚠️ **Two extra `Expense Type` list fetches** (`limit 100000` each, one per dialog) fire on every
`/project-payments` render once both are mounted — not on click. Consider mounting lazily behind
the flag if that shows up.

⚠️ **First open is slow.** The Project dialog fetches Vendors unbounded (`limit: 0`) and replaces
*both* footer buttons with a spinner while loading — no Cancel. `/project-payments` has no vendor
list in cache.

⚠️ **`ProjectSelect universal` auto-seeds from `sessionStorage['selectedProject']`** and fires
`onChange` on mount; there is a possible ordering hazard with the dialog's own reset effect
(child effect runs first, parent then clears `projects` while the select still displays one).
**Verify in the browser:** open with a session project set and submit without touching the picker.

⚠️ `isNaN(amountValue)` is **dead** (`parseNumber` never returns NaN), so ₹0 and negatives pass
client validation and reach the server, which bands them by size.

## 8. Open decisions

1. **The ₹15,000 cap** — raise it, or rename the button? *Recommend:* raise/remove the cap for this
   entry point, otherwise the feature mostly creates already-Approved rows.
2. **Project Lead gains expense creation** — intended? *Recommend:* yes if the point is to give
   payment-facing roles one place to raise spend; say so explicitly.
3. **Fix the stale submit label** now or separately? *Recommend:* separately — it is a shared util
   and touches both existing expense pages.

## 9. Steps

1. Add the `/project-payments` branch to `renderRightActionButton.tsx`, copying the PR dropdown
   shape. Button label "Expense Request".
2. Mount `<NewProjectExpenseDialog onSuccess={…} />` (no `projectId`) and
   `<NewNonProjectExpense refetchList={…} />` in `RenderProjectPaymentsComponent.tsx`.
3. Wire refresh: `mutate("approval-queue-counts")` + the queue list.
4. Browser check: both arms open, create one of each, confirm the row appears in the right tab and
   the badge moves.
5. Browser check the `ProjectSelect` session-seed hazard (step 7).
6. Decide the cap question before calling it done.
