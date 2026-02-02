// src/store/dialogStore.ts
import { create } from 'zustand';

/* ─────────────────────────────────────────────────────────────
   LOGGING
   ───────────────────────────────────────────────────────────── */

const LOG_PREFIX = '[Dialog:Store]';
const LOG_ENABLED = true;

const log = (...args: any[]) => {
    if (LOG_ENABLED) console.log(LOG_PREFIX, ...args);
};

export type DialogStore = {
  // Request Payment Dialog
  requestPaymentDialog: boolean;
  setRequestPaymentDialog: (open: boolean) => void;
  toggleRequestPaymentDialog: () => void;

  // Update Payment Dialog
  paymentDialog: boolean;
  setPaymentDialog: (open: boolean) => void;
  togglePaymentDialog: () => void;

  // --- (Indicator) NEW: For editing already paid/fulfilled payments ---
  editFulfilledPaymentDialog: boolean;
  setEditFulfilledPaymentDialog: (open: boolean) => void;

  shareDialog: boolean;
  setShareDialog: (open: boolean) => void;
  toggleShareDialog: () => void;

  // New Inflow Dialog
  newInflowDialog: boolean;
  setNewInflowDialog: (open: boolean) => void;
  toggleNewInflowDialog: () => void;

  // --- (Indicator) NEW: Edit Inflow Payment Dialog ---
  editInflowDialog: boolean;
  setEditInflowDialog: (open: boolean) => void;
  toggleEditInflowDialog: () => void;

  // New Invoice Dialog (assuming this is for a different "Invoice" type than ProjectInvoice)
  newInvoiceDialog: boolean;
  setNewInvoiceDialog: (open: boolean) => void;
  toggleNewInvoiceDialog: () => void;

  // New ProjectInvoice Dialog
  newProjectInvoiceDialog: boolean;
  setNewProjectInvoiceDialog: (open: boolean) => void;
  toggleNewProjectInvoiceDialog: () => void;

  // --- (Indicator) NEW: Edit Project Invoice Dialog ---
  editProjectInvoiceDialog: boolean;
  setEditProjectInvoiceDialog: (open: boolean) => void;
  toggleEditProjectInvoiceDialog: () => void;

  // New Item Dialog
  newItemDialog: boolean;
  toggleNewItemDialog: () => void; // Consider adding a 'setNewItemDialog' for consistency

  // --- (Indicator) NEW: Non-Project Expense Dialog ---
  newNonProjectExpenseDialog: boolean;
  setNewNonProjectExpenseDialog: (open: boolean) => void;
  toggleNewNonProjectExpenseDialog: () => void;

  // --- (Indicator) NEW: Edit Non-Project Expense Dialog ---
  editNonProjectExpenseDialog: boolean;
  setEditNonProjectExpenseDialog: (open: boolean) => void;
  toggleEditNonProjectExpenseDialog: () => void;

  // --- (Indicator) NEW: Project Expense Dialogs ---
  newProjectExpenseDialog: boolean;
  setNewProjectExpenseDialog: (open: boolean) => void;
  toggleNewProjectExpenseDialog: () => void;

  editProjectExpenseDialog: boolean;
  setEditProjectExpenseDialog: (open: boolean) => void;
  toggleEditProjectExpenseDialog: () => void;

  // --- (Indicator) NEW: Generic Delete Confirmation Dialog ---
  deleteConfirmationDialog: boolean;
  setDeleteConfirmationDialog: (open: boolean) => void;
  toggleDeleteConfirmationDialog: () => void;

  // New WO Dialog
  newWODialog: boolean;
  setNewWODialog: (open: boolean) => void;
  toggleNewWODialog: () => void;
  // --- (Explanation)
  // Added state and actions for the "New Non-Project Expense" dialog.
  // - `newNonProjectExpenseDialog`: Boolean to control its visibility.
  // - `setNewNonProjectExpenseDialog`: Function to explicitly set its state (open/closed).
  // - `toggleNewNonProjectExpenseDialog`: Function to toggle its current state.
};

