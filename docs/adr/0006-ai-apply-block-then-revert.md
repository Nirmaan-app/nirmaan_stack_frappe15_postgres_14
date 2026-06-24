# 6. AI-apply mutual exclusivity: block-then-revert (revises ADR-0003 §4)

Date: 2026-06-24

## Status

Accepted. **Revises [ADR-0003](./0003-dual-provider-boq-ai-assist.md) §4** and **refines §5**. The invariant — *at most one accepted Source per row* — is unchanged. The **mechanism** changes: from *auto-revert-the-standing-acceptance-then-apply* to **block the new apply until the user explicitly reverts**. Built on `feature/boq-ai-validations`.

## Context

ADR-0003 §4 made switching Sources *lossless and automatic*: accepting a different provider (or a manual edit) on an already-accepted row **first reverts** the standing acceptance to baseline, then applies the new one — `accept_gemini_suggestion` pre-reverts a standing Claude acceptance via the imported `revert_ai_acceptance` (`gemini_assist.py:438-448`); the chokepoint clears the other provider on any human write (`review_screen.py:1018-1019`, `1056-1057`). Revert restored to *baseline*, where baseline could be a prior manual edit — producing the documented Claude/Gemini revert **asymmetry** (`gemini_assist.py:26-40`; the chokepoint ASYMMETRY NOTE at `review_screen.py:1026-1032`).

The owner wants AI applies to be **explicitly non-destructive**: an AI suggestion must never silently overwrite *any* standing decision — another provider's accepted suggestion **or a manual edit**. The user should consciously clear a row before a (different) AI suggestion can take it. (Today a purely manual edit has *no* reset-to-parser affordance; only AI acceptances expose Revert via `revert_available = bool(ai_accept_snapshot)`.)

## Decision

1. **Any standing change blocks AI apply.** AI Apply (Claude or Gemini) is enabled on a row **only when the row is at the parser baseline** — no accepted AI suggestion *and* no manual `human_*` override. If the row carries *any* standing change (an `*_suggestion_status == "Accepted"` **or** a manual edit), both providers' Apply controls are disabled.

2. **Unified "Revert to parser".** A single revert affordance, shown on *any* overridden row, fully restores the row (and any children a restructure moved) to the **parser baseline**, regardless of whether the standing change was an AI acceptance or a manual edit. After it, the row is clean and AI Apply re-enables.

3. **The revert asymmetry is retired.** Because AI can never stack on top of a manual edit (apply is blocked), an AI acceptance is always captured against a clean parser baseline, so AI-revert *always* lands on parser. The prior "restore to a prior manual edit" branch and the Claude/Gemini snapshot asymmetry no longer arise; the ASYMMETRY NOTE is removed.

4. **Enforced in depth.** A disabled Apply button (frontend) **plus** a `ValidationError` thrown in both accept endpoints (`accept_ai_suggestion`, `accept_gemini_suggestion`) **and** in `save_review_restructure` (the with-children accept path). The now-dead pre-revert in `accept_gemini_suggestion` (`gemini_assist.py:438-448`) and the unused `claude_reverted` field (`gemini_assist.py:369, 443-446, 533`) are removed. A manual human edit still clears any standing AI status (it is itself a standing change, then reverted via the unified affordance) — the escape hatch is the unified Revert, not silent overwrite.

5. **Gemini column highlight refines §5.** ADR-0003 §5 keeps *display-six / accept-four* for the **accept block** (unchanged). For the **column highlight** (Req 1), a Gemini divergence is highlighted only when it differs from the **parser** on classification or parent (`parent_index`, root = null/<0; root-vs-root is no signal), and a divergence *to* a detection-only class (`subtotal_marker`/`header_repeat`) is **suppressed** from the highlight as un-actionable. This is a display refinement, not a change to what is acceptable.

## Consequences

- An AI apply can never silently destroy a manual edit or the other provider's accepted suggestion; overwrites require a conscious revert.
- One coherent "Revert to parser" affordance replaces the implicit auto-revert; the model is simpler to reason about and the documented revert asymmetry is gone.
- A row the user hand-edited must be explicitly reverted before it can take an AI suggestion — deliberate friction, accepted as the price of non-destructiveness.
- Existing dual-AI switch tests that assert auto-revert (`test_review_screen.py::TestDualAISwitch`) are rewritten to assert *block*.
- `resolve_effective` and the commit pipeline remain untouched — this is all review-time apply/revert state.
