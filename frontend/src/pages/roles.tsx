import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "@/components/ui/breadcrumb";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { NavBar } from "@/components/nav/nav-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Building2 } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

export default function Users() {

    const { data: data, isLoading: isLoading, error: error } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Roles")

    const columns: ColumnDef<NirmaanUsers>[] = useMemo(
        () => [
            {
                id: "select",
                header: ({ table }) => (
                    <Checkbox
                        checked={
                            table.getIsAllPageRowsSelected() ||
                            (table.getIsSomePageRowsSelected() && "indeterminate")
                        }
                        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                        aria-label="Select all"
                    />
                ),
                cell: ({ row }) => (
                    <Checkbox
                        checked={row.getIsSelected()}
                        onCheckedChange={(value) => row.toggleSelected(!!value)}
                        aria-label="Select row"
                    />
                ),
                enableSorting: false,
                enableHiding: false,
            },
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Role" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            <Link className="underline hover:underline-offset-2" to="/roles">
                                {row.getValue("name")}
                            </Link>
                        </div>
                    )
                }

            }

        ],
        []
    )
    return (
        <>
            <div className="flex-1 space-y-4 p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <Link to="/" className="md:text-base text-sm">Dashboard</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <Link to="/roles" className="text-gray-400 md:text-base text-sm">
                                Roles
                            </Link>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div>
                <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Roles List</h2>
                    <div className="flex items-center space-x-2">
                        <Button asChild>
                            <Link to="edit"> +Add Roles</Link>
                        </Button>
                    </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                    <Card className="hover:animate-shadow-drop-center" >
                        <Link to="/users">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Total Roles
                                </CardTitle>
                                <Building2 className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {(isLoading) ? (<p>Loading</p>) : data?.length}
                                    {error && <p>Error</p>}
                                </div>
                                <p className="text-xs text-muted-foreground">COUNT</p>
                            </CardContent>
                        </Link>
                    </Card>
                </div>
                <div className="container mx-auto py-10">
                    {isLoading && <h3>LOADING</h3>}
                    {error && <h3>ERROR</h3>}
                    <DataTable columns={columns} data={data || []} />
                </div>
            </div>
        </>
    )
}