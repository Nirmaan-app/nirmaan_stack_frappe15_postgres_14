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

  // New Invoice Dialog
  newInvoiceDialog: boolean;
  setNewInvoiceDialog: (open: boolean) => void;
  toggleNewInvoiceDialog: () => void;

  // New Item Dialog
  newItemDialog: boolean;
  toggleNewItemDialog: () => void;
};

export const useDialogStore = create<DialogStore>((set, get) => ({
  requestPaymentDialog: false,
  setRequestPaymentDialog: (open: boolean) => set({ requestPaymentDialog: open }),
  toggleRequestPaymentDialog: () => set({ requestPaymentDialog: !get().requestPaymentDialog }),

  paymentDialog: false,
  setPaymentDialog: (open: boolean) => set({ paymentDialog: open }),
  togglePaymentDialog: () => set({ paymentDialog: !get().paymentDialog }),

  shareDialog: false,
  setShareDialog: (open: boolean) => set({ shareDialog: open }),
  toggleShareDialog: () => set({ shareDialog: !get().shareDialog }),
  newInflowDialog: false,


  setNewInflowDialog: (open: boolean) => set({ newInflowDialog: open }),
  toggleNewInflowDialog: () => set({ newInflowDialog: !get().newInflowDialog }),

  
  newInvoiceDialog: false,
  setNewInvoiceDialog: (open: boolean) => set({ newInvoiceDialog: open }),
  toggleNewInvoiceDialog: () => set({ newInvoiceDialog: !get().newInvoiceDialog }),

  // New Item Dialog
  newItemDialog: false,
  toggleNewItemDialog: () => set({ newItemDialog: !get().newItemDialog }),
}));
