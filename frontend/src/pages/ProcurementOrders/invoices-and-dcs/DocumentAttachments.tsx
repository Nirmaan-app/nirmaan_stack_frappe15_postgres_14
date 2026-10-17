import { useMemo, useCallback, useState } from "react";
import { KeyedMutator, mutate as globalMutate } from "swr";
import {
  FrappeDoc,
  useFrappeGetDocList,
  useFrappePostCall,
  useFrappeUpdateDoc,
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
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CirclePlus, Upload, Plus } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import formatToIndianRupee from "@/utils/FormatPrice";
import { Projects } from "@/types/NirmaanStack/Projects";
import { usePODeliveryDocuments } from "@/pages/DeliveryChallansAndMirs/hooks/usePODeliveryDocuments";
import { UploadDCMIRDialog } from "@/pages/DeliveryChallansAndMirs/components/UploadDCMIRDialog";
import type { PODeliveryDocuments as PODeliveryDoc } from "@/types/NirmaanStack/PODeliveryDocuments";
import { canDeleteDeliveryDocument } from "@/constants/roles";
import { MTCCard } from "@/pages/MaterialTestCertificates/components/MTCCard";
import { ReportPreviewDialog } from "@/pages/CommissionReport/components/ReportPreviewDialog";

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

/** A WO tax invoice bills part of the WO (a running "RA" bill) or all of it (FINAL). */
type SrInvoiceType = "Partial" | "Full";

interface SrInvoiceDialogData {
  invoice_type: SrInvoiceType;
  invoice_date: string; // yyyy-MM-dd
  ra_no: string; // digits only; Partial only
  amount: string; // Partial only: the amount this RA bill charges
  percent: string; // Partial only: amount as a % of the WO amount, kept in step with `amount`
}

const initialSrInvoiceDialogData: SrInvoiceDialogData = {
  invoice_type: "Partial",
  invoice_date: formatDate(new Date(), "yyyy-MM-dd"), // Default to today
  ra_no: "",
  amount: "",
  percent: "",
};

/** n rounded to 2 decimals, without trailing zeros: 420000 -> "420000", 33.3333 -> "33.33". */
const toTwoDecimals = (n: number): string => String(Math.round(n * 100) / 100);

/** A Partial's Percentage and Amount after one of them is typed: the other follows through the WO
 *  amount. Blank or unusable input (or a WO amount of 0) blanks the other box. */
const syncPercentAmount = (
  field: "percent" | "amount",
  value: string,
  woAmount: number
): { percent: string; amount: string } => {
  const n = Number(value);
  const canSync = value !== "" && Number.isFinite(n) && woAmount > 0;
  return field === "percent"
    ? { percent: value, amount: canSync ? toTwoDecimals((woAmount * n) / 100) : "" }
    : { amount: value, percent: canSync ? toTwoDecimals((n / woAmount) * 100) : "" };
};

/** The April–March financial year of a yyyy-MM-dd date as "26-27". */
const financialYearCode = (isoDate: string): string => {
  const [year, month] = isoDate.split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  const yy = (y: number) => String(y % 100).padStart(2, "0");
  return `${yy(start)}-${yy(start + 1)}`;
};

/** A WO tax invoice's number: INV-<FY>-<project last 5>-<WO last 5>-<RA-n | FINAL>. */
const buildSrInvoiceNumber = (
  sr: { name: string; project: string },
  data: SrInvoiceDialogData
): string => {
  const suffix = data.invoice_type === "Full" ? "FINAL" : `RA-${data.ra_no}`;
  return `INV-${financialYearCode(data.invoice_date)}-${sr.project.slice(-5)}-${sr.name.slice(-5)}-${suffix}`;
};

