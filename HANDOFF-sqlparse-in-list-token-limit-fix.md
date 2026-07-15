# HANDOFF — `WHERE … IN (<huge list>)` sqlparse-token-limit fix (prod outage)

**Status:** PLAN — awaiting review. No code written yet.
**Date:** 2026-07-15
**Decisions locked (owner):** Hybrid fix approach · Code-fix-only (no sqlparse-pin stopgap) · Full version-match reproduction.

---

## 1. Problem (root cause)

Frappe's ORM inlines an `["in", [...]]` filter's values **directly into the SQL string**
(`db_query.py:849-851` — `"(" + ", ".join(frappe.db.escape(v) …) + ")"`, no chunking). Production's
**newer Frappe** added a `validate_generated_query()` that runs `sqlparse.parse()` on the **entire**
generated query, and production's **newer sqlparse** enforces a hard **10,000-token cap**. So any ORM
query that builds `WHERE name IN (<~a few thousand names>)` is rejected before it runs:

```
sqlparse.exceptions.SQLParseError: Maximum number of tokens exceeded (10000)
```

- Surfaces as **HTTP 417** when the endpoint wraps errors in `frappe.throw` (`get_list_with_count_enhanced`),
  or **HTTP 500** when it propagates (`sidebar_counts`). Same bug, two faces.
- **Why prod-only:** this bench is Frappe **v15.96.0** (`59a92b53`, no `validate_generated_query`) + sqlparse
  **0.5.3** (no token cap). Both prod versions are post-Jan-2026 security hardenings. The unbounded-`IN`
  code was always there; the newer stack turned "slow" into "fatal."
- **No config knob:** the cap lives inside sqlparse; there is no Frappe setting/env var/skip-flag. Ruled out.
- **Not permission-injected:** the app defines **no `get_permission_query_conditions` hooks** (both commented
  out in `hooks.py`). This is purely the explicit `IN` pattern.

**Immune paths (confirmed against framework source):** `frappe.db.sql` (bound params), `frappe.qb.run()`,
`frappe.db.count`, `frappe.db.get_values` all **bypass** `sqlparse`. NOTE — qb with a *literal* big list is a
**false friend**: it parameterizes but still emits N `%(paramN)s` placeholders (~N tokens); it only avoids the
error by bypassing the validator, not by shrinking the query. The scalable levers are **subquery/JOIN
(constant tokens)**, **slice-to-page (bounded)**, and **chunk (bounded per batch)**.

---

## 2. The Frappe-native patterns we will adopt (Hybrid)

| Need | Frappe's own way | Source |
|---|---|---|
| List a page | direct `WHERE <filters> LIMIT/OFFSET` | `db_query.py:226` |
| Total count | `SELECT count(*) FROM (<same filtered query>) p` or `frappe.db.count` | `reportview.py:68-70`, `database.py:1263` |
| Parent-by-child/JSON | `.isin(subquery)` / `EXISTS` / auto child-JOIN → `IN (SELECT …)` = **constant tokens** | `boot.py:249,379`; `query.py:181-187` |
| Bounded materialize | `parent IN (page-names)` **only at page size** | `query.py:499` (ChildQuery) |
| Unavoidable literal set | `frappe.utils.create_batch(names, 500)` + union | `utils/__init__.py:963` |

**Hybrid rule:** Frappe-native pagination + JOIN/GROUP BY where clean & high-leverage (the standard list path;
all standalone endpoints). Bounded slice-to-page + `create_batch` for the custom search/pending/facet
narrowing (which is *itself* the ChildQuery bounded pattern). No full subquery rewrite of the token-ranking /
JSON-item-search engine — that stays behaviourally byte-identical.

---

## 3. Complete instance inventory + fix technique

### Class B — the shared data-table engine (`api/data_table/`) — ONE area, ~50 tables + 39 facets

| Site | Current | Fix (Hybrid) |
|---|---|---|
| `search.py:306-312,439-441` **Standard path** | enumerate ALL names (`limit_page_length=0`) → `name IN (all)` | **B1** direct pagination: `total = frappe.db.count(doctype, filters)`; page = `reportview_execute(filters, limit_start, limit_page_length)`. **No name IN.** |
| `search.py:439-441` **item/pending non-ranked** | `name IN (all matched)` | **B2** slice matched names to page window BEFORE the IN (exactly what the ranked branch 422-432 already does); re-impose order. |
| `aggregations.py:39-40, 65-78` | raw SQL `WHERE name IN %(names)s` (sqlparse-safe but full tuple) | **B1a** for standard path: refactor to aggregate over a **subquery of the filters** (`SELECT SUM(p.f) FROM (<execute(filters, run=0)>) p`). For item/pending path: **chunk** the name tuple via `create_batch`. |
| `facets.py:187-188, 88, 139` | enumerate-all → IN | **B3** compute distinct values via `GROUP BY <field>` over the filtered subquery; bound by the facet limit. |
| `utils.py:128` JSON-field filter injector | injects `name IN (matching_names)` into reportview filters | **B3a** (DELICATE) route JSON-field-filtered requests through the narrow-then-slice machinery (like JSON-item-search) instead of injecting an unbounded IN into the generic filter pipeline. |
| `search.py:422-432` ranked path | `name IN (page_names)` sliced | ✅ already bounded — reference pattern, no change |

