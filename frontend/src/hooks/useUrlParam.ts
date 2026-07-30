import { urlStateManager } from "@/utils/urlStateManager";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

// src/hooks/useUrlParam.ts
export const useUrlParam = (key: string) => {
  // react-router's location changes on every navigate()/Link/router back-forward.
  const location = useLocation();

  const [paramValue, setParamValue] = useState<string | null>(
    new URLSearchParams(window.location.search).get(key)
  );

  // Re-read the param on react-router navigations. navigate() changes the URL via
  // history.pushState, which fires no popstate and does not go through urlStateManager,
  // so the subscription below would otherwise miss it. Without this, a dispatcher that
  // switches its rendered component on ?tab / ?mode (RenderProcurementRequest,
  // RenderSentBackComponent, ...) keeps a stale value after a navigate() and only
  // corrects on a manual refresh. This used to be masked by the error boundary's
  // per-navigation remount, removed in d2b2dc14.
  useEffect(() => {
    setParamValue(new URLSearchParams(location.search).get(key));
  }, [key, location.search]);

  // Still needed for urlStateManager.updateParam (replaceState-based filter/pagination
  // writes that react-router's location does not observe) and its popstate handling.
  useEffect(() => {
    return urlStateManager.subscribe(key, (_, value) => {
      setParamValue(value);
    });
  }, [key]);

  return paramValue;
};