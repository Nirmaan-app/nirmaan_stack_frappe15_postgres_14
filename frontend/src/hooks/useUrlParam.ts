import { urlStateManager } from "@/utils/urlStateManager";
import { useEffect, useState } from "react";

// src/hooks/useUrlParam.ts
export const useUrlParam = (key: string) => {
  const [paramValue, setParamValue] = useState<string | null>(
    new URLSearchParams(window.location.search).get(key)
  );

  useEffect(() => {
    return urlStateManager.subscribe(key, (_, value) => {
      setParamValue(value);
    });
  }, [key]);

  return paramValue;
};