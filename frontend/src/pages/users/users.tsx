import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { formatDate } from "@/utils/FormatDate";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowLeft, UsersRound, CirclePlus } from "lucide-react";
import { useMemo } from "react";
import { TailSpin } from "react-loader-spinner";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";

export default function Users() {

    const navigate = useNavigate();

    const { data: data, isLoading: isLoading, error: error } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
        fields: ["*"],
        limit: 1000,
        orderBy: { field: "creation", order: "desc" }
    },
        "Nirmaan Users"
    )

    // console.log("data", data)

    const roleTypeOptions = [{ label: "Project Manager", value: "Nirmaan Project Manager Profile" },
    { label: "Project Lead", value: "Nirmaan Project Lead Profile" },
    { label: "Procurement Executive", value: "Nirmaan Procurement Executive Profile" },
    { label: "Admin Profile", value: "Nirmaan Admin Profile" },
    { label: "Design Executive", value: "Nirmaan Design Executive Profile" },
    { label: "Accountant", value: "Nirmaan Accountant Profile" }
    ]



    const columns: ColumnDef<NirmaanUsers>[] = useMemo(
        () => [
            // {
            //     id: "select",
            //     header: ({ table }) => (
            //         <Checkbox
            //             checked={
            //                 table.getIsAllPageRowsSelected() ||
            //                 (table.getIsSomePageRowsSelected() && "indeterminate")
            //             }
            //             onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            //             aria-label="Select all"
            //         />
            //     ),
            //     cell: ({ row }) => (
            //         <Checkbox
            //             checked={row.getIsSelected()}
            //             onCheckedChange={(value) => row.toggleSelected(!!value)}
            //             aria-label="Select row"
            //         />
            //     ),
            //     enableSorting: false,
            //     enableHiding: false,
            // },
            // {
            //     accessorKey: "name",
            //     header: ({ column }) => {
            //         return (
            //             <DataTableColumnHeader column={column} title="ID" />
            //         )
            //     },
            //     cell: ({ row }) => {
            //         return (
            //             <div className="font-medium">
            //                 <Link className="underline hover:underline-offset-2" to={`/users/${row.getValue("name")}`}>
            //                     {row.getValue("name")}
            //                 </Link>
            //             </div>
            //         )
            //     }
            // },
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Email" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            <Link className="underline hover:underline-offset-2" to={`/users/${row.getValue("name")}`}>
                                {row.getValue("name")}
                            </Link>
                        </div>
                    )
                }
            },
            {
                accessorKey: "full_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Full Name" />
                    )
                },
                cell: ({ row }) => (
                    <Link className="underline hover:underline-offset-2" to={`/users/${row.getValue("name")}`}>
                        <div className="font-medium">{row.getValue("full_name")}</div>
                    </Link>
                )
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date Joined" />
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
                accessorKey: "role_profile",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Role" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue<String>("role_profile")?.split(" ").slice(1, 3).join(" ")}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                }
            },
            {
                id: "contact",
                accessorFn: row => `${row.email}_${row.mobile_no}`,
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Contact" />
                    )
                },
                cell: ({ row }) => (
                    <div className="font-medium flex flex-col w-40">
                        <Badge className="mb-2">M: +91-{row.getValue<String>("contact").split("_")[1]}</Badge>
                        <Badge>E: {row.getValue<String>("contact").split("_")[0]}</Badge>
                    </div>
                )
            }

        ],
        []
    )
    // if (isLoading) return <h1>Loading</h1>
    if (error) return <h1>error.message</h1>
    return (
        <div className="flex-1 md:space-y-4">
            {/* <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <Link to="/" className="md:text-base text-sm">Dashboard</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <Link to="/users" className="text-gray-400 md:text-base text-sm">
                                Users
                            </Link>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div> */}
            {/* <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Users List</h2>
                    <div className="flex items-center space-x-2">
                        <Button asChild>
                            <Link to="edit"> +Add Users</Link>
                        </Button>
                    </div>
                </div> */}
            <div className="flex items-center justify-between mb-2 space-y-2">
                <div className="flex items-center gap-1">
                    {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate("/")} /> */}
                    <h2 className="text-xl md:text-3xl font-bold tracking-tight">User List</h2>
                </div>

                <Button asChild>
                    <Link to="new"> <CirclePlus className="w-5 h-5 pr-1 " />Add <span className="hidden md:flex pl-1"> New User</span></Link>
                </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                <Card className="hover:animate-shadow-drop-center" >
                    <Link to="/users">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Total Users
                            </CardTitle>
                            <UsersRound className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />) : data?.length}
                                {error && <p>Error</p>}
                            </div>
                        </CardContent>
                    </Link>
                </Card>
            </div>
            <div className="pl-0 pr-2">
                {isLoading ? (
                    <TableSkeleton />
                ) : (
                    <DataTable columns={columns} data={data || []} roleTypeOptions={roleTypeOptions} />
                )}
            </div>
        </div>
    )
}