import { useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useToast } from "../ui/use-toast";
import { TableSkeleton } from "../ui/skeleton";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";


type PRTable = {
    name: string
    project_name: string
    creation: string
    category: string
}


export const ReleasePOSelect = () => {

    const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error, mutate: mutate } = useFrappeGetDocList("Procurement Orders",
        {
            fields: ["*"],
            limit: 1000
        },
        "Procurement Orders"
    );

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })

    const {data : vendorsList, isLoading: vendorsListLoading, error: vendorsError} = useFrappeGetDocList("Vendors", {
        fields: ["vendor_name"],
        limit: 1000
    },
    "Vendors"
    )

    const vendorOptions = vendorsList?.map((ven) => ({label : ven.vendor_name, value: ven.vendor_name}))
    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

    const getTotal = (order_id: string) => {
        let total: number = 0;
        const orderData = procurement_order_list?.find(item => item.name === order_id)?.order_list;
        orderData?.list.map((item) => {
            const price = item.quote;
            total += (price ? parseFloat(price) : 0) * (item.quantity ? parseFloat(item.quantity) : 1);
        })
        return total;
    }

    const columns: ColumnDef<PRTable>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="ID" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        // onClick={() => handleSet(row.getValue("name"))}
                        <div className="font-medium underline cursor-pointer">
                            <Link className="underline hover:underline-offset-2" to={`/release-po/${row.getValue("name").replaceAll("/", "&=")}`}>
                                {(row.getValue("name"))?.toUpperCase()}
                            </Link>
                        </div>
                    )
                }
            },
            {
                accessorKey: "procurement_request",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="PR Number" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("procurement_request")?.slice(-4)}
                        </div>
                    )
                }
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatDate(row.getValue("creation")?.split(" ")[0])}
                        </div>
                    )
                }
            },
            {
                accessorKey: "project",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Project" />
                    )
                },
                cell: ({ row }) => {
                    const project = project_values.find(
                        (project) => project.value === row.getValue("project")
                    )
                    if (!project) {
                        return null;
                    }

                    return (
                        <div className="font-medium">
                            {project.label}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                },
            },
            {
                accessorKey: "vendor_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("vendor_name")}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                }
            },
            {
                accessorKey: "total",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Amount" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatToIndianRupee(getTotal(row.getValue("name")))}
                        </div>
                    )
                }
            }
        ],
        [project_values]
    )

    const { toast } = useToast()

    if (procurement_order_list_error || projects_error || vendorsError ) {
        console.log("Error in release-po-select.tsx", procurement_order_list_error?.message, projects_error?.message, vendorsError?.message)
        toast({
            title: "Error!",
            description: `Error ${procurement_order_list_error?.message || projects_error?.message || vendorsError?.message}`,
            variant: "destructive"
        })
    }

    return (
        <>
                <div className="flex-1 md:space-y-4 p-4">
                    <div className="flex items-center justify-between space-y-2">
                        <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">Release PO</h2>
                    </div>
                    {(procurement_order_list_loading || projects_loading || vendorsListLoading) ? (<TableSkeleton />) : (
                        <DataTable columns={columns} data={procurement_order_list?.filter((po) => po.status !== "Cancelled") || []} project_values={project_values} vendorOptions={vendorOptions} />
                    )}
                </div>
            
        </>
    )
}



