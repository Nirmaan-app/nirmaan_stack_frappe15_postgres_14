# Invoice Autofill (Document AI)

**Status:** Live as of 2026-04-30 on `meta-data` branch.
**Replaces:** Removed `DocumentSearch` global keyword search and the universal file auto-indexing pipeline.

## Why this exists

Indian construction invoices need 3 fields entered in the system every time: invoice number, invoice date, and total amount. Typing these from PDFs is slow and error-prone. A custom Document AI processor was trained on real invoice samples to extract these fields automatically; this feature wires that processor into the invoice creation flow.

The previous architecture OCR'd **every** uploaded file in the background (cost ~$0.05–0.10 per file) and stored full text in `File Text Search Index` for a global keyword-search page that was rarely used. That was deleted in favor of this targeted, opt-in flow.

## What was removed (do not re-introduce)

- `nirmaan_stack/services/file_extractor.py` — the auto-indexing pipeline
- `nirmaan_stack/nirmaan_stack/doctype/file_text_search_index/` — the search index doctype
- `frontend/src/pages/DocumentSearch/` — the global search UI
- `File` doc_events block from `hooks.py` (after_insert / on_update no longer trigger anything)
- Routes `/document-search` and `/document-search-test`
- Sidebar entries for Document Search (key, icon, group mapping, mobile menu set)

A migration patch exists at `nirmaan_stack/patches/v3_0/drop_file_text_search_index.py` to drop `tabFile Text Search Index`; it is **not registered in `patches.txt`** — apply manually with `frappe.reload_doc` + `bench --site localhost execute nirmaan_stack.patches.v3_0.drop_file_text_search_index.execute` if the orphan table needs cleanup.

## Architecture

### Backend

**Two files:**

| File | Purpose |
|------|---------|
| `nirmaan_stack/services/document_ai.py` | Reusable Google Document AI helpers — credentials, processor resolution, file fetch (S3-aware), entity extraction. No HTTP endpoints. |
| `nirmaan_stack/api/invoice_autofill.py` | Single whitelisted endpoint `extract_invoice_fields(file_url)`. Imports helpers from `services/document_ai.py`. |

**Key public functions in `services/document_ai.py`:**
- `get_document_ai_settings()` — reads `Document AI Settings` singleton, returns dict
- `get_document_ai_service_account_json()` — pulls service-account creds string
- `resolve_processor_id(settings, attached_to_doctype)` — routes to invoice/expense/default processor based on doctype
- `fetch_file_content(file_doc, file_name=None)` — handles S3 presigned URLs and local files
- `extract_with_document_ai(content, file_ext, settings, processor_id)` — calls GCP, returns `(text, [entities])`

**Endpoint contract** (`extract_invoice_fields(file_url)`):

```python
# Returns:
{
  "invoice_no": "INV-2026-04-001",      # "" if confidence < 0.70
  "invoice_date": "2026-04-15",         # normalized YYYY-MM-DD; "" if low confidence
  "amount": "125000.0",                 # cleaned numeric string; "" if low confidence
  "confidence": {
    "invoice_no": 0.97,
    "invoice_date": 0.94,
    "amount": 0.83
  },
  "min_confidence": 0.70,
  "processor_id": "398ed5af98c95e0c"
}
```

**Confidence threshold:** Hard-coded `MIN_CONFIDENCE = 0.70` in `api/invoice_autofill.py`. Below threshold → field returned as empty string. To make tunable later, add `minimum_autofill_confidence` field to `Document AI Settings` doctype.

**Entity-name mapping** (lines 13-15 of `api/invoice_autofill.py`):
```python
INVOICE_NO_KEYS   = ("invoice_id", "invoice_number", "invoice_no")
INVOICE_DATE_KEYS = ("invoice_date",)
AMOUNT_KEYS       = ("total_amount", "net_amount", "amount_due", "amount")
```
If V1-base or future processors return different entity type names, expand these tuples.

**Date normalization** tries 8 formats (`api/invoice_autofill.py::_normalize_date`). Falls back to raw string if none match.

**Amount normalization** strips commas, `₹`, `Rs.`, `INR` → casts to float string. Falls back to raw if not parseable.

