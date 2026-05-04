# Commissioning Report Templates — Grammar Reference

Reference documentation for the **template-driven commissioning report wizard**. Load when working on the wizard renderer, schema builder, master `source_format` editor, the print format Jinja, or any feature that reads/writes a commissioning task's `response_data`.

---

## Overview

Each commissioning task type (e.g., "Sprinkler Pressure Test Report") declares a **JSON template** in the master `Commission Report Tasks.source_format` field. The wizard renderer turns this template into a multi-step form that:

- Renders **process / instructional text** (printed verbatim in PDF, read-only in wizard).
- **Prefills fields** from the Project doctype (snapshot at fill time, not live joins).
- Asks the user for the **report-specific values** that aren't already known.
- Captures **multi-image attachments** per slot via Nirmaan Attachments.
- Saves the structured response into the child row's `response_data` Long Text field.
- Stores a **frozen snapshot** of the template used (in a content-addressed pool) so older filled reports always render correctly even after the master template changes.

**Decoupling rule:** Filling/submitting the wizard does **not** mutate `task_status`. Status is managed independently via the existing TaskEditModal. The backend `validate_report_evidence_for_completed` hook accepts a meaningfully filled `response_data` as evidence on the Completed transition.

---

## Where things live

| Concern | Location |
|---|---|
| Master template (admin authoring) | `Commission Report Tasks.source_format` (Long Text, JSON) |
| Soft-delete flag | `Commission Report Tasks.is_active` (Check, default 1) |
| Filled response (per task instance) | `Commission Report Task Child Table.response_data` (Long Text, JSON) |
| Snapshot pointer | `Commission Report Task Child Table.response_snapshot_id` (Link → Commission Report Template Snapshot) |
| Frozen template snapshot pool | `Commission Report Template Snapshot` doctype (docname = SHA-256 of payload) |
| Image attachments | `Nirmaan Attachments` (`attachment_type="commission_report_image"`, `attachment_ref=<slot_key>`, `attachment_link_doctype="Commission Report Task Child Table"`, `attachment_link_docname=<child row name>`) |
| Wizard route | `/commission-tracker/:id/task/:childRowName/fill?mode=fill\|view\|edit` |

---

## Top-level template shape

```jsonc
{
  "templateId":      "sprinkler-pressure-test",   // stable string id, used for grouping
  "templateVersion": 1,                            // bump when grammar changes meaningfully
  "title":           "Sprinkler Pressure Test Report",

  // Optional. If omitted, a step is auto-generated per section in declaration order
  // plus a final "Review" step. Explicit wizardSteps lets one step group multiple
  // sections (see "results" below).
  "wizardSteps": [
    { "key": "procedure",  "title": "Procedure",    "sections": ["proc"] },
    { "key": "header",     "title": "Header",       "sections": ["hdr"] },
    { "key": "checklist",  "title": "Checklist",    "sections": ["chk"] },
    { "key": "results",    "title": "Test Results", "sections": ["images", "measurements"] },
    { "key": "signatures", "title": "Signatures",   "sections": ["sigs"] },
    { "key": "review",     "title": "Review",       "sections": [] }
  ],

  "sections": [
    // … see Section Types below
  ]
}
```

### Required vs optional top-level keys

| Key | Required | Notes |
|---|---|---|
| `templateId` | yes | Lowercase-kebab. Stable across versions. |
| `templateVersion` | yes | Integer ≥ 1. |
| `title` | yes | Display title in wizard header. |
| `wizardSteps` | no | If omitted: one step per section + Review. |
| `sections` | yes | Ordered array of sections. |

### `wizardSteps` rules

- Each entry has `key` (route-safe), `title` (display), `sections` (array of `section.id` referenced).
- A `sections: []` step renders the **Review** screen — full snapshot of all answers + Submit.
- Sections not referenced in any step are still validated, but not rendered to the user. (Useful for hidden sections that only appear in the print format.)
- Step `key`s must be unique.

