import React, { useContext, useMemo, useState } from "react";
import { FrappeConfig, FrappeContext, useFrappeCreateDoc, useFrappeDocTypeEventListener, useFrappeFileUpload, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { CalendarIcon, Paperclip, SquarePlus } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTrigger, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Toast } from "@/components/ui/toast";
import { TailSpin } from "react-loader-spinner";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const ProjectPaymentsPaymentWise = () => {

    const { data: purchaseOrders, isLoading: poLoading, error: poError, mutate: poMutate } = useFrappeGetDocList("Procurement Orders", {
        fields: ["*"],
        filters: [["status", "not in", ["Cancelled"]]],
        limit: 10000,
        orderBy: { field: "modified", order: "desc" },
    });

    const { data: serviceOrders, isLoading: srLoading, error: srError, mutate: srMutate } = useFrappeGetDocList("Service Requests", {
        fields: ["*"],
        filters: [["status", "=", "Approved"]],
        limit: 10000,
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

    const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError, mutate: projectPaymentsMutate } = useFrappeGetDocList("Project Payments", {
        fields: ["*"],
        limit: 10000
    })

    useFrappeDocTypeEventListener("Project Payments", async () => {
        await projectPaymentsMutate();
    });

    const projectValues = projects?.map((item) => ({
        label: item.project_name,
        value: item.name,
    })) || [];

    const vendorValues = vendors?.map((item) => ({
        label: item.vendor_name,
        value: item.name,
    })) || [];

    const columns = useMemo(
        () => [
            {
                accessorKey: "name",
                header: "T.ID",
                cell: ({ row }) => {
                    const id = row.getValue("name");
                    return (
                        <div className="font-medium flex items-center gap-2 relative">
                            <p className="underline hover:underline-offset-2">
                                {id}
                            </p>
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
                accessorKey: "document_name",
                header: "#PO",
                cell: ({ row }) => {
                    return <div className="font-medium">{row.getValue("document_name")}</div>;
                }
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
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
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
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                }
            },
            {
                accessorKey: "amount",
                header: "Amount Paid",
                cell: ({ row }) => {
                    return <div className="font-medium">
                        {formatToIndianRupee(row.getValue("amount"))}
                    </div>
                },
            },
        ],
        [projectValues, vendorValues, projectPayments]
    );

    const { toast } = useToast();

    if (poError || srError || projectsError || vendorsError) {
        toast({
            title: "Error!",
            description: `Error: ${poError?.message || srError?.message || projectsError?.message}`,
            variant: "destructive",
        });
    }

    return (
        <div className="flex-1 space-y-4">
            {/* <div className="flex items-center justify-between space-y-2">
                <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">Project Payments List</h2>
            </div> */}
            {projectsLoading || vendorsLoading || projectPaymentsLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable columns={columns} data={projectPayments || []} project_values={projectValues} approvedQuotesVendors={vendorValues} />
            )}
        </div>
    );
};