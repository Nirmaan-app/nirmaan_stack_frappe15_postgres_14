# Pricing Module — Plan & Status

**Last updated:** 2026-07-23 (FR arc CLOSED — formula repair + gzip multipart transport; Electrical + ELV
cleared for team editing).
Standalone estimation-pricing module, **outside the BoQ
upload wizard**. This is the live status + decision record; per-slice detail accrues here, NOT in the
always-loaded `CLAUDE.md` (which carries only the stable summary).

> Skipping note: `boq-upload-plan.md` is deliberately NOT updated for this module — the plan-doc fold
> agreement applies to BoQ wizard work, and the Pricing Module is a separate surface.

---

## Goals

Give estimation users a real spreadsheet editor in-app for pricing work, with the workbook persisted
server-side, versioned, audit-logged, and protected against concurrent clobbering via a checkout lock.
Access is limited to administrators and estimation users.

---

## Decisions to date

- **Editor = Luckysheet mounted from static assets.** The spreadsheet grid is a mature JS spreadsheet lib
  (Luckysheet) shipped as static assets rather than a bespoke React grid. **Univer upgrade is DEFERRED** —
  Luckysheet first; migrate to Univer only if/when its limits bite.
- **Access = admins + estimation, by DB-discovered names.** The allow-list is the EXACT `role_profile_name`
  / Role strings found by querying the live DB (not guessed, not hardcoded from the frontend's broader BoQ
  gate): `Nirmaan Admin Profile`, `Nirmaan Estimates Executive Profile`, `Nirmaan Estimates Executive`, plus
  the `Administrator` user. DB-verified 2026-07-22.
- **Single-point API gate + SM-only doctype perms.** The three doctypes are `System Manager`-only; every
  user path goes through the whitelisted API, which is the sole gate (`_require_pricing_access()`). Endpoints
  use `ignore_permissions=True` internally. One place to reason about who can do what.
- **Watermark + access log.** Every open/save/checkout/release/create is written to `Pricing Access Log`
  (who / what / when). (Frontend watermarking of the editor surface is the UI half of the same intent.)
- **Checkout lock for concurrency.** One editor at a time per workbook via `checked_out_by` +
  `checked_out_at`, with a 30-minute auto-expiry so an abandoned lock self-heals. Saves require a live lock.
- **JSON is frontend-owned.** The backend validates only that `workbook_json` parses; it never inspects or
  enforces the spreadsheet structure.
- **Branch base.** `feature/pricing-module` was cut from `a7b8237c` (develop tip, v2.11.14) — the repo's
  feature→develop→main flow, and the explicit hash given in the PM-1 brief. (The brief's "main tip" label was
  a carried-over mislabel; `main`'s actual tip is `b92fd6b2`/v2.10.15. Base confirmed before building.)

---

## PM-1 — DELIVERED (backend)

- **Doctypes:** `Pricing Workbook`, `Pricing Workbook Version`, `Pricing Access Log` (all SM-only, hash-named).
  `bench migrate` clean; all three tables verified present.
- **API** (`nirmaan_stack/api/pricing/workbook.py`): `list_workbooks`, `get_workbook` (logs `open`, returns
  lock state), `checkout` (free / mine / >30-min-expired grant; else throws with holder), `release`,
  `save_workbook` (lock-guarded, version bump + Version row + prune-to-20), `create_workbook` (v1 + Version
  row). All gated by `_require_pricing_access()`; ACCESS SET is a DB-verified module constant.
- **Tests:** `nirmaan_stack/api/pricing/test_pricing_workbook.py` — **12 tests, all passing** (positive +
  negative: access denial for non-holders and Guest, create/get round-trip, lock acquire/block/expiry,
  save-without-lock rejection, version bump + row, prune-to-20, audit-log writes, invalid-JSON rejection,
  release). Run:
  `bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.pricing.test_pricing_workbook`.

---

## PM-2 — DELIVERED (frontend)

- **Vendored engine** at `nirmaan_stack/public/pricing_libs/` (served `/assets/nirmaan_stack/pricing_libs/`):
  luckysheet@2.1.13 dist (css, plugins, assets/iconfont, `plugins/js/plugin.js`, `luckysheet.umd.js`),
  luckyexcel@1.0.1 `luckyexcel.umd.js`, jszip@3.10.1 `jszip.min.js`. Excluded `*.map`, `demoData`, the esm
  build, `expendPlugins`. **Completeness note:** `fonts/` (fontawesome, referenced by `css/luckysheet.css` +
  `plugins/plugins.css` via `../fonts/…`) and `plugins/images/` are INCLUDED — they are runtime deps of the
  included CSS and are not in the exclude list; dropping them ships a broken toolbar. ~6.8 MB, 47 files.
  Fetched via `npm pack` in the container and committed. Vendoring (~7 MB) is the MVP tradeoff; npm-proper /
  CDN is deferred with the Univer upgrade. The libs are **script-injected at runtime, NOT bundled by Vite**
  (verified: the `HvacPricingPage` chunk is ~8.6 KB; the 3 MB luckysheet UMD is not inside it).
- **Page** `frontend/src/pages/pricing/HvacPricingPage.tsx` (+ local `pricingLibs.ts` helper) — lazy module,
  named `Component` export (M1.59). On mount: inject CSS + scripts (plugin.js before luckysheet.umd.js; jszip
  before luckyexcel), then `list_workbooks`. Empty → "Import Excel (.xlsx)" via `LuckyExcel.transformExcelToLucky`
  → `create_workbook`. Exists → `get_workbook` → `luckysheet.create` (read-only first, `showinfobar:false`).
  **Lock flow:** "Edit" → `checkout` → re-init `allowEdit:true` + "You hold the edit lock" banner + Save/Release;
  checkout held-by-another → "Locked by <holder>", stay read-only. Save → `save_workbook(getAllSheets())`, shows
  saved-at; keeps lock. Unmount + `beforeunload` → best-effort `release` (fetch keepalive w/ CSRF). PermissionError
  → Access Denied panel; script-load failure → visible error (never blank).
- **Watermark:** pointer-events-none data-URI-SVG background overlay, ~30° tiled full-name + email at low
  opacity; applies in read-only AND edit modes.
- **Guard** `PricingRoute` in `ProtectedRoute.tsx` (NewProjectRoute single-source pattern): Administrator OR
  role_profile `Nirmaan Admin Profile` / `Nirmaan Estimates Executive Profile`. **Route** = one lazy entry
  `hvac-pricing` wrapped by `<PricingRoute />`. **Sidebar** = four-touch M1.57 recipe (`Table2` icon), same
  access strings as the guard.
- **Verification:** tsc (in-container) 0 new errors in slice files; `yarn build` clean (2m49s), known-benign
  warnings only (large chunks, caniuse, PWA). No Frappe-test harness on this slice (frontend) — tsc + build +
  manual matrix stand in.

### On record

- **Recon correction:** `a7b8237c` is `develop`'s tip (v2.11.14), NOT `main`'s (`main` = `b92fd6b2`, v2.10.15).
  The PM-1 brief's "off main tip (a7b8237c)" carried a mislabel from the earlier recon writeup; the branch is
  correctly rooted at `a7b8237c` per the explicit hash + the repo's feature→develop→main flow.
- **Report delivery standing rule:** every run's full report is also written to the owner's Desktop as a dated
  `.md` (resolve Desktop via the environment, never hardcode) for upload — not relied on via inline paste.
- **Access asymmetry surfaced (STEP 0):** two Project Leads (`aseem@`, `bhanu@`) carry the *Role* "Nirmaan
  Estimates Executive" but a Project-Lead *profile* — the backend admits them, the frontend guard (profile-only)
  does not. Intentional (backend is the enforcement layer); flagged for owner review.

## PM-3 v2 — DELIVERED (fixes; frontend only)

Premise = three read-only diags (DIAG-1/2/3), each re-verified against code before changing.

- **STEP 0 — checkout root cause:** queried `tabError Log` for 2026-07-22 18:00–18:25 IST (and any-time for
  `pricing`/`checkout`) → **0 rows**. The failed checkout never reached the server Error Log, so there is no
  backend root cause to fix and `workbook.py` was **NOT edited** (no API signature change). Fix 3 (honest banner)
  now surfaces the real client-side error on the next live run instead of masking it as a phantom lock.
- **Fix 1 — post-mount sheet init (kills the DIAG-1 empty-state crash):** `luckysheet.create` no longer runs
  synchronously inside async callbacks. Every create path (load / import / edit / release) now calls
  `requestSheet(sheets, allowEdit)` (a nonce-bumped state request); a `useEffect` keyed on
  `status === "ready" && renderReq` runs `initSheet` only after the `"ready"` render has mounted the container
  div. The pre-mount `getElementById → null → addEventListener` crash is now structurally impossible.
- **Fix 2 — always-on toolbar (DIAG-2):** `showtoolbar: true` unconditionally (was `allowEdit`); `showinfobar`
  stays `false`; other bars keep luckysheet defaults. Edit-only actions remain gated by `allowEdit`.
- **Fix 3 — honest lock banner (DIAG-3):** `handleEdit`'s catch no longer treats every failure as a lock
  conflict. It re-fetches the true lock state and shows **"Locked by X — read only (since <t> IST)"** ONLY when
  a re-fetched `checked_out_by` is non-null AND ≠ current session user AND not expired. A checkout failure on a
  **free** lock now shows the **real error message** and keeps **Edit available (retryable)** — never the
  `"another user"` fallback on a null holder. Holder-since time shown in IST on both the load and conflict banners.
- **Fix 4 — clock:** no code change. DIAG-3 confirmed `_lock_expired` compares `now_datetime()` on both sides
  (IST-consistent); the UTC `SELECT now()` is never used in a comparison. **Closed: no timezone expiry bug.**
- **Fix 5 — brand watermark:** re-rendered in the **Nirmaan brand red `#D03B45`** (= `rgb(208,59,69)`), found
  hardcoded across `src` (51 uses; canonical spots `NewSidebar.tsx` active-state `text-[#D03B45]` +
  `ProtectedRoute.tsx` `TailSpin color="#D03B45"`; not a named token — the shadcn `--primary` is a separate rose
  `hsl(346.8 77.2% 49.8%)`, and `#dc2626`/`#ef4444` are generic destructive reds). Raised prominence: **opacity
  0.07 → 0.15, font 15 → 21px + weight 600, tile 340×170 → 300×150 (denser)**, still `pointer-events: none`,
  sheet stays comfortably readable.
- **Verification:** tsc (in-container) 0 new errors in slice files; `yarn build` clean (3m17s), benign warnings
  only; `HvacPricingPage` chunk 9.25 KB (vendored libs remain unbundled). No backend path fired → no Frappe-test
  run (PM-1 suite stays at 12/12 baseline, untouched).
- **DIAG-3 one-liners on record:** (1) the blocked-Edit was a **frontend false positive** — the access log shows
  zero successful checkouts and a free lock throughout (Fix 3 addresses it); (2) **clock closed, no bug** (Fix 4);
  (3) **dual identity** (`Administrator` vs `admins@nirmaan.app` = two lock identities for one human) is **account
  hygiene, no code change this slice** — owner call, tracked in PM-3+.

## PM-4 — live Chrome verification + real checkout root cause + DATA-LOSS INCIDENT

Owner reported "still giving error" after PM-3. Drove it live in Chrome (`:8080` dev). Findings:

- **The five PM-3 fixes are CONFIRMED live:** read-only load renders (post-mount init, no null crash),
  toolbar is visible, watermark is brand-red + prominent, and the honest banner works — clicking Edit showed
  the REAL error ("There was an error.") next to a still-available Edit button instead of a phantom lock.
- **Real root cause of the persistent error (the thing DIAG-3 could not see):** `checkout` returned **HTTP 417**.
  `checkout` / `release` did a full `doc.save()` on the Pricing Workbook; once `workbook_json` holds an imported
  (array-shaped) sheets blob, Frappe hydrates it back as a Python **list**, and `get_valid_dict` then throws
  **"Value for Workbook JSON cannot be a list"** — the same **list-valued-JSON `doc.save()`/`delete_doc` wall**
  documented in the root CLAUDE.md for BoQ. The PM-1 tests missed it because they used **dict** payloads (which
  hydrate as dicts, not lists). **Fix:** write lock fields with `frappe.db.set_value` (metadata write, no
  whole-doc validation) + a `DoesNotExist` guard. Verified live: Edit → "You hold the edit lock" + Save/Release,
  Release → back to read-only; DB `checked_out_by` set/cleared with `update_modified=False`. Commit `f4f79190`.
- **⚠️ DATA-LOSS INCIDENT (caused + fully recovered this session).** The test `_purge_all` blanket-deleted **all**
  Pricing Workbook / Version / Log rows, and `bench run-tests --site localhost` runs against the **live** DB and
  commits. Running the suite **wiped the owner's real workbook** (`ecnfm06kl5`, 17 sheets). (The original PM-1
  `_purge_all` had the same flaw; it only bit once real data existed.) **Recovery:** the data was still in the
  browser tab's Luckysheet memory — extracted `getAllSheets()` (17 sheets, ~26 MB), dropped the redundant
  expanded `data` grid (Luckysheet rebuilds it from `celldata`), and re-created the workbook via `create_workbook`
  from the page (18 MB body; the full 33 MB exceeded the request limit). Restored as `3cl1hv4c1l`, title
  "HVAC Pricing", **celldata counts byte-identical to the live grid**, verified in the DB. **Fix:** `_purge_all`
  is now **SCOPED to only the workbook names the suite created** (tracked in `_created_names`), raw `db.delete`
  (never `delete_doc`, never filterless). Re-ran the suite: **13/13 pass AND the real workbook survives intact**.
  **Lesson (load-bearing): a test that commits against the live site DB must NEVER blanket-delete a doctype — scope
  every cleanup to rows the test created.** Filed as a standing rule; see also root CLAUDE.md list-JSON wall.

