// src/store/dialogStore.ts
import { create } from 'zustand';

export type DialogStore = {
  requestPaymentDialog: boolean;
  setRequestPaymentDialog: (open: boolean) => void;
  toggleRequestPaymentDialog: () => void;
  shareDialog: boolean;
  setShareDialog: (open: boolean) => void;
  toggleShareDialog: () => void;
};

export const useDialogStore = create<DialogStore>((set, get) => ({
  requestPaymentDialog: false,
  setRequestPaymentDialog: (open: boolean) => set({ requestPaymentDialog: open }),
  toggleRequestPaymentDialog: () => set({ requestPaymentDialog: !get().requestPaymentDialog }),
  shareDialog: false,
  setShareDialog: (open: boolean) => set({ shareDialog: open }),
  toggleShareDialog: () => set({ shareDialog: !get().shareDialog }),
}));
