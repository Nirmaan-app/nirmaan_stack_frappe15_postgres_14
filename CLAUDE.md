# CLAUDE.md — Nirmaan Stack

The active feature is **BoQ Upload & Management**. **Live status + full
per-slice as-built detail: `frontend/.claude/plans/boq-upload-plan.md`** — one file, design spec
followed by every as-built record in order. Backend as-built detail (endpoints, doctypes, commit
pipeline + the relocated slice changelog): **`.claude/context/domain/boq-backend.md`**. Frontend conventions:
`frontend/CLAUDE.md` + **`frontend/.claude/context/domain/boq-frontend.md`**. Load the relevant reference doc
before BoQ work — the always-loaded `CLAUDE.md` files intentionally hold only stable conventions + load-bearing
invariants, NOT per-commit detail (context-hygiene split 2026-06-25).

**Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

## Overview

Nirmaan Stack is a construction project management and procurement ERP built on Frappe v15+ (Python 3.10+, PostgreSQL 14). The backend exposes whitelisted Python APIs consumed by a React 18 + TypeScript SPA. Core domains: Procurement (PR → RFQ → PO → DC/DN), Projects, Vendor Management, Service Requests, Financial Tracking, Inventory, and Document AI invoice autofill.

---

## Tech Stack

- **Backend:** Frappe v15+, Python 3.10+, PostgreSQL 14.11 (never MariaDB), Redis, Socket.IO
- **Frontend:** React 18, TypeScript 5, Vite 5, React Router v6, `frappe-react-sdk 1.7`
- **UI:** shadcn/ui (primary) + Ant Design 5 (selective), TailwindCSS 3
- **State:** Zustand 5, React Hook Form + Zod, TanStack Table v8
- **Infra:** Firebase 10 (FCM push), GCP Document AI (invoice OCR), Sentry 10

---

## App / Module Map

```
nirmaan_stack/
├── nirmaan_stack/doctype/   # 84 custom doctypes — data models and JSON schemas
├── api/                     # @frappe.whitelist() endpoints (35+ files, snake_case names)
├── integrations/
│   ├── controllers/         # ALL doc lifecycle hooks — after_insert, on_update, etc.
│   ├── firebase/            # FCM push notification dispatch
│   └── Notifications/       # In-app notification logic
├── services/                # Reusable business logic (document_ai.py, finance.py)
├── tasks/                   # Scheduled jobs: daily item status, 10 AM vendor credit cron
├── www/                     # Serves frontend.html (SPA entry) and boot API
├── patches/                 # DB migrations v1_5 → v3_0 (append-only)
└── hooks.py                 # App wiring: doc_events, scheduled tasks, fixtures
```

Frontend lives in `frontend/src/`:
- `pages/` — route-level components, one folder per domain
- `components/ui/` — shadcn/ui primitives (generated, don't hand-edit)
- `zustand/` — global state stores
- `components/helpers/routesConfig.tsx` — all route definitions

---

## Coding Conventions

### Python
- **Lifecycle hooks:** Always in `integrations/controllers/<doctype>.py`. Never in doctype `*.py` files.
- **Doctype `*.py` files:** Only `autoname` and simple `validate`. Nothing else.
- **API modules:** `snake_case` filenames under `api/<feature>/`. Never hyphens.
  - Subdirectories under `api/<feature>/` are acceptable for sub-area grouping (e.g. `api/boq/wizard/upload_file.py`). Use them when a feature has multiple sub-areas that benefit from logical grouping.
- **File size:** Split any file exceeding ~500 lines into focused submodules.
- **Child Tables:** For relational, queryable data (items, payment terms, ledger entries).
- **JSON Fields:** For flexible, UI-driven data (category lists, RFQ metadata).
- **Transactions:** `frappe.db.commit()` after any DML in whitelisted methods. Call it **before** `publish_realtime()` to avoid race conditions.

### TypeScript
- All Frappe data access via `frappe-react-sdk`: `useFrappeGetDocList`, `useFrappeGetDoc`, `useFrappePostCall`.
- Backend mutations: `useFrappePostCall('nirmaan_stack.api.<module>.<method>')`.
- Real-time events named `{doctype}:{action}` (e.g. `po:new`, `pr:approved`).
- **Do not introduce new UI libraries.** Stay within shadcn/ui + TanStack Table + Zustand + React Hook Form + Zod.

---

## Module Residence (ADR-0010 — Proposed)

Before writing backend code, consult the **residence map** in [ADR-0010](docs/adr/0010-module-residence-rules.md): a concept must have **one owning module**, never scattered across call sites (this complements the *placement* rules above — folder vs owner). Load-bearing rules:

- **Calculations/decisions the business names** (Benchmark, Loss %, awaiting-approval) → a **pure module** in `services/` (no `frappe.db`, no request ctx) — B1.
- **A JSON / child-table shape** → **one accessor** that parses + types + keys it — B2.
- **`workflow_state` / status** → **one deriver** `f(items, descendants)`, never written ad-hoc across endpoints — B3.
- **Whitelisted endpoints** → **thin orchestrators** (lock → load → call → persist → commit → publish); an endpoint must not reach into a controller validator — B4.
- **A count/aggregate over many rows** → **the database** (`GROUP BY` / `EXISTS`), never a `get_doc`/row-loop in Python.

First worked proof: the `sidebar_counts` aggregate rewrite + the shared `services/procurement_approval.py` predicate home. Frontend rules F1–F5 and the deferred backlog live in ADR-0010.

**Enforcement:** run `python3 scripts/residence_check.py` before committing backend or frontend changes — it ratchets per-rule violation counts against `scripts/residence_baseline.json` (fail on increase; auto-tighten on decrease). Before creating a helper for an existing domain concept, consult the domain doc's **`## Residence — concept → owner`** manifest (first one: `.claude/context/domain/procurement.md`); an UNASSIGNED owner means ask, don't pick one ad-hoc.

---

## PostgreSQL Gotchas

1. **Reserved keyword:** Always quote `"user"` in raw SQL.
2. **JSON field filters:** `frappe.get_all()` cannot use `!=` or `is set` on JSON fields. Use raw SQL: `WHERE json_col IS NOT NULL` with double-quoted table names (`"tabDoctype"`).
3. **Child table filtering:** `frappe.get_all()` filters at the **parent** level — if any child row matches, all rows of that parent are returned. For row-level filtering, use SQL JOINs. See `api/credits/get_credits_list.py`.
4. **rename_doc():** Only updates Link fields. Data fields storing document names need manual SQL.
5. **`SUBSTRING(x FROM y)` is OVERLOADED, and a bound parameter picks the WRONG overload — silently.** With an `INTEGER` it is the positional form; with `TEXT` it is the **POSIX-regex** form. A `%s` parameter arrives typed as text, so `SUBSTRING(col FROM %s)` with `27` is read as the pattern `/27/` — it matches the `27` inside `OFI-26-00271` and returns `27`. Nothing errors, the surrounding predicate just never matches. **Always cast: `SUBSTRING(col FROM %s::integer)`.**

---

## Domain Gotchas

- **PO Delivery Documents** are polymorphic: `parent_doctype` = `"Procurement Orders"` or `"Internal Transfer Memo"`. Always filter by `parent_doctype`; use `parent_docname` (not legacy `procurement_order` field).
- **Vendor credit status:** `recalculate_vendor_credit()` never sets `vendor_status` to On-Hold. Only the daily 10 AM cron does that. The function can auto-clear On-Hold → Active.
- **CEO Hold:** Only `nitesh@nirmaan.app` may set/unset — enforced in `integrations/controllers/projects.py`, not role-based.
- **Invoice Autofill:** Opt-in only via InvoiceDialog. Never recreate `services/file_extractor.py` or the `DocumentSearch` page — both intentionally deleted.
- **Email ops:** Use `api/users.create_user` and `api/users.reset_password` — these decouple email from the core operation.
- **Administrator user:** Name is the literal string `"Administrator"`, not an email. Handle explicitly in rename/delete logic.
- **Frappe child-table serialization depth:** `frappe.get_doc` / the REST resource API hydrate child tables ONE LEVEL DEEP ONLY. A child-of-a-child (grandchild) Table field is NOT returned. When a doctype has a child table that itself has a child table, the grandchild needs an explicit read path (a whitelisted endpoint querying the grandchild doctype directly via `frappe.db.get_all`). Example: BoQ Sheet Draft.work_packages required `get_boq_work_packages` (`api/boq/wizard/update_sheet_draft.py`).
- **BoQ Description role is multi-column:** a sheet may map the `description` role on MULTIPLE columns (it is intentionally NOT in the parser's `_SINGLETON_ROLES`). The classifier JOINS all mapped description columns, in Excel column order, with the separator `" | "`, into the one canonical `description` string the whole pipeline uses, and ALSO records each original column in the per-row `description_parts_raw` list -- an ordered list of `(col_letter, header_label, cell_text)` triples in Excel column order (col_letter is unique so identical headers never collide; original headers preserved; duplicate labels get ` 2`/` 3` suffixes only at RENDER time, MC-4/MC-5) -- for faithful display. `header_label` is the real per-column header text, captured at PARSE time from the sheet's `header_row` cells by `orchestrator._enrich_column_headers` (MC-3b) into the in-memory `SheetConfig.column_headers` (stored-wins; blank header cell -> the bare column letter; never written back to the stored blob); MC-4/5 read these labels from the persisted `description_parts_raw` triples. A single-description sheet's joined string stays byte-identical (no separator). Owner-locked; the shared `_description_columns` / `_description_parts` helpers in `services/boq_parser/classifier.py` are the single source of truth.
- **BoQ note parenting is NEAREST-PREAMBLE-OR-LINE-ITEM (EA-6a, owner-locked):** a NOTE attaches to the nearest **preamble OR line item** above it, not the nearest preamble. Selection is a plain three-way nearest-wins over `(_top_non_none(stack), last_line_item_index, level0_ancestor)` — **`level0_ancestor` is a FULL CANDIDATE, never an `else` fallback** (a level-0 section header IS a PREAMBLE, merely absent from the stack; the fallback form mis-attaches to a stale line item preceding the header — 42 measured). **The marker is READ ONLY in the note branch** — the LINE_ITEM branch only records it, so all other parenting/level logic is byte-unchanged. Reset at `SUBTOTAL_MARKER` ONLY (root-preamble / any-preamble resets are provable no-ops). Notes keep `path=None` and carry no level, so the demotion pass is unaffected; `attached_to_index == parent_index` for every note. Flag `hierarchy.NOTE_PARENT_NEAREST_ROW_ENABLED` (default True). Full detail: `.claude/context/domain/boq-backend.md`.
- **Both review-tree parenting PROMPTS are TEST-PINNED (owner-locked):** the load-bearing passages of
  `boq_ai_assist._AI_PASS_PROMPT_TEMPLATE` and `boq_gemini_assist._BOQ_CLASSIFY_PROMPT` are frozen by
  `TestPromptParentingPins` in **both** service test files. **A wording change must UPDATE the pins
  deliberately** — pin first, reword second, so the diff shows exactly what the model was told before and
  after. Both prompts state the parser's real rule (*a note's parent is the nearest preamble or line_item
  above it*) and the identical line-item rule (*only a preamble may parent a line_item* — matching the
  finalize gate, which hard-blocks an item under any non-heading parent). Both stay **SILENT on
  note-under-note**: silence is the mechanism, enforced by a NEGATIVE pin on each engine — never add a
  prohibition sentence.
- **Both AI-assist chunkers cut on the EFFECTIVE CLASSIFICATION (EA-6b, owner-locked):** Claude via
  `_is_preamble_payload`, Gemini via the `section_flags` parallel list the API layer resolves
  (`gemini_assist._section_flags`). Gemini previously cut on `preamble_candidate_score > 0` -- a derived
  SIGNAL -- which landed cuts MID-SECTION and stranded **774 notes across 97 of 110 sheets** (118 with a
  line-item target, median 2 rows behind the cut, plus 19 blind hard-max cuts); the classification-based
  rule takes every one of those to **0**. **Gemini's WIRE PAYLOAD NEVER carries the parser's verdict**
  (owner ruling: independence = (a), WIRE independence -- the model must never be shown a prior
  classification). The verdict IS now fetched for cutting, so the old structural guarantee (simply not
  fetching it) is gone: **the invariant is enforced by `services/test_boq_gemini_assist.TestWirePayloadPin`,
  which freezes the 11-key payload contract -- a wording change must never make it red.** `chunk_rows`
  with ABSENT `section_flags` degrades to ceiling-only cuts, never back to the score rule.
- **Committed `attached_notes` is DERIVED, not carried (EA-6a slice 2, owner-locked):** at commit,
  `commit_pipeline._derive_attached_notes` rebuilds every node's `attached_notes` from the EFFECTIVE
  tree (effective parent + effective classification, row_index order -- order is load-bearing,
  `hierarchy._notes_text` pipe-joins it). **The `BoQ Review Row` copy is DISPLAY-TIER only**; a
  disagreement emits ONE `frappe.logger("boq_commit")` warning and **NEVER fails the commit**. This is
  what makes the forward-only policy safe -- a historical sheet SELF-HEALS on re-commit, so there is no
  backfill. The review tier is kept in step at the ONE chokepoint `_apply_and_save_row_edit`, which
  fires on a `human_parent` move of a note **AND** on a `human_classification` transition INTO or OUT OF
  "note" (a re-label); a classification change touching "note" on neither side rebuilds nothing. **The
  rebuild keys on the EFFECTIVE PARENT, never `attached_to_index`** -- that field's 0 means "not
  attached", so keying on it silently dropped the text of every note parented to `row_index` 0; the
  sentinel ambiguity is now confined to the pointer field and can never reach the text or the AI
  engines. The C4 reconciliation asserts the DERIVED value **at its call site only** -- the shared
  `_jsn` helper still guards `append_notes_raw` / `edit_log` / `description_parts_raw` and must not be
  touched. `BUG_24_NOTE_PARENT_INDEX_ENABLED` is **RETIRED** (slice 1 made one `target` drive pointer,
  parent and notes-key, so setting it False would MANUFACTURE a divergence). **An item MAY be the
  parent of another item** (owner ruling 2026-08-19, REVERSING the prior "cannot"): review has always
  let a human pick that parenting and the gate then refused it, with no way forward. Structural error
  #8 now fires ONLY for an item under a note / subtotal marker / repeated header. The rule has exactly
  TWO enforcement sites and they share ONE predicate, `commit_validation.line_item_parent_ok` -- the
  previewable validator and the durable `BOQ Nodes` controller backstop; relaxing either alone lets
  review finalize a sheet the commit then rejects. **Warning #16 widened to Line Item in the SAME
  change and must stay:** `pricingRollup` sums a node's own amount PLUS its descendants', so a priced
  parent item double-counts -- advisory only, it never blocks.
- **`matching_mode: "item_identity"` routes a category to the composite-REFUSAL prompt (owner-locked).**
  `extraction.select_prompt_text` hands such a category `prompts/boq_rate_item_identity_prompt.md`, which
  instructs the model to return null for any row describing "MULTIPLE items or an assembled unit". It must
  NEVER be set on a category whose rows are ASSEMBLIES -- the model then refuses every row, deliberately and
  at high confidence, and the blanks look like an extraction failure rather than the instruction they are.
  Removing it means removing `identity_attribute_id` in the SAME edit (that key is read only when the mode
  is `item_identity`, so leaving it is a dangling key); `item_kinds` is SEPARATE and must stay -- it is what
  records which category OWNS a catalog kind.
- **`switches_sockets` is a PER-COMPONENT COMPOSITE and rounds to TENS; `point_wiring` rounds to UNITS
  (owner-locked, deliberately different).** Both are sheet-faithful: switches_sockets sums the RAW component
  lines, multiplies once, then rounds to tens; point_wiring multiplies and rounds per component. Do NOT
  "harmonise" them -- point_wiring's own notes record its unit rounding as "INTENTIONAL, per the sheet", and
  the tens convention is what keeps switches_sockets' standing golden value-identical across the rebuild.
- **The only blanker item in the catalog is `1M Blanker`, and it lives under `family: "Switch"`** -- there is
  no blanker family. Any `blank_item` slot therefore binds `values_from.where = {"family": "Switch"}`.
  **BOTH `switches_sockets` and `point_wiring` carry a blanker slot.**
- **The module count is computed in the PIPELINE, never by the model (owner-locked).** The
  `module_fit` interpreter step derives a row's module count from a weighted sum over its stated
  quantities and resolves it against the catalog. It belongs in the pipeline precisely BECAUSE a
  model-selected plate leaves no trace: the step's trace carries the arithmetic AND the ladder hop,
  and this system's design ethos is that a price shows its working. **The weighted sum is CONFIG —
  weights AND attribute ids — never hardcoded**, because `switches_sockets` has TWO socket slots and
  `point_wiring` has one, so a fixed two-attribute formula is not portable between them.
- **`module_fit` ladders derive from the CATALOG, never from a params array (owner-locked).** A ladder
  spec names an item `kind` + a `where` family and carries NO size list, so adding or retiring a plate
  size flows through with no config edit. Resolution is EXACT if the catalog carries the size, else the
  **NEXT HIGHER** one, **never a lower one** — a plate smaller than its contents cannot hold them, so
  rounding down is a wrong price, not merely a wrong size. **`"1M & 2M"` is ONE catalog item covering
  TWO sizes**: every integer in a rung's label is a covered size, so a computed 1 and a computed 2 both
  match it on the ordinary exact-match path. A count ABOVE the ladder's top is an HONEST NO-COMPUTE,
  never clamped to the largest rung; this DELIBERATELY DIVERGES from `circuit_fit`, which does fall
  back to its largest size but then re-checks with `circuits <= 0` — `module_fit` has no such second
  gate, so it refuses at the ladder.
- **THE BLANKER IS INFERRED FROM THE EFFECTIVE COUNT, NEVER SELECTED BY EXTRACTION (owner-locked).**
  A POSITIVE effective count prices `1M Blanker` in the assembly's colour whatever the model returned
  for `blank_item`; a ZERO count binds the **None sentinel** so the line reads as deliberately absent
  rather than as a blanker bought zero times. **The boundary follows the EFFECTIVE count, not the
  computed one** — editing the quantity to zero reverts the item to None. `blank_qty` is therefore
  EDITABLE again (seeded with the computed count): the earlier read-only ruling is REVERSED because
  the pipeline now genuinely reads it. **An over-count is CORRECTED to the plate's SPARE capacity
  (never its total — a blanker cannot go where a socket sits); an under-count is HONOURED with a
  warning naming the uncovered modules. Do NOT flatten that asymmetry** — one is physically
  impossible, the other merely untidy, and they carry deliberately different wording. The arbitration
  lives in `module_fit` (config keys `qty_attr` / `bind_item` / `item_when_positive`), which is the
  ONE step seeing both the spare and the stated value and which runs FIRST, so the pricing panel and
  the Rate Master Derivation screen inherit it by construction.
- **⚠️ A `ref` MUST NEVER CARRY A LITERAL THAT COULD MEAN "None" (owner-locked).** The `none_skips`
  short-circuit tests the **`@` prefix FIRST**, so a literal never reaches the sentinel comparison: it
  is taken as a **CATALOG MATCH KEY**, matches no row, and returns a **WHOLE-PIPELINE `no_match`** —
  the entire row unpriceable, wire and conduit included, not merely that line. The item is bound
  through `fitLabels` instead, exactly as a ladder binds its fitted rung, so the shared resolver and
  the shared short-circuit are both UNTOUCHED. **The bind must fire on every path that reaches a
  component, including the two absent ones** — an unbound `@` reference is a `bindMiss`, which refuses
  the whole pipeline. The COUNT still binds nothing on the no-plate path deliberately: an uncomputed
  blank count renders EMPTY, never 0.
- **⚠️ `item_when_positive` is the FIRST config value naming a catalog ITEM** rather than a `kind` plus
  a `where` filter, which is the convention ladders exist to keep. It is sound ONLY because the ruling
  is premised on the catalog carrying exactly one blanker; a second one would make this line a
  quietly wrong price, with nothing failing loudly.
- **A ZERO module count with `back_box = Yes` FITS A 3M BOX — the STATE-A fallback (owner-locked).**
  A light point wired straight to an MCB carries no switch and no socket, so nothing fits any ladder and
  the box used to vanish with the plate; a light point still needs a junction box. A ladder may declare
  `on_zero_modules`, read ONLY on the zero-count path. **It is a module COUNT, never a catalog label** —
  the catalog still names the rung, so retiring a size needs no config edit. **The PLATE ladder must
  never declare it** (with nothing on it there is no plate), and **STATE B — `plate_item: "None"` with a
  NON-ZERO count — is OUT OF SCOPE and structurally unreachable**: `on_none: "computed"` already boxes
  those rows correctly, and a wider reading would DOWNGRADE a correctly-sized box. **It does NOT re-gate
  on `back_box`** — the component's own `qty: {if_attr: {back_box: "Yes"}}` already answers that, and
  asking twice would be two definitions of one rule.
- **WIRE INSTALL STEPS IN THREES; SUPPLY AND BCS STAY LINEAR (owner-locked).** The install multiplier is
  `ceil(runs / divisor)` — three runs is three times the WIRE but one unit of LABOUR. **The divisor is
  CONFIG, never hardcoded** (the `module_fit` `terms` precedent): a `component_ref` rate stage carries
  `mult_step_divisor`, a `scale` param carries `<ident>_step_divisor`, and BOTH go through the one shared
  `stepFactor` helper so they cannot drift. **ABSENT ⇒ the raw factor, byte-identical** — which is what
  keeps every un-stepped attachment (cable supply, termination supply, both BCS, point_wiring supply and
  BCS) exactly as it was. It never softens either site's existing no-compute rule and can never yield 0.
  **`ceil(n/3)` required NEW interpreter work**: the formula language has four operators (`+ - * /`) and
  NO function-call syntax, and every existing rounding rounds a product, never a factor.
- **⚠️ TERMINATION INSTALL INHERITS RUNS THROUGH `install_as_ratio` AND MUST NEVER CARRY ITS OWN
  MULTIPLIER (owner-locked).** `install_as_ratio` sits AFTER the supply `scale` and reads the
  already-runs-multiplied supply, so the inheritance IS the multiplier. Attaching a second one gives
  `runs x ceil(runs/3)` — the runs-SQUARED shape the ext-b ruling exists to prevent. Its ordering and its
  trailing `roundup(-1)` are equally load-bearing: moving `install_as_ratio` ahead of the supply scale
  would change WHERE the rounding lands, which is a second behavioural change. Leave all three alone.
- **A ZERO module count yields NO plate and NO blanks — but must NEVER kill the pipeline
  (owner-locked).** A light point wired straight to an MCB carries no switch, socket or plate, so
  the weighted sum is 0; that is a REAL and COMMON product, not a data error. **Wire and conduit are
  unrelated to module counts**, so refusing the whole pipeline discards a `circuit_fit` that already
  succeeded. A zero count marks EVERY ladder positively absent — the same `absentLadders` mechanism
  a `"None"` plate already uses — and the trace must SAY that nothing was fitted; silence would be
  worse than the refusal it replaced. A NEGATIVE or non-finite count, and a MALFORMED step declaring
  no terms at all, both stay honest no-computes: "declared nothing to count" is not the same
  statement as "counted to zero", and collapsing them lets a broken config report a priced row.
- **A ladder marked absent must still BIND the None sentinel (owner-locked).** A ladder bind may
  have no backing attribute (`@box_item`), so binding nothing leaves that `@` reference UNBOUND —
  and an unbound `@` reference aborts the whole row. Binding the sentinel is what lets a `none_skips`
  component zero its line instead. For the same reason a blank count binds an explicit 0 rather than
  nothing: a `{from_fit}` quantity that is absent is "not provided", which also aborts the row.
- **TAKE-THE-LARGER: the plate priced is the LARGER of the STATED and the COMPUTED module count
  (owner-locked; REPLACES the earlier stated-wins rule).** A ladder's `floor_from` names the attribute
  whose stated count is a **FLOOR, never a ceiling**: a stated plate too small for its contents is
  **UPGRADED** rather than refusing the row (a BoQ typo must not kill a line), and a stated plate
  bigger than needed is what gets bought. **An UPGRADE MUST ALWAYS BE VISIBLE in the derivation trace**
  — the BoQ said one size and we price another, which is the right call only while it cannot be missed.
  **Blanks derive from the plate ACTUALLY SELECTED and CLAMP AT ZERO** (never negative, never a
  refusal); the clamp is likewise named in the trace.
- **The BACK BOX takes the SELECTED plate's module COUNT, re-fitted on its OWN ladder — never the
  plate's LABEL (owner-locked).** The box ladder is SHORTER than the plate ladder (no 9M, no 16M), so a
  9M plate pairs with a **12M** box and a 16M plate with an **18M** box. Copying the label asks the
  catalog for a box that does not exist and makes the WHOLE ROW unpriceable — that was a live defect
  before slice 2 part 2. When the plate is `"None"` the plate line stays ZERO and only the BOX takes
  the computed count, which is why a box may exist with no face plate.
- **The plate / back-box relationship is ONE-WAY (owner-locked).** A face plate present DEFAULTS the box to
  yes; a face plate set to `"None"` must leave `back_box` **STILL SELECTABLE**, because a back box can exist
  with no face plate. `plate_item.disables_when_none` therefore lists **`plate_qty` ONLY** -- never `back_box`.
  Greying the box out makes such a row UNPRICEABLE, which is a wrong answer and not merely a wrong UI.
  The back_box component's `@plate_item` binding is SEPARATE and stays: **box module = the PLATE's module
  when a plate exists**; the no-plate fallback needs the module computation and is a later slice.
- **A COMPUTED ATTRIBUTE VALUE MUST REACH THE SELECTION, because `circuit_fit` and `resolveQty` read
  there and never consult `ctx` (owner-locked).** `circuit_fit` takes its length from
  `selected[length_attr]` and a component's `{from_attr}` quantity from `selected[qty.from_attr]`,
  while every other step writes into `ctx` — so a value computed the ordinary way cannot reach either
  one. `scale` cannot bridge it: it is a RATE scaler, needing an existing finite `ctx` rate as its
  target. The `derive_attribute` step crosses the gap by writing into a **run-local overlay copy of
  the selection**, so every existing read site sees it and **the caller's object is never mutated** —
  `value` must keep meaning "what the user or extraction supplied". **Do NOT instead teach the readers
  to fall back to `ctx`**: they are shared by all 13 categories, and a `ctx` key colliding with an
  attribute id would silently re-price a shipped row. A pipeline carrying no `derive_attribute` step
  is byte-identical.
- **A STATED circuit length ALWAYS WINS over a computed one — NO floor and NO warning (owner-locked).**
  This DELIBERATELY DIVERGES from the plate's take-the-larger: the larger does not win, the STATED one
  does, whether it is bigger or smaller than the computation, and nothing warns. A pricer typing 60 for
  a long run is simply right. Stated-wins is checked BEFORE the source attributes are read, so a row
  that states its length prices even when the input the rule would have used is unreadable.
- **A `derive_attribute`'s FORMULA, its SOURCE attributes and its TARGET attribute are all named in
  CONFIG, never hardcoded** (the `module_fit` `terms` precedent) — `15 + (N-1) x 5` is one category's
  rule. A missing / blank / non-numeric / `"None"` source is an HONEST NO-COMPUTE naming the attribute,
  never a zero and never a guess; domain limits stay with the reader that owns them (`circuit_fit`
  already refuses a non-positive length). The step publishes `StepTrace.derivedAttr` as STRUCTURED
  DATA with ONE reader (`derivedAttrOutcomes`) — the `moduleFit` precedent; never parse the trace prose
  and never re-derive the arithmetic. **Both its source attrs AND its `result_attr` are validator
  `_ref`-guarded**: a typo in the TARGET would silently stop it ever finding a stated value to defer
  to, which is quieter than a no-compute and worse.
- **`point_wiring`'s CIRCUIT LENGTH is COMPUTED from the point count, and a STATED length always wins
  with NO floor and NO warning (owner-locked).** `circuit_length_m = 15 + (points - 1) x 5` — 15 m is
  correct only for a single point. It is a `derive_attribute` step that must sit **FIRST in every
  pipeline**: `circuit_fit` reads `selected[length_attr]` and the wire components read the length
  through `resolveQty`'s `{from_attr}`, so one first-position step serves both and any later position
  makes `circuit_fit` refuse the row. **⚠️ `circuit_length_m` must NEVER carry an `extraction_defaults`
  entry** — an INJECTED value is a STATED value, so a default would win on every row forever and make
  the whole derivation inert while every test stayed green.
- **`points` is the number of points a LINE COVERS, never the number of such lines in the bill
  (owner-locked).** The sheet's own `qty` is INVERSELY shaped — one line covering seven points has
  `qty 1`, and twenty-nine single-point lines have `qty 29` — so reading `qty` as the point count
  inverts the correction on exactly the rows that matter most. It is EXTRACTED (the model reads it from
  the description under R9), never derived, and it is a plain `number`: a point count has no catalog
  domain, so `number_choice` would be wrong.
- **⚠️ ADDING A REQUIRED EXTRACTED ATTRIBUTE INVALIDATES EVERY PRE-EXISTING EXTRACTION OF THAT
  CATEGORY, so the ASSET APPLY and the RE-EXTRACTION ARE ONE ATOMIC OPERATION (owner-locked).** A
  stored run that predates the attribute carries it on NO row; it is a genuine input, so the
  missing-attribute gate blocks and the category prices NOTHING in the window between the two.
  **`extraction_defaults` does NOT rescue this** — defaults are injected at EXTRACTION time and baked
  into the stored result, never applied when reading an older run. This is the "atomic set" rule
  (already recorded for goldens) landing on the stored run. **Every test surface stays GREEN while the
  category prices 0** — goldens and unit tests supply their own attributes — so the editor-path row
  count over live data is the only gate that can see it.
- **A `derive_attribute`'s `result_attr` is the THIRD derivation mechanism `derivedAttrIds` must
  collect** (beside a `{from_fit}` superseded qty and a `module_fit` ladder bind), read FROM CONFIG and
  never by id. It behaves like the LADDER BIND, not the read-only blanker quantity: a stated value IS
  read and wins outright, so the field stays **EDITABLE** and `readOnly` is never set. **The gate
  NARROWS, it does not open** — a genuinely absent input, including the SOURCE attribute the formula
  reads, must still block.
- **Goldens live in the asset's TOP-LEVEL `goldens` dict, keyed by category_id, and NOWHERE ELSE.**
  `loader.load_rate_master` reads `payload["goldens"]` and OVERWRITES each config's `goldens` key from it, so
  a golden written into a `category_configs[*].goldens` entry is SILENTLY IGNORED. A golden added in-system
  via RM-4b but never written back into that top-level dict is DROPPED on the next `replace=True` import.
  **Verify an apply by comparing `stored == asset` KEY BY KEY, never by golden COUNT** -- a swap can leave the
  count identical while replacing the content.
- **Estimator rules are read from the DB, not the asset:** `extraction._load_active_configs` reads `BoQ Rate Category Config`, so editing `services/boq_rate_master/data/rate_master_*.json` is **INERT at runtime** until re-imported or applied via the audited RM-4b `update_rate_config`. The asset is the record; the config row is what the model reads.
- **Loss Justification (PR/SB):** a written reason is required for any approval item whose **Loss % > 10%** (strict). One field `loss_justification` (Small Text) on the SHARED child `Procurement Request Item Detail` covers both PR and SB. Terms in `CONTEXT.md`; scope/rationale in `docs/adr/0002-loss-justification-scope.md` (PR/SB approval surfaces ONLY — NOT on `Purchase Order Item`, no Loss% snapshot, no PO/print). Loss % = `(-savingLoss / benchmark) * 100`, **benchmark = Target Amount (target rate ×0.98) if available else Lowest Quoted L1 (Target-prioritized)**. Gate is server-authoritative: `send_vendor_quotes.handle_delayed_items` accepts `loss_justifications`, writes them onto `order_list`, and re-computes Loss % (`compute_item_loss_percent`) to `frappe.throw` on a blank >10% reason. **GOTCHA 1 — `rfq_data.details` is keyed by `item_id`, NOT the order_list child-row `name`** (verified against live data); the L1 lookup must use `item.item_id`. **GOTCHA 2 — dual benchmark on the approval screen:** the existing ₹ "Savings/Loss" column keeps its `min(Target, L1)` benchmark (unchanged), but the new Loss % uses the Target-prioritized benchmark to match capture and keep the >10% gate identical end-to-end — so the ₹ and the % on that one screen can come from different benchmarks; don't "fix" it.

---

## Commands

```bash
# Dev server (from frappe-bench directory)
bench start                          # Backend :8000, Socket.IO :9000

# Database
bench --site localhost migrate        # Run pending patches
bench --site localhost clear-cache    # Flush Redis

# Assets / doctypes
bench build
bench new-doctype "Name"

# Tests
bench run-tests --app nirmaan_stack
# A single module (the canonical BoQ pricing-suite invocation):
bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_pricing
```

**BoQ test-runner note (post boq-ai-validations merge):** run the pricing suite via
`bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_pricing` (in-container).
The raw `python -m unittest nirmaan_stack.api.boq.wizard.test_pricing` path now FAILS at import —
the merged `services/boq_ai_assist.py` calls `frappe.logger("boq_ai")` at module load, which opens
`/workspace/development/logs/boq_ai.log` before a bench context exists. Use the bench runner.

**Ad-hoc DB queries from host** (bench CLI broken on host — click version mismatch):
```bash
cat > /tmp/q.py <<'EOF'
import os; os.chdir('/workspace/development/frappe-bench/sites')
import frappe; frappe.init(site='localhost'); frappe.connect()
# ... query ...
frappe.destroy()
EOF
docker cp /tmp/q.py frappe_docker_devcontainer-frappe-1:/tmp/q.py
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 env/bin/python /tmp/q.py
```
`os.chdir` to `sites/` is **required** before `frappe.init()`.

**Windows quirk:** prefix `MSYS_NO_PATHCONV=1` on all `docker exec` and `docker cp` commands when passing UNIX-style paths through Git Bash. Bash tool on Windows otherwise translates `/tmp/...` → `C:/Users/.../Temp/...`. See handover §9 #93 + §11 #33.

### BoQ env / testing procedures

For BoQ Upload dev-environment setup, clean bench-restart sequence, the CSRF clear-site-data login fix, the two-port (:8080 live / :8000 stale) rule, and manual read-only DB-inspect (PostgreSQL, run-from-sites-dir): see `BoQ_Environment_Testing_Runbook_v1_0.md` (in project knowledge). Source of truth remains handover doc §9 #118-#123 + caveats TT/UU/VV/WW; the Runbook is a convenience digest.

---

## Testing Conventions

- **Framework:** `frappe.tests.utils.FrappeTestCase` (Python unittest subclass).
- **Location:** `nirmaan_stack/nirmaan_stack/doctype/<name>/test_<name>.py` — co-located with each doctype.
- **Existing tests:** Nearly all are empty stubs. Don't rely on them to catch regressions.
- **New code:** Pure-Python modules (parsers, services) must have real unit tests with fixture files. No stubs for logic-bearing code.
- **Frontend E2E:** Cypress 13.7 configured in `frontend/cypress.config.ts` — largely unimplemented.
- **Single-doctype state (STANDING RULE):** a test that mutates a field on a Single doctype MUST capture the
  site's original value and restore **that** — never a hardcoded restore constant. These suites run against the
  LIVE localhost site, so a hardcoded restore rewrites the owner's real setting whenever it differs. The failure
  is SILENT because `frappe.db.set_single_value` bypasses the doc lifecycle and writes **no `Version` row**: a
  `track_changes` audit cannot see it, so the setting appears to change by itself. Correct pattern:
  `test_ai_settings.py` (capture + `addCleanup`) or a `setUpClass` capture restored in `tearDownClass`.
- **After editing any doctype JSON:** Always run `bench --site localhost migrate`. Tests use a separate test database that auto-migrates, so **passing tests do not guarantee the runtime database has the new column**. Verify with `frappe.db.has_column("DocType Name", "field_name")` in the bench console after migration.

### Projects row fixture pattern

Tests that need a Projects row in `setUpClass` must satisfy the legacy `Projects.after_insert` hook (`generate_pwm` in `doctype/project_work_milestones/project_work_milestones.py`). The hook requires `project_start_date` + `project_end_date` in `"YYYY-MM-DD HH:MM:SS"` format and `project_scopes` as a dict with a `"scopes"` key.

Working pattern:

```python
@classmethod
def setUpClass(cls):
    super().setUpClass()
    cls.test_project = frappe.new_doc("Projects")
    cls.test_project.project_name = f"TEST_<feature>_{frappe.generate_hash(length=6)}"
    cls.test_project.project_start_date = frappe.utils.now()[:19]
    cls.test_project.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    cls.test_project.project_scopes = {"scopes": []}
    cls.test_project.insert(ignore_permissions=True)
    frappe.db.commit()

@classmethod
def tearDownClass(cls):
    # Delete child rows (BOQs etc.) first, then the project
    frappe.delete_doc("Projects", cls.test_project.name, force=True, ignore_permissions=True)
    frappe.db.commit()
    super().tearDownClass()
```

Why `[:19]` truncation: `frappe.utils.now()` returns microsecond-precision strings (e.g. `"2026-05-29 12:30:45.581159"`); `generate_pwm` calls `strptime(..., "%Y-%m-%d %H:%M:%S")` which rejects them. `add_to_date` return values need the same truncation. Empty `{"scopes": []}` makes `generate_pwm` run but produce zero milestones — correct for test isolation. Origin: Module 1a 2026-05-29.

---

## Don't Touch

| Path | Reason |
|---|---|
| `nirmaan_stack/nirmaan_stack/doctype/*/*.json` | Auto-generated by Frappe — edit via Desk UI or bench tooling only |
| `patches/` | Append-only migration history — never modify existing files |
| `www/frontend.html` | Auto-generated SPA shell |
| `frontend/src/components/ui/` | shadcn/ui generated components — update via shadcn CLI |
| `nirmaan_stack/public/` | Compiled frontend assets — edit source in `frontend/src/` instead |
| `services/file_extractor.py` | Intentionally deleted — do not recreate |

**Sanctioned exception:** A doctype JSON field's `fieldtype` MAY be changed via a deliberate, reviewed, committed CC edit + `bench migrate` when a schema constraint must be corrected (e.g. `source_file_url` Data->Small Text, fix 3815ea3f, 2026-05-30; `description` Data->Text on BOTH `Project Expenses` and `Non Project Expenses`, 2026-07-28 — all four expense dialogs already rendered a `<Textarea>` against a `varchar(140)` column, so a >140-char description hard-failed the save with Frappe's `CharacterLengthExceededError`). Any such change must be isolated to the minimum field diff and explicitly noted here.