## PM-5 — Save payload compaction (serializeSheets) + a residual dev-proxy hang (OWNER DECISION)

Premise = DIAG-5, re-verified: `handleSave` posted the full `getAllSheets()` (~26 MB) and the save hung.

- **Fix (commit `92958568`):** new `serializeSheets(sheets)` in `pricingLibs.ts` — THE single source for the save
  shape — drops the rebuilt/runtime keys **`data`, `visibledatarow`, `visibledatacolumn`, `jfgird_select_save`,
  `luckysheet_selection_range`** and keeps `celldata` + `config` + `calcChain` + display settings. `handleSave`
  posts `serializeSheets(getAllSheets())`. **Payload 26.6 MB → 14.3 MB** (18.1 MB as the wrapped request body).
  **Lossless** — Luckysheet rebuilds `data` from `celldata` on load. Stored shape stays the celldata-only
  canonical form already in the DB (restored copy) + produced by import → **no migration, no API change.**
- **DIAG-5 one-liners on record:** the 26 MB save wall (rebuilt `data` for all sheets); "reading 'data'" was
  **not reproducible** on a clean load (engine rebuilds `data` for ALL sheets at create) — most-likely a stale
  pre-reload tab; strip-on-save is the canonical compact form. Version-history size: 20 × ~14 MB ≈ **280 MB**
  per workbook — accepted as MVP; compression/dedup is a later concern.
- **Live verify (`:8080`, hard-reload first):** all 17 tabs render; Edit → set `Ducting!P34 = "PM5-SAVE-TEST"`
  → Save. The **compact POST completes: HTTP 200, ~1.6 s, 18.1 MB body**; DB `current_version` bumped and a
  Version row appeared; hard reload → **the change persisted and `data` rebuilt on all tabs** (spot-checked ADP
  / Insulation / Sensors — real content). Then reverted `P34` to empty (original) via a second save and
  **released the lock (`checked_out_by` NULL)**; workbook left clean (an empty cell keeps a tiny `ct` format
  stub — no value). (Test churn left version rows v2–v4; prune keeps newest 20, no data loss.)
- **⚠️ RESIDUAL — OWNER DECISION (not a size limit, not the fix):** the app's Save **button** path
  (frappe-react-sdk **axios**) **intermittently HANGS through the Vite dev proxy** at the ~18 MB body — one
  attempt persisted server-side but the proxy returned **503**; another hung >17 s and did not persist. The
  **identical-size `fetch` to the same endpoint returns a clean 200 in ~1.6 s**, and `list_workbooks` returns
  200 — so the **backend + payload size are fine**; the stall is the **axios-through-Vite-dev-proxy** path,
  which production (nginx → gunicorn multi-worker) does not use. Per scope I did **NOT** change any proxy /
  werkzeug / site size or timeout config — that's an owner decision. Recommended: confirm Save on a
  production-like server, and/or a small backend save endpoint that streams/accepts the body without the dev
  proxy in the middle. **Until then, treat the app Save button as verified-correct-but-flaky in dev.**

## PM-6 — Save transport switched to fetch (+ darker watermark)

Premise = PM-5's residual: the SDK/axios save stalled intermittently through the Vite dev proxy on the ~18 MB
compacted body, while an identical `fetch` completed cleanly (200, ~1.6 s).

- **Fix (commit `a041a6ac`):** `handleSave` now posts via a **same-origin raw `fetch`** to
  `/api/method/…save_workbook` (session cookie + `X-Frappe-CSRF-Token` from `window.frappe`/`window.csrf_token`),
  matching the `releaseBeacon` + wizard multipart-upload precedent. Failure parses `_server_messages` to surface
  the real Frappe message and keeps lock + Edit state. The unused SDK `callSave` was removed.
  **Only the save call changed transport — checkout/release/get/list stay on the SDK** (small bodies).
- **Watermark darker:** fill opacity **0.15 → 0.22** (same `#D03B45`, 21px/weight 600, tile 300×150, −30°,
  pointer-events none). Live-confirmed visibly darker, sheet still readable.
