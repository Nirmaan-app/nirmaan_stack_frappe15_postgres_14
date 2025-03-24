import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getTotalAmountPaid } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { FrappeConfig, FrappeContext, useFrappeCreateDoc, useFrappeDocTypeEventListener, useFrappeFileUpload, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { debounce } from "lodash";
import { Paperclip, SquarePlus } from "lucide-react";
import { useCallback, useContext, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { Link } from "react-router-dom";
import { AllPayments } from "./AllPayments";

export const ProjectPaymentsList : React.FC<{tab : string, projectsView? : boolean}> = ({tab, projectsView = false}) => {

    const { createDoc, loading: createLoading } = useFrappeCreateDoc()

    const { upload: upload, loading: upload_loading } = useFrappeFileUpload()

    const { call } = useFrappePostCall('frappe.client.set_value')

    const [warning, setWarning] = useState("");

    const { data: purchaseOrders, isLoading: poLoading, error: poError, mutate: poMutate } = useFrappeGetDocList<ProcurementOrder>("Procurement Orders", {
        fields: ["*"],
        filters: [["status", "not in", ["Cancelled", "Merged"]]],
        limit: 100000,
        orderBy: { field: "modified", order: "desc" },
    });

    const { data: serviceOrders, isLoading: srLoading, error: srError, mutate: srMutate } = useFrappeGetDocList<ServiceRequests>("Service Requests", {
        fields: ["*"],
        filters: [["status", "=", "Approved"]],
        limit: 10000,
        orderBy: { field: "modified", order: "desc" },
    });

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000,
    });

    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 10000,
    });

    const { data: projectPayments, isLoading: projectPaymentsLoading, mutate: projectPaymentsMutate } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
        fields: ["*"],
        filters: [["status", "=", "Paid"]],
        limit: 100000
    })


    useFrappeDocTypeEventListener("Procurement Orders", async () => {
        await poMutate();
    });

    useFrappeDocTypeEventListener("Service Requests", async () => {
        await srMutate();
    });

    const [newPaymentDialog, setNewPaymentDialog] = useState(false);

    const toggleNewPaymentDialog = () => {
        setNewPaymentDialog((prevState) => !prevState);
    };

    const [currentPaymentsDialogOpen, setCurrentPaymentsDialogOpen] = useState(false)

    const toggleCurrentPaymentsDialog = () => {
        setCurrentPaymentsDialogOpen((prevState) => !prevState);
    };

    const [currentPayments, setCurrentPayments] = useState({})

    const [newPayment, setNewPayment] = useState({
        docname: "",
        doctype: "",
        project: "",
        project_id: "",
        vendor: "",
        vendor_id: "",
        amount: "",
        payment_date: "",
        utr: "",
        tds: ""
    });

    const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);

    const handleFileChange = (event : React.ChangeEvent<HTMLInputElement>) => {
        if(event.target.files && event.target.files.length > 0) {
            setPaymentScreenshot(event.target.files[0]);
        }
    };

    const { notifications, mark_seen_notification } = useNotificationStore();

    const { db } = useContext(FrappeContext) as FrappeConfig;

    const handleNewPRSeen = (notification : NotificationType | undefined) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }

    const projectValues = useMemo(() => projects?.map((item) => ({
        label: item.project_name,
        value: item.name,
    })) || [], [projects])

    const vendorValues = useMemo(() => vendors?.map((item) => ({
        label: item.vendor_name,
        value: item.name,
    })) || [], [vendors])

    const getTotalAmount = (order : any, type: "Purchase Order" | "Service Order") => {
        if (type === "Purchase Order") {
            let total = 0;
            let totalWithTax = 0;
            const loading_charges = order?.loading_charges || 0;
            const freight_charges = order?.freight_charges || 0
            const orderData = order.order_list;
            orderData?.list.forEach((item) => {
                const price = parseNumber(item?.quote);
                const quantity = parseNumber(item?.quantity) || 1;
                const tax = parseNumber(item?.tax)
                totalWithTax += price * quantity * (1 + tax / 100);
                total += price * quantity;
            });

            total += parseNumber(loading_charges) + parseNumber(freight_charges)
            totalWithTax += parseNumber(loading_charges) * 1.18 + parseNumber(freight_charges) * 1.18
            return {total, totalWithTax};
        }
        if (type === "Service Order") {
            let total = 0;
            const orderData = order.service_order_list;
            orderData?.list.forEach((item) => {
                const price = parseNumber(item?.rate);
                const quantity = parseNumber(item?.quantity) || 1;
                total += price * quantity;
            });
            return {total, totalWithTax : total * 1.18};
        }
        return {total: 0, totalWithTax: 0};
    };

    const getAmountPaid =  useMemo(
        () => (id : string) => {
        const payments = projectPayments?.filter((payment) => payment.document_name === id) || [];
        return getTotalAmountPaid(payments);
    }, [projectPayments])

    const combinedData = useMemo(() => [
        ...(purchaseOrders?.map((order) => ({ ...order, type: "Purchase Order" })) || []),
        ...(serviceOrders?.map((order) => ({ ...order, type: "Service Order" })) || []),
    ], [purchaseOrders, serviceOrders])

    const getDataAttributes = useCallback((data : any) => {
        let project = ""
        let vendor = ""
        let gst = ""
        if (data?.type === "Purchase Order") {
            project = data?.project_name
            vendor = data?.vendor_name
            gst = "true"
        } else {
            project = projects?.find(i => i?.name === data?.project)?.project_name || ""
            vendor = vendors?.find(i => i?.name === data?.vendor)?.vendor_name || ""
            gst = data?.gst
        }
        return { project, vendor, vendor_id: data?.vendor, project_id: data?.project, document_type: data?.type, document_name: data?.name, gst }
    }, [projects, vendors])

    const AddPayment = async () => {
        try {

            const res = await createDoc("Project Payments", {
                document_type: newPayment?.doctype,
                document_name: newPayment?.docname,
                project: newPayment?.project_id,
                vendor: newPayment?.vendor_id,
                utr: newPayment?.utr,
                amount: parseNumber(newPayment?.amount),
                tds: parseNumber(newPayment?.tds),
                payment_date: newPayment?.payment_date,
                status: "Paid"
            })

            if(paymentScreenshot) {
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
                docname: "",
                doctype: "",
                project: "",
                project_id: "",
                vendor: "",
                vendor_id: "",
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

    const validateAmount = debounce((amount : string) => {
        const order =
          newPayment?.doctype === "Procurement Orders"
            ? purchaseOrders?.find((i) => i?.name === newPayment?.docname)
            : serviceOrders?.find((i) => i?.name === newPayment?.docname);
    
        if (!order) {
          setWarning(""); // Clear warning if no order is found
          return;
        }
    
        const { total, totalWithTax } = getTotalAmount(
          order,
          newPayment?.doctype === "Procurement Orders" ? "Purchase Order" : "Service Order"
        );

        const totalAmountPaid = getAmountPaid(order?.name)
    
        const compareAmount =
          newPayment?.doctype === "Procurement Orders"
            ? (totalWithTax - totalAmountPaid) // Always compare with totalWithTax for Purchase Orders
            : order.gst === "true" // Check GST field for Service Orders
            ? (totalWithTax - totalAmountPaid)
            : (total - totalAmountPaid);
    
        if (parseNumber(amount) > compareAmount) {
          setWarning(
            `Entered amount exceeds the total ${totalAmountPaid ? "remaining" : ""} amount ${
              newPayment?.doctype === "Procurement Orders" ? "including" : order.gst === "true" ? "including" : "excluding"
            } GST: ${formatToIndianRupee(compareAmount)}`
          );
        } else {
          setWarning(""); // Clear warning if within the limit
        }
      }, 300);
    
      // Handle input change
    const handleAmountChange = (e : React.ChangeEvent<HTMLInputElement>) => {
      const amount = e.target.value;
      setNewPayment({ ...newPayment, amount });
      validateAmount(amount);
    };

    const columns = useMemo(
        () => [
            {
                accessorKey: "name",
                header: "ID",
                cell: ({ row }) => {
                    const data = row.original
                    const id = data?.name;
                    const poId = id?.replaceAll("/", "&=")
                    const isPO = data?.type === "Purchase Order"
                    const isNew = notifications.find(
                        (item) => item.docname === id && item.seen === "false" && item.event_id === (isPO ? "po:new" : "sr:approved")
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <div className="flex items-center gap-1">
                            <Link to={projectsView ? (isPO ? `po/${poId}` : `/service-requests-list/${poId}`) : `${poId}`} className="underline hover:underline-offset-2">
                                {id}
                            </Link>
                            <ItemsHoverCard isSR={!isPO} order_list={isPO ?  data?.order_list.list : data?.service_order_list.list} />
                            </div>
                        </div>
                    );
                },
            },
            {
                accessorKey: "type",
                header: "Type",
                cell: ({ row }) => (
                    <Badge variant="default">{row.original.type}</Badge>
                ),
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date" />
                    )
                },
                cell: ({ row }) => (
                    <div className="font-medium">{formatDate(row.getValue("creation")?.split(" ")[0])}</div>
                ),
            },
            ...(!projectsView ? [
                {
                    accessorKey: "project",
                    header: "Project",
                    cell: ({ row }) => {
                        const project = projectValues.find(
                            (project) => project.value === row.getValue("project")
                        );
                        return project ? <div className="font-medium">{project.label}</div> : null;
                    },
                    filterFn: (row, id, value) => {
                        return value.includes(row.getValue(id))
                    },
                },
            ] : []),
            {
                accessorKey: "vendor",
                header: "Vendor",
                cell: ({ row }) => {
                    const vendor = vendorValues.find(
                        (vendor) => vendor.value === row.getValue("vendor")
                    );
                    return vendor ? <div className="font-medium">{vendor.label}</div> : null;
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                }
            },
            {
                id: "total",
                header: "PO Amt excl. Tax",
                cell: ({ row }) => (
                    <div className="font-medium">
                        {formatToIndianRupee(getTotalAmount(row.original, row.original.type)?.total)}
                    </div>
                ),
            },
            {
                id: "totalWithTax",
                header: "PO Amt incl. Tax",
                cell: ({ row }) => (
                    <div className="font-medium">
                        {row.original.type === "Service Order" ? (
                            row.original.gst === "true" ? formatToIndianRupee(getTotalAmount(row.original, row.original.type)?.totalWithTax)
                            : "--"
                        ) : formatToIndianRupee(getTotalAmount(row.original, row.original.type)?.totalWithTax)
                        }
                    </div>
                ),
            },
            {
                id: "Amount_paid",
                header: "Amt Paid",
                cell: ({ row }) => {
                    const data = row.original
                    const amountPaid = getAmountPaid(data?.name);
                    const { project, vendor, vendor_id, project_id, document_type, document_name, gst } = getDataAttributes(data)
                    return <div onClick={() => {
                        setCurrentPayments({ project, vendor, vendor_id, project_id, document_type, document_name, gst })
                        toggleCurrentPaymentsDialog()
                    }} className="font-medium cursor-pointer underline">
                        {formatToIndianRupee(amountPaid)}
                    </div>
                },
            },
            ...(!projectsView ? [
                {
                    id: "Record_Payment",
                    header: "Record Payment",
                    cell: ({ row }) => {
                        const data = row.original
                        const { project, vendor, vendor_id, project_id } = getDataAttributes(data)
                        return <div className="font-medium">
                            <SquarePlus onClick={() => {
                                setNewPayment({ ...newPayment, project: project, vendor: vendor, docname: data?.name, doctype: data?.type === "Purchase Order" ? "Procurement Orders" : data.type === "Service Order" ? "Service Requests" : "", project_id: project_id, vendor_id: vendor_id, amount: "", utr: "" , tds: "", payment_date: new Date().toISOString().split("T")[0]})
                                setWarning("")
                                toggleNewPaymentDialog()
                            }} className="w-5 h-5 text-red-500 cursor-pointer" />
                        </div>
                    },
                },
            ] : [
                {
                    id: "due_amount",
                    header: "Due Amount",
                    cell: ({ row }) => {
                        const data = row.original
                        const totalAmount = getTotalAmount(row.original, row.original.type)?.totalWithTax
                        const amountPaid = getAmountPaid(data?.name);
                        return(
                            <div className="font-medium">
                                {formatToIndianRupee(totalAmount - amountPaid)}
                            </div>
                        )
                    }
                }
            ]),
        ],
        [notifications, purchaseOrders, serviceOrders, projectValues, vendorValues, projectPayments, projectsView, tab]
    );

    if (poError || srError || projectsError || vendorsError) {
        toast({
            title: "Error!",
            description: `Error: ${poError?.message || srError?.message || projectsError?.message}`,
            variant: "destructive",
        });
    }

    const siteUrl = `${window.location.protocol}//${window.location.host}`;

    if(tab === "All Payments") {
        return <AllPayments />
    }

    const filteredCurrentPayments = useMemo(() => projectPayments?.filter((i) => i?.document_name === currentPayments?.document_name) || [], [currentPayments, projectPayments])

    return (
        <div className="flex-1 space-y-4">
            <AlertDialog open={newPaymentDialog} onOpenChange={toggleNewPaymentDialog}>
                <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                    <AlertDialogHeader className="text-start ">
                        <div className="flex items-center justify-between">
                            <Label className=" text-red-700">Project:</Label>
                            <span className="">{newPayment?.project}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <Label className=" text-red-700">Vendor:</Label>
                            <span className="">{newPayment?.vendor}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <Label className=" text-red-700">PO Amt excl. Tax:</Label>
                            <span className="">{newPayment?.doctype === "Procurement Orders" ? (
                                formatToIndianRupee(getTotalAmount(purchaseOrders?.find(i => i?.name === newPayment?.docname), "Purchase Order")?.total)
                            ) : newPayment?.doctype === "Service Requests" ? (
                                formatToIndianRupee(getTotalAmount(serviceOrders?.find(i => i?.name === newPayment?.docname), "Service Order")?.total)
                            ) : ""}
                            </span>
                        </div>
                        {(newPayment?.doctype === "Procurement Orders" || (newPayment?.doctype === "Service Order" && serviceOrders?.find(i => i?.name === newPayment?.docname)?.gst !== "true")) && (
                        <div className="flex items-center justify-between">
                            <Label className=" text-red-700">PO Amt incl. Tax:</Label>
                            <span className="">{newPayment?.doctype === "Procurement Orders" ? (
                                formatToIndianRupee(getTotalAmount(purchaseOrders?.find(i => i?.name === newPayment?.docname), "Purchase Order")?.totalWithTax)
                            ) : newPayment?.doctype === "Service Requests" ? (
                                formatToIndianRupee(getTotalAmount(serviceOrders?.find(i => i?.name === newPayment?.docname), "Service Order")?.totalWithTax)
                            ) : ""}
                            </span>
                        </div>
                        )}
                        <div className="flex items-center justify-between">
                            <Label className=" text-red-700">Amt Paid Till Now:</Label>
                            <span className="">{formatToIndianRupee(getAmountPaid(newPayment?.docname))}</span>
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
                                {parseNumber(newPayment?.tds) > 0 && <span className="text-xs">Amount Paid : {formatToIndianRupee(parseNumber(newPayment?.amount) - parseNumber(newPayment?.tds))}</span>}
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
                                        onChange={(e) => setNewPayment({...newPayment, payment_date: e.target.value})}
                                        max={new Date().toISOString().split("T")[0]}
                                        onKeyDown={(e) => e.preventDefault()}
                                     />
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <div className={`text-blue-500 cursor-pointer flex gap-1 items-center justify-center border rounded-md border-blue-500 p-2 mt-4 ${paymentScreenshot && "opacity-50 cursor-not-allowed"}`}
                                onClick={() => document.getElementById("file-upload")?.click()}
                            >
                                <Paperclip size="15px" />
                                <span className="p-0 text-sm">Attach Screenshot</span>
                                <input
                                    type="file"
                                    id={`file-upload`}
                                    className="hidden"
                                    onChange={handleFileChange}
                                    disabled={paymentScreenshot ? true : false}
                                />
                            </div>
                            {(paymentScreenshot) && (
                                <div className="flex items-center justify-between bg-slate-100 px-4 py-1 rounded-md">
                                    <span className="text-sm">{paymentScreenshot?.name}</span>
                                    <button
                                        className="ml-1 text-red-500"
                                        onClick={() => setPaymentScreenshot(null)}
                                    >
                                        ✖
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2 items-center pt-4 justify-center">

                            {createLoading || upload_loading ? <TailSpin color="red" width={40} height={40} /> : (
                                <>
                                    <AlertDialogCancel className="flex-1" asChild>
                                        <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                    </AlertDialogCancel>
                                    <Button
                                        onClick={AddPayment}
                                        disabled={!newPayment.amount || !newPayment.utr || !newPayment.payment_date || !!warning}
                                        className="flex-1">Add Payment
                                    </Button>
                                </>
                            )}
                        </div>

                    </AlertDialogHeader>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={currentPaymentsDialogOpen} onOpenChange={toggleCurrentPaymentsDialog}>
                <DialogContent className="text-start">
                    <DialogHeader className="text-start py-8 overflow-auto">
                        <div className="flex items-center flex-wrap gap-4 mb-4">
                            <div className="flex items-center gap-2">
                                <Label className=" text-red-700">Project:</Label>
                                <span className="text-xs">{currentPayments?.project}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Label className=" text-red-700">{currentPayments?.document_type === "Purchase Order" ? "PO" : "SR"} Number:</Label>
                                <span className="text-xs">{currentPayments?.document_name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Label className=" text-red-700">Vendor:</Label>
                                <span className="text-xs">{currentPayments?.vendor}</span>
                            </div>
                        </div>

                        <Table>
                            <TableHeader className="bg-gray-300">
                                <TableRow>
                                    <TableHead>Payment Date</TableHead>
                                    <TableHead>Amount</TableHead>
                                    {/* {currentPayments?.document_type === "Service Order" && currentPayments?.gst === "true" && ( */}
                                        <TableHead>TDS Amt</TableHead>
                                    {/* )} */}
                                    <TableHead>UTR No.</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredCurrentPayments.length > 0 ? (
                                    filteredCurrentPayments.map((payment) => {
                                        return (
                                            <TableRow key={payment?.name}>
                                                <TableCell className="font-semibold">{formatDate(payment?.payment_date || payment?.creation)}</TableCell>
                                                <TableCell className="font-semibold">{formatToIndianRupee(payment?.amount - (payment?.tds || 0))}</TableCell>
                                                {/* {currentPayments?.document_type === "Service Order" && currentPayments?.gst === "true" && ( */}
                                                    <TableCell className="font-semibold">{formatToIndianRupee(payment?.tds)}</TableCell>
                                                {/* )} */}
                                                {payment?.payment_attachment ? (
                                                    <TableCell className="font-semibold text-blue-500 underline">
                                                    {import.meta.env.MODE === "development" ? (
                                                        <a href={`http://localhost:8000${payment?.payment_attachment}`} target="_blank" rel="noreferrer">
                                                            {payment?.utr}
                                                        </a>
                                                    ) : (
                                                        <a href={`${siteUrl}${payment?.payment_attachment}`} target="_blank" rel="noreferrer">
                                                            {payment?.utr}
                                                        </a>
                                                    )}
                                                </TableCell>
                                                ) : (
                                                    <TableCell className="font-semibold">{payment?.utr}</TableCell>
                                                )}
                                            </TableRow>
                                        )
                                    })
                                ) : (
                                    <TableRow>
                                      <TableCell colSpan={4} className="text-center py-2">
                                        No Payments Found
                                      </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>

                    </DialogHeader>
                </DialogContent>
            </Dialog>
            {
                (poLoading || srLoading || projectsLoading || vendorsLoading || projectPaymentsLoading) ? (
                    <TableSkeleton />
                ) : (
                    <DataTable columns={columns} data={combinedData} project_values={!projectsView ? projectValues : undefined} approvedQuotesVendors={vendorValues} />
                )
            }
        </div>
    );
};