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
  useFrappePostCall,
  useSWRConfig,
} from "frappe-react-sdk";
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
  const { toggleNewInvoiceDialog, newInvoiceDialog } = useDialogStore();
  const { mutate: globalMutate } = useSWRConfig();
  const userData = useUserData();

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

  // API hooks
  const { call: updateInvoiceApiCall, loading: updateInvoiceApiCallLoading } =
    useFrappePostCall(
      "nirmaan_stack.api.delivery_notes.update_invoice_data.update_invoice_data"
    );
  const { call: checkDuplicateApi } = useFrappePostCall(
    "nirmaan_stack.api.invoices.check_duplicate_invoice.check_duplicate_invoice"
  );
  const { upload, loading: uploadLoading } = useFrappeFileUpload();

  // Reset form when dialog closes
  useEffect(() => {
    if (!newInvoiceDialog) {
      setInvoiceData(initialInvoiceState);
      setSelectedAttachment(null);
      setDuplicateCheckResult(null);
      setIsCheckingDuplicate(false);
    }
  }, [newInvoiceDialog]);

  // Debounced duplicate check on invoice_no change
  useEffect(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const trimmedInvoiceNo = invoiceData.invoice_no.trim();

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
  }, [invoiceData.invoice_no, docType, docName, vendor, checkDuplicateApi]);

  const uploadInvoice = useCallback(async () => {
    if (!selectedAttachment || !docName || !docType) return null;

    try {
      const result = await upload(selectedAttachment, {
        doctype: docType,
        docname: docName,
        fieldname: "attachment",
        isPrivate: true,
      });
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
  }, [selectedAttachment, docType, docName, upload]);

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
      };

      const response = await updateInvoiceApiCall(apiPayload);

      if (response.message?.status === 200) {
        toast({
          title: "Success!",
          description:
            response.message.message ||
            `Invoice added for ${docName}.`,
          variant: "success",
        });
        await docMutate();
        await globalMutate((key) =>
          typeof key === "string" && key.startsWith("VendorInvoices-")
        );
        toggleNewInvoiceDialog();
      } else {
        throw new Error(
          response.message?.message || "Failed to add invoice."
        );
      }
    } catch (error) {
      console.error("Error adding invoice:", error);
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
    toggleNewInvoiceDialog,
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
  }, [invoiceData, duplicateCheckResult, docType, submitInvoice]);

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
        open={newInvoiceDialog}
        onOpenChange={!isLoading ? toggleNewInvoiceDialog : undefined}
      >
        <AlertDialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="bg-gray-50/80 px-6 py-4 border-b">
            <AlertDialogHeader className="space-y-1">
              <AlertDialogTitle className="flex items-center gap-2 text-lg font-semibold">
                <FileText className="h-5 w-5 text-primary" />
                Add Invoice
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm text-muted-foreground">
                {docType === "Procurement Orders"
                  ? "Add vendor invoice for this Purchase Order"
                  : "Add invoice for this Service Request"}
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
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
                  onChange={(e) =>
                    setInvoiceData((prev) => ({
                      ...prev,
                      invoice_no: e.target.value,
                    }))
                  }
                  className={cn(
                    "pl-10 pr-10",
                    validationState === "error" &&
                      "border-red-500 focus-visible:ring-red-500",
                    validationState === "warning" &&
                      "border-amber-500 focus-visible:ring-amber-500",
                    validationState === "valid" &&
                      "border-green-500 focus-visible:ring-green-500"
                  )}
                  disabled={isLoading}
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
                    onChange={(e) =>
                      setInvoiceData((prev) => ({
                        ...prev,
                        date: e.target.value,
                      }))
                    }
                    max={new Date().toISOString().split("T")[0]}
                    className="pl-10"
                    disabled={isLoading}
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
                        setInvoiceData((prev) => ({ ...prev, amount: value }));
                      }
                    }}
                    className="pl-10"
                    disabled={isLoading}
                  />
                </div>
              </div>
            </div>

            {/* Attachment */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Invoice Attachment
                <span className="text-red-500">*</span>
              </Label>
              <CustomAttachment
                maxFileSize={20 * 1024 * 1024}
                selectedFile={selectedAttachment}
                onFileSelect={setSelectedAttachment}
                label="Attach Invoice File"
                className="w-full"
                disabled={isLoading}
              />
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
                <AlertDialogCancel asChild>
                  <Button variant="outline" disabled={isLoading}>
                    Cancel
                  </Button>
                </AlertDialogCancel>
                <Button
                  onClick={handleSubmit}
                  disabled={
                    !invoiceData.date ||
                    !invoiceData.invoice_no.trim() ||
                    !invoiceData.amount ||
                    !selectedAttachment ||
                    isLoading ||
                    validationState === "error" ||
                    validationState === "checking"
                  }
                >
                  Add Invoice
                </Button>
              </>
            )}
          </div>
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
