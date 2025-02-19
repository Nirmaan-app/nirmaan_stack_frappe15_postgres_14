// src/store/dialogStore.ts
import { create } from 'zustand';

export type DialogStore = {
  requestPaymentDialog: boolean;
  setRequestPaymentDialog: (open: boolean) => void;
  toggleRequestPaymentDialog: () => void;
};

export const useDialogStore = create<DialogStore>((set, get) => ({
  requestPaymentDialog: false,
  setRequestPaymentDialog: (open: boolean) => set({ requestPaymentDialog: open }),
  toggleRequestPaymentDialog: () => set({ requestPaymentDialog: !get().requestPaymentDialog }),
}));
