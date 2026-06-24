# Customer PO Autofill (Gemini)

**Status:** Added 2026-06. Reuses the existing Gemini extraction seam
(`services/extraction/`). **Additive only — the invoice and payment autofill
flows are untouched.**

## What it does

In the **Add Customer PO** dialog (`AddCustomerPODialog.tsx`), when the user
chooses the *Attachment* option and picks a PO file (PDF/image), the app uploads
it, reads it with Gemini, and pre-fills three fields for the user to verify:

- `customer_po_number`
- `customer_po_value_inctax`  (Currency)
- `customer_po_value_exctax`  (Currency)

These map **1:1** to the `Customer PO Child Table` doctype fields (no rename
layer). This is the *simple* autofill variant — like payment receipts, NOT like
invoices: **no GSTIN checks, no amount reconciliation, no auto-approve.** Nothing
extracted is persisted server-side; only the user-confirmed form values are saved
on submit.

## Attachment-first + project-match (2026-06 iteration)

- **Attachment-first layout.** `linkOrAttachmentChoice` defaults to `'attachment'`
  and the **PO Source selector + attachment uploader are rendered FIRST** in the
  form (above PO Number / Date / Values), so uploading the PO is the lead action
  and autofill populates the fields below. If autofill fails (or AI is disabled),
  those fields stay fully editable — fail-open, manual entry as before.
- **Soft project-mismatch warning.** The dialog passes its `projectName` (the
  Projects **docname**) to `extract_customer_po_fields(file_url, project_name)`.
  The backend extracts a non-form field `project_reference` (the project/site/work
  name printed on the PO), resolves the project's display name
  (`Projects.project_name`), and fuzzy-compares them. Result rides back in
  `validation.project_match = {expected, extracted, match}`:
  - `match === false` → an amber "This PO may be for a different project" banner
    in the attachment block. **Non-blocking** — the user can still save.
  - `match === null` ("can't verify": either side empty / only stopwords) → no
    banner. A missing reference is never reported as a confirmed mismatch.
  - The fuzzy match (`_names_match`) is deliberately **lenient** (equal / substring
    / any shared meaningful token after stopword strip ⇒ match) so it only warns on
    a clearly different project, avoiding false alarms on a soft, non-blocking check.
- **Payment-terms extraction.** The customer-PO schema also pulls a `payment_terms`
  **list** of `{label, percentage, description}` — the only non-flat extraction field
  in any flow. `gemini._customer_po_schema()` adds the array; `gemini._to_entities`
  serializes the list to a JSON-string entity so the flat `(text, entities)` contract
  stays intact (invoice/payment untouched); the endpoint parses it back via
  `_parse_payment_terms` and returns `payment_terms`. The dialog maps each row into the
  structured **Payment Terms** section, which the **existing** submit already serializes
  into `customer_po_payment_terms` (JSON) — so no extra storage wiring. `expected_date`
  is left blank (POs state relative milestones, not fixed dates).

## Flow

```
USER picks PO file (Attachment option)
   └─ handleAttachmentSelect(file)              [AddCustomerPODialog.tsx]
        ├─ uploadCustomerPOAttachment(project, file)   → File record (private), file_url
        │     (file_url stashed in `uploadedFileUrl`, reused on submit — no double upload)
        ├─ POST extract_customer_po_fields({ file_url })   [api/customer_po_autofill.py]
        │     └─ extract(content, ext, settings, doc_kind="customer_po")  [gemini.py]
        │           → schema {customer_po_number, customer_po_value_inctax, customer_po_value_exctax}
        │             all nullable/no-required (anti-hallucination) + _CUSTOMER_PO_PROMPT
        ├─ confidence ≥ 0.70 → normalize_amount() the two values
        └─ setFormData(...) + amber-tint the filled fields + sparkle banner
   ▼
USER reviews (amber fields) → edits clear the tint → Confirm → existing createCustomerPO
```

