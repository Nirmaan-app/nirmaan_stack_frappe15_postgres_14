import { useFrappeGetCall } from "frappe-react-sdk";

import type { RefetchRef } from "@/hooks/usePublishRefetch";

import AllPayments from "../AllPayments";
import {
  APPROVAL_COUNTS_API,
  APPROVAL_COUNTS_SWR_KEY,
  BY_ME_VIEW_OPTIONS,
  ByMeCountsMessage,
  byMeViewCounts,
} from "../config/approvalsTable.config";
import { PP_TABS } from "../config/ppTabs.constants";
import { useByMeView } from "../hooks/useByMeView";

/**
 * "Payment Raised By Me" with its three views (2026-11-12): All (the tab as before), Paid and Rejected, each
 * with its count. Still the viewer's own rows only (the server scopes the tab). Each view is its own table,
 * remounted on a switch, so its filters, search and page stay its own.
 *
 * The view buttons are drawn like the page's own tab buttons (`RenderProjectPaymentsComponent.renderTabButton`:
 * separate rounded buttons, grey at rest, the count in bold beside the label), with the selected one in the app's
 * red (`bg-primary`) so the view row reads as a level under the blue tab row (owner, 2026-11-12).
 */
export const ByMeViews = ({ refetchRef }: { refetchRef?: RefetchRef }) => {
  const [view, setView] = useByMeView();
  // The page's badge fetch (same SWR key), so this costs no extra request and refreshes with the badges.
  const { data } = useFrappeGetCall<{ message: ByMeCountsMessage }>(
    APPROVAL_COUNTS_API,
    undefined,
    APPROVAL_COUNTS_SWR_KEY,
  );
  const counts = byMeViewCounts(data?.message);

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Payment Raised By Me views" className="flex flex-wrap items-center gap-1.5">
        {BY_ME_VIEW_OPTIONS.map((o) => {
          const isActive = view === o.value;
          const count = counts[o.value];
          return (
            <button
              key={o.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setView(o.value)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-xs transition-colors sm:px-3 sm:py-1.5 sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-muted dark:text-muted-foreground dark:hover:bg-muted/80"
              }`}
            >
              {o.label}
              {count !== undefined && (
                <span className={`text-xs font-bold ${isActive ? "opacity-90" : "opacity-70"}`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>
      <AllPayments key={view} tab={PP_TABS.PAYMENT_BY_ME} byMeView={view} refetchRef={refetchRef} />
    </div>
  );
};

export default ByMeViews;
