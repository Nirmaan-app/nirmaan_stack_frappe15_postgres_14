## Phase 5 Pricing Editor -- slice detail (rehomed from CLAUDE, docs-hygiene stage 1, 2026-06-22)

These `### Phase 5 Pricing Editor -- ...` sections are the canonical detail home for the Phase-5 PRICING-EDITOR arc
(2026-06-20 -> 2026-06-22). Until now this arc's full as-built detail lived ONLY in the two CLAUDE.md files (root for
the backend slices, frontend for the frontend slices); the plan held only a terse top-changelog pointer. Stage 1 of the
docs-hygiene cleanup rehomes that detail here (additively, verbatim-faithful to the CLAUDE blocks) so the bloated CLAUDE
status blocks can be deleted in a later stage. **Naming note:** every heading is prefixed "Phase 5 Pricing Editor --"
to avoid colliding with the Module-3 config-panel spoke slices that share bare numbers (e.g. `### Module 3 Slice 3e --
two-layer review gate` is the CONFIG-PANEL gate, a DIFFERENT slice from the pricing "Slice 3e" priceability gate below).
The composing `get_priced_rows` read already has its own dedicated section above (`## Phase 5 Pricing-overlay read --
get_priced_rows`) and is NOT duplicated here -- the slices below cross-reference it.

**Docs-hygiene stage 2 (2026-06-22, minimal-touch note):** Stage 2 relocated the remaining mis-homed CLAUDE content into
its correct homes (no plan content added -- every fact was already captured, here or in the existing dedicated `### Slice
...` / `### Module 3 Slice ...` sections). (a) Buried LIVE pricing-editor component contracts (keyboard-nav matrix,
read-only callback-presence gating, cross-area proposedRates invariant, annotation render channels) were lifted UP into a
new component-keyed "### BoQ Pricing Editor -- Frontend Conventions" block in `frontend/CLAUDE.md`. (b) Durable
architectural facts (single-editor lock PK/marker/300s, priceability §6, the BoQ Cell Remark/Color/Pricing/Lock
doctypes) were reduced in root `CLAUDE.md` to terse quick-rules + pointers to the slice sections here. (c) Granular
slice-dated convention history in `frontend/CLAUDE.md` (review-screen B-blocks, the detail-panel CSS pass, Layout Part A,
Slice A2, Slice A1 rename migration, Module-3 3c/3c-fix/3d-ii-read-back/3b-iii) was consolidated to its live rules in
CLAUDE with the full per-slice detail left to THESE plan sections. CLAUDE status-block bulk stays until stage 3.

