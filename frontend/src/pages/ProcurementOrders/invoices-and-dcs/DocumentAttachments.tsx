import { useMemo, useCallback, useState, useEffect } from "react";
import { KeyedMutator, mutate as globalMutate } from "swr";
import {
  FrappeDoc,
  useFrappeGetDocList,
  useFrappePostCall,
  useFrappeUpdateDoc,
  useFrappeFileUpload,
} from "frappe-react-sdk";
import { useDialogStore } from "@/zustand/useDialogStore"; // Adjust import path
import { useToast } from "@/components/ui/use-toast"; // Adjust import path
import { TailSpin } from "react-loader-spinner";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";

// UI Components
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Types
import {
  ProcurementOrder,
} from "@/types/NirmaanStack/ProcurementOrders"; // Adjust import path
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests"; // Adjust import path
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment"; // Adjust import path
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";

// Reusable Table Components
import { InvoiceTable } from "./components/InvoiceTable"; // Adjust import path
import { DeliveryChallanTable } from "./components/DeliveryChallanTable"; // Adjust import path
import SITEURL from "@/constants/siteURL"; // Adjust import path
import { formatDate } from "date-fns";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RefreshCcw, CirclePlus, Upload } from "lucide-react";
import { Projects } from "@/types/NirmaanStack/Projects";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";

// Define a union type for the document data
type DocumentType = ProcurementOrder | ServiceRequests;
// type AllowedDocTypes = "Procurement Orders" | "Service Requests";

interface DocumentAttachmentsProps<T extends DocumentType> {
  docType: T extends ProcurementOrder
    ? "Procurement Orders"
    : T extends ServiceRequests
    ? "Service Requests"
    : never;
  docName: string;
  documentData: T | null | undefined;
  // Mutator specifically for the *parent* document (PO or SR)
  docMutate: KeyedMutator<T[]>; // Use 'any' for flexibility or define a more specific SWRResponse type if possible
  project?: FrappeDoc<Projects>;
  isPMUserChallans?: boolean;
  disabledAddInvoice?: boolean;
  isProjectManager?: boolean;
}

interface SrInvoiceDialogData {
  invoice_no: string;
  invoice_date: string; // yyyy-MM-dd
}

const initialSrInvoiceDialogData: SrInvoiceDialogData = {
  invoice_no: "",
  invoice_date: formatDate(new Date(), "yyyy-MM-dd"), // Default to today
};

interface UploadDialogState {
  open: boolean;
  type: "DC" | "MIR" | null;
}

