// src/store/dialogStore.ts
import { create } from 'zustand';

export type DialogStore = {
  // Request Payment Dialog
  requestPaymentDialog: boolean;
  setRequestPaymentDialog: (open: boolean) => void;
  toggleRequestPaymentDialog: () => void;

  // Update Payment Dialog
  paymentDialog: boolean;
  setPaymentDialog: (open: boolean) => void;
  togglePaymentDialog: () => void;

  shareDialog: boolean;
  setShareDialog: (open: boolean) => void;
  toggleShareDialog: () => void;

  // New Inflow Dialog
  newInflowDialog: boolean;
  setNewInflowDialog: (open: boolean) => void;
  toggleNewInflowDialog: () => void;

  // New Invoice Dialog (assuming this is for a different "Invoice" type than ProjectInvoice)
  newInvoiceDialog: boolean;
  setNewInvoiceDialog: (open: boolean) => void;
  toggleNewInvoiceDialog: () => void;

  // New ProjectInvoice Dialog
  newProjectInvoiceDialog: boolean;
  setNewProjectInvoiceDialog: (open: boolean) => void;
  toggleNewProjectInvoiceDialog: () => void;

  // New Item Dialog
  newItemDialog: boolean;
  toggleNewItemDialog: () => void; // Consider adding a 'setNewItemDialog' for consistency

  // --- (Indicator) NEW: Non-Project Expense Dialog ---
  newNonProjectExpenseDialog: boolean;
  setNewNonProjectExpenseDialog: (open: boolean) => void;
  toggleNewNonProjectExpenseDialog: () => void;
  // --- (Explanation)
  // Added state and actions for the "New Non-Project Expense" dialog.
  // - `newNonProjectExpenseDialog`: Boolean to control its visibility.
  // - `setNewNonProjectExpenseDialog`: Function to explicitly set its state (open/closed).
  // - `toggleNewNonProjectExpenseDialog`: Function to toggle its current state.
};

export const useDialogStore = create<DialogStore>((set, get) => ({
  requestPaymentDialog: false,
  setRequestPaymentDialog: (open: boolean) => set({ requestPaymentDialog: open }),
  toggleRequestPaymentDialog: () => set((state) => ({ requestPaymentDialog: !state.requestPaymentDialog })), // Using state from set callback

  paymentDialog: false,
  setPaymentDialog: (open: boolean) => set({ paymentDialog: open }),
  togglePaymentDialog: () => set((state) => ({ paymentDialog: !state.paymentDialog })),

  shareDialog: false,
  setShareDialog: (open: boolean) => set({ shareDialog: open }),
  toggleShareDialog: () => set((state) => ({ shareDialog: !state.shareDialog })),

  newInflowDialog: false,
  setNewInflowDialog: (open: boolean) => set({ newInflowDialog: open }),
  toggleNewInflowDialog: () => set((state) => ({ newInflowDialog: !state.newInflowDialog })),

  newInvoiceDialog: false,
  setNewInvoiceDialog: (open: boolean) => set({ newInvoiceDialog: open }),
  toggleNewInvoiceDialog: () => set((state) => ({ newInvoiceDialog: !state.newInvoiceDialog })),

  newProjectInvoiceDialog: false,
  setNewProjectInvoiceDialog: (open: boolean) => set({ newProjectInvoiceDialog: open }),
  toggleNewProjectInvoiceDialog: () => set((state) => ({ newProjectInvoiceDialog: !state.newProjectInvoiceDialog })),

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
}));