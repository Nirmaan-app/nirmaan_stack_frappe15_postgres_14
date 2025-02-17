import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { CircleCheck, CircleX, SquarePen } from "lucide-react";
import { useMemo, useState } from "react";

export const ApprovePayments = () => {

  const [selectedPO, setSelectedPO] = useState<any>(null);

  const [dialogType, setDialogType] = useState<"approve" | "reject" | "edit">("approve");

  const [dialogOpen, setDialogOpen] = useState(false);

  const toggleDialog = () => {
    setDialogOpen(!dialogOpen);
  };

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList("Projects", {
        fields: ["name", "project_name"],
        limit: 1000,
    });

    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 10000,
    });

    const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError, mutate: projectPaymentsMutate } = useFrappeGetDocList("Project Payments", {
        fields: ["*"],
        filters: [["status", "=", "Requested"]],
        limit: 100000,
        orderBy: { field: "payment_date", order: "desc" }
    })

    const { data: purchaseOrders, isLoading: poLoading, error: poError, mutate: poMutate } = useFrappeGetDocList("Procurement Orders", {
            fields: ["*"],
            filters: [["status", "not in", ["Cancelled", "Merged"]]],
            limit: 100000,
            orderBy: { field: "modified", order: "desc" },
        });
    
    const { data: serviceOrders, isLoading: srLoading, error: srError, mutate: srMutate } = useFrappeGetDocList("Service Requests", {
        fields: ["*"],
        filters: [["status", "=", "Approved"]],
        limit: 10000,
        orderBy: { field: "modified", order: "desc" },
      });

    useFrappeDocTypeEventListener("Project Payments", async () => {
        await projectPaymentsMutate();
    });

    const projectValues = projects?.map((item) => ({
        label: item.project_name,
        value: item.name,
    })) || [];

    const vendorValues = vendors?.map((item) => ({
        label: item.vendor_name,
        value: item.name,
    })) || [];

    const getTotalAmount = (order, type: "Procurement Orders" | "Service Requests") => {
      if (type === "Procurement Orders") {
          let total = 0;
          let totalWithTax = 0;
          const loading_charges = parseFloat(order?.loading_charges || 0)
          const freight_charges = parseFloat(order?.freight_charges || 0)
          const orderData = order.order_list;
          orderData?.list.forEach((item) => {
              const price = parseFloat(item?.quote || 0);
              const quantity = parseFloat(item?.quantity || 1);
              const tax = parseFloat(item?.tax || 0);
              totalWithTax += price * quantity * (1 + tax / 100);
              total += price * quantity;
          });

          total += loading_charges + freight_charges
          totalWithTax += loading_charges * 1.18 + freight_charges * 1.18
          return {total, totalWithTax};
      }
      if (type === "Service Requests") {
          let total = 0;
          const orderData = order.service_order_list;
          orderData?.list.forEach((item) => {
              const price = parseFloat(item?.rate) || 0;
              const quantity = parseFloat(item?.quantity) || 1;
              total += price * quantity;
          });
          return {total, totalWithTax : total * 1.18};
      }
      return 0;
  };

    const columns = useMemo(
        () => [
          {
            accessorKey: "document_name",
            header: "#PO",
            cell: ({ row }) => {
                return <div className="font-medium">{row.getValue("document_name")}</div>;
            }
        },
            {
                accessorKey: "payment_date",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date" />
                    )
                },
                cell: ({ row }) => {
                    const data = row.original
                    return <div className="font-medium">{formatDate(data?.payment_date || data?.creation)}</div>;
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
                  const data = row.original
                  let order;
                  if(row.original.document_type === "Procurement Orders") {
                    order = purchaseOrders?.find(i => i?.name === data?.document_name)
                  } else {
                    order = serviceOrders?.find(i => i?.name === data?.document_name)
                  }
                  return <div className="font-medium">
                      {formatToIndianRupee(getTotalAmount(order, row.original.document_type)?.totalWithTax)}
                  </div>
              },
          },
            {
                accessorKey: "amount",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Requested Amount" />
                    )
                },
                cell: ({ row }) => {
                    return <div className="font-medium">
                        {formatToIndianRupee(row.getValue("amount"))}
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
                        setDialogType("approve")
                        toggleDialog()
                      }}
                       className="text-green-500 cursor-pointer" />
                      <CircleX
                       onClick={() => {
                         setSelectedPO(data)
                         setDialogType("reject")
                         toggleDialog()
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
                      setDialogType("edit")
                      toggleDialog()
                    }}
                     />
                  </div>
                )
            },
        },
        ],
        [projectValues, vendorValues, projectPayments, purchaseOrders, serviceOrders]
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
                  {dialogType === "approve" ? `Are you sure you want to approve #${selectedPO?.document_name} of 
                  ${formatToIndianRupee(selectedPO?.amount)} to ${vendorValues?.find(v => v?.value === selectedPO?.vendor)?.label}?` : 
                  dialogType === "reject" ? `Are you sure you want to reject #${selectedPO?.document_name} of 
                  ${formatToIndianRupee(selectedPO?.amount)} to ${vendorValues?.find(v => v?.value === selectedPO?.vendor)?.label}?` :
                  "Edit Payment"} 
                </AlertDialogTitle>
              </AlertDialogHeader>

              {dialogType === "edit" && (
                <div className="grid grid-cols-3 gap-4 items-center">
                  <p className="col-span-1">Amount </p>
                  <Input className="col-span-2" type="number" value={selectedPO?.amount} />
                </div>
              )}

              <div className="mt-2 flex items-center justify-center space-x-2">
                  <Button className="flex-1">Confirm</Button>
                  <AlertDialogCancel className="flex-1">Cancel</AlertDialogCancel>
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