**The same exception covers a field's `description` text, on the same terms** (minimum diff, reviewed, committed, a migrate run afterwards) — **OWNER-RATIFIED, and not to be narrowed back to `fieldtype`-only by a later reader who reads the widening as drift.** A description is what the next implementer reads before touching the field, so a stale one is a defect in the same class as a wrong `fieldtype` — and correcting it changes no column at all, which is exactly what makes it safe. It has been used this way on the two BCS doctypes, `BoQ Sheet` and `BoQ Row BCS Rate`, whose descriptions had outlived the widening that gave the cost layer a third stored rate. Such a diff must stay description-ONLY, verified by comparing the doctype JSON structurally with `description` stripped: identical field lists, identical everything else.

---

## Active Features

| Feature | Branch | Spec | Status |
|---|---|---|---|
| BoQ Upload & Management | `feature/boq-pricing-helper` | `frontend/.claude/plans/boq-upload-plan.md` | **Which phase/slice is active is NOT recorded here — read the plan doc.** A status written in this cell dates the moment the next slice lands. Full slice-by-slice status + as-built detail: `plans/boq-upload-plan.md` + `.claude/context/domain/boq-backend.md`. Do NOT duplicate the changelog here. |

**Always read `frontend/.claude/plans/boq-upload-plan.md` + `.claude/context/domain/boq-backend.md` before working on BoQ.**

**Active BoQ doctypes** (full per-doctype detail in `.claude/context/domain/boq-backend.md`):
- `BOQs` — root BoQ doc; `BoQ Sheet Draft` (child) — per-sheet wizard config (`wizard_status`, `sheet_config`); `BoQ General Specs Sheet` / `BoQ Sheet Work Package` — child tables.
- `BoQ Review Row` — transient per-parse review rows (human-edit layer; **-1 sentinel** for no-parent/no-override).
- `BoQ Sheet` — committed, VERSIONED sheet tier (`commit_version`/`is_current`); `BOQ Nodes` (+ `BOQ Node Qty By Area`) — committed node tree, **CAPTURE-ONLY** controllers (no amount/parent-rate recompute).
- `BoQ Committed Sheet Grid` (+ `... Row`) — faithful committed cell grid (all 6 classifications).
- `BoQ Cell Pricing` — per-cell pricing layer; `BoQ Cell Amount Formula` — per-column amount formulas; `BoQ Cell Remark` / `BoQ Cell Color` — annotations; `BoQ Cell Dismissal` — per-row review-flag dismissal; `BoQ Cell Reconciliation Choice` — per-cell formula-vs-document choice; `BoQ Sheet Pricing Lock` — single-editor lock. (No separate audit doctype — audit goes through `Nirmaan Versions`.)
- `BoQ Row Category` — per-row classification overlay (classifier service `services/boq_category/`, backend-only; wired into the pricing editor at a later slice). Mirrors `BoQ Cell Remark`'s durable-address shape but with `discipline` IN the identity tuple (a second engine's row for the same Excel address coexists); freeze-and-supersede lifecycle via `persist.write_row_categories` (+ `set_human_verdict`, which UPSERTS: creates a current record when none exists for the address — CL-6, so a verdict on an eligible row that was never classified persists — else annotates the current record IN PLACE and does NOT mint a new version). `context_builder.build_sheet_context` rebuilds the committed-tree feed (`anc_texts`/`anc_headers` byte-identical to the certified harness, plus a structured per-ancestor list incl. every ancestor's notes; work headers PARKED, not fed this slice). `routing.route_r3d` = config-driven R3d router (`routing_config.json`); `ai_voter.classify_rows_ai` = independent Option-B voter (AI feed = description/ancestor_chain/notes only; fails closed when AI settings disabled). **Single-row-batch parse tolerance (HV-2, all disciplines, owner-locked):** the voter's `_extract_json_array` accepts a lone-row reply returned as a bare JSON OBJECT (wraps it as a one-element list) as well as the normal array; parse-shape ONLY — id/category validation stays downstream unchanged, and a genuinely non-JSON reply still RAISES loudly (error-swallowing is the harness's job, never the voter's). The eval harness (`harness/electrical_classification_harness.py`) IMPORTS this same `_extract_json_array` (HV-2b) — one source of truth, no duplicate; do NOT reintroduce a local copy. Effective category = `human_category_id` if set else `final_category_id`; a blank `final_category_id` means route-to-human, never a category. **AI-off fail-safe (CL-5, owner-locked, Option A):** when the voter did NOT run (`ai_status` in `{"disabled","no_key"}`) the `orchestrator` OVERRIDES routing per-row — `final_category_id` = the RULE category (a genuine rule-abstain stays honestly blank) and EVERY row is flagged `Needs review`. The override lives in `orchestrator.classify_sheet_rows` (a run-level flag the pure `route_r3d` is blind to); `route_r3d` + `persist` stay untouched. When `ai_status == "ran"` there is NO override (consensus auto-accepts, disagreement blanks final as before). **Endpoints (CL-1b, `api/boq/wizard/classify.py`):** `list_engines` / `start_classify` / `get_classify_status` / `get_sheet_categories` / `set_row_category`, plus `_classify_worker` on the `parse_run` long-job pattern (raw 32-char job_id, commit-before-publish, self-heal). Its in-progress marker + terminal payload live in REDIS keyed by `(boq, sheet_name, discipline)` (schema-free -- no doctype field -- fitting the committed tier). `orchestrator.classify_sheet_rows` does context->rule+AI->route->persist per sheet; range scoping is ELIGIBLE-ONLY + SILENT and the summary reports honest N-of-M plus a `skipped_by_reason` count rollup. Engines come from the `engines.py` registry (adding one = a registry edit; `available` gates start/verdict -- no hardcoded engine names). **Progress (CL-2):** the worker emits `boq:classify_sheet_progress` `{boq, sheet_name, discipline, done, total}` once per 20-row AI batch (the orchestrator drives the batching in slices of `_AI_BATCH`=20 -- IDENTICAL to `ai_voter._BATCH` -- so AI behaviour stays byte-identical; `ai_voter` is untouched); the terminal `boq:classify_sheet_done` is unchanged. **Progress poll is authoritative (CL-4):** the per-batch `_progress` closure ALSO merges `done`/`total` into the Redis in-progress marker (`_update_marker_progress`, preserving job identity; silent no-op if the marker is gone), and `get_classify_status`'s `running` branch returns them -- so the 3-second poll drives the progress bar even when the socket does not deliver (owner-env fact). Progress renders as a BLOCKING centered modal (`ClassifyProgressModal`) that is dismissable ONLY at a terminal state (success OR error) -- never mid-run. The terminal `_status_key`-then-clear ordering guarantees a `running` poll can never race a `done`. **Catalog (CL-3):** `get_category_catalog(discipline)` is a read-only endpoint returning `{discipline, categories:[{id,label}]}` from `load_ruleset` (engine-scoped -- unavailable engine throws); it drives the frontend verdict picker + the Category-column label. `set_row_category` (the human-verdict write, `""`=clear) is the CL-3 write path (unchanged since CL-1b). **Second-discipline seam (HV-1, owner-locked):** adding a classification discipline = 3 NEW asset files (`categories_<disc>.json`, `rules_<disc>.json`, `prompts/<disc>_ai_category_prompt.md`) + 3 one-line map edits (`runner._DISCIPLINE_ASSETS`, `ai_voter._DISCIPLINE_PROMPTS`, harness `BOQ_HARNESS_DISCIPLINE` env switch); `scoring.json` + `routing_config.json` stay SHARED across disciplines, and `load_ruleset(discipline)` / `_read_prompt(discipline)` RAISE for an unshipped discipline. HVAC assets exist (**17** categories `hvac_*` — the 17th, `hvac_raceway`, is an OWNER RULING at HV-3: cable trays/raceways price separately, so `hvac_cables` is cabling only and the tray vocabulary lives in Raceway with a false-friend guard each way — ruleset `4.2-hv7`, prompt `hvac-v1.3`; the ruleset is MEASURED OUT-OF-SAMPLE at the Set-2 exam — rules 63.58% on Set-2 vs 71.13% on Set-1 (the overfit bill, −7.56 pp) and 68.39% on the combined 2,354-row corpus after HV-6, vs the owner's 80% bar; AI prompt v1.2 measured 91.57% / 90.29% (Set-1/Set-2) and GENERALISES where the ruleset does not, so **further ruleset tuning is closed** — see `_classification_review/hvac_set2_exam/SET2_EXAM.md` and `hvac_rules_v4_verify/VERIFY_V4.md`. **Set-1 and Set-2 are both SPENT: the next honest out-of-sample measurement is production Set-3, and nothing further may be tuned against this corpus.** Prompt v1.3 is UNMEASURED, certified at HV-7) and **the HVAC engine is LIVE — `engines.py` `available=True` (HV-9, owner GO 2026-07-22), which CLOSES the HVAC build arc.** `is_discipline_available("HVAC")` now admits `start_classify` / `set_row_category` / `get_category_catalog`; ELV remains listed-but-unavailable and is the gate's negative exemplar. Certified stack behind the switch: rules `4.2-hv7` + notes-fallback surface + prompt `hvac-v1.3` + `consensus_floor_v1` routing. First production classify (`BOQ-26-00017 | Piping `): 14 auto-accepted / 9 review, both invariants holding on real data, tier shape 18/18 identical to the HV-8 certification. **PRODUCTION ERA: Set-3 accrual is now live — every production classify is unseen out-of-sample evidence, so the held Ducting demotion call and the demotion-list re-derivation must ride PRODUCTION data, never a re-fit on the spent Set-1/Set-2 corpus.** **OPERATIONAL WARNING: an AI-off run looks successful — always check `ai_status`; when it is `disabled`/`no_key` the CL-5 fail-safe adopts the RULE category as `final_category_id` and flags every row for review, so review rows carry a NON-blank final (correct, but the opposite of the certified blank-review shape).** **AI settings changes are now attributable (HV-11): `BOQ Upload Review AI Settings` carries `track_changes: 1`, so every toggle flip lands in the Version log (field change + user + timestamp) — the instrument for the standing unattributed-self-flip incident; and an AI-off run's completion modal + post-close toast now show a plain "AI voter was OFF for <discipline>" warning (healthy path silent), so the fallback is visible, not silent.** **Multi-engine pricing editor (HV-10):** the pricing editor reads the NEW `get_sheet_categories_resolved(boq, sheet_name)` — one index-covered query across every discipline with current rows, resolving an effective verdict PER ROW via the owner-locked server-side ladder (human wins, most-recent between disciplines > auto-accepted > higher-confidence between multiple autos, row flagged `cross_engine_conflict` > blank). `get_sheet_categories` (single-discipline) is BYTE-UNTOUCHED; it now backs ONLY `freeze_classification`'s stamping/banking. **Freeze summary reads the resolved ladder (Slice 1a):** `get_freeze_summary`'s blank counts come from the shared SERVICE helper `persist.blank_category_eligible_rows(boq, sheet_name, committed_version)` — eligible rows (node_type in {Line Item, Preamble}) whose RESOLVED effective category is blank across EVERY discipline; **a row with NO `BoQ Row Category` record is BLANK (the load-bearing fail-open guard — never-classified rows are ABSENT from the resolved read, so the count keys on the eligible NODE set, not on returned rows).** The ladder itself was relocated `classify._resolve_row_ladder` → `persist.resolve_row_ladder` so the resolved read AND this helper share ONE ladder (no service→api import; mirrors the frozen-reader precedent). `get_freeze_summary`'s `discipline` param is now accepted-but-IGNORED (resolves across all disciplines; single-discipline counts unchanged). `freeze_classification` stamping is deliberately deferred to its own slice. **`cross_engine_conflict` is TELEMETRY-ONLY — computed, never persisted, NEVER rendered** (owner ruling, same as `review_priority`). The whole pathway is N-ENGINE GENERIC — no discipline is named in code (the HV-10 bug was a hardcoded `discipline="Electrical"`); a future engine flipping `available` flows through with zero code change. The picker groups by the disciplines that ran and a human pick carries its group's discipline; the write (`set_row_category`, unchanged — it validates vocabulary + upserts) lands on that engine's row identity. Category picks on HVAC sheets are safe from HV-10 on. **`rules_version` provenance is WHOLE (HV-11): `load_ruleset` now surfaces `version` (the one additive loader line the HV-9 note owed — the same gap class as `routing_policy`), so `orchestrator` stamps it and new rows carry the real ruleset version (HVAC `4.2-hv7`, Electrical `2.1-tuning2`) beside `prompt_version`/`model`. The row-stamp chain (`orchestrator.classify_sheet_rows` reads `ruleset.get("version")` → row dict → `persist.write_row_categories`) was already correct; only the loader was blind.** **Ancestor-aware attribute guard (HV-5, rules side, HVAC-GATED):** an `exclusion` rule may carry `"applies_to_ancestor": true`, which moves its patterns off the line's own text and onto the **RESOLUTION POINT** — the ancestor nearest-hit settled on. Such a rule FORBIDS its category for that ancestor's children. It is consumed ONLY on the nearest-hit path, so a legacy discipline (no resolution point) is structurally unable to reach it, and `rules_electrical.json` carries none — proven byte-identical on the 2,888-row electrical corpus. This is how the owner's **4A composite ruling** is enforced at section level (`INS-COMPOSITE-ANC-EXCL`): a header describing a HOST item (pipe/duct/valve) that mentions insulation only as an ATTRIBUTE cannot yield Insulation for its children. **The discriminator is DISTANCE, not vocabulary** — the pattern requires ≥2 intervening words, so compound-noun item forms (`duct insulation`, `pipe insulation`, `underdeck insulation`) never match and insulation-is-the-item still wins. **The HVAC Boundary Rulings register (R1–R10, owner-dated 2026-07-21) is encoded in `rules_hvac.json` AND `prompts/hvac_ai_category_prompt.md` — the two must be changed together or the voters diverge.** **HV-6 final rulings (owner-dated 2026-07-21, in rules v4 + prompt v1.3):** (1) the **CHW/DX boundary is the FEED MEDIUM, never the form factor** — cassette/hi-wall/ductable/split are FORM words that resolve only with a water-fed or refrigerant-fed context, taken from the line's own text **OR its section header**, and bare form with neither context stays LOW/contested on purpose; **VRF keeps precedence** because VRF is refrigerant-fed too (`DX-VRF-EXCL`), and the bare token `refrigerant` is deliberately NOT a `DX-ANC` token (measured: it collides with VRF and cost 4 rows); (2) **a VRF system's own controls are `hvac_vrf`** (`VRF-CONTROLS`), with Sensors keeping the BMS basket only (`SNS-VRFCTRL-EXCL`); (3) **Misc is UNCHANGED** by explicit owner ruling. **`PNL-ANC-TYPE` is RETAINED by measurement** — despite its 18.8% Set-2 precision, deleting it costs 23 correct rows and fixes none (it resolves bare fragment leaves under a panel header); the distance-restricted fix needs a per-rule distance field in `runner.py` and is deferred to HV-7. **Notes-as-fallback matching surface (HV-6b, rules side, OPT-IN PER DISCIPLINE):** a discipline's `rules_<disc>.json` may declare top-level `"matching_surface": "notes_fallback"`, which makes rule matching TWO-PASS — pass 1 is NOTES-FREE (item/exclusion rules see the row description only; ancestor rules see ancestor descriptions only, each at its own level), and the LEGACY full surface (descriptions + all notes, own and ancestor) re-runs ONLY when pass 1 abstains outright; a pass-1 verdict wins as-is. **ABSENT = the legacy single pass, byte-identical.** The gate sits OUTSIDE every existing mechanism and changes none — each pass runs the complete unmodified pipeline (nearest-hit, decay, guards, exclusions, tie-break, band, geometry override); pass 1 re-enters `classify_line` with `ancestor_texts := ancestor_headers`, so NO `context_builder` change was needed, and a private `_notes_fallback_pass` kwarg guards recursion (without `ancestor_headers` the gate cannot engage and legacy runs). Verdicts carry a `matching_pass` stamp. **GATING IS LOAD-BEARING: HVAC carries the flag; Electrical does NOT and is proven byte-identical across the `runner.py` change itself (1,384 corpus line items, 0 differ, verdict hash `818dd8f1…1a5f`) — Electrical adopts this surface only via its own measured re-run, a rider on the Set-3 item.** Measured on the combined 2,354-row corpus: 68.39% → **75.49%** (Set-2 64.13% → 73.07%), AI agreement 69.80% → 77.74%, review share 37.6% → **29.6%** at 98.67% auto-accept. Owner WAIVED the per-category gate (ADP −6 rows) on 2026-07-21, accepting ADP precision 67.4% → 82.1%. **THE AI FEED IS DELIBERATELY UNTOUCHED — the voter still reads notes in full because it reads them semantically; this surface divergence between the two voters is intentional and must not be "tidied up".** Set-3 confirmation is OWED. **Per-discipline routing policy (HV-7, OPT-IN):** a discipline's `rules_<disc>.json` may declare a top-level `routing_policy` block (`policy_id`, `min_ai_confidence`, `demoted_categories`, `priority_max_ai_confidence`), consumed by the pure `routing.route_policy_v1`; **ABSENT = the legacy `route_r3d` path, byte-identical** (`route_r3d` is untouched, and `rules_electrical.json` carries no block). The orchestrator resolves it ONCE per run via `ruleset.get("routing_policy")` — **which only works because `load_ruleset` explicitly surfaces the key: the loader returns a HAND-BUILT dict, so any gating key missing from that return is invisible to every caller and its feature is SILENTLY INERT** (this exact gap stopped HV-7 mid-slice; a negative test now pins that Electrical reads it present-and-None). Signed HVAC values (owner 2026-07-21): auto-accept iff both voters agree on a non-blank category AND `ai_conf ≥ 0.80` AND the category is not in `{hvac_ahu, hvac_cables, hvac_sensors}`; everything else routes to review with a **BLANK** `final_category_id`. **THE DEMOTION LIST IS DATA, NEVER CODE** — it is re-derived from the in-segment grid every eval cycle (it already moved once at HV-6b) and a test asserts no `hvac_` id appears in `routing.py`. Measured: auto-accept 70.4% @ 98.67% combined / 67.8% @ 98.53% Set-2, review 29.6%. **`review_priority` (Check on `BoQ Row Category`, migrate-carrying) is TELEMETRY ONLY — owner amendment 2026-07-22: every review row is presented identically (blank final, `Needs review`), exactly as Electrical; the field must NEVER drive reviewer-facing UI and the HV-7f frontend slice is CANCELLED.** It is stamped 0 on auto-accepted rows, 0 on the legacy R3d path, and explicitly 0 on the AI-off fail-safe (the AI never ran, so its absent confidence is not evidence of doubt). Certification runs use the tracked `BOQ_HARNESS_MODE=certify` harness mode (no DB writes).