/** Why the dialog can't make the invoice yet, or null. A Partial amount must be under the WO amount. */
const srInvoiceProblem = (data: SrInvoiceDialogData, woAmount: number): string | null => {
  if (!data.invoice_date) return "Invoice Date is required.";
  if (data.invoice_type === "Full") return null;
  if (!/^[1-9]\d*$/.test(data.ra_no)) return "Enter the RA No. as a whole number (1, 2, 3…).";
  const amount = Number(data.amount);
  if (!data.amount || !(amount > 0)) return "Enter an amount more than 0.";
  if (Math.round(amount * 100) >= Math.round(woAmount * 100)) {
    return `Amount must be less than the WO amount (${formatToIndianRupee(woAmount)}). Use Full for the whole WO.`;
  }
  return null;
};

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
  const isAccountant = role === "Nirmaan Accountant Profile" || role === "Nirmaan Accountant Lead Profile" || role === "Nirmaan Admin Profile";
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

  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [invoiceDialogData, setInvoiceDialogData] =
    useState<SrInvoiceDialogData>(initialSrInvoiceDialogData);

  const [isPreparingInvoice, setIsPreparingInvoice] = useState(false);
  // The generated tax invoice open in the in-app preview, or null.
  const [invoicePreview, setInvoicePreview] = useState<{
    url: string;
    invoiceNo: string;
    fileName: string;
  } | null>(null);

  const { updateDoc } = useFrappeUpdateDoc();

  // The WO amount a Partial invoice must stay under: Σ qty × rate, what a Full invoice totals.
  const woAmount = useMemo(() => {
    if (docType !== "Service Requests") return 0;
    return ((documentData as ServiceRequests | null | undefined)?.work_order_items || []).reduce(
      (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.rate) || 0),
      0
    );
  }, [docType, documentData]);

  const invoiceProblem = srInvoiceProblem(invoiceDialogData, woAmount);
  const invoiceNumberPreview =
    documentData && invoiceDialogData.invoice_date
      ? buildSrInvoiceNumber(documentData, invoiceDialogData)
      : "--";

  // Open the dialog as Partial, keeping the WO's saved invoice date (else today).
  const openInvoiceDialog = () => {
    setInvoiceDialogData({
      ...initialSrInvoiceDialogData,
      invoice_date:
        (documentData as ServiceRequests | null | undefined)?.invoice_date ||
        formatDate(new Date(), "yyyy-MM-dd"),
    });
    setIsPrintDialogOpen(true);
  };

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
    [docName, docType, deleteInvoiceEntryApi, toast, mutateInvoices, mutateAttachments, docMutate]
  );

  const handleEditInvoice = useCallback((invoice: VendorInvoice) => {
    setSelectedInvoice(invoice);
    toggleEditInvoiceDialog();
  }, [setSelectedInvoice, toggleEditInvoiceDialog]);

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

  const handleInvoiceDialogInputChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const { name, value } = e.target;
    // RA No. takes digits only.
    if (name === "ra_no") {
      setInvoiceDialogData((prev) => ({ ...prev, ra_no: value.replace(/\D/g, "") }));
      return;
    }
    // Percentage and Amount follow each other through the WO amount; the amount is what is billed.
    if (name === "percent" || name === "amount") {
      setInvoiceDialogData((prev) => ({ ...prev, ...syncPercentAmount(name, value, woAmount) }));
      return;
    }
    setInvoiceDialogData((prev) => ({ ...prev, [name]: value }));
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
    if (invoiceProblem) {
      toast({
        title: "Missing Info",
        description: invoiceProblem,
        variant: "destructive",
      });
      return;
    }
    const isPartial = invoiceDialogData.invoice_type === "Partial";
    const invoiceNo = buildSrInvoiceNumber(documentData, invoiceDialogData);

    try {
      // 1. Save invoice_no and invoice_date to the Service Request document
      setIsPreparingInvoice(true); // Use a general loading state for this combined action
      await updateDoc("Service Requests", documentData.name, {
        invoice_no: invoiceNo,
        invoice_date: invoiceDialogData.invoice_date,
      });

      // Mutate to get the latest SR doc (which now includes the saved invoice no/date)
      await docMutate();
      toast({
        title: "Info Saved",
        description: "Invoice number and date saved to Service Request.",
        variant: "success",
      });

      // 2. Construct print URL. Invoice no/date are on the doc; the invoice type, and a Partial's
      // RA No. and amount, are stored nowhere and reach "SR Invoice" as custom_* params.
      const params = {
        doctype: "Service Requests",
        name: documentData.name,
        format: "SR Invoice", // Your print format name
        no_letterhead: "1",
        _lang: "en",
      };

      const customParams: Record<string, string> = {};
      customParams["custom_project_name"] = project?.project_name || "";
      customParams["custom_invoice_type"] = invoiceDialogData.invoice_type;
      if (isPartial) {
        customParams["custom_ra_no"] = invoiceDialogData.ra_no;
        customParams["custom_amount"] = invoiceDialogData.amount;
      }

      const allParams = { ...params, ...customParams };
      const queryString = new URLSearchParams(allParams).toString();

      if (action === "preview") {
        // Shown in-app (ReportPreviewDialog fetches it), with its own Download button.
        setInvoicePreview({
          url: `/api/method/frappe.utils.print_format.download_pdf?${queryString}`,
          invoiceNo,
          fileName: `${invoiceNo}_${project?.project_name || "Project"}.pdf`,
        });
        setIsPrintDialogOpen(false);
      } else {
        // download with custom filename
        setIsPreparingInvoice(true); // show loading state while downloading
        try {
          const downloadUrl = `/api/method/frappe.utils.print_format.download_pdf?${queryString}`;
          const response = await fetch(downloadUrl);
          if (!response.ok) throw new Error("Failed to generate PDF");

          const blob = await response.blob();
          const fileName = `${invoiceNo}_${project?.project_name || "Project"}.pdf`;

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
      setIsPreparingInvoice(false);
    }
  };

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
                {docType === "Service Requests" && !isEstimatesExecutive &&
                  (documentData as ServiceRequests)?.gst !== "true" && (
                    <Button
                      disabled={!documentData?.project_gst} // Keep your existing disabled logic
                      size="sm"
                      className="text-primary border-primary hover:bg-primary/5"
                      variant="outline"
                      onClick={openInvoiceDialog}
                    >
                      Generate Tax Invoice
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
                onEditEntry={isAccountant ? handleEditInvoice : undefined}
                onDeleteEntry={handleDeleteInvoiceEntry}
                isLoading={deleteInvoiceEntryLoading}
                canDeleteEntry={canDeleteInvoice}
                getUserName={getUserName}
                hideActions={isEstimatesExecutive}
                poName={isPO ? docName : undefined}
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

      <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="border-b pb-4">
            <DialogTitle>
              Invoice Details for SR: {documentData?.name}
            </DialogTitle>
            <DialogDescription>
              Choose the invoice type and date. These details will be saved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 pt-2 pb-6">
            <div className="space-y-1.5">
              <Label>
                Invoice Type <span className="text-destructive">*</span>
              </Label>
              <RadioGroup
                value={invoiceDialogData.invoice_type}
                onValueChange={(value) =>
                  setInvoiceDialogData((prev) => ({ ...prev, invoice_type: value as SrInvoiceType }))
                }
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="Partial" id="invoice_type_partial" />
                  <Label htmlFor="invoice_type_partial" className="font-normal">Partial</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="Full" id="invoice_type_full" />
                  <Label htmlFor="invoice_type_full" className="font-normal">Full</Label>
                </div>
              </RadioGroup>
            </div>
            {/* Invoice Date and RA No. side by side */}
            <div className="grid grid-cols-2 gap-4">
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
              <div className="space-y-1.5">
                <Label htmlFor="ra_no">
                  RA No.{" "}
                  {invoiceDialogData.invoice_type === "Partial" && (
                    <span className="text-destructive">*</span>
                  )}
                </Label>
                {invoiceDialogData.invoice_type === "Partial" ? (
                  <Input
                    id="ra_no"
                    name="ra_no"
                    inputMode="numeric"
                    value={invoiceDialogData.ra_no}
                    onChange={handleInvoiceDialogInputChange}
                    placeholder="e.g., 1"
                  />
                ) : (
                  <Input id="ra_no" value="FINAL" disabled />
                )}
              </div>
            </div>
            {invoiceDialogData.invoice_type === "Partial" && (
              <div className="space-y-1.5">
                {/* Percentage and Amount side by side, each filling the other */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="percent">
                      Percentage (%) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="percent"
                      name="percent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={invoiceDialogData.percent}
                      onChange={handleInvoiceDialogInputChange}
                      placeholder="e.g., 20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="amount">
                      Amount (₹) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="amount"
                      name="amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={invoiceDialogData.amount}
                      onChange={handleInvoiceDialogInputChange}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  WO amount {formatToIndianRupee(woAmount)}. The amount must be less.
                </p>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-sm">
                Invoice No: <span className="font-semibold">{invoiceNumberPreview}</span>
              </p>
              {invoiceProblem && (invoiceDialogData.ra_no || invoiceDialogData.amount || invoiceDialogData.percent) && (
                <p className="text-xs text-destructive">{invoiceProblem}</p>
              )}
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
              disabled={isPreparingInvoice || !!invoiceProblem}
            >
              Preview Invoice
            </Button>
            <Button
              type="button"
              onClick={() => handleGenerateAndProceed("download")}
              disabled={isPreparingInvoice || !!invoiceProblem}
            >
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tax invoice preview, with Download */}
      <ReportPreviewDialog
        open={!!invoicePreview}
        onOpenChange={(open) => {
          if (!open) setInvoicePreview(null);
        }}
        pdfUrl={invoicePreview?.url || ""}
        title={`Tax Invoice ${invoicePreview?.invoiceNo || ""}`}
        fileName={invoicePreview?.fileName || "invoice.pdf"}
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