---

## Section Types

Six section types. Each section has a unique `id` (referenced from `wizardSteps`) and a `type` discriminator. Renderer dispatches on `type`.

### 1. `process` — Read-only procedural text

Purely informational. Renders verbatim in the wizard step (the user just reads & clicks Next) and in the printed PDF. No user input.

```jsonc
{
  "id": "proc",
  "type": "process",
  "title": "Sprinkler Pressure Test Operating Process",
  "blocks": [
    {
      "subtitle": "Test Procedure",
      "items": [
        "1. Inspect the system to verify that openings are plugged and valves are closed.",
        "2. Connect the test pump to a convenient location in the system.",
        "..."
      ]
    },
    {
      "subtitle": "Pass/Fail Criteria",
      "items": [
        "1. The system must hold the test pressure for 2 hours without loss of pressure.",
        "2. Absence of water leakage is verified by visual examination of the system"
      ]
    }
  ]
}
```

| Key | Required | Notes |
|---|---|---|
| `title` | no | Section heading. |
| `blocks[].subtitle` | yes | Sub-heading rendered in bold. |
| `blocks[].items` | yes | Plain strings; renderer escapes HTML, preserves `\n`. No markdown in v1. |

### 2. `header` — Identity / cover-block fields

Key/value pairs (vendor, project, location, date, etc.). Used for the report's masthead. Each field can be `static` (default-filled, optionally read-only), `bound` (prefilled from Project via `bind`), or `user input`.

```jsonc
{
  "id": "hdr",
  "type": "header",
  "title": "COMMISSIONING REPORT — SPRINKLER SYSTEM",
  "fields": [
    { "key": "vendor",   "label": "VENDOR",   "type": "text",
      "default":  "STRATOS INFRA TECHNOLOGIES PVT LTD", "readonly": true },
    { "key": "project",  "label": "PROJECT",  "type": "text",
      "bind":     "project.project_name",                "readonly": true },
    { "key": "location", "label": "LOCATION", "type": "text",
      "bind":     "project.location.full",               "readonly": true },
    { "key": "date",     "label": "DATE",     "type": "date", "required": true }
  ]
}
```

| Field key | Required | Notes |
|---|---|---|
| `key` | yes | Stable identifier, written into `responses.<section_id>.<field_key>`. |
| `label` | yes | Display label. |
| `type` | yes | One of `text`, `textarea`, `number`, `date`, `select`. |
| `default` | no | Static default value. |
| `bind` | no | Binding path from the allowlist (see below). Mutually exclusive with `default` per the resolver order (see Resolution Order). |
| `readonly` | no | If `true`, the input is disabled in the wizard. |
| `required` | no | Honored at Zod validation time. |
| `unit` | no | For `type: "number"`, rendered as a static suffix (e.g. `kPa`). |
| `options` | for `type: "select"` | Array of strings. |
| `min` / `max` | no | For `type: "number"`. |

### 3. `checklist` — Tabular Q&A

A table of N rows, fixed columns. Each row has an auto-numbered Sl No, a `particular` label, a `result` input, and an optional `remarks` input.

```jsonc
{
  "id": "chk",
  "type": "checklist",
  "title": "Sprinkler System Commissioning Report:",
  "columns": [
    { "key": "slno",       "label": "Sl No" },
    { "key": "particular", "label": "Particulars" },
    { "key": "result",     "label": "Results" },
    { "key": "remarks",    "label": "Remarks" }
  ],
  "items": [
    {
      "id": "q1",
      "particular": "All Sprinklers are as per drawing",
      "result":  { "type": "select", "options": ["Yes", "No", "N/A"], "default": "Yes" },
      "remarks": { "type": "text" }
    },
    {
      "id": "q2",
      "particular": "Testing of Sprinklers (upright, pendant)",
      "result":  { "type": "select", "options": ["Yes", "No", "N/A"], "default": "Yes" },
      "remarks": { "type": "text" }
    }
  ]
}
```