Fail-open: if Document AI Settings is disabled, the file is unreadable, or
extraction errors, a toast says "enter manually" and the form stays usable —
exactly like the invoice/payment dialogs.

## Stored provenance (full invoice-style, audit-only — 2026-06)

Unlike the payment flow, the Customer PO row now **persists the AI provenance**
for audit (mirroring Vendor Invoices, but with **no auto-approve consumer** — it's
read-only audit data). Added to the **Customer PO Child Table** doctype (all
`read_only`, in an `autofill_section`); columns created via `bench migrate`:

| Field | Holds |
|---|---|
| `autofill_used` (Check) | 1 when the row was AI-filled from the attachment |
| `autofill_processor_id` | the `gemini_model` used |
| `autofill_extracted_po_number` / `_value_inctax` / `_value_exctax` | what the AI originally read (pre-edit snapshot) |
| `autofill_extracted_project_reference` | the project name read off the PO |
| `autofill_project_match` | `matched` / `mismatch` / `unverified` (from the soft check) |
| `autofill_confidence_json` | per-field confidence blob |
| `autofill_all_entities_json` | the full raw extraction (every entity) |

**Write path:** `AddCustomerPODialog` stashes this in `autofillMeta` on autofill
and spreads it into `newPODetail` on submit; `add_customer_po_with_validation`
does `project_doc.append("customer_po_details", new_po_detail)`, so the keys land
on the row with **no backend endpoint change**. Provenance is written ONLY when the
PO was AI-filled from an attachment (`linkOrAttachmentChoice === 'attachment' &&
autofillMeta`); a link-only or manual PO stores nothing. Edits
(`update_customer_po_with_validation`) don't re-send these keys, so a later edit
**preserves** the original provenance (Frappe `update()` only sets provided keys).

## Files

| File | Change |
|---|---|
| `services/extraction/base.py` | + `CUSTOMER_PO = "customer_po"` constant (additive) |
| `services/extraction/gemini.py` | + `_CUSTOMER_PO_FIELDS`, `_CUSTOMER_PO_PROMPT`; + two names in `_NUMERIC`; dispatch gained a `customer_po` branch ABOVE the unchanged invoice/payment branch |
| `api/customer_po_autofill.py` | NEW endpoint `extract_customer_po_fields(file_url)` (near-copy of `payment_autofill.py`, no parent-doc validation) |
| `frontend/.../projects/components/AddCustomerPODialog.tsx` | upload+extract on attachment select, reuse `file_url` on submit, amber tint + "Reading…" + sparkle banner |

**Isolation guarantee:** the gemini dispatch keeps the original invoice/payment
lines byte-for-byte (now nested under `else:`); the new `_NUMERIC` entries only
affect the `customer_po` schema. No invoice/payment code path changed behavior.

## Configuration

Same `Document AI Settings` singleton as the other flows (Vertex AI + ADC, no
secret in the DB). No new settings. See `invoice-autofill.md` for the full
config table and the "no training — prompt + schema" engine reference.

## Extend / parity notes

- Field names match the child table, so the response keys ARE the form keys.
- Only the **Add** dialog is wired. `EditCustomerPODialog.tsx` is intentionally
  left manual (an existing PO already has its values) — a later slice could add
  it the same way if needed.
- Adding another extractable PO field = add it to `_CUSTOMER_PO_FIELDS` + one
  prompt line + one `pick_entity` in the endpoint + one `setFormData` line.

## Key files

- `nirmaan_stack/api/customer_po_autofill.py`
- `nirmaan_stack/services/extraction/gemini.py` (`_CUSTOMER_PO_*`, dispatch branch)
- `nirmaan_stack/services/extraction/base.py` (`CUSTOMER_PO`)
- `frontend/src/pages/projects/components/AddCustomerPODialog.tsx`
- `nirmaan_stack/nirmaan_stack/doctype/customer_po_child_table/` (the target fields)
