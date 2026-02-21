import Seal from "@/assets/NIRMAAN-SEAL.jpeg";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useFrappeCreateDoc, useFrappeDocumentEventListener, useFrappeFileUpload, useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { CheckIcon, CirclePlus, Edit, PencilIcon, Save, SquarePlus, Trash, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
// import { Button } from "../ui/button";
import { Input } from "@/components/ui/input";
import { Pencil2Icon } from "@radix-ui/react-icons";
// import { Button, Layout } from 'antd';
import logo from "@/assets/logo-svg.svg";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { SRDetailsCard } from "./components/SRDetailsCard";
import { SRComments } from "./components/SRComments";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import SITEURL from "@/constants/siteURL";
import { InvoiceDialog } from "@/pages/ProcurementOrders/invoices-and-dcs/components/InvoiceDialog";
import RequestPaymentDialog from "@/pages/ProjectPayments/request-payment/RequestPaymentDialog";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { formatDate } from "@/utils/FormatDate";
import { getSRTotal, getTotalAmountPaid } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { debounce } from "lodash";
import { TailSpin } from "react-loader-spinner";
import { v4 as uuidv4 } from 'uuid'; // Import uuid for unique IDs
import { SRAmendSheet } from "../sr-form/amend";
import { useUserData } from "@/hooks/useUserData";
import { SRDeleteConfirmationDialog } from "../components/SRDeleteConfirmationDialog";
import { SRFinalizeDialog, SRRevertFinalizeDialog } from "../components/SRFinalizeDialog";
import { useServiceRequestLogic } from "../hooks/useServiceRequestLogic";
import { useSRFinalizePermissions, useFinalizeSR, useRevertFinalizeSR } from "../hooks/useSRFinalize";
import { DocumentAttachments } from "@/pages/ProcurementOrders/invoices-and-dcs/DocumentAttachments";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { DeletePaymentDialog } from "@/pages/ProjectPayments/update-payment/DeletePaymentDialog";
import SRPdf from "./SRPdf";
import { PaymentVoucherActions } from "@/components/paymentsVoucher/PaymentVoucherActions";

// const { Sider, Content } = Layout;

interface ApprovedSRProps {
    summaryPage?: boolean;
    accountsPage?: boolean;
}

export const ApprovedSR = ({ summaryPage = false, accountsPage = false }: ApprovedSRProps) => {

    const params = useParams();
    const { role, user_id } = useUserData()

    const isPMUser = role === "Nirmaan Project Manager Profile"
    const isEstimatesExecutive = role === "Nirmaan Estimates Executive Profile"

    const id = accountsPage ? params.id : params.srId;

    if (!id) return <div>No Service Request ID Provided</div>

    const { toggleRequestPaymentDialog, toggleNewInvoiceDialog } = useDialogStore()

    const [selectedGST, setSelectedGST] = useState<{ gst: string | undefined, location?: string | undefined } | null>(null);

    const { data: service_request, isLoading: service_request_loading, mutate: service_request_mutate } = useFrappeGetDoc("Service Requests", id, id ? `Service Requests ${id}` : null)

    useFrappeDocumentEventListener("Service Requests", id, (event) => {
        console.log("Service Requests document updated (real-time):", event);
        toast({
            title: "Document Updated",
            description: `Service Requests ${event.name} has been modified.`,
        });
        service_request_mutate(); // Re-fetch this specific document
    },
        true // emitOpenCloseEventsOnMount (default)
    )

    const [orderData, setOrderData] = useState<ServiceRequests | undefined>()
    const [notes, setNotes] = useState<{ id: string, note: string }[]>([])
    const [curNote, setCurNote] = useState<string | null>(null)
    const [gstEnabled, setGstEnabled] = useState(false)

    const [srPdfSheet, setSrPdfSheet] = useState(false)
    const [deleteFlagged, setDeleteFlagged] = useState<ProjectPayments | null>(null);

    const toggleSrPdfSheet = useCallback(() => {
        setSrPdfSheet((prevState) => !prevState)
    }, []);

    const [editSrTermsDialog, setEditSrTermsDialog] = useState(false)

    const toggleEditSrTermsDialog = useCallback(() => {
        setEditSrTermsDialog((prevState) => !prevState)
    }, []);

    const [warning, setWarning] = useState("");

    const { upload: upload, loading: upload_loading } = useFrappeFileUpload()

    const { call } = useFrappePostCall('frappe.client.set_value')

    const [newPaymentDialog, setNewPaymentDialog] = useState(false);

    const toggleNewPaymentDialog = useCallback(() => {
        setNewPaymentDialog((prevState) => !prevState);
    }, []);

    const [newPayment, setNewPayment] = useState({
        amount: "",
        payment_date: "",
        utr: "",
        tds: ""
    });

    const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);

    const [deleteDialog, setDeleteDialog] = useState(false)
    // Use the custom hook for deletion logic
    const { deleteServiceRequest, isDeleting } = useServiceRequestLogic({
        onSuccess: (_deletedSrName) => {
            service_request_mutate();
            setDeleteDialog(false);
        },
        onError: (error, srName) => {
            console.error(`Error deleting WO ${srName} from table view:`, error);
        },
        navigateOnSuccessPath: "/service-requests?tab=approved-sr"
    });

    // Finalization state and hooks
    const [finalizeDialog, setFinalizeDialog] = useState(false);
    const [revertFinalizeDialog, setRevertFinalizeDialog] = useState(false);
    const [commentsRefreshTrigger, setCommentsRefreshTrigger] = useState(0);

    const {
        canFinalize,
        canRevert,
        isFinalized,
        finalizedBy,
        finalizedOn,
        refetch: refetchFinalizePermissions,
    } = useSRFinalizePermissions(id);

    const handleFinalizeSuccess = useCallback(() => {
        service_request_mutate();
        refetchFinalizePermissions();
        setCommentsRefreshTrigger(prev => prev + 1); // Refresh comments to show auto-remark
        setFinalizeDialog(false);
    }, [service_request_mutate, refetchFinalizePermissions]);

    const handleRevertSuccess = useCallback(() => {
        service_request_mutate();
        refetchFinalizePermissions();
        setCommentsRefreshTrigger(prev => prev + 1); // Refresh comments to show auto-remark
        setRevertFinalizeDialog(false);
    }, [service_request_mutate, refetchFinalizePermissions]);

    const { finalize, isLoading: isFinalizingLoading } = useFinalizeSR({
        projectId: service_request?.project,
        onSuccess: handleFinalizeSuccess
    });
    const { revert, isLoading: isRevertingLoading } = useRevertFinalizeSR({
        projectId: service_request?.project,
        onSuccess: handleRevertSuccess
    });

    const handleFinalize = useCallback(() => {
        if (id) {
            finalize(id);
        }
    }, [finalize, id]);

    const handleRevertFinalize = useCallback(() => {
        if (id) {
            revert(id);
        }
    }, [revert, id]);

    const { data: service_vendor, isLoading: service_vendor_loading } = useFrappeGetDoc<Vendors>("Vendors", service_request?.vendor, service_request?.vendor ? `Vendors ${service_request?.vendor}` : null)

    const { data: project, isLoading: project_loading } = useFrappeGetDoc<Projects>("Projects", service_request?.project, service_request?.project ? `Projects ${service_request?.project}` : null)

    const { data: projectPayments, isLoading: projectPaymentsLoading, mutate: projectPaymentsMutate } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
        fields: ["*"],
        filters: [["document_name", "=", id]],
        limit: 100
    })

    // Fetch vendor invoices for this SR
    const { data: vendorInvoices, isLoading: vendorInvoicesLoading } = useFrappeGetDocList<VendorInvoice>("Vendor Invoices", {
        fields: ["name"],
        filters: [["document_type", "=", "Service Requests"], ["document_name", "=", id]],
        limit: 1000,
    }, id ? `VendorInvoices-SR-${id}` : null)

    const getAmountPaid = useMemo(() => getTotalAmountPaid(projectPayments?.filter(i => i?.status === "Paid") || []), [projectPayments]);

    const amountPending = useMemo(() => getTotalAmountPaid((projectPayments || []).filter(i => ["Requested", "Approved"].includes(i?.status))), [projectPayments]);

    useEffect(() => {
        if (service_request) {
            // Note: invoice_data parsing removed - now using Vendor Invoices doctype
            const data = {
                ...service_request,
                notes: service_request?.notes && JSON.parse(service_request?.notes),
                service_order_list: service_request?.service_order_list && JSON.parse(service_request.service_order_list),
                service_category_list: service_request?.service_category_list && JSON.parse(service_request.service_category_list)
            }
            setOrderData(data)
            const notes = service_request?.notes && JSON.parse(service_request?.notes)?.list
            setNotes(notes || [])
            const gst = service_request?.gst
            if (gst === "true") {
                setGstEnabled(true)
            } else {
                setGstEnabled(false)
            }
            if (service_request?.project_gst) {
                setSelectedGST((prev) => ({ ...prev, gst: service_request?.project_gst }));
            }
        }
    }, [service_request])

    const { updateDoc, loading: update_loading } = useFrappeUpdateDoc()

    const { createDoc, loading: createLoading } = useFrappeCreateDoc()

    const componentRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `${orderData?.name}_${orderData?.vendor}`
    });

    const getTotal = useMemo(() => getSRTotal(orderData), [orderData])

    const [editingIndex, setEditingIndex] = useState<string | null>(null);

    const [amendDialog, setAmendDialog] = useState(false);

    const toggleAmendDialog = useCallback(() => {
        setAmendDialog((prevState) => !prevState);
    }, []);

    const handleAddNote = useCallback(() => {
        if (editingIndex !== null) {
            const updatedNotes = notes.map(note =>
                note.id === editingIndex ? { ...note, note: curNote || "" } : note
            );
            setNotes(updatedNotes);
            setEditingIndex(null);
        } else {
            const newNote = { id: uuidv4(), note: curNote || "" }
            setNotes([...notes, newNote])
        }
        setCurNote(null);
    }, [notes, curNote, editingIndex]);

    const handleEditNote = useCallback((id: string) => {
        setCurNote(notes?.find((i) => i?.id === id)?.note || "");
        setEditingIndex(id);
    }, [notes]);

    const handleDeleteNote = useCallback((id: string) => {
        setNotes(notes.filter((note) => note?.id !== id));
    }, [notes]);

    const handleNotesSave = async () => {
        try {

            let updatedData = {}

            updatedData = { ...updatedData, notes: { list: notes } }

            if (orderData?.project_gst !== selectedGST?.gst) {
                updatedData = { ...updatedData, project_gst: selectedGST?.gst }
            }

            // if(parseFloat(service_request?.advance || 0) !== advance) {
            //     updatedData = {...updatedData, advance: advance}
            // }

            await updateDoc("Service Requests", orderData!.name, updatedData)

            // console.log("updatedData", data)

            await service_request_mutate()

            toggleEditSrTermsDialog()

            toast({
                title: "Success!",
                description: `Saved notes successfully!`,
                variant: "success"
            })
        } catch (error) {
            console.log("error while adding notes to the database", error)
            toast({
                title: "Failed!",
                description: `Saving notes Failed!`,
                variant: "destructive"
            })
        }
    }

    const handleGstToggle = async (enabled: boolean) => {
        setGstEnabled(enabled);
        try {
            await updateDoc("Service Requests", orderData!.name, { gst: String(enabled) });
            await service_request_mutate();
            toast({
                title: "Success!",
                description: "GST status updated successfully!",
                variant: "success"
            });
        } catch (error) {
            setGstEnabled(!enabled); // revert on failure
            console.log("error while toggling GST", error);
            toast({
                title: "Failed!",
                description: "Failed to update GST status!",
                variant: "destructive"
            });
        }
    };

    const AddPayment = async () => {
        try {

            const res = await createDoc("Project Payments", {
                document_type: "Service Requests",
                document_name: id,
                project: orderData?.project,
                vendor: orderData?.vendor,
                utr: newPayment?.utr,
                amount: parseNumber(newPayment?.amount),
                tds: parseNumber(newPayment?.tds),
                payment_date: newPayment?.payment_date,
                status: "Paid"
            })

            if (paymentScreenshot) {
                const fileArgs = {
                    doctype: "Project Payments",
                    docname: res?.name,
                    fieldname: "payment_attachment",
                    isPrivate: true,
                };

                const uploadedFile = await upload(paymentScreenshot, fileArgs);

                await call({
                    doctype: "Project Payments",
                    name: res?.name,
                    fieldname: "payment_attachment",
                    value: uploadedFile.file_url,
                });
            }

            await projectPaymentsMutate()

            toggleNewPaymentDialog()

            toast({
                title: "Success!",
                description: "Payment added successfully!",
                variant: "success",
            });

            setNewPayment({
                amount: "",
                payment_date: "",
                utr: "",
                tds: ""
            })

            setPaymentScreenshot(null)

        } catch (error) {
            console.log("error", error)
            toast({
                title: "Failed!",
                description: "Failed to add Payment!",
                variant: "destructive",
            });
        }
    }

    const validateAmount = useCallback(
        debounce((amount: string) => {

            const compareAmount = orderData?.gst === "true"
                ? (getTotal * 1.18 - getAmountPaid)
                : (getTotal - getAmountPaid);

            if (parseNumber(amount) > compareAmount) {
                setWarning(
                    `Entered amount exceeds the total ${getAmountPaid ? "remaining" : ""} amount 
            ${orderData?.gst === "true" ? "including" : "excluding"
                    } GST: ${formatToRoundedIndianRupee(compareAmount)}`
                );
            } else {
                setWarning("");
            }
        }, 300), [orderData, getTotal, getAmountPaid])

    // Handle input change
    const handleAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const amount = e.target.value;
        setNewPayment({ ...newPayment, amount });
        validateAmount(amount);
    }, [validateAmount]);

    // const handleDeletePayment = async () => {
    //     try {

    //         await deleteDoc("Project Payments", deleteFlagged?.name);

    //         await projectPaymentsMutate();

    //         toast({
    //             title: "Success!",
    //             description: "Payment deleted successfully!",
    //             variant: "success",
    //         });

    //     } catch (error) {
    //         console.log("error", error);
    //         toast({
    //             title: "Failed!",
    //             description: "Failed to delete Payment!",
    //             variant: "destructive",
    //         });
    //     }
    // }


    if (
        service_request_loading ||
        service_vendor_loading ||
        project_loading ||
        projectPaymentsLoading ||
        vendorInvoicesLoading
    )
        return (
            <LoadingFallback />
        );

    // Handler for the dialog confirmation
    const handleConfirmDelete = () => {
        if (orderData) {
            deleteServiceRequest(orderData.name); // Call the hook's function
        }
    }



    // Compute delete disabled state - also disabled when finalized
    const deleteDisabled = isDeleting || summaryPage || accountsPage || isFinalized ||
        ((projectPayments || [])?.length > 0) ||
        ((vendorInvoices || [])?.length > 0) ||
        (orderData?.owner !== user_id && role !== "Nirmaan Admin Profile" && role !== "Nirmaan PMO Executive Profile");

    return (
        <div className="flex-1 space-y-4">
            {/* WO Details Card - using new SRDetailsCard component */}
            <SRDetailsCard
                orderData={orderData}
                project={project}
                vendor={service_vendor}
                gstEnabled={gstEnabled}
                getTotal={getTotal}
                amountPaid={getAmountPaid}
                // isRestrictedRole removed, using specific flags below
                hideActions={isEstimatesExecutive}
                hideAmounts={isPMUser}
                onDelete={() => setDeleteDialog(true)}
                onAmend={toggleAmendDialog}
                onAddInvoice={toggleNewInvoiceDialog}
                onRequestPayment={toggleRequestPaymentDialog}
                onPreview={toggleSrPdfSheet}
                onEditTerms={toggleEditSrTermsDialog}
                summaryPage={summaryPage}
                accountsPage={accountsPage}
                deleteDisabled={deleteDisabled}
                isDeleting={isDeleting}
                // Finalization props
                isFinalized={isFinalized}
                finalizedBy={finalizedBy}
                finalizedOn={finalizedOn}
                canFinalize={canFinalize}
                canRevert={canRevert}
                onFinalize={() => setFinalizeDialog(true)}
                onRevertFinalize={() => setRevertFinalizeDialog(true)}
                isProcessingFinalize={isFinalizingLoading || isRevertingLoading}
                missingGst={!orderData?.project_gst}
                isOwner={orderData?.owner === user_id}
            />

            {/* Delete Confirmation Dialog */}
            <SRDeleteConfirmationDialog
                open={deleteDialog}
                onOpenChange={() => setDeleteDialog(false)}
                itemName={orderData?.name}
                itemType="Service Request"
                onConfirm={handleConfirmDelete}
                isDeleting={isDeleting}
            />

            {/* Finalize Confirmation Dialog */}
            <SRFinalizeDialog
                open={finalizeDialog}
                onOpenChange={setFinalizeDialog}
                srName={orderData?.name}
                onConfirm={handleFinalize}
                isProcessing={isFinalizingLoading}
            />

            {/* Revert Finalization Dialog */}
            <SRRevertFinalizeDialog
                open={revertFinalizeDialog}
                onOpenChange={setRevertFinalizeDialog}
                srName={orderData?.name}
                onConfirm={handleRevertFinalize}
                isProcessing={isRevertingLoading}
            />

            {/* Amend Sheet */}
            <SRAmendSheet
                srId={id}
                isOpen={amendDialog}
                onOpenChange={toggleAmendDialog}
                onSuccess={() => service_request_mutate()}
            />

            {/* Transaction Details and WO Options - visible to all, but inner content restricted */ }
            {!isPMUser &&(<div className="grid gap-4 max-[1000px]:grid-cols-1 grid-cols-6">
                    <Card className="rounded-sm shadow-m col-span-3 overflow-x-auto">
                        <CardHeader>
                            <CardTitle className="text-xl max-sm:text-lg text-red-600 flex items-center justify-between">
                                <p>Transaction Details</p>

                                {!accountsPage && !summaryPage && (
                                    <>
                                        <Button
                                            variant="outline"
                                            className="text-primary border-primary text-xs px-2"
                                            onClick={toggleRequestPaymentDialog}
                                            disabled={isPMUser || isEstimatesExecutive}

                                        >
                                            Request Payment
                                        </Button>

                                        <RequestPaymentDialog
                                            totalIncGST={orderData?.gst === "true" ? getTotal * 1.18 : getTotal}
                                            totalExGST={getTotal || 0}
                                            paid={getAmountPaid}
                                            pending={amountPending}
                                            gst={orderData?.gst === "true"}
                                            docType="Service Requests"
                                            docName={orderData?.name || "Unknown"}
                                            project={orderData?.project || "Unknown"}
                                            vendor={orderData?.vendor || "Unknown"}
                                            onSuccess={projectPaymentsMutate}
                                        />
                                    </>
                                )}
                                {accountsPage && (
                                    <AlertDialog open={newPaymentDialog} onOpenChange={toggleNewPaymentDialog}>
                                        <AlertDialogTrigger
                                            onClick={() => setNewPayment({ ...newPayment, payment_date: new Date().toISOString().split("T")[0] })}
                                        >
                                            <SquarePlus className="w-5 h-5 text-red-500 cursor-pointer" />
                                        </AlertDialogTrigger>
                                        <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                                            <AlertDialogHeader className="text-start">
                                                <div className="flex items-center justify-between">
                                                    <Label className=" text-red-700">Project:</Label>
                                                    <span className="">{project?.project_name}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <Label className=" text-red-700">Vendor:</Label>
                                                    <span className="">{service_vendor?.vendor_name}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <Label className=" text-red-700">PO Amt excl. Tax:</Label>
                                                    <span className="">{formatToRoundedIndianRupee(getTotal)}</span>
                                                </div>
                                                {orderData?.gst === "true" && (
                                                    <div className="flex items-center justify-between">
                                                        <Label className=" text-red-700">PO Amt incl. Tax:</Label>
                                                        <span className="">{formatToRoundedIndianRupee(Math.floor(getTotal))}</span>
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between">
                                                    <Label className=" text-red-700">Amt Paid Till Now:</Label>
                                                    <span className="">{getAmountPaid ? formatToRoundedIndianRupee(getAmountPaid) : "--"}</span>
                                                </div>

                                                <div className="flex flex-col gap-4 pt-4">
                                                    <div className="flex gap-4 w-full">
                                                        <Label className="w-[40%]">Amount<sup className=" text-sm text-red-600">*</sup></Label>
                                                        <div className="w-full">
                                                            <Input
                                                                type="number"
                                                                placeholder="Enter Amount"
                                                                value={newPayment.amount}
                                                                onChange={(e) => handleAmountChange(e)}
                                                            />
                                                            {warning && <p className="text-red-600 mt-1 text-xs">{warning}</p>}
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-4 w-full">
                                                        <Label className="w-[40%]">TDS Amount</Label>
                                                        <div className="w-full">
                                                            <Input
                                                                type="number"
                                                                placeholder="Enter TDS Amount"
                                                                value={newPayment.tds}
                                                                onChange={(e) => {
                                                                    const tdsValue = e.target.value;
                                                                    setNewPayment({ ...newPayment, tds: tdsValue })
                                                                }}
                                                            />
                                                            {parseNumber(newPayment?.tds) > 0 && <span className="text-xs">Amount Paid : {formatToRoundedIndianRupee(parseNumber(newPayment?.amount) - parseNumber(newPayment?.tds))}</span>}
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-4 w-full">
                                                        <Label className="w-[40%]">UTR<sup className=" text-sm text-red-600">*</sup></Label>
                                                        <Input
                                                            type="text"
                                                            placeholder="Enter UTR"
                                                            value={newPayment.utr}
                                                            onChange={(e) => setNewPayment({ ...newPayment, utr: e.target.value })}
                                                        />
                                                    </div>

                                                    <div className="flex gap-4 w-full" >
                                                        <Label className="w-[40%]">Payment Date<sup className=" text-sm text-red-600">*</sup></Label>
                                                        <Input
                                                            type="date"
                                                            value={newPayment.payment_date}
                                                            placeholder="DD/MM/YYYY"
                                                            onChange={(e) => setNewPayment({ ...newPayment, payment_date: e.target.value })}
                                                            max={new Date().toISOString().split("T")[0]}
                                                            onKeyDown={(e) => e.preventDefault()}
                                                        />
                                                    </div>
                                                </div>

                                                <CustomAttachment
                                                    maxFileSize={20 * 1024 * 1024} // 20MB
                                                    selectedFile={paymentScreenshot}
                                                    onFileSelect={setPaymentScreenshot}
                                                    label="Attach Screenshot"
                                                    className="w-full"
                                                />

                                                <div className="flex gap-2 items-center pt-4 justify-center">

                                                    {createLoading || upload_loading ? <TailSpin color="red" width={40} height={40} /> : (
                                                        <>
                                                            <AlertDialogCancel className="flex-1" asChild>
                                                                <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                                            </AlertDialogCancel>
                                                            <Button
                                                                onClick={AddPayment}
                                                                disabled={!newPayment.amount || !newPayment.utr || !newPayment.payment_date || !!warning || isPMUser}
                                                                className="flex-1">Add Payment
                                                            </Button>
                                                        </>
                                                    )}
                                                </div>

                                            </AlertDialogHeader>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="text-black font-bold">Amount</TableHead>
                                        {/* {service_request?.gst === "true" && (
                                    <TableHead className="text-black font-bold">TDS Amt</TableHead>
                                )} */}
                                        <TableHead className="text-black font-bold">UTR No.</TableHead>
                                        <TableHead className="text-black font-bold">Date</TableHead>
                                        <TableHead className="text-black font-bold w-[5%]">Status</TableHead>
                                        {/* 1. ADD VOUCHER HEADER */}
                                        <TableHead className="text-black font-bold text-center">Voucher</TableHead>
                                        {/* --------------------- */}
                                        <TableHead></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {(projectPayments || []).length > 0 ? (
                                        projectPayments?.map((payment) => {
                                            return (
                                                <TableRow key={payment?.name}>
                                                    <TableCell className="font-semibold">{formatToRoundedIndianRupee(payment?.amount)}</TableCell>
                                                    {/* {service_request?.gst === "true" && (
                                                     <TableCell className="font-semibold">{formatToIndianRupee(payment?.tds)}</TableCell>
                                                 )} */}
                                                    {(payment?.utr && payment?.payment_attachment) ? (
                                                        <TableCell className="font-semibold text-blue-500 underline">
                                                            <a href={`${SITEURL}${payment?.payment_attachment}`} target="_blank" rel="noreferrer">
                                                                {payment?.utr}
                                                            </a>
                                                        </TableCell>
                                                    ) : (
                                                        <TableCell className="font-semibold">
                                                            {payment?.utr || "--"}
                                                        </TableCell>
                                                    )}


                                                    <TableCell className="font-semibold">{formatDate(payment?.payment_date || payment?.creation)}</TableCell>
                                                    <TableCell className="font-semibold">{payment?.status}</TableCell>
                                                    {/* 2. RENDER THE PaymentVoucherActions COMPONENT */}
                                                    <TableCell className="text-center w-[10%]">
                                                        {payment?.status === "Paid" && orderData?.name ? (
                                                            <PaymentVoucherActions
                                                                payment={payment}
                                                                srName={orderData.name} // Pass SR ID for file naming (if orderData is ServiceRequests)
                                                                onVoucherUpdate={projectPaymentsMutate} // Pass the SWR mutate function to refresh payments after upload/delete
                                                                hideActions={isEstimatesExecutive}
                                                            />
                                                        ) : ("--")}
                                                    </TableCell>
                                                    {/* ----------------------------------------------- */}

                                                    <TableCell className="text-red-500 text-end w-[5%]">
                                                        {!["Paid", "Approved"].includes(payment?.status) && !summaryPage &&
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 p-0 text-destructive hover:bg-destructive/5 hover:text-destructive/90"
                                                                onClick={() => setDeleteFlagged(payment)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        }

                                                        <DeletePaymentDialog isOpen={!!deleteFlagged} onOpenChange={() => setDeleteFlagged(null)} paymentToDelete={deleteFlagged} onDeleteSuccess={() => projectPaymentsMutate()} />
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={orderData?.gst === "true" ? 4 : 3} className="text-center py-2">
                                                No Payments Found
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                    <Card className="rounded-sm shadow-md col-span-3 overflow-x-auto">
                        <CardHeader>
                            <CardTitle className="text-xl max-sm:text-lg text-red-600 flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                    WO Options
                                    {!orderData?.project_gst && (
                                        <TriangleAlert className="text-primary max-sm:w-4 max-sm:h-4" />
                                    )}
                                </div>
                                {!summaryPage && !accountsPage && !isFinalized && !isEstimatesExecutive && (
                                    <Dialog open={editSrTermsDialog} onOpenChange={toggleEditSrTermsDialog}>
                                        <DialogTrigger>
                                            <Button variant={"outline"} className="felx items-center gap-1">
                                                <PencilIcon className="w-4 h-4" />
                                                Edit
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent className="overflow-auto max-h-[80vh] w-full">
                                            <div className="flex flex-col gap-1 pt-6">
                                                <h3
                                                    className={`font-semibold text-lg tracking-tight ${!selectedGST?.gst ? "text-primary" : ""
                                                        }`}
                                                >
                                                    Nirmaan GST for Billing
                                                    <sup className="text-sm text-red-600">*</sup>
                                                </h3>
                                                {project &&
                                                    JSON.parse(project?.project_gst_number as unknown as string)?.list
                                                        ?.length > 0 && (
                                                        <>
                                                            <Select
                                                                value={selectedGST?.gst}
                                                                defaultValue={orderData?.project_gst}
                                                                onValueChange={(selectedOption) => {
                                                                    const gstArr = JSON.parse(
                                                                        project?.project_gst_number as unknown as string
                                                                    )?.list;
                                                                    setSelectedGST(
                                                                        gstArr.find(
                                                                            (item: { gst: string; location: string }) =>
                                                                                item.gst === selectedOption
                                                                        )
                                                                    );
                                                                }}
                                                            >
                                                                <SelectTrigger
                                                                    className={`${!selectedGST?.gst
                                                                        ? "text-primary border-primary ring-1 ring-inset ring-primary"
                                                                        : ""
                                                                        }`}
                                                                >
                                                                    <SelectValue placeholder="Select Project GST" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {JSON.parse(
                                                                        project?.project_gst_number as unknown as string
                                                                    )?.list?.map((option: { gst: string; location: string }) => (
                                                                        <SelectItem
                                                                            key={option.location}
                                                                            value={option.gst}
                                                                        >
                                                                            {option.location}
                                                                            {` (${option.gst})`}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                            {selectedGST?.gst && !orderData?.project_gst && (
                                                                <span className="text-sm">
                                                                    <strong>Note:</strong>{" "}
                                                                    <span className="text-primary">
                                                                        GST selected but not saved, click on
                                                                        Save below!
                                                                    </span>
                                                                </span>
                                                            )}
                                                        </>
                                                    )}
                                            </div>
                                            <div className="flex flex-col pt-4 gap-2">
                                                <h3 className="text-sm font-semibold">Create Note Points</h3>
                                                <div className="flex max-md:flex-col gap-4 md:items-center">
                                                    <Input
                                                        type="text"
                                                        placeholder="type notes here..."
                                                        value={curNote || ""}
                                                        className="w-[90%]"
                                                        onChange={(e) => setCurNote(e.target.value)}
                                                    />
                                                    <Button onClick={handleAddNote}
                                                        className="w-20"
                                                        disabled={!curNote}>
                                                        {editingIndex === null ? <div className="flex gap-1 items-center"><CirclePlus className="w-4 h-4" /><span>Add</span></div> : <div className="flex gap-1 items-center"><Edit className="w-4 h-4" /><span>Update</span></div>}
                                                    </Button>
                                                </div>
                                            </div>

                                            {notes?.length > 0 && (
                                                <div className="flex flex-col gap-2 pt-4">
                                                    <h3 className="text-sm font-semibold">Notes Preview</h3>
                                                    <ul className="list-[number] space-y-2">
                                                        {notes.map((note) => (
                                                            <li key={note?.id} className="ml-4">
                                                                <div className="flex items-center gap-2">
                                                                    <p>{note?.note}</p>
                                                                    <div className="flex gap-2 items-center">
                                                                        {editingIndex === note?.id ? (
                                                                            <CheckIcon
                                                                                className="w-4 h-4 cursor-pointer text-green-500"
                                                                                onClick={handleAddNote}
                                                                            />
                                                                        ) : (
                                                                            <Pencil2Icon
                                                                                className="w-4 h-4 cursor-pointer"
                                                                                onClick={() => handleEditNote(note?.id)}
                                                                            />
                                                                        )}
                                                                        <span>|</span>
                                                                        <Trash
                                                                            className="w-4 h-4 text-primary cursor-pointer"
                                                                            onClick={() => handleDeleteNote(note?.id)}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}

                                            <Button disabled={update_loading || (!notes?.length && !(orderData?.notes?.list?.length) &&
                                                orderData?.project_gst === selectedGST?.gst)
                                            }
                                                onClick={handleNotesSave}
                                                className="w-full mt-4 items-center flex gap-2">
                                                {update_loading ? <TailSpin width={20} height={20} color="red" /> : <><Save className="w-4 h-4" /> <span>Save</span></>}
                                            </Button>
                                        </DialogContent>
                                    </Dialog>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col gap-2 items-start mt-4">
                                <Label className="font-bold">Nirmaan GST for Billing</Label>
                                {orderData?.project_gst ? (
                                    <span className="text-sm text-gray-900">
                                        {(() => {
                                            try {
                                                const gstList = JSON.parse((project?.project_gst_number as unknown as string) || '{"list":[]}')?.list || [];
                                                const match = gstList.find((item: any) => item.gst === orderData.project_gst);
                                                return match ? `${match.location} (${match.gst})` : orderData.project_gst;
                                            } catch {
                                                return orderData.project_gst;
                                            }
                                        })()}
                                    </span>
                                ) : (
                                    <span className="text-sm text-amber-600 flex items-center gap-1">
                                        Not Selected <TriangleAlert className="w-3.5 h-3.5" />
                                    </span>
                                )}
                            </div>

                            <Separator className="my-4" />

                            <div className="flex flex-col gap-2 items-start">
                                <Label className="font-bold">Notes</Label>
                                {notes?.length > 0 ? (
                                    <ul className="list-[number]">
                                        {notes?.map((note) => (
                                            <li key={note?.id} className="text-sm text-gray-900 ml-4">{note?.note}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <span>--</span>
                                )}
                            </div>

                            <Separator className="my-4" />

                            {!isEstimatesExecutive && (
                                <div className="flex items-center justify-between">
                                    <Label className="font-bold">GST Applicable?</Label>
                                    <Switch
                                        checked={gstEnabled}
                                        onCheckedChange={handleGstToggle}
                                    />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>)}
            
            

            {/* Hide DocumentAttachments (Invoices and DCs) for restricted roles */}
            {/* DocumentAttachments (Invoices and DCs) - visibility handled internally or via props */}
            {!isPMUser &&(
               <DocumentAttachments
                docType="Service Requests"
                docName={service_request?.name}
                documentData={orderData}
                docMutate={service_request_mutate}
                project={project}
                isPMUserChallans={isPMUser || false}
                isEstimatesExecutive={isEstimatesExecutive}
            />
            )}
            
            {/* <SRAttachments SR={orderData} /> */}

            <InvoiceDialog docType={"Service Requests"} docName={service_request?.name} docMutate={service_request_mutate} vendor={service_request?.vendor} />

            {/* Order Details  */}
            <Card className="rounded-sm shadow-md md:col-span-3 overflow-x-auto">
                <CardHeader>
                    <CardTitle className="text-xl max-sm:text-lg text-red-600">
                        Order Details
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <table className="table-auto w-full">
                        <thead>
                            <tr className="border-gray-200 border-b-2 text-primary max-sm:text-sm">
                                <th className="w-[5%] text-left ">
                                    S.No.
                                </th>
                                <th className={isPMUser ? "w-[60%] text-left px-2" : "w-[50%] text-left px-2"}>
                                    Service Description
                                </th>
                                <th className="w-[10%]  text-center px-2">
                                    Unit
                                </th>
                                <th className="w-[10%]  text-center px-2">
                                    Quantity
                                </th>
                                {!isPMUser && (
                                    <>
                                        <th className="w-[10%]  text-center px-2">
                                            Rate
                                        </th>
                                        <th className="w-[10%]  text-center px-2">
                                            Amount
                                        </th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody className="max-sm:text-xs text-sm">
                            {orderData && orderData?.service_order_list?.list?.map((item, index) => (
                                <tr key={index} className="border-b-2">
                                    <td className="w-[5%] text-start ">
                                        {index + 1}
                                    </td>
                                    <td className={isPMUser ? "w-[60%] text-left py-1" : "w-[50%] text-left py-1"}>
                                        <p className="font-semibold">{item?.category}</p>
                                        <span className="whitespace-pre-wrap">{item?.description}</span>
                                    </td>
                                    <td className="w-[10%]  text-center">
                                        {item.uom}
                                    </td>
                                    <td className="w-[10%]  text-center">
                                        {item.quantity}
                                    </td>
                                    {!isPMUser && (
                                        <>
                                            <td className="w-[10%]  text-center">
                                                {formatToIndianRupee(item?.rate)}
                                            </td>
                                            <td className="w-[10%]  text-center">
                                                {formatToIndianRupee(parseNumber(item.rate) * parseNumber(item.quantity))}
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </CardContent>
            </Card>

            {/* SR Comments Card */}
            {id && (
                <Card className="rounded-sm shadow-md p-2">
                    <SRComments srId={id} refreshTrigger={commentsRefreshTrigger} />
                </Card>
            )}

            {/* SR PDF Sheet */}
            <SRPdf
                srPdfSheet={srPdfSheet}
                toggleSrPdfSheet={toggleSrPdfSheet}
                handlePrint={handlePrint}
                componentRef={componentRef}
                orderData={orderData}
                service_vendor={service_vendor}
                project={project}
                gstEnabled={gstEnabled}
                getTotal={getTotal}
                notes={notes}
                logo={logo}
                Seal={Seal}
                formatToIndianRupee={formatToIndianRupee}
                parseNumber={parseNumber}
            //   AddressView={AddressView}
            />

            {/* <Sheet open={srPdfSheet} onOpenChange={toggleSrPdfSheet}>
                <SheetContent className="overflow-y-auto md:min-w-[700px]">
                    <Button onClick={handlePrint} className="flex items-center gap-1">
                        <Printer className="h-4 w-4" />
                        Print
                    </Button>
                    <div className={`w-full border mt-6`}>
                        <div ref={componentRef} className="w-full p-2">
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-gray-200">
                                    <thead className="border-b border-black">
                                        <tr>
                                            <th colSpan={8}>
                                                <div className="flex justify-between border-gray-600 pb-1">
                                                    <div className="mt-2 flex justify-between">
                                                        <div>
                                                            <img src={logo} alt="Nirmaan" width="180" height="52" />
                                                            <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order No.</div>
                                                        <div className="text-lg font-semibold text-black">{(orderData?.name)?.toUpperCase()}</div>
                                                    </div>
                                                </div>

                                                <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
                                                    <div className="text-xs text-gray-600 font-normal">
                                                        {orderData?.project_gst
                                                            ? orderData?.project_gst === "29ABFCS9095N1Z9"
                                                                ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
                                                                : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
                                                            : "Please set company GST number in order to display the Address!"}
                                                    </div>
                                                    <div className="text-xs text-gray-600 font-normal">
                                                        GST: {orderData?.project_gst || "N/A"}
                                                    </div>
                                                </div>

                                                <div className="flex justify-between">
                                                    <div>
                                                        <div className="text-gray-500 text-sm pb-2 text-left">Vendor Address</div>
                                                        <div className="text-sm font-medium text-gray-900 max-w-[280px] truncate text-left">{service_vendor?.vendor_name}</div>
                                                        <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left"><AddressView id={service_vendor?.vendor_address} /></div>
                                                        <div className="text-sm font-medium text-gray-900 text-left">GSTIN: {service_vendor?.vendor_gst || "N/A"}</div>
                                                    </div>
                                                    <div>
                                                        <div>
                                                            <h3 className="text-gray-500 text-sm pb-2 text-left">Service Location</h3>
                                                            <div className="text-sm font-medium text-gray-900 break-words max-w-[280px] text-left"><AddressView id={project?.project_address} /></div>
                                                        </div>
                                                        <div className="pt-2">
                                                            <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Date:</span>&nbsp;&nbsp;&nbsp;<i>{orderData?.modified?.split(" ")[0]}</i></div>
                                                            <div className="text-sm font-normal text-gray-900 text-left"><span className="text-gray-500 font-normal">Project Name:</span>&nbsp;&nbsp;&nbsp;<i>{orderData?.project}</i></div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </th>
                                        </tr>
                                        <tr className="border-t border-black">
                                            <th scope="col" className="py-3 text-left text-xs font-bold text-gray-800 tracking-wider">No.</th>
                                           
                                            <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Service Description</th>
                                            <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Unit</th>
                                            <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Qty</th>
                                            <th scope="col" className="px-2 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Rate</th>
                                            {gstEnabled && <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Tax</th>}
                                            <th scope="col" className="px-4 py-1 text-left text-xs font-bold text-gray-800 tracking-wider">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody className={`bg-white`}>
                                        {orderData && orderData?.service_order_list?.list?.map((item, index) => (
                                            <tr key={item.id} className={`${index === (orderData && orderData?.service_order_list)?.list?.length - 1 && "border-b border-black"} page-break-inside-avoid`}>
                                                <td className="py-2 text-sm whitespace-nowrap flex items-start">{index + 1}.</td>
                                                
                                                <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[95%]">
                                                    <p className="font-semibold">{item?.category}</p>
                                                    <span className="whitespace-pre-wrap">{item?.description}</span>
                                                </td>
                                                <td className="px-2 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.uom}</td>
                                                <td className="px-4 py-2 text-sm whitespace-nowrap text-wrap w-[5%]">{item?.quantity}</td>
                                                <td className=" py-2 text-sm whitespace-nowrap">{formatToIndianRupee(item.rate)}</td>
                                                {gstEnabled && <td className="px-4 py-2 text-sm whitespace-nowrap">18%</td>}
                                                <td className="px-2 py-2 text-sm whitespace-nowrap">{formatToIndianRupee(parseNumber(item.rate) * parseNumber(item.quantity))}</td>
                                            </tr>
                                        ))}
                                        
                                        <tr className="">
                                            <td className="py-2 text-sm whitespace-nowrap w-[7%]"></td>
                                            <td className=" py-2 whitespace-nowrap font-semibold flex justify-start w-[80%]"></td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap"></td>
                                           
                                            {gstEnabled && <td className="px-4 py-2 text-sm whitespace-nowrap"></td>}
                                            <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">Sub-Total</td>
                                            <td className="px-4 py-2 text-sm whitespace-nowrap font-semibold">{formatToIndianRupee(getTotal)}</td>
                                        </tr>
                                        <tr className="border-none">
                                            <td></td>
                                            <td></td>
                                            <td></td>
                                            
                                            {gstEnabled && <td></td>}
                                            <td></td>
                                            <td className="space-y-4 w-[110px] py-4 flex flex-col items-end text-sm font-semibold page-break-inside-avoid">
                                                {gstEnabled && <div>Total Tax(GST):</div>}
                                                <div>Round Off:</div>
                                                <div>Total:</div>
                                            </td>

                                            <td className="space-y-4 py-4 text-sm whitespace-nowrap">
                                                {gstEnabled && <div className="ml-4">{formatToIndianRupee(getTotal * 1.18 - getTotal)}</div>}
                                                <div className="ml-4">- {formatToIndianRupee((getTotal * (gstEnabled ? 1.18 : 1)) - Math.floor(getTotal * (gstEnabled ? 1.18 : 1)))}</div>
                                                <div className="ml-4">{formatToIndianRupee(Math.floor(getTotal * (gstEnabled ? 1.18 : 1)))}</div>
                                            </td>

                                        </tr>

                                        <tr className="end-of-page page-break-inside-avoid" >
                                            <td colSpan={6}>

                                                {notes?.length > 0 && (
                                                    <div className="mb-2">
                                                        <div className="text-gray-400 text-sm py-2">Notes</div>
                                                        <ul className="list-[number]">
                                                            {notes?.map((note) => (
                                                                <li key={note?.id} className="text-sm text-gray-900 ml-4">{note?.note}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}

                                                <img src={Seal} className="w-24 h-24" />
                                                <div className="text-sm text-gray-900 py-6">For, Stratos Infra Technologies Pvt. Ltd.</div>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div style={{ display: 'block', pageBreakBefore: 'always', }}></div>
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-gray-200">
                                    <thead className="border-b border-black">
                                        <tr>
                                            <th colSpan={6}>
                                                <div className="flex justify-between border-gray-600 pb-1">
                                                    <div className="mt-2 flex justify-between">
                                                        <div>
                                                            <img src={logo} alt="Nirmaan" width="180" height="52" />
                                                            <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="pt-2 text-xl text-gray-600 font-semibold">Purchase Order No. :</div>
                                                        <div className="text-lg font-semibold text-black">{(orderData?.name)?.toUpperCase()}</div>
                                                    </div>
                                                </div>

                                                <div className="items-start text-start flex justify-between border-b-2 border-gray-600 pb-1 mb-1">
                                                    <div className="text-xs text-gray-600 font-normal">
                                                        {orderData?.project_gst
                                                            ? orderData?.project_gst === "29ABFCS9095N1Z9"
                                                                ? "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka"
                                                                : "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram, Haryana - 122002"
                                                            : "Please set company GST number in order to display the Address!"}
                                                    </div>
                                                    <div className="text-xs text-gray-600 font-normal">
                                                        GST: {orderData?.project_gst || "N/A"}
                                                    </div>
                                                </div>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <div className="max-w-4xl mx-auto p-6 text-gray-800">
                                            <h1 className="text-xl font-bold mb-4">Terms and Conditions</h1>
                                            <h2 className="text-lg font-semibold mt-6">1. Invoicing:</h2>
                                            <ol className="list-decimal pl-6 space-y-2 text-sm">
                                                <li className="pl-2">All invoices shall be submitted in original and shall be tax invoices showing the breakup of tax structure/value payable at the prevailing rate and a clear description of goods.</li>
                                                <li className="pl-2">All invoices submitted shall have Delivery Challan/E-waybill for supply items.</li>
                                                <li className="pl-2">All Invoices shall have the tax registration numbers mentioned thereon. The invoices shall be raised in the name of “Stratos Infra Technologies Pvt Ltd, Bangalore”.</li>
                                                <li className="pl-2">Payments shall be only entertained after receipt of the correct invoice.</li>
                                                <li className="pl-2">In case of advance request, Advance payment shall be paid after the submission of an advance receipt (as suggested under GST law).</li>
                                            </ol>

                                            <h2 className="text-lg font-semibold mt-6">2. Payment:</h2>
                                            <ol className="list-decimal pl-6 space-y-2 text-sm">
                                                <li className="pl-2">Payment shall be done through RTGS/NEFT.</li>
                                                <li className="pl-2">A retention amount shall be deducted as per PO payment terms and:</li>
                                                <ol className="list-decimal pl-6 space-y-1 text-sm">
                                                    <li className="pl-2">In case the vendor is not completing the task assigned by Nirmaan a suitable amount, as decided by Nirmaan, shall be deducted from the retention amount.</li>
                                                    <li className="pl-2">The adjusted amount shall be paid on completion of the defect liability period.</li>
                                                    <li className="pl-2">Vendors are expected to pay GST as per the prevailing rules. In case the vendor is not making GST payments to the tax authority, Nirmaan shall deduct the appropriated amount from the invoice payment of the vendor.</li>
                                                    <li className="pl-2">Nirmaan shall deduct the following amounts from the final bills:</li>
                                                    <ol className="list-decimal pl-6 space-y-1 text-sm">
                                                        <li className="pl-2">Amount pertaining to unfinished supply.</li>
                                                        <li className="pl-2">Amount pertaining to Liquidated damages and other fines, as mentioned in the documents.</li>
                                                        <li className="pl-2">Any agreed amount between the vendor and Nirmaan.</li>
                                                    </ol>
                                                </ol>
                                            </ol>

                                            <h2 className="text-lg font-semibold mt-6">3. Technical Specifications of the Work:</h2>
                                            <ol className="list-decimal pl-6 space-y-2 text-sm">
                                                <li className="pl-2">All goods delivered shall conform to the technical specifications mentioned in the vendor’s quote referred to in this PO or as detailed in Annexure 1 to this PO.</li>
                                                <li className="pl-2">Supply of goods or services shall be strictly as per Annexure - 1 or the Vendor’s quote/PI in case of the absence of Annexure - I.</li>
                                                <li className="pl-2">Any change in line items or quantities shall be duly approved by Nirmaan with rate approval prior to supply. Any goods supplied by the agency without obtaining due approvals shall be subject to the acceptance or rejection from Nirmaan.</li>
                                                <li className="pl-2">Any damaged/faulty material supplied needs to be replaced with a new item free of cost, without extending the completion dates.</li>
                                                <li className="pl-2">Material supplied in excess and not required by the project shall be taken back by the vendor at no cost to Nirmaan.</li>
                                            </ol>
                                            <br />
                                            <br />
                                            <br />
                                            <br />
                                            <br />

                                            <h1 className="text-xl font-bold mb-4">General Terms & Conditions for Purchase Order</h1>
                                            <ol className="list-decimal pl-6 space-y-2 text-sm">
                                                <li className="pl-2"><div className="font-semibold">Liquidity Damages:</div> Liquidity damages shall be applied at 2.5% of the order value for every day of delay.</li>
                                                <li className="pl-2"><div className="font-semibold">Termination/Cancellation:</div> If Nirmaan reasonably determines that it can no longer continue business with the vendor in accordance with applicable legal, regulatory, or professional obligations, Nirmaan shall have the right to terminate/cancel this PO immediately.</li>
                                                <li className="pl-2"><div className="font-semibold">Other General Conditions:</div></li>
                                                <ol className="list-decimal pl-6 space-y-1 text-sm">
                                                    <li className="pl-2">Insurance: All required insurance including, but not limited to, Contractors’ All Risk (CAR) Policy, FLEXA cover, and Workmen’s Compensation (WC) policy are in the vendor’s scope. Nirmaan in any case shall not be made liable for providing these insurance. All required insurances are required prior to the commencement of the work at the site.</li>
                                                    <li className="pl-2">Safety: The safety and security of all men deployed and materials placed by the Vendor or its agents for the project shall be at the risk and responsibility of the Vendor. Vendor shall ensure compliance with all safety norms at the site. Nirmaan shall have no obligation or responsibility on any safety, security & compensation related matters for the resources & material deployed by the Vendor or its agent.</li>
                                                    <li className="pl-2">Notice: Any notice or other communication required or authorized under this PO shall be in writing and given to the party for whom it is intended at the address given in this PO or such other address as shall have been notified to the other party for that purpose, through registered post, courier, facsimile or electronic mail.</li>
                                                    <li className="pl-2">Force Majeure: Neither party shall be liable for any delay or failure to perform if such delay or failure arises from an act of God or of the public enemy, an act of civil disobedience, epidemic, war, insurrection, labor action, or governmental action.</li>
                                                    <li className="pl-2">Name use: Vendor shall not use, or permit the use of, the name, trade name, service marks, trademarks, or logo of Nirmaan in any form of publicity, press release, advertisement, or otherwise without Nirmaan's prior written consent.</li>
                                                    <li className="pl-2">Arbitration: Any dispute arising out of or in connection with the order shall be settled by Arbitration in accordance with the Arbitration and Conciliation Act,1996 (As amended in 2015). The arbitration proceedings shall be conducted in English in Bangalore by the sole arbitrator appointed by the Purchaser.</li>
                                                    <li className="pl-2">The law governing: All disputes shall be governed as per the laws of India and subject to the exclusive jurisdiction of the court in Karnataka.</li>
                                                </ol>
                                            </ol>
                                        </div>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                </SheetContent>
            </Sheet> */}
        </div>
    );
};

export default ApprovedSR;