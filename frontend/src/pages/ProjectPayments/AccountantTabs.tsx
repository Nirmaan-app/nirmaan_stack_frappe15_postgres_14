import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { Filter, FrappeConfig, FrappeContext, FrappeDoc, useFrappeDeleteDoc, useFrappeDocTypeEventListener, useFrappeFileUpload, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Info, Trash2 } from "lucide-react";
import { useCallback, useContext, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate } from "react-router-dom";

interface AccountantTabsProps {
  tab : string
  projectsView?: boolean
  customerId?: string
}

export const AccountantTabs : React.FC<AccountantTabsProps> = ({tab, projectsView = false, customerId}) => {

      const navigate = useNavigate()
      const projectFilters : Filter<FrappeDoc<Projects>>[] | undefined = []

      if (customerId) {
          projectFilters.push(["customer", "=", customerId])
      }

      const [dialogType, setDialogType] = useState<"fulfill" | "delete">("fulfill");
  
      const { upload: upload, loading: upload_loading } = useFrappeFileUpload()
  
      const { call } = useFrappePostCall('frappe.client.set_value')
  
      const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc()
  
      const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc()
  
      const [paymentData, setPaymentData] = useState<ProjectPayments | null>(null);
  
      const [paymentScreenshot, setPaymentScreenshot] = useState<File  | null>(null);
  
      const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>("Projects", {
          fields: ["name", "project_name", 'customer'],
          filters: projectFilters,
          limit: 1000,
      }, customerId ? `Projects ${customerId}` : "Projects");
  
      const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>("Vendors", {
          fields: ["*"],
          limit: 10000,
      }, 'Vendors');
  
      const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError, mutate: projectPaymentsMutate } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
          fields: ["*"],
          filters: [["project", "in", projects?.map(i => i?.name)]],
          limit: 100000,
          orderBy: { field: "payment_date", order: "desc" }
      },
      projects ? undefined : null
    )
  
      useFrappeDocTypeEventListener("Project Payments", async () => {
          await projectPaymentsMutate();
      });
  
      const [fulFillPaymentDialog, setFulFillPaymentDialog] = useState(false);
  
      const toggleFulFillPaymentDialog = useCallback(() => {
          setFulFillPaymentDialog((prevState) => !prevState);
      }, [fulFillPaymentDialog]);

      const FulfillPayment = async () => {
        try {

            await updateDoc("Project Payments", paymentData?.name || "", {
                status: "Paid",
                payment_date: paymentData?.payment_date,
                utr: paymentData?.utr,
                tds: parseNumber(paymentData?.tds),
                amount: parseNumber(paymentData?.amount)
            })

            if (paymentScreenshot) {
                const fileArgs = {
                    doctype: "Project Payments",
                    docname: paymentData?.name,
                    fieldname: "payment_attachment",
                    isPrivate: true,
                };

                const uploadedFile = await upload(paymentScreenshot, fileArgs);

                await call({
                    doctype: "Project Payments",
                    name: paymentData?.name,
                    fieldname: "payment_attachment",
                    value: uploadedFile.file_url,
                });
            }

            await projectPaymentsMutate()
            toggleFulFillPaymentDialog()

            toast({
                title: "Success!",
                description: "Payment updated successfully!",
                variant: "success",
            });

        } catch (error) {
            console.log("error", error)
            toast({
                title: "Failed!",
                description: "Failed to update Payment!",
                variant: "destructive",
            });
        }
    }

    const DeletePayment = async () => {
        try {
            await deleteDoc("Project Payments", paymentData?.name)

            await projectPaymentsMutate()

            toggleFulFillPaymentDialog()
            toast({
                title: "Success!",
                description: "Payment deleted successfully!",
                variant: "success",
            });
        } catch (error) {
            console.log("error", error);
            toast({
                title: "Failed!",
                description: "Failed to delete Payment!",
                variant: "destructive",
            });
        }
    }

    const getRowSelection = useCallback((vendor : string) => {
        const data = vendors?.find((item) => item.name === vendor);
        if (data?.account_number) {
            return false
        }
        return true;
    }, [vendors])

    const projectValues = useMemo(() => projects?.map((item) => ({
        label: item.project_name,
        value: item.name,
    })) || [], [projects])

    const vendorValues = useMemo(() => vendors?.map((item) => ({
        label: item.vendor_name,
        value: item.name,
    })) || [], [vendors])

    const { notifications, mark_seen_notification } = useNotificationStore()

    const { db } = useContext(FrappeContext) as FrappeConfig

    const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification])

    const columns : ColumnDef<ProjectPayments>[] = useMemo(
      () => [
        ...(tab === "New Payments" ? [
            {
                id: "select",
                header: ({ table }) => {
                    const visibleRows = table.getRowModel().rows;
                    const selectableRows = visibleRows.filter(
                        (row) => !getRowSelection(row.original.vendor)
                    );

                    const allSelected =
                        selectableRows.length > 0 &&
                        selectableRows.every((row) => row.getIsSelected());
                    const someSelected =
                        selectableRows.some((row) => row.getIsSelected()) && !allSelected;

                    return (
                        <Checkbox
                            checked={allSelected ? true : someSelected ? "indeterminate" : false}
                            disabled={selectableRows.length === 0}
                            onCheckedChange={(value) => {
                                selectableRows.forEach((row) => {
                                    if (value) {
                                        if (!row.getIsSelected()) row.toggleSelected(true);
                                    } else {
                                        if (row.getIsSelected()) row.toggleSelected(false);
                                    }
                                });
                            }}
                            aria-label="Select all"
                        />
                    );
                },
                cell: ({ row }) => {
                    const rowDisabled = getRowSelection(row.original.vendor)
                    return <Checkbox
                        checked={row.getIsSelected()}
                        disabled={rowDisabled}
                        onCheckedChange={(value) => row.toggleSelected(!!value)}
                        aria-label="Select row"
                    />
                },
                enableSorting: false,
                enableHiding: false,
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date Created" />
                    )
                },
                cell: ({ row }) => {
                    const data = row.original
                    const isNew = notifications.find(
                        (item) => item.docname === data?.name && item.seen === "false" && item.event_id === "payment:approved"
                    )
                    return <div onClick={() => handleNewPRSeen(isNew)} className="font-medium relative">
                        {(isNew && tab === "New Payments") && (
                            <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-14 2xl:-left-20  animate-pulse" />
                        )}
                        {formatDate(data?.creation)}
                    </div>;
                },
            },
        ] : []),
        // ...(tab === "Fulfilled Payments" ? [
        //     {
        //         accessorKey: "utr",
        //         header: "UTR",
        //         cell: ({ row }) => {
        //             const data = row.original
        //             return (
        //                 data?.payment_attachment ? (
        //                     <div className="font-medium text-blue-500 underline hover:underline-offset-2">
        //                     {import.meta.env.MODE === "development" ? (
        //                         <a href={`http://localhost:8000${data?.payment_attachment}`} target="_blank" rel="noreferrer">
        //                             {data?.utr}
        //                         </a>
        //                     ) : (
        //                         <a href={`${siteUrl}${data?.payment_attachment}`} target="_blank" rel="noreferrer">
        //                             {data?.utr}
        //                         </a>
        //                     )}
        //                 </div>
        //                 ) : (
        //                     <div className="font-medium">
        //                         {data?.utr}
        //                     </div>
        //                 )
        //             );
        //         },
        //     },

        // ] : []),
        {
            accessorKey: "document_name",
            header: "#PO",
            cell: ({ row }) => {
                const data = row.original;
                const id = data?.document_name?.replaceAll("/", "&=")
                const isPO = data?.document_type === "Procurement Orders"
                return <div className="font-medium flex items-center gap-1 min-w-[170px]">
                    {data?.document_name}
                    <HoverCard>
                        <HoverCardTrigger>
                            <Info onClick={() => {
                                if(projectsView) {
                                    if(isPO) {
                                        navigate(`po/${id}`)
                                    } else {
                                        navigate(`/service-requests-list/${id}`)
                                    }
                                } else {
                                    navigate(`/project-payments/${id}`)
                                }
                            }} className="w-4 h-4 text-blue-600 cursor-pointer" />
                        </HoverCardTrigger>
                        <HoverCardContent>
                            Click on to navigate to the PO screen!
                        </HoverCardContent>
                    </HoverCard>
                </div>;
            }
        },
        {
            accessorKey: "vendor",
            header: "Vendor",
            cell: ({ row }) => {
                const vendor = vendorValues.find(
                    (vendor) => vendor.value === row.getValue("vendor")
                );
                return <div className="font-medium items-baseline min-w-[170px]">
                    {vendor?.label || ""}
                    <HoverCard>
                          <HoverCardTrigger>
                              <Info onClick={() => navigate(`/vendors/${vendor?.value}`)} className="w-4 h-4 text-blue-600 cursor-pointer inline-block ml-1" />
                          </HoverCardTrigger>
                          <HoverCardContent>
                              Click on to navigate to the Vendor screen!
                          </HoverCardContent>
                      </HoverCard>
                  </div>;
            },
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id))
            }
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
        }
        ] : []),
        {
            accessorKey: "amount",
            header: ({ column }) => {
                return (
                    <DataTableColumnHeader column={column} title="Amt Requested" />
                )
            },
            cell: ({ row }) => {
                return <div className="font-medium">
                    {formatToIndianRupee(row.original.amount)}
                </div>
            },
        },
        ...(tab === "Fulfilled Payments" ? [
            {
                id: "amountPaid",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Amount Paid" />
                    )
                },
                cell: ({ row }) => {
                    const data = row.original
                    return <div className="font-medium">
                        {formatToIndianRupee(parseNumber(data?.amount) - parseNumber(data?.tds))}
                    </div>
                },
            },
            {
                accessorKey: "tds",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="TDS Amount" />
                    )
                },
                cell: ({ row }) => {
                    return <div className="font-medium">
                        {row.original?.tds ? formatToIndianRupee(parseNumber(row.original?.tds)) : "--"}
                    </div>
                },
            },
        ] : []),
        ...(tab === "New Payments" ? [
            {
                id: "actions",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Actions" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="flex items-center gap-3">
                            <Button onClick={() => {
                                setDialogType("fulfill")
                                setPaymentData(row.original)
                                toggleFulFillPaymentDialog()
                            }} variant={"outline"} className="bg-[#00AC06] h-6 text-white">Pay</Button>
                            <Trash2
                                onClick={() => {
                                    setDialogType("delete")
                                    setPaymentData(row.original)
                                    toggleFulFillPaymentDialog()
                                }}
                                className="text-red-500 cursor-pointer" />
                        </div>
                    )
                }
            }
        ] : [])
    ],
    [projectValues, vendorValues, projectPayments, tab, notifications, projectsView, customerId]
);

