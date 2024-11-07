import { useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Badge } from "../ui/badge";
import { useToast } from "../ui/use-toast";
import { TableSkeleton } from "../ui/skeleton";
import { formatDate } from "@/utils/FormatDate";


export const SelectServiceVendorList = () => {
    const { data: service_list, isLoading: service_list_loading, error: service_list_error, mutate: serviceListMutate } = useFrappeGetDocList("Service Requests",
        {
            fields: ["*"],
            filters: [["status", "=", "Created"]],
            limit: 1000,
            orderBy: {field: "modified", order: "desc"}
        });

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })

    
    useFrappeDocTypeEventListener("Service Requests", async (event) => {
        await serviceListMutate()
    })

    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

    // const getTotal = (order_id: string) => {
    //     let total: number = 0;
    //     const orderData = procurement_request_list?.find(item => item.name === order_id)?.procurement_list;
    //     console.log("orderData", orderData)
    //     orderData?.list.map((item) => {
    //         const quotesForItem = quote_data
    //             ?.filter(value => value.item_id === item.name && value.quote != null)
    //             ?.map(value => value.quote);
    //         let minQuote;
    //         if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
    //         total += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
    //     })
    //     return total;
    // }

    const columns = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="SR Number" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            <Link className="underline hover:underline-offset-2" to={`${row.getValue("name")}`}>
                                {row.getValue("name")?.slice(-4)}
                            </Link>
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
            // {
            //     accessorKey: "work_package",
            //     header: ({ column }) => {
            //         return (
            //             <DataTableColumnHeader column={column} title="Package" />
            //         )
            //     },
            //     cell: ({ row }) => {
            //         return (
            //             <div className="font-medium">
            //                 {row.getValue("work_package")}
            //             </div>
            //         )
            //     }
            // },
            {
                accessorKey: "service_category_list",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Categories" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="flex flex-col gap-1 items-start justify-center">
                            {row.getValue("service_category_list").list.map((obj) => <Badge className="inline-block">{obj["name"]}</Badge>)}
                        </div>
                    )
                }
            }

        ],
        [project_values]
    )
    const { toast } = useToast()

    if (service_list_error || projects_error) {
        console.log("Error in select-vendor-list.tsx", service_list_error?.message, projects_error?.message)
        toast({
            title: "Error!",
            description: `Error ${service_list_error?.message || projects_error?.message}`,
            variant: "destructive"
        })
    }

    return (
        <div className="flex-1 md:space-y-4">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">Choose Vendor PR</h2>
            </div>
            {(projects_loading || service_list_loading) ? (<TableSkeleton />) : (
                <DataTable columns={columns} data={service_list || []} project_values={project_values} />
            )}
        </div>
    )
}