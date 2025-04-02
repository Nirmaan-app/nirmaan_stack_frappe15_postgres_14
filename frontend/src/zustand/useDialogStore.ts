// src/store/dialogStore.ts
import { create } from 'zustand';

export type DialogStore = {
  requestPaymentDialog: boolean;
  setRequestPaymentDialog: (open: boolean) => void;
  toggleRequestPaymentDialog: () => void;
  shareDialog: boolean;
  setShareDialog: (open: boolean) => void;
  toggleShareDialog: () => void;
  newInflowDialog: boolean;
  setNewInflowDialog: (open: boolean) => void;
  toggleNewInflowDialog: () => void;
  newInvoiceDialog: boolean;
  setNewInvoiceDialog: (open: boolean) => void;
  toggleNewInvoiceDialog: () => void;
};

export const useDialogStore = create<DialogStore>((set, get) => ({
  requestPaymentDialog: false,
  setRequestPaymentDialog: (open: boolean) => set({ requestPaymentDialog: open }),
  toggleRequestPaymentDialog: () => set({ requestPaymentDialog: !get().requestPaymentDialog }),
  shareDialog: false,
  setShareDialog: (open: boolean) => set({ shareDialog: open }),
  toggleShareDialog: () => set({ shareDialog: !get().shareDialog }),
  newInflowDialog: false,
  setNewInflowDialog: (open: boolean) => set({ newInflowDialog: open }),
  toggleNewInflowDialog: () => set({ newInflowDialog: !get().newInflowDialog }),
  newInvoiceDialog: false,
  setNewInvoiceDialog: (open: boolean) => set({ newInvoiceDialog: open }),
  toggleNewInvoiceDialog: () => set({ newInvoiceDialog: !get().newInvoiceDialog }),
}));