- Sl No is auto-numbered by `items[]` index (1-based) — never specified explicitly.
- `result` and `remarks` are mini-inputs (same shape as `header.fields[]` minus `bind`).
- Default `remarks` policy: optional. If a future template requires "No → remarks required", that's a per-item rule (`"requireRemarksWhen": ["No"]`). Not implemented in v1.
- `items[].id` is stable; written to `responses.<section_id>.<item_id> = { result, remarks }`.

### 4. `image_attachments` — Image upload slots

Visual containers for image uploads. Each slot can hold one or many images (multi). Files are uploaded immediately on selection (so previews work) via Nirmaan Attachments; the response_data only stores attachment `name` references, never base64.

```jsonc
{
  "id": "images",
  "type": "image_attachments",
  "title": "Sprinkler Pressure Test Result:",
  "columns": 2,                                  // visual layout: how many slots per row
  "slots": [
    { "key": "result_image_1", "label": "Result Image 1", "multi": true,
      "accept": "image/*", "maxSizeMb": 5 },
    { "key": "result_image_2", "label": "Result Image 2", "multi": true,
      "accept": "image/*", "maxSizeMb": 5 }
  ]
}
```

| Slot key | Required | Notes |
|---|---|---|
| `key` | yes | Stable identifier; written as `attachment_ref` on each Nirmaan Attachment. |
| `label` | yes | Display label above the slot. |
| `multi` | no, default `false` | If `true`, slot accepts multiple files (append). If `false`, replace-on-reupload. |
| `accept` | no, default `"image/*"` | MIME pattern. PDF allowed via `"image/*,application/pdf"`. |
| `maxSizeMb` | no, default `5` | Per-file size limit. |
| `required` | no, default `false` | If `true`, slot must have ≥1 attachment to pass step validation. |

### 5. `fields` — Generic typed-input grid

A grid of arbitrary fields not tied to a header/checklist/attachment layout. Use for measurements, free-form notes, additional dates, etc.

```jsonc
{
  "id": "measurements",
  "type": "fields",
  "title": "Test Measurements",
  "layout": "grid",
  "columns": 2,
  "fields": [
    { "key": "test_start_date",   "label": "Test Start Date", "type": "date",   "required": true },
    { "key": "test_end_date",     "label": "Test End Date",   "type": "date",   "required": true },
    { "key": "measured_pressure", "label": "The measured Pressure Rating is",
      "type": "number", "unit": "kPa", "required": true, "min": 0 }
  ]
}
```

Field schema is identical to `header.fields[]`.

| Section key | Notes |
|---|---|
| `layout` | `"grid"` (default) or `"stack"`. |
| `columns` | For `layout="grid"`: number of columns. |

### 6. `signatures` — Blank signature/stamp blocks

Renders blank labelled boxes. **No input control in v1** — purely visual placeholders for hand-signing the printed PDF. (Future extension: signature pads / e-sign integration.)

```jsonc
{
  "id": "sigs",
  "type": "signatures",
  "blocks": [
    { "key": "tested_by",       "label": "TESTED BY" },
    { "key": "hvac_contractor", "label": "HVAC CONTRACTOR" },
    { "key": "client",          "label": "CLIENT" }
  ]
}
```

In the wizard, signatures render as muted "Signature & Stamp" placeholders. In the PDF, they render as labelled empty boxes.

---

## Field types reference

| `type` | Renders as | Zod | Notes |
|---|---|---|---|
| `text` | shadcn `<Input>` | `z.string()` | `maxLength` honored if set. |
| `textarea` | shadcn `<Textarea>` | `z.string()` | `rows` controls height (default 3). |
| `number` | shadcn `<Input type="number">` + optional unit suffix | `z.number()` | `min` / `max` honored. |
| `date` | shadcn `<DatePicker>` (project default `dd-MMM-yyyy`) | `z.string()` ISO `YYYY-MM-DD` | Formatted via `formatDate()` for display. |
| `select` | shadcn `<Select>` | `z.enum(options)` | `options` required. |

