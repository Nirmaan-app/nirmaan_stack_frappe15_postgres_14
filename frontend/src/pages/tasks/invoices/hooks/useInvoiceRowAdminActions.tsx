/**
 * Admin-only Edit + Delete actions for the PO / WO Invoices reconciliation tables.
 *
 * The reconciliation rows are a lighter shape than a full Vendor Invoice, so EDIT
 * fetches the full `Vendor Invoices` doc by name, drops it into the shared dialog
 * store (`selectedInvoice`) and opens the same `InvoiceDialog` used on the PO/WO
 * detail page. DELETE calls the existing `delete_invoice_entry` endpoint behind a
 * confirm dialog and refreshes the recon table + the reconciliation caches.
 *
 * Gated to admins (Nirmaan Admin Profile / Administrator) — the caller only pushes
 * the Actions column when `isAdmin` is true.
 */
import { useCallback, useEffect, useState } from "react";
import { mutate as globalMutate } from "swr";
import { useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { Pencil, Trash2 } from "lucide-react";

import { useUserData } from "@/hooks/useUserData";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { InvoiceDialog } from "@/pages/ProcurementOrders/invoices-and-dcs/components/InvoiceDialog";

export type InvoiceDocType = "Procurement Orders" | "Service Requests";

interface DeleteTarget {
  name: string;
  invoice_no?: string;
}

export function useInvoiceRowAdminActions(docType: InvoiceDocType, refresh: () => void) {
  const { role, user_id } = useUserData();
  const isAdmin = user_id === "Administrator" || role === "Nirmaan Admin Profile";

  const { setSelectedInvoice, toggleEditInvoiceDialog } = useDialogStore();
  const { toast } = useToast();

  // ----- EDIT: fetch the full Vendor Invoice by name, then open InvoiceDialog -----
  const [editInvoiceName, setEditInvoiceName] = useState<string | null>(null);
  const [editDocName, setEditDocName] = useState<string | undefined>(undefined);

  const { data: fullInvoice } = useFrappeGetDoc<VendorInvoice>(
    "Vendor Invoices",
    editInvoiceName ?? undefined,
    editInvoiceName ? undefined : null, // swrKey null → fetch disabled
  );

  useEffect(() => {
    if (editInvoiceName && fullInvoice && fullInvoice.name === editInvoiceName) {
      setSelectedInvoice(fullInvoice);
      toggleEditInvoiceDialog();
      setEditInvoiceName(null); // reset trigger; selectedInvoice keeps the dialog open
    }
  }, [editInvoiceName, fullInvoice, setSelectedInvoice, toggleEditInvoiceDialog]);

  const requestEdit = useCallback((invoiceName: string, parentDocName: string) => {
    setEditDocName(parentDocName);
    setEditInvoiceName(invoiceName);
  }, []);

  // ----- DELETE: confirm → delete_invoice_entry → refresh -----
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const { call: deleteApi, loading: deleteLoading } = useFrappePostCall(
    "nirmaan_stack.api.delivery_notes.update_invoice_data.delete_invoice_entry",
  );

  const requestDelete = useCallback((target: DeleteTarget) => setDeleteTarget(target), []);
  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const res = await deleteApi({
        invoice_id: deleteTarget.name,
        isSR: docType === "Service Requests",
      });
      if (res.message?.status === 200) {
        toast({
          title: "Success!",
          description: res.message.message || "Invoice deleted.",
          variant: "success",
        });
        refresh();
        globalMutate("Recon-Total-Invoiced-By-Document");
        globalMutate((key) => {
          const k = typeof key === "string" ? key : JSON.stringify(key ?? "");
          return k.includes("po_wise_invoice_data") || k.includes("sr_wise_invoice_data");
        });
      } else {
        throw new Error(res.message?.message || "Failed to delete invoice.");
      }
    } catch (e) {
      toast({
        title: "Deletion Failed!",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteApi, docType, refresh, toast]);

  return {
    isAdmin,
    docType,
    editDocName,
    requestEdit,
    deleteTarget,
    requestDelete,
    cancelDelete,
    confirmDelete,
    deleteLoading,
  };
}

export type InvoiceRowAdminActions = ReturnType<typeof useInvoiceRowAdminActions>;

/** The Actions-column cell: edit + delete icon buttons on one line. */
export function InvoiceRowActionsCell({
  invoiceName,
  invoiceNo,
  parentDocName,
  onEdit,
  onDelete,
}: {
  invoiceName: string;
  invoiceNo?: string;
  parentDocName: string;
  onEdit: (invoiceName: string, parentDocName: string) => void;
  onDelete: (target: DeleteTarget) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="text-blue-600 hover:text-blue-800"
        onClick={() => onEdit(invoiceName, parentDocName)}
        title={`Edit Invoice ${invoiceNo ?? ""}`}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="text-red-600 hover:text-red-800"
        onClick={() => onDelete({ name: invoiceName, invoice_no: invoiceNo })}
        title={`Delete Invoice ${invoiceNo ?? ""}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Mounts the shared edit dialog + the delete confirm dialog for a page. */
export function InvoiceRowAdminActionDialogs({
  actions,
  refresh,
}: {
  actions: InvoiceRowAdminActions;
  refresh: () => void;
}) {
  return (
    <>
      <InvoiceDialog
        docType={actions.docType}
        docName={actions.editDocName}
        // The dialog's own global invalidations refresh the recon table; this
        // is just the parent-doc mutator it expects.
        docMutate={refresh as any}
      />
      <Dialog
        open={!!actions.deleteTarget}
        onOpenChange={(open) => {
          if (!open) actions.cancelDelete();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-primary">
            Delete invoice {actions.deleteTarget?.invoice_no || ""}? This cannot be undone.
          </DialogDescription>
          <div className="flex items-center justify-end gap-2">
            {actions.deleteLoading ? (
              <TailSpin color="red" height={40} width={40} />
            ) : (
              <>
                <Button
                  variant="outline"
                  className="border-primary text-primary"
                  onClick={actions.cancelDelete}
                >
                  Cancel
                </Button>
                <Button disabled={actions.deleteLoading} onClick={actions.confirmDelete}>
                  Confirm
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
