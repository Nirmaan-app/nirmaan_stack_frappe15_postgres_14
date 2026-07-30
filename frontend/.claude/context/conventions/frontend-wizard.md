<!-- Carved from frontend/CLAUDE.md on 2026-07-30 (structural carve).
     frontend/CLAUDE.md is a router; this file holds the detail it points to.
     Load when: Touching the BoQ wizard hub, a spoke, or the review screen shell -->

### Wizard (hub / spoke / review) -- stable conventions

- **Routes** (React Router v6 `lazy()`, module `export { X as Component }`): upload `/upload-boq` (`?project=<id>`);
  hub `/upload-boq/hub/:boqId`; spoke `/upload-boq/hub/:boqId/sheet/:sheetName`; review
  `/upload-boq/hub/:boqId/review/:sheetName`. RR v6 AUTO-decodes path params; the hub encodes with
  `encodeURIComponent`. Back-nav ALWAYS routes by entity ID, never `navigate(-1)` (routes are deep-linkable with
  no guaranteed history).
- **`sheet_name` is matched VERBATIM (#152)** everywhere (React keys, every endpoint arg) — trailing/leading
  spaces exist in real data; `.trim()` ONLY for display.
- **General-specs badge is DERIVED** from `BOQs.general_specs_sheets` child membership (`source_sheet_name`),
  NEVER from `wizard_status` (the backend never writes "General specs" there).
- **State / mutations:** transient `useBoqWizardStore` (no `persist`). JSON mutations use `useFrappePostCall` +
  `mutate()` (server is authoritative); raw `fetch` ONLY for the multipart file upload. Errors are inline, no toasts.
- **Work-package read path:** WP assignments are GRANDCHILD rows that do NOT serialize on `useFrappeGetDoc("BOQs")`
  — read via `get_boq_work_packages`. Never `order_by` a Frappe field literally named `order` (PG reserved word → 500).
- **`useFrappeGetDoc` swrKey:** 3rd arg is the swrKey; use `id ? undefined : null`, never `{ enabled }`.
- **Parse / commit hub flows** are socket-driven (`boq:parse_run_done`, screen-scoped) with on-mount
  `parse_in_progress` recovery + reconnect self-heal; the acknowledge-only completion / commit-results modals are
  hub-scoped. See the wizard-upload surface.
- **SheetCard is a persistent 3-zone stepper** (`① Configure → ② Review → ③ Commit & Tender`). The
  effective-status → zone mapping lives in the PURE `sheetCardStages.ts` (`computeSheetStages`, unit-tested,
  ADR-0010 F4); `SheetCard.tsx` only renders descriptors + interpolates dynamic text (dates/reasons). There is
  **no header status pill** — the status IS the button-bearing zone's marker; the header holds only name +
  summary + transient chips (Parsing…, needs-re-parse, N-issues). **Stage ③ is READ-ONLY** (committed badge
  alone on its line, priced/orphan chips stacked below; Commit + Tender are footer-only actions). Aside sheets
  (Skip/Hidden) collapse the rail; a committed general-specs sheet still lights ③.
- **Parse-gate rule:** `canParse = reviewedCount >= 1` (≥1 Config-Done sheet). Pending / Parse-failed sheets do
  NOT block — `ParseRunDialog` shows them read-only and only ticks Config-Done sheets.
- **Tendering is direct-nav:** the footer button navigates straight to `/pricing/{first committed sheet by
  sheet_order}`; the pricing editor's in-editor sheet-tab strip replaces the old picker (TenderingDialog removed).
- **Commit dialog is one step:** all eligible sheets pre-ticked; a hard error routes to a slim errors-only notice
  (no per-warning "Looks OK" acks, no supersede-ack). Server gate re-check + `{committed, failed}` results modal +
  `BOQ_DOWNSTREAM_ORPHAN` confirm are the safety boundary. See the revised-boq surface.