`required: true` adds `.min(1)` (text/textarea), `.refine(v => v != null)` (number/date), or `.refine(v => v !== "")` (select).

---

## Binding paths (closed allowlist)

`bind: "project.foo"` resolves at fill time against `getReportPrefill(project)` output (snapshot, frozen into `prefillSnapshot` in `response_data`). The allowlist is the **only** way to introduce a binding — there is no arbitrary dot-path eval.

| Binding | Resolves to | Source |
|---|---|---|
| `project.project_name` | `Projects.project_name` | direct field |
| `project.project_city` | `Projects.project_city` | denormalized from Address |
| `project.project_state` | `Projects.project_state` | denormalized from Address |
| `project.location.full` | full printable address | `Projects.project_address` → `Address` doc; mirrors `frontend/src/components/address-view.tsx:29` formatter |
| `project.project_start_date` | `Projects.project_start_date` | direct field |
| `project.project_end_date` | `Projects.project_end_date` | direct field |
| `project.project_type` | `Projects.project_type` | Link target |
| `project.customer.company_name` | `Customers.company_name` | one-hop join via `Projects.customer` |

To add a new binding: register in `frontend/src/pages/CommissionReport/report-wizard/prefill/bindings.ts` AND add the resolver to `nirmaan_stack/api/commission_report/get_report_prefill.py`. Both sides must agree.

### Resolution order for a field's initial value

1. If `response_data.responses[section][field]` already has a value (edit mode) → use it.
2. Else if `bind` is set → use `prefillSnapshot[bind]`.
3. Else if `default` is set → use `default`.
4. Else → `""` / `null` / `undefined` per type.

---

## Response data shape (`response_data`)

```jsonc
{
  "templateId":      "sprinkler-pressure-test",
  "templateVersion": 1,
  "snapshotHash":    "sha256:abc123...",         // → Commission Report Template Snapshot.name
  "filledAt":        "2026-05-04T10:30:00Z",
  "filledBy":        "engineer@nirmaan.app",
  "lastEditedAt":    "2026-05-04T11:00:00Z",
  "prefillSnapshot": {
    "project.project_name":  "Acme Tower Phase 2",
    "project.location.full": "123 Main St, Bangalore, Karnataka - 560001"
  },
  "responses": {
    "hdr": {
      "vendor":   "STRATOS INFRA TECHNOLOGIES PVT LTD",
      "project":  "Acme Tower Phase 2",
      "location": "123 Main St, Bangalore, Karnataka - 560001",
      "date":     "2026-05-04"
    },
    "chk": {
      "q1": { "result": "Yes", "remarks": "" },
      "q2": { "result": "Yes", "remarks": "" }
      // q3..q6
    },
    "measurements": {
      "test_start_date":   "2026-05-03",
      "test_end_date":     "2026-05-04",
      "measured_pressure": 200
    }
  },
  "attachments": {
    "result_image_1": ["af0ad12bc1", "bc5d9e3fa2"],
    "result_image_2": ["c1e8b4a9d0"]
  }
}
```

### Field semantics

| Field | Purpose |
|---|---|
| `templateId` / `templateVersion` | For grouping queries ("how many reports use Sprinkler v1?"). |
| `snapshotHash` | Foreign key into `Commission Report Template Snapshot` doctype. The snapshot is the **immutable, frozen template** used at fill time — guarantees the report renders the same forever. |
| `filledAt` / `filledBy` | Stamped on first Submit. |
| `lastEditedAt` | Stamped on every subsequent edit. |
| `prefillSnapshot` | Frozen prefill values, keyed by binding path. Renders identically forever even if the project changes. |
| `responses[section_id][field_key]` | User-entered or prefilled-then-frozen values. Checklist items use `responses[section_id][item_id] = {result, remarks}`. |
| `attachments[slot_key][]` | Array of Nirmaan Attachment `name`s for that slot. |

