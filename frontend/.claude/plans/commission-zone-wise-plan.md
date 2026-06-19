# Commission Reports — Zone-Wise Plan (FINAL — pending your "confirmed")

> **All decisions are resolved.** Read once more; reply **"confirmed"** to build, or edit anything first.
> Markers: **[V1]** = in this first build. **[LATER]** = deferred. **[NOT DOING]** = out of scope.

---

## 1. Goal

When a commission report's master template is flagged zone-wise, the fill wizard becomes **tabbed by zone**. Each zone is a complete, isolated report (its own Header + Checklist + Signatures), and one report can hold many zones (Ground Floor, First Floor, …). Reports that are **not** flagged behave exactly as today — zero change.

---

## 2. Where things live (exact doctypes + fields)

| Purpose | DocType | Field | How |
|---|---|---|---|
| Gate flag | **`Commission Report Tasks`** (master, standalone) | **`source_format`** (Long Text / JSON) | add key `"zone_wise_enable": "YES"` inside the JSON |
| Zone data | **`Commission Report Task Child Table`** (`istable=1`, child of *Project Commission Report* via `commission_report_task`) | **`response_data`** (Long Text / JSON) | store the `zones: [...]` shape below |

**No doctype/schema changes. No new fields. No migration.** Both are JSON-inside-existing-Long-Text.

---

## 3. The gate

- Wizard reads `template.zone_wise_enable` from the parsed `source_format`.
- `"YES"` → zone-wise mode. `"NO"` / missing → existing single-report mode (untouched). Values are the strings `"YES"` / `"NO"` (we read case-insensitively, write `"YES"`).

---

## 4. Data model (saved in `Commission Report Task Child Table.response_data`)

```jsonc
{
  "templateId": "...", "templateVersion": 2,
  "zoneWise": true,
  "filledAt": "...", "filledBy": "...", "lastEditedAt": "...",
  "prefillSnapshot": { ... },
  "zones": [
    {
      "id": "z_8fk2",            // stable auto-id — rename/reorder/delete-safe
      "label": "Ground Floor",   // the name typed when the zone was added
      "responses": {             // EVERY section, scoped to THIS zone (header + checklist + signatures)
        "hdr":  { "vendor": "...", "project": "...", "location": "...", "date": "..." },
        "chk":  { "q1": {"result":"YES","remarks":""}, "...": "..." },
        "sigs": { "disabled": [], "enabled": ["gc_contractor"] }  // per-zone signature override (existing flow)
      },
      "attachments": {}          // per-zone images (none for Access Control)
    }
  ]
}
```

Rules:
- **Header is per-zone (LOCKED)** — each zone carries its own `responses.hdr`.
- **Signatures are PER-ZONE (LOCKED)** — each zone carries its own `responses.sigs = { disabled:[…], enabled:[…] }` using the **existing signature flow** (`SignaturesSection`): the picker lists all roles, **TDS-enabled pre-ticked**, the rest selectable as a manual override. So a zone may include even a TDS-`false` role if ticked, and different zones can have different signatories. Project TDS supplies the base enable flags at print time; the per-zone `{disabled, enabled}` override is what's stored.
- Each zone is fully isolated under its `id`; editing one never touches another.
- **Fresh report seeds one default zone:** `zones: [{ id, label: "Zone 1", responses: <defaults/bound values>, attachments: {} }]` (renamed later via the Add-Another-Zone dialog at Review).
- Non-zone reports have **no `zones` key** → today's `{responses, attachments}` shape, byte-for-byte.

---

## 5. Wizard UX

**Add-Zone flow (REVISED — owner spec):** users are NOT forced to declare zones up front, and there is **NO persistent "Add Zone" button**.

- **Start:** a zone-wise report opens with **one default zone** (`Zone 1`) and runs the **normal stepper** — Header → Checklist → Signatures → Review. While only one zone exists there is **no zone tab bar / no Add button** — it looks like an ordinary report.
- **Add happens at Review.** The per-zone **Review** step shows that zone's summary + two actions: **[Add Another Zone]** and **[Submit]**.
- **[Add Another Zone] → opens a DIALOG:**
  1. If the current zone still has its **default name** (`Zone N`), offer to **rename** it (e.g. "Ground Floor").
  2. Enter **one or more** new zone names.
  3. On confirm: rename current (if changed) + create the new zone(s) + **navigate to the first new zone**, which runs the **full workflow** (Header → Checklist → Signatures → Review).
- **Zone switcher:** once there is **> 1 zone**, a zone list/tabs appears (each zone shows ✓ when complete; the current one is marked) so the user can move between **existing** zones. **No add button on the switcher** — adding is ONLY via [Add Another Zone] on a Review step.
- **Submit** lives on the per-zone Review (submits the whole report with all zones filled so far).
- **All-Zones Review (combined):** when `> 1 zone`, also reachable from the switcher as a read-only overview of every zone (Submit available there too).
- **Always ≥ 1 zone**; deleting a zone with data asks for confirmation; **no hard max** (soft cap 50).
- **Nav = Option A** (zone switcher when >1 + inner step bar), reorder via the switcher.

