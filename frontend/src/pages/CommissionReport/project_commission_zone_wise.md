# Zone-Wise Commissioning Reports — As-Built Reference

**Status:** Implemented (2026-06). Wizard live via dev/HMR; print format pushed to the live
Print Format doc. Committed on branch `commission-fixes`.

A "zone-wise" commissioning report turns a single report into a **per-zone tabbed** report:
the same report is filled once per physical zone (e.g. Ground Floor, First Floor), each zone
fully isolated, and the printed PDF renders each zone on its own page(s).

---

## 1. The gate — `zone_wise_enable`

Zone-wise is opt-in **per task**, driven by a key **inside the `source_format` JSON** of the
`Commission Report Tasks` master doctype:

```json
{ "templateId": "...", "templateVersion": N, "zone_wise_enable": "YES", "title": "...", ... }
```

- `"YES"` → the wizard renders the zone UI; `"NO"` / absent → ordinary single-form report.
- **No schema change** — just a key in the existing `source_format` Long Text field (Option A,
  chosen to avoid a new doctype/field). The wizard reads it from the parsed template
  (`parseTemplate` passes unknown keys through).

### Enabled tasks (22)

| Group | Shape | Tasks |
|---|---|---|
| Equipment / panel | Duct-shape (`repeating_groups`) | Duct Pressure, Duct Smoke, Duct Light, LT Panel Commissioning, DB Commissioning, VRF, DX, CFM/Air Balance |
| Simple flat | Access-Control-shape | Access Control, CCTV, Nitrogen Pressure, Gas Suppression, Sprinkler Pressure, RR, WLD, VESDA |
| Trainees-table commissioning/test | flat + `trainees_data_table` | LUX Level, Earthing, LT Cable Megger, PA Commissioning, FA Commissioning, Socket Testing |

**Deliberately NOT zone-wise:** the 9 `…Training Report` tasks (templateId
`demo-training-certificate`) are `zone_wise_enable:"NO"` — training is not per-zone. Empty/vendor
tasks (no `sections`) are not enabled. The flags live in BOTH `commission_report_tasks.json` and
the DB rows (kept in sync).

---

## 2. Data model — `response_data.zones[]`

Saved in the `response_data` (Long Text) field of the **`Commission Report Task Child Table`**
(child of `Project Commission Report`):

```jsonc
{
  "zoneWise": true,
  "zones": [
    {
      "id": "z_<uuid>",            // stable across rename/reorder
      "label": "First Floor",
      "responses": { "<sectionId>": <data> },   // header / checklist / equipments[] / sigs / ...
      "attachments": { "<key>": [ {file_url,file_name,file_doc} ] }  // per-zone images
    }
  ],
  "responses": {},   // empty in zone-wise mode
  "attachments": {}  // empty in zone-wise mode
}
```

- Each zone is a **fully isolated report** (own header, sections, signatures, images).
- **Signatures are per-zone** — each zone's `responses.<sigsId> = { disabled, enabled }` override.
- Non-zone reports are unchanged: today's flat `{ responses, attachments }`, no `zones` key.

---

## 3. Wizard (`report-wizard/`)

- **Outer nav = zone tabs** (`ZoneTabBar`): one per zone + an "All-Zones Review" tab, shown only
  when `>1` zone. Inline rename, drag-to-reorder, delete (confirm if the zone has data).
- **Add a zone** = the per-zone Review step's **[Add Another Zone]** button → `AddZoneDialog`
  (existing-zone badges + optional rename-current-if-default + 1+ names → jumps to the first new
  zone). No persistent add button; a single zone is an ordinary wizard.
- **Inner steps** expand per zone. For an `equipments` `repeating_groups` section the steps further
  expand into **per-equipment sub-steps within the zone** (each step carries `zoneSlice` +
  `groupSlice`), scoped to that zone's `equipment_count`.
- **Per-zone validation** reuses `validateStep` against a `{ responses: zones[i].responses }` view
  (paths re-rooted `responses…` → `zones.<i>.responses…`).
- **Submit** ships `zones[]`; **prefill / edit-view** reconstructs each zone via
  `resolveInitialValues` (preserving saved values, seeding new fields).