Export (`for_export`, `limit_page_length=0`): handled by B1 (standard → one large-LIMIT direct query) and B2
(item/pending → chunked page fetch via `create_batch`).

### Class A — standalone `pluck-all → IN` endpoints → JOIN / subquery / EXISTS

| Sev | Site | Fix |
|---|---|---|
| ✅ P0 | `sidebar_counts.py:172-183` (+195 + all `valid_po_names` uses) | replace PO pluck+IN with a **subquery** `parent IN (SELECT name FROM \`tabProcurement Orders\` WHERE status NOT IN (…))`, GROUP BY term_status. (`project IN user_projects` for restricted users stays — bounded.) |
| 🔴 P0 | `invoices/po_wise_invoice_data.py:104-108` | `Procurement Orders WHERE name IN (SELECT DISTINCT document_name FROM \`tabVendor Invoices\` WHERE workflow_state='Approved' [AND date range])` |
| 🔴 P0 | `invoices/sr_wise_invoice_data.py:104-108` | same shape for Service Requests |
| 🟠 P1 | `boq/wizard/review_screen.py:1543-1546` | `BOQ Node Qty By Area WHERE parent IN (SELECT name FROM \`tabBOQ Nodes\` WHERE <sheet filter>)` (subquery) or `create_batch` the in-memory `node_names` |
| 🟠 P1 | `target_rates/get_target_rates_for_item_list.py:36-46` | `create_batch(item_ids, 500)` + union (client-supplied list) |
| 🟡 P2 | `critical_pr_tasks/get_projects_with_pr_stats.py:111-115,192-196`; `critical_po_tasks/get_projects_with_stats.py:151-155`; `seven_days_planning/get_projects_material_plan_stats.py:169-174`, `get_projects_cashflow_plan_stats.py:154-159` | subquery (all-projects for Admin/PMO) |
| 🟡 P2 | `delivery_notes/get_delivery_notes.py:73-84`, `get_project_pos.py:30-36`; `vendor/get_vendor_po_invoices.py:96,129`; `commission_report/tracker_options.py:44-52` | subquery / `create_batch` (one large project / one vendor history) |
| 🟢 P3 | `projects/project_aggregates.py:66-74,479-487`; `pr_summary.py:69`; `customers/customer_financials.py:33,49,59`; `seven_days_planning/material_plan_api.py:33,304`, `cashflow_plan_api.py:46`; `po_delivery_documentss.py:126,137,157`; **`integrations/controllers/procurement_requests.py:578-583` (runs on EVERY PR save)**; `boq/wizard/update_sheet_draft.py:468-476`; `tasks/attachment_names.py:14-19`; `payments/bulk_actions.py:248,508`; `milestone/project_schedule.py:129-134`, `get_header_milestones_preview.py:406-408` | subquery where list is query-derived; `create_batch` where client-selection |

### Class C — raw-SQL siblings (sqlparse-SAFE; PG-scale hardening only, lowest priority)
`get_vendor_invoice_totals.py:67,312`; `credits/get_credits_list.py:80,401,499`; `tds/get_tds_requests.py:104,236`;
`warehouse/get_warehouse_ledger.py:109`, `get_warehouse_stock.py:118`; `internal_transfers/*` (get_itms_list:132,
project_transfers:84, create_itms:305-374). Convert to subquery/JOIN or `create_batch` opportunistically — **do
not block the outage fix on these.**

### Patches (run during `bench migrate`; one-time)
`patches/v3_0/migrate_project_invoices_gst.py:30`; `sync_items_to_tds_repository.py:29`;
`disabled_module_completed_project.py:25,35`; `boq_commit_current_unique_guard.py:72`. Chunk via `create_batch`.
Fix so a future fresh migrate on large data doesn't throw. Low urgency.

---

## 4. Reproduction & verification environment (owner chose: full version-match bump)

**Prod versions confirmed** (GCP `nirmaan-instance-2`, `asia-south1-c`, image tag `2.11.11`, container
`nirmaan-stack-backend-1`, 2026-07-15): **Frappe `15.115.0`** · **sqlparse `0.5.5`** (`MAX_GROUPING_TOKENS = 10000`
at `grouping.py:38,496`) · `validate_generated_query` present (5 hits) in `db_query.py`. Dev bench = Frappe
`15.96.0` / sqlparse `0.5.3` (neither hardening present) — hence dev cannot reproduce as-is.

