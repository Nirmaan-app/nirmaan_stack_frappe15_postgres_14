# Monthly WIP & Handover Report — Full Plan (as-built)

> **⚠️ 2026-07-24 — the table was reworked from raw document COUNTS to a 5-group / 15-column COMPLIANCE view (+ a senior-dev refactor). §§2–6 below describe the ORIGINAL build; the current column set, semantics and owner rulings are in [§7 — Compliance rework](#7--compliance-rework-2026-07-24) which is now the source of truth for the table. The active-days engine (§2) and placement (§3) are unchanged.**

**Feature:** For a selected month, list every project that was **active** (in `WIP` **or** `Handover` status) that month, with — for that month — how many **days it was active** (WIP + Handover combined), the **active start/end** dates, per-project **status chips**, and (post-rework) **DPR / Inventory compliance** plus **lifetime PO-dispatch / DC** figures. Collapsible per-project rows expand to per-stint sub-rows, each labeled with its status.

**Placement:** it is a **report type inside the Reports hub** — *Reports → Projects tab → Report Type dropdown → "Monthly WIP"* — **not** a sidebar item or standalone route.

**Status (updated 2026-07):**
- **Plan A — Calculated (live):** ✅ BUILT & verified. Now covers **WIP + Handover**.
- **Plan B — Document save (persisted):** 📐 DESIGNED, NOT built. Owner deferred; auto monthly cron when built. Needs a new doctype → explicit owner approval.

---

## 1. Context & the core problem

Management wants a monthly oversight view: how long each project was in active execution (`WIP`) or handover (`Handover`), and how much delivery/reporting activity happened.

The hard part: **`Projects.status` is a free-text `Data` field with NO stored status-start date.** When a project entered/left `WIP`/`Handover` exists ONLY in Frappe's built-in `Version` doctype (`Projects` has `track_changes: 1`). So durations are *derived* by replaying status transitions. **No new schema for Plan A** (agreed).

---

## 2. The "Active-days" calculation (WIP + Handover) — validated on live data

Used by both plans (Plan B calls the exact same compute).

**Keyed on the transitions:** a change **`→ WIP`** or **`→ Handover`** starts a period of that status; a change **out of** it ends the period. `WIP` and `Handover` are both "active"; every other status (Won, Halted, CEO Hold, Completed…) is an inactive **gap**.

1. **Reconstruct the status timeline** from `Version` rows → `(status, start, end)` intervals. Status *before the first recorded change* = that change's `old` value, from `[creation → first_change]` (some projects were already active before their first Version row). No Version rows → single `(current status, creation → now)`. Reuses `_extract_status_change_value_pairs` from `api/pmo_dashboard.py`.
2. **Status-aware merge** (`_merged_active_periods`): merge touching same-status intervals (`next.start <= prev.end` **AND** same status) — this collapses Version-log fragmentation. A **`WIP → Handover`** (or vice-versa) transition is **NOT** merged; it stays **two distinct, adjacent, labeled stints**.
3. **Intersect each active period with the month**, sum calendar days. Convention: **entry day counts, exit day does not**; the current month is **month-to-date**.
4. **active_start / active_end / stints:** from the merged active periods overlapping the month; `active_start` = earliest entry, `active_end` = latest exit (or `ongoing`). Drop zero-in-month-day periods. `stints` = count of remaining periods. `days_active` = **WIP + Handover days combined**.

**Live facts:** 112 projects, 847 Project Version rows. Adding Handover grew April from **46 WIP-only rows → 53 active rows** (16 with a Handover stint). Examples — Clayworks Senate: `WIP 12d + Handover 18d = 30`; Hexaware GIFT City: Handover-only (now included); ANSR Gurugram: WIP + 2 Handover stints = 3 stints.

### Column definitions

| Column | Meaning | Source | Business date field |
|---|---|---|---|
| **Active Days** | days in WIP **or** Handover that month | Version history | — |
| **Active Start / End** | earliest entry / latest exit (`Ongoing` if still active) | Version history | — |
| **Status** (chip) | WIP (sky) / Handover (amber); both shown if it had both | derived from stints | — |
| **DPR Count** | progress reports filed | `Project Progress Reports` | `report_date` |
| **Inventory Count** | inventory report submissions | `Remaining Items Report` | `report_date` |
| **DC Count** | delivery challans | `PO Delivery Documents` where `type="Delivery Challan"` | `dc_date` |
| **DN Count** | delivery notes | `Delivery Notes` | `delivery_date` |

### How the counts are computed (business date, not created/updated)
A document counts toward the month if its **business date** is in `[month_start … month_end)`:
`WHERE project = <p> AND COALESCE(<business_date>, creation::date) >= start AND < next_month_start`.
- Uses the **business date** (`report_date` / `dc_date` / `delivery_date`) = *when the work happened*.
- **`creation` is only a fallback** when the business date is blank; the **`modified`/updated date is never used** (editing later never re-buckets a doc).
- **DC** is filtered to `type = "Delivery Challan"` (the polymorphic doctype also holds MIRs, excluded).
- **Parent row count** = whole-month total; **per-stint counts** (expander) = the subset whose date falls in that stint's window.

**Row set:** projects with `days_active` > 0 that month (includes projects that have since left; excludes never-active-that-month projects even if they had docs). Sorted by Active Days desc. Role-scoped via `api/seven_days_planning/get_projects_material_plan_stats.py` helpers.

**Accepted limitations (owner OK'd):**
- Cron CEO-Hold flips + legacy backfill use `set_value(update_modified=False)` → no Version row (best-effort). Verified: currently **0** projects are silently inflated.
- A project that left with no Version record of ever being WIP/Handover (pure legacy backfill) can't be detected; still-active + normal-UI-transition projects are covered.

---

## 3. Plan A — Calculated (BUILT ✅)

Live compute on each view; **no persistence, no doctype**. CSV export saves a copy.

### Backend — `nirmaan_stack/api/reports/wip_monthly_report.py`
- Constants: `WIP`, `HANDOVER`, `ACTIVE_STATUSES = (WIP, HANDOVER)`.
- Pure helpers (unit-tested, no DB): `_build_intervals`, `_merged_active_periods`, `_active_periods_for_month`.
- `get_wip_month_options()` → dropdown months (recent-first).
- `get_wip_monthly_report(month)` → `{month, rows:[{project, project_name, days_active, active_start, active_end, stints, dpr, inventory, dc, dn, periods:[{status, start, end, days, dpr, inventory, dc, dn}]}]}`.
  - Parent counts via SQL `GROUP BY` (ADR-0010); per-stint counts only for multi-stint projects (fetch `(project,date)` rows, bucket into periods).

### Placement — report type in the Reports hub (NOT a sidebar item)
Wired into the existing Projects-tab report-type mechanism:
- `src/pages/reports/store/useReportStore.ts` — `'Monthly WIP'` added to the `ProjectReportType` union.
- `src/pages/reports/ReportsContainer.tsx` — `{ label:'Monthly WIP', value:'Monthly WIP' }` added to `projectReportOptions`.
- `src/pages/reports/components/ProjectReports.tsx` — lazy-imports `MonthlyWIPPage` and renders it when that type is selected.
- Visible to the same roles as the other Project reports (Admin / PMO / Accountant / Accountant-Lead / Project-Lead).
- The old dedicated sidebar item + `/monthly-wip` route were **removed**.

### Frontend — `src/pages/monthly-wip/MonthlyWIPPage.tsx` (+ `useMonthlyWIPData.ts`)
- **Month dropdown** (default current) drives the fetch.
- **Expandable table** (`Set<string>` expansion): parent = project active-total; expander only when `stints > 1` → child row per stint, each with a **status badge** (WIP/Handover).
- **Dates clamped to the selected month** with `← earlier` / `continues →` / `Ongoing` markers, plus a muted `actual: <date>` line and a hover tooltip showing the true lifetime dates.
- **Status chips** on each project (WIP = sky, Handover = amber; both if mixed); compact sizing via a shared `BADGE_SIZE` const.
- **Search** box (by project name), **sortable** columns (Active Days / DPR / Inventory / DC / DN), **clickable project name** → project page (`/projects/<id>?page=overview`).
- Count columns titled **DPR Count / Inventory Count / DC Count / DN Count**.
- **CSV export** (`utils/exportToCsv.ts`): Project, Active Days, Status, Active Start/End (in-month), Actual Start/End, and the four counts.

### Files
**Created:** `api/reports/wip_monthly_report.py`, `api/reports/test_wip_monthly_report.py`, `frontend/src/pages/monthly-wip/{MonthlyWIPPage.tsx, useMonthlyWIPData.ts}`.
**Modified:** `frontend/src/pages/reports/{store/useReportStore.ts, ReportsContainer.tsx, components/ProjectReports.tsx}` (report-type wiring + a scoped `SelectContent` scrollbar fix on the Report-Type dropdown).

### Verification — done
- **Unit tests: 10/10 pass** (`bench --site localhost run-tests --module nirmaan_stack.api.reports.test_wip_monthly_report`) — incl. status-aware merge + WIP+Handover combined days.
- Live: `get_wip_monthly_report("2026-04")` → 53 active rows, 16 with Handover stints (Clayworks `WIP 12 + Handover 18 = 30`, etc.).
- No silently-held projects inflating any month (checked).

---

## 4. Plan B — Document save (DESIGNED 📐, NOT built)

Persist saved monthly reports as documents. **Owner deferred**; trigger = **auto monthly cron**. Build only on explicit go-ahead — needs a new doctype.

### Coexistence — one compute, two consumers
Refactor the math into a single private `_compute_wip_monthly_report(month)`; `get_wip_monthly_report` returns it live (Plan A), `save_wip_monthly_report` freezes it into a doc (Plan B), `get_saved_wip_monthly_report(name)` reads a snapshot back. Plan A untouched; Plan B is a thin persistence wrapper.

### Doctype (minimal, when approved)
**`Monthly WIP Report`** — one doc per month: `month` (Data, unique) · `generated_on` · `generated_by` (Link User) · `remarks` (Small Text) · `rows_json` (JSON = frozen rows incl. `days_active` + `status` per period). No child table (add `Monthly WIP Report Row` only if cross-month SQL querying is later needed).

### Trigger — auto monthly cron
Scheduled job in `hooks.py` `scheduler_events` + `nirmaan_stack/tasks/`; on/after the 1st, compute + save the **previous completed month** (never month-to-date). Idempotent.

### When it's worth building
Everything derives from immutable history, so Plan A reproduces past months identically. Plan B only adds: official frozen archive, per-report remarks/sign-off, who-saved-when audit, and a scheduled-email feed. Build when one of those is a concrete need.

---

## 5. Plan A vs Plan B

| | Plan A — Calculated (built) | Plan B — Document save (designed) |
|---|---|---|
| Storage | none — live compute | `Monthly WIP Report` doc (frozen) |
| Freshness | always current | frozen at save time |
| Schema | zero | 1 new doctype (needs approval) |
| Past months | reproduce identically | frozen exactly as saved |
| Remarks / sign-off · Audit | ✗ | ✓ |
| Scheduled email feed | awkward | natural |
| Trigger | on view | auto monthly cron |

---

## 6. Decision log (owner choices)

- Metric = **Active days = WIP + Handover combined** (started WIP-only; Handover added on request).
- Each stint is **labeled with its status**; a `WIP → Handover` transition = two stints (not merged).
- Inclusion = projects **active at any point in the month** (not "currently active"); sorted by Active Days.
- Days = **within the selected month**; dates clamped to the month with actual dates shown/hover; accuracy = best-effort from Version history, **no new schema** for Plan A.
- CEO-Hold cron gap = **accepted** ("not a problem").
- Counts use the **document business date** (`report_date`/`dc_date`/`delivery_date`), `creation` as fallback, **never `modified`**; Inventory = `Remaining Items Report` submissions; DC = `type="Delivery Challan"` only.
- **Placement = report type in the Reports hub → Projects tab** (reversed the earlier "dedicated sidebar item + `/monthly-wip` page" decision — sidebar item + route removed).
- Layout = month dropdown, collapsible per-project rows → per-stint sub-rows, project name (not id) + clickable, search + sort, status chips, count columns named `… Count`.
- Persistence = **Plan A only for now**; Plan B **designed & deferred**, trigger = **auto monthly cron**.

---

## 7 — Compliance rework (2026-07-24)

The four raw document counts (DPR / Inventory / DC / DN) were replaced by a **two-tier grouped header, 5 groups / 15 columns**. The month-scoped DC/DN count columns were **removed**; DC/DN now live in the two new **lifetime** groups. Owner-ruled across an interactive session; every decision below is deliberate — do **not** "fix" them.

### Final layout

| G1 · Project | G2 · DPR — Daily (excl. Sun) | G3 · Inventory — Weekly (Mon) | G4 · PO Dispatch — Lifetime | G5 · DC — Lifetime |
|---|---|---|---|---|
| Project · Active Start · Active End | Active Days · Total DPR · Missing DPR | Expected · Actual · Missing | Dispatched · Total DN · Missing DN | Total DC · Missing DC |

### Metric semantics (owner-locked)

- **Active Days = active WORKING days = active calendar days − Sundays.** Redefined so **`Active Days == Total DPR + Missing DPR`** exactly. This DELIBERATELY breaks the tie to the Active End − Active Start span and makes the number smaller than the old calendar count. Backend still keeps `days_active` (full calendar, incl. Sundays) internally; the displayed value is the new `active_working_days`.
- **DPR — daily, Sundays excluded.** `Total DPR` = active working days with ≥1 DPR (distinct days, **not** a doc count; a Sunday DPR is not counted). `Missing DPR` = working days with none.
- **Inventory — weekly, Monday-dated ONLY.** `Expected` = active Mondays; `Actual` = active Mondays whose `report_date` is **exactly** that Monday (a Tue–Sun report does **not** cover the week — owner chose strict over week-window); `Missing` = Expected − Actual.
- **G4 & G5 are LIFETIME (whole-project, month-INDEPENDENT).** They are identical for a project no matter which month is picked; the row set is still month-gated. Shown **only** on the project row — **stint sub-rows render "—"**.
  - `Dispatched` = POs in `DISPATCHED_PO_STATUSES = (Partially Dispatched, Dispatched, Partially Delivered, Delivered)` — excludes Merged / PO Approved / Cancelled / Inactive. (PO `status` is **free-text**, no Select options.)
  - `Total DN` = **raw** `Delivery Notes` doc count, **returns excluded** (`is_return = 0`).
  - `Total DC` = `PO Delivery Documents` where `type='Delivery Challan' AND parent_doctype='Procurement Orders'` (excludes ITM + Material Inspection Reports).
  - `Missing DN = max(0, Dispatched − Total DN)`; `Missing DC = max(0, Total DN − Total DC)`. **Both clamped at 0** — a PO carries several DNs and DC can exceed DN, so the raw subtraction routinely goes negative (verified: nearly all live rows have DN > Dispatched → Missing DN = 0). **Not a reconciling triad** — three independent numbers.

### Backend — `api/reports/wip_monthly_report.py`

- New pure helpers (unit-tested, no DB): `_period_day_set(cstart, cend)` (calendar dates of a stint window, entry-in/exit-out) and `_compliance_metrics(active_days, dpr_days, inv_days)` (`MONDAY=0`/`SUNDAY=6`; the 6 day-based fields).
- DPR/Inventory fetch **distinct `report_date` SETS per project** (`_distinct_dates_by_project`) and intersect with the active-day set — **per row AND per stint**.
- G4/G5 via `_lifetime_counts_by_project(table, ids, extra)` — `COUNT(*) GROUP BY project`, **no date filter**. `DISPATCHED_PO_STATUSES` literals are inlined (code constant, no user input).
- The old month-scoped `_counts_by_project` / `_dates_by_project` were **deleted** (dead once DC/DN went lifetime).
- Row shape now: `days_active` (internal) · `active_working_days` · `total_dpr_days` · `missing_dpr_days` · `expected_inventory` · `actual_inventory` · `missing_inventory` · `dispatched_po` · `total_dn` · `missing_dn` · `total_dc` · `missing_dc` · `periods[]` (each stint carries the 6 day-based fields only — **no** G4/G5).

### Frontend — `MonthlyWIPPage.tsx` (+ `useMonthlyWIPData.ts`) — senior-dev refactor

- **Column-config-driven.** `NUMERIC_COLUMNS` (11 entries: `key`/`label`/`groupStart`/`emphasize`/`lifetime`) + `COLUMN_GROUPS` (the 5 group headers) are the single source of truth — the two-tier header, every body cell, sorting and the group dividers all derive from them. Adding/renaming/reordering a column = one edit.
- **Extracted presentational cells:** `StartCell` / `EndCell` (shared by project + stint rows, `small` prop), `NumberCell` (align/emphasis/`tabular-nums`/group-edge), `DashCell` (stint lifetime "—"); module-level `numFmt`. Types split `ComplianceField` (on stints) vs `LifetimeField` (project only) so stint cells are type-safe.
- **Fit-to-viewport columns (no horizontal scroll on a laptop):** `Table className="table-fixed"` + a `<colgroup>` whose widths are **PERCENTAGES** (`COL_W` = chevron 2% / project 14% / date 9% / numeric 6%; sum 100), so the table always fills exactly the available width and scales with it — the 15 columns never overflow into a horizontal scroll. Numeric cells/headers trim shadcn's `p-4` to `!px-2`; numeric headers are `text-xs` + `break-words` so they wrap in the tight columns. Labels shortened (group header carries context): "Total DPR", "Missing DPR", "Expected", "Actual", "Missing", "Disp.", "Total DN", … Project cell is `break-words`. (Was fixed-px + `overflow-x-auto` scroll; changed 2026-07-24 on the "view laptop fully" request.)
- **Grid / group separation:** `GROUP_EDGE` (`border-l-2 border-muted-foreground/40`) on each group's first column = a darker 2px divider between the 5 groups; `LEAN_EDGE` (`border-l border-border/50`) on every other column = a faint 1px rule between the in-between columns. Both run continuously through the header band + every body row. The group-header tier is a banded row (`bg-muted/60`, uppercase semibold labels); the leftmost collapse-chevron gutter carries the same `bg-muted/60` top-to-bottom (header + rows) as one strip. Summary line trimmed to just the project count (the per-metric totals were removed).
- **Export = current view.** `handleExport` now flattens **`displayRows`** (current sort + search), not the raw `rows` — WYSIWYG. Export columns include all 15 metrics (full names + "(lifetime)" suffix on G4/G5); G4/G5 are blank on stint rows. The CSV also carries a **group-header row** above the column names (merged-cell style, aligned to each group's first column) via a new backward-compatible `options.groupHeaders` param on the shared `utils/exportToCsv.ts` (`EXPORT_GROUP_HEADERS` on the page maps accessorKey → group label; omitting the param leaves every other caller byte-identical).
- **Stint sub-rows** are tinted **light blue** (`bg-sky-50 dark:bg-sky-950/30`, matching the WIP chip), hover-locked so they don't flip to the default row-hover.
- Summary line: `DPR days X · missing Y · Inventory a/b · dispatched POs Z · missing DN M · missing DC N`. Subtitle states G4/G5 are lifetime / month-independent.

### Verification

- **Backend: 15/15 unit tests pass** (5 new: Sunday exclusion + reconciliation, Monday-only inventory, empty set). Live Jul-2026: **0 invariant violations** (both day-based sums reconcile, per-stint sums to parent, working ≤ calendar; G4/G5 formulas correct, absent from stint periods). **Month-independence: 0 mismatches** across 28 projects present in both Jun & Jul. Backend cleanup proven behaviour-neutral (identical output before/after).
- **Frontend: `tsc` clean** for the two files (project-wide pre-existing errors unchanged; app builds via Vite).

### Rework decision log (2026-07-24)

- Active Days redefined to **working days** (Sundays out) so the DPR triad sums exactly — accepted the broken tie to the date span.
- DPR daily / Sundays excluded; Inventory weekly / **Monday-dated only** (strict, not week-window).
- G4 `Total DN` = **raw DN doc count** (owner picked this over "distinct POs with a DN"); returns excluded.
- G5 = **document counts** (`Missing DC = Total DN − Total DC`).
- Missing DN & Missing DC **clamped at 0** (raw subtraction goes negative by design).
- The month-scoped DC/DN columns were **removed** (replaced by the lifetime groups), not kept alongside.
- Refactor to column-config + fixed-width compact numeric columns + export-the-current-view.
