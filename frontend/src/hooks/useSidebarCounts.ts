/* ------------------------------------------------------------------
   useSidebarCounts  –  single GET for all counters
   ------------------------------------------------------------------ */
import { useFrappeGetCall } from "frappe-react-sdk";
import { SidebarCountsData, useDocCountStore } from "@/zustand/useDocCountStore";
import React from "react";

export const API_PATH =
  "nirmaan_stack.api.sidebar_counts.sidebar_counts";

export const useSidebarCounts = (user: string | null | undefined) => {
  // Using GET request to avoid CSRF token issues on initial page load
  const { data: rawData, isLoading, error, mutate } = useFrappeGetCall<{ message: string }>(
    API_PATH,
    user ? { user } : undefined,
    user ? `sidebar_counts_${user}` : null,
    {
      revalidateOnFocus: false,
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
  const { data, isLoading, error }   = useSidebarCounts(user);

  React.useEffect(() => {
    if (data) setAll(data);
  }, [data, setAll]);

  return { data, isLoading, error };
};