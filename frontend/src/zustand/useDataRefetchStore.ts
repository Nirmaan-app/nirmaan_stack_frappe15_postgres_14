import { create } from 'zustand';

interface DataRefetchState {
  lastPrUpdate: number | null;
  lastSbUpdate: number | null;
  lastPoUpdate: number | null;
  lastSrUpdate: number | null;
  lastPaymentUpdate: number | null;
  lastNotificationUpdate: number | null;

  triggerPrRefetch: () => void;
  triggerSbRefetch: () => void;
  triggerPoRefetch: () => void;
  triggerSrRefetch: () => void;
  triggerPaymentRefetch: () => void;
  triggerNotificationRefetch: () => void;
}

export const useDataRefetchStore = create<DataRefetchState>((set) => ({
  lastPrUpdate: null,
  lastSbUpdate: null,
  lastPoUpdate: null,
  lastSrUpdate: null,
  lastPaymentUpdate: null,
  lastNotificationUpdate: null,

  triggerPrRefetch: () => set({ lastPrUpdate: Date.now() }),
  triggerSbRefetch: () => set({ lastSbUpdate: Date.now() }),
  triggerPoRefetch: () => set({ lastPoUpdate: Date.now() }),
  triggerSrRefetch: () => set({ lastSrUpdate: Date.now() }),
  triggerPaymentRefetch: () => set({ lastPaymentUpdate: Date.now() }),
  triggerNotificationRefetch: () => set({ lastNotificationUpdate: Date.now() }),
}));