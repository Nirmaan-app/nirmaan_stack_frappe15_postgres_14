# Document Autofill (Gemini)

**Status:** Gemini-only as of 2026-06. Google Document AI was **fully removed** (too costly for ~150–200 pages/month).

## Why this exists

Indian invoices and payment receipts need a handful of fields keyed in every time (invoice no/date/amount; UTR/date/amount). A multimodal LLM extracts them from the uploaded PDF/image. Document AI (a custom-trained processor billed per page) was replaced by the **Gemini API**, which at this volume costs well under $1/month and needs no per-model retraining.

## Architecture

### Modular extraction seam — `nirmaan_stack/services/extraction/`

| File | Role |
|---|---|
| `base.py` | Contract: `extract(content, file_ext, settings, doc_kind) -> (text, entities)`; `doc_kind ∈ {"invoice","payment"}`; entity `{type, mention_text, normalized_text, confidence}`. The drop-in point for future providers. |
| `gemini.py` | `GeminiExtractor` — the only provider. Vertex/API-key client (cached), bounded retries on transient errors, `_safe_text` finish-reason guard, nullable/no-required schema, maps JSON → entities (placeholder `"null"`/`""`/omitted → absent). |
| `validation.py` | Deterministic verification: `validate_gstin` (mod-36 checksum), `reconcile_amounts`, `validate_date`. States VALID / INVALID / ABSENT. |
| `helpers.py` | Shared `pick_entity`, `get_file_doc_by_url`, `normalize_date/amount/utr` (de-duplicated from the two endpoints). |
| `files.py` | `fetch_file_content` (S3-aware), `SUPPORTED_EXTS`, `MIME_TYPES`, `get_extraction_settings()`, `get_gemini_api_key()`. |
| `__init__.py` | `extract(...)` dispatcher + provider registry (`{"gemini": GeminiExtractor}`). |

**The seam contract is the whole trick:** the extractor returns the same `(text, entities)` shape with the same entity `type` strings Document AI used, so the autofill endpoints, normalization, PO validation, persistence, and the 13-gate auto-approve are unchanged. Adding a provider later = one new module implementing `base.Extractor` + one registry entry.

### Endpoints (whitelisted, contract preserved)

- `api/invoice_autofill.extract_invoice_fields(file_url)` → `extract(..., doc_kind="invoice")`. Returns `invoice_no, invoice_date, amount, net_amount, supplier_gstin, receiver_gstin, confidence{}, entities[], min_confidence, processor_id (= gemini_model), validation{}`.
- `api/payment_autofill.extract_payment_fields(file_url)` → `extract(..., doc_kind="payment")`. Returns `utr, payment_date, transfer_amount, …`.

Five frontend dialogs consume these (InvoiceDialog, NewProjectInvoiceDialog, UpdatePaymentDialog, NewNonProjectExpense, NewInflowPayment) — unchanged by the swap.

### Trust is computed, not model-reported

A generative model self-reports ~100% confidence, so confidence isn't trusted. Present fields get `confidence = 1.0` (so the 0.70 gate populates them); absent fields are dropped → blank for manual entry. The **deterministic layer** decides real trust:

- **GSTIN** — 15-char format regex + **mod-36 checksum** (`_gstin_check_digit`).
- **Amount reconciliation** — `net + tax + round_off + other_charges + tcs ≈ total` within **₹5** (data-driven: worst real gap was ₹2.03). `round_off`/`other_charges`/`tcs_amount` are **validation-only** extracted fields (never populated into the form) so TCS/freight/round-off invoices still reconcile.
- **Date** — parseable + not future + not absurdly old.

Three states, never conflated: **VALID** / **INVALID** (a real problem) / **ABSENT** (nothing to check).

### Behavior

