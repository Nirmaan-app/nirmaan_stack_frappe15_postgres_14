import { useEffect, useRef, useState } from "react";

/**
 * True once `isLoading` has gone from true back to false at least once.
 *
 * A list page shows its skeleton only until this turns true. Gating the skeleton on
 * `isLoading && !rows.length` instead swaps the whole DataTable out on every refetch that
 * starts from an empty result (a search with no match, then one more keystroke), which
 * unmounts the search box and drops the user's cursor.
 */
export function useHasLoadedOnce(isLoading: boolean): boolean {
  const [hasLoaded, setHasLoaded] = useState(false);
  const sawLoading = useRef(isLoading);

  useEffect(() => {
    if (isLoading) sawLoading.current = true;
    else if (sawLoading.current) setHasLoaded(true);
  }, [isLoading]);

  return hasLoaded;
}