export const useDialogStore = create<DialogStore>((set) => ({
  requestPaymentDialog: false,
  setRequestPaymentDialog: (open: boolean) => set({ requestPaymentDialog: open }),
  toggleRequestPaymentDialog: () => set((state) => ({ requestPaymentDialog: !state.requestPaymentDialog })), // Using state from set callback

  paymentDialog: false,
  setPaymentDialog: (open: boolean) => set({ paymentDialog: open }),
  togglePaymentDialog: () => set((state) => ({ paymentDialog: !state.paymentDialog })),

  // --- (Indicator) NEW: Implementation for the new dialog state ---
  editFulfilledPaymentDialog: false,
  setEditFulfilledPaymentDialog: (open: boolean) => set({ editFulfilledPaymentDialog: open }),

  shareDialog: false,
  setShareDialog: (open: boolean) => set({ shareDialog: open }),
  toggleShareDialog: () => set((state) => ({ shareDialog: !state.shareDialog })),

  newInflowDialog: false,
  setNewInflowDialog: (open: boolean) => set({ newInflowDialog: open }),
  toggleNewInflowDialog: () => set((state) => ({ newInflowDialog: !state.newInflowDialog })),

  // --- (Indicator) NEW: Edit Inflow Payment Dialog Implementation ---
  editInflowDialog: false,
  setEditInflowDialog: (open: boolean) => set({ editInflowDialog: open }),
  toggleEditInflowDialog: () => set((state) => ({ editInflowDialog: !state.editInflowDialog })),

  newInvoiceDialog: false,
  setNewInvoiceDialog: (open: boolean) => set({ newInvoiceDialog: open }),
  toggleNewInvoiceDialog: () => set((state) => ({ newInvoiceDialog: !state.newInvoiceDialog })),

  newProjectInvoiceDialog: false,
  setNewProjectInvoiceDialog: (open: boolean) => set({ newProjectInvoiceDialog: open }),
  toggleNewProjectInvoiceDialog: () => set((state) => ({ newProjectInvoiceDialog: !state.newProjectInvoiceDialog })),

  // --- (Indicator) NEW: Edit Project Invoice Dialog Implementation ---
  editProjectInvoiceDialog: false,
  setEditProjectInvoiceDialog: (open: boolean) => set({ editProjectInvoiceDialog: open }),
  toggleEditProjectInvoiceDialog: () => set((state) => ({ editProjectInvoiceDialog: !state.editProjectInvoiceDialog })),

  newItemDialog: false,
  // Consider adding setNewItemDialog if you might need it:
  // setNewItemDialog: (open: boolean) => set({ newItemDialog: open }),
  toggleNewItemDialog: () => set((state) => ({ newItemDialog: !state.newItemDialog })),

  // --- (Indicator) NEW: Non-Project Expense Dialog Implementation ---
  newNonProjectExpenseDialog: false,
  setNewNonProjectExpenseDialog: (open: boolean) => set({ newNonProjectExpenseDialog: open }),
  toggleNewNonProjectExpenseDialog: () => set((state) => ({ newNonProjectExpenseDialog: !state.newNonProjectExpenseDialog })),
  // --- (Explanation)
  // Implemented the new state property and its associated actions.
  // `newNonProjectExpenseDialog` defaults to `false`.
  // `setNewNonProjectExpenseDialog` allows direct setting of the dialog's visibility.
  // `toggleNewNonProjectExpenseDialog` flips the current visibility state.
  // Note: Using `(state) => ({...})` in the toggle functions is slightly safer as it always uses the latest state,
  // though `!get().dialogName` is generally fine for simple toggles. I've updated existing toggles to this pattern for consistency.

  // --- (Indicator) NEW: Edit Non-Project Expense Dialog Implementation ---
  editNonProjectExpenseDialog: false,
  setEditNonProjectExpenseDialog: (open: boolean) => set({ editNonProjectExpenseDialog: open }),
  toggleEditNonProjectExpenseDialog: () => set((state) => ({ editNonProjectExpenseDialog: !state.editNonProjectExpenseDialog })),

  // --- (Indicator) NEW: Project Expense Dialog Implementations ---
  newProjectExpenseDialog: false,
  setNewProjectExpenseDialog: (open: boolean) => set({ newProjectExpenseDialog: open }),
  toggleNewProjectExpenseDialog: () => set((state) => ({ newProjectExpenseDialog: !state.newProjectExpenseDialog })),

  editProjectExpenseDialog: false,
  setEditProjectExpenseDialog: (open: boolean) => set({ editProjectExpenseDialog: open }),
  toggleEditProjectExpenseDialog: () => set((state) => ({ editProjectExpenseDialog: !state.editProjectExpenseDialog })),

  // --- (Indicator) NEW: Generic Delete Confirmation Dialog Implementation ---
  deleteConfirmationDialog: false,
  setDeleteConfirmationDialog: (open: boolean) => set({ deleteConfirmationDialog: open }),
  toggleDeleteConfirmationDialog: () => set((state) => ({ deleteConfirmationDialog: !state.deleteConfirmationDialog })),

  // New WO Dialog Implementation
  newWODialog: false,
  setNewWODialog: (open: boolean) => {
    log('setNewWODialog:', open);
    set({ newWODialog: open });
  },
  toggleNewWODialog: () => set((state) => {
    log('toggleNewWODialog:', !state.newWODialog);
    return { newWODialog: !state.newWODialog };
  }),
}));