1. **Isolate** (do NOT disturb the active BoQ dev bench): record current `apps/frappe` HEAD (`59a92b53`, v15.96.0)
   and `sqlparse==0.5.3` for rollback. Prefer a disposable copy/container or a DB+app snapshot; bump in place only
   with a documented revert.
2. **Bump to prod versions:** `cd apps/frappe && git fetch --tags && git checkout v15.115.0`;
   `pip install sqlparse==0.5.5`; `bench --site localhost migrate`; rebuild if needed.
3. **Seed:** create ~5–10k rows in an offending doctype (Approved Quotations / Procurement Orders / PO Payment Terms)
   to cross the token threshold. Script it.
4. **Red:** confirm the endpoints throw the exact `SQLParseError` BEFORE the fix (item-price list + `sidebar_counts`).
5. **Green:** apply fixes; confirm resolved end-to-end + all tests pass.
6. **Rollback** the bench to v15.96.0 / sqlparse 0.5.3 after verification.

**Fix is version-independent** — implementation does not need the bump; only verification does.

---

## 5. Testing

- **Engine equivalence tests** (`api/data_table/`): standard-path (count + page + aggregates + group_by identical
  to pre-fix on a fixture set), item-search + JSON-item-search matches & ranking **byte-identical**, pending-filter,
  facets, export. Plus a **token-budget assertion**: generate the SQL our code produces (`execute(run=0)`) on a
  large fixture and assert `sqlparse.parse()` (newer sqlparse) does NOT throw.
- **Class A per-endpoint tests:** result/count equivalence vs pre-fix + a scale test (seed many rows → assert no throw).
- **Regression guard:** ranking, item-search, JSON-search, cache keys, export all unchanged.

---

## 6. Execution Strategy (Plan-to-Parallel — see root CLAUDE.md)

Convert to tracked tasks (`TaskCreate` → `TaskUpdate` deps → parallel `general-purpose` subagents). Each subagent
prompt MUST carry the "why". Waves:

- **Wave 0 (blocking prerequisite):** obtain prod versions → stand up the isolated version-matched repro bench →
  write the failing red repro test. (Sequential; gates verification, not implementation.)
- **Wave 1 (parallel — mostly independent files):**
  - **T-ENGINE-agg** — `aggregations.py` refactor (filter-subquery for standard; `create_batch` for name-based). *Feeds T-ENGINE-std & T-ENGINE-search — do first within the engine.*
  - **T-ENGINE-std** *(blocked by T-ENGINE-agg)* — `search.py` B1 direct pagination + `db.count`.
  - **T-ENGINE-search** *(blocked by T-ENGINE-agg)* — `search.py` B2 slice-to-page + `facets.py` B3 + `utils.py` B3a.
  - **T-CLASS-A-P0** — `sidebar_counts.py`, `po_wise_invoice_data.py`, `sr_wise_invoice_data.py` (independent of engine).
- **Wave 2 (parallel, after Wave 1):** Class A P1/P2/P3 endpoints (one task per file), Class C hardening, patches.
- **Wave 3:** verify on the version-matched bench (red→green) + full backend test suite + FE smoke via chrome-devtools
  (item-price, Project Payments "All Payments", Procurement Orders, a faceted table, an Export). Then roll the bench back.

Within the engine, keep T-ENGINE-* carefully sequenced (shared file + delicate ranking/cache semantics); the rest
fan out.

---

## 7. Rollout / risks

- **No schema changes** — pure query rewrites; no doctype JSON edits; low deploy risk. Backend deploy + `bench migrate`
  (for the patch fixes) + restart. No FE rebuild required (endpoints unchanged in signature).
- **Risks:** (a) regression in the shared engine — mitigated by equivalence tests; (b) the version bump destabilizing
  the dev bench — mitigated by isolation + rollback; (c) `utils.py:128` JSON-filter injector is the trickiest change —
  flagged DELICATE; (d) aggregations subquery rewrite must preserve exact values — equivalence test.

## 7a. Wave 0 RESULT (2026-07-15) — RED reproduced ✅

Dev bench bumped in-place to **Frappe 15.115.0 + sqlparse 0.5.5**, `bench migrate` clean. Dev already has enough
data (Approved Quotations 18,986 · POs 6,607 · PO Payment Terms 7,304 · Project Payments 7,209) — **no seeding
needed**. Red captured, byte-identical to the prod traceback (`db_query.py:220/454/481` → `grouping.py:37`):
- item-price `get_list_with_count_enhanced_impl(Approved Quotations, filters=[])` → `ValidationError: … Maximum
  number of tokens exceeded (10000)` (= prod 417).
