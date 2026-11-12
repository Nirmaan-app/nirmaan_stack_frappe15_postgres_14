import { useCallback, useEffect, useState } from "react";

import { urlStateManager } from "@/utils/urlStateManager";

import { BY_ME_VIEW_PARAM, BY_ME_VIEWS, ByMeView, parseByMeView } from "../config/approvalsTable.config";

/**
 * The open view of "Payment Raised By Me" (All / Paid / Rejected), kept in the page's `?by_me_view=` param so a
 * bookmark, a shared link or a reload opens the same view. Like the page's tabs, a switch REPLACES the history
 * entry (`urlStateManager.updateParam`), so Back leaves the page rather than stepping through views (checked in
 * the browser, 2026-11-12). All is written as no param at all, which is how every link to the tab looked
 * before the views existed.
 *
 * ⚠️ THE PARAM LIVES ONLY WHILE THE TAB IS OPEN. Leaving the tab unmounts this hook, which removes the param, so
 * another tab's link never carries it and coming back to the tab opens All (review 2026-11-12). The view is
 * written back on every mount, so a remount (React StrictMode in dev runs mount, cleanup, mount) keeps it.
 */
export const useByMeView = (): [ByMeView, (view: ByMeView) => void] => {
  const [view, setViewState] = useState<ByMeView>(() => parseByMeView(urlStateManager.getParam(BY_ME_VIEW_PARAM)));

  useEffect(
    () => urlStateManager.subscribe(BY_ME_VIEW_PARAM, (_, value) => setViewState(parseByMeView(value))),
    [],
  );

  // The URL follows the view: written on mount and on every switch, removed when the tab unmounts.
  useEffect(() => {
    urlStateManager.updateParam(BY_ME_VIEW_PARAM, view === BY_ME_VIEWS.ALL ? null : view);
  }, [view]);
  useEffect(() => () => urlStateManager.updateParam(BY_ME_VIEW_PARAM, null), []);

  const setView = useCallback((next: ByMeView) => setViewState(next), []);

  return [view, setView];
};
