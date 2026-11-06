import { useMemo, useCallback, useState } from "react";
import { KeyedMutator, mutate as globalMutate } from "swr";
import {
  FrappeDoc,
  useFrappeGetDocList,
  useFrappePostCall,
} from "frappe-react-sdk";
import { useDialogStore } from "@/zustand/useDialogStore"; // Adjust import path
import { useToast } from "@/components/ui/use-toast"; // Adjust import path
import { TailSpin } from "react-loader-spinner";
import { useUserData } from "@/hooks/useUserData";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";

// UI Components
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Types
import {
  ProcurementOrder,
} from "@/types/NirmaanStack/ProcurementOrders"; // Adjust import path
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests"; // Adjust import path
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment"; // Adjust import path
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";

// Reusable Table Components
import { InvoiceTable } from "./components/InvoiceTable"; // Adjust import path
import { RejectApprovedInvoiceDialog } from "./components/RejectApprovedInvoiceDialog";
import { DeliveryChallanTable } from "./components/DeliveryChallanTable"; // Adjust import path
import SITEURL from "@/constants/siteURL"; // Adjust import path
import { CirclePlus, Upload } from "lucide-react";
import { Projects } from "@/types/NirmaanStack/Projects";
import { usePODeliveryDocuments } from "@/pages/DeliveryChallansAndMirs/hooks/usePODeliveryDocuments";
import { UploadDCMIRDialog } from "@/pages/DeliveryChallansAndMirs/components/UploadDCMIRDialog";
import type { PODeliveryDocuments as PODeliveryDoc } from "@/types/NirmaanStack/PODeliveryDocuments";
import {
  PO_INVOICE_EDIT_PROFILES,
  canActionInvoiceApprovals,
  canDeleteDeliveryDocument,
  canEditWoInvoice,
} from "@/constants/roles";
import { MTCCard } from "@/pages/MaterialTestCertificates/components/MTCCard";
import { ReportPreviewDialog } from "@/pages/CommissionReport/components/ReportPreviewDialog";
import {
  GeneratedInvoice,
  generatedInvoicePdfUrl,
  useGeneratedInvoices,
} from "@/pages/ServiceRequests/hooks/useGeneratedInvoices";
import {
  GenerateInvoiceDialog,
  GeneratedInvoicesTable,
} from "@/pages/ServiceRequests/service-request/components/GeneratedInvoices";
import { isGstExplicitlyOff } from "@/utils/workOrderGst";
import { generatedInvoiceDeleteNote } from "@/utils/generatedInvoices";

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
  isEstimatesExecutive?: boolean;
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
  isEstimatesExecutive = false,
}: DocumentAttachmentsProps<T>) => {
  //   console.log("DocumentAttachments", project, documentData);

  const { toggleNewInvoiceDialog, toggleEditInvoiceDialog, setSelectedInvoice, setNewInvoiceIsCredit } = useDialogStore();
  const { role, user_id } = useUserData();
  // Admins (Nirmaan Admin Profile or the Administrator user) may delete ANY invoice,
  // including Approved ones. Everyone else is limited to Pending/Rejected.
  const isAdmin = user_id === "Administrator" || role === "Nirmaan Admin Profile";
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

  // Generated invoices (#1546): GST-off Work Orders only. The server decides every figure.
  const isWorkOrder = docType === "Service Requests";
  // Who gets the invoice Edit dialog: on a WO, Admin and the accountants (`canEditWoInvoice`, the server's
  // `WO_INVOICE_EDIT_PROFILES`); on a PO, `PO_INVOICE_EDIT_PROFILES`, unchanged by spec #1528.
  const mayEditInvoices = isWorkOrder
    ? canEditWoInvoice(role, user_id)
    : !!role && PO_INVOICE_EDIT_PROFILES.includes(role);
  const workOrder = documentData as ServiceRequests | null | undefined;
  const woGstOff = isWorkOrder && isGstExplicitlyOff(workOrder);
  const {
    state: generatedState,
    mutate: mutateGenerated,
  } = useGeneratedInvoices(isWorkOrder && docName ? docName : null);
  const generatedInvoices = generatedState?.invoices ?? [];
  // A signed upload's Vendor Invoice carries what the vendor signed: never edited (#1547, story 87).
  const signedUploadInvoices = useMemo(
    () => new Set(generatedInvoices.map((g) => g.vendor_invoice).filter(Boolean)),
    [generatedInvoices]
  );
  // Deleting a signed upload's Vendor Invoice deletes its generated invoice too: the confirmation says so.
  const signedUploadDeleteNote = useCallback(
    (item: VendorInvoice): string | undefined => generatedInvoiceDeleteNote(generatedInvoices, item.name),
    [generatedInvoices]
  );
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  // The generated invoice open in the in-app preview, or null.
  const [invoicePreview, setInvoicePreview] = useState<GeneratedInvoice | null>(null);

  // PO Delivery Documents hook (only for POs)
  const { data: pddDocs, mutate: mutatePDD } = usePODeliveryDocuments(
    docType === "Procurement Orders" ? docName : null
  );

  // PDD upload dialog state
  const [pddUploadState, setPddUploadState] = useState<{
    open: boolean;
    mode: "create" | "edit";
    dcType: "Delivery Challan" | "Material Inspection Report";
    existingDoc?: PODeliveryDoc;
  }>({ open: false, mode: "create", dcType: "Delivery Challan" });

  // Map PO items for the upload dialog's item selector
  const poItemsForSelector = useMemo(() => {
    if (docType !== "Procurement Orders" || !documentData) return [];
    const poData = documentData as ProcurementOrder;
    return (poData.items || []).map(item => ({
      item_id: item.item_id,
      item_name: item.item_name,
      unit: item.unit,
      category: item.category,
      make: item.make,
      // Required: UploadDCMIRDialog filters PO items to billing_status === "Billable".
      // Omitting this made every item fail the filter, so DCs uploaded from the PO
      // detail page were saved with zero items (the hub mapping already includes it).
      billing_status: item.billing_status,
    }));
  }, [docType, documentData]);

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
      fields: ["name", "invoice_no", "invoice_date", "invoice_amount", "invoice_base_amount", "invoice_gst_amount", "invoice_attachment", "status", "reconciliation_status", "uploaded_by", "autofill_used", "is_credit_note"],
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
          await mutateGenerated(); // A signed upload's delete took its generated invoice with it
          await mutateAttachments(); // Refresh attachments
          await docMutate(); // Refresh the parent PO/SR document data
          // Mirror the create/edit refresh so the PO page dialogs and the Vendor
          // Invoice Recon tables reflect the deletion (they read separate SWR keys).
          globalMutate("Recon-Total-Invoiced-By-Document");
          // Also refresh the PO/WO Invoices reconciliation pages. They use a keyless
          // useFrappeGetCall, so the default SWR key is the request URL — match the
          // method name substring to invalidate it.
          globalMutate((key) => {
            const k = typeof key === "string" ? key : JSON.stringify(key ?? "");
            return k.includes("po_wise_invoice_data") || k.includes("sr_wise_invoice_data");
          });
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
    [docName, docType, deleteInvoiceEntryApi, toast, mutateInvoices, mutateGenerated, mutateAttachments, docMutate]
  );

  const handleEditInvoice = useCallback((invoice: VendorInvoice) => {
    setSelectedInvoice(invoice);
    toggleEditInvoiceDialog();
  }, [setSelectedInvoice, toggleEditInvoiceDialog]);

  // A WO invoice: a signed upload's is never edited; an Approved one only by Admin (the server's rule,
  // ADR-0014 Amendment A). PO invoices keep their old rule.
  const canEditInvoice = useCallback(
    (item: VendorInvoice): boolean =>
      !signedUploadInvoices.has(item.name) && (!isWorkOrder || item.status !== "Approved" || isAdmin),
    [signedUploadInvoices, isWorkOrder, isAdmin]
  );

  // Rejecting an Approved WO invoice is the correction path for everyone else (story 11).
  // The invoice being rejected, by name: the dialog reads the row from the fetched list, so it never shows
  // a copy older than the list (frontend/CODING_STANDARDS.md § Fetching or mutating data).
  const [rejectingName, setRejectingName] = useState<string | null>(null);
  const rejectingInvoice = useMemo(
    () => (rejectingName ? vendorInvoices?.find((vi) => vi.name === rejectingName) ?? null : null),
    [rejectingName, vendorInvoices]
  );
  const mayDecideInvoices = canActionInvoiceApprovals(role, user_id);
  const canRejectInvoice = useCallback(
    (item: VendorInvoice): boolean => isWorkOrder && item.status === "Approved" && mayDecideInvoices,
    [isWorkOrder, mayDecideInvoices]
  );

  const canDeleteInvoice = useCallback((item: VendorInvoice): boolean => {
    // Admins can delete any invoice, including Approved ones.
    if (isAdmin) return true;
    // Everyone else: only Pending or Rejected.
    return ["Pending", "Rejected"].includes(item?.status || "");
  }, [isAdmin]);

  // Legacy upload handlers removed — now using UploadDCMIRDialog

  // --- PDD Upload Handlers ---
  const handleOpenPDDUpload = useCallback((type: "DC" | "MIR") => {
    setPddUploadState({
      open: true,
      mode: "create",
      dcType: type === "DC" ? "Delivery Challan" : "Material Inspection Report",
    });
  }, []);

  const handlePDDEdit = useCallback((doc: PODeliveryDoc) => {
    setPddUploadState({
      open: true,
      mode: "edit",
      dcType: doc.type,
      existingDoc: doc,
    });
  }, []);

  const handlePDDUploadSuccess = useCallback(async () => {
    await mutatePDD();
    await mutateAttachments();
    await docMutate();
    await globalMutate(
      (key) => Array.isArray(key) && JSON.stringify(key).includes('Nirmaan Attachments'),
      undefined,
      { revalidate: true }
    );
  }, [mutatePDD, mutateAttachments, docMutate]);

  // --- PDD Delete ---
  // Admin + PMO + procurement + billing only. Deliberately NOT keyed off
  // `isEstimatesExecutive`: that prop is true for BOTH Estimates Executive and
  // Billing Executive (see PurchaseOrder.tsx `estimatesViewing`), and billing
  // must be able to delete a wrong DC/MIR even though it cannot upload one.
  // The role profile itself is what separates them.
  const canDeletePDD = useMemo(
    () => canDeleteDeliveryDocument(role, user_id),
    [role, user_id]
  );

  const [deletingPddName, setDeletingPddName] = useState<string | null>(null);

  const { call: deletePDDApi } = useFrappePostCall(
    "nirmaan_stack.api.po_delivery_documentss.delete_po_delivery_documents"
  );

  const handlePDDDelete = useCallback(
    async (doc: PODeliveryDoc) => {
      setDeletingPddName(doc.name);
      try {
        const response = await deletePDDApi({ document_name: doc.name });
        const result = response?.message;

        if (result?.status === 200) {
          toast({
            title: "Deleted",
            description: result.message,
            variant: "success",
          });
        } else {
          // 403 (role) / 404 (already gone in another tab) / 400 (server error).
          // A 404 still falls through to the refetch below so the stale row goes.
          toast({
            title: "Deletion Failed",
            description: result?.message || "Could not delete this document.",
            variant: "destructive",
          });
          if (result?.status === 403) return;
        }

        await mutatePDD();
        await mutateAttachments();
        await docMutate();
        // Material Usage tab, DN-vs-DC report and the DCs & MIRs report all read
        // PO Delivery Documents through their own SWR keys — without this they
        // keep showing the deleted row until a hard reload.
        await globalMutate(
          (key) =>
            (typeof key === "string" &&
              (key.includes("delivery_docs") || key.includes("po_delivery_documentss"))) ||
            (Array.isArray(key) && JSON.stringify(key).includes("Nirmaan Attachments")),
          undefined,
          { revalidate: true }
        );
      } catch (err: any) {
        toast({
          title: "Deletion Failed",
          description: err?.message || "Could not delete this document.",
          variant: "destructive",
        });
      } finally {
        setDeletingPddName(null);
      }
    },
    [deletePDDApi, toast, mutatePDD, mutateAttachments, docMutate]
  );

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

  // A DC/MIR cannot be filed against a Non-Billable PO (backend rejects it),
  // so the upload buttons are disabled with an explanatory tooltip.
  const isPONonBillable =
    isPO && (documentData as ProcurementOrder)?.billing_status === "Non-Billable";

  return (
    // PO page: Invoices, DC & MIR and MTC each take their own full-width row (owner, 2026-10-07).
    // The Work Order page also renders this component and keeps its two-column layout.
    <div
      className={
        isPO
          ? "grid gap-4 grid-cols-1"
          : `grid gap-4 lg:grid-cols-2 ${showDcTable && !isProjectManager ? "lg:grid-cols-2" : "lg:grid-cols-1"}`
      }
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
                {woGstOff && !isEstimatesExecutive && generatedState?.can_generate && (
                  <Button
                    disabled={!!generatedState.blocked}
                    title={generatedState.blocked ?? undefined}
                    size="sm"
                    className="text-primary border-primary hover:bg-primary/5"
                    variant="outline"
                    onClick={() => setIsGenerateDialogOpen(true)}
                  >
                    Generate Invoice
                  </Button>
                )}

                {!isEstimatesExecutive && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-primary border-primary hover:bg-primary/5"
                      onClick={() => { setNewInvoiceIsCredit(false); toggleNewInvoiceDialog(); }}
                      disabled={disabledAddInvoice || false}
                    >
                      <CirclePlus className="h-4 w-4 mr-1" /> Add Invoice
                    </Button>
                    {/* Credit notes are PO-only — never show Add Credit on WO/SR invoices. */}
                    {isPO && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-primary border-primary hover:bg-primary/5"
                        onClick={() => { setNewInvoiceIsCredit(true); toggleNewInvoiceDialog(); }}
                        disabled={disabledAddInvoice || false}
                      >
                        <CirclePlus className="h-4 w-4 mr-1" /> Add Credit
                      </Button>
                    )}
                  </>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {" "}
            {/* Remove padding to let table control it */}
            <div className="overflow-x-auto">
              {" "}
              {/* Ensure table scrolls horizontally if needed */}
              <InvoiceTable
                items={vendorInvoices} // Use Vendor Invoices instead of JSON data
                onViewAttachment={handleViewInvoiceAttachment}
                onEditEntry={mayEditInvoices ? handleEditInvoice : undefined}
                canEditEntry={canEditInvoice}
                onRejectEntry={(invoice) => setRejectingName(invoice.name)}
                canRejectEntry={canRejectInvoice}
                onDeleteEntry={handleDeleteInvoiceEntry}
                isLoading={deleteInvoiceEntryLoading}
                canDeleteEntry={canDeleteInvoice}
                getDeleteNote={signedUploadDeleteNote}
                getUserName={getUserName}
                hideActions={isEstimatesExecutive}
                poName={isPO ? docName : undefined}
              />
            </div>
            {isWorkOrder && generatedInvoices.length > 0 && (
              <div className="overflow-x-auto border-t border-gray-200">
                <GeneratedInvoicesTable
                  workOrder={docName}
                  invoices={generatedInvoices}
                  canManage={!!generatedState?.can_generate && !isEstimatesExecutive}
                  canDelete={!!generatedState?.can_delete && !isEstimatesExecutive}
                  onPrint={setInvoicePreview}
                  onChanged={() => {
                    mutateGenerated();
                    mutateInvoices();
                  }}
                />
              </div>
            )}
            <RejectApprovedInvoiceDialog
              invoice={rejectingInvoice}
              onClose={() => setRejectingName(null)}
              onRejected={() => {
                mutateInvoices();
                mutateGenerated();
                docMutate();
              }}
            />
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
                    {pddDocs?.length ?? dcAttachments.length}
                  </Badge>
                </div>
                {isPO && showDcTable && !isEstimatesExecutive && (
                  <TooltipProvider>
                    <div className="flex gap-2 items-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0}>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenPDDUpload("DC")}
                              className="text-primary border-primary hover:bg-primary/5"
                              aria-label="Upload Delivery Challan"
                              disabled={isPONonBillable}
                            >
                              <CirclePlus className="h-4 w-4 mr-1" aria-hidden="true" />
                              Upload DC
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {isPONonBillable && (
                          <TooltipContent>This PO is Non-Billable</TooltipContent>
                        )}
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0}>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenPDDUpload("MIR")}
                              className="text-primary border-primary hover:bg-primary/5"
                              aria-label="Upload Material Inspection Report"
                              disabled={isPONonBillable}
                            >
                              <Upload className="h-4 w-4 mr-1" aria-hidden="true" />
                              Upload MIR
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {isPONonBillable && (
                          <TooltipContent>This PO is Non-Billable</TooltipContent>
                        )}
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <DeliveryChallanTable
                  documents={pddDocs || []}
                  onEdit={handlePDDEdit}
                  onDelete={handlePDDDelete}
                  canDelete={() => canDeletePDD}
                  deletingName={deletingPddName}
                  getUserName={getUserName}
                />
              </div>
            </CardContent>
          </Card>
        )
      }

      {/* Material Test Certificates: the same viewers as the DC & MIR card, Billable POs only
          (MTCCard renders nothing otherwise). Always its own full-width row. */}
      {isPO && !isPMUserChallans && documentData && (
        <MTCCard po={documentData as ProcurementOrder} className="col-span-full" />
      )}

      {isWorkOrder && docName && (
        <GenerateInvoiceDialog
          open={isGenerateDialogOpen}
          onOpenChange={setIsGenerateDialogOpen}
          workOrder={docName}
          woAmount={Number(workOrder?.total_amount) || 0}
          state={generatedState}
          onGenerated={(row) => {
            mutateGenerated();
            setInvoicePreview(row);
          }}
        />
      )}

      {/* Generated invoice preview: the PDF reads the saved record. */}
      <ReportPreviewDialog
        open={!!invoicePreview}
        onOpenChange={(open) => {
          if (!open) setInvoicePreview(null);
        }}
        pdfUrl={invoicePreview ? generatedInvoicePdfUrl(invoicePreview.name) : ""}
        title={`Invoice ${invoicePreview?.invoice_no || ""}`}
        fileName={`${invoicePreview?.invoice_no || "invoice"}_${project?.project_name || "Project"}.pdf`}
        canDownload
        closeOnDownload
      />

      {/* Upload DC/MIR Dialog (new structured dialog with items + signature) */}
      <UploadDCMIRDialog
        open={pddUploadState.open}
        onOpenChange={(open) => {
          if (!open) setPddUploadState({ open: false, mode: "create", dcType: "Delivery Challan" });
        }}
        mode={pddUploadState.mode}
        dcType={pddUploadState.dcType}
        poName={docName}
        poDisplayName={docName ? `PO-${docName.split("/")[1]}` : ""}
        poProject={documentData?.project || ""}
        poVendor={(documentData as ProcurementOrder)?.vendor || ""}
        poItems={poItemsForSelector}
        existingDoc={pddUploadState.existingDoc}
        onSuccess={handlePDDUploadSuccess}
      />
    </div>
  );
};
