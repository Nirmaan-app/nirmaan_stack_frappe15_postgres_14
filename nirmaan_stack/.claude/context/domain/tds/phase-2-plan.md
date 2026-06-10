# TDS Repository Restructure — Phase 2 Implementation Plan

> Scope: re-enable **project consumption + approval** against the Phase 1 group
> model. All design decisions are locked in `docs/adr/0003-phase2-group-driven-
> consumption.md` (grilled 2026-06-10). Read ADR-0003, ADR-0001, ADR-0002, and
> `CONTEXT.md` first.

**Key property: Phase 2 adds NO new doctypes and NO new columns.** It repurposes
the existing `Project TDS Item List.tds_item_id` Data column to hold the frozen
**TDS Item id**, reworks the frozen project UI/approval to the group model, adds
two whitelisted APIs, one hook, and rebinds the report. Then flips
`TDS_ASSEMBLY_FROZEN=false`.

## Execution Strategy

Execute via the Plan-to-Parallel workflow (see `~/.claude/CLAUDE.md`): create
tasks with TaskCreate, set deps with TaskUpdate, launch each wave as parallel
general-purpose subagents. Every subagent prompt must include the **why**.

- **Wave 1 (parallel, no deps) — backend + cleanup:**
  - **BE-PICKER** — picker search API
  - **BE-APPROVE** — group-aware approval/promotion API (Admin-only)
  - **BE-SYNC** — `Items.on_update` member display-field sync (P2-6)
  - **BE-REPORT** — rebind `tds_report.py` + `"Project TDS Report"` print format
  - **FE-OPTIONS** — strip dead `CUS-`/legacy-make code from `useTDSItemOptions.ts`
- **Wave 2 (after BE-PICKER + BE-APPROVE) — frontend surfaces:**
  - **FE-PICKER** (deps BE-PICKER) — group+make picker in `TdsCreateForm`
  - **FE-REQUEST** (deps BE-PICKER) — `RequestTdsItemDialog` rework
  - **FE-APPROVE** (deps BE-APPROVE) — `TDSApprovalDetail` rework, Admin-only
  - **FE-EDIT** (deps BE-PICKER) — two reworked edit modals
  - **FE-HISTORY** (deps none beyond semantics) — history table + export dialog
- **Wave 3 (after Wave 2) — flip + verify:**
  - **FE-FREEZE** — set `TDS_ASSEMBLY_FROZEN=false`, remove banners/gates
  - **VERIFY** — typecheck/build inside the devcontainer; manual flow pass

---

## Backend

### BE-PICKER — picker search API (`api/tds/picker.py`, new)
- Whitelisted, perm-safe via `frappe.get_all` (the `istable` child has no DocPerm
  — same pattern as `api/tds/members.py`).
- `search_tds_items(query, work_package?)` → returns **TDS Item (group) results**.
  Fuzzy match over the TDS Item name **and** member `item`/`item_name`. A member
  hit yields its parent group; M:N → one result per parent group (server-side
  fan-out). Each result carries: `tds_item` id, name, work_package, the matched
  member (for the "contains …" subtitle), and the **list of makes that have a
  Repository Entry** for that group (`(tds_item, make)` → datasheet) so the make
  dropdown can populate without a second call.
- `get_tds_item_makes(tds_item)` (or fold into the above) → makes-with-datasheet
  for one group + their entry name + attachment + status.

