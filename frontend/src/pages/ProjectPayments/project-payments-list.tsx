import React, { useContext, useEffect, useMemo, useState } from "react";
import { FrappeConfig, FrappeContext, useFrappeCreateDoc, useFrappeDocTypeEventListener, useFrappeFileUpload, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Link, useSearchParams } from "react-router-dom";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { CalendarIcon, Paperclip, SquarePlus } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTrigger, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Toast } from "@/components/ui/toast";
import { TailSpin } from "react-loader-spinner";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectPaymentsPaymentWise } from "./project-payments-payment-wise";
import { ConfigProvider, Menu, MenuProps, Radio } from "antd";

export const ProjectPaymentsList = () => {

    const [searchParams] = useSearchParams();

    const [tab, setTab] = useState<string>(searchParams.get("tab") || "PO Wise");

    const { createDoc, loading: createLoading } = useFrappeCreateDoc()

    const { upload: upload, loading: upload_loading, isCompleted: upload_complete, error: upload_error } = useFrappeFileUpload()

    const { call, error: call_error } = useFrappePostCall('frappe.client.set_value')

    const { data: purchaseOrders, isLoading: poLoading, error: poError, mutate: poMutate } = useFrappeGetDocList("Procurement Orders", {
        fields: ["*"],
        filters: [["status", "not in", ["Cancelled"]]],
        limit: 10000,
        orderBy: { field: "modified", order: "desc" },
    });

    const { data: serviceOrders, isLoading: srLoading, error: srError, mutate: srMutate } = useFrappeGetDocList("Service Requests", {
        fields: ["*"],
        filters: [["status", "=", "Approved"]],
        limit: 10000,
        orderBy: { field: "modified", order: "desc" },
    });

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList("Projects", {
        fields: ["name", "project_name"],
        limit: 1000,
    });

    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 1000,
    });

    const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError, mutate: projectPaymentsMutate } = useFrappeGetDocList("Project Payments", {
        fields: ["*"],
        limit: 10000
    })

    useEffect(() => {
        const currentTab = searchParams.get("tab") || "PO Wise";
        setTab(currentTab);
        updateURL("tab", currentTab);
    }, []);

    const updateURL = (key, value) => {
        const url = new URL(window.location);
        url.searchParams.set(key, value);
        window.history.pushState({}, "", url);
    };

    // const setPaymentsTab = (changeTab) => {
    //   if (tab === changeTab) return; // Prevent redundant updates
    //   setTab(changeTab);
    //   updateURL("tab", changeTab);
    // };

    const onClick = (value) => {
        if (tab === value) return; // Prevent redundant updates

        const newTab = value;
        setTab(newTab);
        updateURL("tab", newTab);

    };

    // type MenuItem = Required<MenuProps>["items"][number];

    const items = ["PO Wise", "Payment Wise"];

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
        transaction_date: "",
        utr: ""
    });

    const [paymentScreenshot, setPaymentScreenshot] = useState(null);

    const handleFileChange = (event) => {
        setPaymentScreenshot(event.target.files[0]);
    };

    const { notifications, mark_seen_notification } = useNotificationStore();

    const { db } = useContext(FrappeContext) as FrappeConfig;

    const projectValues = projects?.map((item) => ({
        label: item.project_name,
        value: item.name,
    })) || [];

    const vendorValues = vendors?.map((item) => ({
        label: item.vendor_name,
        value: item.name,
    })) || [];

    const getTotalAmount = (order, type: "Purchase Order" | "Service Order") => {
        if (type === "Purchase Order") {
            let total = 0;
            const orderData = order.order_list;
            orderData?.list.forEach((item) => {
                const price = parseFloat(item?.quote) || 0;
                const quantity = parseFloat(item?.quantity) || 1;
                total += price * quantity;
            });
            return total;
        }
        if (type === "Service Order") {
            let total = 0;
            const orderData = order.service_order_list;
            orderData?.list.forEach((item) => {
                const price = parseFloat(item?.rate) || 0;
                const quantity = parseFloat(item?.quantity) || 1;
                total += price * quantity;
            });
            return total;
        }
        return 0;
    };

    const getTotalAmountPaid = (id) => {
        const payments = projectPayments?.filter((payment) => payment.document_name === id);


        return payments?.reduce((acc, payment) => {
            const amount = parseFloat(payment.amount || 0)
            return acc + amount;
        }, 0);
    }

    const combinedData = [
        ...(purchaseOrders?.map((order) => ({ ...order, type: "Purchase Order" })) || []),
        ...(serviceOrders?.map((order) => ({ ...order, type: "Service Order" })) || []),
    ];

    const getDataAttributes = (data) => {
        let project = ""
        let vendor = ""
        if (data?.type === "Purchase Order") {
            project = data?.project_name
            vendor = data?.vendor_name
        } else {
            project = projects?.find(i => i?.name === data?.project)?.project_name
            vendor = vendors?.find(i => i?.name === data?.vendor)?.vendor_name
        }
        return { project, vendor, vendor_id: data?.vendor, project_id: data?.project, document_type: data?.type, document_name: data?.name }
    }

    const AddPayment = async () => {
        try {

            const res = await createDoc("Project Payments", {
                document_type: newPayment?.doctype,
                document_name: newPayment?.docname,
                project: newPayment?.project_id,
                vendor: newPayment?.vendor_id,
                utr: newPayment?.utr,
                amount: newPayment?.amount,
            })

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

            await projectPaymentsMutate()

            toggleNewPaymentDialog()

            toast({
                title: "Success!",
                description: "Payment added successfully!",
                variant: "success",
            });

        } catch (error) {
            console.log("error", error)
            toast({
                title: "Failed!",
                description: "Failed to add Payment!",
                variant: "destructive",
            });
        }
    }

    const columns = useMemo(
        () => [
            {
                accessorKey: "type",
                header: "Type",
                cell: ({ row }) => (
                    <Badge variant="default">{row.original.type}</Badge>
                ),
            },
            {
                accessorKey: "name",
                header: "ID",
                cell: ({ row }) => {
                    const id = row.getValue("name");
                    const poId = id?.replaceAll("/", "&=")
                    return (
                        < div className="font-medium flex items-center gap-2 relative" >
                            <Link to={`${poId}`} className="underline hover:underline-offset-2">
                                {id}
                            </Link>
                        </div >
                    );
                },
            },
            {
                accessorKey: "creation",
                header: "Date",
                cell: ({ row }) => (
                    <div className="font-medium">{formatDate(row.getValue("creation")?.split(" ")[0])}</div>
                ),
            },
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
                accessorKey: "total",
                header: "Total PO Amt",
                cell: ({ row }) => (
                    <div className="font-medium">
                        {formatToIndianRupee(getTotalAmount(row.original, row.original.type))}
                    </div>
                ),
            },
            {
                id: "Amount_paid",
                header: "Amt Paid",
                cell: ({ row }) => {
                    const data = row.original
                    const amountPaid = getTotalAmountPaid(data?.name);
                    const { project, vendor, vendor_id, project_id, document_type, document_name } = getDataAttributes(data)

                    return <div onClick={() => {
                        setCurrentPayments({ project, vendor, vendor_id, project_id, document_type, document_name })
                        toggleCurrentPaymentsDialog()
                    }} className="font-medium cursor-pointer underline">
                        {formatToIndianRupee(amountPaid)}
                    </div>
                },
            },
            {
                id: "Add_Payment",
                header: "Add Payment",
                cell: ({ row }) => {
                    const data = row.original
                    const { project, vendor, vendor_id, project_id } = getDataAttributes(data)

                    return <div className="font-medium">
                        <SquarePlus onClick={() => {
                            setNewPayment({ ...newPayment, project: project, vendor: vendor, docname: data?.name, doctype: data?.type === "Purchase Order" ? "Procurement Orders" : doc.type === "Service Order" ? "Service Requests" : "", project_id: project_id, vendor_id: vendor_id })
                            toggleNewPaymentDialog()
                        }} className="w-5 h-5 text-red-500 cursor-pointer" />
                    </div>
                },
            },
        ],
        [notifications, purchaseOrders, serviceOrders, projectValues, vendorValues, projectPayments]
    );

    const { toast } = useToast();

    if (poError || srError || projectsError || vendorsError) {
        toast({
            title: "Error!",
            description: `Error: ${poError?.message || srError?.message || projectsError?.message}`,
            variant: "destructive",
        });
    }

    const siteUrl = `${window.location.protocol}//${window.location.host}`;

    return (
        <div className="flex-1 space-y-4">
            {/* <div className="flex items-center justify-between space-y-2">
                <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">Project Payments List</h2>
            </div> */}

            {/* <div className="flex items-center gap-4">
                    <Button variant={`${tab === "po-wise" ? "default" : "outline"}`} onClick={() => setPaymentsTab("po-wise")}>PO Wise</Button>
                    <Button variant={`${tab === "payment-wise" ? "default" : "outline"}`} onClick={() => setPaymentsTab("payment-wise")}>Payment Wise</Button>
                </div> */}
            {/* <div className="w-full">
                  <ConfigProvider
                    theme={{
                      components: {
                        Menu: {
                          horizontalItemSelectedColor: "#D03B45",
                          itemSelectedBg: "#FFD3CC",
                          itemSelectedColor: "#D03B45",
                        },
                      },
                    }}
                  >
                    <Menu
                      selectedKeys={[tab]}
                      onClick={onClick}
                      mode="horizontal"
                      items={items}
                    />
                  </ConfigProvider>
                </div> */}
            {items && (
                <Radio.Group
                    block
                    options={items}
                    defaultValue="PO Wise"
                    optionType="button"
                    buttonStyle="solid"
                    value={tab}
                    onChange={(e) => onClick(e.target.value)}
                />
            )}

            <AlertDialog open={newPaymentDialog} onOpenChange={toggleNewPaymentDialog}>
                <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                    <AlertDialogHeader className="text-start">
                        <div className="flex items-center justify-between">
                            <Label className=" text-red-700">Project:</Label>
                            <span className="">{newPayment?.project}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <Label className=" text-red-700">Vendor:</Label>
                            <span className="">{newPayment?.vendor}</span>
                        </div>

                        <div className="flex justify-between pt-4">
                            <div className="flex flex-col">
                                <Label className="py-4">Amount Paid<sup className=" text-sm text-red-600">*</sup></Label>
                                {/* <Label className="py-4">Date(of Transaction):</Label> */}
                                <Label className="py-4">UTR<sup className=" text-sm text-red-600">*</sup></Label>
                            </div>
                            <div className="flex flex-col gap-4" >
                                <Input
                                    type="number"
                                    placeholder="Enter Amount"
                                    value={newPayment.amount}
                                    onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })}
                                />

                                {/* <Input
                                        type="date"
                                        value={newPayment.transaction_date}
                                        placeholder="DD/MM/YYYY"
                                        onChange={(e) => setNewPayment({...newPayment, transaction_date: e.target.value})}
                                     /> */}

                                <Input
                                    type="text"
                                    placeholder="Enter UTR"
                                    value={newPayment.utr}
                                    onChange={(e) => setNewPayment({ ...newPayment, utr: e.target.value })}
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
                                        disabled={!paymentScreenshot || !newPayment.amount || !newPayment.utr}
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
                                    <TableHead>Date</TableHead>
                                    <TableHead>Amount</TableHead>
                                    <TableHead>UTR No.</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {projectPayments?.filter((i) => i?.document_name === currentPayments?.document_name)?.length > 0 ? (
                                    projectPayments?.filter((i) => i?.document_name === currentPayments?.document_name)?.map((payment) => {
                                        return (
                                            <TableRow key={payment?.name}>
                                                <TableCell className="font-semibold">{formatDate(payment?.creation)}</TableCell>
                                                <TableCell className="font-semibold">{formatToIndianRupee(payment?.amount)}</TableCell>
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
                                            </TableRow>
                                        )
                                    })
                                ) : (
                                    <div className="text-center w-full py-2">No Payments Found</div>
                                )}
                            </TableBody>
                        </Table>

                    </DialogHeader>
                </DialogContent>
            </Dialog>
            {tab === "PO Wise" ? (
                (poLoading || srLoading || projectsLoading || vendorsLoading || projectPaymentsLoading) ? (
                    <TableSkeleton />
                ) : (
                    <DataTable columns={columns} data={combinedData} project_values={projectValues} approvedQuotesVendors={vendorValues} />
                )
            ) : (
                <ProjectPaymentsPaymentWise />
            )}
        </div>
    );
};