**Routing logic:** `extract_invoice_fields` always calls `resolve_processor_id(settings, "Vendor Invoices")` — i.e., it always asks for the *invoice* processor. This means `Vendor Invoices` MUST be in `invoice_target_doctypes` in settings (or the doctype name's "invoice" substring will trigger the same fallback).

### Frontend

**One file modified:** `frontend/src/pages/ProcurementOrders/invoices-and-dcs/components/InvoiceDialog.tsx`

**Mode picker as the entry screen** — when user clicks "Add Invoice", the dialog opens to a card-based selector:
- ✨ **Auto-fill** — upload file, AI extracts the 3 fields
- 📄 **Manual entry** — type fields by hand

In edit mode, the picker is skipped (mode forced to "manual").

**Key state** (lives only while dialog is open):
```typescript
const [mode, setMode] = useState<"select" | "autofill" | "manual">("select");
const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
const [invoiceData, setInvoiceData] = useState({ invoice_no: "", date: "", amount: "" });
const [isAutofilling, setIsAutofilling] = useState(false);
const [autofilledFields, setAutofilledFields] = useState<Set<...>>(new Set());
const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
```

**Trigger:** In autofill mode, picking a file calls `handleAttachmentSelect → runAutofillExtraction` automatically. There is **no separate Auto-fill button** (removed by user request). Re-extract by picking the same file again.

**Upload reuse:** `runAutofillExtraction` uploads the file once and stores the resulting `file_url` in `uploadedFileUrl`. The submit path (`uploadInvoice`) checks this state and reuses the URL — avoids double upload.

**Visual cue:** AI-filled inputs render with `bg-amber-50 border-amber-300` (yellow tint). Editing the input clears the autofill flag for that field via `clearAutofillFlag(field)` called from each `onChange`.

**Loading UX:** `disabled={isLoading || isAutofilling}` is applied to all inputs and the file picker so the user can't edit during the 2–6s extraction.

**No persistence:** The extracted JSON is **never stored**. It feeds React state, the user reviews/edits, then submits. Only the user-confirmed values land in the `Vendor Invoices` doctype.

## Configuration

**Document AI Settings singleton** must have:

| Field | Required value |
|---|---|
| `Enable Document AI` | ✓ checked |
| `Project ID` | `260249096269` (matches `nirmaan-stack` GCP project) |
| `Location` | `asia-south1` ⚠️ (custom processor lives here, not `asia-southeast1`) |
| `Invoice Processor ID` | `398ed5af98c95e0c` (V1-base custom-trained) |
| `Default Processor ID` | Same as invoice (autofill only uses invoice path) |
| `Expense Processor ID` | Optional — autofill doesn't use it |
| `Invoice Target DocTypes` | `Project Invoices, Vendor Invoices` (comma-separated) |
| `Service Account JSON` | GCP service-account key with Document AI permissions |

**Single-region constraint:** `Document AI Settings` has only one `Location` field. All processor IDs must be in the same region. Older processors in `us` are not usable without per-processor location fields (not implemented; would need 3 new fields + code update).

## V1-base model background

- **Processor**: `Nirmaan Indian Invoice Extractor` (custom Document Extractor)
- **Region**: `asia-south1`
- **Processor ID**: `398ed5af98c95e0c`
- **Version ID**: `3b2df2b9f7b07a53` (V1-base)
- **Trained on**: 36 training / 16 test invoices
- **Aggregate F1**: 0.863 (precision 95.7%, recall 78.6%)
- **Per-label F1** (key fields):
  - `invoice_id`: 1.000 ⭐
  - `purchase_order`: 0.963
  - `receiver_gstin`: 0.933
  - `invoice_date`: 0.903
  - `supplier_gstin`: 0.897
  - `total_amount`: 0.828
  - `net_amount`: 0.759 ⚠️
  - `total_tax_amount`: 0.750 ⚠️
  - `supplier_name`: 0.667 ⚠️ (worst — labeling consistency issue)

For **autofill we only use 3 labels** (invoice_id, invoice_date, total_amount). Other extracted entities (gstin, supplier_name, etc.) are returned by the model but currently dropped by the endpoint.

## Future work (NOT implemented)

These have been discussed but deliberately not built:

1. **Persist autofill metadata** — proposed: 3 fields on `Vendor Invoices` (`autofill_used` Check, `autofill_confidence_json` Long Text, `autofill_processor_id` Data) for adoption tracking and per-invoice diagnostics. Keep this in mind for V2.
2. **Extend autofill to other doctypes** — currently locked to PO/SR Invoice Dialog. Logical next targets: Project Invoices, Vendor Invoices list, Non Project Expenses. Would need:
   - Generalize `extract_invoice_fields` to accept `target_doctype` param + return generic field-map
   - Build reusable `<AutofillUploadField/>` component
3. **Re-extract button** — was added then removed by user request. Users re-trigger extraction by re-picking the file.
4. **Per-processor location** — needed if multiple processors in different regions become required.
5. **Caching by content_hash** — skipped because re-uploads are rare.
6. **`supplier_name` autofill** — F1 too low (0.667). Re-train with consistent labeling first.

## How it works end-to-end (verbal trace)

1. User opens a Purchase Order → clicks **Add Invoice**
2. Dialog opens with mode picker (two cards)
3. User clicks **Auto-fill**
4. Dialog switches to form view with empty fields, attachment picker, "← Choose another method" link, "✨ Auto-fill mode" badge
5. User picks `tata-invoice-xyz.pdf` in the attachment picker
6. `handleAttachmentSelect(file)` runs → since mode is "autofill", calls `runAutofillExtraction(file)`
7. Frontend uploads file via `useFrappeFileUpload` → Frappe creates File record → returns `file_url`
8. Frontend caches `file_url` in `uploadedFileUrl` state (avoids re-upload at submit)
9. Frontend calls `POST /api/method/nirmaan_stack.api.invoice_autofill.extract_invoice_fields` with `{file_url}`
10. Backend looks up File record by URL → fetches content (local or S3) → loads Document AI Settings
11. Backend resolves processor: `resolve_processor_id(settings, "Vendor Invoices")` → returns `invoice_processor_id` (V1-base)
12. Backend calls Google Document AI in `asia-south1` with file bytes + invoice MIME type
13. Document AI returns text + entities array (each has type, confidence, normalized value)
14. Backend picks best-confidence entity for each of the 3 target labels
15. Backend applies confidence ≥ 0.70 filter; below threshold → empty string
16. Backend normalizes date (multiple formats) and amount (strips currency)
17. Backend returns JSON to frontend
18. Frontend updates `invoiceData` state and adds prefilled fields to `autofilledFields` Set
19. Yellow tint appears on prefilled inputs; toast shows "Auto-filled from invoice — N field(s) extracted"
20. User reviews values, edits anything wrong (editing a yellow field clears its tint)
21. User clicks **Add Invoice** → `submitInvoice` runs
22. Submit reuses `uploadedFileUrl` (no re-upload) → calls `update_invoice_data` API → creates Vendor Invoice
23. Dialog closes; extraction response disappears from memory; only saved values remain in DB

## Verification checklist

End-to-end smoke test on this branch:

1. ☐ `Document AI Settings` has Location=`asia-south1`, Invoice Processor ID=`398ed5af98c95e0c`
2. ☐ Open any approved PO → click Add Invoice → mode picker appears
3. ☐ Click Manual → form loads with no AI elements; submit works as before
4. ☐ Click ← back link → returns to mode picker
5. ☐ Click Auto-fill → form loads with "✨ Auto-fill mode" badge
6. ☐ Pick a real invoice PDF → spinner with "Reading invoice with Document AI…" appears
7. ☐ After 2–6s, fields populate in amber; toast appears
8. ☐ Edit one yellow field manually → its yellow tint clears
9. ☐ Submit → Vendor Invoice created with values from form
10. ☐ Open another upload point (e.g., add file to PR attachments) → confirm NO Document AI call (check GCP logs / billing)

## Key file references

- Backend: [`nirmaan_stack/api/invoice_autofill.py`](../../../nirmaan_stack/api/invoice_autofill.py)
- Backend helpers: [`nirmaan_stack/services/document_ai.py`](../../../nirmaan_stack/services/document_ai.py)
- Frontend dialog: [`frontend/src/pages/ProcurementOrders/invoices-and-dcs/components/InvoiceDialog.tsx`](../../../frontend/src/pages/ProcurementOrders/invoices-and-dcs/components/InvoiceDialog.tsx)
- Settings doctype: [`nirmaan_stack/nirmaan_stack/doctype/document_ai_settings/`](../../../nirmaan_stack/nirmaan_stack/doctype/document_ai_settings/)
- Cleanup patch (unregistered): [`nirmaan_stack/patches/v3_0/drop_file_text_search_index.py`](../../../nirmaan_stack/patches/v3_0/drop_file_text_search_index.py)
