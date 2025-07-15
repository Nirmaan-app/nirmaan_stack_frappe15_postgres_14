import { usePOValidation } from "@/hooks/usePOValidation";
import { useUserData } from "@/hooks/useUserData";
import DeliveryHistoryTable from "@/pages/DeliveryNotes/components/DeliveryHistory";
import { DeliveryNoteItemsDisplay } from "@/pages/DeliveryNotes/components/deliveryNoteItemsDisplay";
import { ProcurementOrder,DeliveryDataType } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { formatDate } from "@/utils/FormatDate";
import { useDeliveryNoteData } from "../../../DeliveryNotes/hooks/useDeliveryNoteData";
import {  ROUTE_PATHS,
  STATUS_BADGE_VARIANT,
  DOCUMENT_PREFIX,
  encodeFrappeId,
  formatDisplayId,
  safeJsonParse,
  deriveDnIdFromPoId} from "@/pages/DeliveryNotes/constants";
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
  CircleX,
  Download,
  Eye,
  Mail,
  Phone,
  Printer,
  Send,
  Trash2Icon,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import React, { useCallback, useRef, useState ,useMemo} from "react";
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

  const handlePhoneChange = useCallback((e: any) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 10);
    setPhoneNumber(value);
  }, []);

  const handleEmailChange = useCallback((e: any) => {
    setEmail(e.target.value);
  }, []);

  const handleDispatchPO = async () => {
    try {
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

      navigate(
        `/purchase-orders/${po.name.replaceAll("/", "&=")}?tab=Dispatched+PO`
      );
    } catch (error) {
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



  return (
    <div>
      <Card className="rounded-sm shadow-m col-span-3 overflow-x-auto">
        <CardHeader>
          {/* Main flex container for the two-column layout */}
          <div className="flex justify-between items-start gap-4">
            {/* --- Column 1: Title and Status --- */}
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-red-600">
                PO Details
                {/* Validation Warning Icon */}
                {!isValid && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button>
                        <TriangleAlert className="inline-block ml-2 text-primary max-sm:w-4 max-sm:h-4" />
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
                      : "green"
                  }
                >
                  {po?.status}
                </Badge>
              </div>
            </div>

            {/* --- Column 2: Action Buttons and Approver Info --- */}
            <div className="flex flex-col items-end gap-2">
              {/* Container for all action buttons */}
              <div className="flex items-center gap-2 flex-wrap justify-end">
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
                {po?.status !== "PO Approved" && (
                  <Button
                    variant="outline"
                    className="text-primary border-primary"
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
                  !((poPayments || [])?.length > 0) && (
                    <Button
                      variant="outline"
                      onClick={toggleRevertDialog}
                      className="flex items-center gap-1 border-primary text-primary"
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
                {["Dispatched", "Partially Delivered", "Delivered"].includes(po?.status) && (
                  <Button
                    onClick={toggleDeliveryNoteSheet}
                    variant="outline"
                    className="flex items-center gap-1 border-primary text-primary"
                  >
                    Update DN
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
                        className="flex items-center gap-1 border-primary text-primary"
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
                  !((poPayments || [])?.length > 0) && (
                    <Button
                      onClick={toggleDeleteDialog}
                      variant="destructive"
                      className="flex items-center gap-1"
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
                  po?.status === "PO Approved" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          disabled={!isValid}
                          onClick={isValid ? toggleDispatchPODialog : undefined}
                          className="flex items-center gap-1"
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
                <Sheet
                  open={dispatchPODialog}
                  onOpenChange={toggleDispatchPODialog}
                >
                  <SheetContent className="overflow-y-auto">
                    <Card className="border-yellow-500 shadow-lg overflow-auto my-4">
                      <CardHeader className="bg-yellow-50">
                        <CardTitle className="text-2xl text-yellow-800">
                          Send this PO to{" "}
                          <span className="font-bold text-yellow-600">
                            {po?.vendor_name}
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-6">
                        <div className="space-y-6">
                          <div className="bg-yellow-100 p-4 rounded-lg">
                            <h3 className="font-semibold text-yellow-800 mb-2 flex items-center">
                              <AlertTriangle className="w-5 h-5 mr-2" />
                              Important Notes
                            </h3>
                            <ul className="list-disc list-inside space-y-1 text-sm text-yellow-700">
                              <li>
                                You can add{" "}
                                <span className="font-bold">
                                  charges, notes & payment terms
                                </span>{" "}
                                above.
                              </li>
                              <li>
                                You can also{" "}
                                <span className="font-bold">merge POs</span>{" "}
                                with same vendor and project. Look out for{" "}
                                <span className="font-bold">Heads Up</span> box
                                above.
                              </li>
                              <li>
                                You can download the prepared PO to notify
                                vendor:{" "}
                                <span className="font-medium">
                                  {po?.vendor_name}
                                </span>{" "}
                                through <span> Contact Options</span> section
                                below
                              </li>
                            </ul>
                          </div>
                          <Separator />

                          <div className="space-y-4">
                            <h3 className="font-semibold text-lg">
                              Vendor Contact Options
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <Label
                                  htmlFor="phone"
                                  className="text-sm font-medium"
                                >
                                  Phone Number
                                </Label>
                                <div className="flex flex-col mt-1">
                                  <div className="flex">
                                    <Input
                                      id="phone"
                                      type="tel"
                                      placeholder="Enter 10-digit number"
                                      value={phoneNumber}
                                      onChange={handlePhoneChange}
                                      className="rounded-r-none"
                                    />
                                    <Dialog>
                                      <DialogTrigger asChild>
                                        <Button
                                          className="rounded-l-none bg-green-600 hover:bg-green-700"
                                          disabled={phoneNumber.length !== 10}
                                        >
                                          <Phone className="w-4 h-4 mr-2" />
                                          WhatsApp
                                        </Button>
                                      </DialogTrigger>
                                      <DialogContent>
                                        <DialogHeader>
                                          <DialogTitle className="text-center">
                                            Send PO via WhatsApp
                                          </DialogTitle>
                                          <DialogDescription className="text-center">
                                            Download the PO and send it via
                                            WhatsApp to {phoneNumber}
                                          </DialogDescription>
                                        </DialogHeader>
                                        <div className="flex justify-center space-x-4">
                                          <Button
                                            onClick={togglePoPdfSheet}
                                            variant="outline"
                                          >
                                            <Download className="h-4 w-4 mr-2" />
                                            PO PDF
                                          </Button>
                                          <Button
                                            onClick={() =>
                                              window.open(
                                                `https://wa.me/${phoneNumber}`
                                              )
                                            }
                                            className="bg-green-600 hover:bg-green-700"
                                          >
                                            <CheckCheck className="h-4 w-4 mr-2" />
                                            Open WhatsApp
                                          </Button>
                                        </div>
                                      </DialogContent>
                                    </Dialog>
                                  </div>
                                </div>
                              </div>
                              <div>
                                <Label
                                  htmlFor="email"
                                  className="text-sm font-medium"
                                >
                                  Email
                                </Label>
                                <div className="flex flex-col mt-1">
                                  <div className="flex">
                                    <Input
                                      id="email"
                                      type="email"
                                      placeholder="Enter email address"
                                      value={email}
                                      onChange={handleEmailChange}
                                      className="rounded-r-none"
                                    />
                                    <Dialog>
                                      <DialogTrigger asChild>
                                        <Button
                                          className="rounded-l-none bg-blue-600 hover:bg-blue-700"
                                          disabled={
                                            !email.trim() ||
                                            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                                              email
                                            )
                                          }
                                        >
                                          <Mail className="w-4 h-4 mr-2" />
                                          Email
                                        </Button>
                                      </DialogTrigger>
                                      <DialogContent className="max-w-3xl">
                                        <DialogHeader>
                                          <DialogTitle>
                                            Send PO via Email
                                          </DialogTitle>
                                          <DialogDescription>
                                            Customize your email and send the PO
                                            to {email}
                                          </DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-4">
                                          <div>
                                            <Label htmlFor="emailSubject">
                                              Subject
                                            </Label>
                                            <Input
                                              id="emailSubject"
                                              value={emailSubject}
                                              onChange={(e) =>
                                                setEmailSubject(e.target.value)
                                              }
                                              placeholder="Enter email subject"
                                            />
                                          </div>
                                          <div>
                                            <Label htmlFor="emailBody">
                                              Body
                                            </Label>
                                            <Textarea
                                              id="emailBody"
                                              value={emailBody}
                                              onChange={(e) =>
                                                setEmailBody(e.target.value)
                                              }
                                              placeholder="Enter email body"
                                              rows={5}
                                            />
                                          </div>
                                          <div className="bg-gray-100 p-4 rounded-md">
                                            <h4 className="font-medium mb-2">
                                              Email Preview
                                            </h4>
                                            <p>
                                              <strong>To:</strong> {email}
                                            </p>
                                            <p>
                                              <strong>Subject:</strong>{" "}
                                              {emailSubject}
                                            </p>
                                            <p>
                                              <strong>Body:</strong> {emailBody}
                                            </p>
                                          </div>
                                        </div>
                                        <DialogFooter>
                                          <Button
                                            onClick={togglePoPdfSheet}
                                            variant="outline"
                                          >
                                            <Download className="h-4 w-4 mr-2" />
                                            PO PDF
                                          </Button>
                                          <Button
                                            onClick={() =>
                                              window.open(
                                                `https://mail.google.com/mail/?view=cm&fs=1&to=${email}&su=${encodeURIComponent(
                                                  emailSubject
                                                )}&body=${encodeURIComponent(
                                                  emailBody
                                                )}`
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
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                      <CardFooter className="bg-gray-50 flex justify-between p-4 max-md:flex-col max-md:items-start max-md:gap-4">
                        <p className="text-sm text-gray-600 italic">
                          Check all details before sending this PO.
                        </p>
                        <div className="space-x-2 space-y-2 max-md:text-end max-md:w-full">
                          <Button variant="outline" onClick={togglePoPdfSheet}>
                            <Printer className="h-4 w-4 mr-2" />
                            PO PDF
                          </Button>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="default"
                                className="bg-yellow-500 hover:bg-yellow-600"
                              >
                                <Send className="h-4 w-4 mr-2" />
                                Mark as Dispatched
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Confirm PO Dispatch?</DialogTitle>
                                <DialogDescription className="pt-2 flex flex-col gap-2">
                                  <p>
                                    You can add the delivery person's details
                                    here.
                                  </p>
                                  <div>
                                    <Label
                                      htmlFor="personName"
                                      className="text-sm font-medium"
                                    >
                                      Person Name{" "}
                                      <span className="text-gray-400">
                                        (optional)
                                      </span>
                                    </Label>
                                    <Input
                                      id="personName"
                                      type="text"
                                      value={contactPerson.name}
                                      placeholder="Enter person name"
                                      onChange={(e) =>
                                        setContactPerson((prev) => ({
                                          ...prev,
                                          name: e.target.value,
                                        }))
                                      }
                                      className="mt-1"
                                    />
                                  </div>
                                  <div>
                                    <Label
                                      htmlFor="contactNumber"
                                      className="text-sm font-medium"
                                    >
                                      Contact Number{" "}
                                      <span className="text-gray-400">
                                        (optional)
                                      </span>
                                    </Label>
                                    <Input
                                      id="contactNumber"
                                      type="tel"
                                      value={contactPerson.number}
                                      placeholder="Enter 10-digit number"
                                      onChange={(e) =>
                                        setContactPerson((prev) => ({
                                          ...prev,
                                          number: e.target.value.slice(0, 10),
                                        }))
                                      }
                                      className="mt-1"
                                    />
                                  </div>
                                </DialogDescription>
                              </DialogHeader>
                              {update_loading ? (
                                <div className="flex items-center justify-center">
                                  <TailSpin width={80} color="red" />{" "}
                                </div>
                              ) : (
                                <DialogFooter>
                                  <DialogClose asChild>
                                    <Button
                                      variant="outline"
                                      className="flex items-center gap-1"
                                    >
                                      <CircleX className="h-4 w-4" />
                                      Cancel
                                    </Button>
                                  </DialogClose>
                                  <Button
                                    onClick={handleDispatchPO}
                                    className="bg-yellow-500 hover:bg-yellow-600 flex items-center gap-1"
                                  >
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm
                                  </Button>
                                </DialogFooter>
                              )}
                            </DialogContent>
                          </Dialog>
                        </div>
                      </CardFooter>
                    </Card>
                  </SheetContent>
                </Sheet>
              </div>

              {/* Approver Information */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">
                  Approved By:
                </span>
                <Badge variant={"default"}>{po?.owner}</Badge>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="max-sm:text-xs">
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
            <div className="flex flex-col gap-2 items-end">
              {po?.status !== "PO Approved" && (
                <>
                  <Label className=" text-red-700">Date Dispatched</Label>
                  <span>{formatDate(po?.dispatch_date || "")}</span>
                </>
              )}
            </div>
            <div className="flex flex-col gap-2 max-sm:items-end">
              <Label className=" text-red-700">Total (Incl. GST)</Label>
              <span>{formatToRoundedIndianRupee(po?.total_amount)}</span>
            </div>
            <div className="flex flex-col gap-2 sm:items-center">
              <Label className=" text-red-700">Total Invoiced Amount</Label>
              <span>{totalInvoice ? formatToRoundedIndianRupee(totalInvoice) : "--"}</span>
            </div>
          </div>
        </CardContent>
      </Card>

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
