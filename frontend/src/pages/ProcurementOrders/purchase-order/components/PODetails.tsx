import { usePOValidation } from "@/hooks/usePOValidation";
import { useUserData } from "@/hooks/useUserData";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, {
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import { useDialogStore } from "@/zustand/useDialogStore";
import {
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappePostCall,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { mutate as globalMutate } from "swr";
import {
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  CircleX,
  Download,
  Eye,
  FilePenLine,
  FileText,
  Mail,
  Paperclip,
  MessageSquare,
  Phone,
  PackageCheck,
  Trash2Icon,
  TriangleAlert,
  Undo2,
  Upload,
} from "lucide-react";
import { useCriticalPOTaskLinking } from "../hooks/useCriticalPOTaskLinking";
import { CriticalPOTaskLinkingSection } from "./CriticalPOTaskLinkingSection";
import { DispatchItemSelector } from "./DispatchItemSelector";
import { LinkedCriticalPOTag } from "./LinkedCriticalPOTag";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import React, { useCallback, useState, useMemo } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate } from "react-router-dom";
import { VendorHoverCard } from "@/components/helpers/vendor-hover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { ValidationIndicator } from "@/components/validations/ValidationIndicator";
import { ValidationMessages } from "@/components/validations/ValidationMessages";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import SITEURL from "@/constants/siteURL";
import { UploadDCMIRDialog } from "@/pages/DeliveryChallansAndMirs/components/UploadDCMIRDialog";
import { CEOHoldBanner } from "@/components/ui/ceo-hold-banner";
import { useVendorHoldGuard } from "@/hooks/useVendorHoldGuard";
import { VendorHoldBanner } from "@/components/ui/vendor-hold-banner";
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";
import { POAdjustmentButton } from "@/pages/POAdjustment/POAdjustmentButton";
import { PORevisionDialog } from "@/pages/PORevision/PORevisionDialog";
import { usePOLockCheck } from "@/pages/PORevision/data/usePORevisionQueries";

interface PODetailsProps {
  po: ProcurementOrder | null;
  summaryPage: boolean;
  accountsPage: boolean;
  estimatesViewing: boolean;
  poPayments: ProjectPayments[] | undefined;
  togglePoPdfSheet: () => void;
  getTotal?: {
    total: number
    totalAmt: number
  }
  amountPaid: number
  totalInvoice?: number;
  poMutate: any;
  toggleRequestPaymentDialog: () => void;
  totalUploadedInvoiceAmount?: number;
  totalPendingInvoiceAmount?: number;
  totalApprovedInvoiceAmount?: number;
  onAdjustPayments?: () => void;
  onCancelPO?: () => void;
}


export const PODetails: React.FC<PODetailsProps> = ({
  po,
  summaryPage,
  accountsPage,
  estimatesViewing,
  poPayments,
  togglePoPdfSheet,
  // getTotal,
  amountPaid,
  totalInvoice,
  poMutate,
  toggleRequestPaymentDialog,
  totalUploadedInvoiceAmount,
  totalPendingInvoiceAmount,
  totalApprovedInvoiceAmount,
  onAdjustPayments,
  onCancelPO,
}) => {
  if (!po) return <div>No PO ID Provided</div>;


  const { role } = useUserData();
  const isProjectManager = role === "Nirmaan Project Manager Profile";
  const { errors, isValid, hasVendorIssues } = usePOValidation(po);
  const { isCEOHold, showBlockedToast } = useCEOHoldGuard(po?.project);
  const { isOnHold: isVendorOnHold, showBlockedToast: showVendorBlockedToast, availableCredit } = useVendorHoldGuard(po?.vendor);

  const { updateDoc, loading: update_loading } = useFrappeUpdateDoc();
  const { call: deleteCustomPOCall, loading: deleteCustomPOCallLoading } =
    useFrappePostCall(
      "nirmaan_stack.api.delete_custom_po_and_pr.delete_custom_po"
    );
  const navigate = useNavigate();

  // console.log("po", po);

  // const { data: pr } = useFrappeGetDoc<ProcurementRequest>(
  //   "Procurement Requests",
  //   po?.procurement_request,
  //   po ? undefined : null
  // );

  // Fetch vendor quote attachment for this PO's PR + vendor
  const { data: vendorQuoteAttachment } = useFrappeGetDocList<NirmaanAttachment>(
    "Nirmaan Attachments",
    {
      fields: ["name", "attachment", "creation"],
      filters: [
        ["associated_doctype", "=", "Procurement Requests"],
        ["associated_docname", "=", po?.procurement_request],
        ["attachment_link_docname", "=", po?.vendor],
        ["attachment_type", "=", "Vendor Quote"],
      ],
      orderBy: { field: "creation", order: "desc" },
      limit: 1,
    },
    po?.procurement_request && po?.vendor ? undefined : null
  );

  const [contactPerson, setContactPerson] = useState({
    name: "",
    number: "",
  });


  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  // PO Revision Lock status fetch using SWR hook
  const { data: lockData } = usePOLockCheck(po?.name);
  const isItemLocked = lockData?.is_item_locked || false;
  const isPaymentLocked = lockData?.is_payment_locked || false;

  const [inactiveDialog, setInactiveDialog] = useState(false);

  const toggleInactiveDialog = useCallback(() => {
    setInactiveDialog((prevState) => !prevState);
  }, []); // No dependencies needed for simple toggle

  const { toggleNewInvoiceDialog } = useDialogStore();

  // PDD Upload dialog state (new structured flow)
  const [pddUploadState, setPddUploadState] = useState<{
    open: boolean;
    mode: "create" | "edit";
    dcType: "Delivery Challan" | "Material Inspection Report";
  }>({ open: false, mode: "create", dcType: "Delivery Challan" });

  const handleOpenPDDUpload = useCallback((type: "DC" | "MIR") => {
    setPddUploadState({
      open: true,
      mode: "create",
      dcType: type === "DC" ? "Delivery Challan" : "Material Inspection Report",
    });
  }, []);

  const handlePDDUploadSuccess = useCallback(async () => {
    await poMutate();
    await globalMutate(
      (key) => Array.isArray(key) && JSON.stringify(key).includes("Nirmaan Attachments"),
      undefined,
      { revalidate: true }
    );
    invalidateSidebarCounts();
  }, [poMutate]);

  const poItemsForSelector = useMemo(() => {
    if (!po?.items) return [];
    return po.items.map(item => ({
      item_id: item.item_id,
      item_name: item.item_name,
      unit: item.unit,
      category: item.category,
      make: item.make,
    }));
  }, [po?.items]);

  const [dispatchPODialog, setDispatchPODialog] = useState(false);
  const toggleDispatchPODialog = useCallback(() => {
    setDispatchPODialog((prevState) => !prevState);
  }, []);

  const [revertDialog, setRevertDialog] = useState(false);
  const toggleRevertDialog = useCallback(() => {
    setRevertDialog((prevState) => !prevState);
  }, []);

  const [deleteDialog, setDeleteDialog] = useState(false);
  const toggleDeleteDialog = useCallback(() => {
    setDeleteDialog((prevState) => !prevState);
  }, []);

  // Critical PO Task Linking states
  const [contactSectionExpanded, setContactSectionExpanded] = useState(false);
  const [dispatchConfirmDialog, setDispatchConfirmDialog] = useState(false);

  const [selectedDispatchItems, setSelectedDispatchItems] = useState<string[]>([]);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>("");

  const { data: dnCountForPO } = useFrappeGetDocList("Delivery Notes", {
    filters: [["procurement_order", "=", po?.name || ""]],
    fields: ["name"],
    limit: 1,
  }, ["Dispatched", "Partially Dispatched"].includes(po?.status || "") ? undefined : null);

  const hasDNsForPO = (dnCountForPO || []).length > 0;

  // Critical PO Task Linking hook
  const criticalPOLinking = useCriticalPOTaskLinking({
    projectId: po?.project || "",
    poName: po?.name || "",
    enabled: dispatchPODialog && !!po?.project,
  });

  const [openRevisionDialog, setOpenRevisionDialog] = useState(false);

  const handlePhoneChange = useCallback((e: any) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 10);
    setPhoneNumber(value);
  }, []);

  const handleEmailChange = useCallback((e: any) => {
    setEmail(e.target.value);
  }, []);

  const handleDispatchSelectionChange = useCallback((selectedNames: string[]) => {
    setSelectedDispatchItems(selectedNames);
  }, []);

  const handleDispatchPO = async () => {
    if (isVendorHoldBlocked) {
      showVendorBlockedToast();
      return;
    }
    if (isCEOHold) {
      showBlockedToast();
      return;
    }
    try {
      // Link PO to newly selected critical PO tasks (add-only)
      if (criticalPOLinking.hasCriticalPOSetup && criticalPOLinking.selectedTasks.length > 0) {
        const linkResult = await criticalPOLinking.linkPOToTasks();
        if (!linkResult.success) {
          return;
        }
      }

      // Build items update — mark selected items as dispatched
      const updatedItems = po.items.map((item) => ({
        ...item,
        is_dispatched: item.is_dispatched || selectedDispatchItems.includes(item.name) ? 1 : 0,
      }));

      // Determine new status — accounts for existing deliveries
      const dispatchableItems = updatedItems.filter((i) => i.category !== "Additional Charges");
      const allDispatched = dispatchableItems.every((i) => i.is_dispatched);

      let newStatus: string;
      if (!allDispatched) {
        newStatus = "Partially Dispatched";
      } else {
        // All dispatched — check delivery progress (mirrors backend calculate_order_status)
        const DELTA = 2.5;
        let totalItems = 0;
        let deliveredItems = 0;
        let anyReceived = false;

        for (const item of dispatchableItems) {
          totalItems++;
          const qty = Number(item.quantity) || 0;
          const received = Number(item.received_quantity) || 0;
          if (received > 0) anyReceived = true;

          const isFloat = qty % 1 !== 0 || received % 1 !== 0;
          const isDelivered = isFloat
            ? received >= qty - (qty * DELTA) / 100
            : received >= qty;

          if (isDelivered) deliveredItems++;
        }

        if (deliveredItems === totalItems && totalItems > 0) {
          newStatus = "Delivered";
        } else if (anyReceived) {
          newStatus = "Partially Delivered";
        } else {
          newStatus = "Dispatched";
        }
      }

      // Build update payload
      const updateData: Record<string, any> = {
        items: updatedItems,
        status: newStatus,
        dispatch_date: new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
        expected_delivery_date: expectedDeliveryDate || null,
      };

      if (contactPerson.name || contactPerson.number) {
        updateData.delivery_contact = `${contactPerson.name}:${contactPerson.number}`;
      }

      await updateDoc("Procurement Orders", po.name, updateData);
      await poMutate();
      invalidateSidebarCounts();

      toast({
        title: "Success!",
        description: `PO: ${po.name} status updated to '${newStatus}' successfully!`,
        variant: "success",
      });

      criticalPOLinking.resetSelection();
      setDispatchConfirmDialog(false);
      setSelectedDispatchItems([]);
      setExpectedDeliveryDate("");
      toggleDispatchPODialog();

      const statusToTab: Record<string, string> = {
        "Dispatched": "Dispatched+PO",
        "Partially Dispatched": "Partially+Dispatched+PO",
        "Partially Delivered": "Partially+Delivered+PO",
        "Delivered": "Delivered+PO",
      };
      const tabParam = statusToTab[newStatus] || "Dispatched+PO";
      navigate(`/purchase-orders/${po.name.replaceAll("/", "&=")}?tab=${tabParam}`);
    } catch (error: any) {
      console.log("error while updating the status of the PO to dispatch", error?.message);
      toast({
        title: "Failed!",
        description: `PO: ${po.name} Updation Failed!`,
        variant: "destructive",
      });
    }
  };

  // Handle the "Mark as Dispatched" button click
  // Note: Button is disabled when task selection is mandatory but not selected
  const handleMarkAsDispatchedClick = useCallback(() => {
    setDispatchConfirmDialog(true);
  }, []);

  const handleRevertPO = async () => {
    if (isCEOHold) {
      showBlockedToast();
      return;
    }
    if (isVendorHoldBlocked) {
      showVendorBlockedToast();
      return;
    }
    if (isItemLocked) {
      toast({
        title: "Cannot revert",
        description: "This PO has a pending revision. Complete or cancel it first.",
        variant: "destructive",
      });
      return;
    }
    if (hasDNsForPO) {
      toast({
        title: "Cannot revert",
        description: "Delivery Notes exist for this PO. Delete them first to revert.",
        variant: "destructive",
      });
      return;
    }
    try {
      await updateDoc("Procurement Orders", po.name, {
        status: "PO Approved",
        delivery_contact: null,
        dispatch_date: null,
        expected_delivery_date: null,
      });

      await poMutate();
      invalidateSidebarCounts();

      toggleRevertDialog();

      toast({
        title: "Success!",
        description: `PO: ${po.name} Reverted back to PO Approved!`,
        variant: "success",
      });

      navigate(`/purchase-orders/${po.name.replaceAll("/", "&=")}?tab=Approved+PO`);
    } catch (error) {
      toggleRevertDialog();

      toast({
        title: "Failed!",
        description: `PO: ${po.name} Revert Failed!`,
        variant: "destructive",
      });
    }
  };

  const handleDeleteCustomPO = async () => {
    if (isCEOHold) {
      showBlockedToast();
      return;
    }
    try {
      const response = await deleteCustomPOCall({
        po_id: po.name,
      });

      if (response.message.status === 200) {
        // ✅ Step 4: Success message & UI updates (Batch State Updates)
        invalidateSidebarCounts();
        toast({
          title: "Delete Successful!",
          description: response.message.message,
          variant: "success",
        });

        navigate(`/purchase-orders`);
      } else if (response.message.status === 400) {
        toast({
          title: "Error!",
          description: response.message.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error while deleting customo PO:", error);
      toast({
        title: "Error!",
        description: "Failed to delete custom PO. Please try again.",
        variant: "destructive",
      });
    }
  };


  const downloadurl =
    "http://localhost:8000/api/method/frappe.utils.print_format.download_pdf";

  const viewUrl = "http://localhost:8000/printview";

  // const { call: triggerPdfDownload, loading } = useFrappePostCall('nirmaan_stack.api.download_po_pdf.download_po_pdf');

  const handleDownloadPdf = async (poId: string) => {
    // try {
    //     // This call will initiate a download, not return data to JS
    //     await triggerPdfDownload({
    //         doctype: "Procurement Orders",
    //         name: poId,
    //         print_format: "PO Invoice 6" // Your print format name
    //     });
    //     // You might not get a success callback here if the download starts immediately
    // } catch (error) {
    //     console.error("Error triggering PDF download:", error);
    //     toast({ title: "PDF Download Failed", variant: "destructive" });
    // }
    const params = {
      doctype: "Procurement Orders",
      name: poId,
      format: "PO Invoice", // Your print format name
      no_letterhead: "1", // Or "1" if your template includes full letterhead
      letterhead: "No Letterhead", // Or "No Letterhead" if your template includes full letterhead
      settings: "{}", // Or "{}" if your template has custom settings
      _lang: "en", // Or "_lang=en" if your template is in English
      // Add other params like 'letterhead' if needed
    };
    const url = `${downloadurl}?${new URLSearchParams(params)}`;
    const view = `${viewUrl}?${new URLSearchParams(params)}`;

    window.open(url, "_blank");
    // window.open(view, '_blank');
  };

  // ... existing functions (handleDispatchPO, handleRevertPO, handleDeleteCustomPO) ...

  const handleInactivePO = async () => {
    try {
      await updateDoc("Procurement Orders", po.name, {
        status: "Inactive", // Set the new status
      });

      await poMutate(); // Re-fetch PO data to update the UI
      invalidateSidebarCounts();

      toast({
        title: "Success!",
        description: `PO: ${po.name} has been marked as 'Inactive'.`,
        variant: "success",
      });
      toggleInactiveDialog(); // Close the dialog whether successful or not
      // Redirect to a suitable page, e.g., the main purchase orders list
      navigate(`/purchase-orders`); // Or specific tab if applicable, e.g., /purchase-orders?tab=Inactive+PO
    } catch (error: any) { // Type 'any' for error caught from Frappe hook
      console.error("Error while inactivating PO:", error);
      toast({
        title: "Failed!",
        description: `Failed to mark PO: ${po.name} as Inactive. Error: ${error.message || 'Unknown error'}`,
        variant: "destructive",
      });
    }
  };

  const isVendorHoldBlocked = isVendorOnHold && po?.status === "PO Approved";

  const PoPaymentTermsValidationSafe = poPayments?.some(
    (term) => term.status === "Requested" || term.status === "Approved"
  ) || false;

  return (
    <div>
      {isCEOHold && <CEOHoldBanner className="mb-4" />}
      {isVendorOnHold && (
        <VendorHoldBanner vendorName={po?.vendor_name} availableCredit={availableCredit} className="mb-4" />
      )}
      <Card className="rounded-sm shadow-m col-span-3 overflow-x-auto">
        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 1: HEADER - Title with validation warning
        ═══════════════════════════════════════════════════════════════════ */}
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-red-600 flex items-center gap-2">
              PO Details
              {!isValid && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button>
                      <TriangleAlert className="text-primary w-5 h-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className="bg-background border border-border text-foreground w-80"
                  >
                    <ValidationMessages
                      title="Required Before Proceeding"
                      errors={errors}
                    />
                  </TooltipContent>
                </Tooltip>
              )}
            </h1>
            {/* Approved By / Merged PO - right aligned */}
            {po?.merged === "true" ? (
              <Badge variant="orange" className="font-semibold">Merged PO</Badge>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Approved By</span>
                <Badge variant="outline" className="font-normal">{po?.owner}</Badge>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-0 space-y-4">
          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 2: INFO - Vendor, Package, Status
          ═══════════════════════════════════════════════════════════════════ */}
          <div className="pb-3 border-b border-gray-100 space-y-3">
            {/* Row 1: Vendor, Package, Status */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              {/* Vendor */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Vendor</span>
                <VendorHoverCard vendor_id={po?.vendor} />
                <Separator orientation="vertical" className="h-5 hidden sm:block" />
                {vendorQuoteAttachment?.[0]?.attachment && (
                  <a
                    href={`${SITEURL}${vendorQuoteAttachment[0].attachment}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-800 hover:underline border border-green-200 rounded-md px-2 py-0.5"
                  >
                    <Paperclip className="h-3 w-3" />
                    Vendor Quote
                  </a>
                )}
                {hasVendorIssues && (
                  <ValidationIndicator
                    error={errors.find((e) => e.code === "INCOMPLETE_VENDOR")}
                  />
                )}
              </div>

              <Separator orientation="vertical" className="h-5 hidden sm:block" />

              {/* Status */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Status</span>
                <Badge
                  variant={
                    po?.status === "PO Approved"
                      ? "default"
                      : ["Dispatched", "Partially Dispatched"].includes(po?.status || "")
                        ? "orange"
                        : po?.status === "Inactive" ? "red" : "green"
                  }
                >
                  {po?.status}
                </Badge>
              </div>
            </div>

            {/* Row 2: Critical PO Tag - below vendor info */}
            <LinkedCriticalPOTag
              poName={po?.name || ""}
              projectId={po?.project || ""}
              onUpdate={poMutate}
              canEdit={["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile", "Nirmaan Procurement Executive Profile"].includes(role)}
            />
          </div>

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 3: AMOUNTS - All financial figures (hidden for Project Manager)
          ═══════════════════════════════════════════════════════════════════ */}
          {!isProjectManager && (
            <div className="pb-3 border-b border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Amounts</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {/* PO Amount (Incl. GST) */}
                <div className="space-y-0.5">
                  <p className="text-xs text-gray-500">PO Amount(Incl. GST)</p>
                  <p className="text-sm font-semibold">{formatToRoundedIndianRupee(po?.total_amount)}</p>
                </div>

                {/* PO Amount (Excl. GST) */}
                <div className="space-y-0.5">
                  <p className="text-xs text-gray-500">PO Amount(Excl. GST)</p>
                  <p className="text-sm font-medium">{formatToRoundedIndianRupee(po?.amount)}</p>
                </div>

                {/* Total Approved Invoice Amount */}
                <div className="space-y-0.5">
                  <p className="text-xs text-gray-500">Approved Invoice Amount</p>
                  <p className="text-sm font-medium text-green-600">{totalApprovedInvoiceAmount ? formatToRoundedIndianRupee(totalApprovedInvoiceAmount) : "--"}</p>
                </div>

                {/* Total Amount Paid */}
                <div className="space-y-0.5">
                  <p className="text-xs text-gray-500">Total Amount Paid</p>
                  <p className="text-sm font-medium text-green-600">
                    {amountPaid ? formatToRoundedIndianRupee(amountPaid) : "--"}
                  </p>
                </div>

                {/* PO Amount Delivered */}
                <div className="space-y-0.5">
                  <p className="text-xs text-gray-500">PO Amount Delivered</p>
                  <p className="text-sm font-medium text-blue-600">
                    {po?.po_amount_delivered ? formatToRoundedIndianRupee(po?.po_amount_delivered) : "--"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 4: DATES - All timeline dates
          ═══════════════════════════════════════════════════════════════════ */}
          <div className="pb-3 border-b border-gray-100">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Timeline</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {/* Date Created */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Created</p>
                <p className="text-sm">{po?.creation ? formatDate(po?.creation) : "--"}</p>
              </div>

              {/* Date Dispatched */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Dispatched</p>
                <p className="text-sm">{po?.dispatch_date ? formatDate(po?.dispatch_date) : "--"}</p>
              </div>

              {/* Expected Delivery Date */}
              {["Partially Dispatched", "Dispatched", "Partially Delivered"].includes(po?.status) && (
                <div className="space-y-0.5">
                  <p className="text-xs text-gray-500">Expected Delivery</p>
                  <p className="text-sm">{po?.expected_delivery_date ? formatDate(po?.expected_delivery_date) : "--"}</p>
                </div>
              )}

              {/* Latest Delivery Date */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Latest Delivery</p>
                <p className="text-sm">{po?.latest_delivery_date ? formatDate(po?.latest_delivery_date) : "--"}</p>
              </div>

              {/* Latest Payment Date */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Latest Payment</p>
                <p className="text-sm">{po?.latest_payment_date ? formatDate(po?.latest_payment_date) : "--"}</p>
              </div>
            </div>
          </div>



          {/* ═══════════════════════════════════════════════════════════════════
              SECTION 5: ACTIONS - Compact minimalist buttons
          ═══════════════════════════════════════════════════════════════════ */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 sm:flex-wrap sm:justify-between">
            {/* Left group: Workflow actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Revise PO Button */}
              {["PO Approved", "Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered"].includes(po?.status || "") &&
                !isItemLocked &&
                !PoPaymentTermsValidationSafe &&
                //!summaryPage &&
                !accountsPage &&
                !estimatesViewing &&
                ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Procurement Executive Profile"].includes(role) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (isVendorHoldBlocked) {
                            showVendorBlockedToast();
                            return;
                          }
                          setOpenRevisionDialog(true);
                        }}
                        className="h-8 px-2.5 border-primary text-primary shrink-0"
                      >
                        <FilePenLine className="h-3.5 w-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline text-xs">Revise PO</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="sm:hidden">Revise PO</TooltipContent>
                  </Tooltip>
                )}

              {/* Adjust Payments Button */}
              {po?.name && onAdjustPayments && !accountsPage && !estimatesViewing &&
                ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Procurement Executive Profile"].includes(role) && (
                  <POAdjustmentButton poId={po.name} onClick={() => {
                    if (isVendorHoldBlocked) {
                      showVendorBlockedToast();
                      return;
                    }
                    onAdjustPayments();
                  }} />
                )}

              {/* Revert Button */}
              {!summaryPage &&
                !accountsPage &&
                !estimatesViewing &&
                !isItemLocked &&
                ["Dispatched", "Partially Dispatched"].includes(po?.status || "") &&
                !(poPayments?.length) &&
                ["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleRevertDialog}
                        className="h-8 px-2.5 border-primary text-primary shrink-0"
                      >
                        <Undo2 className="h-3.5 w-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline text-xs">Revert</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="sm:hidden">Revert</TooltipContent>
                  </Tooltip>
                )}

              {/* Cancel PO Button */}
              {onCancelPO &&
                //!summaryPage &&
                !accountsPage &&
                !po?.custom &&
                !estimatesViewing &&
                role !== "Nirmaan Accountant Profile" &&
                po?.status === "PO Approved" &&
                !(poPayments?.length) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onCancelPO}
                        className="h-8 px-2.5 border-primary text-primary shrink-0"
                      >
                        <CircleX className="h-3.5 w-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline text-xs">Cancel PO</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="sm:hidden">Cancel PO</TooltipContent>
                  </Tooltip>
                )}
            </div>

            {/* Right group: Document operations */}
            <div className="flex items-center gap-1.5 shrink-0 sm:flex-wrap">
              {po?.status !== "PO Approved" && po?.status !== "Inactive" && (
                <>
                  {/* Upload DC - shown for delivered statuses */}
                  {["Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered"].includes(po?.status) &&
                    ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile", "Nirmaan Procurement Executive Profile"].includes(role) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-2.5 border-primary text-primary shrink-0"
                            onClick={() => handleOpenPDDUpload("DC")}
                          >
                            <CirclePlus className="h-3.5 w-3.5 sm:mr-1.5" />
                            <span className="hidden sm:inline text-xs">Upload DC</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="sm:hidden">Upload DC</TooltipContent>
                      </Tooltip>
                    )}

                  {/* Upload MIR - shown for delivered statuses */}
                  {["Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered"].includes(po?.status) &&
                    ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile", "Nirmaan Procurement Executive Profile"].includes(role) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-2.5 border-primary text-primary shrink-0"
                            onClick={() => handleOpenPDDUpload("MIR")}
                          >
                            <Upload className="h-3.5 w-3.5 sm:mr-1.5" />
                            <span className="hidden sm:inline text-xs">Upload MIR</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="sm:hidden">Upload MIR</TooltipContent>
                      </Tooltip>
                    )}

                  {/* Add Invoice - hidden for Project Manager and Accountant */}
                  {!isProjectManager && role !== "Nirmaan Accountant Profile" && !estimatesViewing && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2.5 border-primary text-primary shrink-0"
                          onClick={toggleNewInvoiceDialog}
                        >
                          <FileText className="h-3.5 w-3.5 sm:mr-1.5" />
                          <span className="hidden sm:inline text-xs">Add Invoice</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="sm:hidden">Add Invoice</TooltipContent>
                    </Tooltip>
                  )}
                </>
              )}

              {/* Preview Button */}
              {(po?.status !== "PO Approved" ||
                summaryPage ||
                accountsPage ||
                estimatesViewing ||
                role !== "Nirmaan Procurement Executive Profile") && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!isValid}
                        onClick={isValid ? togglePoPdfSheet : undefined}
                        className="h-8 px-2.5 border-primary text-primary shrink-0"
                      >
                        <Eye className="h-3.5 w-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline text-xs">Preview</span>
                      </Button>
                    </TooltipTrigger>
                    {!isValid ? (
                      <TooltipContent
                        side="bottom"
                        className="bg-background border border-border text-foreground w-80"
                      >
                        <ValidationMessages
                          title="Required Before Preview"
                          errors={errors}
                        />
                      </TooltipContent>
                    ) : (
                      <TooltipContent className="sm:hidden">Preview</TooltipContent>
                    )}
                  </Tooltip>
                )}

              {/* Delete Custom PO Button */}
              {po?.custom === "true" &&
                !summaryPage &&
                !accountsPage &&
                !estimatesViewing &&
                po?.status === "PO Approved" &&
                !(poPayments?.length) &&
                ["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={toggleDeleteDialog}
                        variant="destructive"
                        size="sm"
                        className="h-8 px-2.5 shrink-0"
                      >
                        <Trash2Icon className="h-3.5 w-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline text-xs">Delete</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="sm:hidden">Delete</TooltipContent>
                  </Tooltip>
                )}

              {/* Dispatch PO Button */}
              {!accountsPage &&
                !estimatesViewing &&
                ["PO Approved", "Partially Dispatched"].includes(po?.status || "") &&
                ["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        disabled={!isValid || isItemLocked}
                        onClick={isValid ? toggleDispatchPODialog : undefined}
                        className="h-8 px-2.5 shrink-0"
                      >
                        <PackageCheck className="h-3.5 w-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline text-xs">Mark Dispatched Items</span>
                      </Button>
                    </TooltipTrigger>
                    {!isValid ? (
                      <TooltipContent
                        side="bottom"
                        className="bg-background border border-border text-foreground w-80"
                      >
                        <ValidationMessages
                          title="Required Before Dispatch"
                          errors={errors}
                        />
                      </TooltipContent>
                    ) : (
                      <TooltipContent className="sm:hidden">Mark Dispatched Items</TooltipContent>
                    )}
                  </Tooltip>
                )}

              {/* Mark Inactive Button */}
              {po &&
                po.status !== "Inactive" &&
                po.status !== "Cancelled" &&
                po.status !== "Merged" &&
                po.status !== "PO Approved" &&
                (po?.amount_paid ?? 0) <= 100 &&
                !PoPaymentTermsValidationSafe &&
                (["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Accountant Profile"].includes(role)) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleInactiveDialog}
                        className="h-8 px-2.5 text-destructive border-destructive hover:bg-destructive hover:text-white shrink-0"
                        disabled={isItemLocked}
                      >
                        <CircleX className="h-3.5 w-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline text-xs">Mark Inactive</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="sm:hidden">Mark Inactive</TooltipContent>
                  </Tooltip>
                )}
            </div>
          </div>
        </CardContent>

        {/* ═══════════════════════════════════════════════════════════════════
            DIALOGS & SHEETS - All modals preserved below
        ═══════════════════════════════════════════════════════════════════ */}

        {/* Revert Dialog */}
        <Dialog open={revertDialog} onOpenChange={toggleRevertDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Are you sure?</DialogTitle>
            </DialogHeader>

            <DialogDescription>
              This will revert the PO status to{" "}
              <span className="text-primary">PO Approved</span> and clear all
              dispatch markings.
            </DialogDescription>

            <div className="flex items-center justify-end gap-2">
              {update_loading ? (
                <TailSpin color="red" height={40} width={40} />
              ) : (
                <>
                  <DialogClose asChild>
                    <Button variant={"outline"}>
                      <CircleX className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button onClick={handleRevertPO}>
                    <CheckCheck className="h-4 w-4 mr-1" />
                    Confirm
                  </Button>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>


        {/* Delete Dialog */}
        <Dialog open={deleteDialog} onOpenChange={toggleDeleteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Are you sure?</DialogTitle>
            </DialogHeader>
            <DialogDescription>
              Clicking on Confirm will delete this{" "}
              <span className="text-primary">
                Custom PO and associated Custom PR
              </span>{" "}
              permanently!
            </DialogDescription>
            <div className="flex items-center justify-end gap-2">
              {deleteCustomPOCallLoading ? (
                <TailSpin color="red" height={40} width={40} />
              ) : (
                <>
                  <DialogClose asChild>
                    <Button variant={"outline"}>
                      <CircleX className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button onClick={handleDeleteCustomPO}>
                    <CheckCheck className="h-4 w-4 mr-1" />
                    Confirm
                  </Button>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Dispatch PO Sheet */}
        <Sheet
          open={dispatchPODialog}
          onOpenChange={(open) => {
            toggleDispatchPODialog();
            if (!open) {
              criticalPOLinking.resetSelection();
              setContactSectionExpanded(false);
              setSelectedDispatchItems([]);
              setExpectedDeliveryDate("");
            } else {
              // Pre-populate from existing PO data for subsequent dispatches
              setExpectedDeliveryDate(po?.expected_delivery_date || "");
            }
          }}
        >
          <SheetContent
            className="w-full sm:max-w-[480px] p-0 overflow-hidden flex flex-col"
            style={{ maxHeight: '100vh' }}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 bg-white">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
                    Mark Dispatched Items
                  </p>
                  <h2 className="text-lg font-semibold text-slate-800">
                    Send to{" "}
                    <span className="text-amber-600">{po?.vendor_name}</span>
                  </h2>
                </div>
                <Badge
                  variant="outline"
                  className="font-mono text-xs bg-slate-50 border-slate-300"
                >
                  {po?.name?.split("/")[1] || po?.name}
                </Badge>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-slate-50">

              {/* Item Selection Section */}
              <DispatchItemSelector
                items={po?.items || []}
                onSelectionChange={handleDispatchSelectionChange}
                disabled={update_loading}
              />

              {/* Expected Delivery Date */}
              <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
                    <PackageCheck className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-700">Expected Delivery Date</span>
                  <span className={`text-xs ml-auto font-medium ${expectedDeliveryDate ? "text-emerald-500" : "text-red-500"}`}>Required</span>
                </div>
                <Input
                  type="date"
                  className={`h-9 text-sm ${!expectedDeliveryDate ? "border-red-300 focus-visible:ring-red-400" : ""}`}
                  value={expectedDeliveryDate}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                />
              </div>

              {/* Critical PO Task Linking Section */}
              <CriticalPOTaskLinkingSection linkingState={criticalPOLinking} />

              {/* Vendor Contact Options (Collapsible) */}
              <Collapsible open={contactSectionExpanded} onOpenChange={setContactSectionExpanded}>
                <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                  <CollapsibleTrigger className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
                        <MessageSquare className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-sm font-semibold text-slate-700">
                        Vendor Contact Options
                      </span>
                    </div>
                    {contactSectionExpanded ? (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    )}
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="px-4 pb-4 pt-2 space-y-3 border-t border-slate-100">
                      {/* WhatsApp Row */}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Label className="text-xs text-slate-500 mb-1 block">
                            Phone Number
                          </Label>
                          <Input
                            placeholder="10-digit number"
                            className="h-9 text-sm"
                            value={phoneNumber}
                            onChange={handlePhoneChange}
                          />
                        </div>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              className="self-end h-9 bg-green-600 hover:bg-green-700"
                              disabled={phoneNumber.length !== 10}
                            >
                              <Phone className="w-3.5 h-3.5 mr-1.5" />
                              WhatsApp
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle className="text-center">
                                Send PO via WhatsApp
                              </DialogTitle>
                              <DialogDescription className="text-center">
                                Download the PO and send it via WhatsApp to {phoneNumber}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="flex justify-center space-x-4">
                              <Button onClick={togglePoPdfSheet} variant="outline">
                                <Download className="h-4 w-4 mr-2" />
                                PO PDF
                              </Button>
                              <Button
                                onClick={() => window.open(`https://wa.me/${phoneNumber}`)}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                <CheckCheck className="h-4 w-4 mr-2" />
                                Open WhatsApp
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>

                      {/* Email Row */}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Label className="text-xs text-slate-500 mb-1 block">
                            Email Address
                          </Label>
                          <Input
                            placeholder="vendor@email.com"
                            type="email"
                            className="h-9 text-sm"
                            value={email}
                            onChange={handleEmailChange}
                          />
                        </div>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              className="self-end h-9 bg-blue-600 hover:bg-blue-700"
                              disabled={!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
                            >
                              <Mail className="w-3.5 h-3.5 mr-1.5" />
                              Email
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-lg">
                            <DialogHeader>
                              <DialogTitle>Send PO via Email</DialogTitle>
                              <DialogDescription>
                                Customize your email and send the PO to {email}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div>
                                <Label htmlFor="emailSubject">Subject</Label>
                                <Input
                                  id="emailSubject"
                                  value={emailSubject}
                                  onChange={(e) => setEmailSubject(e.target.value)}
                                  placeholder="Enter email subject"
                                />
                              </div>
                              <div>
                                <Label htmlFor="emailBody">Body</Label>
                                <Textarea
                                  id="emailBody"
                                  value={emailBody}
                                  onChange={(e) => setEmailBody(e.target.value)}
                                  placeholder="Enter email body"
                                  rows={4}
                                />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button onClick={togglePoPdfSheet} variant="outline">
                                <Download className="h-4 w-4 mr-2" />
                                PO PDF
                              </Button>
                              <Button
                                onClick={() =>
                                  window.open(
                                    `https://mail.google.com/mail/?view=cm&fs=1&to=${email}&su=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
                                  )
                                }
                                className="bg-blue-600 hover:bg-blue-700"
                              >
                                <CheckCheck className="h-4 w-4 mr-2" />
                                Send Email
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>

              {/* Delivery Contact Section */}
              <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
                    <Phone className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-700">
                    Delivery Contact
                  </span>
                  <span className="text-xs text-slate-400 ml-auto">Optional</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-slate-500 mb-1 block">
                      Person Name
                    </Label>
                    <Input
                      placeholder="Enter person name"
                      className="h-9 text-sm"
                      value={contactPerson.name}
                      onChange={(e) =>
                        setContactPerson((prev) => ({ ...prev, name: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 mb-1 block">
                      Contact Number
                    </Label>
                    <Input
                      placeholder="10-digit number"
                      type="tel"
                      className="h-9 text-sm"
                      value={contactPerson.number}
                      onChange={(e) =>
                        setContactPerson((prev) => ({
                          ...prev,
                          number: e.target.value.replace(/\D/g, "").slice(0, 10),
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer - Sticky Actions */}
            <div className="px-5 py-4 border-t border-slate-200 bg-white">
              {/* Disabled State Warning - missing date */}
              {!expectedDeliveryDate && (
                <div className="mb-3 flex items-center justify-center gap-2 p-2 bg-red-50 border border-red-200 rounded-md">
                  <TriangleAlert className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-xs font-medium text-red-600">
                    Expected Delivery Date is required to enable dispatch
                  </span>
                </div>
              )}
              {/* Disabled State Warning - missing critical PO task */}
              {criticalPOLinking.hasCriticalPOSetup &&
                !criticalPOLinking.isPoAlreadyLinked &&
                criticalPOLinking.selectedTasks.length === 0 && (
                  <div className="mb-3 flex items-center justify-center gap-2 p-2 bg-red-50 border border-red-200 rounded-md">
                    <TriangleAlert className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-xs font-medium text-red-600">
                      Select at least one Critical PO Task above to enable dispatch
                    </span>
                  </div>
                )}
              <div className="flex items-center justify-between gap-3">
                <Button variant="outline" size="sm" className="h-9" onClick={togglePoPdfSheet}>
                  <FileText className="w-4 h-4 mr-1.5" />
                  PO PDF
                </Button>
                <Button
                  size="sm"
                  className={`h-9 shadow-sm ${selectedDispatchItems.length === 0 ||
                    !expectedDeliveryDate ||
                    !criticalPOLinking.selectionValid
                    ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                    : "bg-amber-500 hover:bg-amber-600 text-white"
                    }`}
                  onClick={handleMarkAsDispatchedClick}
                  disabled={
                    selectedDispatchItems.length === 0 ||
                    !expectedDeliveryDate ||
                    !criticalPOLinking.selectionValid
                  }
                >
                  <PackageCheck className="w-4 h-4 mr-1.5" />
                  Confirm Dispatch
                </Button>
              </div>
              <p className="text-xs text-slate-400 text-center mt-3">
                Review all details before dispatching this PO
              </p>
            </div>
          </SheetContent>
        </Sheet>

        {/* Dispatch Confirmation Dialog - now supports multiple tasks */}
        <Dialog open={dispatchConfirmDialog} onOpenChange={setDispatchConfirmDialog}>
          <DialogContent className="sm:max-w-[450px]">
            <DialogHeader>
              <DialogTitle>
                {criticalPOLinking.selectedTasks.length > 0
                  ? `Confirm Linking to ${criticalPOLinking.selectedTasks.length} Task${criticalPOLinking.selectedTasks.length > 1 ? 's' : ''}`
                  : selectedDispatchItems.length < (po?.items?.filter(i => i.category !== "Additional Charges" && i.is_dispatched !== 1).length || 0)
                    ? "Confirm Partial Dispatch"
                    : "Confirm Full Dispatch"}
              </DialogTitle>
              <DialogDescription>
                {criticalPOLinking.selectedTasks.length > 0 ? (
                  <span>
                    Are you sure you want to link this PO to the following Critical PO Task{criticalPOLinking.selectedTasks.length > 1 ? 's' : ''} and dispatch?
                  </span>
                ) : (
                  <span>
                    Are you sure you want to dispatch this PO?
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            {/* Selected Tasks Details (now shows multiple) */}
            {criticalPOLinking.selectedTasksDetails.length > 0 && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md">
                <div className="mb-2">
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                    Linking To {criticalPOLinking.selectedTasksDetails.length} Task{criticalPOLinking.selectedTasksDetails.length > 1 ? 's' : ''}
                  </span>
                </div>
                {criticalPOLinking.selectedTasksDetails.length <= 3 ? (
                  // Show full details for 1-3 tasks
                  <div className="space-y-2">
                    {criticalPOLinking.selectedTasksDetails.map((task) => (
                      <div key={task.name} className="p-2 bg-white rounded border border-emerald-200 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-800">{task.item_name}</span>
                          <span className="text-slate-500">{task.critical_po_category}</span>
                        </div>
                        {task.sub_category && (
                          <span className="text-slate-400">({task.sub_category})</span>
                        )}
                        <div className="mt-1 text-slate-500">
                          Due: {formatDate(task.po_release_date)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  // Show summary for 4+ tasks
                  <div className="text-xs">
                    <p className="text-slate-600 mb-2">
                      Across {new Set(criticalPOLinking.selectedTasksDetails.map(t => t.critical_po_category)).size} categories
                    </p>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {criticalPOLinking.selectedTasksDetails.map((task) => (
                        <div key={task.name} className="flex items-center gap-2 text-slate-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span className="truncate">{task.item_name}</span>
                          <span className="text-slate-400 text-[10px]">({task.critical_po_category})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {update_loading || criticalPOLinking.isLinking ? (
              <div className="flex items-center justify-center py-4">
                <TailSpin width={40} height={40} color="#f59e0b" />
              </div>
            ) : (
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDispatchConfirmDialog(false)}
                >
                  <CircleX className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  onClick={() => handleDispatchPO()}
                  className="bg-amber-500 hover:bg-amber-600"
                >
                  <CheckCheck className="h-4 w-4 mr-1" />
                  {criticalPOLinking.selectedTasks.length > 0
                    ? `Link to ${criticalPOLinking.selectedTasks.length} Task${criticalPOLinking.selectedTasks.length > 1 ? 's' : ''} & Dispatch`
                    : "Dispatch"}
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>

      </Card>



      {/* NEW: Inactive Confirmation Dialog - Outside Card */}
      <Dialog open={inactiveDialog} onOpenChange={toggleInactiveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription>
              Clicking on Confirm will mark this PO as{" "}
              <span className="text-destructive font-semibold">Inactive</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end gap-2">
            {update_loading ? (
              <TailSpin color="red" height={40} width={40} />
            ) : (
              <>
                <DialogClose asChild>
                  <Button variant={"outline"}>
                    <CircleX className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </DialogClose>
                <Button onClick={handleInactivePO} variant="destructive">
                  <CheckCheck className="h-4 w-4 mr-1" />
                  Confirm Inactive
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload DC/MIR Dialog (new structured dialog with items + signature) */}
      <UploadDCMIRDialog
        open={pddUploadState.open}
        onOpenChange={(open) => {
          if (!open) setPddUploadState({ open: false, mode: "create", dcType: "Delivery Challan" });
        }}
        mode={pddUploadState.mode}
        dcType={pddUploadState.dcType}
        poName={po?.name || ""}
        poDisplayName={po?.name ? `PO-${po.name.split("/")[1]}` : ""}
        poProject={po?.project || ""}
        poVendor={po?.vendor || ""}
        poItems={poItemsForSelector}
        onSuccess={handlePDDUploadSuccess}
      />

      {/* PO Revision Dialog */}
      {po && (
        <PORevisionDialog
          open={openRevisionDialog}
          onClose={() => setOpenRevisionDialog(false)}
          po={po}
          onSuccess={poMutate}
        />
      )}

    </div>
  );
};

// END OF FILE