if (projectsError || vendorsError || projectPaymentsError) {
    toast({
        title: "Error!",
        description: `Error: ${vendorsError?.message || projectsError?.message || projectPaymentsError?.message}`,
        variant: "destructive",
    });
}
  return (
    <div>
      {projectsLoading || vendorsLoading || projectPaymentsLoading ? (
      <TableSkeleton />
  ) : (
      <DataTable columns={columns} data={projectPayments?.filter(p => p?.status === (tab === "New Payments" ? "Approved" : "Paid")) || []} project_values={!projectsView ? projectValues : undefined} vendorData={vendors} approvedQuotesVendors={vendorValues} isExport={tab === "New Payments"} />
  )}
       <AlertDialog open={fulFillPaymentDialog} onOpenChange={toggleFulFillPaymentDialog}>
                <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                    <AlertDialogHeader className="text-start">
                        <AlertDialogTitle className="text-center">
                            {dialogType === "fulfill" ? "Fulfill Payment" : "Delete Payment"}
                        </AlertDialogTitle>
                        {dialogType === "fulfill" ? (
                            <>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">Project:</Label>
                                    <span className="">{projectValues?.find(i => i?.value === paymentData?.project)?.label}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">Vendor:</Label>
                                    <span className="">{vendorValues?.find(i => i?.value === paymentData?.vendor)?.label}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">PO Number:</Label>
                                    <span className="">{paymentData?.document_name}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className=" text-red-700">Requested Amount:</Label>
                                    <span className="">{formatToIndianRupee(paymentData?.amount)}</span>
                                </div>

                                <div className="flex flex-col gap-4 pt-4">
                                    <div className="flex gap-4 w-full">
                                        <Label className="w-[40%]">UTR<sup className=" text-sm text-red-600">*</sup></Label>
                                        <Input
                                            type="number"
                                            placeholder="Enter UTR"
                                            value={paymentData?.utr || ""}
                                            onChange={(e) => setPaymentData({ ...paymentData, utr: e.target.value })}
                                        />
                                    </div>
                                    <div className="flex gap-4 w-full">
                                        <Label className="w-[40%]">TDS Deduction</Label>
                                        <div className="w-full">
                                            <Input
                                                type="number"
                                                placeholder="Enter TDS Amount"
                                                value={paymentData?.tds || ""}
                                                onChange={(e) => {
                                                    const tdsValue = parseFloat(e.target.value);
                                                    setPaymentData({ ...paymentData, tds: tdsValue })
                                                }}
                                            />
                                            {parseNumber(paymentData?.tds) > 0 && <span className="text-xs">Amount Paid : {formatToIndianRupee(parseNumber(paymentData?.amount) - parseNumber(paymentData?.tds))}</span>}
                                        </div>
                                    </div>
                                    <div className="flex gap-4 w-full" >
                                        <Label className="w-[40%]">Payment Date<sup className=" text-sm text-red-600">*</sup></Label>
                                        <Input
                                            type="date"
                                            value={paymentData?.payment_date || ""}
                                            placeholder="DD/MM/YYYY"
                                            onChange={(e) => setPaymentData({ ...paymentData, payment_date: e.target.value })}
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
                            </>

                        ) : (
                            <AlertDialogDescription>Are you sure you want to delete this payment?</AlertDialogDescription>
                        )}
                        <div className="flex gap-2 items-center pt-4 justify-center">
                            {updateLoading || upload_loading || deleteLoading ? <TailSpin color="red" width={40} height={40} /> : (
                                <>
                                    <AlertDialogCancel className="flex-1" asChild>
                                        <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                    </AlertDialogCancel>
                                    {dialogType === "fulfill" ?
                                        <Button
                                            onClick={FulfillPayment}
                                            disabled={!paymentData?.utr || !paymentData?.payment_date}
                                            className="flex-1">Confirm
                                        </Button>
                                        :
                                        <Button
                                            onClick={DeletePayment}
                                            className="flex-1">
                                            Confirm
                                        </Button>
                                    }
                                </>
                            )}
                        </div>

                    </AlertDialogHeader>
                </AlertDialogContent>
            </AlertDialog>
    </div>
  )
}

export default AccountantTabs;