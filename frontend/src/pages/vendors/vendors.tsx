import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowLeft, Ellipsis, CirclePlus, HardHat } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Vendors as VendorsType } from "@/types/NirmaanStack/Vendors";
import { TableSkeleton } from "@/components/ui/skeleton";
import { TailSpin } from "react-loader-spinner";
import { formatDate } from "@/utils/FormatDate";
import { Badge } from "@/components/ui/badge"
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";

export default function Vendors() {

    const [categoryOptions, setCategoryOptions] = useState<{ label: string; value: string }[]>([]); // State for dynamic category options
    const { data: data, isLoading: isLoading, error: error } = useFrappeGetDocList("Vendors", {
        fields: ["*"],
        limit: 1000
    },
        "vendors"

    )

    const { data: category_data, isLoading: category_loading, error: category_error } = useFrappeGetDocList("Category", {
        fields: ["*"],
        limit: 1000
    })
    // Extract unique categories from the data dynamically
    useEffect(() => {
        if (category_data) {
            const currOptions = category_data.map((item) => ({
                value: item.name,
                label: item.name + "(" + item.work_package.slice(0, 4).toUpperCase() + ")"
            }))
            setCategoryOptions(currOptions);
        }
        console.log("options", categoryOptions)
    }, [category_data]);

    const columns: ColumnDef<VendorsType>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor ID" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/vendors/${row.getValue("name")}`}>
                                {row.getValue("name").slice(-4)}
                            </Link>
                        </div>
                    )
                }
            },
            {
                accessorKey: "vendor_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor Name" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/vendors/${row.getValue("name")}`}>
                                {row.getValue("vendor_name")}
                            </Link>
                        </div>
                    )
                }
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date Created" />
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
                accessorKey: "vendor_type",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor Type" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("vendor_type")}
                        </div>
                    )
                }
            },
            {
                accessorKey: "vendor_email",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor Email" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium flex items-center justify-start">
                            {row.getValue("vendor_email") || "--"}
                        </div>
                    )
                }
            },
            {
                accessorKey: "vendor_category", // Add the categories column
                header: ({ column }) => (
                    <DataTableColumnHeader column={column} title="Categories" />
                ),
                cell: ({ row }) => (
                    <div className="font-medium">
                        {/* Display the categories as a comma-separated string */}
                        {row.getValue("vendor_category")['categories'].length <= 3 ?
                            (row.getValue("vendor_category")['categories'].map((item) =>
                                <Badge className="mb-0.5 ml-0.5">{item}</Badge>
                            ))
                            :
                            (<div>{row.getValue("vendor_category")['categories'].slice(0, 3).map((item) =>
                                <Badge className="mb-0.5 ml-0.5">{item}</Badge>
                            )}
                                <HoverCard>
                                    <HoverCardTrigger asChild>
                                        <Button className="m-0.5 h-5" variant="outline" ><Ellipsis className="w-3.5 h-3.5" /></Button>
                                    </HoverCardTrigger>
                                    <HoverCardContent className="w-80">
                                        <div className="flex-col">
                                            {row.getValue("vendor_category")['categories'].slice(3).map((item) =>
                                                <Badge className="mb-0.5 ml-0.5">{item}</Badge>
                                            )}
                                        </div>
                                    </HoverCardContent>
                                </HoverCard>


                            </div>
                            )

                        }

                    </div>
                ),
                // Implement filtering for the categories
                filterFn: (row, _columnId, filterValue: string[]) => {
                    const categories = row.getValue<string[]>("vendor_category")['categories'] || [];
                    return filterValue.every((filter) => categories.includes(filter));
                },
            },
        ],
        []
    )

    if (isLoading || category_loading) return <h1>Loading...</h1>
    if (error || category_error) return error ? <h1>{error?.message}</h1> : <h1>{category_error?.message}</h1>
    return (
        <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
            <div className="flex items-center justify-between mb-2 space-y-2">
                <div className="flex">
                    <Link to="/"><ArrowLeft className="mt-1.5" /></Link>
                    <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">Vendors Dashboard</h2>
                </div>

                <div className="flex items-center space-x-2">
                    <Button asChild>
                        <Link to="new"> <CirclePlus className="w-5 h-5 mt- pr-1 " />Add <span className="hidden md:flex pl-1"> New Vendor</span></Link>
                    </Button>
                </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                <Card className="hover:animate-shadow-drop-center" onClick={() => {

                }}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Total Vendors
                        </CardTitle>
                        <HardHat className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />) : (data?.length)}
                            {/* {error && <p>Error</p>} */}
                        </div>
                        {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                    </CardContent>
                </Card>
            </div>
            <div className="pl-0 pr-2">
                {(isLoading || category_loading) ? (
                    <TableSkeleton />
                ) : (
                    <DataTable columns={columns} data={data || []} category_options={categoryOptions} />
                )}
            </div>
        </div>
    )
}