### BE-APPROVE — group-aware approval/promotion (`api/tds/approve.py`, new)
- Whitelisted, **enforces Admin-only server-side** (don't trust the client gate).
- `approve_tds_items(doc_names[])`: for each `Project TDS Item List` row:
  - **Pending (picked existing entry):** find the master entry by
    `(tds_item, make)`; set its `status="Verified"`; set row `tds_status="Approved"`.
  - **New (request):** resolve/create the **TDS Item** (existing by id, or create a
    member-less group from the proposed label + WP); create/find the
    `(TDS Item, Make)` Repository Entry born `status="Verified"` with the request's
    `tds_attachment`; snapshot id/name/make/attachment back onto the row; set
    `tds_status="Approved"`.
  - Dedup key throughout = `(tds_item, make)` (matches the entry validate). Handle
    the create-race by re-reading on `DuplicateEntry`.
  - `frappe.db.commit()` after writes.
- `reject_tds_items(doc_names[], reason)`: set `tds_status="Rejected"` +
  `tds_rejection_reason`. No master writes. (Admin-only.)
- **Removes** `allocate_pcus` usage and all project-only-custom (`PCUS-`) code.

### BE-SYNC — `Items.on_update` member sync (P2-6)
- New controller hook: when an Items SKU's `item_name`/`category` changes, walk
  `TDS Items Child Table` rows with that `item` and refresh `item_name`/`category`.
  `frappe.db.commit()`. (Replaces the Phase-1-deleted hook that wrote removed TDS
  Repository columns — this one targets the member child rows.)

### BE-REPORT — report rebinding (`api/tds/tds_report.py` + print format)
- Keep the 1-page-per-row + `merge_pdfs_interleaved` structure (one row = one
  `(group, make)` = one datasheet — unchanged).
- Rebind per-row fields: Submittal Name = group name (`tds_item_name`), Make =
  `tds_make`, **Model No. = distinct member categories, comma-joined** (derive from
  the frozen `tds_item_id`'s members; fall back to the frozen `tds_category` for
  legacy rows). Everything else (Package, Submittal No., dates, watermark) unchanged.

### Schema note (no migration)
- `Project TDS Item List`: **no structural change.** `tds_item_id` (Data) now holds
  the **frozen TDS Item id**; `tds_item_name`/`tds_make`/`tds_attachment`/
  `tds_work_package` frozen at selection. Coverage **not stored**. Existing rows
  left untouched (immutable snapshots). Optional: relabel `tds_item_id` →
  "TDS Item ID".

---

## Frontend

### FE-PICKER — group+make picker (`TdsCreateForm.tsx`)
- Replace WP→Cat→Item→Make cascade with: **FuzzySearchSelect over `BE-PICKER`**
  results (group + member search) → on group pick, a **Make dropdown limited to
  makes-with-datasheet** → add a `(group, make)` row (status `Pending`). Coverage
  shown read-only if a requirement asks (live from `get_tds_item_members`).
- Dedup new selections against existing project rows on `(tds_item_id, tds_make)`.

### FE-REQUEST — request dialog (`RequestTdsItemDialog.tsx`)
- "Request new": choose **existing group** (picker) OR **new group** (label + WP);
  + make (**full Makelist, no `+ Others`**) + **required datasheet PDF** +
  optional description/BOQ → creates a `New` row. Remove custom-item / `CUS-` paths.

### FE-APPROVE — approval screen (`TDSApprovalDetail.tsx`, `TDSApprovalList.tsx`)
- `ALLOWED_APPROVER_ROLES` → **Admin-only** (drop Project Lead). Re-enable
  select/approve/reject. Replace client-side promotion (`handleApprove` writing
  removed fields) with calls to **`BE-APPROVE`**. Item-status badges keyed on
  `(tds_item_id, tds_make)`.

### FE-EDIT — two reworked editors
- `ProjectEditTDSItemModal` (picked rows): re-run the group+make picker.
- `EditRequestItemModal` (New rows): edit label/group + make (Makelist) + datasheet
  + BOQ. Both drop `CUS-`/category-string logic; dedup on `(tds_item_id, tds_make)`.

### FE-HISTORY — history table + export dialog
- `TdsHistoryTable` / `TdsExportDialog`: Item Name column = group name; Category
  facet = joined-category (or drop if not faceted cleanly); everything else stable.

### FE-OPTIONS — `useTDSItemOptions.ts` cleanup
- Remove dead `CUS-` scanning of TDS Repository and the legacy per-category make
  filtering (both reference the old flat shape). Keep WP/category/item/Makelist
  helpers still used by the master wizard.

### FE-FREEZE — flip the switch
- `src/constants/tds.ts` → `TDS_ASSEMBLY_FROZEN = false`. Remove the freeze banners
  in `TdsCreateForm` and the read-only gating in `TDSApprovalDetail`/`TDSApprovalList`.

---

## Verification (VERIFY)
- Typecheck + production build **inside `frappe_docker_devcontainer-frappe-1`**
  (host build fails — Linux-native node_modules).
- Backend: exercise `BE-APPROVE` as a **real non-superuser admin** (not
  Administrator) — istable perm trap (see `feedback_verify_as_non_superuser`).
- Manual: pick existing → Pending → approve → row Approved + entry Verified;
  request missing make → promote → new entry; request new group → member-less TDS
  Item + entry; reject; edit picked + edit New; export report (group name + joined
  categories render; historical rows still render); Items rename refreshes members.

## Operational pre-req
- Confirm in-flight `Pending`/`New` rows were drained before the Phase 1 master
  migration (ADR-0003 leaves historical rows untouched and assumes this). If
  stragglers exist, handle them manually before flipping the freeze flag.
