import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { useOrderTotals } from "@/hooks/useOrderTotals";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import { getTotalAmountPaid, getTotalInvoiceAmount } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { Filter, FrappeConfig, FrappeContext, FrappeDoc, useFrappeCreateDoc, useFrappeDocTypeEventListener, useFrappeFileUpload, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { debounce, memoize } from "lodash";
import { SquarePlus } from "lucide-react";
import { useCallback, useContext, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { Link } from "react-router-dom";
import { InvoiceDataDialog } from "../ProcurementOrders/purchase-order/components/InvoiceDataDialog";
import { PaymentsDataDialog } from "./PaymentsDataDialog";

type ProjectFilter = Filter<FrappeDoc<Projects>>;
export const projectPaymentsQueryKeys = {
    projects: (filters: ProjectFilter[]) => ['projects', ...filters]
}

/**
 * Displays Project Payments Data related to a specific project or customer if provided else shows all payments
 * 
 * @param projectId - The ID of the project to show payments for
 * @param customerId - The ID of the customer to filter payments
 * 
 * @example
 * <ProjectPaymentsList 
 *   projectId="PROJ-123" 
 *   customerId="CUST-456" 
 * />
 */
export const ProjectPaymentsList : React.FC<{ projectId? : string, customerId?: string}> = ({ projectId, customerId}) => {

    const { createDoc, loading: createLoading } = useFrappeCreateDoc()

    const projectFilters = useMemo(() => {
        const filters: ProjectFilter[] = []
        if (customerId) {
            filters.push(["customer", "=", customerId])
        }
        if (projectId) {
            filters.push(["name", "=", projectId])
        }
        return filters
    }, [customerId, projectId])

    // const projectFilters : Filter<FrappeDoc<Projects>>[] | undefined = []
    // if (customerId) {
    //     projectFilters.push(["customer", "=", customerId])
    // }

    const { upload: upload, loading: upload_loading } = useFrappeFileUpload()

    const { call } = useFrappePostCall('frappe.client.set_value')

    const [warning, setWarning] = useState("");
    const [selectedInvoice, setSelectedInvoice] = useState<ProcurementOrder>();

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        filters: projectFilters,
        limit: 1000,
    }, 
    // customerId ? `Projects ${customerId}` : projectId ? `Projects ${projectId}` : "Projects"
    projectPaymentsQueryKeys.projects(projectFilters)
    );

    const { data: purchaseOrders, isLoading: poLoading, error: poError, mutate: poMutate } = useFrappeGetDocList<ProcurementOrder>("Procurement Orders", {
        fields: ["*"],
        filters: [["status", "not in", ["Cancelled", "Merged"]], ["project", "in", projects?.map(i => i?.name)]],
        limit: 0,
        orderBy: { field: "modified", order: "desc" },
    },
    projects ? undefined : null
);

    const { data: serviceOrders, isLoading: srLoading, error: srError, mutate: srMutate } = useFrappeGetDocList<ServiceRequests>("Service Requests", {
        fields: ["*"],
        filters: [["status", "=", "Approved"], ["project", "in", projects?.map(i => i?.name)]],
        limit: 0,
        orderBy: { field: "modified", order: "desc" },
    },
    projects ? undefined : null
);

    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 0,
    }, 'Vendors');

    const { data: projectPayments, isLoading: projectPaymentsLoading, mutate: projectPaymentsMutate } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
        fields: ["*"],
        filters: [["status", "=", "Paid"]],
        limit: 0
    })

    useFrappeDocTypeEventListener("Procurement Orders", async () => {
        await poMutate();
    });

    useFrappeDocTypeEventListener("Service Requests", async () => {
        await srMutate();
    });

    const [newPaymentDialog, setNewPaymentDialog] = useState(false);

    const toggleNewPaymentDialog = useCallback(() => {
        setNewPaymentDialog((prevState) => !prevState);
    }, [newPaymentDialog])

    const [currentPaymentsDialog, setCurrentPaymentsDialog] = useState()

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

    const { notifications, mark_seen_notification } = useNotificationStore();

    const { db } = useContext(FrappeContext) as FrappeConfig;

    const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification])

    const projectValues = useMemo(() => projects?.map((item) => ({
        label: item?.project_name,
        value: item?.name,
    })) || [], [projects])

    const vendorValues = useMemo(() => vendors?.map((item) => ({
        label: item?.vendor_name,
        value: item?.name,
    })) || [], [vendors])

    const {getTotalAmount} = useOrderTotals()

    const getAmountPaid =  useMemo(
        () => memoize((id : string) => {
        const payments = projectPayments?.filter((payment) => payment.document_name === id) || [];
        return getTotalAmountPaid(payments);
    }, (id: string) => id),[projectPayments])

    const combinedData = useMemo(() => [
        ...(purchaseOrders?.map((order) => ({ ...order, type: "Purchase Order" })) || []),
        ...(serviceOrders?.map((order) => ({ ...order, type: "Service Order" })) || []),
    ], [purchaseOrders, serviceOrders])

    

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

    const validateAmount = useCallback(
        debounce((amount : string) => {
        const order =
          newPayment?.doctype === "Procurement Orders"
            ? purchaseOrders?.find((i) => i?.name === newPayment?.docname)
            : serviceOrders?.find((i) => i?.name === newPayment?.docname);
    
        if (!order) {
          setWarning(""); // Clear warning if no order is found
          return;
        }
    
        const { total, totalWithTax } = getTotalAmount(order?.name,
          newPayment.doctype
        );

        const totalAmountPaid = getAmountPaid(order?.name)
    
        const compareAmount =
          newPayment?.doctype === "Procurement Orders"
            ? (totalWithTax - totalAmountPaid) // Always compare with totalWithTax for Purchase Orders
            : order?.gst === "true" // Check GST field for Service Orders
            ? (totalWithTax - totalAmountPaid)
            : (total - totalAmountPaid);
    
        if (parseNumber(amount) > compareAmount) {
          setWarning(
            `Entered amount exceeds the total ${totalAmountPaid ? "remaining" : ""} amount ${
              newPayment?.doctype === "Procurement Orders" ? "including" : order.gst === "true" ? "including" : "excluding"
            } GST: ${formatToRoundedIndianRupee(compareAmount)}`
          );
        } else {
          setWarning(""); // Clear warning if within the limit
        }
      }, 300), [newPayment])

    const getVendorName = useMemo(() => memoize((id: string | undefined) => {
        const vendorName = vendorValues.find((vend) => vend.value === id)?.label || id;
        return vendorName;
    }, (id: string | undefined) => id), [vendorValues])

    const getProjectName = useMemo(() => memoize((id: string | undefined) => {
        const projectName = projectValues.find((proj) => proj.value === id)?.label || id;
        return projectName;
    }, (id: string | undefined) => id), [vendorValues])
    
      // Handle input change
    const handleAmountChange = useCallback((e : React.ChangeEvent<HTMLInputElement>) => {
      const amount = e.target.value;
      setNewPayment({ ...newPayment, amount });
      validateAmount(amount);
    }, [newPayment, validateAmount])

    const columns = useMemo(
        () => [
            {
                accessorKey: "name",
                header: "#PO",
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
                            <Link to={projectId ? (isPO ? `po/${poId}` : `/service-requests-list/${poId}`) : `${poId}`} className="underline hover:underline-offset-2">
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
                        <DataTableColumnHeader column={column} title="PO Date Created" />
                    )
                },
                cell: ({ row }) => (
                    <div className="font-medium">{formatDate(row.getValue("creation")?.split(" ")[0])}</div>
                ),
            },
            ...(!projectId ? [
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
            // {
            //     id: "total",
            //     header: "PO Amt excl. Tax",
            //     cell: ({ row }) => (
            //         <div className="font-medium">
            //             {formatToIndianRupee(getTotalAmount(row.original.name, row.original.type)?.total)}
            //         </div>
            //     ),
            // },
            {
                id: "totalWithTax",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Total PO Amt" />
                    )
                },
                cell: ({ row }) => {
                    const amount = getTotalAmount(row.original.name, row.original.type)
                    return <div className="font-medium">
                        {formatToRoundedIndianRupee(amount?.totalWithTax)}
                    </div>
                },
            },
                {
                    id: "invoices_amount",
                    header: ({ column }) => {
                        return (
                            <DataTableColumnHeader column={column} title="Total Invoice Amt" />
                        )
                    },
                    cell: ({ row }) => {
                        const data = row.original;
                        const invoiceAmount = getTotalInvoiceAmount(data?.invoice_data)
                        return (
                          <div 
                            className={`font-medium ${invoiceAmount ? "underline cursor-pointer" : ""}`}
                            onClick={() => invoiceAmount && setSelectedInvoice(data)}
                          >
                            {formatToRoundedIndianRupee(invoiceAmount || "N/A")}
                          </div>
                        )
                      }                      
                },
            {
                id: "Amount_paid",
                header: "Amt Paid",
                cell: ({ row }) => {
                    const data = row.original
                    const amountPaid = getAmountPaid(data?.name);
                    return <div onClick={() => amountPaid && setCurrentPaymentsDialog(data)} className={`font-medium ${amountPaid ? "cursor-pointer underline" : ""}`}>
                        {formatToRoundedIndianRupee(amountPaid || "N/A")}
                    </div>
                },
            },
            ...(!projectId && !customerId ? [
                {
                    id: "Record_Payment",
                    header: "Record Payment",
                    cell: ({ row }) => {
                        const data = row.original
                        const project = getProjectName(data?.project)
                        const vendor = getVendorName(data?.vendor)
                        return <div className="font-medium">
                            <SquarePlus onClick={() => {
                                setNewPayment({ ...newPayment, project: project!, vendor: vendor!, docname: data?.name, doctype: data?.type === "Purchase Order" ? "Procurement Orders" : data.type === "Service Order" ? "Service Requests" : "", project_id: data?.project, vendor_id: data?.vendor, amount: "", utr: "" , tds: "", payment_date: new Date().toISOString().split("T")[0]})
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
                        const totalAmount = getTotalAmount(row.original.name, row.original.type)?.totalWithTax
                        const amountPaid = getAmountPaid(data?.name);
                        return(
                            <div className="font-medium">
                                {formatToRoundedIndianRupee(totalAmount - amountPaid)}
                            </div>
                        )
                    }
                }
            ]),
        ],
        [notifications, purchaseOrders, serviceOrders, projectValues, vendorValues, projectPayments, projectId, getTotalAmount, customerId]
    );

    if (poError || srError || projectsError || vendorsError) {
        toast({
            title: "Error!",
            description: `Error: ${poError?.message || srError?.message || projectsError?.message}`,
            variant: "destructive",
        });
    }

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
                            <span className="">
                                {formatToRoundedIndianRupee(getTotalAmount(newPayment.docname, newPayment.doctype)?.total)}
                            </span>
                        </div>
                        {(newPayment?.doctype === "Procurement Orders" || (newPayment?.doctype === "Service Requests" && serviceOrders?.find(i => i?.name === newPayment?.docname)?.gst === "true")) && (
                        <div className="flex items-center justify-between">
                            <Label className=" text-red-700">PO Amt incl. Tax:</Label>
                            <span className="">{formatToRoundedIndianRupee(getTotalAmount(newPayment?.docname, newPayment.doctype)?.totalWithTax)}
                            </span>
                        </div>
                        )}
                        <div className="flex items-center justify-between">
                            <Label className=" text-red-700">Amt Paid Till Now:</Label>
                            <span className="">{formatToRoundedIndianRupee(getAmountPaid(newPayment?.docname))}</span>
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
                                    type="number"
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

                        <CustomAttachment
                            maxFileSize={20 * 1024 * 1024} // 20MB
                            selectedFile={paymentScreenshot}
                            onFileSelect={setPaymentScreenshot}
                            className="pt-2"
                            label="Attach Screenshot"
                        />

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

            <InvoiceDataDialog
              open={!!selectedInvoice}
              onOpenChange={(open) => !open && setSelectedInvoice(undefined)}
              invoiceData={selectedInvoice?.invoice_data}
              project={getProjectName(selectedInvoice?.project)}
              poNumber={selectedInvoice?.name}
              vendor={getVendorName(selectedInvoice?.vendor)}
            />

            <PaymentsDataDialog
              open={!!currentPaymentsDialog}
              onOpenChange={(open) => !open && setCurrentPaymentsDialog(undefined)}
              payments={projectPayments}
              data={currentPaymentsDialog}
              projects={projects}
              vendors={vendors}
              isPO={currentPaymentsDialog?.document_type === "Purchase Order"}
            />
            {
                (poLoading || srLoading || projectsLoading || vendorsLoading || projectPaymentsLoading) ? (
                    <TableSkeleton />
                ) : (
                    <DataTable columns={columns} data={combinedData} project_values={!projectId ? projectValues : undefined} approvedQuotesVendors={vendorValues} />
                )
            }
        </div>
    );
};


export default ProjectPaymentsList;