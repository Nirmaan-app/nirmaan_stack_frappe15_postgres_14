# PR Tag Child Table — remove the header field, one row per package

Status (2026-10-14): **Step 0 and Step 1 done; Steps 2–4 wait for your approval**, about a week after the
deploy. Step 0 = the header-removal work, built and staged on branch `pr/header-remove`. Step 1 = patches `v3_0.pr_tags_one_row_per_package`
(Patch A) and `v3_0.pr_tags_add_item_packages` (Patch B), both run on localhost 2026-10-14. Sections 1–2
describe the table before the change.

## 1. What the table is

`PR Tag Child Table` is a child table with exactly one parent: `Procurement Requests.pr_tag_list`.

| Column | Type | Meaning |
|---|---|---|
| `tag_header` | Link → `PR Tag Headers` | The header the user picked (e.g. "HVAC Ducting") |
| `tag_package` | Link → `Procurement Packages` | That header's package (e.g. "HVAC System") |
| `parent`, `parenttype`, `parentfield`, `idx` | standard | The PR the row belongs to, and its order |

**How rows are written today (committed code):** the user picks headers on New PR / Custom PR, and the
frontend saves one row per picked header. The v3.0 patch did the same for old PRs.

**Why packages repeat:** 15 headers map to 14 packages. HVAC System has 4 headers (Chilled Water, Ducting,
Ancillary, VRF/DX), so a PR tagged with two HVAC headers gets two HVAC System rows.

**Who reads it today (committed code):** PR lists and approval lists (header chips + Header filter), the
Approve page header, the PR Tracker sync (`Critical PR Tags`, keyed by header + package), Critical PO linking
and vendor-quote makes (package only), the PR summary API.

## 2. Data today (localhost, 2026-10-13)

| What | Count |
|---|---|
| Rows (all on Procurement Requests) | 9,382 |
| Distinct PR + package | 5,441 |
| PRs with a package repeated | 1,329 — all HVAC System |
| Extra rows to remove | 3,941 |
| Rows with a header | 9,380 |
| Blank or unknown package / rows of deleted PRs | 0 / 0 |
| PRs with no row | 3 of 5,423 |
| Indexes | primary key only (no index on `parent`) |

## 3. Goal

1. Each PR carries each package **at most once**.
2. The table has **no header column**, and nothing reads or writes one.
3. Both are enforced on every save **and by the database**.

## 4. Order (each step needs the one before)

### Step 0 — the header-removal code goes first (required) — DONE (staged on `pr/header-remove`)

Deploy it first. It is what stops every read and write of
`tag_header`, and its save hook writes one row per package. If the field or the unique index came first,
the committed header picker would still save one row per header: two HVAC headers would hit the index and
the PR save would fail.

### Step 1 — Patch A: one row per package, header cleared (data) — DONE (`v3_0.pr_tags_one_row_per_package`)

- Per PR: keep one row per `tag_package` (the lowest `idx`), delete the rest, set `tag_header` to NULL,
  renumber `idx` 1..n in package order.
- Expected: 9,382 → 5,441 rows; 1,329 PRs touched; 0 repeats; 0 headers.
- Dry run proves: each PR's package set before = after (DIFF 0). Running it twice changes nothing.
- Raw SQL fires no hooks. Safe: nothing derives from these rows any more (the PR Tracker is computed live
  from them). PR `modified` is not touched.
- Patch B (add-only, `v3_0.pr_tags_add_item_packages`, runs after A) adds item packages that old PRs are
  missing (948 PRs gain one, 1,034 rows; none lose one). Ran on localhost 2026-10-14 (9,382 → 5,441 rows,
  then +1,034).

### Step 2 — schema (your approval needed)

