import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import { getPOTotal, getSRTotal } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { CircleCheck, CircleX, Info, SquarePen } from "lucide-react";
import { useCallback, useContext, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate } from "react-router-dom";

export const ApprovePayments = () => {

  const navigate = useNavigate()
  const [selectedPO, setSelectedPO] = useState<any>(null);

  const [dialogType, setDialogType] = useState<"approve" | "reject" | "edit">("approve");

  const [dialogOpen, setDialogOpen] = useState(false);

  const [amountInput, setAmountInput] = useState("");

  const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

  const toggleDialog = useCallback(() => {
    setDialogOpen(!dialogOpen);
  }, [dialogOpen]);

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000,
    }, 'Projects');

    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 10000,
    }, 'Vendors');

    const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError, mutate: projectPaymentsMutate } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
        fields: ["*"],
        filters: [["status", "=", "Requested"]],
        limit: 100000,
        orderBy: { field: "creation", order: "desc" }
    })

    const { data: purchaseOrders, isLoading: poLoading, error: poError } = useFrappeGetDocList<ProcurementOrder>("Procurement Orders", {
            fields: ["*"],
            filters: [["status", "not in", ["Cancelled", "Merged"]]],
            limit: 100000,
            orderBy: { field: "modified", order: "desc" },
        });
    
    const { data: serviceOrders, isLoading: srLoading, error: srError } = useFrappeGetDocList<ServiceRequests>("Service Requests", {
        fields: ["*"],
        filters: [["status", "=", "Approved"]],
        limit: 10000,
        orderBy: { field: "modified", order: "desc" },
      });

    useFrappeDocTypeEventListener("Project Payments", async () => {
        await projectPaymentsMutate();
    });

    const { notifications, mark_seen_notification } = useNotificationStore()

    const projectValues = useMemo(() => projects?.map((item) => ({
        label: item.project_name,
        value: item.name,
    })) || [], [projects]);

    const vendorValues = useMemo(() => vendors?.map((item) => ({
        label: item.vendor_name,
        value: item.name,
    })) || [], [vendors]);

  const handleSubmit = async () => {
    try {
      await updateDoc("Project Payments", selectedPO?.name, {
        status: ["edit", "approve"].includes(dialogType) ? "Approved" : "Rejected",
        amount: dialogType === "edit" ? parseNumber(amountInput) : parseNumber(selectedPO?.amount)
      })

      await projectPaymentsMutate()

      toggleDialog()

      toast({
        title: "Success!",
        description: `Payment ${dialogType === "edit" ? "edited and approved" : dialogType === "approve" ? "approved" :"rejected"} successfully!`,
        variant: "success",
      });
      
    } catch (error) {
      console.log("error", error);
      toast({
        title: "Failed!",
        description: "Failed to update payment!",
        variant: "destructive",
      });
    }
  }

  const { db } = useContext(FrappeContext) as FrappeConfig
  
  const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
      if (notification) {
          mark_seen_notification(db, notification)
      }
  }, [db, mark_seen_notification])

    const columns = useMemo(
        () => [
          {
            accessorKey: "document_name",
            header: "#PO",
            cell: ({ row }) => {
                const data = row.original;
                const paymentId = data.name
                const isNew = notifications.find(
                    (item) => item.docname === paymentId && item.seen === "false" && item.event_id === "payment:new"
                )
                return <div onClick={() => handleNewPRSeen(isNew)} className="font-medium relative flex items-center gap-1 min-w-[170px]">
                  {isNew && (
                      <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                  )}
                  {data?.document_name}
                  <HoverCard>
                        <HoverCardTrigger>
                            <Info onClick={() => {
                              if (data?.document_type === "Procurement Orders") {
                                const po = purchaseOrders?.find(i => i?.name === data?.document_name)
                                const tab = po?.status === "PO Approved" ? "Approved PO" : po?.status === "Dispatched" ? "Dispatched PO" : "Delivered PO"
                                navigate(`/purchase-orders/${data?.document_name?.replaceAll("/", "&=")}?tab=${tab}`)
                              } else {
                                navigate(`/service-requests/${data?.document_name}?tab=approved-sr`)
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
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date Requested" />
                    )
                },
                cell: ({ row }) => {
                    const data = row.original
                    return <div className="font-medium">{formatDate(data?.creation || data?.payment_date)}</div>;
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
              id: "po_value",
              header: ({ column }) => {
                  return (
                      <DataTableColumnHeader column={column} title="PO Value" />
                  )
              },
              cell: ({ row }) => {
                  const data = row.original;
                  const isSr = data.document_type === "Service Requests";
                  let order;
                  if(!isSr) {
                    order = purchaseOrders?.find(i => i?.name === data?.document_name)
                  } else {
                    order = serviceOrders?.find(i => i?.name === data?.document_name)
                  }
                  return <div className="font-medium">
                      {formatToRoundedIndianRupee(isSr ? (order?.gst === "true" ? getSRTotal(order) : getSRTotal(order) * 1.18 ) : 
                      getPOTotal(order, parseNumber(order?.loading_charges), parseNumber(order?.freight_charges))?.totalAmt)}
                  </div>
              },
          },
            {
                accessorKey: "amount",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Requested Amt" />
                    )
                },
                cell: ({ row }) => {
                    return <div className="font-medium">
                        {formatToRoundedIndianRupee(row.getValue("amount"))}
                    </div>
                },
            },
            {
              id: "options",
              header: ({ column }) => {
                  return (
                      <DataTableColumnHeader column={column} title="Options" />
                  )
              },
              cell: ({ row }) => {
                  const data = row.original

                  return (
                    <div className="flex items-center gap-3">
                      <CircleCheck
                      onClick={() => {
                        setSelectedPO(data)
                        setAmountInput(data.amount)
                        setDialogType("approve")
                        setDialogOpen(true)
                      }}
                       className="text-green-500 cursor-pointer" />
                      <CircleX
                       onClick={() => {
                         setSelectedPO(data)
                         setAmountInput(data.amount)
                         setDialogType("reject")
                         setDialogOpen(true)
                       }}
                       className="text-primary cursor-pointer" />
                    </div>
                  )
              },
          },
          {
            id: "editOption",
            // header: ({ column }) => {
            //     return (
            //         <DataTableColumnHeader column={column} title="Options" />
            //     )
            // },
            cell: ({ row }) => {
                return (
                  <div className="">
                    <SquarePen
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedPO(row.original)
                        setAmountInput(row.original.amount)
                        setDialogType("edit")
                        setDialogOpen(true)
                    }}
                     />
                  </div>
                )
            },
        },
        ],
        [projectValues, vendorValues, projectPayments, purchaseOrders, serviceOrders, notifications]
    );

    const { toast } = useToast();

    if (projectsError || vendorsError || projectPaymentsError || poError || srError) {
        toast({
            title: "Error!",
            description: `Error: ${vendorsError?.message || projectsError?.message || projectPaymentsError?.message}`,
            variant: "destructive",
        });
    }

    return (
        <div className="flex-1 space-y-4">

          <AlertDialog open={dialogOpen} onOpenChange={toggleDialog}>
            <AlertDialogContent className="max-w-sm">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {["approve", "reject"] .includes(dialogType) ? (
                    <p>Are you sure you want to {dialogType} the payment of <span className="text-primary">{formatToRoundedIndianRupee(selectedPO?.amount)} to the {vendorValues?.find(v => v?.value === selectedPO?.vendor)?.label}</span> for PO <i>#{selectedPO?.document_name}</i>?</p>
                  ) : 
                  "Edit Payment"} 
                </AlertDialogTitle>
              </AlertDialogHeader>

              {dialogType === "edit" && (
                <div className="grid grid-cols-3 gap-4 items-start">
                  <p className="col-span-1">Amount </p>
                  <div className="col-span-2">
                    <Input type="number" onChange={(e) => setAmountInput(e.target.value)}  value={amountInput} />
                    <p className="text-sm mt-1 ml-1 text-primary">To: {vendorValues?.find(v => v?.value === selectedPO?.vendor)?.label}</p>
                  </div>
                </div>
              )}

              <div className="mt-2 flex items-center justify-center space-x-2">
                {updateLoading ? (
                  <TailSpin width={40} color="red"  />
                ) : (
                  <>
                    <Button disabled={updateLoading} onClick={handleSubmit} className="flex-1">Confirm</Button>
                    <AlertDialogCancel className="flex-1">Cancel</AlertDialogCancel>
                  </>

                )}
              </div>

            </AlertDialogContent>
          </AlertDialog>
            {projectsLoading || vendorsLoading || projectPaymentsLoading || poLoading || srLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable columns={columns} data={projectPayments || []} project_values={projectValues} approvedQuotesVendors={vendorValues} />
            )}
        </div>
    );
};

export default ApprovePayments;