import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { debounce } from "lodash";
import type { InventoryPickerItem } from "../types";

interface PickerResponse {
  message: InventoryPickerItem[];
}

/**
 * Fetches inventory picker data with a 300ms debounced search term.
 *
 * The `search` param is routed to the backend so server-side filtering is
 * authoritative — we do not filter client-side a second time.
 */
export function useInventoryPickerData(searchTerm: string) {
  const [debounced, setDebounced] = useState("");

  const debouncedSetter = useMemo(
    () => debounce((term: string) => setDebounced(term), 300),
    []
  );

  useEffect(() => {
    debouncedSetter(searchTerm.trim());
    return () => {
      debouncedSetter.cancel();
    };
  }, [searchTerm, debouncedSetter]);

  const params = useMemo(
    () => (debounced ? { search: debounced } : {}),
    [debounced]
  );

  const { data, isLoading, error, mutate } = useFrappeGetCall<PickerResponse>(
    "nirmaan_stack.api.internal_transfers.get_inventory_picker_data.get_inventory_picker_data",
    params
  );

  return {
    items: (data?.message ?? []) as InventoryPickerItem[],
    isLoading,
    error,
    refetch: mutate,
  };
}