- **Autofill:** populate present fields; failed deterministic checks render as soft amber warnings (submit NOT blocked). The existing GSTIN-vs-vendor-master *mismatch* hard-block is preserved.
- **Auto-approve (`api/invoices/_auto_approve.py`):** **gate 5** was redefined from "model confidence ≥ 0.80" to "deterministic validity passes" (`_intrinsic_validation_reasons`): GSTIN checksums valid + amounts reconcile. **ABSENT (can't verify) counts as a fail → stays Pending** (strict). Gate 5 owns checksum + reconciliation; gates 6/7 own GSTIN cross-match; gate 11 owns future/unparseable date — no reason token is emitted by two gates. Stricter than before: an invoice that shows only a grand total (can't reconcile) stays Pending; most formal GST invoices itemize, so reconciliation usually applies.

## Configuration — `Document AI Settings` singleton (doctype name kept to avoid a rename migration)

| Field | Notes |
|---|---|
| `enabled` | master on/off |
| `provider` | `Gemini` (the future seam) |
| `gemini_model` | default `gemini-3.1-pro-preview` (a `-preview` id; will change at GA) |
| `gemini_thinking_level` | `low`/`medium`/`high` — Gemini 3.x param (NOT the legacy `thinking_budget`) |
| `gemini_media_resolution` | `low`/`medium`/`high` — `high` helps dense invoice tables |
| `gemini_auth_mode` | **`Vertex AI`** (default) or `API Key` |
| `gcp_project_id` / `gcp_location` | Vertex only; `gcp_location` default `asia-south1`. Credentials via **ADC** — **no secret in the DB** |
| `gemini_api_key` | API-Key mode only; encrypted `Password`; dev/test |

**Security:** the production Vertex+ADC path stores **zero secrets in the app DB**. Patch `v3_0.purge_document_ai_credentials` (registered) deleted the old DocAI `tabSingles` rows including the plaintext service-account key.

**Dependency:** `google-genai>=1.55,<1.56` — pinned because 1.56+ raises its google-auth floor to ≥2.48.1, conflicting with Frappe's `google-auth~=2.40.3`. 1.55.x supports the Gemini 3 APIs used (`thinking_level`, `media_resolution`, `vertexai`).

## Gemini call (gemini.py)

`client.models.generate_content(model, contents=[Part.from_bytes(data, mime), PROMPT], config=GenerateContentConfig(response_mime_type="application/json", response_schema=_schema(fields), temperature=0, thinking_config=ThinkingConfig(thinking_level=...), media_resolution=...))`.

Schema is **nullable, no `required`** — a required/non-nullable field makes controlled generation fabricate a value from training data when the field is unclear (defeats the anti-hallucination intent). Prompt instructs ISO dates and JSON `null` (not the string "null") for absent fields.

## What was removed (do not re-introduce)

- `services/document_ai.py` (+ its GCP imports, `extract_with_document_ai`, `resolve_processor_id`, service-account JSON field).
- `google-cloud-documentai` dependency.
- All Document-AI settings fields (processor IDs, location, target-doctype lists, service-account JSON).
- (Earlier) `services/file_extractor.py`, the `File Text Search Index` doctype, the `DocumentSearch` page, and the `File` doc_event — all already gone; the once-referenced `drop_file_text_search_index` patch **never existed**, do not look for it.

## Tests

`services/extraction/test_validation.py` — GSTIN checksum against real sample GSTINs (+ bad-checksum), reconciliation over real triples incl. a TCS case, date formats/future/absent, and the no-fabrication schema guard. Run: `env/bin/python -m unittest nirmaan_stack.services.extraction.test_validation`.

## Follow-up (not done)

Frontend display of the **new** deterministic soft-warnings (bad GSTIN checksum / non-reconciling amount) in the autofill dialogs. The backend already returns them in `validation.gstin_checksum` / `validation.amount_reconciliation`; the dialogs currently render the existing PO/GSTIN-match banners only. The core autofill works unchanged without this (fields populate as before).

## Key files

- `nirmaan_stack/services/extraction/` (package)
- `nirmaan_stack/api/invoice_autofill.py`, `nirmaan_stack/api/payment_autofill.py`
- `nirmaan_stack/api/invoices/_auto_approve.py` (gate 5)
- `nirmaan_stack/nirmaan_stack/doctype/document_ai_settings/`
- `nirmaan_stack/patches/v3_0/purge_document_ai_credentials.py`