- `sidebar_counts("Administrator")` → `SQLParseError: … (10000)` (= prod 500).
- Bare mechanism: `frappe.get_all(dt, filters={"name":["in", 7000 names]})` → same error.
Repro scripts: `/tmp/repro_check.py`, `/tmp/repro_red.py` (in the dev container). GREEN = same calls return data.

## 7c. Wave 1 progress

- ✅ **search.py (engine core)** — standard path → `frappe.db.count` + direct `LIMIT/OFFSET` (no name IN);
  narrowed non-ranked path → DB orders the matched set + slices page names via raw bound-tuple SQL, then
  chunked `_hydrate_rows_by_names`; ranked path → same chunked hydrate. Verified on the bumped bench:
  item-price GREEN (total 18,986, exact `get_all` equivalence, paginated), filtered-standard equivalence,
  child item-search narrows to ground-truth 1304, pending narrowed works, 6000-name multi-chunk hydrate
  order-preserving, standard export returns full set. `aggregations.py` UNCHANGED (names-mode; standard path
  enumerates names only when aggregates/group-by configured — a small sqlparse-safe `SELECT name WHERE`).
- ✅ **utils.py + facets.py (JSON-facet name-in split)** — shared `split_name_in_constraints` /
  `enumerate_matching_names`; verified (normal facets equivalence, facet+item-search offender no longer
  throws, synthetic 6000-name injected filter green through both search & facets).
- ✅ **sidebar_counts.py** — credit `valid_po_names` pluck→IN rewritten as a JOIN to Procurement Orders
  (reuses `_proj()/_params()`). GREEN; credit counts named/all/due all match an independent JOIN check.
- ✅ **po_wise_invoice_data.py / sr_wise_invoice_data.py** — `create_batch(ids, 500)` chunking of the
  Procurement Orders / Service Requests GST lookup. GREEN; `project_gst` correctly mapped.
- **ALL P0 (the outage) DONE + verified + committed `20ab3bf9`.**
- ✅ **Tail (Class A P1-P3) DONE** — 20 files across BoQ / planning+milestone / delivery+vendor+commission /
  financials+PR-save, all via `create_batch(500)` chunking (results byte-identical; subagent-verified with
  chunk-boundary equivalence assertions + synthetic >10k-token proofs). **Declined (correctly):**
  `pr_summary.py` (handled by the committed engine split-constraint) and `payments/bulk_actions.py`
  (hard-bounded to `MAX_BATCH_SIZE=100`). **`patches/` left untouched** (append-only Don't-Touch rule).
- Class C (raw-SQL bound-param sites) NOT changed — already sqlparse-exempt; optional PG-scale hardening only.

## 7d. Browser E2E (chrome-devtools, dev :8080 -> bumped backend :8000, Administrator) — ALL GREEN

The exact page that failed on prod now works end-to-end; every affected surface returns 200 with data,
zero console errors:
- **Item Price Search** (`/item-price`, Approved Quotations) — renders "1-50 of **18986**"; `get_list_with_count_enhanced` **200** (was 417), `sidebar_counts` **200** (was 500).
- **Project Payments** — Approve tab + **All Payments empty-filter whole table "1-50 of 7209"** both 200.
- **Purchase Orders** — 200; exercised `get_pr_summary_list` **200** (validates the declined-file decision).
- **Reports** — 99-project financial summary renders (project/customer aggregation tail).
- **Material Plan Tracker** — `get_projects_with_material_plan_stats` **200** (validates a tail fix).
- No console errors on any page.

## 7b. Wave 0 rollback snapshot (recorded 2026-07-15, in-place bump chosen)

Dev bench = container `frappe_docker_devcontainer-frappe-1`, bench `/workspace/development/frappe-bench`.
**To roll back the version bump:**
- `apps/frappe`: `git -C apps/frappe checkout version-15` (was `59a92b53ac` / v15.96.0, branch `version-15`, clean).
- sqlparse: `env/bin/pip install sqlparse==0.5.3` (in container).
- DB: restore `./localhost/private/backups/20260715_112503-localhost-database.sql.gz` via
  `bench --site localhost restore` (config: `..._112503-...-site_config_backup.json`).
- Then `bench --site localhost migrate` + restart.

## 8. Open items
- ✅ **Prod versions obtained** — Frappe `15.115.0` / sqlparse `0.5.5` (see §4).
- **Isolation decision for the version-match bump** — bumping the active BoQ dev bench 15.96→15.115 + sqlparse is
  invasive; choose: (a) disposable copy/container, or (b) in-place bump with recorded rollback. Needs owner call
  before Wave 0.
- Confirm scope tail: include Class C + patches now (owner said "resolve everything" → yes, tiered P3/low) or defer.
