import { useCallback } from "react";

import { useUrlParam } from "@/hooks/useUrlParam";
import { urlStateManager } from "@/utils/urlStateManager";

/**
 * One URL parameter as React state plus a setter. Reads through the app's `useUrlParam`, which also re-reads the
 * parameter on react-router navigations (navigate() / Link), so a link into the Estimates tab is never shown with
 * stale values (review issue 7). Writes through `urlStateManager` (the pattern the Financials tab uses for `fTab`),
 * which notifies `useUrlParam`. `null` removes the parameter.
 */
export function useUrlParamState(key: string): [string | null, (value: string | null) => void] {
  const value = useUrlParam(key);
  const update = useCallback(
    (next: string | null) => {
      if (urlStateManager.getParam(key) !== next) urlStateManager.updateParam(key, next);
    },
    [key],
  );
  return [value, update];
}
