/**
 * Add Invoice Dialog
 *
 * Enterprise-styled dialog for adding vendor invoices with duplicate validation.
 *
 * Validation Flow:
 * 1. On invoice_no input (debounced): Check for duplicates via API
 * 2. If duplicate in SAME PO/SR: Block submission with error
 * 3. If duplicate in OTHER PO/SR (same vendor): Show warning, allow override
 */

import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import {
  useFrappeFileUpload,
  useFrappeGetDoc,
  useFrappePostCall,
  useSWRConfig,
} from "frappe-react-sdk";
import SITEURL from "@/constants/siteURL";
import { useCallback, useState, useEffect, useRef, useMemo } from "react";
import { TailSpin } from "react-loader-spinner";
import { KeyedMutator } from "swr";
import {
  FileText,
  Calendar,
  IndianRupee,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LineItemMappingReview, LineMatch } from "./LineItemMappingReview";

type DocumentType = ProcurementOrder | ServiceRequests;

interface InvoiceDialogProps<T extends DocumentType> {
  docType: "Procurement Orders" | "Service Requests";
  docName: string | undefined;
  docMutate: KeyedMutator<T[]>;
  vendor?: string;
}

interface DuplicateCheckResult {
  exists_in_current_doc: boolean;
  exists_in_other_doc: boolean;
  other_doc_name: string | null;
  other_doc_type: string | null;
}

const initialInvoiceState = {
  invoice_no: "",
  amount: "",
  date: "",
  is_credit_note: false,
};

// --- Credit / return note sign helpers ---
// Force an amount string negative (credit / return note). "" / non-numeric → unchanged.
const forceNegativeAmount = (amt: string): string => {
  const n = Number(String(amt).replace(/,/g, ""));
  if (!amt || !isFinite(n) || n === 0) return amt;
  return String(-Math.abs(n));
};

// Apply a sign to every row's quantity — negative for a return note, positive otherwise.
const applyQtySign = <T extends { quantity?: any }>(
  rows: T[] | null,
  negative: boolean
): T[] | null => {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => {
    const q = Number(r?.quantity);
    if (!isFinite(q) || q === 0) return r;
    return { ...r, quantity: negative ? -Math.abs(q) : Math.abs(q) };
  });
};

// Apply the sign to a lineMatch object's mappings[].quantity.
const applyMatchQtySign = (lm: any, negative: boolean): any => {
  if (!lm || !Array.isArray(lm.mappings)) return lm;
  return { ...lm, mappings: applyQtySign(lm.mappings, negative) };
};

