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
import { useCallback, useState, useEffect, useRef } from "react";
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
  const [mode, setMode] = useState<"select" | "autofill" | "manual">("select");
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [autofilledFields, setAutofilledFields] = useState<Set<"invoice_no" | "date" | "amount">>(new Set());
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);

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

  // Reset form when dialog closes or Populate when editing
  useEffect(() => {
    if (isOpen) {
      if (selectedInvoice) {
        setInvoiceData({
          invoice_no: selectedInvoice.invoice_no || "",
          amount: String(selectedInvoice.invoice_amount || ""),
          date: selectedInvoice.invoice_date || "",
        });
        // Edit mode skips the mode picker — straight to manual form.
        setMode("manual");
      } else {
        setInvoiceData(initialInvoiceState);
        setMode("select");
      }
      setSelectedAttachment(null);
      setDuplicateCheckResult(null);
      setIsCheckingDuplicate(false);
      setAutofilledFields(new Set());
      setUploadedFileUrl(null);
    }
  }, [isOpen, selectedInvoice]);

  // Reset autofill state when user picks a different file (autofill mode only)
  useEffect(() => {
    setAutofilledFields(new Set());
    setUploadedFileUrl(null);
  }, [selectedAttachment]);

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

      const response = await extractInvoiceFieldsApi({ file_url: fileUrl });
      const extracted = response?.message;
      if (!extracted) {
        toast({
          title: "Auto-fill returned nothing",
          description: "Document AI could not extract any fields. Please fill in manually.",
          variant: "default",
        });
        return;
      }

      const filled = new Set<"invoice_no" | "date" | "amount">();
      setInvoiceData((prev) => {
        const next = { ...prev };
        if (extracted.invoice_no) {
          next.invoice_no = extracted.invoice_no;
          filled.add("invoice_no");
        }
        if (extracted.invoice_date) {
          next.date = extracted.invoice_date;
          filled.add("date");
        }
        if (extracted.amount) {
          next.amount = extracted.amount;
          filled.add("amount");
        }
        return next;
      });
      setAutofilledFields(filled);

      if (filled.size === 0) {
        toast({
          title: "No high-confidence fields found",
          description: "Document AI did not return values above the confidence threshold. Please fill in manually.",
          variant: "default",
        });
      } else {
        toast({
          title: "Auto-filled from invoice",
          description: `${filled.size} field(s) extracted. Please review before submitting.`,
          variant: "success",
        });
      }
    } catch (error) {
      console.error("Auto-fill error:", error);
      toast({
        title: "Auto-fill Failed",
        description:
          error instanceof Error ? error.message : "Could not extract fields from invoice.",
        variant: "destructive",
      });
    } finally {
      setIsAutofilling(false);
    }
  }, [docName, docType, upload, extractInvoiceFieldsApi]);

  const handleAttachmentSelect = useCallback((file: File | null) => {
    setSelectedAttachment(file);
    if (file && mode === "autofill") {
      runAutofillExtraction(file);
    }
  }, [mode, runAutofillExtraction]);

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
        updated_by: userData?.user_id,
      };

      const apiPayload = {
        docname: docName,
        invoice_data: JSON.stringify(invoicePayloadForApi),
        invoice_attachment: attachmentUrl,
        isSR: docType === "Service Requests",
        invoice_id: selectedInvoice?.name // Pass invoice ID if editing
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
          typeof key === "string" && key.startsWith("VendorInvoices-")
        );
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
    selectedInvoice
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

  return (
    <>
      {/* Main Invoice Dialog */}
      <AlertDialog
        open={isOpen}
        onOpenChange={(open) => !open && !isLoading ? handleClose() : undefined}
      >
        <AlertDialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
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
          {mode === "select" ? (
            <div className="px-6 py-6">
              <p className="text-sm text-muted-foreground mb-4">
                How would you like to fill in the invoice details?
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMode("autofill")}
                  className="flex flex-col items-start gap-2 rounded-lg border-2 border-amber-200 bg-amber-50/60 hover:bg-amber-50 hover:border-amber-300 transition-colors p-4 text-left"
                >
                  <div className="flex items-center gap-2 text-amber-900 font-semibold">
                    <Sparkles className="h-5 w-5" />
                    Auto-fill
                  </div>
                  <p className="text-xs text-amber-900/80 leading-snug">
                    Upload the invoice file and let Document AI extract the
                    invoice number, date, and amount automatically.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setMode("manual")}
                  className="flex flex-col items-start gap-2 rounded-lg border-2 border-gray-200 bg-gray-50/60 hover:bg-gray-50 hover:border-gray-300 transition-colors p-4 text-left"
                >
                  <div className="flex items-center gap-2 text-gray-900 font-semibold">
                    <FileText className="h-5 w-5" />
                    Manual entry
                  </div>
                  <p className="text-xs text-gray-700 leading-snug">
                    Type the invoice number, date, and amount yourself, then
                    attach the invoice file.
                  </p>
                </button>
              </div>
              <div className="mt-5 flex justify-end">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
          <div className="px-6 py-5 space-y-4">
            {!isEditMode && (
              <div className="flex items-center justify-between -mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode("select");
                    setSelectedAttachment(null);
                    setInvoiceData(initialInvoiceState);
                    setAutofilledFields(new Set());
                    setUploadedFileUrl(null);
                  }}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                  disabled={isLoading || isAutofilling}
                >
                  ← Choose another method
                </button>
                <span
                  className={cn(
                    "text-[11px] font-medium px-2 py-0.5 rounded-full",
                    mode === "autofill"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-gray-100 text-gray-700"
                  )}
                >
                  {mode === "autofill" ? "✨ Auto-fill mode" : "Manual entry"}
                </span>
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

              {mode === "autofill" && isAutofilling && (
                <div className="mt-2 flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                  <Loader2 className="h-4 w-4 text-amber-700 animate-spin" />
                  <span className="text-xs text-amber-900">
                    Reading invoice with Document AI… this takes a few seconds.
                  </span>
                </div>
              )}
              {mode === "autofill" && !isAutofilling && autofilledFields.size > 0 && (
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
                    validationState === "error" ||
                    validationState === "checking"
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