| # | Change | How | Note |
|---|---|---|---|
| 2a | Remove the `tag_header` field from `PR Tag Child Table` | Desk (developer mode) edit of the doctype, which rewrites its JSON; then `bench migrate` | Frappe does NOT drop the column on migrate; the data stays until 2b. Same commit: drop `"tag_header"` from `CHILD_TABLE_ITEM_SEARCH_MAP["Procurement Requests"]["pr_tag_list"]` in `api/data_table/constants.py`, or the PR "Packages" search queries a missing column after 2b |
| 2b | Drop the column | Patch: `ALTER TABLE "tabPR Tag Child Table" DROP COLUMN IF EXISTS tag_header` | Not `bench trim-tables`: that trims every doctype. Irreversible: take a backup first |
| 2c | Unique index on (`parent`, `tag_package`) | Patch: `CREATE UNIQUE INDEX "pr_tag_child_parent_package" ON "tabPR Tag Child Table" (parent, tag_package)` | Explicit name (Frappe's default index names are schema-global on Postgres). The patch refuses, naming each PR, if any duplicate is left. Also serves as the missing `parent` index |
| 2d | `tag_package` mandatory | Same doctype edit as 2a | Optional. The hook never writes a blank package |

Kept on purpose: the field names `pr_tag_list` and `tag_package`. Renaming them means moving data and
changing every reader (Critical PO linking included) for no gain. A label-only change ("PR Tag List" →
"Procurement Packages") is optional.

### Step 3 — remove the leftovers (your approval needed)

- `PR Tag Headers` doctype (15 records): after 2a, nothing links to it. Delete the doctype in a patch (it
  drops the table) and remove its folder from the app.
- `Critical PR Tags` doctype (572 records): unused since Step 0. Delete the same way.
- Code: drop the last `tag_header` mentions: the old-row clean-up check in `services/pr_packages.py`
  (`tag_rows_signature` / `rows_are_clean`), the optional TS field in `types/NirmaanStack/ProcurementRequests.ts`,
  and `"tag_header"` in `api/data_table/constants.py` (see 2a).

### Step 4 — docs

`procurement.md`: the table holds packages only, one row each, with the unique index.

## 5. How duplicates are prevented after this

1. **On save:** the PR `validate` hook writes one row per package and collapses repeats.
2. **In the database:** the unique index refuses a second row for the same PR + package from any path
   (raw SQL, a patch, Data Import, a Desk edit).

Frappe saves a child table delete-first, then insert (`Document.update_child_table` in
`frappe/model/document.py`), so the hook's rebuild of a PR's rows never trips the index.

## 6. Risks and edge cases

| Risk | Handled by |
|---|---|
| Index or field removal before Step 0 → header picker saves duplicates → PR save fails | Order is enforced; the index patch refuses while duplicates exist |
| Old cached frontend still sends `tag_header` after 2a | Frappe drops unknown child keys on save; no error |
| Two rows with the same package in one request | Hook de-dupes before insert; the index is the backstop |
| Column drop / doctype delete cannot be undone | Backup first; run 2b and Step 3 after Step 0–2a have run for a while |
| Old header values in Version / Deleted Document history | History, left as is |
| Environments restored from a prod backup | Patches run once per site (Patch Log travels) |

## 7. Testing

- Patch A: dry run numbers above; re-run is a no-op; DIFF 0 per PR.
- After 2a + migrate: create / edit / resolve PR, custom PR, Approve page add/remove; a request that still
  sends `tag_header` saves fine.
- Index (2c): a raw duplicate insert is refused; saving an old PR (collapse) and adding an item of a new
  package both succeed.
- The PR package test suites (`services/test_pr_packages.py`, `integrations/controllers/test_procurement_request_packages.py`) updated for the removed field and re-run; PR lists, filters, search and Critical PO
  linking checked in the browser.

## 8. Decisions to confirm

| # | Question | Recommended |
|---|---|---|
| 1 | Header-removal code first | Done (staged on `pr/header-remove`) |
| 2 | Unique index on PR + package | Yes |
| 3 | When to drop the column (2b) | After Step 0–2a have run for about a week |
| 4 | Delete `PR Tag Headers` and `Critical PR Tags` doctypes | Yes, with 2b |
| 5 | Rename the table's labels only | Optional |

Who runs what: I write the patches and dry-run them; you run migrate and the patches; you stage and commit.
