import { useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Projects } from "@/types/NirmaanStack/Projects";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";


type PRTable = {
    name: string
    project: string
    creation: string
    work_package: string
    category_list: {}
}

export const ApproveSelectVendor = () => {
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'category_list', 'creation'],
            filters: [
                ["workflow_state", "in", ["Vendor Selected", "Partially Approved"]]
            ],
            limit: 100
        });

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
    })

    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

    const columns: ColumnDef<PRTable>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="PR Number" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            <Link className="underline hover:underline-offset-2" to={`/approve-vendor/${row.getValue("name")}`}>
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
                            {/* {row.getValue("project")} */}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                },
            },
            {
                accessorKey: "work_package",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Package" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("work_package")}
                        </div>
                    )
                }
            },
            {
                accessorKey: "category_list",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Categories" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="flex flex-col gap-1 items-center justify-center">
                            {row.getValue("category_list").list.map((obj) =>  <Badge className="inline-block">{obj["name"]}</Badge>)}
                        </div>
                    )
                }
            },
            {
                accessorKey: "total",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Estimated Price" />
                    )
                },
                cell: () => {
                    return (
                        <div className="font-medium">
                            N/A
                        </div>
                    )
                }
            }

        ],
        [project_values]
    )

    let filteredList;

    if(procurement_request_list) {
        filteredList = procurement_request_list.filter((item) => item.procurement_list?.list?.some((i) => i.status === "Pending"))
    }
    
    const {toast} = useToast()

    if (procurement_request_list_error || projects_error) {
        console.log("Error in approve-select-vendor.tsx", procurement_request_list_error?.message, projects_error?.message)
        toast({
            title: "Error!",
            description: `Error ${procurement_request_list_error?.message || projects_error?.message}`,
            variant : "destructive"
        })   
    }

    return (
            <div className="flex">
                <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                    <div className="flex items-center justify-between space-y-2 pl-2">
                        <h2 className="text-lg font-bold tracking-tight">Approve Vendors</h2>
                    </div>
                    {(projects_loading || procurement_request_list_loading) ? (<TableSkeleton />) : (
                    <DataTable columns={columns} data={filteredList || []} project_values={project_values} />
                    )}
                    {/* <div className="overflow-x-auto">
                        <table className="min-w-full divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PR number</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Package</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estimated Price</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {procurement_request_lists?.map(item => (
                                    <tr key={item.name}>
                                        <td className="px-6 py-4 text-blue-600 whitespace-nowrap"><Link to={`/approve-vendor/${item.name}`}>{item.name.slice(-4)}</Link></td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {item.creation.split(" ")[0]}
                                        </td>
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">{item.project}</td>
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">{item.work_package}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                            N/A
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div> */}
                </div>
            </div>
    )
}