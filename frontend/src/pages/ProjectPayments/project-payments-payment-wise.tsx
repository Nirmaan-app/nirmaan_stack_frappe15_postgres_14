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

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList("Projects", {
        fields: ["name", "project_name"],
        limit: 1000,
    });

    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 10000,
    });

    const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError, mutate: projectPaymentsMutate } = useFrappeGetDocList("Project Payments", {
        fields: ["*"],
        limit: 100000
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

    const siteUrl = `${window.location.protocol}//${window.location.host}`;

    const columns = useMemo(
        () => [
            // {
            //     accessorKey: "name",
            //     header: "T.ID",
            //     cell: ({ row }) => {
            //         const id = row.getValue("name");
            //         return (
            //             <div className="font-medium flex items-center gap-2 relative">
            //                 <p className="underline hover:underline-offset-2">
            //                     {id}
            //                 </p>
            //             </div >
            //         );
            //     },
            // },
            {
                accessorKey: "utr",
                header: "UTR",
                cell: ({ row }) => {
                    const data = row.original
                    return (
                        <div className="font-medium text-blue-500 underline hover:underline-offset-2">
                            {import.meta.env.MODE === "development" ? (
                                <a href={`http://localhost:8000${data?.payment_attachment}`} target="_blank" rel="noreferrer">
                                    {data?.utr}
                                </a>
                            ) : (
                                <a href={`${siteUrl}${data?.payment_attachment}`} target="_blank" rel="noreferrer">
                                    {data?.utr}
                                </a>
                            )}
                        </div>
                    );
                },
            },
            {
                id: "payment_date",
                header: "Date",
                cell: ({ row }) => {
                    const data = row.original
                    return <div className="font-medium">{formatDate(data?.payment_date || data?.creation)}</div>;
                },
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

    if (projectsError || vendorsError || projectPaymentsError) {
        toast({
            title: "Error!",
            description: `Error: ${vendorsError?.message || projectsError?.message || projectPaymentsError?.message}`,
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