### Size constraints

- Cap `response_data` at ~1 MB client-side (validate before save).
- Never store base64 image data in the JSON — only attachment `name` references.
- `prefillSnapshot` should hold only the bindings actually consumed by the template (not the whole prefill dict).

---

## Snapshot pool — content-addressed storage

Snapshots are stored in `Commission Report Template Snapshot` (NEW doctype):

| Field | Notes |
|---|---|
| `name` | SHA-256 hex of the payload — used as docname so identical templates dedupe automatically. |
| `template_id` | Copied from the source for grouping. |
| `template_version` | Integer. |
| `template_title` | Copied for display in lookups. |
| `payload` | Long Text, immutable after insert. |
| `first_seen_at` | Auto-stamped. |

When a wizard Submit fires:

1. Client computes the canonical JSON of the template used (stable key order).
2. Server hashes it (SHA-256) and `INSERT … ON CONFLICT DO NOTHING`-style upserts into the snapshot pool.
3. Sets `response_data.snapshotHash` and `Commission Report Task Child Table.response_snapshot_id`.

This avoids ballooning parent commission report docs: identical templates across N filled rows share **one** snapshot row.

---

## Concurrency / write safety

The existing detail page uses a "rewrite the entire `commission_report_task` array" save pattern (`useCommissionTrackerLogic.handleTaskSave`) — last-writer-wins.

The wizard MUST NOT use that path. Wizard writes go through the whitelisted method `nirmaan_stack.api.commission_report.update_task_response.update_task_response`, which:

- Uses `frappe.db.set_value` to update only the four target fields on one child row (`response_data`, `response_snapshot_id`, `response_filled_at`, `response_filled_by`).
- Rejects with HTTP 409 if the parent's `modified` timestamp differs from `expected_modified` sent by the client.
- Re-validates role / assignee permission server-side.

On 409, the client refetches and prompts the user to re-apply.

---

## Attachment lifecycle

Files are uploaded immediately when the user picks them (so previews work). To avoid orphans on cancel/abandonment:

1. **Client-side cleanup.** `useReportAttachments` tracks every NA created in the current session. On Cancel / `beforeunload`, fires best-effort delete (sendBeacon) for any NA whose `name` is **not** in the final committed `response_data`.
2. **Server-side janitor.** Daily cron `cleanup_orphan_commission_attachments` finds NAs with `attachment_type="commission_report_image"` older than 24 h whose `name` is not present in any live `response_data.attachments` array. Belt-and-braces.
3. **Atomic-ish Submit.** The Submit call only persists JSON — it never uploads new files. So a Submit failure cannot orphan; only mid-session abandonment can.

---

## Validation lifecycle

| When | What |
|---|---|
| **Master Save (Packages Settings)** | Client-side `JSON.parse` + grammar shape check (templateId, version, sections present, every section has unique id). Bad templates rejected before save. |
| **Wizard Mount** | Re-validate the parsed template against the latest grammar version. If invalid: render a friendly admin-targeted error, do not crash the tracker. |
| **Per-step Next** | `form.trigger(stepFieldKeys)` against the per-step Zod schema built from the template. |
| **Submit** | Full schema validation across all steps + 1MB size cap + image-slot required check. |
| **Backend Save** | Server re-parses + re-runs shape check. Snapshot upsert. Optimistic-concurrency check on parent.modified. |
| **Status → Completed (existing hook)** | `validate_report_evidence_for_completed` accepts: `file_link` set OR `approval_proof` set OR (`response_data` is a parseable JSON with non-empty `responses` AND `response_snapshot_id` is set). |

---

## Editing after submit

Allowed via `mode=edit`. On every save, Frappe's built-in Version doctype records the change. The view-mode renderer always renders from `templateSnapshot` + `responses` (immutable contract).

