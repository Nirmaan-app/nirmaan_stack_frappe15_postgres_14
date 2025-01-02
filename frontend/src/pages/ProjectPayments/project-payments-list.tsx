import React, { useContext, useMemo } from "react";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useNotificationStore } from "@/zustand/useNotificationStore";

export const ProjectPaymentsList = () => {
    const { data: purchaseOrders, isLoading: poLoading, error: poError, mutate: poMutate } = useFrappeGetDocList("Procurement Orders", {
        fields: ["*"],
        filters: [["status", "not in", ["Cancelled"]]],
        limit: 1000,
        orderBy: { field: "modified", order: "desc" },
    });

    const { data: serviceOrders, isLoading: srLoading, error: srError, mutate: srMutate } = useFrappeGetDocList("Service Requests", {
        fields: ["*"],
        filters: [["status", "=", "Approved"]],
        limit: 1000,
        orderBy: { field: "modified", order: "desc" },
    });

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList("Projects", {
        fields: ["name", "project_name"],
        limit: 1000,
    });

    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 1000,
    });

    useFrappeDocTypeEventListener("Procurement Orders", async () => {
        await poMutate();
    });

    useFrappeDocTypeEventListener("Service Requests", async () => {
        await srMutate();
    });

    const { notifications, mark_seen_notification } = useNotificationStore();
    const { db } = useContext(FrappeContext) as FrappeConfig;

    const projectValues = projects?.map((item) => ({
        label: item.project_name,
        value: item.name,
    })) || [];

    const vendorValues = vendors?.map((item) => ({
        label: item.vendor_name,
        value: item.name,
    })) || [];

    const getTotalAmount = (order, type: "Purchase Order" | "Service Order") => {
        if (type === "Purchase Order") {
            let total = 0;
            const orderData = order.order_list;
            orderData?.list.forEach((item) => {
                const price = parseFloat(item?.quote) || 0;
                const quantity = parseFloat(item?.quantity) || 1;
                total += price * quantity;
            });
            return total;
        }
        if (type === "Service Order") {
            let total = 0;
            const orderData = order.service_order_list;
            orderData?.list.forEach((item) => {
                const price = parseFloat(item?.rate) || 0;
                const quantity = parseFloat(item?.quantity) || 1;
                total += price * quantity;
            });
            return total;
        }
        return 0;
    };

    const columns = useMemo(
        () => [
            {
                accessorKey: "type",
                header: "Type",
                cell: ({ row }) => (
                    <Badge variant="default">{row.original.type}</Badge>
                ),
            },
            {
                accessorKey: "name",
                header: "ID",
                cell: ({ row }) => {
                    const id = row.getValue("name");
                    const poId = id?.replaceAll("/", "&=")
                    // const isNew = notifications.find(
                    //     (item) => item.docname === id && item.seen === "false"
                    // );
                    return (
                        // <div onClick={() => mark_seen_notification(db, isNew)} className="font-medium flex items-center gap-2 relative">
                        // {isNew && <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />}
                        < div className="font-medium flex items-center gap-2 relative" >
                            <Link to={`${poId}`} className="underline hover:underline-offset-2">
                                {id}
                            </Link>
                        </div >
                    );
                },
            },
            {
                accessorKey: "creation",
                header: "Date",
                cell: ({ row }) => (
                    <div className="font-medium">{formatDate(row.getValue("creation")?.split(" ")[0])}</div>
                ),
            },
            {
                accessorKey: "project",
                header: "Project",
                cell: ({ row }) => {
                    const project = projectValues.find(
                        (project) => project.value === row.getValue("project")
                    );
                    return project ? <div className="font-medium">{project.label}</div> : null;
                },
            },
            {
                accessorKey: "vendor",
                header: "Vendor",
                cell: ({ row }) => {
                    const vendor = vendorValues.find(
                        (vendor) => vendor.value === row.getValue("vendor")
                    );
                    return vendor ? <div className="font-medium">{vendor.label}</div> : null;
                },
            },
            {
                accessorKey: "total",
                header: "Total PO Amount",
                cell: ({ row }) => (
                    <div className="font-medium">
                        {formatToIndianRupee(getTotalAmount(row.original, row.original.type))}
                    </div>
                ),
            },
            {
                accessorKey: "paid",
                header: "Amount Paid",
                cell: ({ row }) => (
                    <div className="font-medium">
                        0
                    </div>
                ),
            },
        ],
        [projectValues, notifications]
    );

    const { toast } = useToast();

    if (poError || srError || projectsError || vendorsError) {
        toast({
            title: "Error!",
            description: `Error: ${poError?.message || srError?.message || projectsError?.message}`,
            variant: "destructive",
        });
    }

    const combinedData = [
        ...(purchaseOrders?.map((order) => ({ ...order, type: "Purchase Order" })) || []),
        ...(serviceOrders?.map((order) => ({ ...order, type: "Service Order" })) || []),
    ];

    return (
        <div className="flex-1 md:space-y-4">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">Project Payments List</h2>
            </div>
            {poLoading || srLoading || projectsLoading || vendorsLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable columns={columns} data={combinedData} />
            )}
        </div>
    );
};