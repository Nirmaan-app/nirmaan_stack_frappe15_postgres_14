import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import SITEURL from "@/constants/siteURL";
import { Customers } from "@/types/NirmaanStack/Customers";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import { ColumnDef } from "@tanstack/react-table";
import { Filter, FrappeDoc, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { Info } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { NewInflowPayment } from "./NewInflowPayment";


interface InFlowPaymentsProps {
    customerId? : string
}

export const InFlowPayments : React.FC<InFlowPaymentsProps> = ({customerId}) => {

    const navigate = useNavigate()
    const paymentFilters : Filter<FrappeDoc<ProjectInflows>>[] | undefined = []
        
    if (customerId) {
        paymentFilters.push(["customer", "=", customerId])
    }

  const {data : projectInflows, isLoading: projectInflowsLoading} = useFrappeGetDocList<ProjectInflows>("Project Inflows", {
    fields: ["*"],
    filters: paymentFilters,
    limit: 1000,
    orderBy: { field: "payment_date", order: "desc" },
  }, customerId ? `Project Inflows ${customerId}` : "Project Inflows")

  const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>("Projects", {
          fields: ["name", "project_name"],
          limit: 1000,
      }, "Projects");
    
    const {data: customers, isLoading: customersLoading} = useFrappeGetDocList<Customers>("Customers", {
        fields: ["name", "company_name"],
        limit: 1000,
    }, "Customers");

    const customerValues = useMemo(() => customers?.map((item) => ({
        label: item.company_name,
        value: item.name,
    })) || [], [customers])

  const projectValues = useMemo(() => projects?.map((item) => ({
          label: item.project_name,
          value: item.name,
    })) || [], [projects])

    const getProjectName = useMemo(() => memoize((id: string) => {
        const projectName = projectValues.find((proj) => proj.value === id)?.label;
        return projectName;
    }, (id: string) => id), [projects]);

    const getCustomerName = useMemo(() => memoize((id: string) => {
        const customerName = customerValues.find((cus) => cus.value === id)?.label;
        return customerName;
    }, (id: string) => id), [customers]);

  const columns : ColumnDef<ProjectInflows>[] = useMemo(
          () => [
            {
              accessorKey: "utr",
              header: ({ column }) => {
                  return (
                      <DataTableColumnHeader column={column} title="Payment Ref" />
                  )
              },
              cell: ({ row }) => {
                  const data = row.original
                  const screenshotUrl = data?.inflow_attachment;
                  return (
                    screenshotUrl ? (
                        <div className="font-medium text-blue-500">
                           <HoverCard>
                                <HoverCardTrigger>
                                    {data?.utr}
                                </HoverCardTrigger>
                                <HoverCardContent className="w-auto rounded-md shadow-lg">
                                  <img
                                    src={`${SITEURL}${screenshotUrl}`}
                                    alt="Payment Screenshot"
                                    className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
                                  />
                                </HoverCardContent>
                           </HoverCard>
                        </div>
                    ) : (
                        <div className="font-medium">
                            {data?.utr}
                        </div>
                    )
                  );
              },
          },
          {
              accessorKey: "payment_date",
              header: ({ column }) => {
                  return (
                      <DataTableColumnHeader column={column} title="Payment Date" />
                  )
              },
              cell: ({ row }) => {
                  const data = row.original
                  return <div className="font-medium flex items-center gap-2 relative">
                          {formatDate(data?.payment_date || data?.creation)}
                        </div>;
              },
          },
             
              {
                accessorKey: "project",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Project" />
                    )
                },
                  cell: ({ row }) => {
                    const projectId = row.original.project
                      return <div className="font-medium">
                        {getProjectName(projectId)}
                        <HoverCard>
                            <HoverCardTrigger>
                                <Info onClick={() => navigate(`/projects/${projectId}`)} className="w-4 h-4 text-blue-600 cursor-pointer inline-block ml-1" />
                            </HoverCardTrigger>
                            <HoverCardContent>
                                Click on to navigate to the Project screen!
                            </HoverCardContent>
                        </HoverCard>
                        </div>;
                  },
                  filterFn: (row, id, value) => {
                      return value.includes(row.getValue(id))
                  },
              },
              {
                accessorKey: "customer",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Customer" />
                    )
                },
                cell: ({ row }) => {
                     const customerId = row.original.customer
                    return <div className="font-medium text-center">
                        {getCustomerName(customerId)}
                        <HoverCard>
                            <HoverCardTrigger>
                                <Info onClick={() => navigate(`/customers/${customerId}`)} className="w-4 h-4 text-blue-600 cursor-pointer inline-block ml-1" />
                            </HoverCardTrigger>
                            <HoverCardContent>
                                Click on to navigate to the Customer screen!
                            </HoverCardContent>
                        </HoverCard>
                        </div>;
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                },
            },
              {
                  accessorKey: "amount",
                  header: ({ column }) => {
                      return (
                          <DataTableColumnHeader column={column} title="Amount" />
                      )
                  },
                  cell: ({ row }) => {
                      return <div className="font-medium text-green-600">
                          {formatToRoundedIndianRupee(row.original?.amount)}
                      </div>
                  },
              },
          ],
          [projectValues, customerValues, projectInflows, customerId]
      );

return (
       <div className="flex-1 space-y-4">
        {projectsLoading || projectInflowsLoading || customersLoading ? (
            <TableSkeleton />
        ) : (
            <DataTable columns={columns} data={projectInflows || []} project_values={projectValues} inFlowButton={customerId ? false : true} customerOptions={customerValues} />
        )}
        <NewInflowPayment />
       </div>
)
}

export default InFlowPayments;
