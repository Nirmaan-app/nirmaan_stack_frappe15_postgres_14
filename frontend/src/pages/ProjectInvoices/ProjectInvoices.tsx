// src/pages/ProjectInvoices/ProjectInvoices.tsx

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { TableSkeleton } from "@/components/ui/skeleton";
// SITEURL is used by ProjectInvoiceTable now, no need to pass as prop if it imports directly
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { CirclePlus, Edit2, Trash2 } from "lucide-react"; // Added icons for clarity, though table handles its own
import React, { useMemo, useState, useCallback } from "react"; // Added useState, useCallback
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog"; // For delete confirmation

//Component
import { ProjectInvoiceTable } from "./components/ProjectInvoiceTable";
import { NewProjectInvoiceDialog } from "./components/NewProjectInvoiceDialog"; // Using renamed/refactored create dialog
import { EditProjectInvoiceDialog } from "./components/EditProjectInvoiceDialog"; // NEW: Import Edit Dialog


const DOCTYPE = "Project Invoices";
const ITEM_LIST_FIELDS_TO_FETCH: (keyof ProjectInvoice | 'name')[] = ["name", "invoice_no", "amount", "attachment", "creation", "owner", "project", "modified_by", "invoice_date"];

export const ProjectInvoices: React.FC<{ projectId?: string; customerId?: string }> = ({ projectId }) => { // Removed customerId if not used
  const {
    toggleNewProjectInvoiceDialog,
    setEditProjectInvoiceDialog // Get setter for edit dialog
  } = useDialogStore();

  const { data, isLoading, error, mutate } = useFrappeGetDocList<ProjectInvoice>(DOCTYPE, {
    fields: ITEM_LIST_FIELDS_TO_FETCH, // No need to cast as string[] if type is correct
    filters: projectId ? [["project", "=", projectId]] : [],
    orderBy: { field: "invoice_date", order: "desc" },
    limit_page_length: 1000, // Fetch more if this is a primary view for a project
  });

  const { deleteDoc, loading: deleteDocLoading } = useFrappeDeleteDoc();

  // --- (Indicator) NEW: State for Edit and Delete ---
  const [invoiceToEdit, setInvoiceToEdit] = useState<ProjectInvoice | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<{ id: string, no: string } | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);


  // --- (Indicator) NEW: Handler to open edit dialog ---
  const handleOpenEditDialog = useCallback((invoice: ProjectInvoice) => {
    setInvoiceToEdit(invoice);
    setEditProjectInvoiceDialog(true);
  }, [setEditProjectInvoiceDialog]);

  const handleDeleteInvoiceTrigger = useCallback((invoiceId: string, invoiceNo: string) => {
    setInvoiceToDelete({ id: invoiceId, no: invoiceNo });
    setIsDeleteDialogOpen(true);
  }, []);

  const confirmDeleteInvoice = async () => {
    if (!invoiceToDelete) return;
    try {
      await deleteDoc(DOCTYPE, invoiceToDelete.id);
      await mutate(); // Revalidate the SWR cache for useFrappeGetDocList

      toast({
        title: "Success!",
        description: `Invoice ${invoiceToDelete.no} deleted successfully.`,
        variant: "success"
      });
    } catch (error: any) {
      console.error("deleteInvoice error", error);
      toast({
        title: "Failed!",
        description: error?.message || "Failed to delete invoice!",
        variant: "destructive",
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setInvoiceToDelete(null);
    }
  };

  return (
    <div className="flex-1 space-y-4">
      <Card>
        <CardHeader className="border-b"> {/* Removed border-gray-200 for theme consistency */}
          <CardTitle className="flex justify-between items-center">
            <p className="text-xl max-sm:text-lg text-primary">Invoices</p> {/* Using primary color */}
            <div className='flex gap-2 items-center'>
              <Button
                variant="outline"
                size="sm"
                className="text-primary border-primary hover:bg-primary/5"
                onClick={toggleNewProjectInvoiceDialog}
              >
                <CirclePlus className="h-4 w-4 mr-2" /> Add Invoice
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0"> {/* Remove padding to let table control it */}
          {isLoading && !data ? ( // Show skeleton only on initial load without data
            <div className="p-6"> <TableSkeleton /> </div>
          ) : error ? (
            <div className="p-6 text-center text-destructive">Failed to load invoices: {error.message}</div>
          ) : (
            <div className="overflow-x-auto">
              <ProjectInvoiceTable
                items={data || []}
                handleDeleteInvoiceEntry={handleDeleteInvoiceTrigger}
                handleEditInvoiceEntry={handleOpenEditDialog} // --- (Indicator) Pass edit handler ---
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog for Creating Project Invoices */}
      <NewProjectInvoiceDialog
        listMutate={mutate}
        ProjectId={projectId}
      />

      {/* --- (Indicator) NEW: Dialog for Editing Project Invoices --- */}
      {invoiceToEdit && (
        <EditProjectInvoiceDialog
          invoiceToEdit={invoiceToEdit}
          listMutate={mutate}
          onClose={() => {
            setInvoiceToEdit(null);
            // setEditProjectInvoiceDialog(false); // Dialog manages its own closing via onOpenChange
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {invoiceToDelete && (
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete invoice
                <strong className="px-1 font-semibold text-foreground">{invoiceToDelete.no}</strong>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setInvoiceToDelete(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDeleteInvoice} disabled={deleteDocLoading} className="bg-destructive hover:bg-destructive/90">
                {deleteDocLoading ? "Deleting..." : "Yes, delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
};

export default ProjectInvoices;