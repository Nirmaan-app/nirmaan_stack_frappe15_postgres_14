# 3. Dual-provider BoQ review AI assist (Claude + Gemini, side by side)

Date: 2026-06-21

## Status

Accepted. **Amends [ADR-0002](./0002-boq-review-ai-classifier.md)** on one point: ADR-0002 decided "the `gemini_*` mirror columns are *not* reintroduced — `ai_*` **is** the Gemini track." This ADR **reverses that**: `ai_*` is now the **Claude** track and a parallel **`gemini_*`** track is (re)introduced for Gemini, so both providers run and are reviewed side by side. The rest of ADR-0002 (the Gemini classifier's blind-from-scratch approach, chunking, carried preambles, `Document AI Settings` home) is **retained unchanged**.

## Context

Two BoQ review AI-assist implementations were built independently on branches that share only the `79280ad8` base:

- **`feature/boq-phase-4` (Nitesh / Claude)** — a *full interactive* corrector: Claude sees the parser's verdict and returns only deltas; an endpoint layer adds accept / reject / snapshot-based **revert** / override-clears-status / a **freeze gate** / a child-disposition modal; suggestions land on the `ai_*` columns; settings in `BOQ Upload Review AI Settings`.
- **`feature/boq-phase-4-gemini` (this owner / Gemini)** — a *read-only second opinion*: Gemini never sees the parser's verdict and re-classifies every row from raw facts (reusing the production `GeminiExtractor` + `Document AI Settings`); suggestions also land on the **same** `ai_*` columns; no accept/reject.

They **collide**: identical filenames (`ai_assist.py`, `boq_ai_assist.py`, …), the same `ai_*` columns, the same `ai_in_progress` flag, the same `boq:ai_pass_done` socket, the same `run_ai_pass` endpoint. They cannot coexist as-is, and `feature/boq-phase-4` is *actively* committed-to (remote `techadmin`), so any merge-heavy integration would churn continuously against Nitesh's work.

The owner wants **both providers kept** as live options on the review screen so a reviewer can replace the parser's decision with Claude's, Gemini's, or a manual one — and so the team can judge **which LLM classifies BoQ rows better**.

## Decision

Integrate the two as a **dual-provider** feature with hard namespace + file separation, on a new branch `feature/boq-phase-4-dual-ai` taken off `feature/boq-phase-4` (the Gemini logic is **ported by hand**, not git-merged; the branch is rebased onto Nitesh's new commits).

1. **Resolution model = "accept folds into the human layer" (Option A).** Accepting a provider's suggestion *copies* its `*_suggested_*` values into the `human_*` columns and flips that provider's `*_suggestion_status = "Accepted"`. The effective value is therefore just the human layer (which already wins), so **`resolve_effective` is unchanged** and the commit pipeline's contract (`effective_classification` / `effective_parent_index` only) is untouched. An accepted decision is **sticky** — frozen at accept-time; a provider re-run never moves it.

2. **Namespace asymmetry: `ai_*` = Claude, `gemini_*` = Gemini.** Claude's load-bearing columns/endpoints (in 170+ of Nitesh's tests, on his active branch) are **not** renamed; Gemini gets a parallel `gemini_*` set. The cost — `ai_*` permanently reading as "Claude" — is accepted as the price of leaving Nitesh's surface untouched.

3. **Full parity for Gemini.** Gemini gets the complete 10-field mirror of Claude's output set (`gemini_suggested_classification/_parent/_is_root/_level`, two confidences, `gemini_explanation`, `gemini_suggestion_status`, `gemini_accept_snapshot`, `gemini_snapshot_owner`), plus `gemini_in_progress` on `BoQ Sheet Draft` and a derived `gemini_revert_available`. Gemini's write-back gains `gemini_suggested_is_root` (from `parent_id == null`) — an output-mapping addition, **not** a change to its blind-from-scratch classification *approach*.

4. **Exactly one accepted Source per row.** A new audit-only `chosen_source` field (`parser` / `claude` / `gemini` / `manual`) records the winner; it is **not** read by `resolve_effective`. Accepting a different Source — or making a manual edit — on an already-accepted row **first reverts the standing acceptance to baseline**, then applies the new one. **Revert always restores the baseline** (state before *any* acceptance — parser, or a prior manual edit), never a previously-accepted provider. This keeps at most one `*_suggestion_status == "Accepted"` per row, so the badge and `chosen_source` are unambiguous. The switch/revert logic lives entirely in the **shared chokepoint** (`_apply_and_save_row_edit`), so Nitesh's `accept_ai_suggestion` needs no change.

5. **Display six classes, accept four.** Gemini may *suggest* all six classes (informative comparison signal, shown with the `≠` divergence marker), but **Accept is restricted to the four assignable classes** (`line_item` / `preamble` / `note` / `spacer`) — `subtotal_marker` / `header_repeat` remain detection-only, mirroring Claude and preserving the commit pipeline's priceable/grid-only gates.

6. **Two settings homes, two enable flags.** Claude stays in `BOQ Upload Review AI Settings`; Gemini stays in `Document AI Settings` (reusing the GCP credentials already configured for invoice OCR — per ADR-0002). The review screen exposes `claude_enabled` and `gemini_enabled` independently (both may be on at once). Two **independent** opt-in triggers run the two passes; neither auto-runs.

7. **Re-run mirrors Nitesh.** A provider re-run stale-clears *that provider's* suggestion columns + status; the accepted `human_*` value is sticky and survives; for rows whose `chosen_source` was that provider, `chosen_source` **demotes to `manual`** (the decision stands but is no longer backed by a live suggestion).

8. **File split.** Untouched (Claude core): `api/boq/wizard/ai_assist.py`, `services/boq_ai_assist.py`, their tests, `ai_settings.py`, the `BOQ Upload Review AI Settings` doctype. New (Gemini): `api/boq/wizard/gemini_assist.py`, `services/boq_gemini_assist.py`, tests, and frontend `GeminiSuggestionColumn.tsx` / `GeminiAcceptBlock.tsx`. **Additive-only** shared edits: `review_screen.py` (`get_review_rows`, the chokepoint, `save_review_restructure` gains `mark_gemini_accepted`), the two doctype JSONs, `extraction/files.py`, and the four shared frontend files (`ReviewTree.tsx`, `SheetReviewPage.tsx`, `boqTypes.ts`, reused `RestructureModal.tsx`). Frontend strategy is **additive-symmetric** (8A): Nitesh's Claude column + accept block are left as-is; a look-alike Gemini column + accept block sit beside them; the two providers render in two separate grid columns. The Gemini column/block **visually clone Nitesh's existing AI treatment** (same styling, filter, badges) — a dedicated review-tree design pass is **deferred** to later.

9. **Comparison: design-only in this build.** Beyond the per-row columns, an **aggregate "AI Classifier Comparison" view** is captured as a first-draft mock at `docs/boq/ai-comparison-view.html` (per-Source suggestion/adoption/hit-rate, a Claude-vs-Gemini head-to-head on contested rows, the `chosen_source` distribution, accuracy-by-class). The **live React/shadcn component is deferred** (out of this build's scope) — when built, it computes its metrics from the **persistent review rows**, not the committed nodes. The Gemini service's per-pass token-logging fix (`boq_ai.log`) is folded into the service port.

10. **Commit pipeline untouched; provenance lives on review rows.** A sheet's `BoQ Review Row`s are *versioned (freeze-and-supersede), not deleted*, at commit — so `chosen_source` + both providers' suggestions remain a **durable** record there. Commit reads only `effective_*`; no `chosen_source`/provider stamp is propagated onto `BOQ Nodes` (deferred to its own slice if a downstream node-consumer ever needs it).

## Consequences

- **Nitesh's Claude logic files stay byte-for-byte untouched**; the only shared surface is the review engine (`review_screen.py` + four frontend files + doctype JSONs), edited additively, so rebases onto his commits stay cheap. This is the central payoff and the reason for the namespace asymmetry.
- `resolve_effective` and the commit pipeline are unchanged — `chosen_source` and all `gemini_*` columns are review-time audit/UX state and never reach `BOQ Nodes`.
- A reviewer can now run either, both, or neither provider; switching between accepted Sources is coherent and lossless-to-baseline; the comparison data (`chosen_source` + per-provider hit-rates) accumulates for the aggregate view.
- Running two LLM passes doubles per-sheet AI cost; mitigated by both being opt-in and independently gated.
- Two settings homes mean an admin configures Anthropic and Google credentials in two places — accepted as clearer than coupling two unrelated subsystems or duplicating GCP plumbing.
- `subtotal_marker` / `header_repeat` Gemini suggestions are visible but never acceptable — a deliberate, documented limitation, not a bug.
