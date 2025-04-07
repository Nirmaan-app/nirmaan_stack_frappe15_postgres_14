import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import SITEURL from "@/constants/siteURL";
import { useOrderTotals } from "@/hooks/useOrderTotals";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { Filter, FrappeConfig, FrappeContext, FrappeDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Download, Info } from "lucide-react";
import { useCallback, useContext, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AmountPaidHoverCard } from "./AmountPaidHoverCard";

export const AllPayments : React.FC<{tab?: string, projectId?: string, customerId?: string}> = ({tab = "Payments Pending", projectId, customerId}) => {

  const projectFilters : Filter<FrappeDoc<Projects>>[] | undefined = useMemo(() => 
    customerId ? [["customer", "=", customerId]] : [], [customerId])

  const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>("Projects", {
    fields: ["name", "project_name"],
    filters: projectFilters,
    limit: 1000,
}, customerId ? `Projects ${customerId}` : "Projects");

  const paymentFilters: Filter<FrappeDoc<ProjectPayments>>[] | undefined = useMemo(() => [["status", "in", tab === "Payments Done" ? ["Paid"] : ["Requested", "Approved"]], ...(projectId ? [["project", "=", projectId]] : []), ...(customerId ? [["project", "in", projects?.map(i => i?.name)]] : [])], [projectId, customerId, tab])

  const navigate = useNavigate()

  const {data : projectPayments, isLoading: projectPaymentsLoading} = useFrappeGetDocList<ProjectPayments>("Project Payments", {
    fields: ["*"],
    filters: paymentFilters,
    limit: 100000,
    orderBy: {field: "payment_date", order: "desc"},
  },
  tab ? undefined : null
  );
  
  const { data: vendors, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>("Vendors", {
      fields: ["name", "vendor_name", "vendor_mobile"],
      limit: 10000,
  }, 'Vendors');

  const projectValues = useMemo(() => projects?.map((item) => ({
    label: item.project_name,
    value: item.name,
  })) || [], [projects])

  const vendorValues = useMemo(() => vendors?.map((item) => ({
    label: item.vendor_name,
    value: item.name,
  })) || [], [vendors])

  const {getTotalAmount} = useOrderTotals()

  // const [phoneNumber, setPhoneNumber] = useState("");
  // const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  // const { toggleShareDialog, shareDialog } = useDialogStore();

  // const handleOpenWhatsApp = () => {
  //   if (phoneNumber) {
  //     window.open(`https://wa.me/${phoneNumber}`, '_blank');
  //   }
  // };

  // const handleShareClick = (data : ProjectPayments) => {
  //   const vendorNumber = vendors?.find((i) => i?.name === data?.vendor)?.vendor_mobile || '';
  //   setPhoneNumber(vendorNumber);
  //   setScreenshotUrl(data?.payment_attachment || null); // Set screenshot URL
  //   toggleShareDialog();
  // };

  const { notifications, mark_seen_notification } = useNotificationStore();
  
  const { db } = useContext(FrappeContext) as FrappeConfig;

  const handleSeenNotification = useCallback((notification : NotificationType | undefined) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification])

  const columns : ColumnDef<ProjectPayments>[] = useMemo(
          () => [
                  {
                      accessorKey: "payment_date",
                      header: ({ column }) => {
                          return (
                              <DataTableColumnHeader column={column} title="Payment Date" />
                          )
                      },
                      cell: ({ row }) => {
                          const data = row.original
                          const isNew = notifications.find(
                            (item) => item.docname === data?.name && item.seen === "false" && item.event_id === "payment:fulfilled"
                        )
                          return <div onClick={() => handleSeenNotification(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                                  {formatDate(data?.payment_date || data?.creation)}
                                </div>;
                      },
                  },
              {
                  accessorKey: "document_name",
                  header: "#PO",
                  cell: ({ row }) => {
                      const data : ProjectPayments = row.original;
                      let id;
                      if (data?.document_type === "Procurement Orders") {
                          id = data?.document_name.replaceAll("/", "&=")
                      } else {
                          id = data?.document_name
                      }
                      return <div className="font-medium flex items-center gap-1 min-w-[170px]">
                          {data?.document_name}
                          <HoverCard>
                              <HoverCardTrigger>
                                  <Info onClick={() => navigate(`/project-payments/${id}`)} className="w-4 h-4 text-blue-600 cursor-pointer" />
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
              ...(projectId ? [] : [
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
              ]),
              {
                id: "po_amount_including_gst",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="PO Amt" />
                    )
                },
                cell: ({ row }) => {
                    return <div className="font-medium">
                        {formatToIndianRupee(getTotalAmount(row.original.document_name, row.original.document_type)?.totalWithTax)}
                    </div>
                },
              },
              {
                  accessorKey: "amount",
                  header: ({ column }) => {
                      return (
                          <DataTableColumnHeader column={column} title={tab === "Payments Done" ? "Amount Paid" : "Amount To Pay"} />
                      )
                  },
                  cell: ({ row }) => {
                      return <div className="font-medium">
                          {tab === "Payments Done" ? <AmountPaidHoverCard paymentInfo={row.original} /> : formatToIndianRupee(row.original?.amount)}
                      </div>
                  },
              },
              // {
              //   accessorKey: "status",
              //   header: "Status",
              //   cell: ({ row }) => {
              //       return <div className="font-medium">{row.original?.status}</div>;
              //   }
              // },
              ...(tab === "Payments Done" ? [
                {
                  id: "download",
                  header: "Download",
                  cell: ({ row }) => {
                    const data = row.original
                      return (
                        data?.payment_attachment && (
                        <a
                          href={`${SITEURL}${data?.payment_attachment}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Download className="text-blue-500" />
                        </a>
                        )
                      )
                  }
                },

              ] : []),
          ],
          [projectValues, vendorValues, projectPayments, tab, getTotalAmount, projectId]
      );


    return (
      <div>
          {projectsLoading || vendorsLoading || projectPaymentsLoading ? (
                 <TableSkeleton />
                          ) : (
              <DataTable columns={columns} data={projectPayments || []} project_values={projectId ? undefined : projectValues} vendorData={vendors} approvedQuotesVendors={vendorValues} />
          )}

                    {/* <Dialog open={shareDialog} onOpenChange={toggleShareDialog}>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle className="text-center">Share Payment Screenshot via WhatsApp</DialogTitle>
                            <DialogDescription className="text-center">
                              {screenshotUrl && (
                                <div className="flex items-center flex-col mb-4">
                                  <img
                                    src={import.meta.env.MODE === "development" ? `http://localhost:8000${screenshotUrl}` : `${SITEURL}${screenshotUrl}`}
                                    alt="Payment Screenshot"
                                    className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
                                  />
                                  <p className="mt-2 text-sm text-gray-600 text-center">
                                    To download, right-click on the image and select "Save Image As..."
                                  </p>
                                </div>
                              )}
                              Download the Payment Screenshot and send it via WhatsApp to
                              <div className="ml-4 flex items-center gap-2 my-2">
                                <Label>Mobile: </Label>
                                <Input
                                  className=""
                                  type="text"
                                  value={phoneNumber}
                                  onChange={(e) => setPhoneNumber(e.target.value)}
                                  placeholder="Enter phone number"
                                />
                              </div>
                            </DialogDescription>
                          </DialogHeader>
                          <div className="flex justify-center space-x-4">
                            <Button
                              disabled={!phoneNumber}
                              onClick={handleOpenWhatsApp}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <CheckCheck className="h-4 w-4 mr-2" />
                              Open WhatsApp
                            </Button>
                          </div>
                        </DialogContent>
                    </Dialog> */}
      </div>

      );
}

export default AllPayments;