### Module 3 Slice 3f -- Section 4 work-package assignment

**Status:** COMPLETE (feat 793276f6). Frontend-only -- no backend/schema/type change. The work_packages child-table schema and the set_sheet_work_packages endpoint landed earlier in 3a (feat b14e9015); 3f is UI-only. (The earlier plan-doc framing of 3f as a "schema conversion / backend-touch" slice was STALE -- corrected here.) Files: SheetConfigPanel.tsx, SheetSpokePage.tsx. boqTypes.ts unchanged. Wizard tests 89. Parser tests 588. Build exit 0.

**What landed:**
- Section 4 (Work Packages) in SheetConfigPanel, below Section 3. Flat checkbox list populated from useFrappeGetDocList("Work Headers") sorted by order ASC; option label = work_header_name, value = name (docname). No grouping (only one parent group has >1 member; 2 headers have null work_package_link -- flat is correct).
- selectedWorkHeaders[] seeded once from draft.work_packages (wpInitialized guard; survives mutate() re-fetch). SheetSpokePage passes workPackages={draft.work_packages}.
- INSIDE the gate: touchS4 adds "section:workpackages" to confirmedFields; allSectionsConfirmed now requires all 4 section keys; SAVE_ALL_FIELDS gains work_packages + section:workpackages so Save / Mark-as-reviewed / bulk-accept all clear the Section 4 sparkle.
- REQUIRED NON-EMPTY: hasWorkPackage (selectedWorkHeaders.length > 0) ANDed into the attestation-checkbox enable condition, kept SEPARATE from parserRequiredSatisfied (config-required, not parser-required). Helper line shown when sections confirmed + parser-required satisfied but no WP assigned.
- Save path writes BOTH endpoints: set_sheet_config then set_sheet_work_packages (in handleSave and handleMarkReviewed). Mark-reviewed sequence: set_sheet_config -> set_sheet_work_packages -> set_sheet_status("Reviewed"), each gated on the prior.
- M3.12 drop: dropIfReviewed() in the Section 4 checkbox onCheckedChange; opening without toggling does NOT drop.
- Removed orphaned touch() helper (zero call sites after 3e; TS6133 gone).

**Manual test (live, required):** open a Pending sheet -> Section 4 empty + sparkle; attestation checkbox DISABLED with zero WP even after confirming all sections; assign a header -> checkbox enables; mark reviewed -> hub shows Reviewed + card WP summary; re-open, add/remove a WP -> drops to Pending; re-open and just view the list without toggling -> stays Reviewed. Full de-stale before testing (Vite restart + Service Workers Unregister + Clear site data + Ctrl+Shift+R).

**3f-fix (feat 85c842a3) -- Work Headers picker 500 (order reserved word):** The picker hung on "Loading..." with a 500. Cause: useFrappeGetDocList passed order_by on the field `order`, a PostgreSQL reserved keyword -> invalid SQL in Frappe's REST list layer. Fix: removed server-side order_by, kept `order` in fields, sort client-side by order asc in JS. CONVENTION: never order_by on a Frappe field literally named `order` -- sort client-side.

**3f-readback (feat a637be0d) -- work-package read-back (grandchild rows):** Assignments saved but never displayed (hub card blank, spoke Section 4 unticked on re-open). Root cause: Frappe get_doc / REST serializes child tables ONE LEVEL DEEP ONLY -- BOQs.sheet_drafts populates, but BoQ Sheet Draft.work_packages (grandchild) does not, so draft.work_packages is always empty client-side. The hub display from 3a-fix was therefore never functional (latent bug, not a 3f regression). Fix: new read-only whitelisted endpoint get_boq_work_packages(boq_name) -> { sheet_name: [work_header,...] } (queries tabBoQ Sheet Work Package directly via frappe.db.get_all; get_doc does not hydrate grandchildren). Rewired hub (SheetCard workHeaders prop) and spoke (SheetConfigPanel workPackages: string[] from the endpoint); refresh on save via mutateWpMap. +6 wizard tests. Module 3 (3a-3f) COMPLETE -- all 5 manual-test checks passed live on BOQ-26-00145.

---