**Clarifications (so nothing's ambiguous):**
- **Per-zone Signatures step** = the existing all-roles picker (TDS-enabled pre-ticked, others selectable) scoped to that zone → stored as `zones[i].responses.sigs {disabled, enabled}`. Each zone independent.
- **Per-zone Review** shows that zone's Header + Checklist + chosen signatures as a read-only summary.
- **Reorder / Delete:** move zone tabs to reorder; deleting asks to confirm if the zone has data; can't drop below 1 zone. Data follows the stable `id`.
- **Reopen (edit/view):** tabs rebuilt from `response_data.zones` in saved order.
- **Default-zone seeding:** a new/first zone's Header `bind` fields (project/vendor/location) auto-fill from prefill; `date` empty + required; signatures default to the TDS-enabled set.

---

## 6. Implementation steps (frontend wizard only — no backend/schema)

All zone logic is **guarded by `zone_wise_enable === "YES"`** so every existing report is untouched.

1. **`report-wizard/types.ts`** (additive):
   - `ReportTemplate.zone_wise_enable?: "YES" | "NO"`.
   - `WizardStepDef.zoneSlice?: { zoneIndex: number }` (mirrors existing `groupSlice`).
   - new `ZoneEntry { id; label; responses; attachments }`; `ResponseData.zoneWise?`, `ResponseData.zones?`; `FormShape.zones?`.
2. **`report-wizard/template-parser.ts`**: accept `zone_wise_enable` (validate it's YES/NO if present; never reject).
3. **Access Control config**: add `"zone_wise_enable": "YES"` to task `sbeu8i7qlk` `source_format` in `nirmaan_stack/fixtures/commission_report_tasks.json` (+ mirror in `commission-template.json`). Sections stay `hdr` + `chk` + `sigs` (these are the per-zone template — NOT wrapped in a repeating group).
4. **`report-wizard/index.tsx`** (core):
   - detect zone-wise; hold zones as an RHF field array.
   - zone tab bar + Add/Remove/Rename/**Reorder** zone (data follows by stable `id`; seed a new zone's defaults via the existing `resolveInitialValues`).
   - per-zone step rendering (active zone → `responsesRoot = "zones.<i>.responses"`).
   - **validation reuses the existing `validateStep`/`validateTemplate`** by feeding a per-zone view `{ responses: zones[i].responses }` — no parser-internals change.
   - submit builds `response_data = { zoneWise:true, zones }`; prefill reconstructs zones in edit/view.
5. **`renderer/SectionRenderer.tsx`** + section components: thread a `pathRoot`/`responsesRoot` so **Header, Checklist, AND Signatures** read/write `zones.<i>.responses.<section>`. Checklist + Matrix already accept `pathRoot`; add it to **HeaderSection**, **FieldsSection**, and **SignaturesSection** (so each zone's `{disabled,enabled}` signature override is stored per zone).
6. **Review** (in `index.tsx`): (a) **per-zone review** — each zone's flow ends with a Review of that zone (reuse the existing per-section review render, scoped to the zone's `responses`); (b) **all-zones combined review** — a final screen listing every zone's review, rendered **only when `zones.length > 1`**. Submit sits on the final review (combined if >1 zone, else the single zone's own review).
7. **Print** — **[DEFERRED]** (Q5). Sketch for later: `{% if rd.zoneWise %}{% for zone in rd.zones %} …header + checklist + that zone's signatures (render_signatures with the zone's own disabled/enabled)… {% endfor %}{% endif %}` (keys on `rd.zoneWise`, **not** templateId). Not built in V1.

---

## 7. Scope (this build)

- **[V1 · phase 1]** Access Control Commissioning Report (master task `sbeu8i7qlk`, template `common-template-1`, sections `hdr`+`chk`+`sigs`) — the **flat** case; built + verified first to prove the framework end-to-end.
- **[V1 · phase 2]** Duct Pressure Testing Report (template `duct-pressure/smoke/light-testing-report`) — the **nested** case: each zone contains the existing **equipment-testing `repeating_groups`** (+ its per-zone count field) AND **per-zone image attachments**. Needs `pathRoot` threaded through `RepeatingGroupsSection` + `ImageAttachmentSection` (`<zoneId>__…` keys) + zone-relative `countBoundTo`. Built right after phase 1.
- **Per-zone image attachments** — required by phase 2 (Duct); keyed `<zoneId>__<slot>`.
- **[NOT DOING]** any doctype/schema change; zone-as-a-`repeating_groups`-section (explicitly rejected). *(Per-zone signatures ARE in scope — each zone keeps its own override via the existing flow.)*

---

## 8. Backward compatibility & risk

- Non-zone reports: no `zone_wise_enable` → no zone code path runs → identical to today.
- The shared validation/submit/draft functions are **reused unchanged** (fed a per-zone view), minimizing regression risk to other reports.
- Verification: `tsc` 0 new wizard-file errors + Vite build exit 0; then manual on Access Control — add 2 zones, fill different checklists + **different signature picks per zone**, Review shows both, Submit → inspect `response_data.zones[]` (each zone has its own `hdr`/`chk`/`sigs`). (Print verification deferred with the print branch.)

---

## 9. Open questions for you

1. ~~Add Zone — dialog vs inline?~~ **RESOLVED:** starts with 1 default zone (`Zone 1`), renamed **inline** in the wizard; `+ Add Zone` adds more.
2. ~~Reorder zones~~ **RESOLVED:** reorder **allowed** in V1 (move zones; data follows by stable `id`).
3. ~~Min/max zones~~ **RESOLVED:** default 1, always ≥ 1; **no hard max** (soft cap 50).
4. ~~Nav~~ **RESOLVED:** **Option A — tabs (outer) + inner stepper**, reorder via the tab bar.
6. ~~Signatures~~ **RESOLVED (corrected):** signatures are **per-zone** via the existing all-roles picker/override flow (NOT shared) — each zone stores its own `sigs {disabled, enabled}`.
5. ~~PDF layout per zone~~ **DEFERRED:** print format on hold — build wizard + data first, discuss print later.