export const DocumentAttachments = <T extends DocumentType>({
  docType,
  docName,
  documentData,
  docMutate,
  project,
  isPMUserChallans,
  disabledAddInvoice,
  isProjectManager = false,
}: DocumentAttachmentsProps<T>) => {
//   console.log("DocumentAttachments", project, documentData);

  const { toggleNewInvoiceDialog } = useDialogStore();
  const { toast } = useToast();

  // Fetch users list for displaying "Uploaded By" names
  const { data: usersList } = useUsersList();

  // Convert user ID to display name
  const getUserName = useCallback((id: string | undefined): string => {
    if (!id) return "--";
    if (id === "Administrator") return "Administrator";
    const user = usersList?.find(u => u.name === id);
    return user?.full_name || id;
  }, [usersList]);

  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [invoiceDialogData, setInvoiceDialogData] =
    useState<SrInvoiceDialogData>(initialSrInvoiceDialogData);

  const [isGeneratingInvNo, setIsGeneratingInvNo] = useState(false);

  // Upload DC/MIR state
  const [uploadDialog, setUploadDialog] = useState<UploadDialogState>({
    open: false,
    type: null,
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [refNumber, setRefNumber] = useState("");

  const { updateDoc, loading: update_loading } = useFrappeUpdateDoc();
  // Hook for fetching new invoice number
  const { call: generateInvoiceNumberAPI } = useFrappePostCall(
    "nirmaan_stack.api.invoice_utils.generate_next_invoice_number" // Path to your new Python API
  );

  // Upload hooks
  const { upload, loading: uploadLoading } = useFrappeFileUpload();
  const { call: createAttachmentDoc, loading: createAttachmentLoading } = useFrappePostCall(
    "frappe.client.insert"
  );

  // Pre-fill dialog if invoice_no and invoice_date exist on orderData
  useEffect(() => {
    if (documentData?.invoice_no || documentData?.invoice_date) {
      setInvoiceDialogData({
        invoice_no: documentData.invoice_no || "",
        invoice_date:
          documentData.invoice_date || formatDate(new Date(), "yyyy-MM-dd"),
      });
    } else {
      // Reset to defaults if no existing data, or when dialog is opened for a new generation
      setInvoiceDialogData({
        invoice_no: "",
        invoice_date: formatDate(new Date(), "yyyy-MM-dd"),
      });
    }
  }, [documentData, isPrintDialogOpen]); // Depend on isPrintDialogOpen to reset/prefill when dialog opens

  // --- Data Fetching ---
  const {
    data: attachmentsData,
    isLoading: attachmentsLoading,
    error: attachmentsError,
    mutate: mutateAttachments,
  } = useFrappeGetDocList<NirmaanAttachment>(
    "Nirmaan Attachments",
    {
      fields: ["name", "attachment_type", "attachment", "creation", "attachment_ref"], // Fetch only needed fields
      filters: [
        ["associated_doctype", "=", docType],
        ["associated_docname", "=", docName],
      ],
      limit: 1000, // Consider pagination if lists can get very large
    },
    // SWR key depends on docName being available
    docName ? `Nirmaan Attachments-${docName}` : null,
    // Options
    {
      revalidateOnFocus: false, // Optional: reduce refetching
      // dedupingInterval: 5000, // Optional: further reduce redundant fetches
    }
  );

  // Fetch Vendor Invoices for this document
  const {
    data: vendorInvoices,
    isLoading: invoicesLoading,
    error: invoicesError,
    mutate: mutateInvoices,
  } = useFrappeGetDocList<VendorInvoice>(
    "Vendor Invoices",
    {
      fields: ["name", "invoice_no", "invoice_date", "invoice_amount", "invoice_attachment", "status", "reconciliation_status", "uploaded_by"],
      filters: [
        ["document_type", "=", docType],
        ["document_name", "=", docName],
      ],
      orderBy: { field: "invoice_date", order: "desc" },
      limit: 1000,
    },
    docName ? `VendorInvoices-${docType}-${docName}` : null,
    {
      revalidateOnFocus: false,
    }
  );

  // Get invoice attachment IDs from vendorInvoices (for migrated attachments)
  const invoiceAttachmentIds = useMemo((): string[] =>
    (vendorInvoices?.map(vi => vi.invoice_attachment).filter((id): id is string => !!id) || []),
    [vendorInvoices]
  );

  // Fetch invoice attachments by their IDs (now associated with Vendor Invoices after migration)
  const { data: invoiceAttachmentsData } = useFrappeGetDocList<NirmaanAttachment>(
    "Nirmaan Attachments",
    {
      fields: ["name", "attachment"],
      filters: [["name", "in", invoiceAttachmentIds]],
      limit: 1000,
    },
    invoiceAttachmentIds.length > 0 ? `Invoice-Attachments-${docName}` : null
  );

  // --- API Hooks ---
  const { call: deleteInvoiceEntryApi, loading: deleteInvoiceEntryLoading } =
    useFrappePostCall(
      "nirmaan_stack.api.delivery_notes.update_invoice_data.delete_invoice_entry"
    );

  // --- Memoized Data ---
  const dcAttachments = useMemo(
    () => {
      const filtered = attachmentsData?.filter(
        (att) =>
          att.attachment_type === "po delivery challan" ||
          att.attachment_type === "material inspection report"
      ) || [];

      // Sort by creation date (newest first)
      return filtered.sort((a, b) =>
        new Date(b.creation).getTime() - new Date(a.creation).getTime()
      );
    },
    [attachmentsData]
  );

  // This list helps find the full URL for an attachment ID from Vendor Invoices
  const invoiceAttachmentLookup = useMemo(() => {
    const lookup = new Map<string, string>(); // Map attachment_id (name) to attachment URL
    // Use invoiceAttachmentsData (fetched by IDs from Vendor Invoices) instead of filtering attachmentsData
    invoiceAttachmentsData?.forEach((att) => {
      if (att.attachment) {
        lookup.set(att.name, att.attachment);
      }
    });
    return lookup;
  }, [invoiceAttachmentsData]);

  // --- Event Handlers ---
  const handleViewInvoiceAttachment = useCallback(
    (attachmentId: string | undefined) => {
      if (!attachmentId) {
        toast({
          title: "Info",
          description: "No attachment linked to this invoice entry.",
          variant: "default",
        });
        return;
      }
      const attachmentUrl = invoiceAttachmentLookup.get(attachmentId);
      if (attachmentUrl) {
        window.open(
          `${SITEURL}${attachmentUrl}`,
          "_blank",
          "noopener,noreferrer"
        );
      } else {
        toast({
          title: "Error",
          description: "Attachment file not found or inaccessible.",
          variant: "destructive",
        });
        console.error(
          `Invoice attachment URL not found for ID: ${attachmentId}. Lookup map:`,
          invoiceAttachmentLookup
        );
      }
    },
    [invoiceAttachmentLookup, toast]
  );

  const handleDeleteInvoiceEntry = useCallback(
    async (invoiceId: string) => {
      if (!docName) return; // Should not happen if component renders

      try {
        const response = await deleteInvoiceEntryApi({
          docname: docName,
          isSR: docType === "Service Requests",
          invoice_id: invoiceId, // Use invoice_id instead of date_key
        });

        if (response.message?.status === 200) {
          toast({
            title: "Success!",
            description: response.message.message || "Invoice entry deleted.",
            variant: "success",
          });
          await mutateInvoices(); // Refresh the vendor invoices list
          await mutateAttachments(); // Refresh attachments
          await docMutate(); // Refresh the parent PO/SR document data
        } else {
          throw new Error(
            response.message?.message || "Failed to delete invoice entry."
          );
        }
      } catch (error) {
        console.error("Error while deleting invoice entry:", error);
        toast({
          title: "Deletion Failed!",
          description:
            error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      }
    },
    [docName, docType, deleteInvoiceEntryApi, toast, mutateInvoices, mutateAttachments, docMutate]
  );

  const canDeleteInvoice = useCallback((item: VendorInvoice): boolean => {
    // Only allow deletion if status is Pending or Rejected (or other statuses you define)
    return ["Pending", "Rejected"].includes(item?.status || "");
  }, []);

  // --- Upload DC/MIR Handlers ---
  const handleOpenUploadDialog = useCallback((type: "DC" | "MIR") => {
    setUploadDialog({
      open: true,
      type,
    });
    setSelectedFile(null);
  }, []);

  const handleCloseUploadDialog = useCallback(() => {
    setUploadDialog({ open: false, type: null });
    setSelectedFile(null);
    setRefNumber("");
  }, []);

  const handleUploadFile = useCallback(async () => {
    if (!selectedFile || !uploadDialog.type) {
      toast({
        title: "No File Selected",
        description: "Please select a file to upload",
        variant: "destructive",
      });
      return;
    }

    if (!refNumber) {
      toast({
        title: "Required Field Missing",
        description: `Please enter the ${
          uploadDialog.type === "DC" ? "DC Number" : "MIR Number"
        }`,
        variant: "destructive",
      });
      return;
    }

    if (!documentData) {
      toast({
        title: "Error",
        description: "Document data not available",
        variant: "destructive",
      });
      return;
    }

    try {
      // Step 1: Upload file to Frappe
      const uploadResult = await upload(selectedFile, {
        doctype: docType,
        docname: docName,
        fieldname: "attachment",
        isPrivate: true,
      });

      if (!uploadResult?.file_url) {
        throw new Error("File upload failed");
      }

      // Step 2: Create Nirmaan Attachments record
      const attachmentType = uploadDialog.type === "DC" ? "po delivery challan" : "material inspection report";

      const attachmentDoc = {
        doctype: "Nirmaan Attachments",
        project: documentData.project,
        attachment: uploadResult.file_url,
        attachment_type: attachmentType,
        associated_doctype: docType,
        associated_docname: docName,
        attachment_link_doctype: "Vendors",
        attachment_link_docname: (documentData as ProcurementOrder).vendor,
        attachment_ref: refNumber || undefined,
      };

      await createAttachmentDoc({ doc: attachmentDoc });

      // Success
      toast({
        title: "Upload Successful",
        description: `${uploadDialog.type} uploaded successfully`,
        variant: "success",
      });

      // Refresh data and close dialog
      await docMutate();
      await mutateAttachments(); // Refresh attachments list in this component

      // Refresh all attachment queries globally (including parent component counts)
      // SWR keys in frappe-react-sdk are arrays, so we need to check array keys
      await globalMutate(
        (key) => {
          if (Array.isArray(key)) {
            // Serialize the key and check if it contains 'Nirmaan Attachments'
            return JSON.stringify(key).includes('Nirmaan Attachments');
          }
          return false;
        },
        undefined,
        { revalidate: true }
      );

      handleCloseUploadDialog();
    } catch (error: any) {
      console.error("Upload error:", error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload file",
        variant: "destructive",
      });
    }
  }, [selectedFile, uploadDialog.type, documentData, docType, docName, upload, createAttachmentDoc, toast, docMutate, mutateAttachments, handleCloseUploadDialog, refNumber]);

  const isUploading = uploadLoading || createAttachmentLoading;

  // --- Loading and Error States ---
  if (attachmentsLoading || invoicesLoading) {
    return (
      <div className="flex justify-center items-center p-4">
        <TailSpin color="red" width={40} height={40} />
      </div>
    );
  }

  if (attachmentsError || invoicesError) {
    console.error(
      `Error fetching data for ${docName}:`,
      attachmentsError || invoicesError
    );
    toast({
      title: "Error",
      description: "Could not load data.",
      variant: "destructive",
    });
    // Optionally return a more user-friendly error state component
  }

  // Determine if the document is a Procurement Order for conditional rendering
  const isPO = docType === "Procurement Orders";
  const documentStatus = documentData?.status; // Get status from the passed document data

  // Check if DC table should be shown (only for POs in specific statuses)
  const showDcTable =
    isPO &&
    documentStatus &&
    ["Delivered", "Partially Delivered"].includes(documentStatus);

  const handleInvoiceDialogInputChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const { name, value } = e.target;
    setInvoiceDialogData((prev) => ({ ...prev, [name]: value }));
  };

  const handleGenerateInvoiceNumber = async () => {
    setIsGeneratingInvNo(true);
    try {
      // Pass project_name if your backend API uses it for the prefix
      const response = await generateInvoiceNumberAPI({
        project_name: project?.project_name,
      });
      if (response.message) {
        setInvoiceDialogData((prev) => ({
          ...prev,
          invoice_no: response.message,
        }));
      }
    } catch (error) {
      console.error("Error generating invoice number:", error);
      toast({
        title: "Failed",
        description: "Could not generate invoice number.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingInvNo(false);
    }
  };

  // Modified handleGenerate (renamed from handlePrint / generateAndOpenPdf)
  const handleGenerateAndProceed = async (action: "preview" | "download") => {
    if (!documentData) {
      toast({
        title: "Error",
        description: "Service Request data not loaded.",
        variant: "destructive",
      });
      return;
    }
    if (!invoiceDialogData.invoice_no || !invoiceDialogData.invoice_date) {
      toast({
        title: "Missing Info",
        description: "Invoice Number and Date are required.",
        variant: "destructive",
      });
      return;
    }

    try {
      // 1. Save invoice_no and invoice_date to the Service Request document
      setIsGeneratingInvNo(true); // Use a general loading state for this combined action
      await updateDoc("Service Requests", documentData.name, {
        invoice_no: invoiceDialogData.invoice_no,
        invoice_date: invoiceDialogData.invoice_date,
      });

      // Mutate to get the latest SR doc (which now includes the saved invoice no/date)
      await docMutate();
      toast({
        title: "Info Saved",
        description: "Invoice number and date saved to Service Request.",
        variant: "success",
      });

      // 2. Construct print URL (no custom params needed now as they are on the doc)
      const params = {
        doctype: "Service Requests",
        name: documentData.name,
        format: "SR Invoice", // Your print format name
        no_letterhead: "1",
        _lang: "en",
      };

      const customParams: Record<string, string> = {};
      customParams["custom_project_name"] = project?.project_name || "";

      const allParams = { ...params, ...customParams };
      const queryString = new URLSearchParams(allParams).toString();

      let targetUrl = "";
      if (action === "preview") {
        targetUrl = `/api/method/frappe.utils.print_format.download_pdf?${queryString}`;
        window.open(targetUrl, "_blank");
        setIsPrintDialogOpen(false);
      } else {
        // download with custom filename
        setIsGeneratingInvNo(true); // show loading state while downloading
        try {
          const downloadUrl = `/api/method/frappe.utils.print_format.download_pdf?${queryString}`;
          const response = await fetch(downloadUrl);
          if (!response.ok) throw new Error("Failed to generate PDF");
          
          const blob = await response.blob();
          const fileName = `${invoiceDialogData.invoice_no}_${project?.project_name || "Project"}.pdf`;
          
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', fileName);
          document.body.appendChild(link);
          link.click();
          
          link.remove();
          window.URL.revokeObjectURL(url);
          setIsPrintDialogOpen(false);
        } catch (error) {
          console.error("Download error:", error);
          throw error; // Re-throw to be caught by the outer catch block
        }
      }
    } catch (error: any) {
      console.error("Error saving invoice details or generating PDF:", error);
      toast({
        title: "Operation Failed",
        description:
          error.message || "Could not save invoice details or generate PDF.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingInvNo(false);
    }
  };

  return (
    <div
      className={`grid gap-4 lg:grid-cols-2 ${
        showDcTable && !isProjectManager ? "lg:grid-cols-2" : "lg:grid-cols-1"
      }`}
    >
      {/* Invoice Card - Hidden for Project Manager */}
      {!isProjectManager && (
      <Card className="rounded-md shadow-sm border border-gray-200 overflow-hidden">
        {" "}
        {/* Subtle styling */}
        <CardHeader className="border-b border-gray-200">
          <CardTitle className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <p className="text-xl max-sm:text-lg text-red-600">Invoices</p>
              <Badge variant="secondary" className="text-sm">
                {vendorInvoices?.length || 0}
              </Badge>
            </div>
            <div className="flex gap-2 items-center">
              {docType === "Service Requests" &&
                (documentData as ServiceRequests)?.gst !== "true" && (
                  <Button
                    disabled={!documentData?.project_gst} // Keep your existing disabled logic
                    size="sm"
                    className="text-primary border-primary hover:bg-primary/5"
                    variant="outline"
                    onClick={() => {
                      // Reset/Prefill dialog state when opening
                      setInvoiceDialogData({
                        invoice_no: documentData?.invoice_no || "",
                        invoice_date:
                          documentData?.invoice_date ||
                          formatDate(new Date(), "yyyy-MM-dd"),
                      });
                      setIsPrintDialogOpen(true);
                    }}
                  >
                    View / Download Tax Invoice
                  </Button>
                )}
              <Button
                variant="outline"
                size="sm" // Consistent button size
                className="text-primary border-primary hover:bg-primary/5" // Subtle hover
                onClick={toggleNewInvoiceDialog}
                disabled={disabledAddInvoice||false}
              >
                Add Invoice
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {" "}
          {/* Remove padding to let table control it */}
          <div className="overflow-x-auto">
            {" "}
            {/* Ensure table scrolls horizontally if needed */}
            <InvoiceTable
              items={vendorInvoices} // Use Vendor Invoices instead of JSON data
              onViewAttachment={handleViewInvoiceAttachment}
              onDeleteEntry={handleDeleteInvoiceEntry}
              isLoading={deleteInvoiceEntryLoading}
              canDeleteEntry={canDeleteInvoice}
              getUserName={getUserName}
            />
          </div>
        </CardContent>
      </Card>
      )}
      {/* Delivery Challan Card (Conditional) */}
      
      {
        !isPMUserChallans && (
 <Card className="rounded-md shadow-sm border border-gray-200 overflow-hidden">
          <CardHeader className="border-b border-gray-200">
            <CardTitle className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold text-red-600">
                  Delivery Challans & MIRs
                </p>
                <Badge variant="secondary" className="text-sm">
                  {dcAttachments.length}
                </Badge>
              </div>
              {isPO && showDcTable && (
                <div className="flex gap-2 items-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenUploadDialog("DC")}
                    className="text-primary border-primary hover:bg-primary/5"
                  >
                    <CirclePlus className="h-4 w-4 mr-1" />
                    Upload DC
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenUploadDialog("MIR")}
                    className="text-primary border-primary hover:bg-primary/5"
                  >
                    <Upload className="h-4 w-4 mr-1" />
                    Upload MIR
                  </Button>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <DeliveryChallanTable attachments={dcAttachments} />
            </div>
          </CardContent>
        </Card>
        )
      }
       
      
      <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Invoice Details for SR: {documentData?.name}
            </DialogTitle>
            <DialogDescription>
              Enter or generate the invoice number and confirm the date. These
              details will be saved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-6">
            <div className="space-y-1.5">
              <Label htmlFor="invoice_no">
                Invoice Number <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="invoice_no"
                  name="invoice_no"
                  value={invoiceDialogData.invoice_no}
                  onChange={handleInvoiceDialogInputChange}
                  className="flex-grow"
                  placeholder="e.g., INV-2024-0001"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleGenerateInvoiceNumber}
                  disabled={isGeneratingInvNo}
                  title="Generate Invoice Number"
                >
                  {isGeneratingInvNo ? (
                    <TailSpin width="16" height="16" color="gray" />
                  ) : (
                    <RefreshCcw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice_date">
                Invoice Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="invoice_date"
                name="invoice_date"
                type="date"
                value={invoiceDialogData.invoice_date}
                onChange={handleInvoiceDialogInputChange}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={() => handleGenerateAndProceed("preview")}
              disabled={
                isGeneratingInvNo ||
                !invoiceDialogData.invoice_no ||
                !invoiceDialogData.invoice_date
              }
            >
              Preview Invoice
            </Button>
            <Button
              type="button"
              onClick={() => handleGenerateAndProceed("download")}
              disabled={
                isGeneratingInvNo ||
                !invoiceDialogData.invoice_no ||
                !invoiceDialogData.invoice_date
              }
            >
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload DC/MIR Dialog */}
      <Dialog open={uploadDialog.open} onOpenChange={handleCloseUploadDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              Upload {uploadDialog.type === "DC" ? "Delivery Challan" : "Material Inspection Report"}
            </DialogTitle>
            <DialogDescription>
              Upload {uploadDialog.type} for {docName ? `PO-${docName.split("/")[1]}` : "this Purchase Order"}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <CustomAttachment
              selectedFile={selectedFile}
              onFileSelect={setSelectedFile}
              label={`Select ${uploadDialog.type} File`}
              maxFileSize={20 * 1024 * 1024}
              acceptedTypes={["application/pdf", "image/*"]}
            />
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {uploadDialog.type === "DC" ? "DC Number" : "MIR Number"}{" "}
                <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder={
                  uploadDialog.type === "DC"
                    ? "Enter DC number"
                    : "Enter MIR number"
                }
                value={refNumber}
                onChange={(e) => setRefNumber(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            {isUploading ? (
              <div className="flex justify-center w-full">
                <TailSpin color="#3b82f6" width={40} height={40} />
              </div>
            ) : (
              <>
                <Button variant="outline" onClick={handleCloseUploadDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={handleUploadFile}
                  disabled={!selectedFile || !refNumber}
                >
                  Upload
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