### Two correctness rules (learned the hard way)

1. **Zone mutation = RHF `useFieldArray` only.** Add / reorder / delete go through
   `append` / `move` / `remove`. Never `form.setValue('zones', wholeArray)` — replacing the whole
   array while a nested `useFieldArray` (the active zone's `equipments`) is mounted wipes that
   zone's data.
2. **Zone-unique render key.** Each per-zone section is keyed `${step.key}-${sid}` (step.key is
   zone-qualified) so inputs **remount on zone switch**. A bare `sid` key reuses the uncontrolled
   inputs across zones (looks "shared", false required-field errors on Next).

---

## 4. Renderer — `pathRoot` / `attachmentsRoot` threading

Shared by all count-wise reports, so zone-scoping is additive via default params
(`pathRoot="responses"`, `attachmentsRoot="attachments"`):

- `SectionRenderer` threads `responsesRoot`/`attachmentsRoot` to every input-bearing section.
- `HeaderSection` / `FieldsSection` / `ChecklistSection` / `SignaturesSection` /
  `MeasurementMatrixSection` take an optional `pathRoot`.
- `RepeatingGroupsSection` takes `pathRoot` + `attachmentsRoot`; re-roots the absolute
  `countBoundTo`; nests per-equipment images under `zones.<i>.attachments`
  (key `equipments_<g>_<slot>` — isolation is the attachments ROOT, not a key prefix).
- `TraineesDataTableSection` takes `pathRoot` (row array + per-row image cells + the Earth-Pit
  header-count watch re-rooted).
- Non-zone path is byte-for-byte unchanged.

---

## 5. Backend

`api/commission_report/update_task_response.py` — submit validation relaxed to accept the
zone-wise payload: non-empty flat `responses` **OR** `zoneWise:true` + non-empty `zones[]`. The
non-zone path is unchanged. This is the only backend change.

---

## 6. Print format (`commission-printformat.html` → Print Format "Project Commission Report - Filled Task")

The per-`templateId` dispatch is wrapped in a per-unit loop:

```jinja
{%- set _zone_wise = (rd.zoneWise and rd.zones) -%}
{%- set render_units = (rd.zones if _zone_wise else [rd]) -%}
{%- set _multi_zone = (_zone_wise and (render_units | length > 1)) -%}
{% for Z in render_units %}
  {%- set rd = Z -%}   {# REBIND: the body's rd.responses/rd.attachments now read this zone #}
  ... existing per-templateId body (header → sections → signatures) ...
{% endfor %}
```

- **Rebinding `rd = Z`** renders each zone unchanged — no global find-replace (the only
  zone-dependent reads are `rd.responses`/`rd.attachments`).
- Each non-first zone gets `page-break-before`.
- The **zone label** prints as a **"ZONE" row inside the header table, after LOCATION**
  (multi-zone only; single-zone prints like an ordinary report).
- Non-zone reports: `render_units = [rd]`, one pass, no banner → unchanged.

### Signatures

- `render_signatures(template_id, project_id, disabled_keys, enabled_keys)` builds the signatory
  set from **Project TDS Setting** flags + per-report overrides: final = (TDS-enabled − `disabled`)
  ∪ `enabled`.
- Rendered as a **TDS-style boxed table** (matches the "Project TDS Report" print format): bold
  bordered label row + 60px bordered signing-box row (`.cv-sig-header td` / `.cv-sig-box td`).
- **Manual entries print:** a manually-ticked TDS-off role lands in `enabled[]`; the macro renders
  it via `"<key>" in ek`. The macro and the wizard `SignaturesSection.computeAllRoles` stay in
  **lockstep**. Consultant was added to the `demo-training-certificate` branch so a TDS-off
  Consultant is manually selectable + prints. **Architect is intentionally not offered.**

---

## 7. Known caveats

- The print change is committed in BOTH `commission-printformat.html` (source) and the
  `print_format.json` fixture entry; the live DB print doc was also pushed. The team normally edits
  print formats via Desk — keep these in sync if hand-editing.
- Signatures only render when the project has a `Project TDS Setting`; otherwise the print shows a
  "set up Project TDS Setting" notice.

---

## 8. Per-unit single-page print layouts (2026-07)

Extends §6. Several report types were restructured so a multi-unit report prints **one
self-contained page per unit** — repeated header + that unit's content + its **own** signature —
instead of one shared header + all units flowing + a single trailing signature. Each such report
gets a **dedicated `{% elif tpl.templateId == … %}` branch** in `commission-printformat.html`
(split out of the old shared "generic count-wise" branch so the other reports are untouched).

**Pattern** (per unit): `{% for group/zone in units %}<div class="cv-<x>-page" style="page-break-inside: avoid;{% if not loop.first %} page-break-before: always;{% endif %}"> … repeated header table … unit particulars … content … render_signatures(…, margin="…") … </div>`. The §6 zone-level break (line ~214) combines with these per-unit breaks; the first unit of a **non-first zone** omits its own break so no blank page appears (capture `_zone_first = loop.first` before the inner loop for the guard).

| Template (`templateId`) | One page = | Contents |
|---|---|---|
| `db-commissioning-report` | per **DB** | header + DB particulars + IR test + Functional Checklist + **Procedure as bullets** + signature (margin 100px). |
| `lt-panel-commission-report` | per **panel** | **Page 1 = Panel Test Procedure once, NO header** (first zone only, even multi-zone); then one page per panel: header + panel particulars + Physical Test (10px) + IR test + signature (margin 18px). Panel particulars drop the 3-per-row empty padding cells. |
| `sprinkler-pressure-test` | per **zone** | Procedure once (common, first zone); then per zone: header + checklist + Testing images (200px) + measured pressure + signature. |
| `duct-pressure/smoke/light-testing-report` | per **equipment** | Dedicated branch. **Compact header** (ZONE+TEST TYPE on one line, DATE+NO. OF EQUIPMENTS on the next); equipment particulars no empty padding; Observations checklist + Testing Images (200px) + signature (margin 12px). |
| `duct-cfm-report` (CFM/Air Balance) | per **equipment** | header + EQUIPMENT+AREA card + HVAC CFM readings table + signature (margin 40px). **Area is a per-grill column** (`rowsTable.area`) — restored to the readings table; readings font 11px, sized so ~15 rows fit one page. A **required equipment-level `area` groupField** was also added to the template `source_format` (fixture `commission_report_tasks.json` + DB). |

**Landscape** (`ls-commission-printformat.html` → `LSProject Commission Report - Filled Task`):
- `lt-cable-megger-test-report`: signatures render as **bordered boxes** (matching portrait, `.cv-sig-header`/`.cv-sig-box`) not underline lines; header puts **ZONE + DATE on one row**; a `MEGGER-FIT` compression style makes **≥5 cable rows + signature** fit one page (each "PASS" cell renders its ✓ on a 2nd line, doubling row height — moving ✓ inline is the pending readability fix).

**`SIG_MARGINS`** (portrait, keyed by `task_name`): WLD 130→**120**, RR 130→**120** (a too-large margin pushed a content-heavy zone's signature to a 2nd page); **Gas Suppression 500→12** *and* its signature moved **inside the content cell** (like VESDA) + the 25-item checklist compressed (11px) so it fits one page/zone; **FA added at 12**.

### Gotchas
- **File ↔ DB drift (load-bearing):** the on-disk `.html` is only the source copy; the live **DB print-format record is what renders** (portrait `Project Commission Report - Filled Task`, landscape `LSProject …`). They drift when one is edited without the other — happened this session on the CFM branch, the panel physical-CSS, and the duct-cfm variation formula. **Apply every layout edit to BOTH**, and a full-branch rewrite re-syncs them.
- **Fit is page-height-bound, not just font:** a unit can overflow because its content is genuinely > 1 page (Duct **Smoke**'s long remarks → 2 pages/equipment at any image size; Gas's 25 items) — compression + signature-margin only help to a point.
- **"min N rows" = a page-height budget:** verify by rendering to **PDF and counting pages** (with a synthetic N-row injection into `response_data`, then restore), not by eyeballing the wizard.
