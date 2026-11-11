import { useCallback, useEffect, useState } from "react";

import { urlStateManager } from "@/utils/urlStateManager";

/**
 * One URL parameter as React state, kept in sync both ways through `urlStateManager` (the pattern the
 * Financials tab uses for `fTab`). `null` removes the parameter.
 */
export function useUrlParamState(key: string): [string | null, (value: string | null) => void] {
  const [value, setValue] = useState<string | null>(() => urlStateManager.getParam(key));

  useEffect(() => urlStateManager.subscribe(key, (_, next) => setValue(next ?? null)), [key]);

  const update = useCallback(
    (next: string | null) => {
      setValue(next);
      if (urlStateManager.getParam(key) !== next) urlStateManager.updateParam(key, next);
    },
    [key],
  );
  return [value, update];
}