- **Live-verified on the real Save button** (3 repeats + revert): **HTTP 200 in ~1.6–1.8 s each, ZERO hangs**
  (#1 1784ms, #2 1686ms, #3 1634ms, revert 1653ms; 18.1 MB body). DB `current_version` bumped 4→8, the change
  persisted + reverted, and Release cleared the lock (`checked_out_by` NULL). Backwards-compat: **endpoint,
  payload shape, and stored form unchanged — only the client transport + overlay styling. No API change, no
  migration.** tsc 0-new-errors; `yarn build` clean; page chunk ~10 KB (libs unbundled).
- **Dev-environment note (for future live tests on this box):** `:8080` is a **standalone `yarn dev` (Vite)** —
  NOT managed by `bench start` (whose Procfile is web/watch/socketio/schedule/worker only). Vite's file watcher
  does **not** see Windows-host edits through the Docker bind mount (inotify), so a running Vite serves STALE
  source until restarted; a container-side `touch` does not force it. Also the **PWA service worker re-registers
  on load and can serve cached old assets** — clearing it (unregister + `caches` clear) + a fresh tab is needed
  to pick up new code. To live-test a frontend change here: restart `yarn dev` (reads disk fresh) AND clear the
  SW/site-data in the browser. (This is why PM-5's button appeared to still hang — the browser was running stale
  pre-fix code; the fetch fix itself was fine.)

## PW-1 — Generic workbook page + registry (HVAC / Electrical / ELV)

Premise = the RECON of 2026-07-23, whose findings were re-verified against code before any edit: the page was
not "HVAC-shaped" but **exactly-one-workbook-shaped**. Two defects, both fixed here:

- **`rows[0]` selection (was `HvacPricingPage.tsx:144-153`).** `list_workbooks` is called with NO arguments and
  the page took the FIRST row. Confirmed against the backend: `list_workbooks` orders by **`modified desc`**, so
  `rows[0]` was a **moving target** — which workbook opened would change as people saved. Two of three workbooks
  were unreachable, and the hardcoded heading could sit over another discipline's data.
- **Global empty-state gate (was `:146-148`).** `status="empty"` fired on `!rows.length` = zero workbooks in the
  **system**, and the Import control renders only in that branch — so once workbook #1 existed, **workbooks #2
  and #3 could not be created through the product at all**. Import also hardcoded the title (`:350-353`).

**Shape (commit `<feat>`):** one generic `PricingWorkbookPage.tsx` (renamed from `HvacPricingPage.tsx` via
`git mv`, history preserved) + a new `pricingWorkbooks.ts` registry
(`{path,title,label}` × HVAC / Electrical / ELV). Selection is now `rows.find(r => r.title === entry.title)`;
the empty state is per-title; Import creates with `entry.title`. All 11 recon-listed title sites are
registry-driven, including the `<h1>` at `:401` which bypassed the old constant. Unknown path → a visible
"Unknown pricing workbook" state, never blank.

**Why three route objects and NOT `/pricing/:key`** (the shape decision): (1) the sidebar's active-item matching
is **single-segment** (`pathname.slice(1).split("/")[0]`, then `` `/${selectedKeys}` === subitem.key ``), so
nested sub-paths would never highlight; (2) one param route reuses the route element — **no remount** — and the
page owns a Luckysheet **global singleton** plus a 30-minute server checkout lock, so a missed unmount strands
the lock (the `SheetPricingPage.tsx:644` same-element hazard, but worse). Separate route objects make the
existing unmount cleanup (`releaseBeacon` + `destroySheet`) do the right thing for free. **Live-proven below.**

**Sidebar: flat ×3, NOT a group** — the sidebar has exactly ONE real collapsible group (`admin-actions`);
everything else is top-level. The four touches are now registry-driven, so touch 1 is a single role gate
emitting three items. (A "Pricing" group remains a pure sidebar change if the list grows; noted, not taken.)

**Live verification (`:8080`, fresh Vite + SW cleared; all green):**
- **6a HVAC regression:** loaded the REAL `3cl1hv4c1l` (access log confirms open/checkout/save on it), heading
  "HVAC Pricing", 17 sheets. Edit → cell → **Save 200 in 2072 ms (17.27 MB)** → v10→11 → reload persisted →
  reverted (v→12) → Release. **Unchanged from PM-6 behaviour.**
- **6b separation + lock independence:** `/electrical-pricing` loaded the SYNTHETIC (`00uc366qqr`, 1 sheet
  `PW1Synthetic`, cell `PW1-SYNTHETIC-ELECTRICAL`) while `/hvac-pricing` still loaded HVAC. With Electrical
  checked out, HVAC's lock stayed `None` and its Edit stayed available.
- **6c per-title empty state:** `/elv-pricing` showed **its own** empty state + Import ("No ELV Pricing workbook
  yet") while the other two were ready — the precise behaviour the old global gate made impossible.
- **6d switch safety:** navigating away **mid-edit** (no Release click) left Electrical's `checked_out_by`
  **NULL** — the unmount beacon fires on SPA route switch — with zero stale content (17 HVAC sheets back, no
  `PW1Synthetic`). **No stranded lock.** Sidebar showed all three links for a qualifying user.
- **6e cleanup:** synthetic removed by **exact docname** via raw `frappe.db.delete` (NOT `delete_doc` — the
  list-valued-JSON wall, PM-4; NOT any filterless delete — the PM-4 data-loss incident rule): 1 version row,
  6 log rows, 1 workbook row. HVAC snapshot **byte-identical before/after cleanup** (v=12, 12 versions,
  same `modified`, 16,763,239 bytes, test cell gone, lock NULL). `/electrical-pricing` back to its empty state,
  ready for the owner's real import.

**Dev-environment note (extends PM-6's):** a Vite was already running on `:8080` from before the edits and was
serving stale code; it was stopped **by explicit PID** (never `pkill vite`) and restarted, then verified by
curling the served module for this slice's markers before trusting any browser result. Also observed and left
alone: a **pre-existing, app-wide, dev-only** `SyntaxError: Unexpected token '{'` at document line 32 — the Vite
dev server serves the RAW Jinja shell, so `frappe.boot = {{ boot }}` is unrendered. It reproduces on untouched
routes (e.g. `/upload-boq`) and does not exist in the built app. **Not a PW-1 regression; out of scope.**

**Tooling deviation (declared):** the slice specified Playwright for the live verify. Playwright is **not
installed** in this repo/container, installing it was out of scope, and a fresh Playwright browser could not
authenticate without entering the owner's password. The verify was driven through the **Chrome MCP tools against
the owner's authenticated session** — the same mechanism used for PM-4/PM-6 — covering 6a–6e in full.

**Backwards-compat:** `/hvac-pricing` behaviour is UNCHANGED for the existing workbook (proven in 6a); no
backend change, no migration; route + sidebar edits are additive except the one updated lazy import path.

**ELV status:** the cleaned ELV file is ready and the page is live at `/elv-pricing` with its Import control —
**the real Electrical + ELV imports are the owner's manual step** (PW-1 deliberately imported no real files).
Once the ELV import passes, the Google-sheet sharing for the ELV source can be revoked along with the others.

## FR arc (DIAG-6 -> FR-6) — CLOSED 2026-07-23

The Electrical/ELV workbooks imported but their formulas were dead. Seven distinct causes, each found by
minimal repro, each now closed. **Both workbooks verified live against the owner's expected-value tables.**

### The defects, one line each

| # | Defect | Symptom | Fix |
|---|---|---|---|
| A | LuckyExcel HTML-escapes sheet NAMES but not formula text (`Switches &amp; Sockets`) | every cross-sheet ref -> `#NAME?` on recalc | `decodeSheetNames` at import (FR-1) |
| B | Array/CSE formulas `MATCH(1,(a)*(b),0)` | never register a dependency; sit inert | sources rewritten offline to `VLOOKUP` on a key-first helper pair |
| C | `IFS` / `LET` unsupported by the engine | `#NAME?` | rewritten offline to nested `IF` / inlined |
| D | `++` (Excel's tolerated double unary plus) | `#VALUE!` | `normalizeFormulas` (FR-3) |
| E | literal newlines inside a formula | `#NAME?` | `normalizeFormulas` (FR-3) |
| F | **`INDEX(...)` in COMPOSITION** — `=INDEX(r,2)` is fine, `=INDEX(r,2)*2` returns **0** | silent wrong values | **never emit INDEX-in-composition** for this engine (FR-2) |
| G | **`<operator><space>(`** — even `=2 * (1+2)` fails | `#NAME?` for the WHOLE cell | quote-aware op-space strip in `normalizeFormulaText` (FR-4/FR-5) |

**Standing caution:** F and G are ENGINE limits, not data problems. Never emit `INDEX` inside a larger
expression; never leave a space between an operator and a following `(`. VLOOKUP against a key-first helper
pair is the sanctioned lookup pattern.

### Transport — gzip multipart (owner call: future-proofing over minimal fix)

The old shape nested `workbook_json` as a JSON **string** inside the request object, escaping every quote
(measured **1.23x**), which took Electrical to **25.91 MB** against the site's **25 MiB** `max_file_size` -> **413**.
Now: `serializeSheets` -> gzip (`CompressionStream`) -> `multipart/form-data` field `workbook_json_gz`.

| | Before | After |
|---|---|---|
| Electrical create | 25.91 MB -> **413** | **0.736 MB, HTTP 200, 2.8 s** (~**35x** smaller, 3.4% of the ceiling) |
| ELV create | — | 0.134 MB, 265 ms |
| ELV save | — | 0.142 MB, ~400-520 ms |

**No limit or config change was made** (explicitly out of scope, and unnecessary once gzipped).
Backend: `create_workbook(title)` / `save_workbook(name)` are thin wrappers reading + gunzipping the upload and
delegating to `_create_workbook` / `_save_workbook`, which carry ALL prior logic (access gate, lock rules,
versioning, pruning, JSON validation) unchanged. `_gunzip_payload` enforces `MAX_DECOMPRESSED_BYTES` (200 MB).
**The old `workbook_json` body param no longer exists on those two endpoints — single path, no fallback.**
The pricing page is the only product caller (grep-verified).

### Save-time normalization + the RE-ENTER-LIVE design (FR-5/FR-6)

The op-space bug is reachable from live typing, not just import: a user typing `= A1 * (B1+C1)` would store a
formula the engine renders as `#NAME?`. Two passes now run on every save:

1. **`reenterNormalizedFormulas`** — BEFORE serializing, any formula the normalizer would change is pushed back
   through the ENGINE so it recomputes a real value. **Must pass the formula as a plain STRING**: the object
   form `setCellValue(r,c,{f:"..."})` is accepted without error but leaves the cell empty (verified live).
2. **`serializeSheets`** — the final guard; normally a no-op after (1). If it still has to change an `f`, it
   drops that cell's stale `v`/`m` so nothing persists a value contradicting its formula.

Why not simply clear the cached value: this engine **never evaluates formulas at load**, it renders the cached
value. A dependency-free formula (`= 5 * (1+1)`) would then read `#NAME?` forever. Re-entry makes the value
correct *immediately on save*, which is what the user sees.

### Verification — full matrix, live, both workbooks

| Check | Result |
|---|---|
| 4a baseline vs FIXED source | PASS |
| 4b S1 | **F9 317, F10 694, F11 2523, F14 320, B4 1400, C4 280, D4 1680, B7 970** — exact |
| 4c S2 | **F9 951, F10 347, F12 960, F13 79, F14 640, B4 1080, C4 220, D4 1300, B7 750** — exact |
| 4d S3 | perturb + return, exact |
| 4e previously-inert + op-space cells | 17/17 real numbers, **0 errors**; X9 263->491, U4 164->166, U6 114->123 prove live recalc |
| 4f ELV | B9 40->19: **A4 400, B4 120, A5 180**; ->40: **700/240/317**; A17 1285->1435->1285; Extinguisher 15500->1480->15500 |
| 4g typed-spaces | ELV `D51` and Electrical `D61`: `#NAME?` pre-save -> **10 / 21 immediately after Save** -> reload holds -> stored `f` clean, stored `v` correct |
| 4h HVAC | byte-identical, untouched all session |

Census on both stored workbooks: **0 escaped names, 0 newlines, 0 `++`, 0 INDEX, 0 operator-space-paren.**
Backend suite **16/16** (13 retargeted to the internals + 3 new: gunzip round-trip, corrupt gzip rejected,
decompressed-size guard).

### Frozen baselines (standing regression instrument)

- `Electrical_baseline_v1_20260723_1530.json` — 17 sheets, 6,954 formulas, opSpace 0
- `ELV_baseline_v1_20260723_1530.json` — 14 sheets, 968 formulas, opSpace 0

Both on the owner's Desktop, captured at shipped-state inputs. **Reuse these with the same expected-value
tables for any future engine/import change** (compare-with-tolerance).

### The hidden-tab instrument lesson (cost two slices)

FR-5 reported "the Electrical workbook never finishes rendering — user-visible defect". **That was WRONG.**
Every measurement had been taken in a **hidden browser tab**, where Chrome suspends `requestAnimationFrame`
(so Luckysheet never paints) and throttles `setInterval` to ~1/min (which manufactured convincing "61s/60s/60s
blocked main thread" readings). The tell was that the gaps were ~60 s **regardless of workbook size**. With the
tab visible, Electrical renders in **4 seconds**. The control that proved it: ELV — edited successfully earlier
— failed identically while hidden.

**STANDING GUARD: every browser measurement in this module asserts `document.visibilityState === "visible"`
first and aborts otherwise.**

### Univer spike — RUN 2026-07-24 (headless, chat-Claude container), verdict: PARKED by owner

Time-boxed evaluation of **Univer** (`0.10.x`-era `preset-sheets-node-core`) against the SAME engine-caution
matrix Luckysheet is compensated for. **Univer passed ALL seven ENGINE CAUTIONS natively**, and — critically —
evaluates formulas at load and computes a raw multi-condition array INDEX/MATCH with no helper columns:

| Probe (the Luckysheet failure mode) | Univer result |
|---|---|
| CAUTION #2 — operator-space `=2 * (1+2)` | **6** (Luckysheet: `#NAME?`) |
| CAUTION #1 — INDEX in composition `=INDEX(r,2)*…` | **183.62** (Luckysheet: `0`) |
| CAUTION #5 — erroring UNTAKEN `IF` branch | **82.55**, no error propagation (Luckysheet propagates) |
| CAUTION #5 — `ISTEXT("#N/A")` | **TRUE**, no coercion to the #N/A error (Luckysheet coerces) |
| engine-absent `IFS` / `LET` / `XLOOKUP` | native **42 / 10 / 82.55** |
| CAUTION #3 — `VLOOKUP(...,FALSE)` | ok (Luckysheet: `#NAME?` — we emit `,0)`) |
| PW-2d — `&`-concatenation-key `VLOOKUP` | ok (Luckysheet setCellValue re-entry throws) |
| **RAW multi-cond array `INDEX/MATCH`** | **computes NATIVELY 82.55** (the whole helper-column apparatus is unneeded) |
| FR-6 — formula with NO cached `v` | **EVALUATES AT LOAD** → 42 (Luckysheet renders blank) |

**Not tested (deferred to any future live phase):** 22 MB browser render performance; a Luckysheet-JSON →
Univer-snapshot converter over the real workbooks; Univer's data-validation UX.

**Owner decision 2026-07-24 — PARK.** Stay on Luckysheet + the documented compensators; monitor the current
setup's performance in production. **Revisit triggers (explicit):** (1) an ENGINE CAUTION bites a real user in
production; (2) before building any major new formula-heavy feature on this module; (3) sustained performance
complaints. **Estimated migration cost if triggered:** 2-4 sessions, dominated by the data converter +
re-verification against the frozen baselines above (the baselines exist precisely to make this measurable).

**Survives-regardless:** freeze / clamp / decode / report are needed under ANY engine — they fix FORMAT
problems (dead-Google formulas, trailing-row bloat, LuckyExcel name-escaping, the import receipt), not engine
problems, so a future migration keeps them.

### Deploy notes (Abhishek)

- **This slice changes the BACKEND** (`api/pricing/workbook.py`) — first backend change in the pricing module
  since PM-1. Deploy backend + frontend together; the two endpoints' payload shape changed.
- **16 tests**: `bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.pricing.test_pricing_workbook`
- **Verify production nginx `client_max_body_size`** — payloads are now ~0.1-0.8 MB so any sane value clears
  them, but **verify, do not assume**; nginx sits in front of Frappe's own limit and returns an identical 413.

### Standing cautions carried forward

- Never emit `INDEX`-in-composition; never emit `<operator><space>(`.
- Future imports carrying array / `IFS` / `LET` formulas need the **offline preparation recipe** (rewrite to
  VLOOKUP + key-first helper pairs) before import.
- `Cable Allocation!A3:E3` carries a **pre-existing source `#REF!`** — owner-side spreadsheet repair, not ours.
- **The old degraded Desktop Electrical copy must never be imported** (it caches `#NAME?` in 17 cells).
- **ELV inert residue on record:** `Sprinkler with Markup!D51` (and `E51`) are empty formatting shells
  (`{"ct":{"fa":"General","t":"e"}}`) left by FR-6's scratch testing — no formula, no value, harmless.
- **C2 ruling (owner, this session):** the pricing-module deferred inventory is its OWN list, separate from the
  BoQ arc ceiling.

### Freeze

**LIFTED.** Electrical (`1rf9ho8i02`) and ELV (`2l34c06unk`) are cleared for team editing.

## DV arc — dropdowns imported (DV-1 recon -> DV-2 delivered) 2026-07-23

**Problem:** LuckyExcel silently DROPS every `<dataValidation>` on import, so all three workbooks had zero
dropdowns (DV-1 Q2 verified: no `dataVerification` key on any of them). The engine supports them fine — it
just never received them.

### Engine schema (DV-1 Q1, read from the vendored source)

- Per-sheet key **`dataVerification`**, a flat map **`"<row>_<col>" -> record`, 0-indexed, PER CELL** — there
  is no range-spanning record, so an Excel `sqref` of `C6:C8` becomes three identical records.
- Record = the engine's own `defaultItem`:
  `{type:"dropdown", type2:null, value1, value2:"", checked, remote, prohibitInput, hintShow, hintText}`.
- **`value1` is polymorphic** (`getDropdownList`): if it parses as a range the engine reads that range —
  **cross-sheet included, and quoted names containing spaces and `&` work** (`'Switches & Sockets'!$B$3:$B$22`
  verified live on real data); otherwise it is `split(",")` as a literal list.
- `serializeSheets` does NOT strip `dataVerification`, so dropdowns survive save/round-trip unchanged.

### Import extension (`pricingValidations.ts`)

Runs in `handleImport` after `decodeSheetNames` + `normalizeFormulas` (sheet matching needs DECODED names).
Re-reads the SAME uploaded .xlsx with the **vendored JSZip global** (`window.JSZip` — NOT an npm import, which
would bundle it), parses both `<dataValidation>` and the **`x14:` extLst variant**, keeps `type="list"`,
entity-decodes `formula1`, expands each `sqref` into per-cell records, and attaches them.

- **Extent clamping:** range sources authored as `'FA System Purchase price'!$A$2:$A50498` are clamped to the
  source sheet's real data extent + 5. The engine walks the whole range and de-dupes on EVERY dropdown open,
  so an unclamped 50k-row source costs 50k iterations per click. Sheet qualifier and quoting are preserved
  byte-for-byte; only the trailing row number changes. Literal lists are untouched.
- **`prohibitInput: false` everywhere — DECISION ON RECORD, owner-vetoable.** Advisory mode: the engine still
  flags an off-list value with a red corner triangle but does not block the edit. A hard block on estimation
  data is a workflow call, not a technical one.
- **Never blocks an import** — validation parsing is wrapped; a failure returns 0 records and the workbook
  still imports.

### ⚠️ Enforcement caveat (DV-1 Q3.4) — what dropdowns actually protect

| Path | `prohibitInput:false` (ours) | `prohibitInput:true` |
|---|---|---|
| user TYPES in the cell | accepted, red-triangle flag | rejected (toast + edit cancelled) |
| **programmatic write** (`setCellValue`) | **accepted silently** | **accepted silently — NOT enforced** |

Our own code paths (import, the FR-6 re-entry pass, any bulk write) bypass validation entirely. **Dropdowns
are a data-entry convenience, not a data-integrity guarantee.**

### STEP-0 READINESS GATE — now standing practice for ANY reimport

Run BEFORE any backup/delete (the FR-3 lesson: that slice deleted first and discovered the blocker after,
leaving the owner with nothing). Kill-list, any hit = STOP with nothing touched:
**ArrayFormula · `IFS(`/`LET(` · `INDEX` (any) · operator-space-paren surviving a simulated normalize ·
any function outside the engine's 371-function set** (this last one ADDED after DV-2's first run — the
kill-list as originally written would have let `XLOOKUP` through).

It fired on the first DV-2 attempt: HVAC's `ADP!C167` carried an ArrayFormula + newlines + `XLOOKUP` in one
cell. Repaired offline to a single-line `VLOOKUP` against a hidden `Ducting!$M$7:$N$12` helper pair; re-run
passed all three. **Nothing was deleted on the failed run.**

### Full three-workbook reimport (owner call: HVAC included)

HVAC went through the pipeline for the FIRST time — its stored content was replaced by the xlsx, discarding
any post-import stack edits (recoverable from `HVAC_predv2_20260723_1800.json`) and resetting version history
to v1. Its long-standing single newline formula is now gone (census newline 0).

| Workbook | **NEW docname** | Sheets | Formulas | **DV records** | create POST |
|---|---|---|---|---|---|
| Electrical Pricing | **`oa42mh7ec2`** | 17 | 6,954 | **78** | 200, 2,174 ms, 0.737 MB |
| ELV Pricing | **`p7dg9q4nab`** | 14 | 968 | **20** | 200, 344 ms, 0.135 MB |
| HVAC Pricing | **`q7db78bo3r`** | 17 | 1,507 | **8** | 200, 1,181 ms, 0.579 MB |

Expected-vs-got matched exactly on every sheet (106 records total). HVAC's 8 land on precisely the predicted
cells: `Ducting` C23/C24/C26/C27 and `ADP` B165–B168.

**Census-zero holds on all three:** escaped names 0, newlines 0, `++` 0, INDEX 0, operator-space-paren 0.

### Verification highlights

- **Dropdowns live:** inline (`100,150,200,…`), same-sheet, cross-sheet, and **cross-sheet-with-`&`** on real
  data (`'Switches & Sockets'!$B$3:$B$22` -> 10 options). Selection writes the value (`24G` -> `26G`).
  Off-list typed value accepted with the advisory flag, as designed.
- **Electrical S1 exact:** F9 317, F10 694, F11 2523, F14 320, **B4 1400, C4 280, D4 1680, B7 970**.
  (Note: S1 quantities D9:D14 have no dropdowns — they are free entry; dropdowns sit on the C-column
  selectors.)
- **ELV via its dropdown:** picked "19" from B9's list -> **A4 400, B4 120, A5 180**; back to "40" ->
  **700/240/317**.
- **HVAC baseline vs xlsx:** 10 spot cells match including the repaired **`ADP!C167` = 807.3**.
- **Round trip per workbook:** save -> reload -> dropdowns still present AND functional; versions bumped;
  locks NULL.

### Baselines v2 — SUPERSEDE v1

- `Electrical_baseline_v2_20260723_2000.json` (78 DV) · `ELV_baseline_v2_20260723_2000.json` (20 DV) ·
  **`HVAC_baseline_v2_20260723_2000.json` (8 DV — HVAC's first baseline)**

Pre-reimport backups retained: `*_predv2_20260723_1800.json` for all three.

## PW-2a — DELIVERED 2026-07-23 (role split · Sandbox · Replace-from-Excel · save-time advisory)

Closes the "Role tightening" line that PM-3+ had deferred to an owner call. Four changes, one flag
(`isPricingAdmin`) tying the first three together.

### 1. Read / write gate split (backend is the boundary)

`api/pricing/workbook.py` gains `PRICING_WRITE_SET = {"Nirmaan Admin Profile"}` and
`_require_pricing_write_access()`, **layered on** the existing read gate (not a replacement) so the messages
stay honest for two different audiences: someone outside the module still gets "You do not have access to the
Pricing Module", while an estimation user — who IS in the module — gets "Pricing workbooks are read-only for
your role." Four call sites change (`checkout`, `release`, `_save_workbook`, `_create_workbook`); the read
endpoints (`list_workbooks`, `get_workbook`) and the gzip/multipart wrappers are untouched.

- **read** = admins + estimation (unchanged `PRICING_ACCESS_SET`)
- **write** = admins only (`Administrator` user, or the `Nirmaan Admin Profile` role_profile_name / role —
  it exists as BOTH, DB re-verified 2026-07-23)

`PricingRoute` in `ProtectedRoute.tsx` is deliberately **UNCHANGED**: estimation users must still enter the
module (they get read + Sandbox). The recon's Q5 caution stands — do not tighten the route guard.

### 2. Role derivation on the page (UX only)

`useUserData()` already supplied `user_id`; PW-2a also destructures `role` (from `Nirmaan Users.role_profile`)
— **no new fetch**, the SWR key is already warm from `PricingRoute` one component above.

    isPricingAdmin = user_id === "Administrator" || role === "Nirmaan Admin Profile"

The action bar is gated on `roleResolved = role !== "Loading"`, rendering a neutral "Checking permissions…"
while the `Nirmaan Users` doc is in flight. Without it an admin briefly sees the estimation bar — the recon
flagged this and it is real, because the page's own load runs concurrently with the role fetch.

### 3. Sandbox — available to BOTH roles (owner call)

A local, never-persisted edit session. `handleEnterSandbox` re-reads the workbook and re-inits the engine with
`allowEdit: true` **without any checkout**, so nothing is locked and nothing can be written. Persistent amber
banner + "Exit Sandbox"; exit RE-FETCHES from the server rather than replaying a cached array (the engine may
mutate the array it was created with, so a kept reference is not a trustworthy pristine snapshot).

Why this is safe rather than merely untested — three independent reasons, all recon-verified:
1. `releaseBeacon` hard-guards on `lockMineRef.current`, which only `handleEdit` ever sets. A sandbox session
   leaves it false, so neither the `beforeunload` beacon nor the unmount call fires. **Do not replace that
   guard with a `sandbox` condition** — the ref is the single truth for "do I hold the lock".
2. Save/Release render only under `lock === "mine"`, which a sandbox session never reaches.
3. The engine's own server-persistence path (`pd.saveParam` -> `$.post(updateUrl)` / websocket) is gated on
   `allowUpdate`, whose engine default is `false` and which the page never passes. **NEVER set
   `allowUpdate: true`** — the engine would then POST its own deltas autonomously, outside the lock, outside
   `save_workbook`, and outside the Sandbox guarantee. A comment in `initSheet` says so at the site.

Also confirmed absent: no Ctrl+S binding anywhere in the vendored bundle (grepped `keyCode==83` / `which==83`
in every form: zero hits), and no toolbar save item. The Save button is the ONLY save-triggering surface.

### 4. Replace-from-Excel — as a SAVE, not a create

Admin + lock held. Reuses the FULL import pipeline (`runImportPipeline`: LuckyExcel -> `decodeSheetNames` ->
`normalizeFormulas` -> `attachDataValidations`), now promisified and shared with the empty-state import so both
paths convert byte-identically.

**Why save_workbook and not create_workbook:** `Pricing Workbook.title` is `unique: 1`, so a second create
raises DuplicateEntryError. Save also gives the previous content back for free as a version snapshot — a
delete-and-recreate would destroy version history AND the access log. Payload shape is identical between the
two endpoints (both `JSON.stringify(serializeSheets(sheets))` gzipped into `workbook_json_gz`); only the text
field differs (`title` vs `name`).

**Lock refresh before the POST:** `performReplace` re-calls `checkout` first. Converting a large .xlsx can take
minutes and the server lock auto-expires at 30; `checkout` is idempotent for the current holder (the
"held by someone else" branch is skipped) and re-stamps `checked_out_at`. Live-verified: access log shows
`checkout` at 19:34:20 immediately before `save` at 19:34:23.

Confirm-first: an AlertDialog states that the entire content is replaced, that current content is preserved as
version history, and that unsaved edits are discarded. Nothing is sent until the user confirms.

No assumption anywhere that a workbook's sheet set is stable across saves — checked the registry (path/title/
label only), page state (no sheet-keyed state at all), `serializeSheets` (keeps `dataVerification`), and the
backend (`_normalize_json` validates JSON only). A replace may change the sheet set freely.

**DEFERRED:** a dedicated `"replace"` value on the Access Log `action` Select. This slice logs the existing
`"save"` action; the doctype JSON is untouched (no migration this slice).

### 5. Save-time formula advisory — WARN-ONLY (2c)

New PURE module `pricingFormulaScan.ts`, scanning `sheets[].celldata[].v.f` **after `serializeSheets`** — the
recon's exact slot, so what is warned about is exactly what would be persisted (`serializeSheets`' final
normalization guard can still rewrite `f`). Three rules:

1. **INDEX anywhere** — ENGINE CAUTION #1. `=INDEX(r,2)` is fine but `=INDEX(r,2)*2` silently returns **0**.
   Detecting "in composition" needs a real expression parse; flagging INDEX anywhere is the honest cheap rule.
   Advisory, so a false positive on a bare INDEX costs one dismissible line while the silent-zero case is
   never missed.
2. **XLOOKUP / IFS / LET** — grep-confirmed absent from the vendored bundle (all three zero hits while
   SUMPRODUCT returns five, so the grep discriminates).
3. **Any name outside the engine's own registry.**

**`window.luckysheet_function` route: DYNAMIC (taken).** Live-checked on the loaded page before building:
it is a plain object keyed by UPPERCASE function name, **371 entries**, with `INDEX`/`VLOOKUP`/`SUM`/`MATCH`
present and `XLOOKUP`/`IFS`/`LET` absent. `supportedFunctionsFromEngine()` consumes it and returns `null` when
the global is missing or implausibly small (<50 keys), in which case the unknown-name rule is **skipped**
(fail-OPEN — a missing registry must never manufacture a warning on every formula); the explicit rules 1-2
still fire. So no hand-kept function list was needed.

Quote-awareness is load-bearing and covers BOTH kinds of quoting: `"..."` string literals AND `'...'` sheet-name
references. Missing the single-quoted case would flag a sheet named `'Sheet (old)'` as a call to a function
"SHEET". Function detection anchors on an identifier immediately followed by `(`, which is what keeps cell
references and range names out.

Structure per the recon: `handleSaveClick` (re-entry -> serialize -> scan; if hits, open dialog and return) +
`performSave` (the POST), so Continue posts the SAME payload that was scanned and does **not** re-run the
400 ms re-entry pass. Replace runs the same scan on its converted payload, and one dialog covers both.

**PW-2b upgrade path:** the module is pure and side-effect free precisely so consent-based FIXING becomes a
caller change, not a rewrite. `FormulaScanHit` already carries `row`/`col` for exactly that.

### Verification — live, 2026-07-23

Backend suite **16 -> 19**, all pass (`bench --site localhost run-tests --app nirmaan_stack --module
nirmaan_stack.api.pricing.test_pricing_workbook`, `Ran 19 tests ... OK`). Retargets: writes now run as an
`ADMIN_USER` fixture through `_create_as`; the two lock-exclusivity tests needed a SECOND write-capable actor
(`ADMIN_USER2`) because an estimation user is now refused by the gate before the lock check is reached, which
would have proven nothing about exclusivity. `POS_USER` keeps the read assertions (in
`test_access_log_written_on_open_and_save` it now also proves reads still audit for estimation users). Three
new: `test_estimates_user_can_read_but_not_write`, `test_admin_profile_user_can_write` (a non-Administrator
carrying the role — a gate that only let Administrator through would pass every other test in the file),
`test_write_gate_precedes_lock_check`.

`pricingFormulaScan.test.ts` — **31 vitest checks**, positive AND negative (bare `=INDEX` flagged, `=VLOOKUP`
not, unknown function flagged, quoted `"INDEX"` text NOT flagged, `'Sheet (old)'` NOT flagged, fail-open with
no registry).

Live (Electrical, versions 2 -> 6 across the session):

| Check | Result |
|---|---|
| Admin bar | Edit + Sandbox; on lock: Save + Replace from Excel + Release |
| Sandbox (admin) | banner shown; `B19=7`, `B20 ==B19*3` -> **21** recalc; `checked_out_by` NULL throughout |
| Exit Sandbox | edits discarded, banner gone, bar restored, lock still NULL |
| Edit/Save/Release regression | v2 -> v3, "Saved at", lock taken then cleared — unchanged behaviour |
| Advisory fires | `=INDEX(A1:A5,2)*2` in B22 -> engine shows **0** (CAUTION #1 live) -> dialog lists `ALL ITEM WISE RATE — B22` + reason |
| Advisory Cancel | dialog closes, **version stays 3**, nothing saved, lock retained |
| Advisory Continue | v3 -> v4; v4 snapshot contains the INDEX formula |
| Clean save | formula deleted -> **no dialog**, v4 -> v5 |
| Zero-hit save | the two benign saves showed no dialog at all |
| Replace | confirm dialog -> v5 -> **v6**, 17 sheets restored |
| Replace content | 11 spot cells match the source .xlsx exactly (S1 B4/C4/D4/B7/C9/C16, Point Wiring A1, Wiring&cabling B3/C5, Switches&Sockets B3/C5) |
| Dropdowns after replace | **78 records across 5 sheets** — survived the round-trip |
| S1 chain after replace | with scenario qty D9=1, D10=2, D11=1 (D14=1, colour Grey): F9 **317**, F10 **694**, F11 **2523**, F14 **320**, B4 **1400**, C4 **280**, D4 **1680**, B7 **970** — all eight exact |
| Version history | v5 retained as the pre-replace snapshot; v4 holds the INDEX formula |
| Estimator API (as `pricing-test@nirmaan.app`) | list + get **OK**; checkout / release / save / create **all PermissionError** ("read-only for your role"); version + lock unchanged; no stray workbook; access log shows **`open` only, never `checkout`** |

**S1 chain note (do not misread the baseline):** `1400/280/1680` is a SCENARIO value, not the file's saved
state. The pristine FIXED source stores `B4 120 / C4 30 / D4 150` because S1's quantities D9:D14 are free entry
and ship empty except `D14=1`. The chain is `B4 = ROUNDUP(Σ Fᵢ × (1−0.75) × (1+0.45), −1)` = `Σ × 0.3625`;
`3854 × 0.3625 = 1396.775 -> 1400`, `C4 = ROUNDUP(1400 × 0.2, −1) = 280`, `B7 = ROUNDUP(3854 × 0.25, −1) = 970`.
Reproducing it requires entering those quantities. Recorded here so the next session does not read the
pristine 120/30/150 as a regression.

### Throwaway test user — REUSE, do not delete

`pricing-test@nirmaan.app` ("Pricing Test"), `role_profile_name` + `Nirmaan Users.role_profile` =
`Nirmaan Estimates Executive Profile` (granting roles `Nirmaan Estimates Executive` + `System Manager` —
neither is in the write set, which is what makes it a valid negative actor). Created in-session via bench
console, owner-approved; NOT a committed patch. Password generated to the site's enabled policy
(`minimum_password_score = 2`; generated score 4) and recorded in the PW-2a Desktop report **only**.

**Retained deliberately** for the owner's production lock/denial tests, then retired by the owner. Do not
delete it as cleanup.

### Deferred out of PW-2a

- **Navigate-away warning for an unsaved Sandbox session** (owner call). Needs a dirty signal the page does not
  track today — the engine exposes no dirty flag the page reads, and `beforeunload` no longer warns because the
  beacon returns early when no lock is held.
- **A dedicated `"replace"` Access Log action value** (doctype Select untouched this slice).
- **The estimates Role-vs-Profile divergence**: `useUserData` reads only `Nirmaan Users.role_profile`, so a user
  holding the bare `Nirmaan Estimates Executive` ROLE with no matching profile passes the backend read gate but
  is bounced by `PricingRoute`. Pre-existing, unchanged by PW-2a, still an owner call.

## PW-2b-i — DELIVERED 2026-07-23 (formula parser + transform suite + row clamp)

Turns a RAW workbook into one the vendored engine can actually evaluate, inside the import pipeline.
Headless: no UI (that is PW-2b-ii). Four new PURE modules, none touching React.

| Module | What |
|---|---|
| `pricingFormulaAst.ts` | Excel-formula tokenizer + recursive-descent parser + normalizing printer |
| `pricingTransforms.ts` | the six rewrites + dead-Google freeze + stage orchestrator + the report contract |
| `pricingHelpers.ts` | helper-column allocation/materialization, `_mk` marker, idempotency |
| `pricingClamp.ts` | row-bloat clamp |
| `__fixtures__/corpusFormulas.ts` | 9 real corpus formulas, provenance-annotated |
| `__fixtures__/convertedCorpus.json` | 423 KB formula-only projection of all 4 converted workbooks |

### Authoritative stage order (each position is load-bearing)

```
LuckyExcel -> 1 decodeSheetNames -> 2 clampRowBloat -> 3 normalizeFormulas
           -> 4-6 runFormulaStage (freeze -> transform -> materializeHelpers)
           -> 7 attachDataValidations
```

- **decode FIRST** (FR-1): sheet NAMES arrive HTML-escaped, formula text does not.
- **clamp SECOND — a PERFORMANCE PRECONDITION, not tidiness.** Raw ELV converts to 1,819,874 cells of
  which 98.8% are style-only filler; every later stage walks celldata (ELV -> under 30,000 after).
- **normalize BEFORE the parser** so it never meets a raw newline mid-token.
- **DV LAST, and after the clamp** — `clampRangeSource` clamps a dropdown source to the sheet extent
  +5, so running it on the bloated grid would clamp to ~50,503 instead of ~30 and reinstate exactly
  the per-dropdown cost DV-2 removed.

### Parser — why an AST, and the abstain philosophy

Transforms COMPOSE inside one cell (an IFS whose branches are each a multi-condition array
INDEX/MATCH; a LET wrapping another). Independent regex passes would corrupt each other. One
bottom-up `mapNode` handles composition for free — and it is also what stops LET inlining from
duplicating an expensive lookup (by inline time the binding is already a cheap VLOOKUP).

**Abstain is a first-class outcome.** Anything not understood is left UNTOUCHED and reported; the
parser never throws into the pipeline. A rewriter that guesses is far worse than one that declines.

⚠️ **Array formulas carry NO marker after conversion** — no `t:"array"`, no braces; the cell keys are
just `f, ct, bg, fs, …, v`. Detection is therefore BY SHAPE (`MATCH(1,(a=x)*(b=y),0)`).

### The five defects live verification found (none were catchable by unit tests)

1. **Only the first helper pair per sheet materialized** — the idempotency check ran per record, so
   the `_mk` it had just written made every later pair on that sheet look pre-existing while the
   rewritten formulas still pointed at them. Fixed with a pre-pass snapshot of sheets that already
   had helpers.
2. **`,FALSE)` returns `#NAME?`** — the engine rejects boolean literals. All generated VLOOKUPs emit
   `,0)` (`EXACT_MATCH`), matching the FIXED workbooks' own convention.
3. **Helpers written as bare formulas read blank at load** — the engine never evaluates at load, it
   renders the cached value (FR-6), so every lookup returned `#N/A`. Helpers now carry `f` **and** a
   pipeline-computed `v`.
4. **LuckyExcel emits numeric cells as UNTYPED STRINGS** (`{v:"1.0"}`, no `ct.t === "n"`), which the
   engine normalizes to `1` on load — so a key built verbatim never matched. Canonicalized by SHAPE.
5. **The engine evaluates ALL IF branches and propagates any branch error** (it does not
   short-circuit). Generated lookups inside IF/IFS branches are wrapped in `IFERROR`.

### Conventions these produced (all owner-approved)

- **Helper columns**: `f` + computed `v`, `_mk` marker in the header row, key `=A2&"|"&B2`, value
  mirrors the result column, pair allocated at `maxCol + 2`, hidden via `config.colhidden`. A source
  cell that is itself an unevaluated formula yields an EMPTY key for that row — never a partial key
  that could match the wrong record.
- **`,0)` not `,FALSE)`** in every generated VLOOKUP.
- **Numeric canonicalization by SHAPE** (`NUMERIC_LIKE`), never by `ct.t`. ⚠️ **Never trust `ct.t` on
  converted (pre-load) celldata** — only the POST-load cell carries the numeric type, which is what
  makes the trap convincing.
- **`IFERROR` around generated lookups inside IF/IFS branches only.** Standalone lookups stay bare
  and honest. ⚠️ **The fallback token must not be error-spelled**: the engine coerces the literal
  string `"#N/A"` back into the `#N/A` error, which re-poisons the very IF the wrap protects
  (`ISTEXT("#N/A")` is `false`). See BRANCH_MISS_FALLBACK.
- **Criterion-range harmonization**: when criterion + result ranges share a start row and a strict
  MAJORITY span, an outlier whose END differs by <= `MAX_HARMONIZE_ROWS` (2) is pulled onto the
  consensus and reported as class `harmonized`. A tie, a differing start row, or a bigger gap still
  abstains. Owner-adjudicated from the data: Electrical Z10's `Termination!B2:B97` is a typo for
  `B2:B96` (row 96 ends the <=25 sub-table; row 97 opens the table the formula's OWN second branch
  reads as 97:297).

### ImportReport — the PW-2b-ii dialog's data contract

```ts
{ transforms: TransformRecord[]   // sheet, cell, row, col, classes[], oldF, newF, note?, helpers?
  helpers:    HelperRecord[]      // sheet, keyCol, valCol, rows, criteriaCols, resultCol, reused
  frozen:     TransformRecord[]   // newF === null; cached value kept
  abstained:  AbstainRecord[]     // formula + reason -- the decline list, never hidden
  clamp:      ClampRecord[]       // sheet, fromRow, toRow, cellsDropped
  counts, perSheet }
```

`runImportPipeline` returns `{sheets, report}`; both callers log the summary until the dialog lands.

### ⚠️ Testing lesson worth carrying forward

The Tier-1 tests assert the **emitted formula TEXT**, which is correct — and they structurally
**cannot** see that the engine mis-reads that text at runtime. Defects 2, 4 and 5 were all invisible
to a green suite. **Anything about engine SEMANTICS has to be proven in Tier-3.**

### Verification

Tier 1/2: **135 vitest checks** across 4 files. Tier 2 runs the whole stage chain over the real
converted corpus and asserts on the CENSUS (helper columns land at `maxCol+2`, so formula-text
equality against the human-authored FIXED workbooks would fail for reasons that do not matter):
kill-list zero, helper key-formula regex, ELV 1,819,874 -> under 30,000, idempotency, and
**pipeline(FIXED) a total no-op** (0 transforms / 0 freezes / 0 helpers / 0 abstains / 0 clamp).

Tier 3 live on Electrical: RAW replace -> `index-match-multi=27 ifs=9 let=2 harmonized=1
index-match-single=4 helpersAdded=22 cellsDropped=92023`, **abstains 0**, zero advisory rows, 78
dropdowns re-attached -> S1 dropdown-driven chain **1400 / 280 / 1680 / 970 exact** -> restore to
FIXED (no-op, zero advisory rows).

### Someday-list

- **Fix `Termination!B2:B97` -> `B2:B96` in the MASTER Excel source.** The pipeline harmonizes it on
  import, but the workbook itself still carries the typo, so Excel users see the misaligned result.

## PW-2b-ii — DELIVERED 2026-07-24 (import report dialog + consent-based live fix). **PW-2b ARC CLOSED.**

Two new frontend modules + a backend prune fix, consuming the PW-2b-i modules unmodified (no additive
exports needed — `transformFormula`/`HelperAllocator` were exported; `FormulaScanHit` already carried
`row`/`col`/`formula`, so `pricingFormulaScan.ts` was untouched).

### Import report dialog (`ImportReportDialog.tsx`)

Renders the PW-2b-i `ImportReport` as a receipt. Three variants, one body: `replace` (merged with the
destructive confirm — warning + report + Cancel/Replace), `import` (empty-state first import), `view`
(re-open the LAST report from the action bar, Close only). Body = summary counts, a scrollable
old->new table (abstain + IMPORTRANGE-flag rows styled amber), a clamp line, and a collapsed helpers
list. Shown on import/replace when the report is non-trivial; a **pure no-op report skips the report
SECTION** (the destructive replace-confirm still shows). `lastReport` is **session-only** — persistence
across reloads is deferred.

### Consent-based live fix (`pricingLiveFix.ts`)

The advisory dialog gains a per-hit `[Fix]` (eligible) / "needs Replace from Excel" (helper-needing) /
"no automatic fix" status, plus a "Fix all fixable" bulk action. **Eligibility is NOT a hand-kept
class list**: `assessFix` runs the hit's formula through the SAME `transformFormula` entry point and is
fixable iff it yields a rewrite with **ZERO helper requests** (`helpers.length === 0`) or a dead-Google
`freeze`. That automatically covers IFS / LET / XLOOKUP / direct single-cond INDEX/MATCH and excludes
multi-cond INDEX/MATCH — if the transform suite ever changes which classes need helpers, this tracks
it for free. **Helper-needing classes are deferred to Replace** (writing helper columns in a live edit
session mutates a second sheet and is hard to undo on Release — recon Q7). Application mirrors FR-6:
`setCellValue` with the plain formula STRING (never the object form, which leaves the cell empty),
the target sheet's `order`, and active-sheet restore. After a fix the dialog re-serializes + re-scans;
remaining hits stay listed; the fixed cell **rides the same Save** (no separate cycle) — "Save anyway"
with hits remaining, "Save" at zero.

### The version-prune backend defect (latent, pre-existing — surfaced by PW-2b-ii's 21st save)

`_prune_versions` deleted old snapshots with `frappe.delete_doc`, which loads the doc and calls
`as_dict()`/`as_json()` — tripping the list-valued-JSON load wall ("Value ... cannot be a list") on any
version whose `workbook_json` is an imported ARRAY. It only fires on the **21st save** (the first that
deletes a snapshot beyond `MAX_VERSIONS = 20`), so it was latent since PM-1 and invisible to
`test_version_pruning_keeps_max_20` (which used DICT payloads). **Fix:** delete via raw
`frappe.db.delete(VERSION_DT, {"name": row.name})`, which never hydrates the doc — the same dodge
`checkout`/`release` use (`db.set_value`) and the test's `_purge_all` uses. New
`test_version_pruning_survives_list_payloads` (>20 LIST-shaped saves) covers it; backend suite **19 ->
20**. This was a real production risk: *every* pricing workbook would have become unsaveable past 20
saved versions.

### The 4b clamp-on-FIXED nuance — DESIGNED behaviour

Replacing with a FIXED source shows a **clamp-only** report ("90,700 empty cells trimmed"), not a bare
confirm, because the FIXED xlsx genuinely carries trailing empty-row bloat and spec-1 lists clamp-drops
as a report trigger. This is correct — suppressing a real 90k-cell trim would hide a genuine change to
the persisted content; the transform-level no-op (0 rewrites/freezes/abstains) is intact. **Deferred:**
regenerate the FIXED source workbooks bloat-free someday so their re-import is a total no-op.

### Verification

Frontend **145 vitest** (`pricingLiveFix.test.ts` +10: IFS/LET/XLOOKUP/direct-single fixable;
multi-cond + result-left single -> "needs helper columns"; unknown-fn + bare-INDEX -> "no sanctioned
rewrite"; DUMMYFUNCTION -> freeze). Backend **20** (`... run-tests --module
nirmaan_stack.api.pricing.test_pricing_workbook`, `Ran 20 tests ... OK`).

Tier-3 live on Electrical (v18 -> v22): RAW replace -> merged report (35 rewritten · 1 harmonized ·
92,023 trimmed · 22 helper pairs) -> **Cancel leaves version + content + lock untouched** -> Proceed ->
v19 -> "View import report" re-opens it. FIXED replace -> clamp-only report -> restore (S1
120/30/150/80). Live fix -> `[Fix]` on an IFS rewrote it to `=IF(1=1,42,0)` = **42** live, dialog
re-scanned to the multi-cond INDEX ("needs Replace from Excel") -> **Save anyway succeeded (v20 -> v21,
the exact >20-prune save that crashed pre-fix)** -> reload holds `=IF(1=1,42,0)` = 42, INDEX unchanged
-> clean save v21 -> **v22**. Electrical pruned to **20 snapshots, range v3..v22**; all locks NULL;
ELV/HVAC untouched.

## PW-2d — DELIVERED 2026-07-24 (save-time HELPER-CLASS fix, single-action dialog). **PW-2 ARC CLOSED.**

Extends the consent-based fix to the class PW-2b-ii deferred: a **multi-condition INDEX/MATCH**, which
needs a generated helper key/value column pair. Delivered as ONE dialog action — **"Fix all & save"** —
that fixes every fixable hit (helper-free AND helper-class) and saves once.

**NAMING NOTE:** the original PW-2c scope was absorbed into PW-2a as delivered (the save-time advisory);
this slice is **PW-2d**. The recon titled "RECON PW-2c" is this slice's recon.

### The `create()`-never-evaluates probe — the design driver

`luckysheet.create()` renders CACHED cell values and **never evaluates a formula at load** (FR-6, re-proven
here by direct probe: a VLOOKUP with no cached `v` loads BLANK; with a wrong cached `v` it loads the wrong
value; a `celldata` mutation + `refresh()` is not even seen). So a helper-class fix cannot just write a
formula and expect a value — the value must be **present as a cached `v`** at save time, or computed live.

### Option B (live-engine writes) — AUTHORIZED, then REVERSED (chat-Claude misauthorization, on record)

The first cut wrote the helper columns straight into the LIVE engine via `setCellValue({order})` on the
hit's sheet, then re-entered the rewrite so the engine computed it. **It DESTROYED data.** ENGINE CAUTION
**#6**: `setCellValue` targeting a **non-active** sheet rebuilds that sheet's cell store from an incomplete
working grid and **drops every unrendered row**. The hit's sheet is almost always non-active (the lookup
TABLE lives on a dedicated sheet — Termination, Cable Allocation, …), so this is the COMMON case, not an
edge. Proven with server ground truth: **Termination v22 = 154 rate rows / 3588 cells → v23 (Option B fix)
= 0 rows / 1711 cells** — the save persisted the gutted sheet. The damaged workbook was restored to v22;
Option B abandoned. STEP-0 micro-probe banked the minimal repro (a 250-cell sheet → 52 cells on a bulk
non-active write; an active-sheet write is intact; `setSheetActive` is synchronous, so the sanctioned
guard needs no render-await).

### Option 3 (OFFLINE materialize + exact compute) — SHIPPED

Every helper write stays OFFLINE, on the SERIALIZED save payload, never touching the fragile live engine:
1. `planHelperFixes` mints the rewrites + ledger (pure);
2. `materializeHelpers({force:true})` writes the pairs into `celldata` WITH pipeline-computed values +
   hides them via `config.colhidden` (the import-proven path; `force` bypasses the `_mk` pre-existing skip
   so a fix on a sheet that already carries import helpers still writes its NEW pair — the strand fix);
3. each hit cell gets its rewritten VLOOKUP formula, and its **EXACT value where that can be computed**
   from the just-built helpers (`pricingHitEval.computeHitValueExact`) — else a cleared `v` (blank until
   the next recalc). NEVER an approximation.
4. ONE `performSave` (single version bump);
5. `requestSheet(fixedSheets, true)` re-inits so the helpers + stored values DISPLAY (`create()` renders
   cached values — no recompute).

**FIXED-CELL DISPLAY — Option 2 (compute-and-store) with an exactness constraint, Option 1 (blank) as the
automatic fallback (chat-Claude call, on record).** `pricingHitEval` evaluates the rewritten formula ONLY
where the result is provably identical to the engine's: a resolvable cell/range ref, `&` concat, `+ - * /`,
`VLOOKUP(key, range, n, 0)` as a dictionary lookup in the payload's own celldata, and `ROUND/ROUNDUP/
ROUNDDOWN` with integer digits. ANYTHING else — an unknown function, ANY `IF`/`IFS`/`IFERROR` (or other
branch), a comparison, `^`/`%`, a missing ref, a VLOOKUP miss — ABSTAINS (`undefined`) and the cell stays
blank. **Stored `f` is ALWAYS correct; `v` is exact-or-absent by design** — a blank cell that recomputes on
the next edit is honest; a stored-but-wrong value is the exact failure this module prevents (the engine
renders cached values on load, so a wrong `v` would display wrong until a recalc). The save-fix report labels
each row **"value computed"** vs **"blank until recalc"**; the shared `canonicalizeCellValue` (pricingHelpers)
is the SINGLE source for the criterion/key canonicalization, so an offline VLOOKUP key matches the
materialized helper key by construction.

**Why NO live re-entry step (ENGINE CAUTION #7, the two step-6 dead-ends):**
- `setCellValue` re-entry of the rewritten hit THROWS — the engine raises "Cannot read properties of
  undefined (reading 'data')" when a VLOOKUP whose first arg is a `&`-concatenation key is written back
  through setCellValue (a literal-key VLOOKUP is fine, so this bites EXACTLY the helper-class rewrites).
- `refreshFormula()` (a global recompute) CASCADES `#NAME?` — it force-evaluates EVERY formula, and the
  engine cannot evaluate many of them (it renders Excel's cached values on load), so unrelated cells across
  the workbook flip to `#NAME?`. Both proven live. Option 3's store-at-save-time resolves this upstream, so
  the plain re-init displays the value with no recompute.

### The single-action dialog (owner UX amendment)

The advisory footer is Cancel + ONE primary action: **"Fix all & save"** when any hit is fixable
(helper-free AND helper-class ride the same click), **"Save anyway"** when hits exist but none are fixable,
**"Save"** at zero hits. Per-hit `[Fix]`/`[Fix + save]` buttons are GONE; each row shows a status label —
**"will be fixed"** or **"no automatic fix — saved as-is"**. Save-without-fixing-when-fixable was dropped
deliberately (the fixes are semantics-preserving; simplicity wins). `isAutoFixable` (helper-free OR
`REASON_NEEDS_HELPER`) drives both the label and the primary action.

### FIX A — the applyLiveFix guard (a shipped latent risk)

The PW-2b-ii helper-FREE path used the same `setCellValue({order})` and was a latent CAUTION-#6 data-loss
risk for a hit on a non-active sheet. `applyLiveFix` now routes its write through `withSheetActive`
(activate the hit's sheet — synchronous — write, restore the prior active sheet). Same-sheet hits skip the
switch (the fast path).

### Verification — gates + live matrix

Frontend **702 vitest** (29 files): `pricingLiveFix.test.ts` 18→23 (the `withSheetActive` guard ordering via
a luckysheet mock; `applyHelperFixesOffline` exact-value-stored + blank-fallback + `valueComputed`; strand +
idempotency stand), new **`pricingHitEval.test.ts` (12)** — exact resolutions incl. the Termination 82.55
fixture, `'3.0'` canonicalization, sheet-qualified range, `*factor`, `ROUNDUP`; abstains on IFERROR /
unknown-fn / missing-ref / VLOOKUP-miss / approximate-match / comparison / unparseable. tsc 0 errors; build ✓.

Live on Electrical (v22, admin session; Vite restarted no-polling for a stable session — its watcher never
fires across the Windows Docker mount, and polling-HMR remounts the page mid-edit and drops the lock):
scratch multi-cond INDEX/MATCH on **non-active Termination** (COPPER/ARMOURED/3/2.5 → F11 = **82.55**) ->
Save shows the single-action dialog ("will be fixed" + "Fix all & save") -> **82.55 DISPLAYED live**, single
`save_workbook`, **v22→23**; server census **Termination COPPER = 154** (Option B gave 0), helpers
`[17,18,19,20,22,23]` (existing import pair + new pair 22/23 = strand-guard), `H2_v` stored 82.55,
`colhidden {22,23}`; report reads **"Fixed at save" · "value computed"**; **NO `#NAME?` cascade** (5 pre-
existing `#REF!` on the untouched Cable Allocation sheet are original Excel content, passed through verbatim).
**Reload persistence:** H2 shows **82.55** on reload (stored `v` — no longer blank), formula + helpers
persist, COPPER 154. **FIX A:** helper-free IFS on non-active Networking -> `=IF(1=1,42,0)` = **42**,
Networking NOT corrupted (155 cells), single save v23→24. Cleanup: Electrical restored to canonical **v22**
(test artifacts v23/v24 deleted), all locks NULL, ELV/HVAC untouched.

### Deferred out of PW-2d

- Full "Replace-from-Excel prior-helpers regression (6e)" as a distinct RAW→fix→FIXED cycle — the strand
  essence (a new pair coexisting with existing import helpers) is proven; the Replace path itself is
  unchanged/already-shipped.
- The residual FP-boundary risk in the `ROUND*` exact path (JS vs engine rounding at a half-ulp) — accepted;
  arithmetic uses the same IEEE ops, and any true mismatch would only mean a one-recalc-late display, not a
  wrong persisted `f`.

## PW-FS — Dropdown scroll cap + full-screen mode (2026-07-28)

Two additive UI changes to `PricingWorkbookPage` (the shared HVAC / Electrical / ELV page). No backend, no
doctype, no engine change. tsc 0 errors in slice files; build ✓; vitest **170 → 178** (new
`pricingHelpers.test.ts`, 8). Full live matrix a–i PASSED on a Vite-restarted `:8080` (owner-run de-stale;
the in-container watcher never sees a Windows-mount edit, so a restart is mandatory — proven again this
slice: the served transformed module was byte-stale until restart, `hasFullScreen:false → true`).

### Commit 1 — data-validation dropdown height cap (`pricing.css`)

- **Mechanism (DIAG 2026-07-27):** Luckysheet renders the `#luckysheet-dataVerification-dropdown-List` at its
  FULL content height with `max-height:none; overflow:visible`, so a long range-sourced list is not an internal
  scroll container AND is JS-placed off-screen from the uncapped height. The fix is a bare-ID rule
  `#luckysheet-dataVerification-dropdown-List { max-height: 300px; overflow-y: auto; }`, imported ONCE by
  `PricingWorkbookPage`. **Capped height fixes BOTH scroll and placement** — Luckysheet measures the element's
  actual (now-capped) rendered height when it positions the list, so a 300px list lands on-screen.
- **Specificity: Tier 1 (bare ID, no `!important` needed) — VERIFIED live.** The built/served page applied
  `max-height:300px` from the plain `#id` selector (the vendored script-injected styles do not set a competing
  rule at ≥ ID specificity). No `html`-prefix or `!important` escalation was required.
- **Accepted residual (bottom-edge overhang):** a long list opened from a cell LOW in the viewport still opens
  downward anchored to the cell, so the capped 300px can extend past the viewport bottom (measured I41: 71px
  overhang) — but it stays internally scrollable so every option is reachable. Owner-accepted (DIAG).
- **Backwards-compat:** the rule touches ONLY the Luckysheet dropdown container. Short lists are unaffected —
  a 2-option list renders at its natural 58px with NO scrollbar (`overflow-y:auto` shows a bar only when
  content exceeds the cap). Proven live (O39 "Wire,Cable").
- **Live proof (Electrical I10, 106-option `'Unique Linkages reference sheet'!$B$2:$B$107`, in full-screen +
  Sandbox):** list opens on-screen, scrollbar present, wheel scrolls, LAST option reachable + selects
  (`I10 = "63A RCCB 300mA(FP)"`); discarded on Exit Sandbox. Cap CSS confirmed active on all three pages
  (HVAC + ELV computed `max-height:300px`).

### Commit 2 — full-screen mode

- **Mechanism = root-className FLIP (RECON 2026-07-27, the wizard Slice-4c pattern), NOT the native Fullscreen
  API, NOT a portal.** One `expanded` `useState`; the page root swaps
  `flex flex-col h-[calc(100vh-100px)]` ↔ `fixed inset-0 z-50 flex flex-col bg-background` via the pure
  `pricingRootClass(expanded)` (`pricingHelpers.ts`, unit-tested). ONE JSX tree — the action bar + sandbox
  band stay the fixed-height first children, the sheet slot stays `relative flex-1`, and the engine-mount +
  watermark siblings are untouched, so NOTHING remounts (engine instance / checkout lock / sandbox / drafts
  all survive).
- **HARD RULE 1 — never reparent `#pricing-workbook-luckysheet`.** The watermark is a React SIBLING overlay
  (`absolute inset-0 z-10`) of the mount div; a className flip on an ANCESTOR keeps the whole subtree, so the
  watermark survives (proven: tiled + on top in FS and after exit). Reparenting the container (e.g. into a
  portal) would strand it.
- **HARD RULE 2 — never the native Fullscreen API.** The save-advisory / import-report dialogs are Radix,
  portalled to `document.body` at `z-50`; against a `z-50` page overlay the DOM-order tie-break puts the
  body-appended dialog ON TOP (proven live: the INDEX advisory rendered above the overlay). The native API
  would hide those dialogs (they portal outside the fullscreened node).
- **`luckysheet.resize()` REQUIRED both directions.** The engine sizes its canvas at `create()` and only
  re-measures on its OWN window-resize listener; a container-only className flip does not fire it, so a
  `useEffect([expanded])` calls `requestAnimationFrame(() => window.luckysheet?.resize?.())` (guarded on
  `sheetInitedRef`) on enter AND exit. Proven: canvas fills the viewport on enter and restores on exit across
  Electrical / HVAC / ELV; at 90% zoom (dpr 0.9) the repaint is crisp (canvas buffer matches CSS 1:1, no blur).
- **Esc semantics (`shouldExitPricingFullscreenOnEsc`, pure, co-located — NOT imported from boq-wizard):** a
  window keydown listener mounted only while expanded; exits on a BARE Escape, and returns false on
  `e.defaultPrevented` or when `activeElement` is INPUT/TEXTAREA. **Engine nuance (Luckysheet-specific,
  reported):** Luckysheet `stopPropagation`s Escape at its grid contenteditable, so the window listener never
  fires while the GRID has focus — i.e. Esc exits when focus is OUTSIDE the grid (right after entering, or the
  action bar) and is inert inside the grid; the "Exit full screen" button is the universal exit. This
  satisfies the matrix (Esc exits ✓; Esc-in-cell-editor does not ✓; button works ✓) with the specced
  predicate unchanged. A capture-phase listener would make in-grid Esc exit but would also yank the user out
  mid-cell-edit (contenteditable, not INPUT/TEXTAREA) and fire alongside dropdown-dismiss — rejected; button +
  outside-grid Esc is the accepted behaviour. (Owner may revisit.)
- **Toggle:** an always-rendered (when `status` is ready/loading) outline button in the action bar,
  Maximize2/Minimize2, `aria-pressed`, Esc named in the title; orthogonal to editability/sandbox.
- **No lifecycle change:** the `beforeunload`/release wiring is ref-keyed + unmount-driven and layout-agnostic;
  a className flip never unmounts, so it is untouched (recon-verified, held live: Edit→enter FS→Save advisory→
  Cancel→clear→Release all worked from within FS; Electrical stayed v5).

### Standing maintenance riders (carried, not this slice)

- **SUMIFS verified** — the probe table passed on all cases; no normalizer work owed.
- **Electrical baseline v2 superseded by the new master import** — the older v2 snapshot is stale vs the
  current master; RE-SNAPSHOT at the next maintenance touch (do not trust the old baseline for a regression
  diff).
- **Import-normalizer candidate: `FALSE()`→`0` / `TRUE()`→`1`** (the v6-prep LibreOffice lesson) — a future
  normalizer rule to consider; not implemented.

## PM-3+ / remaining module queue

- **Univer spike**, then the production go-live sequence.
- Regenerate the FIXED source workbooks bloat-free (so a FIXED re-import is a total no-op).
- Version history browse/restore UI over `Pricing Workbook Version`.

## PM-3+ — deferred

- ~~Role tightening~~ — DONE in PW-2a (read = admins + estimation, write = admins only). The profile-vs-role
  asymmetry itself remains an owner call (see PW-2a deferred).
- A `patches.txt` entry if any data migration becomes needed (none this slice).
- Version history browse/restore UI over `Pricing Workbook Version`.
- Real-time co-edit (multi-user live), beyond the single-editor checkout lock.
- npm-proper (bundled) or CDN assets instead of vendored; **Univer** migration evaluation.
