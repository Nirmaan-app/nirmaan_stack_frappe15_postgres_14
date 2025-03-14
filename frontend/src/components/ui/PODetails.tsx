import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { AlertTriangle, CheckCheck, CircleX, Download, Eye, Mail, Phone, Printer, Send, Trash2Icon, Undo2 } from "lucide-react";
import React, { useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate } from "react-router-dom";
import { Badge } from "./badge";
import { Button } from "./button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
import { Input } from "./input";
import { Label } from "./label";
import { Separator } from "./separator";
import {
  Sheet,
  SheetContent,
  SheetTrigger
} from "./sheet";
import { Textarea } from "./textarea";
import { toast } from "./use-toast";
import { VendorHoverCard } from "./vendor-hover-card";

interface PODetailsProps {
  po: ProcurementOrder | null
  summaryPage: boolean
  accountsPage: boolean
  estimatesViewing: boolean
  poPayments: ProjectPayments[] | undefined
  togglePoPdfSheet: () => void
  getTotal?: {
    total: number
    totalAmt: number
  }
  amountPaid: number
  pr: ProcurementRequest
  poMutate: any
}

export const PODetails : React.FC<PODetailsProps> = (
  {po, summaryPage, accountsPage, estimatesViewing, poPayments, togglePoPdfSheet,
    getTotal, amountPaid, poMutate, pr
  }) => {

    const { updateDoc, loading : update_loading } = useFrappeUpdateDoc();
    const {call : deleteCustomPOCall, loading : deleteCustomPOCallLoading} = useFrappePostCall("nirmaan_stack.api.delete_custom_po_and_pr.delete_custom_po");
    const navigate = useNavigate();

    const [contactPerson, setContactPerson] = useState({
        name: "",
        number: "",
      });
    
    const [phoneNumber, setPhoneNumber] = useState("");
    const [email, setEmail] = useState("");
    const [emailSubject, setEmailSubject] = useState("");
    const [emailBody, setEmailBody] = useState("");
    const [phoneError, setPhoneError] = useState("");
    const [emailError, setEmailError] = useState("");

    const [revertDialog, setRevertDialog] = useState(false);
    const toggleRevertDialog = () => {
      setRevertDialog((prevState) => !prevState);
    };

    const [deleteDialog, setDeleteDialog] = useState(false);
    const toggleDeleteDialog = () => {
      setDeleteDialog((prevState) => !prevState);
    };

    const handlePhoneChange = (e: any) => {
       const value = e.target.value.replace(/\D/g, "").slice(0, 10);
       setPhoneNumber(value);
       if (value.length === 10) {
         setPhoneError("");
       }
    };
    
    const handleEmailChange = (e: any) => {
      setEmail(e.target.value);
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value)) {
        setEmailError("");
      }
    };

    const handleDispatchPO = async () => {
        try {
           // Create the update payload with status "Dispatched"
          const updateData: { status: string; delivery_contact?: string } = {
            status: "Dispatched",
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
    
          navigate(`/purchase-orders/${po.name.replaceAll("/", "&=")}?tab=Dispatched+PO`);
        } catch (error) {
          console.log(
            "error while updating the status of the PO to dispatch",
            error
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
            });
      
            await poMutate();
      
            toast({
              title: "Success!",
              description: `PO: ${po.name} Reverted back to PO Approved!`,
              variant: "success",
            });
      
            navigate(`/purchase-orders/${po.name.replaceAll("/", "&=")}?tab=Approved+PO`);
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
            po_id : po.name
          })

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
          

  return (
    <Card className="rounded-sm shadow-m col-span-3 overflow-x-auto">
            <CardHeader>
              <CardTitle className="text-xl max-sm:text-lg text-red-600 flex items-center justify-between">
                <div>
                  <h2>{po?.custom === "true" && "Custom"} PO Details</h2>
                  <Badge
                    variant={
                      po?.status === "PO Approved"
                        ? "default"
                        : po?.status === "Dispatched"
                        ? "orange"
                        : "green"
                    }
                  >
                    {po?.status === "Partially Delivered"
                      ? "Delivered"
                      : po?.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {!summaryPage &&
                    !accountsPage &&
                    !estimatesViewing &&
                    po?.status === "Dispatched" &&
                    !((poPayments || [])?.length > 0) && (
                      <Button
                      variant="outline"
                        onClick={toggleRevertDialog}
                        className="text-xs flex items-center gap-1 border border-red-500 rounded-md p-1 h-8"
                      >
                        <Undo2 className="w-4 h-4" />
                        Revert
                      </Button>
                    )}
                  {(po?.status !== "PO Approved" ||
                    summaryPage ||
                    accountsPage ||
                    estimatesViewing) && (
                    <Button
                      variant="outline"
                      onClick={togglePoPdfSheet}
                      className="text-xs flex items-center gap-1 border border-red-500 rounded-md p-1 h-8"
                    >
                      <Eye className="w-4 h-4" />
                      Preview
                    </Button>
                  )}
                {po?.custom === "true" &&
                  !summaryPage &&
                    !accountsPage &&
                    !estimatesViewing &&
                    po?.status === "PO Approved" &&
                    !((poPayments || [])?.length > 0) && (
                      <Button
                        onClick={toggleDeleteDialog}
                        className="text-xs flex items-center gap-1 rounded-md p-1 px-2 h-8"
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
                      Clicking on Confirm will delete this <span className="text-primary">Custom PO and associated Custom PR</span> permanently!
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


                {!summaryPage &&
                  !accountsPage &&
                  !estimatesViewing &&
                  po?.status === "PO Approved" && (
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button className="flex items-center gap-1 text-xs p-1 h-8 px-2">
                          <Send className="h-4 w-4" />
                          Dispatch PO
                        </Button>
                      </SheetTrigger>
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
                                      {phoneError && (
                                        <p className="text-red-500 text-xs mt-1">
                                          {phoneError}
                                        </p>
                                      )}
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
                                      {emailError && (
                                        <p className="text-red-500 text-xs mt-1">
                                          {emailError}
                                        </p>
                                      )}
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
                              {po?.status === "PO Approved" && !po?.project_gst ? (
                                <HoverCard>
                                  <HoverCardTrigger>
                                    <div className="space-x-2 space-y-2 max-md:text-end max-md:w-full">
                                      <Button
                                        variant="outline"
                                        disabled={
                                          po?.status === "PO Approved" &&
                                          !po?.project_gst
                                        }
                                      >
                                        <Printer className="h-4 w-4 mr-2" />
                                        PO PDF
                                      </Button>
                                      <Button
                                        disabled={!po?.project_gst}
                                        variant="default"
                                        className="bg-yellow-500 hover:bg-yellow-600"
                                      >
                                        <Send className="h-4 w-4 mr-2" />
                                        Mark as Dispatched
                                      </Button>
                                    </div>
                                  </HoverCardTrigger>
                                  <HoverCardContent className="w-80 bg-gray-800 text-white p-2 rounded-md shadow-lg">
                                    Please select and confirm <i>Project GST</i> for
                                    this PO from the{" "}
                                    <span className="text-primary">
                                      Edit Payment Terms Dialog
                                    </span>{" "}
                                    in order to enable PDF and Dispatch buttons!
                                  </HoverCardContent>
                                </HoverCard>
                              ) : (
                                <>
                                  <Button
                                    variant="outline"
                                    onClick={togglePoPdfSheet}
                                  >
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
                                        <DialogTitle>
                                          Confirm PO Dispatch?
                                        </DialogTitle>
                                        <DialogDescription className="pt-2 flex flex-col gap-2">
                                          <p>
                                            You can add the delivery person's
                                            details here.
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
                                                  number: e.target.value.slice(
                                                    0,
                                                    10
                                                  ),
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
                                </>
                              )}
                            </div>
                          </CardFooter>
                        </Card>
                      </SheetContent>
                    </Sheet>
                  )}
                </div>
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
              </CardTitle>
            </CardHeader>
    
            <CardContent className="max-sm:text-xs">
              <div className="grid grid-cols-3 gap-4 space-y-2 max-sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label className=" text-red-700">Vendor</Label>
                  <VendorHoverCard vendor_id={po?.vendor} />
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
                  <span>{formatToIndianRupee(getTotal?.total)}</span>
                </div>
                <div className="flex flex-col gap-2 sm:items-center">
                  <Label className=" text-red-700">Total Amount Paid</Label>
                  <span>{amountPaid ? formatToIndianRupee(amountPaid) : "--"}</span>
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <Label className=" text-red-700">Total (Incl. GST)</Label>
                  <span>
                    {formatToIndianRupee(Math.floor(getTotal?.totalAmt || 0))}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
  )
}