**Audit trail caveat (v1):** Frappe Version diffs JSON-in-Long-Text opaquely. If granular field-level audit becomes a requirement, design a custom audit log later.

---

## Soft-delete

Toggling `Commission Report Tasks.is_active=0`:

- Hides the Fill Report button on **new** / unfilled task rows.
- Does NOT hide existing filled responses (they still render in view mode — snapshot guarantees this).
- Never hard-delete a master template that has filled responses pointing to it.

---

## Worked example: Sprinkler Pressure Test Report

Full template JSON for the canonical Sprinkler Pressure Test Report (decoded from `/Users/abhishek/Downloads/Sprinkler_Commissioning Report.xlsx`, sheet `4.3.1. Pressure Test`).

```json
{
  "templateId": "sprinkler-pressure-test",
  "templateVersion": 1,
  "title": "Sprinkler Pressure Test Report",
  "wizardSteps": [
    { "key": "procedure",  "title": "Procedure",    "sections": ["proc"] },
    { "key": "header",     "title": "Header",       "sections": ["hdr"] },
    { "key": "checklist",  "title": "Checklist",    "sections": ["chk"] },
    { "key": "results",    "title": "Test Results", "sections": ["images", "measurements"] },
    { "key": "signatures", "title": "Signatures",   "sections": ["sigs"] },
    { "key": "review",     "title": "Review",       "sections": [] }
  ],
  "sections": [
    {
      "id": "proc",
      "type": "process",
      "title": "Sprinkler Pressure Test Operating Process",
      "blocks": [
        {
          "subtitle": "Test Procedure",
          "items": [
            "1. Inspect the system to verify that openings are plugged and valves are closed.",
            "2. Connect the test pump to a convenient location in the system.",
            "3. Connect the water source to the test pump.",
            "4. Open the main control valve to fill the system. (If the water service is not installed or has not been flushed, fill the system through the test pump water source.)",
            "5. Fill the system slowly to avoid entrapment of air.",
            "6. Open a valve (such as the inspector's test connection or a temporary valve) to vent any trapped air.",
            "7. Close the valve when water flows continuously through it.",
            "8. When the system pressure equals that of the water source, close the supply valve and inspect the entire system for leaks.\n   i. Leaks may result from flanges not bolted properly, plugs not properly installed, cracked or improperly tightened fittings, etc.\n   ii. If leaks are found, open the 2-in. main drain connection or other low-point drain connection and allow the system to drain. Repair any leaks found and repeat this procedure.\n   iii. If no leaks are detected, begin to increase pressure with the test pump up to 200 psi or 50 psi in excess of the static pressure when static pressure exceeds 150 psi.",
            "9. Monitor the test gauge to determine that the system pressure is stable. If pressure drops, check for leaks in the system, for open valves, or for leaks in the test apparatus.",
            "10. Once it is determined that the test pressure has stabilized, disconnect the power to the test pump and notify the commissioning agent or authority having jurisdiction that the 2-hour test period has begun.",
            "11. Record the time of day and test pressure at this time.",
            "12. Hold the test pressure for 2 hours.",
            "13. After the test, open the drain valve to drain the system, or if the system is to be commissioned immediately, relieve the test pressure and leave the water in the system.",
            "14. Disconnect the test pump and plug the outlet or test port through which the system was tested.",
            "15. If the test will be required on existing fire sprinkler systems, review the proper impairment including the fire alarm system to avoid false signals."
          ]
        },
        {
          "subtitle": "Measurements",
          "items": [
            "1. Test pressure is to be maintained for 2 hours without any visible leaks."
          ]
        },
        {
          "subtitle": "Pass/Fail Criteria",
          "items": [
            "1. The system must hold the test pressure for 2 hours without loss of pressure.",
            "2. Absence of water leakage is verified by visual examination of the system."
          ]
        }
      ]
    },
    {
      "id": "hdr",
      "type": "header",
      "title": "COMMISSIONING REPORT — SPRINKLER SYSTEM",
      "fields": [
        { "key": "vendor",   "label": "VENDOR",   "type": "text",
          "default": "STRATOS INFRA TECHNOLOGIES PVT LTD", "readonly": true },
        { "key": "project",  "label": "PROJECT",  "type": "text",
          "bind": "project.project_name", "readonly": true },
        { "key": "location", "label": "LOCATION", "type": "text",
          "bind": "project.location.full", "readonly": true },
        { "key": "date",     "label": "DATE",     "type": "date", "required": true }
      ]
    },
    {
      "id": "chk",
      "type": "checklist",
      "title": "Sprinkler System Commissioning Report:",
      "columns": [
        { "key": "slno",       "label": "Sl No" },
        { "key": "particular", "label": "Particulars" },
        { "key": "result",     "label": "Results" },
        { "key": "remarks",    "label": "Remarks" }
      ],
      "items": [
        { "id": "q1", "particular": "All Sprinklers are as per drawing",
          "result": { "type": "select", "options": ["Yes", "No", "N/A"], "default": "Yes" },
          "remarks": { "type": "text" } },
        { "id": "q2", "particular": "Testing of Sprinklers (upright, pendant)",
          "result": { "type": "select", "options": ["Yes", "No", "N/A"], "default": "Yes" },
          "remarks": { "type": "text" } },
        { "id": "q3", "particular": "Hydraulic pressure testing (Pressure below 10kpa)",
          "result": { "type": "select", "options": ["Yes", "No", "N/A"], "default": "Yes" },
          "remarks": { "type": "text" } },
        { "id": "q4", "particular": "Leak detection testing",
          "result": { "type": "select", "options": ["Yes", "No", "N/A"], "default": "Yes" },
          "remarks": { "type": "text" } },
        { "id": "q5", "particular": "Demonstration (Practical training) work has been completed",
          "result": { "type": "select", "options": ["Yes", "No", "N/A"], "default": "Yes" },
          "remarks": { "type": "text" } },
        { "id": "q6", "particular": "The above all are working fine",
          "result": { "type": "select", "options": ["Yes", "No", "N/A"], "default": "Yes" },
          "remarks": { "type": "text" } }
      ]
    },
    {
      "id": "images",
      "type": "image_attachments",
      "title": "Sprinkler Pressure Test Result:",
      "columns": 2,
      "slots": [
        { "key": "result_image_1", "label": "Result Image 1", "multi": true,
          "accept": "image/*", "maxSizeMb": 5 },
        { "key": "result_image_2", "label": "Result Image 2", "multi": true,
          "accept": "image/*", "maxSizeMb": 5 }
      ]
    },
    {
      "id": "measurements",
      "type": "fields",
      "layout": "grid",
      "columns": 2,
      "fields": [
        { "key": "test_start_date",   "label": "Test Start Date", "type": "date",   "required": true },
        { "key": "test_end_date",     "label": "Test End Date",   "type": "date",   "required": true },
        { "key": "measured_pressure", "label": "The measured Pressure Rating is",
          "type": "number", "unit": "kPa", "required": true, "min": 0 }
      ]
    },
    {
      "id": "sigs",
      "type": "signatures",
      "blocks": [
        { "key": "tested_by",       "label": "TESTED BY" },
        { "key": "hvac_contractor", "label": "HVAC CONTRACTOR" },
        { "key": "client",          "label": "CLIENT" }
      ]
    }
  ]
}
```

