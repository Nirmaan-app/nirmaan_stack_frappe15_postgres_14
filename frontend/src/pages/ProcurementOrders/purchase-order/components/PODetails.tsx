import { usePOValidation } from "@/hooks/usePOValidation";
import { useUserData } from "@/hooks/useUserData";
import DeliveryHistoryTable from "@/pages/DeliveryNotes/components/DeliveryHistory";
import { DeliveryNoteItemsDisplay } from "@/pages/DeliveryNotes/components/deliveryNoteItemsDisplay";
import { ProcurementOrder, DeliveryDataType } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { formatDate } from "@/utils/FormatDate";
import { useDeliveryNoteData } from "../../../DeliveryNotes/hooks/useDeliveryNoteData";
import {
  ROUTE_PATHS,
  STATUS_BADGE_VARIANT,
  DOCUMENT_PREFIX,
  encodeFrappeId,
  formatDisplayId,
  safeJsonParse,
  deriveDnIdFromPoId
} from "@/pages/DeliveryNotes/constants";
import formatToIndianRupee, {
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import { useDialogStore } from "@/zustand/useDialogStore";
import {
  useFrappeGetDoc,
  useFrappePostCall,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import {
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleX,
  Download,
  Eye,
  FileText,
  Mail,
  MessageSquare,
  Phone,
  Printer,
  Send,
  Trash2Icon,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useCriticalPOTaskLinking } from "../hooks/useCriticalPOTaskLinking";
import { CriticalPOTaskLinkingSection } from "./CriticalPOTaskLinkingSection";
import { LinkedCriticalPOTag } from "./LinkedCriticalPOTag";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import React, { useCallback, useRef, useState, useMemo } from "react";
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
  SheetHeader,
  SheetTitle,
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
import { DeliveryNotePrintLayout } from "@/pages/DeliveryNotes/components/DeliveryNotePrintLayout";
import { useReactToPrint } from "react-to-print";
import { usePrintHistory } from "@/pages/DeliveryNotes/hooks/usePrintHistroy";

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
  totalInvoice?: number
  poMutate: any
  toggleRequestPaymentDialog: () => void
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
}) => {
  if (!po) return <div>No PO ID Provided</div>;


  const { role } = useUserData();
  const { errors, isValid, hasVendorIssues } = usePOValidation(po);

  const { updateDoc, loading: update_loading } = useFrappeUpdateDoc();
  const { call: deleteCustomPOCall, loading: deleteCustomPOCallLoading } =
    useFrappePostCall(
      "nirmaan_stack.api.delete_custom_po_and_pr.delete_custom_po"
    );
  const navigate = useNavigate();

  // console.log("po", po);

  const { data: pr } = useFrappeGetDoc<ProcurementRequest>(
    "Procurement Requests",
    po?.procurement_request,
    po ? undefined : null
  );

  const [contactPerson, setContactPerson] = useState({
    name: "",
    number: "",
  });

  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  const [inactiveDialog, setInactiveDialog] = useState(false);

  const toggleInactiveDialog = useCallback(() => {
    setInactiveDialog((prevState) => !prevState);
  }, []); // No dependencies needed for simple toggle

  const { toggleNewInvoiceDialog } = useDialogStore();

  const [deliveryNoteSheet, setDeliveryNoteSheet] = useState(false);
  const toggleDeliveryNoteSheet = useCallback(() => {
    setDeliveryNoteSheet((prevState) => !prevState);
  }, []);

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
  const [skipLinkingDialog, setSkipLinkingDialog] = useState(false);

  // Critical PO Task Linking hook
  const criticalPOLinking = useCriticalPOTaskLinking({
    projectId: po?.project || "",
    poName: po?.name || "",
    enabled: dispatchPODialog && !!po?.project,
  });

  const handlePhoneChange = useCallback((e: any) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 10);
    setPhoneNumber(value);
  }, []);

  const handleEmailChange = useCallback((e: any) => {
    setEmail(e.target.value);
  }, []);

  const handleDispatchPO = async (linkCriticalTask: boolean = false) => {
    try {
      // If linking to critical task, do that first
      if (linkCriticalTask && criticalPOLinking.selectedTask && criticalPOLinking.selectedStatus) {
        const linkSuccess = await criticalPOLinking.linkPOToTask();
        if (!linkSuccess) {
          // Linking failed, don't proceed with dispatch
          return;
        }
      }

      // Create the update payload with status "Dispatched"
      const updateData: {
        status: string;
        delivery_contact?: string;
        dispatch_date: string;
      } = {
        status: "Dispatched",
        dispatch_date: new Date().toLocaleString("en-US", {
          timeZone: "Asia/Kolkata",
        }), // Set current timestamp
      };

      // If either contact field is provided, add the delivery_contact key
      if (contactPerson.name || contactPerson.number) {
        updateData.delivery_contact = `${contactPerson.name}:${contactPerson.number}`;
      }

      await updateDoc("Procurement Orders", po.name, updateData);
      await poMutate();

      toast({
        title: "Success!",
        description: `PO: ${po.name} status updated to 'Dispatched' successfully!`,
        variant: "success",
      });

      // Reset critical PO linking state
      criticalPOLinking.resetSelection();
      setDispatchConfirmDialog(false);
      setSkipLinkingDialog(false);
      toggleDispatchPODialog();

      navigate(
        `/purchase-orders/${po.name.replaceAll("/", "&=")}?tab=Dispatched+PO`
      );
    } catch (error: any) {
      console.log(
        "error while updating the status of the PO to dispatch",
        error?.message
      );
      toast({
        title: "Failed!",
        description: `PO: ${po.name} Updation Failed!`,
        variant: "destructive",
      });
    }
  };

  // Handle the "Mark as Dispatched" button click
  const handleMarkAsDispatchedClick = useCallback(() => {
    const { hasCriticalPOSetup, selectedTask, selectedStatus } = criticalPOLinking;

    if (selectedTask && selectedStatus) {
      // Task selected with status - show linking confirmation
      setDispatchConfirmDialog(true);
    } else if (hasCriticalPOSetup && !selectedTask) {
      // Setup exists but no task selected - show skip warning
      setSkipLinkingDialog(true);
    } else {
      // No setup exists - proceed directly with dispatch confirmation
      setDispatchConfirmDialog(true);
    }
  }, [criticalPOLinking]);

  const handleRevertPO = async () => {
    try {
      await updateDoc("Procurement Orders", po.name, {
        status: "PO Approved",
        delivery_contact: null,
        dispatch_date: null, // Clear the dispatch_date
      });

      await poMutate();

      toast({
        title: "Success!",
        description: `PO: ${po.name} Reverted back to PO Approved!`,
        variant: "success",
      });

      navigate(
        `/purchase-orders/${po.name.replaceAll("/", "&=")}?tab=Approved+PO`
      );
    } catch (error) {
      toast({
        title: "Failed!",
        description: `PO: ${po.name} Revert Failed!`,
        variant: "destructive",
      });
    }
  };

  const handleDeleteCustomPO = async () => {
    try {
      const response = await deleteCustomPOCall({
        po_id: po.name,
      });

      if (response.message.status === 200) {
        // ✅ Step 4: Success message & UI updates (Batch State Updates)
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


  const {
    deliveryNoteId,
    poId,
    data: deliveryNoteData,
    isLoading,
    error,
    mutate: refetchDeliveryNoteData
  } = useDeliveryNoteData();


  // --- (Indicator) STEP 1: Implement the print logic hooks ---
  const printComponentRef = useRef<HTMLDivElement>(null);
  const { triggerHistoryPrint, PrintableHistoryComponent } = usePrintHistory(deliveryNoteData);

  // The main print handler is for the overall DN/PO Summary, which you might already have a version of.
  const handlePrint = useReactToPrint({
    content: () => printComponentRef.current,
    documentTitle: po
      ? `${deriveDnIdFromPoId(po.name).toUpperCase()}_${po.vendor_name}`
      : "Delivery_Note",
    // Optional: Add page styles if needed
    // pageStyle: `@page { size: A4; margin: 20mm; } @media print { body { -webkit-print-color-adjust: exact; } }`
  });

  const deliveryHistory = useMemo(() =>
    safeJsonParse<{ data: DeliveryDataType }>(deliveryNoteData?.delivery_data, { data: {} }),
    [deliveryNoteData?.delivery_data]
  );
  const displayDnId = useMemo(() =>
    formatDisplayId(deliveryNoteId, DOCUMENT_PREFIX.DELIVERY_NOTE),
    [deliveryNoteId]
  );


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

  const PoPaymentTermsValidationSafe = poPayments?.some(
    (term) => term.status === "Requested" || term.status === "Approved"
  ) || false;

  return (
    <div>
      <Card className="rounded-sm shadow-m col-span-3 overflow-x-auto">
        <CardHeader>
          {/* Responsive Layout - Stack on mobile, side-by-side on desktop */}
          <div className="space-y-4">

            {/* Row 1: Title, Status & Approved By */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
              {/* Title and Status */}
              <div className="space-y-2">
                <h1 className="text-2xl max-sm:text-xl font-bold text-red-600">
                  PO Details
                  {/* Validation Warning Icon */}
                  {!isValid && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button>
                          <TriangleAlert className="inline-block ml-2 text-primary w-5 h-5 max-sm:w-4 max-sm:h-4" />
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
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">
                    Status:
                  </span>
                  <Badge
                    variant={
                      po?.status === "PO Approved"
                        ? "default"
                        : po?.status === "Dispatched"
                          ? "orange"
                          : po?.status === "Inactive" ? "red" : "green"
                    }
                  >
                    {po?.status}
                  </Badge>
                </div>
                {/* Linked Critical PO Task Tag */}
                <LinkedCriticalPOTag
                  poName={po?.name || ""}
                  projectId={po?.project || ""}
                  onUpdate={poMutate}
                  canEdit={["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile", "Nirmaan Procurement Executive Profile"].includes(role)}
                />
              </div>

              {/* Approved By - Desktop Only */}
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">
                  Approved By:
                </span>
                <Badge variant="default">{po?.owner}</Badge>
              </div>
            </div>

            {/* Row 2: Action Buttons */}
            <div className="w-full">
              {/* Container for all action buttons - horizontal scroll on mobile */}
              <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 sm:flex-wrap sm:justify-end">
                {/* Buttons will scroll horizontally on mobile, wrap on desktop */}
                {/* --- All Existing Button Logic is Preserved and Moved Here --- */}

                {/* Request Payment Button */}
                {/* {!accountsPage && !estimatesViewing && !summaryPage && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        disabled={!isValid}
                        variant="outline"
                        className="text-primary border-primary"
                        onClick={
                          isValid ? toggleRequestPaymentDialog : undefined
                        }
                      >
                        Request Payment
                      </Button>
                    </TooltipTrigger>
                    {!isValid && (
                      <TooltipContent
                        side="bottom"
                        className="bg-background border border-border text-foreground w-80"
                      >
                        <ValidationMessages
                          title="Required Before Requesting Payment"
                          errors={errors}
                        />
                      </TooltipContent>
                    )}
                  </Tooltip>
                )} */}

                {/* Add Invoice Button */}
                {po?.status !== "PO Approved" && po?.status !== "Inactive" &&
                  role !== "Nirmaan Accountant Profile" && (
                  <Button
                    variant="outline"
                    className="text-primary border-primary shrink-0"
                    onClick={toggleNewInvoiceDialog}
                  >
                    Add Invoice
                  </Button>
                )}

                {/* Revert Button */}
                {!summaryPage &&
                  !accountsPage &&
                  !estimatesViewing &&
                  po?.status === "Dispatched" &&
                  !((poPayments || [])?.length > 0) &&
                  ["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role) && (
                    <Button
                      variant="outline"
                      onClick={toggleRevertDialog}
                      className="flex items-center gap-1 border-primary text-primary shrink-0"
                    >
                      <Undo2 className="w-4 h-4" />
                      Revert
                    </Button>
                  )}
                <Dialog open={revertDialog} onOpenChange={toggleRevertDialog}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Are you sure?</DialogTitle>
                    </DialogHeader>

                    <DialogDescription>
                      Clicking on Confirm will revert this PO's status back to{" "}
                      <span className="text-primary">PO Approved</span>.
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

                {/* Update DN Button */}
                {["Dispatched", "Partially Delivered", "Delivered"].includes(po?.status) &&
                  ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile", "Nirmaan Procurement Executive Profile"].includes(role) && (
                    <Button
                      onClick={toggleDeliveryNoteSheet}
                      variant="outline"
                      className="flex items-center gap-1 border-primary text-primary shrink-0"
                    >
                      Update Delivery
                    </Button>
                  )}
                <Sheet
                  open={deliveryNoteSheet}
                  onOpenChange={toggleDeliveryNoteSheet}
                >
                  <SheetContent className="overflow-auto">
                    <SheetHeader className="text-start mb-4 mx-4">
                      <SheetTitle className="text-primary flex flex-row items-center justify-between">
                        <p>Update/View Delivery Note</p>
                        <Button
                          onClick={handlePrint}
                          variant="default"
                          className="px-2"
                          size="sm"
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          <span className="text-xs">Preview</span>
                        </Button>
                      </SheetTitle>
                    </SheetHeader>
                    <div className="space-y-4">
                      <DeliveryNoteItemsDisplay
                        data={deliveryNoteData}
                        poMutate={refetchDeliveryNoteData}
                      />

                      <DeliveryHistoryTable
                        deliveryData={deliveryHistory.data}
                        onPrintHistory={triggerHistoryPrint}
                      />
                    </div>
                  </SheetContent>
                </Sheet>

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
                          disabled={!isValid}
                          onClick={isValid ? togglePoPdfSheet : undefined}
                          className="flex items-center gap-1 border-primary text-primary shrink-0"
                        >
                          <Eye className="w-4 h-4" />
                          Preview
                        </Button>
                      </TooltipTrigger>
                      {!isValid && (
                        <TooltipContent
                          side="bottom"
                          className="bg-background border border-border text-foreground w-80"
                        >
                          <ValidationMessages
                            title="Required Before Preview"
                            errors={errors}
                          />
                        </TooltipContent>
                      )}
                    </Tooltip>
                  )}

                {/* Delete Custom PO Button */}
                {po?.custom === "true" &&
                  !summaryPage &&
                  !accountsPage &&
                  !estimatesViewing &&
                  po?.status === "PO Approved" &&
                  !((poPayments || [])?.length > 0) &&
                  ["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role) && (
                    <Button
                      onClick={toggleDeleteDialog}
                      variant="destructive"
                      className="flex items-center gap-1 shrink-0"
                    >
                      <Trash2Icon className="w-4 h-4" />
                      Delete
                    </Button>
                  )}

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

                {/* Dispatch PO Button */}
                {!summaryPage &&
                  !accountsPage &&
                  !estimatesViewing &&
                  po?.status === "PO Approved" &&
                  ["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role) && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          disabled={!isValid}
                          onClick={isValid ? toggleDispatchPODialog : undefined}
                          className="flex items-center gap-1 shrink-0"
                        >
                          <Send className="h-4 w-4" />
                          Dispatch PO
                        </Button>
                      </TooltipTrigger>
                      {!isValid && (
                        <TooltipContent
                          side="bottom"
                          className="bg-background border border-border text-foreground w-80"
                        >
                          <ValidationMessages
                            title="Required Before Dispatch"
                            errors={errors}
                          />
                        </TooltipContent>
                      )}
                    </Tooltip>
                  )}
                {/* Dispatch PO Sheet - Revamped Design */}
                <Sheet
                  open={dispatchPODialog}
                  onOpenChange={(open) => {
                    toggleDispatchPODialog();
                    if (!open) {
                      criticalPOLinking.resetSelection();
                      setContactSectionExpanded(false);
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
                            Dispatch Purchase Order
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
                      <div className="flex items-center justify-between gap-3">
                        <Button variant="outline" size="sm" className="h-9" onClick={togglePoPdfSheet}>
                          <FileText className="w-4 h-4 mr-1.5" />
                          PO PDF
                        </Button>
                        <Button
                          size="sm"
                          className="h-9 bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                          onClick={handleMarkAsDispatchedClick}
                          disabled={criticalPOLinking.selectedTask && !criticalPOLinking.selectedStatus}
                        >
                          <Send className="w-4 h-4 mr-1.5" />
                          Mark as Dispatched
                        </Button>
                      </div>
                      <p className="text-xs text-slate-400 text-center mt-3">
                        Review all details before dispatching this PO
                      </p>
                    </div>
                  </SheetContent>
                </Sheet>

                {/* Dispatch Confirmation Dialog (with or without Critical PO linking) */}
                <Dialog open={dispatchConfirmDialog} onOpenChange={setDispatchConfirmDialog}>
                  <DialogContent className="sm:max-w-[450px]">
                    <DialogHeader>
                      <DialogTitle>
                        {criticalPOLinking.selectedTask
                          ? "Confirm Critical PO Task Linking"
                          : "Confirm PO Dispatch"}
                      </DialogTitle>
                      <DialogDescription>
                        {criticalPOLinking.selectedTask ? (
                          <span>
                            Are you sure you want to link this PO to the following Critical PO Task and dispatch?
                          </span>
                        ) : (
                          <span>
                            Are you sure you want to dispatch this PO?
                          </span>
                        )}
                      </DialogDescription>
                    </DialogHeader>

                    {/* Selected Task Details (if linking) */}
                    {criticalPOLinking.selectedTaskDetails && (
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                            Linking To Task
                          </span>
                          <Badge className="bg-emerald-500 text-xs">
                            {criticalPOLinking.selectedStatus}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-slate-500">Item</span>
                            <p className="font-medium text-slate-800">
                              {criticalPOLinking.selectedTaskDetails.item_name}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-500">Category</span>
                            <p className="font-medium text-slate-800">
                              {criticalPOLinking.selectedTaskDetails.critical_po_category}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-500">Sub-Category</span>
                            <p className="font-medium text-slate-800">
                              {criticalPOLinking.selectedTaskDetails.sub_category || "-"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-500">Deadline</span>
                            <p className="font-medium text-slate-800">
                              {formatDate(criticalPOLinking.selectedTaskDetails.po_release_date)}
                            </p>
                          </div>
                        </div>
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
                          onClick={() => handleDispatchPO(!!criticalPOLinking.selectedTask)}
                          className="bg-amber-500 hover:bg-amber-600"
                        >
                          <CheckCheck className="h-4 w-4 mr-1" />
                          {criticalPOLinking.selectedTask ? "Link & Dispatch" : "Dispatch"}
                        </Button>
                      </DialogFooter>
                    )}
                  </DialogContent>
                </Dialog>

                {/* Skip Linking Warning Dialog */}
                <Dialog open={skipLinkingDialog} onOpenChange={setSkipLinkingDialog}>
                  <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-amber-600">
                        <AlertTriangle className="w-5 h-5" />
                        No Critical PO Task Selected
                      </DialogTitle>
                      <DialogDescription>
                        You haven't linked this PO to any Critical PO Task. Are you sure you want to dispatch without linking?
                      </DialogDescription>
                    </DialogHeader>

                    {update_loading ? (
                      <div className="flex items-center justify-center py-4">
                        <TailSpin width={40} height={40} color="#f59e0b" />
                      </div>
                    ) : (
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setSkipLinkingDialog(false)}
                        >
                          Go Back
                        </Button>
                        <Button
                          onClick={() => handleDispatchPO(false)}
                          className="bg-amber-500 hover:bg-amber-600"
                        >
                          <Send className="h-4 w-4 mr-1" />
                          Dispatch Without Linking
                        </Button>
                      </DialogFooter>
                    )}
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* Row 3: Approved By - Mobile Only */}
            <div className="sm:hidden flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">
                Approved By:
              </span>
              <Badge variant="default">{po?.owner}</Badge>
            </div>

            {/* Row 4: Mark Inactive Button (conditional) */}
            <div className="m-0 p-0">
              {po &&
                po.status !== "Inactive" &&
                po.status !== "Cancelled" &&
                po.status !== "Merged" &&
                po.status !== "PO Approved" &&
                po?.amount_paid <= 100 &&
                !PoPaymentTermsValidationSafe &&
                (["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Accountant Profile"].includes(role)) && (
                  <Button
                    variant="outline"
                    onClick={toggleInactiveDialog}
                    className="text-destructive border-destructive hover:bg-destructive hover:text-white mt-2" // Added mt-2 for some spacing
                  >
                    <CircleX className="w-4 h-4 mr-1" />
                    Mark Inactive
                  </Button>
                )}
            </div>

          </div> {/* Close space-y-4 container */}
        </CardHeader>

        {/* <CardContent className="max-sm:text-xs">
          <div className="grid grid-cols-3 gap-4 space-y-2 max-sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label className=" text-red-700">Vendor</Label>
              <div>
                <VendorHoverCard vendor_id={po?.vendor} />
                {hasVendorIssues && (
                  <ValidationIndicator
                    error={errors.find((e) => e.code === "INCOMPLETE_VENDOR")}
                  />
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:items-center max-sm:text-end">
              <Label className=" text-red-700">Package</Label>
              <span>{pr?.work_package || "Custom"}</span>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <Label className=" text-red-700">Date Created</Label>
              <span>{formatDate(po?.creation || "")}</span>
            </div>
            <div className="flex flex-col gap-2 max-sm:items-end">
              <Label className=" text-red-700">Total (Excl. GST)</Label>
              <span>{formatToRoundedIndianRupee(po?.amount)}</span>
            </div>
            <div className="flex flex-col gap-2 sm:items-center">
              <Label className=" text-red-700">Total Amount Paid</Label>
              <span>
                {amountPaid ? formatToRoundedIndianRupee(amountPaid) : "--"}
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <Label className=" text-red-700">Total Invoiced Amount</Label>
              <span>{totalInvoice ? formatToRoundedIndianRupee(totalInvoice) : "--"}</span>
            </div>
            <div className="flex flex-col gap-2 items-end">
              {po?.status !== "PO Approved" && (
                <>
                  <Label className=" text-red-700">Date Dispatched</Label>
                  <span>{formatDate(po?.dispatch_date || "")}</span>
                </>
              )}
            </div>
            <div className="flex flex-col gap-2 items-end">
              {po?.status !== "PO Approved" && (
                <>
                  <Label className=" text-red-700">Lastest Delivery Date</Label>
                  <span>{formatDate(po?.latest_delivery_date || "--")}</span>
                </>
              )}
            </div>
            <div className="flex flex-col gap-2 items-end">
              {po?.status !== "PO Approved" && (
                <>
                  <Label className=" text-red-700">Lastest Delivery Date</Label>
                  <span>{formatDate(po?.lastest_delivery_date || "--")}</span>
                </>
              )}
            </div>
            <div className="flex flex-col gap-2 max-sm:items-end">
              <Label className=" text-red-700">Total (Incl. GST)</Label>
              <span>{formatToRoundedIndianRupee(po?.total_amount)}</span>
            </div>
            
          </div>
        </CardContent> */}

        <CardContent className="p-4">
          {/* Mobile: Single column with label-value rows | Desktop: 3-column grid */}
          <div className="space-y-3 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-x-6 sm:gap-y-4">

            {/* Vendor */}
            <div className="flex justify-between sm:flex-col sm:gap-2">
              <Label className="text-red-700 text-sm font-medium">Vendor</Label>
              <div className="text-right sm:text-left">
                <VendorHoverCard vendor_id={po?.vendor} />
                {hasVendorIssues && (
                  <ValidationIndicator
                    error={errors.find((e) => e.code === "INCOMPLETE_VENDOR")}
                  />
                )}
              </div>
            </div>

            {/* Total (Incl. GST) */}
            <div className="flex justify-between sm:flex-col sm:gap-2">
              <Label className="text-red-700 text-sm font-medium">PO Amount(Incl. GST)</Label>
              <span className="font-semibold text-sm sm:text-base">{formatToRoundedIndianRupee(po?.total_amount)}</span>
            </div>

            {/* Date Created */}
            <div className="flex justify-between sm:flex-col sm:gap-2">
              <Label className="text-red-700 text-sm font-medium">Date Created</Label>
              <span className="text-sm sm:text-base">{po?.creation ? formatDate(po?.creation) : "--"}</span>
            </div>

            {/* Package */}
            <div className="flex justify-between sm:flex-col sm:gap-2">
              <Label className="text-red-700 text-sm font-medium">Package</Label>
              <span className="text-sm sm:text-base">{pr?.work_package || "Custom"}</span>
            </div>

            {/* Total Invoiced Amount */}
            <div className="flex justify-between sm:flex-col sm:gap-2">
              <Label className="text-red-700 text-sm font-medium">Total Invoiced Amount</Label>
              <span className="text-sm sm:text-base">{totalInvoice ? formatToRoundedIndianRupee(totalInvoice) : "--"}</span>
            </div>

            {/* Date Dispatched */}
            <div className="flex justify-between sm:flex-col sm:gap-2">
              <Label className="text-red-700 text-sm font-medium">Date Dispatched</Label>
              <span className="text-sm sm:text-base">{po?.dispatch_date ? formatDate(po?.dispatch_date) : "--"}</span>
            </div>

            {/* Total (Excl. GST) */}
            <div className="flex justify-between sm:flex-col sm:gap-2">
              <Label className="text-red-700 text-sm font-medium">PO Amount(Excl. GST)</Label>
              <span className="text-sm sm:text-base">{formatToRoundedIndianRupee(po?.amount)}</span>
            </div>

            {/* Total Amount Paid */}
            <div className="flex justify-between sm:flex-col sm:gap-2">
              <Label className="text-red-700 text-sm font-medium">Total Amount Paid</Label>
              <span className="text-sm sm:text-base text-green-600 font-medium">
                {amountPaid ? formatToRoundedIndianRupee(amountPaid) : "--"}
              </span>
            </div>

            {/* Latest Delivery Date */}
            <div className="flex justify-between sm:flex-col sm:gap-2">
              <Label className="text-red-700 text-sm font-medium">Latest Delivery Date</Label>
              <span className="text-sm sm:text-base">{po?.latest_delivery_date ? formatDate(po?.latest_delivery_date) : "--"}</span>
            </div>

            {/* Latest Payment Date (only show if exists) */}
            {po?.latest_payment_date && (
              <div className="flex justify-between sm:flex-col sm:gap-2 sm:col-start-3">
                <Label className="text-red-700 text-sm font-medium">Latest Payment Date</Label>
                <span className="text-sm sm:text-base">{formatDate(po?.latest_payment_date)}</span>
              </div>
            )}

          </div>
        </CardContent>


      </Card>



      {/* NEW: Inactive Confirmation Dialog */}
      <Dialog open={inactiveDialog} onOpenChange={toggleInactiveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription>
              Clicking on Confirm will mark this PO as{" "}
              <span className="text-destructive font-semibold">Inactive</span>.
              {/* This action can be reversed if needed. */}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end gap-2">
            {update_loading ? ( // Use update_loading from useFrappeUpdateDoc
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
      {/* --- (Indicator) STEP 3: Add the hidden printable components to the JSX --- */}
      <div className="hidden">
        {/* This is for the overall DN print */}
        <div ref={printComponentRef}>
          <DeliveryNotePrintLayout data={po} />
        </div>
        {/* This is the dynamically rendered component for history printing */}
        {PrintableHistoryComponent}
      </div>
    </div>
  );
};
