
import React, { useState, useCallback, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from "@/components/ui/hover-card";
import { useUserData } from "@/hooks/useUserData";
import { formatDate as formatDateFns } from 'date-fns'; // Renamed to avoid conflict
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { Button } from "@/components/ui/button";
import { Trash2, Edit2 } from "lucide-react"; // Added Edit2 icon
import { useFrappeGetDocList } from 'frappe-react-sdk';
import { Projects } from '@/types/NirmaanStack/Projects';
import SITEURL from '@/constants/siteURL'; // Ensure SITEURL is imported

// Define the shape of a single invoice item
interface InvoiceItem {
  name: string;
  invoice_no: string;
  amount: string;
  creation: string;
  attachment?: string;
  project?: string;
  invoice_date: string;
}

interface ProjectInvoiceTableProps {
  items: InvoiceItem[];
  // siteUrl: string; // SITEURL is now imported directly
  handleDeleteInvoiceEntry: (invoiceId: string, invoiceNo: string) => void; // Pass invoiceNo for toast
  handleEditInvoiceEntry?: (invoice: InvoiceItem) => void; // --- (Indicator) NEW: onEdit callback ---
}

export const ProjectInvoiceTable: React.FC<ProjectInvoiceTableProps> = ({
  items,
  handleDeleteInvoiceEntry,
  handleEditInvoiceEntry // --- (Indicator) Destructure onEdit ---
}) => {
  const { role } = useUserData();
  const isAdmin = role === "Nirmaan Admin Profile";
  const { data: projectdata, isLoading: projectloading, error: projecterror } = useFrappeGetDocList<Projects>("Projects", {
    fields: ['name', 'project_name', 'customer', "status"],
    limit: 1000,
    orderBy: { field: 'creation', order: 'desc' },
  });

  const projectMap = useMemo(() => {
    if (!projectdata) return {}; // Return empty object if data is not yet loaded

    // Transform the array into an object like: { 'PROJ-001': 'Project Alpha', 'PROJ-002': 'Project Beta' }
    return projectdata.reduce((acc, project) => {
      acc[project.name] = project.project_name;
      return acc;
    }, {} as Record<string, string>);
  }, [projectdata]);

  // // State for managing the delete confirmation dialog
  // const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  // const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // // Memoized function to toggle the dialog state using a functional update
  // // This avoids dependency on the state variable itself.
  // const toggleDeleteDialog = useCallback(() => {
  //   setIsDeleteDialogOpen(prev => !prev);
  // }, []);

  // // Handler to open the dialog and set the selected invoice ID
  // const openDeleteDialog = (invoiceId: string) => {
  //   setSelectedInvoiceId(invoiceId);
  //   setIsDeleteDialogOpen(true);
  // };

  // // Handler for when the user confirms the deletion
  // const onConfirmDelete = () => {
  //   if (selectedInvoiceId) {
  //     handleDeleteInvoiceEntry(selectedInvoiceId);
  //   }
  // };

  // Ensure items is always an array to prevent .map errors
  const invoiceList = Array.isArray(items) ? items : [];

  return (
    // Use a React Fragment to wrap the Table and the Dialog as siblings
    <>
      <div className="relative max-h-[500px] overflow-y-auto border-none rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-center text-gray-700 font-semibold">Invoice No.</TableHead>
              <TableHead className="text-center text-gray-700 font-semibold">Amount(Incl. GST)</TableHead>
              <TableHead className="text-center text-gray-700 font-semibold">Invoice Date</TableHead>
              <TableHead className="text-center text-gray-700 font-semibold">Project</TableHead>
              {isAdmin && <TableHead className="text-center text-gray-700 font-semibold">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoiceList.length > 0 ? (
              invoiceList.map((item) => {
                const fullAttachmentUrl = item.attachment ? (item.attachment.startsWith('http') ? item.attachment : SITEURL + item.attachment) : null;
                const projectName = item.project ? projectMap[item.project] || item.project : 'N/A'; // Fallback to ID

                return (
                  <TableRow key={item.name}>
                    <TableCell className="text-center">
                      {fullAttachmentUrl ? (
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <a
                              href={fullAttachmentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline cursor-pointer"
                            >
                              {item.invoice_no}
                            </a>
                          </HoverCardTrigger>
                          <HoverCardContent className="w-auto p-0">
                            <img
                              src={fullAttachmentUrl}
                              alt={`Invoice preview for ${item.invoice_no}`}
                              className="max-w-xs max-h-64 rounded-md object-contain"
                            />
                          </HoverCardContent>
                        </HoverCard>
                      ) : (
                        <span>{item.invoice_no}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{projectName}</TableCell>
                    <TableCell className="text-center">
                      {formatToRoundedIndianRupee(parseFloat(item.amount) || 0)}
                    </TableCell>
                    <TableCell className="text-center">
                      {formatDateFns(new Date(item.invoice_date), "dd-MM-yyyy")}
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div className="flex items-center justify-center space-x-1">
                          {/* --- (Indicator) NEW: Edit Button --- */}
                          {handleEditInvoiceEntry && (
                            <Button
                              variant="ghost"
                              size="icon" // Changed to "icon" for consistency
                              className="h-8 w-8 p-0" // Standard icon button size
                              onClick={() => handleEditInvoiceEntry(item)}
                              aria-label={`Edit invoice ${item.invoice_no}`}
                            >
                              <Edit2 className="h-4 w-4 text-blue-600" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon" // Changed to "icon"
                            className="h-8 w-8 p-0"
                            onClick={() => handleDeleteInvoiceEntry(item.name, item.invoice_no)}
                            aria-label={`Delete invoice entry ${item.invoice_no}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={isAdmin ? 5 : 4} className="text-center py-4 text-gray-500">
                  No Invoices Found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {/* The AlertDialog is now a sibling to the Table, not a child */}
      {/* <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the invoice entry from the records.
            </AlertDialogDescription>
          </AlertDialogHeader> */}
      {/* Use AlertDialogFooter for action buttons */}
      {/* <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedInvoiceId(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog> */}
    </>
  );
};