### How this template renders

| Step | Section(s) | What the user sees |
|---|---|---|
| 1. Procedure | `proc` | Three subsections (Test Procedure 15 steps, Measurements, Pass/Fail Criteria) as read-only text. Single Next button. |
| 2. Header | `hdr` | 4 inputs. VENDOR readonly default-filled. PROJECT + LOCATION readonly prefilled from project. DATE required date picker. |
| 3. Checklist | `chk` | 6 rows in a table. Each row: Sl No (auto-numbered) · Particulars (label) · Results (select Yes/No/N/A defaulted Yes) · Remarks (optional text). |
| 4. Test Results | `images` + `measurements` | Two image slots side-by-side (multi-image, ≤5MB each, image/*) + grid of {Test Start Date, Test End Date, Measured Pressure with kPa suffix}. |
| 5. Signatures | `sigs` | Three labelled blank signature/stamp boxes (TESTED BY · HVAC CONTRACTOR · CLIENT). No input. |
| 6. Review | (none) | Full snapshot of all answers across all sections + Submit button. |

### How the response_data looks after a fill

```jsonc
{
  "templateId": "sprinkler-pressure-test",
  "templateVersion": 1,
  "snapshotHash": "sha256:abc123...",
  "filledAt":     "2026-05-04T10:30:00Z",
  "filledBy":     "engineer@nirmaan.app",
  "lastEditedAt": "2026-05-04T10:30:00Z",
  "prefillSnapshot": {
    "project.project_name":  "Acme Tower Phase 2",
    "project.location.full": "123 Main St, Bangalore, Karnataka - 560001"
  },
  "responses": {
    "hdr": {
      "vendor":   "STRATOS INFRA TECHNOLOGIES PVT LTD",
      "project":  "Acme Tower Phase 2",
      "location": "123 Main St, Bangalore, Karnataka - 560001",
      "date":     "2026-05-04"
    },
    "chk": {
      "q1": { "result": "Yes", "remarks": "" },
      "q2": { "result": "Yes", "remarks": "" },
      "q3": { "result": "Yes", "remarks": "Pressure at 8 kPa, below threshold." },
      "q4": { "result": "Yes", "remarks": "" },
      "q5": { "result": "Yes", "remarks": "" },
      "q6": { "result": "Yes", "remarks": "" }
    },
    "measurements": {
      "test_start_date":   "2026-05-03",
      "test_end_date":     "2026-05-04",
      "measured_pressure": 200
    }
  },
  "attachments": {
    "result_image_1": ["af0ad12bc1", "bc5d9e3fa2"],
    "result_image_2": ["c1e8b4a9d0"]
  }
}
```

---

## Adding a new template type

To add (say) "Fire Pump Test Report":

1. Author the JSON template offline against this grammar.
2. Sign in as Admin → Packages Settings → Commission Packages tab.
3. Find or create the matching `Commission Report Tasks` master row (e.g., task_name = "Fire Pump Test", linked to a Commission Report Category).
4. Paste JSON into the Source Format textarea → Validate JSON → Save.
5. Optionally hit "Preview Wizard" to sanity-check rendering before tasks are auto-generated for new projects.

If the template introduces a new binding (e.g., `project.foo`), it must also be added to BOTH:

- `frontend/src/pages/CommissionReport/report-wizard/prefill/bindings.ts`
- `nirmaan_stack/api/commission_report/get_report_prefill.py`

---

## Cross-references

- Architecture plan: `~/.claude/plans/rippling-greeting-babbage.md`
- Wizard pattern reference: `frontend/src/pages/projects/project-form/index.tsx`, `frontend/src/pages/ServiceRequests/sr-form/index.tsx`
- Reused step UI: `frontend/src/components/ui/wizard-steps.tsx`
- Reused file picker: `frontend/src/components/helpers/CustomAttachment.tsx`
- Nirmaan Attachments insert pattern: `frontend/src/pages/DeliveryChallansAndMirs/components/UploadDCMIRDialog.tsx:253-289`
- Address composition: `frontend/src/components/address-view.tsx:29`
- Date formatter: `frontend/src/utils/FormatDate.ts`
- Commissioning module overview: `frontend/src/pages/CommissionReport/`
