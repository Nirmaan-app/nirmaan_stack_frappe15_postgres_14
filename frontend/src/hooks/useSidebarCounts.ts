/* ------------------------------------------------------------------
   useSidebarCounts  –  single GET for all counters
   ------------------------------------------------------------------ */
import { useFrappeGetCall } from "frappe-react-sdk";
import { SidebarCountsData, useDocCountStore } from "@/zustand/useDocCountStore";
import React from "react";
import { create } from "zustand";

export const API_PATH =
  "nirmaan_stack.api.sidebar_counts.sidebar_counts";

/** Centralised SWR key */
export const getSidebarCountsKey = (user: string) =>
  `sidebar_counts_${user}`;

// Zustand store to capture the SWR mutate function from frappe-react-sdk
interface CountsMutateStore {
  triggerUpdate: () => void;
  setTrigger: (fn: () => void) => void;
}

const useCountsMutateStore = create<CountsMutateStore>((set) => ({
  triggerUpdate: () => console.warn("[SidebarCounts] triggerUpdate called before useCountsBridge mounted!"),
  setTrigger: (fn) => set({ triggerUpdate: fn }),
}));

export const useSidebarCounts = (user: string | null | undefined) => {
  // Using GET request to avoid CSRF token issues on initial page load
  const { data: rawData, isLoading, error, mutate } = useFrappeGetCall<{ message: string }>(
    API_PATH,
    user ? { user } : undefined,
    user ? getSidebarCountsKey(user) : null,
    {
      revalidateOnFocus: true,
      refreshInterval: 1000 * 60 * 2, // 2-minute auto refresh
    }
  );

  // Parse the response - backend returns JSON string
  const data: SidebarCountsData | undefined = React.useMemo(() => {
    if (!rawData?.message) return undefined;
    return typeof rawData.message === "string"
      ? JSON.parse(rawData.message)
      : rawData.message;
  }, [rawData]);

  return { data, isLoading, error, mutate };
};

/* ---- Zustand bridge ------------------------------------------- */
export const useCountsBridge = (user: string | null | undefined) => {
  const { setAll } = useDocCountStore(s => s);
  const { data, isLoading, error, mutate } = useSidebarCounts(user);

  // Capture the mutate function so it can be called from anywhere
  React.useEffect(() => {
    useCountsMutateStore.getState().setTrigger(() => {
      mutate();
    });
  }, [mutate]);

  React.useEffect(() => {
    if (data) setAll(data);
  }, [data, setAll]);

  return { data, isLoading, error };
};

/* ---- Standalone invalidation (not a hook — safe anywhere) ----- */
/**
 * Call after any status-changing mutation to immediately refresh
 * sidebar counts. It uses the captured SWR mutate inside the provider.
 */
export const invalidateSidebarCounts = () => {
  useCountsMutateStore.getState().triggerUpdate();
};