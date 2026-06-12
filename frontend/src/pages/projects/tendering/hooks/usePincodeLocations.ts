import { useMemo } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

interface PincodeRow {
  city: string;
  state: string;
}

export interface LocationOption {
  label: string;
  value: string;
}

/**
 * Reads the `Pincodes` master and derives the distinct set of States and,
 * for a chosen State, the distinct set of Cities within it.
 *
 * Powers the cascading State -> City selector on the Tendering create form.
 * The Pincodes master (~19k rows, 36 states, up to ~80 cities per state) is
 * fetched once with city/state only; distinct values are computed client-side.
 */
export const usePincodeLocations = (selectedState?: string) => {
  const response = useFrappeGetDocList<PincodeRow>(
    "Pincodes",
    {
      fields: ["city", "state"],
      limit: 0,
    },
    ["tendering", "pincode-locations"]
  );

  useApiErrorLogger(response.error, {
    hook: "usePincodeLocations",
    api: "Pincodes List",
    feature: "tendering",
  });

  const rows = response.data;

  // Distinct, sorted States.
  const stateOptions: LocationOption[] = useMemo(() => {
    if (!rows) return [];
    const states = new Set<string>();
    rows.forEach((r) => {
      if (r.state) states.add(r.state);
    });
    return Array.from(states)
      .sort((a, b) => a.localeCompare(b))
      .map((s) => ({ label: s, value: s }));
  }, [rows]);

  // Distinct, sorted Cities within the selected State.
  const cityOptions: LocationOption[] = useMemo(() => {
    if (!rows || !selectedState) return [];
    const cities = new Set<string>();
    rows.forEach((r) => {
      if (r.state === selectedState && r.city) cities.add(r.city);
    });
    return Array.from(cities)
      .sort((a, b) => a.localeCompare(b))
      .map((c) => ({ label: c, value: c }));
  }, [rows, selectedState]);

  return {
    stateOptions,
    cityOptions,
    isLoading: response.isLoading,
    error: response.error,
  };
};
