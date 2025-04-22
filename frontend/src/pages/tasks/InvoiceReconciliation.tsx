import React, { useState, useMemo, useCallback } from 'react';
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Link } from 'react-router-dom'; // For linking to PO/SR

// Assuming DataTable component is correctly imported
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge"; // For status display
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"; // For hover info
import { Check, X } from 'lucide-react'; // Icons for actions
import { TailSpin } from 'react-loader-spinner';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice'; // Adjust path
import { formatDate } from 'date-fns'; // For date formatting
import { InvoiceApprovalTask } from '@/types/NirmaanStack/Task';
import { ConfirmationDialog } from '../ProcurementRequests/ApproveVendorQuotes/components/ConfirmationDialog';

// Define state structure for confirmation
interface ConfirmationState {
  isOpen: boolean;
  taskId: string | null;
  taskInvoiceNo?: string | null; // Store invoice number for display
  action: "Approved" | "Rejected" | null;
}

const initialConfirmationState: ConfirmationState = {
  isOpen: false,
  taskId: null,
  taskInvoiceNo: null,
  action: null,
};


export default function InvoiceReconciliation() {
    const { toast } = useToast();
    // State for the confirmation dialog
    const [confirmationState, setConfirmationState] = useState<ConfirmationState>(initialConfirmationState);
    // State to track which *specific* task API call is loading (for dialog spinner)
    const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);


    // --- Data Fetching ---
    const {
        data: pendingTasks,
        isLoading: isLoadingTasks,
        error: tasksError,
        mutate: mutateTasks // Function to refetch the task list
    } = useFrappeGetDocList<InvoiceApprovalTask>("Task", {
        fields: [
            "name", "creation", "modified", "owner", "task_doctype", "task_docname",
            "status", "reference_value_1", "reference_value_2", "reference_value_3", "task_type"
        ],
        filters: [
            ["status", "=", "Pending"],
            ["task_type", "=", "po_invoice_approval"] // Filter by specific task type
        ],
        limit: 1000, // Adjust as needed, consider pagination for large lists
        orderBy: { field: "creation", order: "desc" }
    });

    // --- API Hook for Updating Task ---
    const { call: updateTaskStatusApi } = useFrappePostCall(
        "nirmaan_stack.api.tasks.update_task_status.update_invoice_task_status" // Ensure this path matches your backend API location
    );

    // --- Action Handler ---
    const handleUpdateTaskStatus = useCallback(async (taskId: string, newStatus: "Approved" | "Rejected") => {
        setLoadingTaskId(taskId); // Indicate processing start for this specific task

        try {
            const response = await updateTaskStatusApi({
                task_id: taskId,
                new_task_status: newStatus,
            });

            if (response.message?.status === 200) {
                toast({
                    title: "Success",
                    description: `Task ${newStatus.toLowerCase()} successfully.`,
                    variant: "success",
                });
                await mutateTasks(); // Refresh the task list automatically
            } else {
                 throw new Error(response.message?.message || `Failed to ${newStatus.toLowerCase()} task.`);
            }

        } catch (error) {
            console.error(`Error updating task ${taskId} to ${newStatus}:`, error);
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
                variant: "destructive",
            });
        } finally {
            setLoadingTaskId(null); // Indicate processing end
            setConfirmationState(initialConfirmationState); // Close dialog after action completes
        }
    }, [updateTaskStatusApi, mutateTasks, toast]);

     // --- Function to Open Confirmation Dialog ---
     const openConfirmationDialog = (task: InvoiceApprovalTask, action: "Approved" | "Rejected") => {
      setConfirmationState({
          isOpen: true,
          taskId: task.name,
          taskInvoiceNo: task.reference_value_2, // Store invoice number
          action: action,
      });
  };

  // --- Function to Close Confirmation Dialog ---
  const closeConfirmationDialog = () => {
      // Don't close if loading
      if (loadingTaskId) return;
      setConfirmationState(initialConfirmationState);
  };

  // --- Function to Handle Confirmation ---
  const onConfirmAction = async () => {
      if (confirmationState.taskId && confirmationState.action) {
          // Call the actual update function
          await handleUpdateTaskStatus(confirmationState.taskId, confirmationState.action);
          // Dialog closing is handled within handleUpdateTaskStatus's finally block
      }
  };


    // --- Column Definitions ---
    const columns = useMemo((): ColumnDef<InvoiceApprovalTask>[] => [
        {
            accessorKey: "task_docname",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Parent Doc" />,
            cell: ({ row }) => {
                const docType = row.original.task_doctype;
                const docName = row.original.task_docname;
                // Basic link - adjust path based on your routing structure
                const linkTo = docType === "Procurement Orders"
                    ? `/procurement-orders/${docName}` // Example path
                    : `/service-requests/${docName}`; // Example path
                return (
                    <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Link to={linkTo} className="text-blue-600 hover:underline">
                                    {docName}
                                </Link>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>View {docType === "Procurement Orders" ? "PO" : "SR"}: {docName}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
            enableSorting: true,
            enableHiding: false,
        },
        {
            accessorKey: "task_doctype",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
            cell: ({ row }) => (
                <Badge variant={row.original.task_doctype === "Procurement Orders" ? "secondary" : "outline"}>
                    {row.original.task_doctype === "Procurement Orders" ? "PO" : "SR"}
                </Badge>
            ),
            enableSorting: true,
            filterFn: (row, id, value) => value.includes(row.getValue(id)), // Enable filtering
        },
        {
            accessorKey: "reference_value_2", // Invoice No
            header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice No." />,
            cell: ({ row }) => <div className="font-medium">{row.original.reference_value_2 || 'N/A'}</div>,
            enableSorting: true,
        },
        {
            accessorKey: "reference_value_3", // Invoice Amount
            header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
            cell: ({ row }) => (
                <div className="text-right font-mono">
                    {formatToRoundedIndianRupee(parseFloat(row.original.reference_value_3 || '0'))}
                </div>
            ),
            enableSorting: true,
        },
         {
            accessorKey: "reference_value_1", // Invoice Date Key
            header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Date" />,
            cell: ({ row }) => {
                const dateKey = row.original.reference_value_1 || '';
                const displayDate = dateKey.includes('_') ? dateKey.split('_')[0] : dateKey; // Extract date part
                return (
                    <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger>
                                {displayDate ? formatDate(new Date(displayDate), 'dd-MMM-yyyy') : 'N/A'}
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Internal Date Key: {dateKey}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
            enableSorting: true,
         },
        {
            accessorKey: "creation",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Task Created" />,
            cell: ({ row }) => <div>{formatDate(new Date(row.original.creation), 'dd-MMM-yyyy HH:mm')}</div>,
            enableSorting: true,
        },
        {
          id: "actions",
          header: () => <div className="text-right">Actions</div>,
          cell: ({ row }) => {
              const task = row.original;
              const isProcessingThisTask = loadingTaskId === task.name; // Check if *this* task is loading

              return (
                  <div className="flex items-center justify-end space-x-1">
                      {/* Show spinner *only* if this specific task is being processed */}
                      {isProcessingThisTask ? (
                          <TailSpin color="gray" height={18} width={18} />
                      ) : (
                          <>
                              <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                      <TooltipTrigger asChild>
                                          <Button
                                              variant="ghost"
                                              size="icon"
                                              className="text-green-600 hover:bg-green-100 h-7 w-7"
                                              // Update onClick to open the dialog
                                              onClick={() => openConfirmationDialog(task, "Approved")}
                                              disabled={!!loadingTaskId} // Disable if *any* task is processing
                                          >
                                              <Check className="h-4 w-4" />
                                          </Button>
                                      </TooltipTrigger>
                                      <TooltipContent><p>Approve Invoice</p></TooltipContent>
                                  </Tooltip>
                              </TooltipProvider>
                              <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                      <TooltipTrigger asChild>
                                          <Button
                                              variant="ghost"
                                              size="icon"
                                              className="text-red-600 hover:bg-red-100 h-7 w-7"
                                              // Update onClick to open the dialog
                                              onClick={() => openConfirmationDialog(task, "Rejected")}
                                              disabled={!!loadingTaskId} // Disable if *any* task is processing
                                          >
                                              <X className="h-4 w-4" />
                                          </Button>
                                      </TooltipTrigger>
                                      <TooltipContent><p>Reject Invoice</p></TooltipContent>
                                  </Tooltip>
                              </TooltipProvider>
                          </>
                      )}
                  </div>
              );
          },
            enableSorting: false,
            enableHiding: false,
        },
    ], [loadingTaskId, openConfirmationDialog]); // Add dependencies

    // --- Render Logic ---
    if (tasksError) {
        console.error("Error fetching tasks:", tasksError);
        toast({ title: "Error", description: "Could not load invoice tasks.", variant: "destructive" });
        // Optionally return an error component
    }

    return (
        <div className="container mx-auto p-4 space-y-4">
                    {isLoadingTasks ? (
                         <div className="flex justify-center items-center p-8"><TailSpin color="red" width={50} height={50} /></div>
                    ) : (
                        <DataTable columns={columns} data={pendingTasks || []}
                          // Add other DataTable props as needed (e.g., filtering)
                          // Example: enable filtering on Parent Doc
                          //  columnFilters={[{ id: 'task_docname', value: '' }]} // Initial state for filters if needed
                          //  enableGlobalFilter={true} // Allow global search
                        />
                    )}

                    {/* Render the Confirmation Dialog */}
            <ConfirmationDialog
                isOpen={confirmationState.isOpen}
                onClose={closeConfirmationDialog}
                onConfirm={onConfirmAction}
                // Pass the specific loading state for the task being confirmed
                isLoading={loadingTaskId === confirmationState.taskId}
                // Dynamic title based on action
                title={confirmationState.action === "Approved" ? "Confirm Approval" : "Confirm Rejection"}
                // Dynamic confirm button text and variant
                confirmText={confirmationState.action === "Approved" ? "Approve" : "Reject"}
                confirmVariant={confirmationState.action === "Approved" ? "default" : "destructive"}
            >
                {/* Optional: Add descriptive text */}
                 <p className='text-sm text-muted-foreground text-center pt-2'>
                     Are you sure you want to{' '}
                     <strong className={confirmationState.action === "Rejected" ? "text-destructive" : "text-primary"}>
                         {confirmationState.action === "Approved" ? "Approve" : "Reject"}
                     </strong>
                     {' '}invoice{' '}
                     <strong>{confirmationState.taskInvoiceNo || `Task ID ${confirmationState.taskId}`}</strong>?
                 </p>
            </ConfirmationDialog>
        </div>
    );
}