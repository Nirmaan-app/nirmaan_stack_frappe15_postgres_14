import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { TableSkeleton } from "@/components/ui/skeleton"
import { formatDate } from "@/utils/FormatDate"
import formatToIndianRupee from "@/utils/FormatPrice"
import { useFrappeGetDocList } from "frappe-react-sdk"
import { useMemo } from "react"
import { Link } from "react-router-dom"

export const ApprovedQuotationsTable = () => {

    const {data : approvedQuotations, isLoading: approvedQuotationsLoading, mutate: approvedQuotationsMutate} = useFrappeGetDocList("Approved Quotations", {
        fields: ["*"],
        limit: 10000
    })

    const {data: vendorsList} = useFrappeGetDocList("Vendors", {
        fields: ["*"],
        limit: 1000
    })

    const  findVendorName = (id) => {
        if(vendorsList) {
            return vendorsList?.find((i) => i?.name === id)?.vendor_name
        }
    }

    const findItemId = (name) => {
        if(approvedQuotations) {
            return approvedQuotations?.find((i) => i?.name === name)?.item_id
        }
    }

    const vendorOptions = vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.name }))

    const getItemOptions = useMemo(() => {
        const options = []
        const itemOptions = []
        if(approvedQuotations) {
            approvedQuotations?.forEach((aq) => {
                if(!options?.includes(aq.item_name)){
                    const op = ({ label: aq.item_name, value: aq.item_name })
                    itemOptions.push(op)
                    options.push(aq.item_name)
                }
            })
        }

        return itemOptions
    }, [approvedQuotations])

    const columns = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Quote ID" />
                    )
                }
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Creation" />
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
                accessorKey : "item_name",
                header: ({column}) => {
                    return (
                            <DataTableColumnHeader column={column} title="Item" />
                    )
                },
                cell: ({ row }) => {
                    const itemId = findItemId(row.getValue("name"))
                    return (
                        <Link className="underline hover:underline-offset-2" to={`/items/${itemId}`}>
                            {row.getValue("item_name")}
                        </Link>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                }
            },
            {
                accessorKey : "unit",
                header: ({column}) => {
                    return (
                        <DataTableColumnHeader column={column} title="Unit" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("unit")}
                        </div>
                    )
                }
            },
            {
                accessorKey : "quote",
                header: ({column}) => {
                    return (
                        <DataTableColumnHeader column={column} title="Quote" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatToIndianRupee(row.getValue("quote"))}
                        </div>
                    )
                }
            },
            {
                accessorKey : "vendor",
                header: ({column}) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor" />
                    )
                },
                cell: ({ row }) => {
                    const vendorName = findVendorName(row.getValue("vendor"))
                    return (
                        <div className="font-medium">
                            {vendorName}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                }
            },
            {
                accessorKey : "procurement_order",
                header: ({column}) => {
                    return (
                        <DataTableColumnHeader column={column} title="Associated PO" />
                    )
                },
                cell: ({ row }) => {
                    const poId = row.getValue("procurement_order")
                    return (
                        <Link className="underline hover:underline-offset-2" to={poId?.replaceAll("/", "&=")}>
                            {poId}
                        </Link>
                    )
                }
            }

        ],
        [approvedQuotations, vendorsList]
    )

    return (
        <div className="flex-1 md:space-y-4">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">Approved Quotations</h2>
            </div>
            {/* <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2"> */}
            {approvedQuotationsLoading ? (<TableSkeleton />) : (
                <DataTable columns={columns} data={approvedQuotations || []} approvedQuotesVendors={vendorOptions} itemOptions={getItemOptions} />
            )}
        </div>
    )
}