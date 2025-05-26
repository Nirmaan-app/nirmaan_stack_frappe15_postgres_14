/* ------------------------------------------------------------------
   useSidebarCounts  –  single GET for all counters
   ------------------------------------------------------------------ */
import useSWR from "swr";
import { useFrappePostCall } from "frappe-react-sdk";
import { SidebarCountsData, useDocCountStore } from "@/zustand/useDocCountStore";
import React from "react";

export const API_PATH =
  "nirmaan_stack.api.sidebar_counts.sidebar_counts";

export const useSidebarCounts = (user: string | null | undefined) => {
  const { call } = useFrappePostCall<{ message: string }>(API_PATH);

  const fetcher = async ([, usr]: [string, string]): Promise<SidebarCountsData> => {
    const res = await call({ user: usr });
    const data = typeof res.message === "string" ? JSON.parse(res.message) : res.message;
    return data as SidebarCountsData;
  };

  return useSWR<SidebarCountsData>(user ? [API_PATH, user] : null, fetcher, {
    revalidateOnFocus: false,
    refreshInterval  : 1000 * 60 * 5,   // 5-minute auto refresh
  });
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