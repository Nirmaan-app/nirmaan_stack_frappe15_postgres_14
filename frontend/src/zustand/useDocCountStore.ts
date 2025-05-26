import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface sbType {
    all: number;
    pending: number;
}

export interface SidebarCountsData {
    po: {
        "all": number;
        "PO Approved": number;
        "Dispatched": number;
        "Partially Delivered": number;
        "Delivered": number;
        "Merged": number;
        "PO Amendment": number;

    }
    pr: {
        all: number;
        pending: number;
        rejected: number;
        approved: number;
        in_progress: number;
        approve: number; // vendor selected or partially approved with pending items
        vendor_approved: number;
        delayed: number;
        sent_back: number;
    };
    sb: {
        all: number;
        approve: number; // vendor selected or partially approved with pending items
        rejected: sbType;
        delayed: sbType;
        cancelled: sbType;
        pending: number;
        sent_back: number;
    };
    sr: {
        selected: number;
        approved: number;
        amended: number;
        all: number;
        pending: number;
    };
    pay: {
        all: number;
        requested: number;
        approved: number;
        rejected: number;
        paid: number;
    };
}

interface Store {
  counts: SidebarCountsData;
  setAll: (c: SidebarCountsData) => void;
}

export const useDocCountStore = create<Store>()(
  persist(
    (set) => ({
      counts: {
        po: {
            "all": 0,
            "PO Approved": 0,
            "Dispatched": 0,
            "Partially Delivered": 0,
            "Delivered": 0,
            "Merged": 0,
            "PO Amendment": 0,
        },
        pr: {
            all: 0,
            pending: 0,
            rejected: 0,
            approved: 0,
            in_progress: 0,
            approve: 0, // vendor selected or partially approved with pending items
            vendor_approved: 0,
            delayed: 0,
            sent_back: 0,
        },
        sb: {
            all: 0,
            approve: 0, // vendor selected or partially approved with pending items
            rejected: 0,
            delayed: 0,
            cancelled: 0,
            pending: 0,
            sent_back: 0,
        },
        sr: {
            selected: 0,
            approved: 0,
            amended: 0,
            all: 0,
            pending: 0,
        },
        pay: {
            all: 0,
            requested: 0,
            approved: 0,
            rejected: 0,
            paid: 0,
        },
      },
      setAll: (c) => set({ counts: c }),
    }),
    {
      name: "docCounts", storage: createJSONStorage(()=>sessionStorage),
    }
  )
);