export function InvoiceDialog<T extends DocumentType>({
  docType,
  docName,
  docMutate,
  vendor,
}: InvoiceDialogProps<T>) {
  const { 
    toggleNewInvoiceDialog, newInvoiceDialog,
    toggleEditInvoiceDialog, editInvoiceDialog,
    selectedInvoice, setSelectedInvoice
  } = useDialogStore();
  const { mutate: globalMutate } = useSWRConfig();
  const userData = useUserData();

  const isEditMode = !!selectedInvoice;
  const isOpen = newInvoiceDialog || editInvoiceDialog;
  const toggleDialog = isEditMode ? toggleEditInvoiceDialog : toggleNewInvoiceDialog;

  // Form state
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(
    null
  );
  const [invoiceData, setInvoiceData] = useState(initialInvoiceState);

  // Duplicate validation state
  const [duplicateCheckResult, setDuplicateCheckResult] =
    useState<DuplicateCheckResult | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [showDuplicateConfirmDialog, setShowDuplicateConfirmDialog] =
    useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Autofill state
  const [stage, setStage] = useState<"upload" | "review" | "form">("upload");
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [autofilledFields, setAutofilledFields] = useState<Set<"invoice_no" | "date" | "amount">>(new Set());
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [autofillConfidence, setAutofillConfidence] = useState<Record<string, number> | null>(null);
  const [autofillExtractedValues, setAutofillExtractedValues] = useState<{
    invoice_no?: string;
    invoice_date?: string;
    amount?: string;
    supplier_gstin?: string;
    receiver_gstin?: string;
  } | null>(null);
  const [autofillAllEntities, setAutofillAllEntities] = useState<
    Array<{ type: string; value: string; confidence: number }> | null
  >(null);
  const [autofillValidation, setAutofillValidation] = useState<{
    applicable: boolean;
    amount?: {
      po_total: number;
      existing_invoiced_sum: number;
      new_amount: number;
      would_be_total: number;
      would_exceed: boolean;
      message: string | null;
    } | null;
    supplier_gstin?: { extracted: string; expected: string; match: boolean | null; message: string | null } | null;
    receiver_gstin?: { extracted: string; expected: string; match: boolean | null; message: string | null } | null;
  } | null>(null);
  // Line-item extraction + PO mapping (PO invoices with a line-item table only).
  const [lineItems, setLineItems] = useState<any[] | null>(null);
  const [poItemsForMatch, setPoItemsForMatch] = useState<any[] | null>(null);
  const [lineMatch, setLineMatch] = useState<LineMatch | null>(null);
  // Gemini classified the uploaded document as a credit note / credit memo.
  // Drives the sign: amount → negative always; quantities → negative only when the
  // user leaves "Credit Note" UNticked (a return note that reduces invoiced qty).
  const [creditNoteDetected, setCreditNoteDetected] = useState(false);
  const [rawExtraction, setRawExtraction] = useState<any | null>(null);

  // API hooks
  const { call: updateInvoiceApiCall, loading: updateInvoiceApiCallLoading } =
    useFrappePostCall(
      "nirmaan_stack.api.delivery_notes.update_invoice_data.update_invoice_data"
    );
  const { call: checkDuplicateApi } = useFrappePostCall(
    "nirmaan_stack.api.invoices.check_duplicate_invoice.check_duplicate_invoice"
  );
  const { call: extractInvoiceFieldsApi } = useFrappePostCall(
    "nirmaan_stack.api.invoice_autofill.extract_invoice_fields"
  );
  const { upload, loading: uploadLoading } = useFrappeFileUpload();

  // Fetch attachment details if in edit mode
  const { data: attachmentDoc } = useFrappeGetDoc(
    "Nirmaan Attachments",
    selectedInvoice?.invoice_attachment,
    isEditMode && selectedInvoice?.invoice_attachment ? `Nirmaan-Attachment-${selectedInvoice.invoice_attachment}` : null
  );

  // Editing a Pending invoice, you can REPLACE the file to re-run autofill and
  // pull the exact values again (fields + line-item mapping) — all in this one
  // dialog, no separate review step. A Pending PO invoice additionally gets its
  // line → PO-item mapping rebuilt from the fresh extraction on save.
  const canReExtract = isEditMode && selectedInvoice?.status === "Pending";
  const canEditMapping = canReExtract && docType === "Procurement Orders";
  // True once a replaced file has actually been re-extracted (drives rebuild).
  const [reExtracted, setReExtracted] = useState(false);

  // Load the invoice's existing auto-fill snapshot (line mapping + extracted
  // entities) + PO items, so a Pending PO invoice's prior extraction is shown
  // inline and editable. The fresh re-extraction (file replace) takes over.
  const { data: savedInvoiceDoc } = useFrappeGetDoc<{
    autofill_line_match_json?: string;
    autofill_all_entities_json?: string;
  }>(
    "Vendor Invoices",
    selectedInvoice?.name,
    canEditMapping && selectedInvoice?.name ? `Invoice-Edit-Snapshot-${selectedInvoice.name}` : null
  );

  const { data: poDocForEdit } = useFrappeGetDoc<{ items?: any[] }>(
    "Procurement Orders",
    docName,
    canEditMapping ? `Invoice-Edit-PO-${docName}` : null
  );

  // Reset form when dialog closes or Populate when editing
  useEffect(() => {
    if (isOpen) {
      if (selectedInvoice) {
        setInvoiceData({
          invoice_no: selectedInvoice.invoice_no || "",
          amount: String(selectedInvoice.invoice_amount || ""),
          date: selectedInvoice.invoice_date || "",
          is_credit_note: !!selectedInvoice.is_credit_note,
        });
        // Edit mode skips the upload-first stage.
        setStage("form");
      } else {
        setInvoiceData(initialInvoiceState);
        setStage("upload");
      }
      setSelectedAttachment(null);
      setDuplicateCheckResult(null);
      setIsCheckingDuplicate(false);
      setAutofilledFields(new Set());
      setUploadedFileUrl(null);
      setAutofillConfidence(null);
      setAutofillExtractedValues(null);
      setAutofillAllEntities(null);
      setAutofillValidation(null);
      setLineItems(null);
      setPoItemsForMatch(null);
      setLineMatch(null);
      setRawExtraction(null);
      setReExtracted(false);
      setCreditNoteDetected(false);
    }
  }, [isOpen, selectedInvoice]);

  // Reset autofill state when user picks a different file
  useEffect(() => {
    setAutofilledFields(new Set());
    setUploadedFileUrl(null);
    setAutofillConfidence(null);
    setAutofillExtractedValues(null);
    setAutofillAllEntities(null);
    setAutofillValidation(null);
    setLineItems(null);
    setPoItemsForMatch(null);
    setLineMatch(null);
    setRawExtraction(null);
    setReExtracted(false);
    setCreditNoteDetected(false);
  }, [selectedAttachment]);

  // Edit mode: show the invoice's existing auto-filled mapping + entities inline
  // (pre-populated) once the snapshot + PO items load. Once the file is
  // re-extracted, the fresh data wins — don't overwrite it here.
  useEffect(() => {
    if (!canEditMapping || reExtracted) return;
    const raw = savedInvoiceDoc?.autofill_line_match_json;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as LineMatch;
      if (!parsed || !Array.isArray(parsed.mappings)) return;
      setLineMatch(parsed);
      setPoItemsForMatch(
        (poDocForEdit?.items || []).map((it: any) => ({
          item_id: it.item_id,
          item_name: it.item_name,
          unit: it.unit,
          quantity: it.quantity,
          received_quantity: it.received_quantity,
          quote: it.quote,
          amount: it.amount,
        }))
      );
      let entities: any[] = [];
      try {
        const e = savedInvoiceDoc?.autofill_all_entities_json
          ? JSON.parse(savedInvoiceDoc.autofill_all_entities_json)
          : [];
        if (Array.isArray(e)) entities = e;
      } catch { /* ignore malformed entities snapshot */ }
      setRawExtraction({ entities });
    } catch { /* ignore malformed mapping snapshot */ }
  }, [canEditMapping, reExtracted, savedInvoiceDoc?.autofill_line_match_json, savedInvoiceDoc?.autofill_all_entities_json, poDocForEdit]);

  // Handle closing manually to clear selectedInvoice
  const handleClose = useCallback(() => {
    if (isEditMode) {
      setSelectedInvoice(null);
    }
    toggleDialog();
  }, [isEditMode, setSelectedInvoice, toggleDialog]);

  // Debounced duplicate check on invoice_no change
  useEffect(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const trimmedInvoiceNo = invoiceData.invoice_no.trim();

    // Skip duplicate check if in Edit mode and invoice number hasn't changed
    if (isEditMode && trimmedInvoiceNo === selectedInvoice?.invoice_no) {
      setDuplicateCheckResult(null);
      setIsCheckingDuplicate(false);
      return;
    }

    // Only check if we have at least 3 characters
    if (trimmedInvoiceNo.length < 3) {
      setDuplicateCheckResult(null);
      setIsCheckingDuplicate(false);
      return;
    }

    setIsCheckingDuplicate(true);

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const response = await checkDuplicateApi({
          invoice_no: trimmedInvoiceNo,
          document_type: docType,
          document_name: docName,
          vendor: vendor,
        });

        if (response.message) {
          setDuplicateCheckResult(response.message as DuplicateCheckResult);
        }
      } catch (error) {
        console.error("Error checking duplicate:", error);
        setDuplicateCheckResult(null);
      } finally {
        setIsCheckingDuplicate(false);
      }
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [invoiceData.invoice_no, docType, docName, vendor, checkDuplicateApi, isEditMode, selectedInvoice]);

  const uploadInvoice = useCallback(async () => {
    if (!selectedAttachment || !docName || !docType) return null;

    // Reuse the URL from autofill upload if available — avoids double upload.
    if (uploadedFileUrl) return uploadedFileUrl;

    try {
      const result = await upload(selectedAttachment, {
        doctype: docType,
        docname: docName,
        fieldname: "attachment",
        isPrivate: true,
      });
      setUploadedFileUrl(result.file_url);
      return result.file_url;
    } catch (error) {
      toast({
        title: "Upload Failed",
        description: `Failed to upload Invoice attachment: ${
          error instanceof Error ? error.message : String(error)
        }`,
        variant: "destructive",
      });
      throw error;
    }
  }, [selectedAttachment, docType, docName, upload, uploadedFileUrl]);

  const runAutofillExtraction = useCallback(async (file: File) => {
    if (!docName || !docType) return;
    setIsAutofilling(true);
    try {
      const uploaded = await upload(file, {
        doctype: docType,
        docname: docName,
        fieldname: "attachment",
        isPrivate: true,
      });
      const fileUrl = uploaded.file_url;
      setUploadedFileUrl(fileUrl);

      const response = await extractInvoiceFieldsApi({
        file_url: fileUrl,
        // PO invoices get line-item extraction + PO mapping; SR invoices don't.
        docname: docType === "Procurement Orders" ? docName : undefined,
      });
      const extracted = response?.message;
      if (!extracted) {
        toast({
          title: "Auto-fill returned nothing",
          description: "AI could not extract any fields. Please fill in manually.",
          variant: "default",
        });
        setStage("form");
        return;
      }

      // Compute updates synchronously so `filled.size` reflects the actual count
      // when we decide which toast to show. Previously this logic ran inside a
      // `setInvoiceData(updater)` callback which executes asynchronously during
      // React reconciliation — so the toast check always saw an empty Set.
      const filled = new Set<"invoice_no" | "date" | "amount">();
      const updates: Partial<typeof initialInvoiceState> = {};

      if (extracted.invoice_no) {
        updates.invoice_no = extracted.invoice_no;
        filled.add("invoice_no");
      }
      if (extracted.invoice_date) {
        updates.date = extracted.invoice_date;
        filled.add("date");
      }
      if (extracted.amount) {
        updates.amount = extracted.amount;
        filled.add("amount");
      }

      // Credit-note handling: if Gemini classified the file as a credit note, the
      // AMOUNT goes negative (always). Quantities are signed further below based on
      // the "Credit Note" checkbox (unticked = return note = negative qty).
      const creditNote = !!extracted.credit_note_detected;
      setCreditNoteDetected(creditNote);
      if (creditNote && updates.amount) {
        updates.amount = forceNegativeAmount(updates.amount);
      }

      setInvoiceData((prev) => ({ ...prev, ...updates }));
      setAutofilledFields(filled);
      if (extracted.confidence && typeof extracted.confidence === "object") {
        setAutofillConfidence(extracted.confidence);
      }
      // Capture original AI-extracted values so we can persist them on submit
      // independently of any manual edits the user makes before submitting.
      // Supplier + receiver GSTINs feed the auto-approve gates on the backend
      // (compared to Vendors.vendor_gst and PO.project_gst respectively).
      setAutofillExtractedValues({
        invoice_no: extracted.invoice_no || "",
        invoice_date: extracted.invoice_date || "",
        amount: extracted.amount || "",
        supplier_gstin: extracted.supplier_gstin || "",
        receiver_gstin: extracted.receiver_gstin || "",
      });
      // Capture the FULL entity list so reviewers can later inspect everything
      // Document AI returned (supplier_name, supplier_gstin, total_tax_amount,
      // purchase_order, etc.) from the recon page hover card.
      if (Array.isArray(extracted.entities)) {
        setAutofillAllEntities(extracted.entities);
      }
      // Capture validation results (amount overage, GSTIN matches) so the form
      // can render warnings and block submit on hard violations.
      if (extracted.validation) {
        setAutofillValidation(extracted.validation);
      }

      // Capture line items + the PO mapping (PO invoices only). When present we
      // route through a dedicated Review step so the user can verify/correct the
      // mapping before the final form.
      setRawExtraction(extracted);
      // A return note (Gemini says credit note AND user has NOT ticked "Credit Note")
      // reduces invoiced qty → store its line quantities negative. A ticked credit note
      // keeps qty positive (it is excluded from invoice_qty entirely).
      const qtyNegative = creditNote && !invoiceData.is_credit_note;
      const hasLineItems = Array.isArray(extracted.line_items) && extracted.line_items.length > 0;
      if (hasLineItems) setLineItems(applyQtySign(extracted.line_items, qtyNegative));
      if (Array.isArray(extracted.po_items)) setPoItemsForMatch(extracted.po_items);
      const hasMapping = !!extracted.line_match && Array.isArray(extracted.line_match.mappings);
      if (hasMapping) setLineMatch(applyMatchQtySign(extracted.line_match, qtyNegative));

      if (filled.size === 0) {
        toast({
          title: "No high-confidence fields found",
          description: "AI did not return values above the confidence threshold. Please fill in manually.",
          variant: "default",
        });
      } else {
        toast({
          title: "Auto-filled from invoice",
          description: `${filled.size} field(s) extracted. Please review before submitting.`,
          variant: "success",
        });
      }
      // EDIT never steps through the review screen — the fresh extraction
      // (fields + mapping) is applied inline and we stay on the form. CREATE
      // still routes a PO mapping through the Review step to verify it.
      if (isEditMode) setReExtracted(true);
      setStage(!isEditMode && hasMapping ? "review" : "form");
    } catch (error) {
      console.error("Auto-fill error:", error);
      toast({
        title: "Auto-fill Failed",
        description:
          error instanceof Error
            ? `${error.message} You can fill in the details manually.`
            : "Could not extract fields from invoice. Please fill in manually.",
        variant: "destructive",
      });
      setStage("form");
    } finally {
      setIsAutofilling(false);
    }
  }, [docName, docType, upload, extractInvoiceFieldsApi, isEditMode]);

  const handleAttachmentSelect = useCallback((file: File | null) => {
    setSelectedAttachment(file);
    // Create, OR replacing the file while editing a Pending invoice → re-run
    // autofill so the exact values (fields + mapping) come back.
    if (file && (!isEditMode || canReExtract)) {
      runAutofillExtraction(file);
    }
  }, [isEditMode, canReExtract, runAutofillExtraction]);

  const clearAutofillFlag = useCallback((field: "invoice_no" | "date" | "amount") => {
    setAutofilledFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }, []);

  const submitInvoice = useCallback(async () => {
    if (!docName) {
      toast({
        title: "Error",
        description: "Document name is missing.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Upload attachment if selected
      let attachmentUrl: string | null = null;
      if (selectedAttachment) {
        attachmentUrl = await uploadInvoice();
      }

      // Prepare API payload
      const invoicePayloadForApi = {
        invoice_no: invoiceData.invoice_no.trim(),
        amount: parseNumber(invoiceData.amount),
        date: invoiceData.date,
        is_credit_note: invoiceData.is_credit_note ? 1 : 0,
        updated_by: userData?.user_id,
      };

      // Only mark as autofilled if at least one field was AI-extracted
      // and we're creating a new invoice (not editing).
      const autofillUsed = !isEditMode && autofilledFields.size > 0;
      // Edit-mode mapping rebuild: a Pending PO invoice with a mapping shown
      // inline (loaded from the snapshot, re-extracted, or edited). Rebuilding
      // from an unchanged mapping is a no-op. Backend re-guards on status.
      const rebuildMappings = canEditMapping && !!lineMatch;

      const apiPayload = {
        docname: docName,
        invoice_data: JSON.stringify(invoicePayloadForApi),
        invoice_attachment: attachmentUrl,
        isSR: docType === "Service Requests",
        invoice_id: selectedInvoice?.name, // Pass invoice ID if editing
        autofill_used: autofillUsed,
        autofill_confidence_json:
          autofillUsed && autofillConfidence
            ? JSON.stringify(autofillConfidence)
            : null,
        autofill_extracted_invoice_no:
          autofillUsed ? (autofillExtractedValues?.invoice_no || null) : null,
        autofill_extracted_invoice_date:
          autofillUsed ? (autofillExtractedValues?.invoice_date || null) : null,
        autofill_extracted_amount:
          autofillUsed ? (autofillExtractedValues?.amount || null) : null,
        autofill_extracted_supplier_gstin:
          autofillUsed ? (autofillExtractedValues?.supplier_gstin || null) : null,
        autofill_extracted_receiver_gstin:
          autofillUsed ? (autofillExtractedValues?.receiver_gstin || null) : null,
        autofill_all_entities_json:
          (autofillUsed || rebuildMappings) && autofillAllEntities && autofillAllEntities.length > 0
            ? JSON.stringify(autofillAllEntities)
            : null,
        // Line items + the PO mapping (fresh on create; re-extracted on edit).
        autofill_line_items_json:
          (autofillUsed || rebuildMappings) && lineItems && lineItems.length > 0
            ? JSON.stringify(lineItems)
            : null,
        autofill_line_match_json:
          (autofillUsed || rebuildMappings) && lineMatch ? JSON.stringify(lineMatch) : null,
        // Source file_url AI extracted from. Backend's auto-approve gate 13
        // confirms the saved invoice_attachment maps to the same file (no swap
        // between auto-fill and submit).
        autofill_source_file_url: autofillUsed ? (uploadedFileUrl || null) : null,
        // Rebuild the child line_mappings from the corrected mapping (edit of a
        // Pending PO invoice); backend re-guards on status.
        rebuild_line_mappings: rebuildMappings,
      };

      const response = await updateInvoiceApiCall(apiPayload);

      if (response.message?.status === 200) {
        toast({
          title: "Success!",
          description:
            response.message.message ||
            `Invoice ${isEditMode ? "updated" : "added"} for ${docName}.`,
          variant: "success",
        });
        await docMutate();
        await globalMutate((key) =>
          typeof key === "string" && (
            key.startsWith("VendorInvoices-") ||
            key.startsWith("Invoice-Attachments-") ||
            key.startsWith("Nirmaan Attachments-")
          )
        );
        globalMutate("Recon-Total-Invoiced-By-Document");
        handleClose();
      } else {
        throw new Error(
          response.message?.message || `Failed to ${isEditMode ? "update" : "add"} invoice.`
        );
      }
    } catch (error) {
      console.error(`Error ${isEditMode ? "updating" : "adding"} invoice:`, error);
      toast({
        title: "Failed",
        description:
          error instanceof Error ? error.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  }, [
    docName,
    docType,
    userData?.user_id,
    invoiceData,
    selectedAttachment,
    uploadInvoice,
    updateInvoiceApiCall,
    docMutate,
    globalMutate,
    handleClose,
    isEditMode,
    selectedInvoice,
    autofilledFields,
    autofillConfidence,
    autofillExtractedValues,
    autofillAllEntities,
    uploadedFileUrl,
    canEditMapping,
    reExtracted,
    lineMatch,
    lineItems,
  ]);

  const handleSubmit = useCallback(() => {
    // Validate required fields
    if (
      !invoiceData.date ||
      !invoiceData.invoice_no.trim() ||
      !invoiceData.amount
    ) {
      toast({
        title: "Validation Error",
        description:
          "Please fill all required fields (Invoice No, Date, Amount).",
        variant: "destructive",
      });
      return;
    }

    // Attachment is optional in Edit mode if one already exists
    if (!isEditMode && !selectedAttachment) {
        toast({
            title: "Validation Error",
            description: "Please attach an invoice file.",
            variant: "destructive",
        });
        return;
    }

    // Block if duplicate in same document
    if (duplicateCheckResult?.exists_in_current_doc) {
      toast({
        title: "Duplicate Invoice",
        description: `Invoice number "${invoiceData.invoice_no}" already exists in this ${
          docType === "Procurement Orders" ? "Purchase Order" : "Service Request"
        }.`,
        variant: "destructive",
      });
      return;
    }

    // Show warning dialog if duplicate in other document
    if (duplicateCheckResult?.exists_in_other_doc) {
      setShowDuplicateConfirmDialog(true);
      return;
    }

    // Proceed with submission
    submitInvoice();
  }, [invoiceData, duplicateCheckResult, docType, submitInvoice, isEditMode, selectedAttachment]);

  const handleConfirmDuplicate = useCallback(() => {
    setShowDuplicateConfirmDialog(false);
    submitInvoice();
  }, [submitInvoice]);

  const isLoading = uploadLoading || updateInvoiceApiCallLoading;

  // Determine validation state for UI
  const getValidationState = () => {
    if (isCheckingDuplicate) return "checking";
    if (!invoiceData.invoice_no.trim() || invoiceData.invoice_no.trim().length < 3)
      return "idle";
    
    // If in Edit mode and unchanged, it's valid
    if (isEditMode && invoiceData.invoice_no.trim() === selectedInvoice?.invoice_no) return "idle";

    if (duplicateCheckResult?.exists_in_current_doc) return "error";
    if (duplicateCheckResult?.exists_in_other_doc) return "warning";
    if (duplicateCheckResult && !duplicateCheckResult.exists_in_current_doc && !duplicateCheckResult.exists_in_other_doc) return "valid";
    return "idle";
  };

  const validationState = getValidationState();

  // Live amount overage check — recomputes against the current value in the
  // amount field, so editing the value clears or re-triggers the warning.
  // Falls back to the autofill snapshot's PO total + existing-invoiced sum.
  const liveAmountValidation = useMemo(() => {
    if (!autofillValidation?.applicable || !autofillValidation.amount || isEditMode) {
      return null;
    }
    const poTotal = autofillValidation.amount.po_total;
    const existing = autofillValidation.amount.existing_invoiced_sum;
    const current = parseNumber(invoiceData.amount) || 0;
    if (poTotal <= 0 || current <= 0) return null;
    const wouldBeTotal = existing + current;
    // Tolerate up to ₹10 of rounding drift — must match the backend
    // hard-block threshold in update_invoice_data._check_po_amount_overage.
    const wouldExceed = wouldBeTotal > poTotal + 10;
    return {
      poTotal,
      existing,
      current,
      wouldBeTotal,
      wouldExceed,
    };
  }, [autofillValidation, invoiceData.amount, isEditMode]);

  const supplierGstinMismatch =
    !isEditMode &&
    autofillValidation?.supplier_gstin?.match === false &&
    !!autofillValidation.supplier_gstin.message;
  const receiverGstinMismatch =
    !isEditMode &&
    autofillValidation?.receiver_gstin?.match === false &&
    !!autofillValidation.receiver_gstin.message;
  // "Couldn't verify" cases — vendor/project has a GSTIN configured but AI
  // failed to extract it from the invoice file. Soft-warn only; do NOT block
  // submit. Reviewer will manually verify the GSTIN against the attached file.
  const supplierGstinMissing =
    !isEditMode &&
    autofillValidation?.supplier_gstin?.match === null &&
    !!autofillValidation?.supplier_gstin?.expected &&
    !autofillValidation?.supplier_gstin?.extracted &&
    !!autofillValidation?.supplier_gstin?.message;
  const receiverGstinMissing =
    !isEditMode &&
    autofillValidation?.receiver_gstin?.match === null &&
    !!autofillValidation?.receiver_gstin?.expected &&
    !autofillValidation?.receiver_gstin?.extracted &&
    !!autofillValidation?.receiver_gstin?.message;

  return (
    <>
      {/* Main Invoice Dialog */}
      <AlertDialog
        open={isOpen}
        onOpenChange={(open) => !open && !isLoading && !isAutofilling ? handleClose() : undefined}
      >
        <AlertDialogContent className={cn("p-0 gap-0 overflow-hidden", (stage === "review" || (canEditMapping && !!lineMatch)) ? "max-w-3xl" : "max-w-lg")}>
          {/* Header */}
          <div className="bg-gray-50/80 px-6 py-4 border-b">
            <AlertDialogHeader className="space-y-1">
              <AlertDialogTitle className="flex items-center gap-2 text-lg font-semibold">
                <FileText className="h-5 w-5 text-primary" />
                {isEditMode ? "Edit Invoice" : "Add Invoice"}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm text-muted-foreground">
                {isEditMode 
                  ? `Update details for invoice ${selectedInvoice.invoice_no}` 
                  : docType === "Procurement Orders"
                    ? "Add vendor invoice for this Purchase Order"
                    : "Add invoice for this Service Request"
                }
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>

          {/* Body */}
          {stage === "upload" ? (
            // ───────── Stage 1: Upload-only screen ─────────
            <div className="px-6 py-8 space-y-4">
              {!isAutofilling ? (
                <>
                  <div className="text-center space-y-1">
                    <h3 className="text-base font-semibold text-gray-900">
                      Upload your invoice
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      We'll read the invoice and fill in the details for you.
                    </p>
                  </div>
                  <CustomAttachment
                    maxFileSize={20 * 1024 * 1024}
                    selectedFile={selectedAttachment}
                    onFileSelect={handleAttachmentSelect}
                    label="Choose Invoice File (PDF or image)"
                    className="w-full"
                    disabled={isLoading || isAutofilling}
                  />
                  <p className="text-[11px] text-center text-muted-foreground">
                    Supported: PDF, PNG, JPG · max 20 MB
                  </p>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 className="h-8 w-8 text-amber-600 animate-spin" />
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-gray-900">
                      Reading your invoice…
                    </p>
                    <p className="text-xs text-muted-foreground">
                      AI is extracting invoice details. This usually takes a few seconds.
                    </p>
                  </div>
                </div>
              )}
              {!isAutofilling && (
                <div className="flex justify-end pt-2 border-t">
                  <Button variant="outline" onClick={handleClose}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          ) : stage === "review" && lineMatch ? (
            // ───────── Stage 2: Review extraction + verify PO mapping ─────────
            <>
              <div className="px-6 py-4 max-h-[65vh] overflow-y-auto">
                <LineItemMappingReview
                  extracted={rawExtraction}
                  poItems={poItemsForMatch || []}
                  lineMatch={lineMatch}
                  onChange={setLineMatch}
                />
              </div>
              <div className="bg-gray-50/80 px-6 py-4 border-t flex items-center justify-between gap-3">
                <Button variant="outline" onClick={() => setStage(isEditMode ? "form" : "upload")}>
                  Back
                </Button>
                <Button onClick={() => setStage("form")}>
                  Looks good — continue
                </Button>
              </div>
            </>
          ) : (
            // ───────── Stage 3: Form (prefilled if autofill ran) ─────────
            <>
          <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
            {!isEditMode && autofilledFields.size > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 -mt-1">
                <Sparkles className="h-3.5 w-3.5 text-amber-700 flex-shrink-0" />
                <span className="text-xs text-amber-900 leading-snug">
                  Auto-filled from your invoice. Please review and edit if anything is wrong.
                </span>
              </div>
            )}


            {/* Hard-block banner: amount overage on PO */}
            {liveAmountValidation?.wouldExceed && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-300 px-3 py-2">
                <XCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-red-900 leading-snug">
                  <p className="font-medium">Amount exceeds PO total — submit blocked.</p>
                  <p className="mt-0.5">
                    Already invoiced ₹{liveAmountValidation.existing.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.
                    This invoice ₹{liveAmountValidation.current.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} would push the total to
                    ₹{liveAmountValidation.wouldBeTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })},
                    over the PO total of ₹{liveAmountValidation.poTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.
                  </p>
                  <p className="mt-0.5 italic">Revise the amount before submitting.</p>
                </div>
              </div>
            )}

            {/* Hard-block: supplier GSTIN mismatch */}
            {supplierGstinMismatch && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-300 px-3 py-2">
                <XCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-red-900 leading-snug">
                  <p className="font-medium">Supplier GSTIN mismatch — submit blocked.</p>
                  <p className="mt-0.5">{autofillValidation?.supplier_gstin?.message}</p>
                  <p className="mt-0.5 italic">Re-upload the correct invoice or verify the vendor's GSTIN on file.</p>
                </div>
              </div>
            )}

            {/* Hard-block: receiver GSTIN mismatch */}
            {receiverGstinMismatch && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-300 px-3 py-2">
                <XCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-red-900 leading-snug">
                  <p className="font-medium">Receiver (Nirmaan) GSTIN mismatch — submit blocked.</p>
                  <p className="mt-0.5">{autofillValidation?.receiver_gstin?.message}</p>
                  <p className="mt-0.5 italic">Re-upload the correct invoice or verify the PO's Project GST setup.</p>
                </div>
              </div>
            )}

            {/* Soft-warn: supplier GSTIN not extracted (AI couldn't read it).
                Submit stays enabled — reviewer verifies against the file. */}
            {supplierGstinMissing && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-300 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 leading-snug">
                  <p className="font-medium">Supplier GSTIN not extracted</p>
                  <p className="mt-0.5">{autofillValidation?.supplier_gstin?.message}</p>
                  <p className="mt-0.5 italic">You can submit — a reviewer will verify the GSTIN against the attached file.</p>
                </div>
              </div>
            )}

            {/* Soft-warn: receiver GSTIN not extracted. */}
            {receiverGstinMissing && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-300 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900 leading-snug">
                  <p className="font-medium">Receiver (Nirmaan) GSTIN not extracted</p>
                  <p className="mt-0.5">{autofillValidation?.receiver_gstin?.message}</p>
                  <p className="mt-0.5 italic">You can submit — a reviewer will verify the GSTIN against the attached file.</p>
                </div>
              </div>
            )}

            {/* Invoice Number */}
            <div className="space-y-1.5">
              <Label
                htmlFor="invoice_no"
                className="text-sm font-medium flex items-center gap-1"
              >
                Invoice Number
                <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="invoice_no"
                  type="text"
                  placeholder="Enter invoice number"
                  value={invoiceData.invoice_no}
                  onChange={(e) => {
                    clearAutofillFlag("invoice_no");
                    setInvoiceData((prev) => ({
                      ...prev,
                      invoice_no: e.target.value,
                    }));
                  }}
                  className={cn(
                    "pl-10 pr-10",
                    validationState === "error" &&
                      "border-red-500 focus-visible:ring-red-500",
                    validationState === "warning" &&
                      "border-amber-500 focus-visible:ring-amber-500",
                    validationState === "valid" &&
                      "border-green-500 focus-visible:ring-green-500",
                    autofilledFields.has("invoice_no") &&
                      "bg-amber-50 border-amber-300 focus-visible:ring-amber-400"
                  )}
                  disabled={isLoading || isAutofilling}
                />
                {/* Validation indicator */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {validationState === "checking" && (
                    <Loader2 className="h-4 w-4 text-gray-400 animate-spin" />
                  )}
                  {validationState === "error" && (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  {validationState === "warning" && (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  )}
                  {validationState === "valid" && (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  )}
                </div>
              </div>
              {/* Validation messages */}
              {validationState === "error" && (
                <p className="text-xs text-red-600 flex items-center gap-1 mt-1">
                  <XCircle className="h-3 w-3" />
                  This invoice number already exists in this{" "}
                  {docType === "Procurement Orders" ? "PO" : "SR"}
                </p>
              )}
              {validationState === "warning" && duplicateCheckResult && (
                <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
                  <AlertTriangle className="h-3 w-3" />
                  Exists in{" "}
                  {duplicateCheckResult.other_doc_type === "Procurement Orders"
                    ? "PO"
                    : "SR"}
                  : {duplicateCheckResult.other_doc_name}
                </p>
              )}
            </div>

            {/* Date and Amount Row */}
            <div className="grid grid-cols-2 gap-4">
              {/* Invoice Date */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="invoice_date"
                  className="text-sm font-medium flex items-center gap-1"
                >
                  Invoice Date
                  <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="invoice_date"
                    type="date"
                    value={invoiceData.date}
                    onChange={(e) => {
                      clearAutofillFlag("date");
                      setInvoiceData((prev) => ({
                        ...prev,
                        date: e.target.value,
                      }));
                    }}
                    max={new Date().toISOString().split("T")[0]}
                    className={cn(
                      "pl-10",
                      autofilledFields.has("date") &&
                        "bg-amber-50 border-amber-300 focus-visible:ring-amber-400"
                    )}
                    disabled={isLoading || isAutofilling}
                  />
                </div>
              </div>

              {/* Invoice Amount */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="invoice_amount"
                  className="text-sm font-medium flex items-center gap-1"
                >
                  Amount (incl. GST)
                  <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="invoice_amount"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={invoiceData.amount}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (/^-?\d*\.?\d*$/.test(value)) {
                        clearAutofillFlag("amount");
                        setInvoiceData((prev) => ({ ...prev, amount: value }));
                      }
                    }}
                    className={cn(
                      "pl-10",
                      autofilledFields.has("amount") &&
                        "bg-amber-50 border-amber-300 focus-visible:ring-amber-400"
                    )}
                    disabled={isLoading || isAutofilling}
                  />
                </div>
              </div>
            </div>

            {/* Credit Note — when ticked, this invoice is EXCLUDED from the PO's
                invoice_qty (it does not add to the invoiced quantity). */}
            <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <Checkbox
                id="is_credit_note"
                checked={invoiceData.is_credit_note}
                onCheckedChange={(checked) => {
                  const isChecked = checked === true;
                  setInvoiceData((prev) => ({ ...prev, is_credit_note: isChecked }));
                  // On a Gemini-detected credit note, the checkbox decides the qty sign:
                  // ticked (price credit) → qty positive (invoice is skipped anyway);
                  // unticked (return note) → qty negative (recompute subtracts).
                  // The amount stays negative in both cases.
                  if (creditNoteDetected) {
                    const neg = !isChecked;
                    setLineItems((prev) => applyQtySign(prev, neg));
                    setLineMatch((prev) => applyMatchQtySign(prev, neg));
                  }
                }}
                disabled={isLoading || isAutofilling}
                className="mt-0.5"
              />
              <div className="text-sm leading-snug">
                <Label htmlFor="is_credit_note" className="font-medium cursor-pointer">
                  Credit Note
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tick if this is a credit note. It will be excluded from the PO's invoiced quantity.
                </p>
              </div>
            </div>

            {/* Attachment */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Invoice Attachment
                {!isEditMode && <span className="text-red-500">*</span>}
              </Label>
              <CustomAttachment
                maxFileSize={20 * 1024 * 1024}
                selectedFile={selectedAttachment}
                onFileSelect={handleAttachmentSelect}
                label={isEditMode ? "Replace Current Attachment" : "Attach Invoice File"}
                className="w-full"
                disabled={isLoading || isAutofilling}
              />

              {isAutofilling && (
                <div className="mt-2 flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                  <Loader2 className="h-4 w-4 text-amber-700 animate-spin" />
                  <span className="text-xs text-amber-900">
                    Reading invoice with Document AI… this takes a few seconds.
                  </span>
                </div>
              )}
              {!isAutofilling && autofilledFields.size > 0 && (
                <div className="mt-2 flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                  <Sparkles className="h-3.5 w-3.5 text-amber-700" />
                  <span className="text-xs text-amber-900">
                    Auto-filled fields are highlighted in amber. Please review and edit if needed.
                  </span>
                </div>
              )}
              {isEditMode && (
                <div className="flex flex-col gap-1 mt-1">
                  {selectedInvoice?.invoice_attachment ? (
                    <div className="flex items-center gap-2">
                       <span className="text-[10px] text-muted-foreground uppercase font-semibold">Current:</span>
                       <a 
                         href={`${SITEURL}${attachmentDoc?.attachment}`} 
                         target="_blank" 
                         rel="noopener noreferrer"
                         className="text-[10px] text-blue-600 hover:underline flex items-center gap-1"
                       >
                         <Eye className="h-3 w-3" />
                         View Previous Image
                       </a>
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted-foreground italic tracking-tight">No existing attachment</span>
                  )}
                  <p className="text-[10px] text-muted-foreground italic">
                      Leave empty to keep existing attachment.
                  </p>
                </div>
              )}
            </div>

            {/* Existing / re-extracted line-item mapping — shown inline & editable. */}
            {canEditMapping && lineMatch && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Line items &amp; PO mapping</Label>
                <div className="rounded-md border p-3">
                  <LineItemMappingReview
                    extracted={rawExtraction}
                    poItems={poItemsForMatch || []}
                    lineMatch={lineMatch}
                    onChange={setLineMatch}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-gray-50/80 px-6 py-4 border-t flex justify-end gap-3">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TailSpin color="#dc2626" width={20} height={20} />
                <span>Processing...</span>
              </div>
            ) : (
              <>
                <Button variant="outline" onClick={handleClose} disabled={isLoading}>
                    Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={
                    !invoiceData.date ||
                    !invoiceData.invoice_no.trim() ||
                    !invoiceData.amount ||
                    (!isEditMode && !selectedAttachment) ||
                    isLoading ||
                    isAutofilling ||
                    validationState === "error" ||
                    validationState === "checking" ||
                    !!liveAmountValidation?.wouldExceed ||
                    supplierGstinMismatch ||
                    receiverGstinMismatch
                  }
                >
                  {isEditMode ? "Update Invoice" : "Add Invoice"}
                </Button>
              </>
            )}
          </div>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Duplicate Warning Confirmation Dialog */}
      <AlertDialog
        open={showDuplicateConfirmDialog}
        onOpenChange={setShowDuplicateConfirmDialog}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Duplicate Invoice Warning
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 pt-2">
              <p>
                Invoice number <strong>{invoiceData.invoice_no}</strong> already
                exists in:
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm">
                <p className="font-medium text-amber-800">
                  {duplicateCheckResult?.other_doc_type === "Procurement Orders"
                    ? "Purchase Order"
                    : "Service Request"}
                  : {duplicateCheckResult?.other_doc_name}
                </p>
              </div>
              <p className="text-sm">
                Are you sure you want to add this invoice anyway?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDuplicate}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Continue Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
