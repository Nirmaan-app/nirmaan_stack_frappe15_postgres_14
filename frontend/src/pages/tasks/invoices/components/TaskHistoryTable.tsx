// src/features/invoice-reconciliation/components/TaskHistoryTable.tsx
import React, { useCallback } from 'react';
import { useInvoiceTasks } from '../hooks/useInvoiceTasks';
import { getTaskHistoryColumns } from './columns';
import { DataTable } from '@/components/data-table/data-table'; // Adjust path
import { TailSpin } from 'react-loader-spinner'; // Adjust path
import { useToast } from '@/components/ui/use-toast'; // Adjust path
import { useUsersList } from '@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList';

export const TaskHistoryTable: React.FC = () => {
    const { toast } = useToast();
    // Fetch tasks *not* in Pending status
    const { tasks, isLoading, error, attachmentsMap } = useInvoiceTasks('!= Pending');

    const {data: usersList} = useUsersList()
    
    const getUserName = useCallback((id: string | undefined): string => {
        if (!id) return '';
        if(id === "Administrator") return "Administrator"
        return usersList?.find(user => user.name === id)?.full_name || id; // Fallback to id if not found
      }, [usersList])

    // Columns don't depend on actions here, so Memo has no dynamic dependencies
    const columns = React.useMemo(() => getTaskHistoryColumns(getUserName, attachmentsMap), [usersList, attachmentsMap]);

    if (error) {
        console.error("Error fetching task history:", error);
        toast({ title: "Error", description: "Could not load invoice task history.", variant: "destructive" });
        // Optionally return an error component
    }

    return (
        <div className="space-y-4">
            {isLoading ? (
                <div className="flex justify-center items-center p-8"><TailSpin color="red" width={50} height={50} /></div>
            ) : (
                <DataTable sortColumn={"modified"} columns={columns} data={tasks || []} />
            )}
        </div>
    );
};


export default TaskHistoryTable;