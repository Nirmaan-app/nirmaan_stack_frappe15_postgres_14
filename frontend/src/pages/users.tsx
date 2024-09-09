import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "@/components/breadcrumb";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { MainLayout } from "@/components/layout/main-layout";
import { NavBar } from "@/components/nav/nav-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { TableSkeleton } from "@/components/ui/skeleton";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { formatDate } from "@/utils/FormatDate";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowLeft, Building2, CirclePlus } from "lucide-react";
import { useMemo } from "react";
import { TailSpin } from "react-loader-spinner";
import { Link, useNavigate } from "react-router-dom";

export default function Users() {

    const navigate = useNavigate();

    const { data: data, isLoading: isLoading, error: error } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
        fields: ["name", "full_name", "email", "mobile_no", "creation"],
        limit: 1000
    })

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
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="ID" />
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
                cell: ({ row }) => <div className="font-medium">{row.getValue("full_name")}</div>
            },
            // {
            //     accessorKey: "email",
            //     header: ({ column }) => {
            //         return (
            //             <DataTableColumnHeader column={column} title="Email" />
            //         )
            //     },
            //     cell: ({ row }) => <div className="font-medium">{row.getValue("email")}</div>
            // },
            {
                accessorKey: "mobile_no",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Mobile" />
                    )
                },
                cell: ({ row }) => <div className="font-medium">{row.getValue("mobile_no")}</div>
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
            }

        ],
        []
    )
    return (
        // <MainLayout>
        <div className="flex-1 space-y-4 p-8 pt-6">
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
                <div className="flex">
                    <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/")} />
                    <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">User List</h2>
                </div>

                <div className="flex items-center space-x-2">
                    <Button asChild>
                        <Link to="new"> <CirclePlus className="w-5 h-5 mt- pr-1 " />Add <span className="hidden md:flex pl-1"> New User</span></Link>
                    </Button>
                </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                <Card className="hover:animate-shadow-drop-center" >
                    <Link to="/users">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Total Users
                            </CardTitle>
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />) : data?.length}
                                {error && <p>Error</p>}
                            </div>
                            {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                        </CardContent>
                    </Link>
                </Card>
            </div>
            <div className="pl-0 pr-2">
                {isLoading ? (
                    <TableSkeleton />
                ) : (
                    <DataTable columns={columns} data={data || []} />
                )}
            </div>
        </div>
        //    </MainLayout>
    )
}