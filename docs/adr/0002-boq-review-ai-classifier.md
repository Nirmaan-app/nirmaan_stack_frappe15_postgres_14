# 2. BoQ Review AI Classifier — Gemini second opinion

Date: 2026-06-19

## Status

Accepted. Supersedes the Anthropic framing of the committed AI-pass groundwork
(slices **AI-1** and **AI-2a** on `feature/boq-phase-4-gemini`). AI-1's schema +
`resolve_effective` chain are **retained** (provider-agnostic). AI-2a's
`BOQ Upload Review AI Settings` doctype + `ai_settings.py` readers are **also kept,
dormant** — reserved as the settings/credential home for the future Anthropic
*comparison mirror*. The Gemini classifier does not read them; it reads its config +
credentials from `Document AI Settings` (see Decision 2 and Consequences).

## Context

After a BoQ sheet is parsed, a deterministic parser assigns each row a
*classification* (preamble / line item / note / spacer / subtotal marker /
header repeat) and a *parent*. The parser is good but not perfect, and the
tendering team wants a **second opinion** on the review screen: an LLM that
independently re-classifies and re-parents the rows so a reviewer can see where
the two disagree before committing.

The committed groundwork assumed **Anthropic/Claude**: AI-1 added seven generically
named `ai_*` suggestion fields to `BoQ Review Row` plus a `human > AI-accepted >
parser` chain in `resolve_effective`; AI-2a added a dedicated `BOQ Upload Review AI
Settings` singleton holding an `anthropic_api_key` and Anthropic model config, with
reader helpers in `nirmaan_stack/api/boq/wizard/ai_settings.py`.

Two facts changed the picture:

1. The owner's intent for the classifier is **Gemini** (the grill turns repeatedly
   specified Gemini); Anthropic is wanted only later, as a parallel *comparison*
   provider to judge which LLM classifies BoQ rows better.
2. The codebase **already has a production Gemini client** — `services/extraction/gemini.py`
   (`GeminiExtractor`) on the `google.genai` SDK, with Vertex-ADC and API-key auth
   modes, controlled JSON generation, and retry/backoff — configured through the
   existing **`Document AI Settings`** singleton (auth mode, GCP project/location,
   `gemini_model`, encrypted `gemini_api_key`) and read via perm-bypassing helpers
   in `services/extraction/files.py`.

Building a second Gemini settings home (re-pointing AI-2a) would duplicate the
auth/credential plumbing `Document AI Settings` already owns, and create a second
GCP project + API key to enter and rotate.

## Decision

Build the BoQ review AI classifier (**slice AI-2**) as a **Gemini, read-only second
opinion**:

1. **Provider = Gemini.** Mirror the low-level client plumbing of
   `services/extraction/gemini.py` (genai client, controlled JSON `response_schema`,
   `temperature=0`, retry/backoff, per-request timeout). Anthropic becomes a separate
   later *comparison mirror*, not part of AI-2.

2. **Settings home = reuse `Document AI Settings`.** No new settings doctype for the
   Gemini classifier. Add a `boq_ai_enabled` flag (and an optional `boq_gemini_model`
   override) to `Document AI Settings`; the Gemini service reads auth + model + key
   through a dedicated reader in `files.py` (`get_boq_classifier_settings`) that reuses
   the shared Gemini credentials. **The committed `BOQ Upload Review AI Settings`
   doctype + `ai_settings.py` (slice AI-2a) are KEPT, dormant** — reserved as the
   settings/credential home for the later Anthropic *comparison mirror*; the Gemini
   classifier does not read them, and nothing is deleted.

3. **Read-only second opinion (v1).** AI-2 only *populates* the `ai_*` suggestion
   columns and surfaces them beside the parser's verdict (the adjacent column + filter
   are the frontend slice AI-3). It does **not** wire accept/reject and does **not**
   feed effective values: `resolve_effective`'s AI-accepted layer stays dormant
   (committed, harmless) until a separate later slice activates promotion.

4. **Per-row output contract.** Gemini emits, for each row,
   `{ id, classification, parent_id|null, classification_confidence,
   parent_confidence, reason }`. `id` is the row's `row_index`; `parent_id` is the
   parent row's `row_index`, or `null` for root (stored as the `-1` sentinel).
   `classification` is constrained to the six parser classes (like-for-like
   comparison). A missing confidence is treated as **Low**. `ai_suggested_level` is
   **derived server-side** by walking the suggested parent chain — not emitted by the
   model. Each suggestion is written with `ai_suggestion_status = "Pending"`.

5. **Independent judgement.** Each row is sent with its **facts and derived signals**
   (description, sl_no, unit, qty/rate/amount presence, `preamble_candidate_score`,
   `level`, `is_rate_only`) but **not** the parser's final classification/parent
   verdict, so Gemini forms its own opinion and the comparison stays honest.

6. **Chunking with carried parents.** Under ~120 rows, one call. Above that, ordered
   boundary-aware chunks; each chunk carries forward the running list of preambles
   **Gemini itself** has identified so far, so a child can name its section regardless
   of distance. Only preambles are legitimate parents. If Gemini misses a section
   header, its children surface as **orphans** — accepted as honest signal of where
   Gemini's structure diverged.

7. **Opt-in, resumable, per sheet.** A per-sheet trigger enqueues a background job
   (`queue="long"`), sets the committed `ai_in_progress` flag on `BoQ Sheet Draft`,
   and publishes a realtime done-event. Progress is **row-granular**: a row is done
   when `ai_suggested_classification` is non-null, and the job commits per chunk.
   *Resume* re-runs only the not-yet-done rows; *Start over* wipes the sheet's `ai_*`
   fields and runs fresh (with a reset warning). No new schema field tracks progress.

## Consequences

- **AI-2a is kept, not undone.** The `BOQ Upload Review AI Settings` doctype + its
  controller + `nirmaan_stack/api/boq/wizard/ai_settings.py` (+ tests) stay committed
  but **dormant** — reserved as the home for the later Anthropic *comparison mirror*.
  Nothing is deleted, so AI-2a's tests stay green and no migration churn is incurred.
  The Gemini classifier instead reads its config + credentials from **`Document AI
  Settings`** — so during this transition BoQ-AI config is split across two homes
  (Gemini in `Document AI Settings`, the dormant Anthropic doctype reserved for the
  mirror); surprising at first read, hence this ADR. The trade-off: reuse the one
  Gemini credential home with zero duplicated Vertex plumbing for the Gemini side,
  while preserving the committed Anthropic groundwork for the comparison provider.
- **AI-1 is unaffected.** The seven `ai_*` columns are provider-agnostic and Gemini
  populates them as-is. The reverted `gemini_*` mirror columns are *not* reintroduced —
  `ai_*` **is** the Gemini track; a future Anthropic comparison mirror is a separate slice.
- `resolve_effective` and `commit_pipeline` need **zero change** for AI-2 (the AI layer
  stays dormant; nothing is promoted into effective values in v1).
- Gemini-only carried parents maximise independence but can orphan children when a
  header is missed; this is treated as signal for the reviewer, not a bug.
- A later slice will add accept/reject (activating the dormant AI-accepted layer) and,
  separately, an Anthropic comparison provider.
