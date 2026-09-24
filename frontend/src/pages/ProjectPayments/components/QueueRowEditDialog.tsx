/**
 * Opens the EXISTING expense edit dialog for a Payments-queue row (owner, 2026-09-21).
 *
 * One component for every tab screen (AllPayments, AccountantTabs, ApprovePayments), so the
 * "which dialog, with which record" decision has one home. Who may press the pencil is
 * `queueRowActions.canEditQueueRow`; this only carries out the edit.
 *
 * ⚠️ THE DIALOGS GET THE STORED DOCUMENT, NEVER THE QUEUE ROW. A queue row is the normalised
 * union of three ledgers and carries neither the vendor, the attachments nor the invoice fields
 * the dialogs render and write back — handing it over would save blanks over real values (the
 * bug the retired payment-edit pencil had). The record is fetched first; nothing renders until the
 * fetched document IS the clicked row.
 *
 * Open state lives in `useDialogStore` because both dialogs read it from there.
 */
import { useCallback, useEffect, useRef } from "react";
import { useFrappeGetDoc } from "frappe-react-sdk";

import { useDialogStore } from "@/zustand/useDialogStore";
import { EditProjectExpenseDialog } from "@/pages/ProjectExpenses/components/EditProjectExpenseDialog";
import { EditNonProjectExpense } from "@/pages/NonProjectExpenses/components/EditNonProjectExpense";
import { ApprovalQueueRow } from "../config/approvalsTable.config";

interface QueueRowEditDialogProps {
  /** The row whose pencil was pressed; null when nothing is being edited. */
  row: Pick<ApprovalQueueRow, "doctype" | "name"> | null;
  /** The dialog closed (saved or cancelled): the caller clears `row`. */
  onClose: () => void;
  /** A save went through: the caller refreshes its table. */
  onSaved: () => void;
}

export const QueueRowEditDialog = ({ row, onClose, onSaved }: QueueRowEditDialogProps) => {
  const doctype = row?.doctype;
  const name = row?.name;
  const isProjectExpense = doctype === "Project Expenses";
  const isNonProjectExpense = doctype === "Non Project Expenses";
  const isExpense = isProjectExpense || isNonProjectExpense;

  const { data: doc, mutate } = useFrappeGetDoc<any>(
    doctype as string,
    name as string,
    isExpense && name ? undefined : null
  );
  const docName: string | undefined = doc?.name;

  const {
    editProjectExpenseDialog,
    setEditProjectExpenseDialog,
    editNonProjectExpenseDialog,
    setEditNonProjectExpenseDialog,
  } = useDialogStore();
  const isOpen = isProjectExpense
    ? editProjectExpenseDialog
    : isNonProjectExpense
      ? editNonProjectExpenseDialog
      : false;

  // Open once the fetched document is the clicked row. `opened` tells "not open yet" apart from
  // "was open and has now closed", so the close below fires once per edit.
  const opened = useRef(false);
  useEffect(() => {
    opened.current = false;
  }, [name]);
  useEffect(() => {
    if (!name || docName !== name || opened.current) return;
    opened.current = true;
    if (isProjectExpense) setEditProjectExpenseDialog(true);
    else if (isNonProjectExpense) setEditNonProjectExpenseDialog(true);
  }, [name, docName, isProjectExpense, isNonProjectExpense, setEditProjectExpenseDialog, setEditNonProjectExpenseDialog]);
  useEffect(() => {
    if (opened.current && !isOpen) {
      opened.current = false;
      onClose();
    }
  }, [isOpen, onClose]);

  const handleSaved = useCallback(() => {
    mutate();
    onSaved();
    // The project dialog closes itself after a save; the non-project one leaves that to its parent.
    if (isNonProjectExpense) setEditNonProjectExpenseDialog(false);
  }, [mutate, onSaved, isNonProjectExpense, setEditNonProjectExpenseDialog]);

  if (!name || !doc || docName !== name) return null;
  if (isProjectExpense) return <EditProjectExpenseDialog expenseToEdit={doc} onSuccess={handleSaved} />;
  if (isNonProjectExpense) return <EditNonProjectExpense expenseToEdit={doc} onSuccess={handleSaved} />;
  return null;
};