**Nearest-hit ancestor resolution (HV-4, rules side, OPT-IN PER DISCIPLINE):** the runner can resolve ancestor signals at the NEAREST ancestor that fires anything instead of flattening the whole chain into one blob — only signals firing AT that resolution point contribute, and farther ancestors contribute **nothing** (not a decayed remnant; this is the distinction from D1 decay). Config is the discipline's `rules_<disc>.json` top-level `ancestor_resolution: "nearest_hit"`; **ABSENT = the legacy blob path, byte-identical.** The same flag also switches that discipline onto the deterministic tie-break chain (score → rule weight → distinct signal types → declaration order) in place of the legacy **alphabetical-by-`category_id`** tiebreak. **Gating is load-bearing and must not be widened casually: HVAC carries the flag; Electrical does NOT and is proven unchanged on its 2,888-row labelled corpus (identical sweep + per-category CSVs, 86.88%).** Decay COMPOSES with it (the resolution point's one distance is scaled by `m**d`); it does not compete.

**Proximity decay (D1, rules side):** the runner supports PER-DISCIPLINE ancestor proximity decay — an ancestor signal weakens with degree of separation as `weight * rules_multiplier ** distance` (immediate parent `d=0`), contributing ONCE at the nearest matching ancestor. Config is the discipline's `rules_<disc>.json` top-level `decay` key; **default is FLAT (`{"rules_multiplier": 1.0}`) so every shipped discipline is byte-identical to pre-decay**. `classify_line(decay_override=...)` overrides it (the offline-sweep lever); the decay code path runs ONLY for `0 < m < 1.0`. AI-side decay is deliberately HELD (rules side only). **BOTH shipped disciplines are MEASURED FLAT and neither may be changed without a fresh sweep:** Electrical carries NO `decay` block (locked flat by its D2/D2b sweep — do not wire one); HVAC carries an EXPLICIT block at `1.0` stamped **`PROVISIONAL-FIT`** (HV-3 swept the certified ladder over the 1,366 labelled Set-1 rows — flat won, best non-flat `m=0.90` was −8 rows). PROVISIONAL-FIT means fitted on the team's provisional labels: a re-sweep is OWED at clean labels and the value is NOT certified until then.
- `BoQ Category Truth Snapshot` — permanent per-(snapshot event × row) ground-truth labels for the classifier eval (D3a). **Truth model = FREEZE SNAPSHOTS, not live edits:** live `BoQ Row Category` rows are WORKING STATE (a re-classify supersedes them and human verdicts do NOT carry forward — stranding is INTENTIONAL, the carry-forward plan is dropped), while ground truth is BANKED here at explicit events and is PERMANENT (never deleted; unfreeze/re-classify never touches prior snapshots). Identity mirrors Row Category's durable Excel address (`boq`, `sheet_name` VERBATIM #152, `excel_row`, `discipline`, `committed_version`) + a `snapshot_batch` per event + `source` (`Bulk-loaded ground truth` / `Frozen in product`); the cockpit joins a snapshot row to the current Row Category row by `(boq, sheet_name, excel_row, discipline)`. Loaded out-of-band by `services/boq_category/harness/corpus_classify_and_label.py` (modes `resolve` / `classify` / `label`; `label` writes SNAPSHOTS, NOT `human_category_id`, so live rows are untouched). The in-product **Freeze/Unfreeze button is SHIPPED** (`classify.freeze_classification` / `unfreeze_classification` / `get_freeze_summary`): Freeze banks one `source="Frozen in product"` batch (`snapshot_batch = "gtfreeze-"+hash`) consuming this doctype AS-IS AND stamps each categorised eligible row's effective category into `human_category_id`; the "human write-back at a new committed_version" is a re-freeze after a re-classify (the durable-address stamp lands on the new version's rows).

- **Committed read indexes (deploy invariant):** the two D3d read indexes -- `BoQ Committed Sheet Grid Row` `parent` and `BoQ Row Category` composite `(boq, sheet_name, committed_version, discipline, is_current)` -- are declared in each controller's `on_doctype_update` and applied to ALREADY-DEPLOYED databases by the patch module `nirmaan_stack.patches.v3_0.add_boq_read_indexes` (it CALLS the hooks -- single source of truth, not a re-inlined `add_index` -- and is idempotent). A plain migrate does NOT fire `on_doctype_update` for a controller-only change, so existing DBs need this patch; `BoQ Category Truth Snapshot`'s index is EXCLUDED (its hook shipped atomically with the new doctype, so a fresh sync always creates it). The `patches.txt` wiring line is added EXTERNALLY by the maintainer -- it is intentionally not part of the patch.

**BoQ pricing-editor load-bearing invariants** (full rules in `.claude/context/domain/boq-backend.md`):
- **Single-editor lock:** deterministic PK `sha1(boq \x00 sheet_name \x00 int(version))`; reject marker `BOQ_PRICING_LOCKED`; 2-min edit-driven expiry (`LOCK_STALE_SECONDS = 120`); a lock reject mutates NOTHING.
- **Priceability gate (owner-locked, ASYMMETRIC):** a rate is editable iff override OR `node_type == "Line Item"` (always) OR (`node_type == "Preamble"` AND qty-bearing). Enforced BOTH client + server (`save_cell_price`); do NOT collapse the Preamble/Line-Item asymmetry. **The server qty-bearing test lives in the SERVICE layer (`persist.node_is_qty_bearing` / `persist.is_nonzero_qty`, relocated from `pricing.py` in Slice G1) so it is defined ONCE and reachable by both `pricing.py` (imports UP, api->service) and the coming rate-editable category count; the client `isRowQtyBearing` in `PricingGrid.tsx` is a DELIBERATE cross-language duplication, NOT the same code.** **Rate-editable blank-category count (G2a, ADDITIVE, no gate):** `persist.blank_category_eligible_rows` takes a `population` param — `"eligible"` (default, classification set {Line Item, Preamble}, BYTE-IDENTICAL to pre-G2a; `get_freeze_summary` keeps this) or `"rate_editable"` (Line Item ALWAYS + qty-bearing Preamble). The rate_editable path batches the qty test via `persist._qty_bearing_node_names(nodes)` — ONE `BOQ Node Qty By Area` child query, reusing `is_nonzero_qty`; `node_is_qty_bearing` is UNCHANGED (a consistency test pins the batched set == the single-row test per node). `get_priced_rows` ADDITIVELY surfaces `rate_editable_blank_category_count` (int) + `categories_complete` (bool, count==0) — PAYLOAD keys, not schema; **NO gate/lock/override ships in G2a.** **Category gate + admin override (G2b, SHIPPED, MIGRATE-carrying):** `save_cell_price` REJECTS a rate write while any RATE-EDITABLE row has a blank RESOLVED category — `_guard_categories_complete` in `_resolve_and_guard_cell`, placed AFTER the mandatory formula gate and OUTSIDE the priceability override block, so **"Price any row" can NEVER bypass it** (owner ruling; ABSOLUTE like the formula gate; the formula gate still wins precedence). It REUSES the G2a `blank_category_eligible_rows` (same fn `get_priced_rows` counts from → gate + banner can't disagree; short-circuits when the override is set). **The ONLY escape is an admin override:** `pricing.set_category_override` / `clear_category_override` (admin = the EXISTING `_is_nirmaan_admin`, NOT re-minted; non-admin → `PermissionError`), persisted per-sheet-per-version on 4 new `BoQ Sheet` fields `category_gate_override`/`category_override_by`/`category_override_at`/`category_override_reason` (mirrors the freeze trio; reason optional, capped `_CATEGORY_OVERRIDE_REASON_MAX_LEN=250`, NULL when absent; `set_value(update_modified=False)`+commit). `get_priced_rows` surfaces those 4 keys. **NO grandfathering** (uniform on all committed sheets incl. already-priced; a rate revision on an uncategorised sheet must categorise first). **The WITHIN-BoQ rate carry-forward path is GATED too (G2c, owner ruling): `apply_copy_forward`. The DESTINATION sheet's categories govern.** ⚠️ **`cross_boq_carry._apply_sheet_carry` (the cross-BoQ REVISION carry) is NO LONGER GATED — ADR-0014 Amendment E (2026-07-28) removed it from that path ONLY.** Once that action CARRIES categories, gating it on categories being complete blocks its own remedy: a freshly committed revision has ZERO category rows, so the gate is shut, so the carry that would populate them cannot run. `save_cell_price` + `apply_copy_forward` KEEP the gate — it exists to stop a HAND-TYPED rate landing on an uncategorised row, and a carry moves known values from a known-good source. **Do NOT "restore consistency" by re-adding it to the carry path** (`test_h_categories_block_is_gone_from_the_message_family` guards the message maps; a re-added branch `KeyError`s loudly, which is intended). ONE shared condition `pricing._categories_gate_ok` (override OR no ELIGIBLE blank — the SAME `blank_category_eligible_rows` the save gate + banner use) drives the remaining call sites; each keeps its OWN voiced messaging over that one condition: the save path throws via `_guard_categories_complete`, `apply_copy_forward` throws an inline copy-forward-voiced message. The carry gate is SHEET-LEVEL, checked ONCE per call, never per-row (never calls `_resolve_and_guard_cell` in the loop; per-row was rejected on cost ~15 ms×K + failure-shape mismatch). ⚠️ **The two seams now differ DELIBERATELY:** cross-BoQ REMOVED the gate (Amendment E) while within-BoQ REORDERED it — on `apply_copy_forward` ADR-0014 **Amendment F** moved it to AFTER the lock acquire and AFTER the layer carry, one transaction, rollback on refusal. The mandatory-formula gate keeps precedence in both. Both carries stay ATOMIC (rollback, nothing written on a block) and fully REPLAYABLE + idempotent (freeze-and-supersede; nothing stranded), and the admin override unlocks carry too. **The gate covers the ELIGIBLE MASTER SET ("empty is empty", owner-locked): `node_type` in {Line Item, Preamble}; PRICEABILITY is NOT part of the gate — a qty-less Preamble IS in the set.** BLANK = the category cell the user SEES is EMPTY, whatever the path to empty (never-classified, classified-and-blank, AI-never-ran, human-cleared, whitespace id). `_categories_gate_ok` + `get_priced_rows` pass `population="eligible"` (the DEFAULT), so **the gate count == `get_freeze_summary`'s count == the surfaced `eligible_blank_category_count`** — ONE number, never diverging. The `"rate_editable"` mode of `blank_category_eligible_rows` (+ its batched qty helper + its mode tests) is RETAINED but currently UNUSED — kept because the future tendering-module rate helpers operate on exactly that population; do NOT delete it. The client `isPriceableType` (`PricingGrid.tsx`) TRIMS `node_type`, so the server/client master set is byte-identical (the server always strips). **ONE shared frontend predicate `PricingGrid.isMasterSetBlank(row, cat)` = `isPriceableType(node_type) && deriveVerdictState(cat) === "unclassified"` drives BOTH the grid's amber Category-cell fill AND the page's Check-Category view filter, so they can never drift** — it REPLACED `isNeedsReviewCategory`, which returned FALSE for a never-classified row and so could not surface rows the gate now counts. The real-data cost of the widening is owner-ACCEPTED; do NOT re-raise it. Test fixtures satisfy the gate by CATEGORISING (`_categorise_fixture_eligible_rows`), never by override. **VISIBLE HALF (frontend):** the page derives a LIVE blank COUNT client-side from the SAME `isMasterSetBlank` predicate (now FOUR surfaces over one predicate: the server gate/count, the grid amber fill, the Check-Category filter, and this count) via `PricingGrid.countMasterSetBlankRows(rows, categoriesByExcelRow)` -- iterating the ROWS, NEVER the categories map, so a never-classified row (absent from the map) is still counted. Only a BOOLEAN `categoryGateOpen = (count === 0) || override` (`isCategoryGateOpen`) reaches `PricingGrid` -- NEVER the count (a count changes on every pick and would re-render every row; the boolean flips only when editability actually flips). `categoryGateOpen` is ANDed OUTSIDE `isRateEditableRow` in ALL THREE rate-write gates (inline edit, paste, undo/redo), exactly like `formulasComplete`, so "Price any row" can never reach past it. **DELIBERATE asymmetry: the count keeps counting blanks under the override (an admin sees how many remain) but the gate opens.** The category-pick handler writes an optimistic override for BOTH a pick AND a clear (`buildOptimisticVerdict`): a clear yields a BLANK verdict so the count RISES instantly and the sheet re-locks in the same interaction (closing the pick-drops-but-clear-rises-late window). The amber banner shows the count with the owner-approved copy (a distinct OVERRIDE variant naming who/when); it NAMES the existing "Check Category" control (no new button, no click-to-jump). The **save/copy-forward/cross-BoQ refusal messages drop the pre-G2e "priceable"/"rate-editable" wording** (those terms remain correct only for the SEPARATE priceability gate); the save message threads the blank count. `GetPricedRowsResponse` declares the `eligible_blank_category_count` / `categories_complete` / `category_gate_override` (+`_by`/`_at`/`_reason`) keys. **OVERRIDE REMOVAL CONDITION: remove the override once classification engines cover all disciplines.** **The override is CLEARED on a successful WHOLE-SHEET re-classify (G2d, owner-locked): `classify._classify_worker` calls `pricing.reset_category_gate_override_on_reclassify` after the classify commit — SUCCESS-ONLY (never in the `except`), WHOLE-SHEET-ONLY (`scope.mode == "sheet"`; a partial row-range run leaves it INTACT), IDEMPOTENT (no override => no-op), and it MUST NEVER fail the classify run (wrapped in `_clear_override_after_reclassify`, which logs + swallows and returns False — the gate fails SAFE). RATIONALE: a re-classify changes which rows have categories, so an override granted against the OLD picture must not silently carry forward; the admin re-asserts. `set_row_category`, freeze/unfreeze, and partial runs do NOT clear it. The clear write is the SHARED `pricing._write_category_gate_override_cleared` (also used by the `clear_category_override` endpoint — one write, not a third `set_value`). PER-ENGINE by design: a re-classify fires once per selected engine (`ClassifySheetDialog` loops `start_classify` → N independent `_classify_worker` runs; NO all-engines completion barrier), so each engine's worker clears independently and an override re-set between two engines' completions is wiped by the later one.**
- **Mandatory amount-formula gate (ABSOLUTE):** every amount column needs a covering formula before ANY rate is editable; the `allow_non_priceable` override does NOT bypass it. **It also gates the whole revision carry (ADR-0014 Amendment C)** — see below.
- **Revision carry (owner-locked, ADR-0014 Amendment C + Amendment E):** a revision COMMIT carries **nothing** but the D2 provenance triple (`committed_carry.stamp_revision_provenance`; the stamp must stay — it is how the carry finds its source). Formulas are **hand-declared per sheet**, exactly as in the normal phase, and that declaration gates ONE explicit per-sheet action in the pricing editor (`cross_boq_carry.apply_sheet_carry` — synchronous, atomic). **Amendment E (2026-07-28) REVERSED Amendment D and restored the four row-addressed layers, OPT-IN + ATTRIBUTED**: that action moves rates **plus** any ticked subset of `LAYER_KEYS = ("categories", "remarks", "colors", "remark_dismissals")`, riding the SAME transaction. Amendment D's objection was that carried records arrived **un-asked-for** and **un-attributed** — BOTH halves must stay answered or the original defect returns: (1) every layer is opt-in (dialog defaults categories ON, annotations OFF — a **UI default, never a backend one**; an omitted payload carries rates only), and (2) every carried record is stamped `carried_from_boq`/`carried_from_version`/`carried_at`, **keyword-REQUIRED on `persist.carry_row_categories`** so no path can produce an unstamped record — do NOT soften it to an optional kwarg. **⚠️ The carried `human_verdict_at` keeps the SOURCE's older timestamp — never freshen it**: `resolve_row_ladder` breaks a human-vs-human tie on the most recent verdict, so keeping it old is exactly what makes a verdict made ON the revision outrank a carried one, with no precedence code anywhere. **⚠️ `carry_category_layer`'s classification-freeze guard is the ONLY one on this path** (`cross_boq_carry` gates the freeze nowhere) — it is NOT defence in depth and must not be removed as redundant. Formulas NEVER carry, in either seam. The source read is **version-pinned** to the original's current committed version, and `revision._carry_counts` is pinned identically — **never pin one without the other** (that divergence is the defect Amendment B W6 was written for). ⚠️ Frappe **STRIPS every value in an `["in", [...]]` filter** (an `=` comparison is not), so any committed-sheet read filtering on `sheet_name` must filter names **in Python** — use the shared `revision_carry.current_committed_sheets`.
- **Committed controllers are CAPTURE-ONLY** (Phase 5 Slice 2.5): no amount = qty×rate recompute, no parent-rate overwrite — the future tendering module owns calculations.
- **Classification freeze (owner-locked, SEPARATE from the pricing lock):** a per-sheet freeze on the committed `BoQ Sheet` (`classification_frozen`/`frozen_by`/`frozen_at`, set via `frappe.db.set_value(update_modified=False)` — NEVER `doc.save`). While frozen, category verdict writes AND re-classify are rejected via `_guard_classification_not_frozen` (primary in `set_row_category` + `start_classify`; defence-in-depth in `persist.set_human_verdict` + `orchestrator.classify_sheet_rows`); the ONE frozen-reader is `persist.is_sheet_classification_frozen`. **Pricing is NOT touched by this guard — it is NOT ORed into the pricing `locked`/`is_locked` gate; a classification-frozen sheet is still fully priceable.** Freeze is ATOMIC (single end-commit, rollback-on-failure): it stamps effective categories via the no-commit `persist.stamp_human_verdicts_bulk` (NOT `set_human_verdict`, which commits per call) + banks a `Frozen in product` snapshot batch. **The stamp SOURCE is the MULTI-ENGINE resolved read (Slice ST-1, owner Option A 2026-07-26): `persist.resolved_category_stamp_targets` — the exact INVERSE of `blank_category_eligible_rows`, sharing the ONE `persist.resolve_row_ladder` — so a sheet classified under N disciplines stamps rows from EVERY vocabulary in one freeze, each on its RESOLVING discipline's `is_current` row (grouped through `stamp_human_verdicts_bulk` per discipline). ONE FIFTH-SURFACE NUMBER: snapshot_count == the resolved non-blank eligible count == `get_freeze_summary`'s number. On a single-discipline sheet the stamped set + snapshot content are BYTE-EQUIVALENT to the prior single-discipline stamp (pinned by test). `get_sheet_categories` is BYTE-UNTOUCHED (the freeze trap — it now backs ONLY the tests' regression pin). The `discipline` parameter is accepted but drives ONLY the availability guard, NO LONGER the stamp set (mirrors `get_freeze_summary`'s accepted-but-unused disposition). Re-freeze after a re-classify inherits automatically through the SAME resolved read — a fresh run banks a NEW snapshot batch while prior batches stay permanent.** Re-commit resets the flag (a fresh `BoQ Sheet` row defaults 0). Frontend reads `classification_frozen` off `get_priced_rows` beside `is_locked`.
- **BCS — the INTERNAL cost layer of a committed sheet.** BCS records what the work costs US (hand-typed Supply / Installation / Combined cost rates per row on `BoQ Row BCS Rate`) against the BoQ amount we charge the CLIENT; Total Amount and % Margin (renamed from % Profit, owner 2026-08-07 -- a RENAME, the arithmetic is unchanged) are ALWAYS computed downstream from those stored rates and never persisted. **BCS Total Amount AND BOTH % Margin operands are editable per-sheet FORMULAS since BCS-S9/S10/S11** — the margin's `(1 − cost/amount) × 100` RATIO is not, and cannot be **in the in-app builder**: it needs numeric literals, which the formula system rejects by design, and it carries the sign guard that stops a loss rendering as a positive margin. ⚠️ **THAT "CANNOT" IS SCOPED TO THE BUILDER AND WAS ONCE MISREAD AS ABSOLUTE** — the BCS EXPORT writes the same ratio as an Excel formula with both literals and the sign guard intact (see the internal-export note below); do NOT cite this line as a reason the margin cannot be exported.  **BCS Total Amount's rule is itself an editable per-sheet FORMULA since BCS-S9** (green f on its header, stored in the existing `BoQ Cell Amount Formula` as target `bcs_total` -- no schema change); an absent formula means the built-in `(cost boxes) x quantity`. Full as-built: `.claude/context/domain/boq-backend.md` (storage, endpoints, carry) + `frontend/.claude/context/domain/boq-frontend.md` (the cost block, the % Margin header filter + sort, summary axis). ⚠️ BCS-S4's separate flat **margin VIEW is DELETED** (owner 2026-08-07) — filtering to a % Margin range and ordering by it are now two controls ON the % Margin column header, and are FRONTEND-ONLY view state (no endpoint, no schema). ⚠️ **NAME COLLISION — READ THIS BEFORE GREPPING.** "BCS" in the **BoQ Rate Master** sections further down means something else entirely (a stored derivation pipeline: discounted product cost plus wastage, no install). Same three letters, unrelated concept, different owner; a search for BCS lands on both and they must never be reconciled with each other. The four invariants below are the ones that are NOT obvious from reading the code:
  - **THE IMPORT-DIRECTION LAW — the readiness predicate lives in `services/`, and it had to.** `services/boq_bcs/readiness.py` documents a ring verified at module level: `committed_carry -> bcs -> pricing -> committed_carry`. **NO placement anywhere inside `api/` avoids it** (`cross_boq_carry` imports both; `commit_pipeline` is a third dependent), so the predicate moved DOWN to the layer both sides may import — api -> service is the one legal direction, and the `boq_category.persist` relocations are the exact precedent. `api/boq/wizard/bcs.py` imports the name straight back, so `bcs.bcs_is_ready` still resolves and no caller changed. **Do NOT "tidy" it back into `api/`, and never add a second copy:** two copies would sit on either side of a carry and could disagree about the same sheet at exactly the moment it mattered — the plan read offering a layer the apply then silently drops. Correspondingly, **nothing under `services/boq_bcs/` may import from `api/` or read request context**; a DB read there is fine and is not the same thing.
  - **THE SCOPE FENCE (owner-locked) — BCS readiness gates BCS CELLS ONLY.** It must **NEVER** be ANDed into `save_cell_price`'s rate gate. **State the failure mode, because that is what makes this load-bearing: get it wrong and a BCS section that is merely switched OFF silently freezes ordinary client-facing pricing in production** — every rate cell read-only, for a reason no one on the screen can see. The BCS write path is deliberately independent of the three client gates (mandatory-formula, priceability, category) for the same reason: someone must be able to cost a job while the amount formulas are still being declared and the rows are still being categorised. A qty-less Preamble IS costable. The asymmetry IS the decision — do not "restore consistency" with `save_cell_price`.
    ⚠️ **THE READINESS CONDITION ITSELF CHANGED AT BCS-S12 (owner 2026-08-07): `bcs_is_ready` is now simply `bcs_enabled`.** It used to also require the two column confirmations, and those moved into the BCS Total / % Margin formula dialogs together with the pickers that produced them. **The two changes must NEVER be separated**: `save_row_bcs_rates` refuses every cost write while readiness is false, so re-adding the confirmation requirement without re-adding the pickers makes readiness permanently FALSE — BCS switches on and stays silently read-only forever, with no message anywhere saying why. `confirm_bcs_columns` and both JSON fields still exist and are still read as the pre-S12 defaults' seed, so nothing is orphaned. Detail: `.claude/context/domain/boq-backend.md` § BCS-S12.
  - **THE EXPORT-LEAK BOUNDARY — BCS cost, every BCS-derived total, and the margin must NEVER reach the client workbook.** `export_priced_workbook` is handed to the CLIENT, so a BCS value appearing in it leaks what the job costs us. The export reads `BoQ Cell Pricing` and names its fields explicitly, while BCS lives in its own doctype with no `col_letter` at all. **Anything that folds BCS onto `BoQ Cell Pricing`, adds a BCS stamping pass, or widens the export's field list breaks it.** ⚠️ **A NEW STORED COST FIELD MUST BE SEEDED INTO THAT GUARD'S FIXTURE, or the guard passes on an empty axis** — an unseeded field has nothing to leak, which is the precise vacuity the guard exists to avoid, and it has happened once already on this layer.
    ⚠️ **AMENDED 2026-08-19 — THERE IS NOW A SECOND, SANCTIONED EXPORT THAT DOES CARRY BCS, AND THE BOUNDARY IS UNCHANGED BECAUSE IT LIVES IN ITS OWN MODULE.** `api/boq/wizard/export_bcs_writeback.export_priced_workbook_with_bcs` is the INTERNAL priced workbook (admin + estimation only, reusing the Pricing Module's `PRICING_ACCESS_SET`); `export_writeback.py` has a **zero-line diff** and its grep guard — the module source may not contain `bcs` in any casing — still holds. **Do NOT merge the two, and never add an `include_bcs` flag to the client endpoint:** the flag would break the guard that makes this boundary structural rather than careful. Every STAMPING helper is shared by import (one definition each); only the orchestration loop is duplicated, deliberately. The separation is pinned from BOTH sides — one test greps the client module for BCS tokens **and** asserts the internal module names them, and another exports the SAME BoQ both ways, so the "no BCS in the client file" guard can never pass merely because there was nothing to find. The internal export writes NOTHING to the database (in particular it never stamps `last_exported_at`, which means "when the CLIENT last got this sheet"). ⚠️ **IT DOES NOW CARRY A `% Margin` COLUMN (BCS-EXP-6, owner 2026-08-19), REVERSING the original ruling — and the earlier "cannot" applied only to the in-app formula BUILDER, never to the export.** The ratio is written as an EXCEL FORMULA carrying literals (`((amount-cost)/amount)*100`), which the export has always been free to do — `_guarded` already emitted `COUNT(...)<n`. **The `<=0` SIGN GUARD is why the column ships rather than being left to a pricer to add by hand:** a negative denominator flips the inequality, so a hand-typed `=(F2-I2)/F2*100` shows a loss as a positive margin, silently. **Its numerator REFERENCES the BCS Total column rather than re-deriving it** (so the file stays live), and a declared `bcs_margin_cost` / `boq_total` formula is translated rather than ignored. ⚠️ **THE BLANK-WITH-A-REASON PROPERTY IS THE ONE THING LOST IN EXCEL** — there is no tooltip — so the guard is deliberately left LEGIBLE IN THE CELL. A margin skip is reported on the BLOCK (`margin_skipped`), NEVER in `cost_skipped`: such a sheet did get its costs and its Total. ⚠️ **BCS-EXP-7 (owner, after the live check) REVERSED planning Q9: `Nirmaan Remarks` now comes BEFORE the BCS block** — the layout is `client data | Nirmaan Remarks | BCS Cost(s) | BCS Total Amount | % Margin`, so everything internal sits beyond the shared column. **It is the CALL ORDER of the two placers, never an offset** (both scan rightward past occupied columns), and the layout is PER SHEET — a sheet with no remarks starts its block one column earlier. **A BCS cell holding a figure also carries a light-blue fill** (`_BCS_FILLED_HEX`, the counterpart of the rate highlight's teal): **CELLS, never columns** — an uncosted row stays unfilled, because filling the full height would claim every row is costed. It reuses the user palette's `blue`, which the rate highlight deliberately avoids, and is safe ONLY because a user colour tag cannot address a column this module appends.
    ⚠️ **THIS BOUNDARY IS NO LONGER "BY CONSTRUCTION" (BCS-S9, owner-accepted).** It used to be: the formula layer had no way to NAME a cost, so nothing could carry one into a client column. S9 gave the shared formula vocabulary BCS operands (`bcs_supply`/`bcs_install`/`bcs_combined`/`bcs_qty`) so `BCS Total Amount` could become an editable formula, and **two DIRECTIONAL rules in `pricing._validate_formula_operands` now hold the line instead**: a `bcs_total` target may use ONLY those operands, and an AMOUNT target may use NONE of them. **The second is the leak-facing one** — an amount column's computed VALUE is what the export writes, so a cost operand in a client amount formula leaks the cost as a NUMBER, invisible to any field-list audit. A second, independent stop lives in `export_template_workbook.resolve_target_col` (internal-only targets return `None` before either resolution path). **Enforcement replaced construction, so both stops must survive every refactor — and neither may be relaxed "for symmetry".** Full reasoning: `.claude/context/domain/boq-backend.md` § BCS-S9.

---

## Working with Claude Code

- Read `docs/<feature>/spec.md` and the latest entries in `decisions.md` before starting any feature phase.
- **Output a written plan before writing any code. Never write code in the same turn as the plan.** Wait for user review.
- One branch per phase: `feature/<feature>-phase-<N>`. Commit at end of each phase.
- New doctypes: controllers go in `integrations/controllers/`. Doctype `*.py` stays minimal.
- New APIs: `nirmaan_stack/api/<feature>/<file>.py`, snake_case.
- Frontend: stay within the existing stack (shadcn/ui + TanStack Table + Zustand + frappe-react-sdk + React Hook Form + Zod). Do not introduce new UI libraries.
- Pure-Python modules (parsers, services) get real unit tests with fixture files — not stubs.

**Docs discipline -- DOCS-UPDATE RULE (revised 2026-06-25, context-hygiene split):** Per-slice / per-commit as-built detail (feat hashes, test/vitest/tsc counts, build logs, dated slice narratives) goes into the on-demand reference docs ONLY: `frontend/.claude/plans/boq-upload-plan.md` (live status, source of truth) + `.claude/context/domain/boq-backend.md` (backend) + `frontend/.claude/context/domain/boq-frontend.md` (frontend). The always-loaded `CLAUDE.md` files get a MINIMAL touch ONLY when a STABLE convention or a load-bearing / owner-locked invariant changes — never a per-slice changelog entry. **Do NOT re-grow `CLAUDE.md` with commit data** (that bloat is exactly what this split removed). **Enforced in-session by the `.claude/hooks/guard_claude_md.py` PreToolUse hook** — it blocks changelog-style appends to CLAUDE.md and redirects them to the reference docs (see `.claude/hooks/README.md`; tune the patterns there). **Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

---

## BoQ File Reading (S3 safety)

The BoQ upload worker (`api/boq/wizard/upload_file.py`) reads the uploaded file from a `NamedTemporaryFile` written from the in-memory bytes at the endpoint — NOT by constructing a local path from `file_url`. `Frappe File.get_content()` reads local disk only and breaks when `frappe_s3_attachment` is active (it replaces `file_url` with an `/api/method/...` API URL after insert). Any future code that needs to read an uploaded file's bytes should follow the same pattern: capture bytes before `save_file()`, write to a tempfile, clean up in a `finally` block.


---

## Wizard scope discipline (Phase 3 onward)

When a wizard decision has two paths — (a) build the capability inside the wizard, or (b) defer to or extend an existing app-wide flow — surface the fork explicitly in chat before writing code. Default lean: if the capability has reach beyond the Upload BoQ flow (i.e., other Nirmaan features would benefit from it), keep it outside wizard scope. The lean is a starting point only; the final call is case-by-case after discussion.

Common triggers: anything touching shared doctypes (Projects, Customers, Work Headers) in ways other features would also want; new app-wide UI patterns (sidebar items, top nav, modals); auth checks, audit, or notification flows other modules would benefit from.

Origin: Module 1a 2026-05-29 — `create_tendering_project` was initially scoped into the wizard, then dropped when this principle surfaced: tendering project creation has reach beyond the wizard and belongs in the existing Nirmaan new-project workflow.

---

## Wizard Endpoints Reference

All wizard endpoints live in `nirmaan_stack/api/boq/wizard/` (snake_case files; most are `@frappe.whitelist(methods=["POST"])`, return `{"status": "saved"}`, and call `frappe.db.commit()` after DML). The FULL per-endpoint reference — `update_sheet_draft`, `sheet_preview`, `parse_run`, `commit_gate`, `commit_pipeline`, `review_screen` — plus the `BoQ Review Row` schema, the `wizard_status` enum, and the load-bearing gotchas (the `_LIST_JSON_FIELDS` pre-serialize rule, the **-1** parent/root sentinel, the list-valued-JSON `doc.save()`/`delete_doc` wall, the commit freeze-and-supersede + per-sheet failure isolation) lives in **`.claude/context/domain/boq-backend.md`**. Load it before touching wizard backend code.

---

## Pricing Module

Standalone estimation-pricing module (separate from the BoQ wizard). Frontend serves a spreadsheet
editor (Luckysheet-as-static-assets planned) whose workbook state is persisted server-side. Live status
+ roadmap: **`frontend/.claude/plans/pricing-module-plan.md`**.

- **Doctypes** (`nirmaan_stack/nirmaan_stack/doctype/`): `Pricing Workbook` (title, `workbook_json`,
  `current_version`, `checked_out_by`/`checked_out_at`), `Pricing Workbook Version` (per-save snapshot),
  `Pricing Access Log` (open/save/checkout/release/create audit). **All three are `System Manager`-only** —
  the whitelisted API is the single-point access gate, so endpoints read/write with `ignore_permissions=True`.
- **API** (`nirmaan_stack/api/pricing/workbook.py`): `list_workbooks` / `get_workbook` / `checkout` /
  `release` / `save_workbook` / `create_workbook`, all `@frappe.whitelist()` and all gated by
  `_require_pricing_access()`.
- **Transport (FR-5/FR-6):** `create_workbook(title)` and `save_workbook(name)` take **NO `workbook_json`
  param**. They are thin wrappers that read + gunzip the `workbook_json_gz` **`multipart/form-data`** file from
  the request (`_read_gzip_payload` / `_gunzip_payload`, with a 200 MB decompressed guard) and delegate to
  `_create_workbook` / `_save_workbook`, which hold all logic unchanged. Single path, no fallback — the old
  nested-JSON body escaped every quote (1.23x) and 413'd a real workbook against the 25 MiB `max_file_size`;
  gzipped it is ~0.7 MB. Other endpoints unchanged.
- **Access rule — READ/WRITE SPLIT (owner decision, DB-discovered names; PW-2a):** two gates, the write one
  LAYERED on the read one so an outsider and an in-module read-only user get different, honest messages.
  - **READ** (`_require_pricing_access`, used by `list_workbooks` / `get_workbook`): ALLOW if session user is
    `Administrator`, OR `role_profile_name` is in `PRICING_ACCESS_SET`, OR `frappe.get_roles(user)` intersects
    it. The set holds the EXACT DB-verified strings (2026-07-22): `Nirmaan Admin Profile`,
    `Nirmaan Estimates Executive Profile`, `Nirmaan Estimates Executive` — **admins + estimation**.
  - **WRITE** (`_require_pricing_write_access`, used by `checkout` / `release` / `_save_workbook` /
    `_create_workbook`): read gate first, then `Administrator` OR profile/role in
    `PRICING_WRITE_SET = {"Nirmaan Admin Profile"}` — **admins only**. Estimation users get read + the
    client-side Sandbox (a local, never-persisted edit session) and no write path at all.

  Re-query the DB before editing either set. The frontend mirrors the split for UX only — **this module is the
  enforcement boundary**, and `PricingRoute` stays wide (estimation users must still enter the module). Only
  `workbook_json` parsing is validated; structure is frontend-owned.
- **Lock semantics:** `checkout` grants when the lock is free, already the caller's, or held >30 min
  (auto-expiry) — otherwise it throws naming the holder. `save_workbook` requires a live (non-expired) lock,
  bumps `current_version`, writes a Version row, and prunes to the newest 20 snapshots. `release` clears the
  lock for the holder or Administrator.
- **Tests:** `nirmaan_stack/api/pricing/test_pricing_workbook.py` (**20 tests**). Run:
  `bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.pricing.test_pricing_workbook`.
  Writes run as admin-role fixtures (`ADMIN_USER`/`ADMIN_USER2`); `POS_USER` is the estimation actor used for
  the read + negative-write assertions. Every workbook creation MUST go through `_create_as` — the suite runs
  against the LIVE site DB and its purge is scoped to rows it created.

---

## BoQ Rate Master (RM-1)

Backend rate-master for the pricing helper (the standalone estimation data behind cable/termination
rates). Full as-built lives in the plan doc + `.claude/context/domain/boq-backend.md`.

- **Two committed doctypes hold it:** `BoQ Rate Master Item` — discipline-wide priced-item master,
  addressed by `(discipline, kind)`, with a keyed `attributes` JSON (matched EXACT) + a keyed `rates`
  JSON (the raw list/base rates); and `BoQ Rate Category Config` — per-`(discipline, category_id)`, the
  whole config as one JSON blob (attribute definitions + derivation pipelines + `normalization_rule`).
  **JSON fields, not child tables**, per the app's flexible/UI-driven-data rule. Both `track_changes: 1`;
  minimal controllers each declaring a composite read index (`[discipline, kind, brand]` /
  `[discipline, category_id]`) via `on_doctype_update`.
- **Canonical-UPPERCASE normalization at ingest (owner-locked):** the loader uppercases `material` /
  `insulation` on import so messy future workbook exports self-clean at the boundary; ALL downstream
  matching is EXACT on canonical values — there is NO case-insensitive matching anywhere.
- **Batch-provenance import, freeze-and-supersede:** every row of one import carries ONE `import_batch`
  (prefix `rmbulk-`), mirroring `BoQ Category Truth Snapshot`'s gtbulk provenance. A re-run against
  existing active data for a discipline REFUSES cleanly; `--replace` deactivates the prior batch
  (`active=0`, rows retained) and loads fresh — idempotent, no duplicate active rows. Import runs
  service-side (`services/boq_rate_master/loader.py`); RM-1 ships NO write endpoint. Reads are the
  login-required, active-only endpoints in `api/boq/rate_master.py` (`get_rate_master_items` /
  `get_rate_category_config`); the editors are RM-4a (SHIPPED — see below).
- **RM-4a editing endpoints (ADMIN-ONLY, owner option (a); full as-built in the plan doc's "Build slice
  RM-4a").** Four `@frappe.whitelist(methods=["POST"])` writes in `api/boq/rate_master.py`:
  `update_rate_config_param` / `update_rate_master_item` / `create_rate_master_item` /
  `deactivate_rate_master_item`. ALL gate on the IMPORTED `pricing._is_nirmaan_admin` (never a re-minted
  copy), admin gate BEFORE any target resolution or write (`frappe.PermissionError` otherwise). **The
  AUDITED write recipe is `doc.save(ignore_permissions=True, ignore_version=False)`** (get_doc → json.loads
  → mutate the parsed dict → json.dumps → save → commit): both doctypes are `track_changes:1` with
  DICT-valued JSON only (config/attributes/rates — no BoQ-Sheet-style list-valued field), so `doc.save` is
  safe AND records a `Version` diff. **`set_value` is FORBIDDEN for these edits — it bypasses the doc
  lifecycle, so it skips the Version audit.** The explicit `ignore_version=False` is load-bearing (Frappe
  defaults `ignore_version = frappe.flags.in_test`, so without it the audit Version is suppressed under
  `bench run-tests`). **PARAM VALUES ONLY** (numeric; the addressed `config.pipelines[id].steps[i].params` /
  `.conditions[j].params` path must ALREADY exist — adding/removing a param, editing conditions, or
  attribute definitions is RM-4b → validation error, no write). A manual `create` stamps provenance
  `import_batch="manual-"+hash` / `source_sheet="Manual entry"` / `source_row=0`; `deactivate` sets
  `active=0` (RETAINED, never deleted). Frontend HIDES every affordance for non-admins (`isRateMasterAdmin`;
  the server is authoritative). The first `Version` docs for the two rate-master doctypes now exist.
- **RM-4b structure editor (ADMIN-ONLY; full as-built in the plan doc's "Build slice RM-4b").** ONE
  `@frappe.whitelist(methods=["POST"])` write `update_rate_config(name, config)` in `api/boq/rate_master.py`
  LIFTS the RM-4a param-values-only boundary — add/remove params, steps, conditions, and attribute
  definitions. Admin-gated FIRST (`pricing._is_nirmaan_admin`), then FULL server-side STRUCTURAL VALIDATION
  (`_validate_config`) before the SAME audited `doc.save(ignore_version=False)` recipe; valid → write, invalid
  → a NAMED `ValidationError`, NO write. Validation: known step types ONLY (the 8-member interpreter
  vocabulary); every `params` a map of FINITE numbers; conditions are `{attribute: scalar}` EXACT-match
  predicates (**the ONLY shape the pure interpreter executes** — a `{in:[...]}` / `{gte/lt}` predicate OBJECT
  is REJECTED, since the interpreter would silently never match it and changing its semantics is OUT OF
  SCOPE); component_band bands are comparator strings; attribute_definitions well-formed; **a REFERENCE GUARD
  rejects removing a definition any pipeline condition/`band_on` references, naming every referencing
  location**; no unknown top-level keys; an identity guard forbids repointing discipline/category_id.
  **GOLDENS-AS-CONFIG-DATA:** the config carries a `goldens` array (attrs + expected finals per pipeline)
  seeded via ONE audited endpoint call; the vitest golden files stay INDEPENDENT pins. The frontend Pipelines
  tab's PREVIEW GATE computes the goldens against a draft before save (confirm-not-block). Interpreter
  EXECUTION semantics untouched. **The `test_rate_master` count is NOT recorded here — read it from
  `nirmaan_stack/api/boq/test_rate_master.py` itself.**
- **Multi-category import + scoped supersede (owner-locked; full detail in the plan doc's "Build slice
  EA-1").** A rate-master payload may carry a `category_configs` LIST (each config a `BoQ Rate Category
  Config` row, discipline stamped from the top-level payload, per-category goldens merged in as RM-4b
  config-data); `loader.load_rate_master` branches to `_load_multi` and the single-config path is
  unchanged. **Idempotency is SCOPED to the payload's item KINDS + config category_ids, NEVER the whole
  discipline (`_deactivate_scope`): a `replace=True` supersedes only that scope, so importing the
  non-wiring Electrical categories can NEVER deactivate a wiring (cable/termination, wiring_cabling) row —
  the WIRING-UNTOUCHED invariant.** Non-wiring Electrical categories are loaded by PATH from a separate
  asset. (HISTORICAL: this line used to add "`DEFAULT_DATA_FILE` stays the wiring asset" — that constant
  no longer exists, F-20; there is no default and **every** load names its file.)
- **Interpreter step vocabulary (owner-locked, MINIMAL — no loose-formula generalization; the asset
  normalizes every formula to `base` = the step's target value + EXACT param names).** Beyond the wiring
  set, the pure `ratePipelineInterpreter.ts` supports: `component_band` STRING-EQUALITY bands (band_on read
  from the matched item, falling back to the selection) alongside the legacy numeric comparator bands; a
  `scale` value-from-attribute multiply (a `*_from_attr` param binds the selected attribute's value;
  missing/non-numeric → HONEST no-compute, never a zero default); `match_master_row` on the
  stored-vs-selected INTERSECTION (a row matches on the keys it carries, exact where they overlap — wiring,
  whose key sets coincide, is unchanged); and a conditional `component` (params resolved by attribute
  conditions on the selection, formula may be param-only — an unmatched condition is an HONEST no-compute).
  A conditional `component` may ALSO carry a `target` (base from the matched row) together with its
  conditions (e.g. the tray `cover`, `base*factor`) — this shape needed no interpreter change.
  **EA-2b — the CORRECTED cable-tray config is FOUR pipelines** (supply/install/bcs/bcs_install):
  conditional-component adders (cover / ceiling 106 / refill 180 / cutting 200) + an install rate read
  **OFF THE TRAY ROW ITSELF** (**SUPERSEDED at F-16 2026-08-13** — this was a width-table match into the
  parallel kind `tray_install_rate` ×4; see the F-16 invariant below). The old single `tray_boq` (install = supply ×0.2, golden 280/60)
  was WRONG and is DELETED; oracle goldens t1/t2/t3 (431/120/297/0, 415/120/286, 410/200) are the pins,
  machine-verified (config-data preview gate + vitest + live Derivation), so the tray is OFF the manual
  verification list. **EA-2c — `component_ref` (a NEW step): base from a SEPARATELY-REFERENCED master row**
  matched by `ref.kind` AND every `ref.attributes` (exact canonical, this discipline). UNIQUE resolution:
  zero OR multiple matches is an HONEST no-compute (never zero-by-default, never pick-first); the referenced
  row's `target` binds as `base`, then conditions/params/formula per the component contract; the trace names
  the referenced row (`StepTrace.refItem`). It is a first-class vocabulary member (client STEP_VOCABULARY +
  server `_KNOWN_STEP_TYPES`/`_validate_config`). **Owner correction: the earthing adder ADDS A BUS BAR (the
  existing Bus bar earthing_item row), NOT an earth chamber** (the chamber attempt was reverted, asset v8
  skipped v7->v9). This is ONE ROW, TWO ROLES (requirement #7, shared items stored once): the Bus bar row
  prices both as a selectable item AND as the adder; an edit to it flows into both. **component_ref is the
  ASSEMBLY PRIMITIVE's simplest form.** **EA-4a SHIPPED the assembly engine (owner-locked):** two pure-TS
  shapes — `circuit_fit` (sizes conduit + counts circuits: `overall_dia = sum sqrt(sqmm/pi)*2*core`;
  `fitted_size` = smallest usable-dia >= dia; `circuits = ROUNDDOWN(usable/dia)`; `conduit_qty =
  ROUNDUP(length/circuits)`; binds into ctx) and **`component_ref` extended** (ref attrs literal | `@attr` |
  `@fitted_size`; `rate_stages [{mult,round?:up0|up-1}]` with PER-STAGE rounding; `qty` = number |
  `{from_attr}` | `{from_fit}` | `{if_attr,then,else}`; `value = staged_rate * qty`; UNIQUE resolution else
  honest no-compute; both obey Option-C never-throws). **PER-STAGE ROUNDING is faithful to the guiding sheet
  and INTENTIONAL** (install switch `ceil(list*0.3625)` THEN `*0.2` UNROUNDED — pw1 `155*0.2=31`, pw2 White
  `131*0.2=26.2`); do NOT collapse to one final round. **`point_wiring` is LIVE** (14 defs, 3 pipelines);
  goldens **pw1 1869/735/1370** + **pw2 1823/722.2/1342** (MS→3 circuits; the fractional 722.2 pins per-stage
  rounding) are config data AND standing pins — a golden's attrs are an ATOMIC SET. **A switch-only light
  point (socket_item null) is an HONEST NON-COMPUTE — the EA-4a-r acceptance case, not a defect** (EA-4a-r
  adds a `None` socket next). **The nine `extraction_defaults` (owner-locked):** a config default is INJECTED
  into the extraction prompt and, where the row text gives no positive identification, returned with moderate
  confidence AND stamped `defaulted:true` (raceway also carries a `text_override`); ABSENT => byte-identical.
  **`values_from` is resolved in BOTH surfaces** — `RateMasterDerivation` AND the editor helper
  (`pricingSheetHelper.attributeOptions`, options from the live master by kind+where) — so an AI-extracted
  item with no static `values` still DISPLAYS in the panel select and a partial row completes from the
  catalog. **EA-4a-r SHIPPED the NONE mechanism (owner-locked):** a composite component may be POSITIVELY
  ABSENT -- the sentinel string `"None"` (distinct from blank=unknown) makes that line an EXPLICIT ZERO
  (`export const NONE_SENTINEL`). Config: an attr def carries `allow_none` + `disables_when_none` (the dependent
  attr ids greyed/cleared when it is None -- e.g. plate_item -> [plate_qty, back_box]); a `component_ref` carries
  `none_skips` (a ref @attr resolving to "None" -> the component is 0, fired BEFORE the ref lookup, so
  `socket_item="None"` doesn't abort; back_box binds @plate_item so plate=None zeroes it too); `circuit_fit`
  carries `optional_wire_when_none` (that wire is omitted from the dia -> single-wire fit). **The None affordance
  is GENERIC + input-appropriate:** a CHOICE def offers "None" at the top of its select; a NUMBER def offers a
  "None" CHECKBOX beside the numeric input (checked -> sentinel + input greys/clears) -- both in the Derivation
  AND the editor panel. `coerceForMatch`/`_coerce_value` PRESERVE "None" for an allow_none def (number included).
  Extraction injects "None" as a valid value + a guidance line ("None when the bill names no such component;
  null only when too vague"); `extraction_none_guidance` may be a custom string OR a truthy flag. Goldens: **pw3**
  (switch-only, socket="None") -> supply **1682**; single-wire (wire2="None") -> **1362**. A switch-only light
  point (socket null, no None) stays honest no-compute until the None is set. **EA-4b SHIPPED switches_point +
  the industrial_sockets paired-MCB (DATA-ONLY -- NO interpreter change; every shape is existing vocabulary):**
  `switches_point` is a 6-line switch/socket/plate/box assembly (TWO None-able socket slots; distinct from
  point_wiring -- no circuit_fit/wires; golden sp1 2320/470/1600); `industrial_sockets` gained a `paired_mcb`
  `component_ref` that is CROSS-CATEGORY (ref.kind `db_switchgear_item`) + gated by a `qty if_attr` interlocked
  rule (`{item:"...Interlocked"}?0:1`), with **`extraction_defaults={paired_mcb:"None"}` the production fix** so a
  socket-only row prices instead of refusing (absent=unknown->no_match; "None"=positive-absence->0 line -- the
  EA-4a-r distinction, owner-locked). Tray ceiling-accessories are a CONFIRMED FIXED 106 scalar (do not make
  adjustable this era). **EA-4c SHIPPED the DB build-up + the `lookup_or_ratio` interpreter step (owner-ruled
  ONE new capability -- implement the sheet's IFERROR install EXACTLY):** the build-up is FIVE FIXED None-able
  MCB slots (mirroring the sheet's I10:I14) + a `db_shell` slot (allow_none -- **MCB-only, shell None, is a REAL
  product = the sheet's `IF(J9=0)` branch**, the same module pricing bare MCBs) + enclosure, summed x0.495
  (supply) / x0.3 (bcs); supply + bcs are EXISTING vocabulary (`component_ref none_skips` cross-kind to the NEW
  `db_shell` kind, `sum_components`, `scale`, `roundup`), so the earlier "variable-length list step +
  extraction-payload extension" prediction was WRONG -- the scalar one-attribute-set-per-row payload carries the
  fixed slots and needed NO extension. ⚠️ **SUPERSEDED AT F-17 (2026-08-13/14): the DB install is now a PLAIN
  RATIO — `scale` (m 0.20) + `roundup` (digits -1) — and `lookup_or_ratio` HAS NO SHIPPED CONSUMER.** The
  three-way description that follows is HISTORY; the step remains in the interpreter's vocabulary but no config
  executes it. **`lookup_or_ratio` was the sheet's EXACT IFERROR three-way install**
  (owner contract, do NOT improvise): (a) `when_shell_absent.attr=="None"` -> `ROUNDUP(ratio.of x ratio.mult)`
  [shell-absent]; (b) else the unique install-table lookup (`kind`+`item`==`@attr`) resolves -> `ROUNDUP(matched
  [target] x mult)` [table-hit]; (c) lookup MISS -> `ROUNDUP(ratio.of x ratio.mult)` [IFERROR fallback]. A ratio
  branch with an uncomputed `ratio.of` is an HONEST no_match; a malformed shape NEVER throws (Option C ->
  `unsupported`); the trace NAMES the branch. Pass-through in `rate_master._KNOWN_STEP_TYPES` (no deep
  validation; its `@db_shell_item` is reference-guarded via the supply `component_ref`s). Goldens dbu1 (VTPN
  fallback 24360/3660/14760) / dbu2 (TPN 8WAY table-hit install 1500) / dbu3 (MCB-only shell None 23840/3580/
  14450). **This CLOSES the assembly-category arc (point wiring, switches point, industrial-socket pairing, tray
  accessories [fixed], DB build-up all live).** A discarded v16b data-only attempt (shell REQUIRED, no
  none_skips) was reverted for this owner ruling.
  **EA-4d (owner-locked) supersedes the db_switchgear extraction + install-rounding invariants (asset v17,
  sha `c41ba8e7ce2e0b8b`):** (1) the DB SINGLE-ITEM path is REMOVED -- `db_boq`/`db_install_nondb`/
  `db_install_db`/`db_bcs` pipelines + the `family`/`item` attrs are GONE (they had NO sheet-cell basis; the
  whole guiding DB block IS the build-up). db_switchgear carries ONLY the 3 build-up pipelines; the 137
  `db_switchgear_item` master rows stay (the build-up slots reference them). (2) db_switchgear is the FIRST
  `matching_mode: "composite_decomposition"` category -- a GENERAL extraction mode driven ENTIRELY by
  `composite_slots` (shell / repeatable `{prefix,count,...}` -> enumerated slot attrs / fixed) +
  `decomposition_rules`, with NOTHING db-specific in `extraction.py`; **a second composite (switches_point /
  industrial sockets / future HVAC) opts in by config alone -- zero code change** (seam = `select_prompt_text`
  + `build_slot_spec`; prompt asset `prompts/boq_composite_decomposition_prompt.md`). Owner resolution rulings
  (in the prompt + `decomposition_rules`): CURVE BoQ-stated->UPS-context-D->default-C; AMP exact-or-NEXT-HIGHER
  (never lower), range takes highest; PARTIAL pricing (un-cataloguable components -- ATS, standalone bus bar,
  weatherproof enclosure, module-flexi shell, bespoke DB -- left out, never a wrong pick; whole-row no-match ->
  all null). (3) `lookup_or_ratio` now honors `round_lookup` (table-hit) + `round_ratio` (ratio branches)
  SEPARATELY; v17 sets `round_lookup: null` (table-hit UNROUNDED `VLOOKUP*1.5`, sheet-faithful) + `round_ratio:
  -1`; the legacy single `round` stays the fallback for both. Goldens: dbu1 fallback 24360/3660/14760, dbu2
  table-hit 1500, **dbu4 TPN-6WAY table-hit install 1275 UNROUNDED** (the fix; the EA-4c 1280 was the drift);
  d1/d2 removed.
  **A functional config with a RED preview gate is exactly what the gate exists to surface -- even when the miss
  is in the golden, not the pipeline (two i1 golden defects caught + fixed by regenerated assets at EA-4b).**
  **The wiring + point_wiring + switches_sockets goldens are the standing regression pins (`switches_point` was RETIRED 2026-08-08 and its `sp1` golden went with it); the wiring-asset
  invariant sha is `645a81d6841254e4` (2026-08-09, the install step function -- was `76e09bba0d7affa1` at ext-b 2026-08-05, and `dcc9b2ea69f072bb` before that; the owner ACCEPTED each break. The earlier `c10509…` was a stale carry-error).** The Rate Master category selector is
  REGISTRY-driven (`rateMasterRegistry.ts`), not config-read. The pricing-sheet helper stays wiring-only
  and shows its category coming-soon note for other categories (honest no-compute). A `scale` step whose
  TARGET RATE is missing (`null`/`NaN`) SKIPS that output (renders absent, never invented as 0) while the
  pipeline's other outputs still compute — the HONEST-PARTIAL rule (a source row with supply but no install,
  or vice-versa, prices only what exists).
- **THE GUIDING-SHEET AUTHORITY RULE (owner-locked standing law, 2026-07-29).** A rate-master category gets
  FINALIZED rules ONLY if it has a block on the **ALL ITEM WISE RATE** sheet; no block → no rules. Every
  future category/discipline inherits this. **Corollary:** where the guiding block carries its rates
  DIRECTLY, the block IS the table (no background-sheet dependency) — **miscellaneous** is the first such
  case (its items carry `boq_supply`/`boq_install` that ARE the BoQ rates; `misc_boq` is direct factor 1.0,
  `misc_bcs` = `boq*0.8` with install 0). The EA-1 "UPS" decode was a misread **Floor BOX** block: UPS is
  removed (excluded-by-ruling) and **popup_boxes** is the corrected decode (per-module, the
  value-from-attribute shape). A category may be committed DATA-ONLY (empty `pipelines: {}` — attribute
  definitions + items, no derivation) when its ruleset is not yet authored; **lighting_mgmt_system** is the
  first, to be authored in-system later (the loader + all four surfaces + the preview gate tolerate empty
  pipelines honestly — no derivation output, no crash). **EA-2 SHIPPED the in-system authoring path:**
  `_validate_config` now ACCEPTS empty `pipelines: {}` (a non-empty pipelines object is still fully
  validated), and the RM-4b Pipelines tab has an **Add-pipeline affordance** (id + output keys -> a
  validator-minimal `{output, [match_master_row]}` via `blankPipeline`, then edited via AddStep).
  `_KNOWN_CONFIG_KEYS` also gained FOUR pass-through keys (`identity_attribute_id`, `matching_mode`,
  `notes`, `pipeline_labels`) stored VERBATIM and NOT structurally validated (like `item_kinds`) —
  REQUIRED because RM-4b resubmits the whole config, so an item-identity config (or the wiring
  `pipeline_labels` edit) would otherwise be rejected as an unknown key.
- **Retired-scope supersede (loader, owner-locked).** A multi-config payload may declare `retired_kinds` /
  `retired_category_ids` — kinds/categories dropped from THIS payload that a `replace=True` must ALSO
  deactivate (a second scoped-supersede beyond the payload's own kinds/categories), so a retired
  kind/category left active from a prior batch (e.g. ups after the Floor BOX correction) is superseded rather
  than left orphan-active. Freeze-and-supersede (rows retained), logged in the load summary; the
  wiring-untouched invariant is unaffected.
- **⚠️ A CATEGORY IS RETIRED VIA `retired_category_ids`, NEVER BY OMISSION FROM AN ASSET (owner-locked).**
  `_load_multi` computes its supersede scope from the PAYLOAD, so a category simply DROPPED from the
  asset is never touched by a `replace=True` and stays **ORPHAN-ACTIVE** — still `active = 1`, still
  served by every active-only reader, while the asset that is supposed to define it no longer mentions
  it. Naming it in `retired_category_ids` is the only thing that deactivates it. **There is NO delete
  path** — not in the loader, not in any admin write endpoint (the item-level one is even named
  `deactivate_…` and RETAINS the row); the whole module is freeze-and-supersede, so "delete this
  category" always means "retire it", and a hard delete would be a manual DB operation outside every
  audited path.
- **The Rate Master category picker is REGISTRY-driven, not config-driven, so a retired category must
  leave `rateMasterRegistry.ts` in the SAME change.** The list the picker renders comes from the
  registry; retiring the config alone leaves the category on offer and renders
  "No active config found for …" when it is chosen.
- **⚠️ THE ASSET IS EXPORTED FROM THE DATABASE — `services/boq_rate_master/exporter.py`
  (owner-locked).** The DB is the source of truth and the asset is BOOTSTRAP-AND-SNAPSHOT only.
  Running the export is what keeps a re-import safe: the file provably matches the DB, so a load can
  only replay what is already there. `build_asset(discipline)` returns the dict `_load_multi`
  consumes; `serialize_asset` is the ONE serialisation (`indent=1`, `ensure_ascii=False`, **no
  `sort_keys`** — ordering is deterministic by construction and re-sorting would reorder the verbatim
  blobs). **Two exports of an unchanged database are BYTE-IDENTICAL** — nothing in the payload is a
  timestamp, a batch id or a hash.
- **⭐ CONFIG BLOBS ARE EMITTED VERBATIM — never enumerate keys, never rebuild, never filter
  (owner-locked).** No two configs share a key set, 15 keys have NO screen control and 8 reach the AI
  prompt, so a fixed-schema export would silently drop the 21st key the day someone adds one — and
  `_validate_config`'s allowlist has already had to widen six times, so that day comes. `attributes`
  and `rates` are emitted whole for the same reason. Pinned by a test that plants a key nothing in the
  codebase knows about and proves it survives export AND re-import.
- **WHAT THE EXPORT EMITS AND DROPS.** Per item, exactly 7 keys in order: `kind`, `brand`, `unit`,
  `attributes`, `rates`, `source`, `item_uid` — ⚠️ `source` MUST be a dict on every item or
  `_validate_items` throws. Top level: `discipline`, `items`, `category_configs`, `goldens`,
  `source_workbook`, `retired_kinds`, `retired_category_ids`, and (F-19) `retirement_reasons`.
  **NEVER emitted:** `name`,
  `import_batch`, `creation`, `modified`, `owner`, `active` — row identity regenerates on every
  import by design, which is exactly why `item_uid` exists and IS emitted. **Deliberately dropped as
  archaeology (owner-ruled, do NOT preserve or merge from the previous file):** `sha256_prefix`,
  `extracted_at`, `provenance`, `excluded_categories`, `slice_note`, `merged_from`, and `source.col`
  on the 27 db_shell items.
- **⚠️ RETIREMENT COMES FROM THE TABLE, NEVER A FILE HEADER.** `retired_kinds` /
  `retired_category_ids` are read through `retirement.get_retirement_lists`. A discipline with no
  retirement rows exports two EMPTY lists — inheriting a header would make a fresh discipline claim
  retirements it never made.
- **⚠️ REMOVING ITEMS FROM AN ASSET DOES NOT DEACTIVATE THEM — `retired_kinds` is the ONLY mechanism,
  and the list is ADDED to, never replaced (owner-locked, F-16 2026-08-13).** `_load_multi` computes
  its supersede scope from the PAYLOAD's OWN kinds, so a kind merely dropped from an asset is never
  named by `_deactivate_scope` and its rows stay **ORPHAN-ACTIVE** — still served by every active-only
  reader, while the asset meant to define them no longer mentions them. This is the kind-level twin of
  the category rule above, and it is SELF-SUSTAINING once declared: the exporter rebuilds the list from
  the retirement TABLE, so every later export carries it. **Replacing rather than appending would
  silently UN-RETIRE an existing entry.** The retirement row is minted with a BLANK reason — see F-19.
- **✅ THE PARALLEL-ROW PATTERN IS CLOSED (F-16 + F-17). The governing principle STANDS AS DESIGN LAW
  for every future kind: adding ONE item must never require a second, hidden row for that item to price
  completely.** The census was EXHAUSTIVE and both instances are now fixed — `tray_install_rate` (F-16,
  moved on-row) and `db_install_rate` (F-17, replaced by a ratio). `popup_box_module` remains a
  rate-table row by the boundary test but carries **both** rates on its one row — NO ACTION.
- **db_switchgear INSTALL IS A PLAIN RATIO OF THE CALCULATED SUPPLY (owner-locked, F-17):**
  `ROUNDUP(supply x 0.20, -1)` for **all 27 shells**, where `supply` is the WHOLE assembly
  (shell + 5 MCB slots + enclosure, x0.495). It replaced `lookup_or_ratio`'s 8-row `db_install_rate`
  table (x1.5, 8 shells) and 0.15 fallback (19 shells). **A flat per-shell figure could not see the
  MCBs — that is the whole point.** A DELIBERATE REPRICING that moves **both ways**: on a bare shell
  install rises on 21 and **falls on 6** (table-path shells whose flat figure exceeded 20% of a bare
  supply); loaded with four MCBs it rises on all 27.
  **⚠️ THE STEP IS `scale` + `roundup`, NOT A TRIMMED `lookup_or_ratio` — and the alternative was
  MEASURED, not assumed.** Deleting only the step's `lookup` key is **FATAL**: the interpreter reads
  `s.lookup.item` unconditionally, so Option-C degrades the pipeline to `unsupported` and **every DB
  install blanks**. Keeping the step with `ratio.mult 0.20` is numerically identical but leaves a
  dangling reference to a retired kind and a trace saying *"table miss"* about a table that no longer
  exists. `round_ratio: -1` is retained as BEHAVIOUR by the explicit `roundup` step.
  **`lookup_or_ratio` now has NO shipped consumer** — it stays in the interpreter vocabulary, executed
  by nothing (a fact, not a problem; a substring search still finds it in `db_switchgear`'s `notes`,
  which is archaeology and is meant to stay — assert over STEP TYPES, never over serialized config).
- **A `db_shell` PRICE AND A `db_switchgear_item` PRICE FOR THE SAME PRODUCT NAME ARE DIFFERENT ROWS IN
  DIFFERENT CATALOGS (F-17 / Finding B).** The v30 merge deduplicated **`db_switchgear_item`** and
  completed correctly; the 12,133 that survived afterwards was the **`db_shell`** catalog's own row for
  the same product — a different kind with a different rate key (`shell_rate` vs `list_price`), never
  part of that dedup. The "the merge missed a twin" framing was a **MISREAD**. Owner ruling (F-17 R1):
  the shell adopts **12,881**, the higher figure, for safety — **a new pricing decision, not a repair.**
  26 of the 27 shells have no `db_switchgear_item` counterpart at all, so "these two numbers differ" is
  not by itself evidence of a defect.
- **A CATEGORY'S INSTALL RATE BELONGS ON THE ITEM ROW, NOT IN A PARALLEL RATE TABLE (owner-locked,
  F-16).** Governing principle: **adding ONE item must never require a second, hidden row for that item
  to price completely.** Cable tray's install was a second `match_master_row` into `tray_install_rate`
  ×4, so a width absent from those 10 rows priced supply, skipped install and warned about nothing.
  Each `cable_tray` row now carries an `install_rate` holding the FINAL effective per-metre figure (the
  ×4 **baked in — never multiply it again**), read verbatim off the row the supply match already found;
  the kind is retired and `item_kinds` is `["cable_tray"]`. **A ratio was REJECTED FOR TRAY ON
  MEASUREMENT** (implied ratio spans 0.1083–1.3077 across all real combinations, a 1107% spread) — do
  not propose one. The parallel-row census is EXHAUSTIVE: exactly TWO instances existed,
  `tray_install_rate` (silent no-compute, fixed here) and `db_install_rate` (fails safe to a 0.15
  ratio; **fixed at F-17**); `popup_box_module` is a rate-table row by the boundary test but carries both
  rates on its one row — NO ACTION. Boundary test: *could the referenced row plausibly appear on a BoQ line?*
- **⚠️ `source_row` IS ALWAYS EMITTED, INCLUDING 0.** The 27 db_shell items hold `source_row = 0` in
  the database and 0 is what the database says; omitting it to reproduce the old asset's absent `row`
  would be the export inventing an absence, and it would conflate a genuine row 0 with "no row" —
  which matters because `create_rate_master_item` stamps `source_row = 0` on every manually created
  item. It is also the option with no special case, so byte-stability comes for free.
- **⚠️ A RE-EXPORT LEGITIMATELY DIFFERS FROM THE PREVIOUS ASSET IN TWO WAYS, AND NEITHER IS A
  DEFECT.** Verbatim blobs GAIN `discipline` on 11 configs and `goldens` on `switches_sockets`,
  because the loader stamps both at ingest and the export reproduces what is stored. Expect exactly
  that; anything else is a real difference and must be classified.
- **⚠️ THE MINT GATE CANNOT VALIDATE THIS EXPORT.** Its atom vocabulary is `kind:<k>` — blind below
  the kind level (it missed a dropped item in slice 1 and a per-item key in slice 2). Run it (#187),
  but **the ROUND TRIP is the real gate**: export, load into a scratch discipline, compare axis by
  axis including `item_uid` and the retirement entries.
- **`BoQ Rate Master Snapshot` retains every export — KEEP THE NEWEST 10 PER DISCIPLINE
  (owner-ruled), pruned on write.** `payload` is **Long Text, not JSON**, deliberately: a snapshot
  exists to be RESTORED, so byte-fidelity of the stored text is the point and Frappe must never
  hydrate and re-serialise it — which also sidesteps the list-valued-JSON wall that forces
  `Pricing Workbook Version`'s prune to use a raw `frappe.db.delete`. `version` is `(max existing) + 1`
  and is **never reused after a prune**, so a version number identifies one snapshot for the life of
  the site. `track_changes: 0` — a snapshot is already immutable evidence.
- **⚠️ THE EXPORT ENDPOINT IS ADMIN-GATED, UNLIKE THE SHAPE IT CLONES.**
  `rate_master.export_rate_master_asset` copies `export_priced_workbook`'s
  `{filename, content_type, content_base64}` download shape but **NOT its bare login-only gate** — it
  uses the existing `_require_rate_admin` (`pricing._is_nirmaan_admin`), because an export hands over
  the whole priced catalog. **A web request cannot write into the repo and nothing tries**; the file
  is returned for download and retained as a snapshot, and committing it stays a human act.
- **⚠️ RETIREMENT STATE LIVES IN `BoQ Rate Master Retirement`, BECAUSE IT CANNOT BE DERIVED
  (owner-locked).** One row per retired thing: `discipline` + `scope_type` (`kind` | `category`) +
  `scope_value`, with OPTIONAL `retired_at` / `retired_by` / `reason`. `retired_kinds` and
  `retired_category_ids` are the ONLY two loader inputs consumed to drive behaviour and never
  persisted — the whole effect is `active = 0`, which is **INDISTINGUISHABLE from an ordinary
  supersede** — so an export built from rows alone would drop them silently.
- **⚠️ THE DERIVATION "a kind/category with rows but none active" WAS MEASURED, MATCHED, AND
  REJECTED.** It matches the known entries exactly on a populated database and is still unusable: it
  returns **EMPTY on a fresh bootstrap database**, so the lists would vanish in precisely the case the
  asset exists to serve. It is also coupled to history retention (archiving superseded rows would
  silently shrink it) and cannot tell "deliberately retired" from "happens to have no active rows just
  now". Do not reintroduce it.
- **⚠️ PAYLOAD IS THE INSTRUCTION, TABLE IS THE RECORD.** `_load_multi` records a retirement as a
  SIDE EFFECT of a payload declaring one (`retirement.record_retirements`, riding the loader's single
  commit). **The table is NEVER read to drive deactivation** — `_deactivate_scope` still takes its
  scope from the payload alone, and mixing the two would change import semantics. Pinned by a negative
  test: a retirement recorded for a kind the payload does NOT retire must leave that kind active.
- **⚠️ THE HAZARD THIS GUARDS IS REACHABLE, and it is `switches_point`.** Its config still exists in
  the `v22` asset ON DISK: load v22, then load an export that has lost `retired_category_ids`, and it
  stays **ORPHAN-ACTIVE** — active in the database, absent from the asset meant to define it. Three of
  the four retired things cannot be re-activated by any asset on disk; that one can, with two commands.
  Separately, the mint gate treats these lists as its **ONLY machine-readable retirement declaration**
  (`retkind:` / `retcat:` atoms), so losing them makes every FUTURE retirement surface as an
  undeclared, unexplained loss.
- **⚠️ UNIQUENESS IS STRUCTURAL, NOT CHECKED.** `autoname` is
  `format:{discipline}::{scope_type}::{scope_value}`, so the tuple IS the primary key and a duplicate
  is a PK collision rather than a validation that could race or be skipped (the deterministic-PK
  precedent the pricing lock already sets). **No unique index and no duplicate-checking validate hook
  is needed, and none exists.** ⚠️ A PK violation ABORTS the postgres transaction, so any test probing
  it must wrap the probe in a savepoint or every later statement in that transaction fails.
- **⚠️ PROVENANCE IS DELIBERATELY EMPTY ON BACKFILLED ROWS.** The loader never recorded when, by whom
  or why; the only signal is a batch `creation` timestamp, which is approximate. **A field asserting a
  precision it does not have is worse than an empty one** — never back-infer `retired_at` /
  `retired_by`.
- **⚠️ KNOWN GAP (not fixed): the SINGULAR-config loader path ignores the retirement lists entirely.**
  `retired_kinds` / `retired_category_ids` are read only inside `_load_multi`; `load_rate_master`'s
  singular `category_config` branch never reads them and therefore never records them. No shipped
  asset takes that branch, but the gap is real and is pinned by an assertion in the cert.
- **⚠️ `item_uid` IS THE STABLE ITEM IDENTITY, AND `name` STRUCTURALLY CANNOT SERVE (owner-locked).**
  `BoQ Rate Master Item.item_uid` (`Data`, `search_index`) is the durable handle a CSV round trip
  (download -> edit -> upload) matches on — "matched ids replace, blank ids add" is undefined without
  it, and content matching turns every rename into a silent duplicate. **`name` cannot be reused for
  this:** every import INSERTS fresh documents, and freeze-and-supersede **RETAINS** the superseded
  row, so its `name` stays OCCUPIED — a new row reusing it is a primary-key collision. A separate
  field has no such constraint, and **MANY ROWS SHARING ONE UID IS THE POINT**: every historical
  version of an item can carry the same uid.
- **⚠️ THE UID IS STAMPED, NEVER CONTENT-DERIVED (owner-locked).** Form: `rmi-` + 12 lowercase hex
  (16 chars — opaque, prefix-consistent with the module's `rmbulk-` / `manual-` provenance prefixes,
  and short enough to sit in a CSV cell). **A content hash is EXCLUDED and the reason is decisive:**
  the id would CHANGE when an attribute is edited, so an edited row would return carrying a different
  id, be read as an insert, and leave the original active — a silent duplicate on every rename, which
  is the exact failure the uid exists to prevent.
- **⚠️ THE UID IS NOT UNIQUE ON THIS TABLE — do NOT add a UNIQUE constraint.** It is unique only among
  `active = 1` rows; superseded rows legitimately share a uid with their successor, and that sharing is
  what would make history traceable. The field carries a **plain btree `search_index` only**. A partial
  unique index over `active = 1` is possible but is NOT applied.
- **⚠️ THE BACKFILL IS ACTIVE-ROWS-ONLY, AND HISTORY IS DELIBERATELY EXCLUDED (owner-locked).** A
  superseded row has **no reliable key to its successor** — the only handle is content, and content is
  exactly what changes between versions, so a historical backfill could only ever be approximate.
  `scripts/backfill_rate_master_item_uid.py` is a one-off maintenance script (NOT a patch — it seeds
  data, it does not migrate structure), it is idempotent, and it **REFUSES and writes nothing unless
  every active row pairs to EXACTLY ONE asset item** on `(kind, brand, attributes)`. **`brand` is
  load-bearing in that tuple**: several `lms_item` pairs are identical on `(kind, attributes)` and
  differ only by brand, at materially different prices, so pairing without it mis-assigns their uids.
  **The asset and the DB are stamped in the same run with the same value**, so a re-import reproduces
  the identity rather than minting a new one; the loader carries `item_uid` through at both insert
  sites exactly as it carries `brand`/`unit`. A legacy asset carrying no uid still loads, with the
  field left BLANK — never a fabricated value.
- **⚠️ THE CSV UPLOAD UPSERT IS UID-KEYED, AND ABSENT ITEMS ARE LEFT UNTOUCHED (owner-locked).**
  `services/boq_rate_master/csv_importer.py` reads back the CSV `csv_exporter` emits: a row whose
  `item_uid` MATCHES an active item **REPLACES** it, a row with a **BLANK** `item_uid` is **ADDED**
  with a freshly minted uid, and **an active item ABSENT from the file is LEFT UNTOUCHED**. That last
  is the safety property of the whole feature — a partial upload can never delete anything. A uid
  present in the file but matching NO active item is an **ERROR named in the preview**, never an
  insert: it means a stale file or a hand-typed id, and inserting it would mint the silent duplicate
  `item_uid` exists to prevent. **⚠️ THE UPLOAD MUST NEVER BE ROUTED THROUGH `loader.py`** — a
  `replace=True` supersedes an entire SCOPE (every active row whose KIND is in the payload) and would
  wipe every item the file omitted. **Freeze-and-supersede is intact and is what makes "replace"
  safe:** a matched row is not mutated in place; its document is flipped `active = 0` (RETAINED) and a
  NEW document is inserted carrying the SAME uid. The only difference from the loader is the SCOPE of
  the supersede — matched UIDS, not payload KINDS — which is precisely why absent items cannot be
  touched. The MODE (`category` vs the `category`-column-bearing `all`) is INFORMATIONAL: items carry
  no category, so the upsert is mode-independent and both shapes give the same result.
- **⚠️ THE UPLOAD IS TWO STEPS, AND A SNAPSHOT IS WRITTEN BEFORE ANY WRITE (owner-locked).**
  `preview_rate_master_csv` is READ-ONLY (it opens no transaction and is safe to run against live
  data); `apply_rate_master_csv` is the only writer and **RE-BUILDS the plan from the live catalog**
  rather than trusting anything posted back, so a doctored plan cannot be applied. The preview's
  `digest` fingerprints the decision AND the rows it was computed from, and a stale one is REFUSED —
  the honest answer when the catalog moved between the two steps; an unrelated edit elsewhere is
  deliberately NOT in the fingerprint. The apply takes a slice-4 **SNAPSHOT FIRST, in the SAME
  transaction** — that is the rollback path, and `apply_plan` never commits, so the endpoint's single
  `frappe.db.commit()` makes the whole thing ALL-OR-NOTHING: a malformed row rejects the WHOLE file,
  and the snapshot can never exist for an upload that did not land. A plan with nothing to apply
  writes no snapshot (nothing to roll back to, and it would evict a real one from the keep-10).
- **⚠️ THE PREVIEW IS THE DEFENCE AGAINST EXCEL, AND NOTHING IS SILENTLY REPAIRED (owner-locked).**
  Expanded by default: **every new item, and every rate move of 10% or more IN EITHER DIRECTION**
  (₹26,100 for ₹2,610 is invisible in a count; ₹261 for ₹2,610 quotes catastrophically low — so the
  threshold is on the ABSOLUTE move). A move a percentage cannot describe — a rate appearing,
  disappearing, or leaving zero — counts as major too. Everything else collapses behind a count and is
  one click from open: **collapsing is about attention, not access.** Changed-ness is decided by
  comparing the value that WOULD BE STORED against the value that IS stored, **type-strictly**
  (`json.dumps`, so a stored `2.0` and a typed `2` are told apart), never by comparing display text —
  which is what stops a mangled value slipping through as "unchanged". A value we cannot read
  (`1,234.50`, a currency symbol) is REJECTED BY NAME rather than "helpfully" fixed. **A blank cell
  means "empty or absent", and where the stored value is ALREADY empty or absent nothing changes** —
  which is what makes an unedited download/upload round trip a genuine no-op; a cleared ATTRIBUTE is
  REMOVED (attributes have no live null convention) while a cleared RATE becomes `None` (they do).
- **⚠️ THE UPLOAD'S ATTRIBUTE SPACE IS DECLARED ∪ OBSERVED, UNLIKE THE RM-4a ITEM ENDPOINTS.** Three
  live keys (`family`, `location`, `pricing_mode`) are carried by real items and declared by NO
  config, so a declared-only space would reject a faithful round trip of those rows;
  `update_rate_master_item` / `create_rate_master_item` validate against the declared set alone and
  would indeed refuse them. Measured: the attribute and rate key spaces are DISJOINT, and a name in
  both is refused outright — the export emits ONE column per name, so the FILE would be ambiguous and
  an import cannot repair an export that cannot represent the data.
- **⚠️ INTERIM CONFIG PROCEDURE (owner ruling 2026-08-13, until a config authoring surface exists):**
  a config change is made by **exporting the asset, editing it, and reloading it**. **STANDING RULE:
  NEVER LOAD AN ASSET THAT WAS NOT EXPORTED MINUTES EARLIER.** A load is `replace=True` and supersedes
  everything in scope, so a stale file wipes every change made since it was exported; and any asset
  older than the `item_uid` slice carries no `item_uid`, so loading one would BLANK every id — which
  breaks the CSV round trip outright, since a blank uid reads as "add this item".
- **⚠️ A TEST IS UPDATED TO MATCH A RULING, NEVER A RULING TO MATCH A TEST (owner-locked).** An
  asset-pinned test that disagrees with the live asset is asserting the shape a ruling REPLACED — i.e.
  a defect — so the assertion moves and carries an INLINE COMMENT naming the ruling it now encodes and
  why the old shape was wrong. **A test that silently changed its mind is worse than a stale one.**
  Corollary: **every current-asset pin in `test_rate_master.py` reads the ONE module-level
  `CURRENT_EALL_ASSET` constant.** Pins that are DELIBERATELY historical (`cls.eall`, the two v17 reads,
  and `LEGACY_WIRING_ASSET`) name their version explicitly and must NOT follow it — `LEGACY_WIRING_ASSET`
  in particular is the ONLY coverage the discipline-wide `_deactivate_prior` path has, because that path
  is reachable only through the SINGULAR `category_config` key.
- **⚠️ THERE IS ONE ELECTRICAL ASSET, AND THE SPLIT THAT PRECEDED IT WAS A LIVE HAZARD (merged
  2026-08-13, owner ruling).** The ONE merged Electrical asset — **named by `CURRENT_EALL_ASSET` in
  `nirmaan_stack/api/boq/test_rate_master.py`, the one authoritative pin** — carries every Electrical
  item and every category config, wiring included; **read the counts from the asset that constant
  names, never from here.** The two-asset split was **SEQUENCING, NOT DESIGN** — wiring was built
  first as a trial — and it must not be reintroduced "for safety". **THE REASON IT HAD TO GO: the two
  assets took DIFFERENT loader paths with DIFFERENT supersede semantics.** The wiring asset carried the
  **SINGULAR `category_config`** key, which routes to `load_rate_master`'s single-config path, whose
  `_deactivate_prior` runs `UPDATE "tabBoQ Rate Master Item" SET active = 0 WHERE discipline = %s AND
  active = 1` — **DISCIPLINE-WIDE**. Importing wiring with `replace=True` therefore deactivated **every
  E-ALL item**, and the live catalog survived only on an **undocumented ordering rule** (wiring first,
  E-ALL second). The batch timeline records it happening on 2026-08-09: E-ALL 22:20:33, wiring 22:20:43
  wiping it, E-ALL re-loaded 22:21:20 to repair. **The merged asset uses the LIST form, so it takes
  `_load_multi`'s SCOPED supersede and the discipline-wide `UPDATE` is never reached.** The singular
  path still EXISTS in the loader and is still dangerous — it is simply no longer reachable from a
  shipped asset, and `test_24b`'s negative half pins that (`category_config` must be ABSENT).
- **⚠️ `rate_master_wiring_cabling_v3.json` STAYS ON DISK — do NOT delete it.** It is a mint-gate
  **self-test operand** (`scripts/mint_completeness_check.py`, `do_history(WIRING)`, T4 — the wiring
  asset is the only one-filename-many-commits asset, so it is the ONLY thing that exercises the history
  walk), and it is the singular-shape fixture the ~30 single-config loader tests still need
  (`test_rate_master.LEGACY_WIRING_ASSET`). It is a **retired artefact, not a live asset.**
- **ONE ITEM WAS DROPPED AT THE MERGE, BY OWNER RULING (2026-08-13), AND NO DELETE PATH WAS ADDED.**
  `db_switchgear_item` / `TPN FLEXI DB 4 ROW 14M (DOUBLE DOOR IP 43)` existed **twice** with two prices;
  the **12,881 copy (source row 17) is KEPT**, the **12,133 copy (source row 14) is DROPPED**. It is
  simply **absent from the asset** and is superseded naturally on import — this module has never had a
  delete and the merge did not introduce one. The dropped copy is therefore absent from the asset's
  item count — **read that count from the asset `CURRENT_EALL_ASSET` names, never from here.** ⚠️ **The
  mint gate CANNOT see this**: its item vocabulary is `kind:<k>`, so a dropped *individual item* is
  below its resolution and it reported "No atoms disappeared". An `intentional_removals` entry is
  therefore inapplicable — the gate never emits an atom string for it.
- **Goldens at the merge:** wiring's five (`g1`–`g5`) are carried **BOTH** on the config **and** in the
  top-level `goldens` dict — which is what **9 of the 11** pre-existing E-ALL configs already do.
  `_load_multi` lets the top-level entry win and the two agree exactly, so `test_72`'s equality half
  holds. ⚠️ **`CLAUDE.md`'s "top-level and NOWHERE ELSE" wording is STRONGER than the code**: the
  overwrite fires **only when the top-level dict has an entry for that category**, so a config-level
  copy with no top-level twin survives untouched. Code is authoritative.
- **`wiring_cabling` deliberately carries NO `item_kinds`.** Its kinds derive from the pipelines'
  `match_master_row` (`cable`, `termination`) and the derivation is byte-equal to a declared list, so
  adding one is behaviour-neutral — but it would make the stored config differ from the live DB for no
  gain. Left absent; `test_24b` pins both the absence and the derivation.
- **Benchmark data (owner ruling):** the committed data asset is the **28-Jul benchmark workbook**
  (`rate_master_wiring_cabling_v3.json`) — the reference going forward, superseding the earlier 25-Jul
  reference; **its content now lives inside the merged asset** (above). A benchmark refresh is a
  `replace=True` re-import of a new asset (freeze-and-supersede: the prior `rmbulk-` batch goes inactive,
  rows retained).
- **✅ F-20 — CLOSED (2026-08-14). THERE IS NO DEFAULT ASSET, AND A SOURCE-LESS LOAD REFUSES BY NAME.**
  `loader.DEFAULT_DATA_FILE` is **DELETED**. It named a FIXED filename, so it went stale on every mint:
  it still pointed at **v30** after F-16 shipped v31, and a path-less `load_rate_master(replace=True)`
  would have **silently reverted the WHOLE v30 scope** (12 categories, 15 kinds) — re-activating the 10
  retired `tray_install_rate` rows and stripping `install_rate` from all 450 trays — **while reporting a
  successful load**. Note the shape: it was a **scope-wide REVERT through the SCOPED multi path**, never
  a catalog wipe. **The danger was the INVITATION, not the traffic:** nothing in the repo ever opened it
  (all 68 callers pass `payload=`, `path=` was passed by nobody, and no hook / patch / fixture / migrate
  step / CI job / endpoint could reach it — strictly human-invoked), but an optional argument documented
  as *"defaults to the committed data asset"* reads like a safe convenience. `_load_payload` now refuses
  when BOTH inputs are absent, with a message that **teaches** — it names the two valid call shapes,
  warns that a file must have been exported minutes earlier because a load is a supersede, and points at
  the admin export endpoint. **The "reload BY EXPLICIT PATH" interim rule is RETIRED — the loader
  enforces it now.** ⚠️ The export endpoint still emits a differently-named file
  (`rate_master_electrical_v5.json`) from the on-disk lineage (`..._all_v<N>.json`); the two names never
  converge on their own, which is exactly why a load must always name its file.
- **⚠️ ONE AUTHORITATIVE VERSION PIN: `CURRENT_EALL_ASSET` (in `api/boq/test_rate_master.py`).** The
  loader now carries none, and the F-20 sweep fixed the third one
  (`scripts/backfill_rate_master_item_uid.py`, v30 → v31). **Any new file naming an asset version must
  justify itself against this line** — three independent pins had already drifted apart once.
- **⚠️ THE BOOTSTRAP GROUND (measured by the F-20 recon; do not re-derive it).** The
  *empty-check + explicit-force* contract **ALREADY EXISTS** one layer down: `_load_multi` counts the
  active scope and **refuses a non-replace load over a populated scope**, so `replace=False` IS the
  empty check and `replace=True` IS the force. A future bootstrap command is therefore a **WRAPPER, not
  a new guarantee.** And a fresh site can only bootstrap from the **REPO asset** — there is no database
  to export from — so **the committed asset's currency is a CORRECTNESS property, not housekeeping.**
  This qualifies the "the on-disk file is stale but harmless while the DATABASE is the source of truth"
  framing: true for an established site, **false for a new one**. The mint-and-bump-the-pin discipline
  applies to every future change that moves the catalog.
- **✅ F-21 — CLOSED (2026-08-14). THE ≥10% "MAJOR" BOUNDARY ROUNDS BEFORE COMPARING, AND THE
  THRESHOLD HAS EXACTLY ONE DEFINITION.** `_rate_change_pct` is `(new - old) / abs(old) * 100.0`, and
  `abs(pct) >= 10.0` turned binary rounding error into a wrong answer whenever the result landed a
  hair **SHORT**: an exactly −10% edit computed `−9.999999999999993` and was classified **not major**,
  folding the row behind a count. Measured on integer rupee rates 1..20000: **11,999 of 20,000 (60%)
  downward, 0 of 20,000 upward** — `×1.10` lands a hair ABOVE, where the error is harmless against a
  `>=` test, so it bit only in the direction that **quotes LOW**. Now
  **`round(abs(pct), 6) >= MAJOR_RATE_CHANGE_PCT`** — six decimals is far finer than any real rate
  move and far coarser than float noise (~1e-14), and it is the module's own idiom (the same value is
  rounded one line below for display). **Never restore the bare comparison**; the docstring's "AT OR
  ABOVE" is inclusive and this is what makes it true.
- **⚠️ THE THRESHOLD LIVED IN TWO PLACES, AND THEY DISAGREED ON SCREEN (F-21, the finding).**
  `RateMasterUploadDialog.tsx` decided the percentage's COLOUR from its own `Math.abs(f.pct) >= 10`,
  reading the **ROUNDED** percentage while the server classified from the raw one. At the boundary a
  row therefore rendered **RED while sitting COLLAPSED** — "big move" and "not worth showing", about
  the same row. **The server now emits `major` PER RATE FIELD beside `pct`; the change-level flag
  stays "any rate field major" and still drives grouping; the dialog RENDERS the flag and computes
  nothing.** Non-rate fields carry **no** verdict — a percentage, and therefore the verdict, is
  meaningless on a `kind` rename or an attribute edit. The module's doctrine (*"a second client-side
  copy of the 10% rule would be free to disagree with the write that actually happens"*) was an
  ASPIRATION until this slice; it is now enforced by the payload. **The digest is unaffected and that
  is PROVEN** — `_digest` fingerprints `(row, kind, uid, name, (column, old, new))`, so a display
  addition cannot invalidate an in-flight preview.
- **⚠️ `_picks_measurable_at_ten_percent` IS NOW VALUE HYGIENE, NOT A WORKAROUND.** F-16 added it to
  route around the F-21 boundary; with F-21 fixed its live-behaviour half is inert (every non-zero row
  qualifies). It is KEPT because the **zero exclusion** is still load-bearing — `×1.05` leaves a zero
  UNCHANGED, so such a row never reaches `plan["changes"]` and the lookup would `KeyError`, and its
  percentage would divide by zero. The `>= 10.0` comparisons inside it are a FIXTURE FILTER and must
  not be read as the product's rule.
- **✅ F-19 — CLOSED (2026-08-14). A RETIREMENT CAN CARRY THE REASON IT HAPPENED.** The asset gains
  ONE optional top-level key — **`retirement_reasons: {"kinds": {…}, "categories": {…}}`** — read by
  the loader and stored on the minted row. **TWO sub-maps, not one flat map:** a kind and a category
  can share a name, which is exactly why `retired_kinds` / `retired_category_ids` are two lists, and
  a flat map would reintroduce that ambiguity. `retirement.reason_map` is the ONE place that knows
  the shape. **The entries themselves stay PLAIN STRINGS and must** — `_deactivate_scope`
  interpolates them straight into SQL, so an object-shaped entry is a broken query, not a style
  choice.
- **⚠️ A REASONLESS RETIREMENT IS LEGAL AND RECORDS BLANK (F-19 R2).** Refusing one would have been
  tidier and was REJECTED: every asset up to and including v32 declares retirements and carries no
  reasons, so the shipped catalog would have stopped loading — the trap class F-20 removed. The lever
  against forgetting is VISIBILITY, not refusal: the load summary reports
  **`retirements_without_reason`**.
- **⚠️ A REASON NAMING SOMETHING THE PAYLOAD DOES NOT RETIRE REFUSES BY NAME (F-19 R3).** The map
  **ANNOTATES** a declaration; it must never **MAKE** one. `retired_kinds` stays the single
  instruction — the standing *payload is the instruction, table is the record* rule — and without the
  refusal a typo'd key would sit in the asset looking effective while doing nothing.
- **⚠️ THE EXPORT EMITS `reason` ONLY — NEVER `retired_at` / `retired_by` (F-19 R4).** A timestamp in
  the payload would break the two-consecutive-exports-are-byte-identical guarantee the moment two
  exports straddled a new retirement, and `retired_by` would record an actor the table never
  observed. A reason is authored text: stable, and the half worth self-documenting. Both sub-maps are
  emitted **sorted**; a blank reason contributes nothing, so a discipline with none exports two empty
  maps.
- **⚠️ AN EXISTING RETIREMENT ROW IS NEVER UPDATED, NOT EVEN TO ADD A REASON (F-19 R5).**
  `record_retirements` SKIPS an entry that already exists — that skip is what makes a re-load safe —
  so it is **structurally unable** to fill a row minted blank. Turning it into an upsert would trade
  a load-safety guarantee for two historical fields. The two rows F-16 and F-17 minted blank were
  filled by the one-off **`scripts/backfill_retirement_reasons.py`** (dry-run default, idempotent),
  from text recorded verbatim in commits `77f54f4f` and `6e0af13a`. **That is copying recorded fact,
  not inventing history:** the original refusal is about BACK-INFERENCE and still stands where it
  bites — `retired_at` would timestamp the LOAD rather than the decision, and `retired_by` would name
  an actor the table never saw, so **neither is ever written**.
- **OPTION C IS RETIRED GOING FORWARD.** F-16 and F-17 put their reason in the commit body because
  the channel did not exist. It does now: a future retirement declares its reason **in the asset**,
  and the commit body is a copy rather than the only record.
- **✅ F-18 — CLOSED (2026-08-14). NO NON-FINITE NUMBER IS EVER LABELLED `"ok"`, AND THE THREE-PART
  CONTRACT IS NOW STATED (owner-locked).** `status: "ok"` used to mean only *"the step loop ran to the
  end without an early return and without throwing"* — it made **no claim about the numbers**, while
  every consumer reads it as *"these numbers are good"*. It now means: **(1)** a missing rate on a row
  we DID match **REFUSES** (`no_match`); **(2)** an output that could not be computed is **ABSENT,
  never zero and never NaN**; **(3)** an **`undefined` final remains the honest-partial contract** and
  is untouched. The guards copy `component_ref`'s existing idiom — its check AND its message shape —
  so this adds no concept, only its missing applications.
- **⚠️ F-18 WAS FIVE ENTRY POINTS, NOT ONE — a fix framed around the identifier guard could not have
  covered it.** `component` and `component_band` bound `undefined` past `evalFormula`'s `in` test
  (which checks KEY PRESENCE: `"base" in { base: undefined }` is TRUE); **`apply_effective_multiplier`
  multiplies OUTSIDE the formula**, so no evaluator guard was ever on its path; `roundup` turned
  `roundUp(undefined, d)` into NaN; and **`install_as_ratio` did not FAIL into NaN, it ASSIGNED one**
  (`const base = supplyKey ? ctx[supplyKey] : NaN`). `sum_components` was the propagator, never an
  origin.
- **⚠️ `roundup` IS AN HONEST PARTIAL, NOT A REFUSAL — THE ONE DELIBERATE ASYMMETRY (owner-locked).**
  The absence it reads is almost never its own fault: an upstream `scale` that honestly declined to
  write its result leaves exactly that hole, and refusing would discard a SIBLING output that computed
  correctly (`conduit_boq`'s `supply_per_mtr` is right even when `install_per_mtr` was never
  produced) — the over-wide action the PW-FIX ruling reversed for `module_fit`. **This kills the
  conduit_boq / conduit_bcs asymmetry: the same missing key used to give an honest partial in one and
  a NaN in the other, so absence-honesty depended on which step happened to come NEXT.** The four
  guards that DO refuse (`component`, `component_band`, `apply_effective_multiplier`,
  `install_as_ratio`) refuse because their value feeds `sum_components` — losing it makes the SUM
  wrong, not merely shorter, which is why `component_ref` has always refused in the same situation.
- **⚠️ THE TAIL BACKSTOP'S PREDICATE IS `typeof v === "number" && !Number.isFinite(v)` — A NUMBER THAT
  IS NOT FINITE, NEVER A MISSING VALUE (owner-locked).** It is the only mechanism that does not depend
  on config being well-formed (**the loader does not validate; only `update_rate_config` does**), so a
  bad value reaching `stageRate` is caught here. **A backstop written as "no non-value may pass with
  ok" would BREAK the four live `miscellaneous` CEIG / AS Built honest partials while fixing nothing
  that was ever broken.** Absent means *"this row has no such rate"*; NaN means *"we computed
  nonsense"* — never collapse them.
- **⚠️ `applyRate`'s MISSING FINITENESS CHECK IS A KNOWN, DELIBERATELY DEFERRED HARDENING (F-18 R6).**
  `PricingGrid.applyRate` would write `String(NaN)` into a draft rate cell if any caller reached it;
  today the ONLY thing stopping that is `RateHelperPanel`'s `Number.isFinite` on the override input,
  which disables "Use this value" — a guard that exists to reject a user typing nonsense and catches
  this by coincidence. Post-F-18 no NaN can leave the interpreter as `ok`, so the gap is closed at
  source rather than in depth. Do NOT treat the absence of a second check as evidence it is unneeded.
- **29-Jul truth-file cycle (EA-DIFF, owner-locked; the E-ALL benchmark of THAT cycle was
  `rate_master_electrical_all_v12.json` — for the CURRENT asset read `CURRENT_EALL_ASSET` in
  `nirmaan_stack/api/boq/test_rate_master.py`, the one authoritative pin; asset lineage v9->v12,
  v10/v11 skipped. ⚠️ This line has twice carried a stale version + sha256 prefix — write NEITHER
  here; the pin is the only place a version belongs):** four
  data changes + two owner-ruled invariants. (1) **Synonyms** — a config may carry top-level `synonyms`
  `{attr_id:{variant:canonical}}` (conduit `{conduit_type:{GI:MS}}`); consumed TWICE (defence in depth) — the
  extraction prompt INJECTION (`extraction._extract_batch`, `.md` assets untouched) AND `_coerce_value`
  variant->canonical mapping BEFORE the allowed-values check. ABSENT => byte-identical. (2) **GI conduit rows
  EXCLUDED** (`conduit_type` now [PVC,MS]); a GI row prices at MS via the synonym. (3) **point_wiring** — a
  DATA-ONLY category (`pipelines:{}`, `item_kinds:[]`) with a banked EA-4 oracle `1869/735/2604` in
  `config.notes`; it is the FIRST kind-less category. (4) **DB install three-way split** (db_switchgear): kind
  `db_install_rate` + pipelines `db_install_db` (DB-family, scale x1.5) / `db_install_nondb` (switchgear+enclosure,
  15% of BoQ supply). ⚠️ **HISTORICAL — BOTH PIPELINES WERE DELETED AT EA-4d** (the DB single-item path had no
  sheet-cell basis; the whole guiding DB block IS the build-up), **and the `db_install_rate` KIND ITSELF WAS
  RETIRED AT F-17.** Kept only for the reasoning below, which is still live: **`scale` binds only top-level
  `params`, so conditional params require `component`** (the interpreter's `scale` does NOT bind `conditions`,
  only `component` / `apply_effective_multiplier` do; a `scale`+conditions ships an unbound identifier that
  throws). Do not read this entry as describing anything that ships. (5) **Interpreter robustness (Option C, owner scope-add):** `runPipeline`'s "never throws on data
  shape" contract is ENFORCED — a data-shape formula throw (unbound identifier / malformed) DEGRADES to the honest
  `unsupported` status, page + helper NEVER hit the error boundary. The Data-Viewer **empty-scope** rule
  (`rateMasterStructure.isCategoryDataScopeEmpty`): a kind-less category renders an honest empty state (0 rows,
  note, no Add-row), NEVER the discipline-wide all-items list; LMS (declares `item_kinds`) is unchanged.
- **Estimator `rules` (EA-4 ext-a, owner-authored config data; full as-built + the four rules verbatim in
  the plan doc's "Build slice EA-4 ext-a"):** a category config may carry a top-level `rules` array
  (`{id, label, applies_to, guidance}`) of OWNER-AUTHORED estimator guidance. It is a `_KNOWN_CONFIG_KEYS`
  pass-through key, read into the extraction context **UNGATED** (unlike `slot_spec` /
  `decomposition_rules`, which are composite-only — R7 lands on `cabletray_raceway`, an ordinary
  attribute category) and injected as an `ESTIMATOR_RULES` prompt block beside SYNONYMS / DEFAULTS.
  **NO interpreter change; absent key => byte-identical prompt.** The guidance text is the contract —
  it is passed through VERBATIM and nothing in the app rewords it. Rendered read-only on the Derivation
  tab, with an explicit "No rules configured for this category." empty state (that tab had no
  empty-state precedent). Live: `db_switchgear` R2/R3/R4, `cabletray_raceway` R7.
- **Cable RUNS and CORES are SEPARATE and are NEVER multiplied together (owner-locked).**
  `wiring_cabling` carries BOTH a `runs` and a `core` attribute, each defaulting to **1** via
  `extraction_defaults`. **The core count IDENTIFIES the cable in the catalog; the run count
  MULTIPLIES its price** — collapsing them would match the wrong cable. This is the OPPOSITE of
  `point_wiring`, which records runs INTO its wire-core value (`wire1_core`/`wire2_core`, labelled
  "Wire N - runs (Core)", both defaulting to 1): point wiring is single-core in the ordinary case, so
  a stated run count IS the core value and a line stating both records the PRODUCT. **Two categories,
  two deliberately opposite rules — do not "harmonise" them.**
- **All four wiring pipelines multiply by runs, at FIVE points not six (owner-locked).** A `scale`
  step carrying `runs_from_attr` (existing vocabulary; precedent `popup_boxes`
  `module_count_from_attr`) attaches AFTER each output's `roundup`, so runs multiplies a ROUNDED
  per-unit rate: `cable_boq` supply + install, `termination_boq` **supply ONLY**, `cable_bcs`,
  `termination_bcs`. **⚠️ `termination_boq` install is NOT multiplied — `install_as_ratio` derives it
  from the already-multiplied supply, so a second multiplier would make install runs-SQUARED.** The
  supply multiplier MUST stay BEFORE `install_as_ratio` for that inheritance to hold. `cable_boq`
  install IS multiplied because it scales the raw `install_base_per_mtr`, not supply.
- **A golden's attrs are an ATOMIC SET — a new attribute must be added to every stored golden.**
  Introducing `runs` made all five wiring goldens no-compute (`attribute 'runs' missing or
  non-numeric` — the interpreter's honest no-compute) until each golden's `attrs` gained `runs: 1`;
  the expected VALUES are untouched, since the goldens are invariant at runs=1 by construction.
  ⚠️ **Multi-run goldens (runs > 1) are OWED from the owner and must NOT be computed from our own
  code:** the guiding sheet carries no runs concept, so a multi-run value has no sheet basis.
- **`rules` remains an UNGATED `_KNOWN_CONFIG_KEYS` pass-through** reaching every category regardless
  of `matching_mode`; an absent/empty array yields a byte-identical prompt. Rule text is owner-authored
  and passes through VERBATIM — nothing in the app rewords it.
- **point_wiring records RUNS and CORES SEPARATELY, and they are NEVER multiplied together
  (owner-locked).** `wire1_runs`/`wire2_runs` are per-WIRE attributes, each defaulting to 1 beside
  `wire1_core`/`wire2_core`. **CORES is the CATALOG MATCH KEY** (the `ref.core` binding), **RUNS drives
  the conduit GEOMETRY and the WIRE RATE.** One attribute serving both purposes is exactly what broke
  the previous rule: folding runs into cores wrote a core count with no catalog row behind it, and the
  row stopped computing. ⚠️ This is the OPPOSITE of `wiring_cabling`, where runs and cores are also
  separate but the core count is itself a match key with no geometry — do not unify the two categories.
- **`circuit_fit`'s third `wire_spec` element is OPTIONAL and ABSENT MEANS 1.** A wire spec is
  `[core_attr, thickness_attr]` or `[core_attr, thickness_attr, runs_attr]`; the dia sum becomes
  `sqrt(sqmm/PI) * 2 * cores * runs`. Absence must never change behaviour — every pre-existing config
  carries 2-tuples, so a non-optional third element would break all of them on ship. The same
  absent-means-1 rule governs a rate stage's optional `mult_from_attr`, which folds its attribute in
  BEFORE that stage's rounding (`x runs then round`). **This DELIBERATELY DIVERGES from `scale`'s
  `<ident>_from_attr`, which hard-fails to an honest no-compute** — a run count is a multiplier whose
  neutral element is 1, not a missing measurement. Both sites share one helper so they cannot drift.
- **CONDUIT is runs-aware through the GEOMETRY ALONE and must never carry a second runs multiplier.**
  `conduit_qty` derives from `circuits`, which derives from the runs-scaled diameter. Adding a
  multiplier to the conduit component would charge runs-squared. Switch, socket, plate and back box
  never multiply by runs at all.
- **ITEM MATCHING IS STRICT IDENTITY, so a dropdown over a NUMERIC catalog column needs the
  numeric choice type (`number_choice`), NEVER a plain `choice` (owner-locked).** `matchMasterRow`
  compares with `===`, so a `choice` emits the string `"3"` against a stored `3` and matches
  NOTHING -- silently, and with no error. Making the matcher numeric-aware was REJECTED: it changes
  how every category matches every attribute and its failure mode is a WRONG match, a price that
  looks right and is not. The type is contained by construction -- a config that does not carry it
  is byte-unaffected. `coerceForMatch` (the ONE place an attribute value becomes a match key) lives
  in `rateMasterStructure.ts`; the two type axes are `isNumericAttributeType` /
  `isDropdownAttributeType`, one definition each, read by BOTH rendering surfaces.
- **AN ATTRIBUTE VALUE IS COERCED IN MORE THAN ONE PLACE, AND A NEW TYPE MUST BE TAUGHT TO EVERY
  ONE (owner-locked).** The two that decide whether a value survives are the FRONTEND match path
  (`rateMasterStructure.coerceForMatch`, value -> catalog match key) and the SERVER EXTRACTION path
  (`extraction._coerce_value`, model reply -> stored value); the config validator and the Derivation
  form carry the same type knowledge. **`number_choice` compares NUMERICALLY at every site, never by
  string** — its domain is resolved from the catalog and is therefore FLOATS, so a string comparison
  can never match and silently discards every correct answer. Membership is still ENFORCED: like
  with like, not no check at all. This has now been missed TWICE (the frontend twin, then the
  server); **when you touch a coercion, sweep the whole stack — both halves — before believing the
  list is complete.**
- **THE GOLDENS BYPASS `coerceForMatch` ENTIRELY, so a coercion change must be proven through the
  PRICING-EDITOR path as well.** Goldens call `runPipeline` with values directly; a coercion that
  matches nothing leaves every golden green while the editor prices nothing. Measured once already:
  the naive flip took point_wiring from pricing most of its rows to pricing none, with all goldens
  green throughout. The editor-path count is a GATE, not a formality.
- **A category's dropdown domain is the family ITS OWN component refs pin, not the union across
  families (owner-locked).** `values_from.where` on a `point_wiring` wire attribute pins
  copper/unarmoured because that is what its component refs price; offering the cross-family union
  would put values on screen with no catalog row behind them. **The resulting domain need not be
  rectangular** -- core x thickness offers pairs the catalog does not carry, which is an honest
  no-match; constraining one dropdown by another's selection is the dependent-`where` mechanism
  cables are deferred for and is deliberately NOT built.
- **POINT WIRING CARRIES THREE CONDUCTORS -- phase, neutral and earth -- so the run counts across
  wire 1 and wire 2 sum to three unless the line explicitly states otherwise (owner-locked, R9).**
  A closing sentence naming an earth wire describes a conductor already counted, not an extra one.
  A number before a size is a RUN count, never a core count; wire 2 is recorded only where the line
  describes two distinct wires, and is `"None"` otherwise -- which is why `wire2_thickness_sqmm`
  must keep `allow_none` + its `disables_when_none` targets.
- **`_validate_config` must not be stricter than the interpreter (EA-4 ext-a).** Three shapes the
  interpreter explicitly executes are valid config and must stay accepted: a `component` with **no
  `params`** (a conditional component carries them per-condition), a `component` with **no `target`**
  (a param-only formula reads no price off the matched row; present-but-blank is still an error), and a
  **`*_from_attr` param holding a STRING** (an attribute-id binding — scoped to that suffix ONLY; any
  other param carrying a string still raises). Before this, `cabletray_raceway` and `popup_boxes` could
  not be saved through RM-4b at all.
- **⚠️ THE LOADER DOES NOT VALIDATE, THE EDITOR DOES.** `_validate_config` has exactly ONE caller
  (`update_rate_config`); `load_rate_master` / `_load_multi` validate nothing of the sort. **So an
  un-validatable config imports cleanly and only fails later, at the editor** — a whole-config RM-4b
  save. This asymmetry has now bitten TWICE in one slice (an unregistered top-level key, and step
  shapes). **Closing it is BANKED as its own future slice — do not attempt it inside a feature slice.**
- **⚠️ A `replace=True` IS WHOLESALE, so the losable set is a config's ENTIRE KEY SPACE — not a short
  list (owner-locked).** `_load_multi` flips the prior row `active = 0` and INSERTS a new document
  from the payload alone; nothing is merged, nothing is diffed, and the prior config is never read.
  **Any key absent from the asset is gone from the active config — intended or not, and with no signal
  of any kind.** `pipelines` is the sharpest case: an EMPTY `{}` is LEGAL, so a mint that empties one
  imports cleanly and that category silently stops pricing. `rules`, `extraction_defaults`,
  `synonyms`, `matching_mode` and an `attribute_definitions[].default` all reach the AI prompt, so
  losing any of them is a BEHAVIOURAL regression no test can see. **Comparing COUNTS cannot detect
  this** — the original instance left the count unchanged while replacing the content, which is why
  any verification must compare KEY BY KEY.
- **⚠️ AN IN-SYSTEM EDIT NOT WRITTEN BACK TO ITS ASSET IS DROPPED BY THE NEXT IMPORT (owner-locked).**
  An audited config write lands on the config ROW; the asset is a separate artefact that no write
  updates. The `Version` audit is FORENSIC, not preventive — nothing consults it before a replace, and
  the new row starts a fresh history, so the edit's own trail stays attached to a now-inactive row.
  **Any in-system edit must be mirrored into its asset in the same change**, or the next `replace=True`
  erases it silently. This is what makes deferred in-system authoring (e.g. `lighting_mgmt_system`)
  fragile until its result is written back.
- **⚠️ A MINT COMPARISON MUST READ COMMITS, NEVER WORKING-COPY FILES (owner-locked).** An asset edited
  IN PLACE hides the very loss a later commit repaired: comparing the two files as they sit on disk
  shows the repaired item merely CHANGED, while comparing the asset AS ORIGINALLY COMMITTED shows it
  LOST. A file-based comparison would have missed the one loss on record. The wiring asset has no
  version chain at all — one filename across several commits — so for it, git history is the ONLY
  record. `scripts/mint_completeness_check.py` is the invoked gate: it reports every disappeared atom
  down to an `expect` key inside a golden, warns when an operand is a working-copy file carrying more
  than one commit, and names the asset versions absent from disk and therefore uninspectable.
  **Intent is machine-readable ONLY at category/kind granularity (`retired_category_ids` /
  `retired_kinds`); `slice_note` and `excluded_categories` have ZERO code consumers, and a note nobody
  verifies is not a declaration.**
- **The extraction payload is TIERED, LABELLED and NEVER DEDUPED (EA-7, owner-locked; SUPERSEDES the
  banked EA-6 note, whose boundary sat one level higher).** The rate-extraction payload
  (`extraction._ai_item`) keeps its four top-level keys (`id` / `description` / `notes` /
  `ancestor_chain`) but their VALUES are labelled: `notes` is a map keyed by note KIND (`own` /
  `attached` / `appended`, the last a `{column-header: value}` map so the source COLUMN is part of the
  provenance), and each `ancestor_chain` entry is an object carrying `relation` + `distance` + `tier` +
  `node_type` + `description` + its own kind-keyed note block, root-first, with the sheet name as an
  outermost LABEL entry (no distance/tier/notes — it is not a node). **An empty kind is OMITTED, never
  sent as an empty container**, so absence is unambiguous. **THE TIER (owner-locked 2026-08-04): self
  (distance 0), immediate parent (1) and GRANDPARENT (2) carry every note kind; great-grandparent (3)
  and every ancestor above carries description + APPENDED ONLY.** The boundary is the named constant
  `extraction._FULL_TIER_MAX_DISTANCE`, never a magic number. The flat `notes` field rides the FULL tier
  with `attached` (it is node-borne body text, and the lean-tier ruling names only description +
  appended). **PER-ROW, NEVER DEDUPED** — a shared ancestor's text is repeated in full on every row
  beneath it; the repetition was MEASURED and the cost accepted in exchange for each row being
  independently readable inline, so do NOT add dedup, reference-passing or a shared-ancestor block. The
  model is told how to read the labels by `_ROW_CONTEXT_SHAPE_GUIDANCE`, appended in `_extract_batch`
  following the existing SYNONYMS / DEFAULTS / ESTIMATOR_RULES convention — **the `.md` prompt ASSETS
  stay untouched.** EXTRACTION ONLY; the CLASSIFIER is NOT in scope and its input is byte-identical.
- **⚠️ `context_builder._notes_text` is SHARED with the classifier voter — changes there must be
  ADDITIVE (EA-7).** EA-7 needed the three self note-kinds separately and added `own_notes_raw` to the
  row dict AND to each entry of the `ancestors` struct **without touching `_notes_text` or any existing
  key**; `notes` still carries the identical `' | '`-joined string. Byte-identity of the voter's
  assembled payload is PROVEN, not asserted — a hand-written golden test (`TestEA7PayloadShape.
  test_p5_...`) plus a measured before/after hash over the live corpus. Any future change here owes the
  same proof.
- **The extraction payload shape is TEST-PINNED (EA-7).** `TestEA7PayloadShape` in
  `api/boq/test_rate_suggest.py` pins the key set, the labelled ancestor objects, the kind-keyed self
  notes, the tier boundary (both halves — the grandparent MUST carry every kind, the great-grandparent
  MUST NOT), the no-dedup rule, and the omit-empty-kinds rule. Before EA-7 this builder was pinned by
  NOTHING. **Pin first, change second** — the pins were proven green against the unchanged code, then
  updated in the same commit, so the test diff shows what the payload carried before and after.
- **Pipelines are STORED CONFIG, not code:** the four derivation pipelines (cable/termination × BoQ/BCS)
  live in the config JSON and are interpreted downstream — RM-1 stores them faithfully; no interpreter
  ships this slice. Owner-decoded shapes: effective = `(1-discount)*(1+markup)`; termination = lug +
  banded gland (`thickness_sqmm` < 35 vs ≥ 35); BCS = discounted product cost + 5% wastage, no install
  (electrical labour is per-sqft, added at project level). The four faithfulness goldens (e.g.
  COPPER/UNARMOURED/1C/6.0 → cable 120/20, termination 80/20, BCS 87) are the STANDING instrument any
  pipeline change must still reproduce EXACTLY.
- **Migrate obligation grows:** these two doctypes add to the pullers' migrate obligation (Abhishek
  heads-up) — pulling requires a DB migrate.
- **⚠️ A NUMERIC CATALOG ATTRIBUTE IS STORED AS A FLOAT, AND THE CSV ROUND TRIP IS WHY (owner-locked,
  F-3 2026-08-15).** The CSV emits a value AS STORED and the importer parses the cell to `float`, while
  changed-ness is decided **type-strictly** — so a stored INT reads back as a change and an unedited
  download → upload stops being a no-op. Every numeric attribute in the Electrical catalog is a float
  (`conduit.size_mm 50.0`, `cable_tray.width_mm 100.0`, `cable.core 1.0`) for exactly this reason.
  F-3's first mint used ints and three CSV round-trip tests caught it. **Never reintroduce one.** Floats
  are otherwise inert: server `float(raw)`, client `Number()`, `===` on a JS number (JSON `100.0` parses
  to `100`), and a dropdown still renders `100`.
- **`junction_box_raceway` PRICES BY `face_mm`, A NUMBER — the composite `size` string is RETIRED
  (owner-locked, F-3).** A BoQ line is three-dimensional (`300 mm x 300 x 60 mm`) and the catalog's old
  two-dimensional `"300x50mm"` could not be matched against it, so **all 12 live rows extracted blank**.
  `face_mm` is a `number_choice` with `values_from {kind: junction_box, attr: face_mm}` — it MUST be
  `number_choice`, because `matchMasterRow` compares with `===` and a plain `choice` emits `"150"`
  against a stored `150` and matches nothing, silently. **The DEPTH does not price**; estimator rule
  **R11** carries that reading instruction, and its coverage sentence is deliberately voiced in
  `_ROW_CONTEXT_SHAPE_GUIDANCE`'s own vocabulary (`description` / `notes` / `ancestor_chain`). `size`
  was REMOVED from the six rows rather than left alongside: the matcher would ignore it, but the CSV
  attribute space is **declared ∪ observed**, so it would render an editable column with no effect.
- **⚠️ A SCOPED RE-EXTRACTION CANNOT COMPLETE AGAINST A PRE-SR-1 RUN — KNOWN BEHAVIOUR, NOT A BUG
  (owner ruling 2026-08-15).** SR-1's migrate backfilled `status` to `"complete"` but left
  `attempted_rows` NULL; the later SELROW carry seeds `acc_attempted` from that field
  (`rate_master.py:532`), so `complete = ... and not (population - acc_attempted)` (`:754`) can never be
  satisfied and the pass strands in an `active=0` partial (`:548`, R-SUPERSEDE). **Runs predating
  2026-08-10 are test-era, no production BoQ depends on them, and the sanctioned remedy for any such
  sheet needed in testing is a FULL re-extraction** — a fix slice was proposed and WITHDRAWN. Proven by
  a full-table gate: 8 NULL rows all predate 2026-07-31 20:11, the oldest populated row is 2026-08-03
  00:10, and **every state and shape created after that boundary carries `attempted_rows`** (including
  partial+scoped and partial+whole), so **no run created today can reproduce it**. Related and separate:
  a sheet's POPULATION grows when a new category goes live, so an old "complete" run can also be
  genuinely short of today's rows — the same full re-extraction is the remedy.

## BoQ Rate Suggestion (RM-3)

The extraction engine + the REAL `wiring_cabling` pricing helper. Full as-built:
`frontend/.claude/plans/boq-upload-plan.md` ("Build slice RM-3") + `frontend/CLAUDE.md`. Load-bearing
invariants:

- **Two more migrate-carrying doctypes** (fresh sync creates their composite indexes; NO patches.txt
  line, but they GROW the pullers' migrate obligation): `BoQ Rate Suggestion Run` (freeze-and-supersede
  via an `active` Check — a new run deactivates the prior active one, retained not deleted) and
  `BoQ Rate Suggestion Event` (immutable Use telemetry, `track_changes:0`; field is `event_user`, NEVER
  `user` — PG reserved word).
- **Server EXTRACTS, client COMPUTES (owner-locked):** `services/boq_rate_master/extraction.py` runs the
  AI attribute extraction (mirrors `ai_voter` wholesale — `ai_settings`, 20-row batches, 3x retry,
  fail-closed `ai_status` envelope; reuses `ai_voter._extract_json_array`) and persists only the extracted
  ATTRIBUTES; the rate itself is computed CLIENT-SIDE via the RM-2 interpreter UNCHANGED, so a rate/param
  change flows in live with no AI re-run. The regex corroborator is DISPLAY-ONLY and never overrides AI.
- **Endpoints** (`api/boq/rate_master.py`, long-job pattern): `start_suggest` / `_suggest_worker` /
  `get_suggest_status` / `get_active_suggestion_run` / `record_rate_suggestion_event` /
  `get_suggestion_events`, gated by the shared D8 chain (not locked + formulas complete + category gate,
  REUSING the `pricing.py` predicates). Marker + terminal payload live in Redis keyed by (boq, sheet_name).
- **SR-1 run resilience (owner-locked, MIGRATE-carrying; full as-built in `.claude/context/domain/boq-backend.md`):**
  a run is NO LONGER all-or-nothing. **The run doc IS the partial store** (never Redis — its TTL is the wrong
  lifetime): created up front at `status=running`/`active=0` and updated per completed batch via a
  `checkpoint_cb` that mirrors the existing `progress_cb` injection (the service layer still performs NO
  `frappe.db` writes). Three fields: `status` (`running|partial|complete|failed`, **`default: "complete"`** so
  pre-SR-1 rows backfill on migrate and never retroactively lock Use), `attempted_rows` (the per-row
  done-marker), `halt_reason`. **`ai_status` is NOT widened** — it keeps its own `ran|disabled|no_key`
  vocabulary, which the doctype and frontend treat as a contract. **`attempted_rows` is load-bearing:** a blank
  row is byte-identical whether never-asked, asked-and-null, or fail-closed, so the marker is explicit and is
  set **only AFTER a batch returns** — a FAILED batch's rows are never marked and stay pending. **R-SUPERSEDE:**
  a partial NEVER supersedes a prior COMPLETE run; `active` flips to 1 ONLY at `complete` (so
  `get_active_suggestion_run` also returns the newest resumable partial under a separate additive `partial_run`
  key). **R-RESUME-SAME-RUN:** a resume completes the SAME doc/`run_id`, never a second; it re-checks the D8
  gate AND the committed-version keying. **R-USE-GATE:** "Use this value" requires `status=complete`. Writes use
  `set_value(update_modified=False)`, never `doc.save` — this doctype is `track_changes:0` (no audit to bypass)
  AND its list-valued JSON hits the documented `doc.save()`/`delete_doc` wall. **`ExtractionHalted` splits
  terminal from transient — and the DEFAULT DIRECTION IS LOAD-BEARING: an UNRECOGNISED error must keep the
  pre-SR-1 retry behaviour** (a positive-terminal test, adopting `boq_ai_assist._TRANSIENT_MARKERS` for the
  transient signals). Classifying unrecognised errors as terminal turned a truncated reply into an instant halt
  — worse than the behaviour replaced; caught by the browser cert, not by the tests. A graceful halt still
  `log_error`s the provider's own words, so handling it never makes the cause unknowable.
- **`_extract_json_array` is STRICTLY MORE PERMISSIVE (SR-1):** it takes the FIRST BALANCED array span
  (string-aware) and ignores trailing data, fixing the production `Extra data: line 1 column 845`. It never
  rejects a previously-accepted shape (prose-wrapped array, element order, HV-2 bare object), and still RAISES
  on genuine garbage and on a TRUNCATED array (which must NOT degrade to its first element). **Shared by three
  production consumers BY DESIGN** — the classifier voter (def site), the certified harness (by import
  identity), rate extraction. ⚠️ The same-named function at `services/boq_ai_assist.py:431` returns a `str` and
  is a DIFFERENT function — do not confuse them.
- **The reply ceiling (SR-2, owner-locked, EXTRACTION ONLY):** `extraction._AI_MAX_TOKENS` is an EXPLICIT
  constant and is deliberately **NOT** the configured `ai_settings.max_tokens` — the call is NON-STREAMING
  with a fixed timeout and the higher configured region is UNTESTED, so extraction still does not read the
  setting. **The classifier voter and the offline harness keep their own lower constant deliberately**: the
  voter's reply is one small object per row (a wide margin that does not bind) and it is a CERTIFIED surface
  whose corpus is spent, so raising it is all risk and no benefit — changing it belongs in its own slice with
  a fresh harness run. A `stop_reason == "max_tokens"` cut raises the distinct **`ReplyCeilingExceeded`**
  BEFORE the reply text is parsed, so it can never degrade into the generic truncated-JSON `ValueError`, and
  it is **NEVER retried** — a ceiling cut is DETERMINISTIC for a given batch, so retrying is guaranteed waste
  (a garbled reply is the opposite case and keeps the SR-1 default-to-retry rule). **The special-case is
  NARROW: every other `stop_reason` keeps its pre-SR-2 behaviour byte-identical.**
  `_extract_with_ceiling_split` halves a cut batch (`_MAX_SPLIT_DEPTH`), triggers ONLY on
  `ReplyCeilingExceeded` — never on a transient error or a garbled reply — and composes with SR-1 unchanged:
  `attempted` advances and checkpoints per HALF, so a halt mid-split keeps the halves already done. Batch size
  is unchanged. **The trigger was ANY high-attribute-count category at the full batch size, NOT
  `composite_decomposition` specifically** — the failing batch was a non-composite assembly category, so a fix
  scoped to composite mode would have missed it.
- **A PARTIAL-SCOPE SUGGEST RUN SCOPES THE PROCESSING, NEVER THE POPULATION (owner-locked).**
  `start_suggest`/`run_extraction` take a POSITIVE `only_rows` (a tick box says "do these";
  `skip_rows` is the resume's done-marker lever and says the opposite — inverting it on the client
  would force the client to reproduce the server's population definition). **`assemble_population`
  is UNTOUCHED and `population_rows` is ALWAYS the whole sheet**, because it is the completeness
  yardstick `complete = ... and not (population - attempted)` tests against. **Narrowing the
  population instead is the DESTRUCTIVE implementation** — `complete` becomes reachable with only
  the selected rows present, the run flips `active=1`, the prior run is deactivated, and every
  unselected row silently loses its extraction, its badge and its "Use this value". `only_rows` is
  validated server-side and **REJECTED, never silently narrowed** (a row outside the population
  means the client's eligible set is stale and the count the user just confirmed is no longer true).
  **ABSENT or EMPTY `only_rows` is byte-identical to the whole-sheet path.**
- **EVERY SUGGEST RUN WRITES A NEW DOCUMENT CARRYING THE UNTOUCHED ROWS FORWARD BYTE-IDENTICALLY —
  nothing is edited in place (owner-locked).** A merged run's `run_at` and `ai_status` stop
  describing the rows and start describing the last touch, and the previous values are destroyed;
  the rest of the module already supersedes rather than mutates. **BYTE-IDENTITY is the
  requirement, not "still present"** — a carry that re-serialised and dropped a `defaulted` flag
  would pass a parsed-value check and still be a silent regression. `serialize_run_results` is THE
  single serialisation for every writer and its three properties are load-bearing: `json.dumps`
  with DEFAULT separators (no `indent`/`sort_keys`), `sorted` by excel_row, and row dicts passed
  through UNTOUCHED (never re-derived — `_corroborate`/`_row_result` run only for rows the pass
  actually extracts). The `results` column is postgres **`json`, NOT `jsonb`**, so submitted text
  is stored verbatim and the guarantee survives the round trip. **⚠️ The skip set must EXCLUDE the
  scope or NOTHING runs**: a scoped pass seeds `acc_attempted` from the carried COMPLETE run, which
  already contains the ticked rows, so `pending_skip = acc_attempted - scope` is what makes
  "re-run these" mean re-run. Carry-forward is scoped to `only_rows` deliberately — seeding a
  whole-sheet run would make a halted run silently inherit the old rows instead of reporting them
  pending. A scoped run is refused when AI is off (it would blank the picked rows and mislabel the
  document), when a resume is also requested, and when there is no completed run to carry from.
- **A SCOPED RUN PERSISTS ITS SCOPE, AND A RESUME HONOURS IT (owner-locked).** `only_rows` is a
  REQUEST parameter: it dies with the request, so a resume that re-derives the scope from it finds
  nothing and silently falls back to the population — the run forgets it was ever scoped. The scope
  lives on the run document (`scope_rows`, holding the rows STILL TO DO; NULL = whole-sheet) and is
  resolved in ONE place, `_open_run_doc`, which returns it for a fresh run and for a resume alike.
  **It is not recoverable from anything else**: `attempted_rows` is seeded with the carried run's
  rows so it holds the whole population, and in `results` an unfinished scoped row is byte-identical
  to the carried row it came from. **A stored EMPTY list means "scoped, nothing left" and must never
  collapse to None** — that reinstates the fallback. A NULL scope keeps the whole-sheet path
  byte-identical.
- **A BANNER'S COUNT AND THE WORK IT TRIGGERS MUST DERIVE FROM ONE VALUE (owner-locked).** Two
  independent computations over different data is how a control comes to promise one number and
  deliver another; it is not a wording problem and cannot be fixed by rewording. Where a control
  offers to do N things, the N it displays and the set the worker processes read the SAME stored
  field.
- **A RUN'S `attempted_count` IS DOCUMENT-LEVEL AND CANNOT DESCRIBE ONE PASS (owner-locked).** On a
  carried scoped run `acc_attempted` is SEEDED with the carried run's rows, so `attempted_count`
  counts every row the DOCUMENT has results for — the right number for the completeness test and
  the resume's skip set, and the wrong one for "how much did this pass do". Subtracting it from the
  population then yields 0, which reads as "nothing missed" precisely when ticked rows were left
  unfinished. The pass's own set is `env["attempted_rows"]`, published as `pass_attempted_count`;
  anything reporting what a PASS did must read that. Keep the two names distinct — they answer
  different questions and collapsing them re-creates the defect silently.
- **Extraction capture is ALWAYS-ON and is the ONLY way a DROP is distinguishable from an ABSENCE
  (owner-locked).** `_coerce_value` returns `None` for every failure and discards the raw value, so
  a value the model RETURNED and we then dropped is byte-identical, in storage, to one it never
  returned — which made three defect classes indistinguishable: sent-and-nothing-returned,
  genuinely-ambiguous row text, and returned-then-dropped. `extraction._extract_batch` therefore
  writes ONE JSONL record per batch to `<bench>/logs/boq_rate_extraction_capture.jsonl` carrying the
  **assembled prompt**, the **raw reply** (+ `stop_reason` + `usage`), the per-row payload items, and
  the **per-attribute `raw` -> `coerced` + `reason`** mapping, plus eight named DROP classes
  (`ids_not_in_batch`, `unknown_container_rows`, `attributes_absent`, `coercion_failures`,
  `confidence_unparseable`, `surplus_attributes`, `rows_omitted`, `defaulted_lost_to_coercion`).
  **`_coerce_value` is the value-only WRAPPER over `_coerce_value_ex(defn, raw, syn) -> (value,
  reason)`** — ONE implementation, so the value and the why can never drift; re-deriving the checks
  at a call site to explain a `None` is exactly the coercion-twin duplication this codebase has been
  bitten by three times. **A `defaulted` value that FAILS coercion loses the value AND the evidence
  it was a default** — hence its own drop class. **THERE IS NO FLAG, and that is load-bearing:** the
  retired EA-7 dump was gated by a module-level constant, and a long-lived RQ worker imports the
  module ONCE at process start and never hot-reloads, so a constant flipped afterwards was silently
  ignored and a completed run produced no dump at all (#171). Nothing to flip means nothing can be
  stale. A **run-header record is written UNCONDITIONALLY**, including for a run that extracts
  nothing — it is the anti-silence device, so "the code never ran" stays distinguishable from
  "nothing happened". Retention is self-bounded (`CAPTURE_MAX_BYTES` 8 MB x `CAPTURE_KEEP` 5;
  Frappe's `RotatingFileHandler` belongs to `logging` and does NOT apply to a plain append).
  Capture is OBSERVATION ONLY — the stored `results` shape is byte-identical with it active.
  **⚠️ KNOWN BLIND SPOT: this is a SERVER capture.** The frontend
  `rateMasterStructure.coerceForMatch` turns a stored value into a catalog match key and a mismatch
  silently matches NOTHING, so capture proves a value reached STORAGE — a row that captures cleanly
  and still does not price is a FRONTEND question, not a contradiction.
- **⚠️ EXTRACTION IS NON-DETERMINISTIC BY CONSTRUCTION.** `client.messages.create` sets **no
  `temperature`, `top_p`, `top_k` or seed** at any of the four AI call sites, so it runs at the
  API's default sampling. Measured 2026-08-11 on two whole-sheet re-runs with identical code and
  inputs: **22 of 146 rows (15%) and 31 of 175 rows (18%) changed at least one attribute value,
  while row counts and non-blank counts stayed IDENTICAL** — the drift is invisible to any aggregate
  check. A re-run is therefore never a neutral act on a sheet under review; scope it with
  `start_suggest(only_rows=[...])`, which carries every untouched row forward byte-identically.
- **Extraction prompt rulings (owner, `prompts/boq_rate_attr_extraction_prompt.md`):** tolerate spelling
  variants (map to the canonical value), and — for an ARMOURED/UNARMOURED insulation attribute — a FLEXIBLE
  cable is UNARMOURED, and insulation DEFAULTS to UNARMOURED when neither armoured nor unarmoured is stated.
- **⚠️ `decomposition_rules` IS PROSE SENT TO THE MODEL, NOT CODE.** It has exactly ONE consumer:
  `extraction.py:1325` reads it (gated on `matching_mode == "composite_decomposition"`) and
  `_extract_batch:905-906` serialises it into the prompt as a `RESOLUTION_RULES` block. **Nothing
  executes `exact_or_next_higher` / `take_highest_first` / `default_C`.** A category needing a real
  ladder uses `catalog_fit`; do NOT point a new category at `decomposition_rules` expecting
  deterministic resolution. db_switchgear's own migration onto `catalog_fit` is BACKLOG.
- **THE MODEL READS FACTS; EVERY SUBSTITUTION / LADDER / CONVERSION / FIT IS DETERMINISTIC CODE
  (owner-locked standing principle).** Two generic steps carry it: **`map_attribute`** (resolve one
  STRING attribute — stated wins, else a config table, else a default; `derive_attribute` cannot
  serve, its formula language is arithmetic) and **`catalog_fit`** (fit a stated NUMBER onto a
  ladder derived FROM THE CATALOG and bind the chosen row's label). Both are generic: slice 3a's tray
  width rides `catalog_fit` (it needed ONE additive param, `fit_into` — see below; the earlier "ZERO
  new capability" prediction was wrong), F-10's SWG→mm rides `map_attribute`.
  **A ladder can only filter on STORED attributes** — that is why the 106 `family: Switchgear` rows
  were minted with `device`/`pole`/`amp_a`/`curve`, and why a discriminator living inside an item
  NAME must become an attribute before any ladder can use it.
- **⚠️ A `catalog_fit` REACHES `match_master_row` ONLY THROUGH `fit_into`, AND THE REASON IS A TYPE
  (owner-locked, slice 3a).** `bind` publishes the fitted rung's LABEL into `fitLabels`, which is
  `Record<string, string>` and stringifies through `String(label)` — right for `industrial_sockets`,
  whose ladder binds a catalog `item` NAME consumed by a `component_ref` "@ref". `match_master_row`
  is a DIFFERENT consumer: `matchMasterRow` reads **`selected` and nothing else** and compares with
  `===`. Cable tray stores `width_mm` as a NUMBER, so a bound `"100"` matches nothing — **silently,
  with a green suite.** `fit_into` writes the fitted SIZE (a number) into the run-local selection
  overlay, on the FITTED path ONLY: never on stated-wins (the selection already holds the stated
  value), never on a positive absence, never on a miss — nothing was fitted there, and writing a
  size would MANUFACTURE a match. **Deleting it does not fail loudly; it un-prices every fitted row.**
  Exactly two steps write into `selected` (`derive_attribute`, `map_attribute`) and this is the
  third — **do not "tidy" a fitted value back onto `fitLabels` alone.**
- **⚠️ A STEP THAT FILLS AN ATTRIBUTE A LATER STEP READS THROUGH `@` MUST RUN BEFORE IT, AND NOTHING
  DECLARES THAT (owner-locked, slice 3b).** Cable tray's `map_attribute` (SWG → mm) must be FIRST in
  every pipeline, ahead of the `catalog_fit` that filters its width ladder on
  `where: {thickness_mm: "@thickness_mm"}`. Run the fit first and the `@` ref is unresolved, so the
  fit BAILS and the row dies **before `match_master_row` is ever reached** — with every fact needed
  to price it present. **The dependency is invisible in config** (two steps, no declared link) and
  **silent when wrong** (an ordinary `no_match`, indistinguishable from a genuine one). Pinned by a
  test that runs the SAME inputs in both orders. This generalises: any step whose output another
  step reaches through `@` owes it position, and reordering a pipeline is never cosmetic.
- **⚠️ EVERY MECHANISM THAT RESOLVES A VISIBLE ATTRIBUTE OWES A BRANCH IN `applyDerivedDisplay` —
  THE PANEL SHOWS WHAT PRICING USED (owner-locked; this defect has now shipped TWICE).**
  `derivedAttrIds` membership exempts an attribute from the missing-input gate, but it does NOT fill
  its `derivedValue`; with no branch the field falls through to `{...a, derived: true}` and renders
  **EMPTY beside a correctly priced row**. Slice 2c hit it on `catalog_fit` (row 98's paired MCB read
  "— select —" beside a priced 25A MCB); slice 3b hit the identical shape on `map_attribute` (a tray
  pricing off a gauge-converted 1.6 mm showed a blank Thickness). **A mechanism is not finished when
  it prices correctly — it is finished when the panel can say what it used**, which also means the
  outcome type must CARRY the resolved value, not merely report that one was substituted. Read it
  through the step's own structured reader; never parse the trace prose, never re-derive.
- **⚠️ THE `"None"` SENTINEL IS TREATED DIFFERENTLY BY `map_attribute` AND `catalog_fit`, AND THE
  ASYMMETRY IS DELIBERATE (owner-locked, test-pinned).** `map_attribute`'s stated-check EXCLUDES the
  sentinel (a "None" pole is not a pole, so the mapping still runs); `catalog_fit`'s INCLUDES it (a
  stated "None" is a DECISION to defer to — it STICKS and zeroes the line). Letting a ladder
  overwrite a stated "None" would make a valid panel selection silently do nothing, the trapdoor this
  codebase disqualifies. **Never "harmonise" the two predicates.** The layers also differ in meaning:
  a FACT attribute (`mcb_present = "No"`) corrects what the row SAYS and is evaluated BEFORE the
  ladder; the bind attribute (`paired_mcb = "None"`) overrides the DECISION.
- **⚠️ CORRECTED F-3 RULE — a numeric catalog attribute is a FLOAT *and is DECLARED in the same
  mint*, with `selector: false` when it is not an extraction input.** F-3's float rule holds only for
  a DECLARED attribute: `csv_importer.coerce_attribute` floats a cell ONLY for a declared numeric
  type, and an undeclared key keeps the text verbatim — so an undeclared numeric attribute stores a
  float, reads back a string, and **breaks the unedited-CSV-round-trip no-op** (measured: all 106
  minted rows reported as changed). `column_spaces` reads every definition and does NOT filter on
  `selector`, so `selector: false` types it for the importer while keeping it out of the prompt, the
  panel and the Derivation configurator. Undeclared STRING attributes (`family`, `location`,
  `pricing_mode`, `device`, `curve`) are unaffected. Teaching the importer to infer type from the
  stored value would retire the hazard class — DECLINED as out of scope, recorded as backlog.
- **⚠️ A NULL IS NOT THE `"None"` SENTINEL, AND THE DIFFERENCE COSTS THE WHOLE ROW (owner-locked).**
  `none_skips` zeroes a component whose ref `@attr` resolves to the STRING `"None"`; a **null** —
  which is what `_coerce_value` returns when the model's answer fails validation — matches nothing,
  so the `@` reference stays UNBOUND and `component_ref` refuses the **entire pipeline**, socket line
  and all. A rule that leads a model toward names outside its allowed values therefore does not
  merely lose that component: it makes rows unpriceable that priced before. When a config asks the
  model to CONSTRUCT a catalog key, the instruction must lead with *the answer must be a name from
  the allowed values list*, and the fallback for "nothing fits" must be `"None"`, never a near-miss.
- **⚠️ `text_overrides` HAS NO SERVER-SIDE MATCHER — the MODEL does the matching (owner-locked).**
  An `extraction_defaults` entry of the form `{default, text_overrides: [{contains, value}]}` is
  serialised WHOLE into the prompt and interpreted by the model (`extraction._extract_batch`); no code
  ever evaluates `contains`. So nothing normalises spacing or case: **spelling variants must each be
  listed** (`IP67` AND `IP 67`; `waterproof` AND `water proof`). Entries are a LIST, so multiples are
  free. A single entry relying on the model to equate two spellings is a silent assumption.
- **⚠️ `panel: false` IS NOT `selector: false`, AND THE DIFFERENCE IS THE POINT (owner-locked, 2d).**
  `selector: false` hides an attribute from ALL THREE surfaces **including the AI prompt**
  (`extraction.py` skips it). `panel: false` hides it from the **PRICING PANEL ONLY** — it is still
  extracted and still drives the pipeline. That is what lets the four `industrial_sockets` MCB FACTS
  (`mcb_present`, `mcb_amp_a`, `mcb_pole_stated`, `mcb_curve_stated`) leave the pricer's screen while
  ONE field, `paired_mcb`, carries the whole answer. ⚠️ **It narrows the RENDERED LIST, never the
  definition walk**: `pricingSheetHelper`'s single loop builds the panel list, the `selected` map
  handed to `runPipeline`, AND the missing-attribute gate from the same defs — so filtering the WALK
  strips the facts from `selected`, `absent_when` never fires, and every socket row is silently
  mispriced. The filter belongs on the push, and the gate EXEMPTS a hidden attribute, because a field
  the pricer cannot see is not missing user input.
- **⚠️ AN MCB MENTION MAY COME FROM AN ANCESTOR, AND R12 SAYS SO DELIBERATELY (owner ruling A, 2d).**
  R12 step (1) is a **literal-mention test** — the word MCB (or MCCB / RCBO / RCCB / ELCB / "miniature
  circuit breaker" / "circuit breaker") must actually appear in the row's `description`, its `notes`,
  **or an `ancestor_chain` entry**; an incomer, a current figure, or a distribution context is NOT a
  mention, and the default is No. Steps (2)–(4) describe the MCB **only when (1) is Yes** — *a current
  figure in the text is never evidence that an MCB exists*, which is the sentence that stops the model
  reasoning backwards from "I can find a current" to "therefore there is an MCB".
  ⚠️ **A ROW WHOSE PARENT NAMES AN MCB THEREFORE ANSWERS YES, AND THAT IS CORRECT** — the one live
  case (BOQ-26-00106 row 589, a trolley under a *"9 Nos. 40 amp DP MCB"* preamble) reads its amperage
  from the parent's MCB rather than borrowing the socket's incomer rating, which is the improvement.
  **Do not "fix" it by excluding ancestors without a ruling**; measured on the live corpus, 21 of 23
  socket rows carry the word in their OWN text, 1 only in an ancestor, and 1 nowhere.
- **AN EXTRACTION-SIDE RULE IS CERTIFIED BY RE-RUN + CAPTURE, NEVER BY TEST (owner-locked).** No unit
  test can see what the model returns, so a green suite says nothing about a prompt/rules change. The
  evidence is a scoped re-extraction (`start_suggest(only_rows=[...])`) plus the always-on JSONL
  capture, which preserves the RAW value per row beside its coerced result and its drop reason — that
  pairing is what turns "the rows came back blank" into a named cause. Treat any `rules` /
  `extraction_defaults` / prompt wording change as UNVERIFIED until re-run on live rows.
- **Frontend attributes are CATEGORY-SCOPED (owner):** the `Pricing sheet` helper shows the row's CATEGORY
  attributes; a category with no attribute set defined yet shows a "coming soon" note, not the wrong fields.
  A badge-less rate-editable cell exposes an always-on faint opener for manual fill.
- **EA-2 -- extraction + helper are N-CATEGORY (owner-locked).** The runner is no longer wiring-only: the
  population spans EVERY category on the sheet whose active config has BOTH non-empty pipelines AND
  attribute definitions (an empty-pipelines DATA-ONLY config like `lighting_mgmt_system` is excluded
  automatically -- NO special case); batches are SINGLE-CATEGORY (each carries its category's defs +
  prompt), and results carry `category_id` per row. **MODE SWITCH** (config.`matching_mode`): an
  `item_identity` category injects the SECOND prompt asset
  (`prompts/boq_rate_item_identity_prompt.md`) and flags the identity attribute (`identity_attribute_id`)
  `identity:true` with its allowed values := the LIVE item catalog (distinct identity-attr values across
  the category's active master items -- NEVER hardcoded); `_coerce_value` enforces catalog membership, so
  an out-of-catalog value -> null. The identity prompt's REFUSE-COMPOSITES rule (an assembly / multi-item
  row -> null) is owner-locked. The helper (`pricingSheetHelper.ts`) resolves the config PER row category
  (`configsByCategory`, all 11 registry categories fetched via a child `RateConfigFetcher`); a category
  with no eligible config -> "coming soon". Groups render ONE per NON-BCS pipeline (ids containing "bcs"
  are NEVER surfaced -- owner deferral), labelled `config.pipeline_labels?.[id]` (CONFIG DATA, added to
  wiring by an audited RM-4b edit) else a prettified id. **The `wiring_cabling` paired Cable+Termination
  display is a TEMPORARY owner special-case (Decision 2) with a NAMED SUCCESSOR: EA-4 designs the generic
  pairing/assembly mechanism and wiring migrates onto it then -- do NOT extend the named-category branch.**
- **CLASSIFICATION-VOCABULARY GAP (standing):** `popup_boxes` + `lighting_mgmt_system` are rate-master
  categories the Electrical CLASSIFIER does not emit yet, so ZERO production rows resolve to them; the
  helper is ready but they need a classifier vocabulary update first.

---

## Reference Docs

| Domain | File |
|---|---|
| Full context index | `.claude/context/_index.md` |
| Doctypes | `.claude/context/doctypes.md` |
| APIs | `.claude/context/apis.md` |
| **BoQ backend (endpoints, doctypes, commit pipeline, slice changelog)** | **`.claude/context/domain/boq-backend.md`** |
| **BoQ frontend** (wizard, hub, review, pricing) | **`frontend/.claude/context/domain/boq-frontend.md`** |
| BoQ live status / full as-built plan | `frontend/.claude/plans/boq-upload-plan.md` |
| Procurement (PR/PO/RFQ) | `.claude/context/domain/procurement.md` |
| Projects | `.claude/context/domain/projects.md` |
| Service Requests | `.claude/context/domain/service-requests.md` |
| Internal Transfer Memos | `.claude/context/domain/internal-transfer-memos.md` |
| Expenses (approval workflow, Paid-only, unified module) | `.claude/context/domain/expenses.md` |
| Invoice Autofill | `.claude/context/domain/invoice-autofill.md` |
| **Invoice Qty** (derived `invoice_qty`, recompute classifier, backfill + Gemini extraction, cache, Resolve UI) | `.claude/context/domain/invoice-qty.md` |
| **Bulk Import Outflow** (bank statement → settles Approved→Paid across Project Payments / Project + Non Project Expenses; matcher, status deriver, ±₹1 tolerance, decision screen) | `.claude/context/domain/outflow-import.md` |
| Vendor Hold | `frontend/.claude/context/domain/vendor-hold.md` |
| **Monthly WIP & Handover report** (Reports hub → Projects → "Monthly WIP"; 5-group/15-col compliance table: DPR-daily / Inventory-weekly / lifetime PO-dispatch + DC; active-days from Version history) | `.claude/plans/monthly-wip-plan.md` |
| Frontend domain context (full) | `frontend/.claude/context/_index.md` |
| Session changelog | `.claude/CHANGELOG.md` |

---

## Agent skills

Per-repo configuration read by the installed engineering skills (`/triage`, `/to-tickets`, `/to-spec`,
`/code-review`, `/wayfinder`, `/domain-modeling`, …). Edit the files under `docs/agents/` directly to change
any of it.

### Issue tracker

Issues and specs live as **GitHub issues** on `Nirmaan-app/nirmaan_stack_frappe15_postgres_14`, managed with
the `gh` CLI. PRs are NOT treated as a request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

**Single-context** — root `CONTEXT.md` + root `docs/adr/` — plus this repo's own per-domain reference docs
under `.claude/context/domain/` and `frontend/.claude/context/`. See `docs/agents/domain.md`.
