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

### Engine-decision spike — SCHEDULED, not parked

A time-boxed **1-2 session Univer evaluation**: load these three workbooks and run them against the SAME
expected-value tables + the frozen baselines above. **Criterion on record:** if Univer passes the matrix AND
handles live-typed spaced formulas natively, migration gets scheduled; otherwise we stay on Luckysheet
deliberately, with the normalizer as the documented compensator.

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

## PM-3+ — deferred

- Role tightening / reconciling the profile-vs-role asymmetry above (owner call).
- A `patches.txt` entry if any data migration becomes needed (none this slice).
- Version history browse/restore UI over `Pricing Workbook Version`.
- Real-time co-edit (multi-user live), beyond the single-editor checkout lock.
- npm-proper (bundled) or CDN assets instead of vendored; **Univer** migration evaluation.
