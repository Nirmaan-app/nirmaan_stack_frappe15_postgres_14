// src/pages/Expenses/ExpenseLayout.tsx
//
// Unified "Expense" module shell. Renders a page-level pill tab strip (now only
// Expense Request -- see the note below) above an <Outlet />. The active tab is
// the primary button color (red) with white text; inactive tabs are gray with
// dark text — same style as the status pills (Requested/Approved/Paid) below, so
// the active tab reads clearly. Each tab is its own URL (/expense/project,
// /expense/non-project) so the active tab is derived from the URL and deep-links
// / refreshes land on the right tab. The right-action button
// (renderRightActionButton) keys off the same sub-route to show the matching
// creation dialog.

import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

const ExpenseLayout: React.FC = () => {
  const { pathname } = useLocation();

  // Misc Project Expense / Non-Project Expense tabs HIDDEN for every role (owner, 17 Sep 2026);
  // before that only a Project Manager had them hidden. HIDDEN, NOT DELETED: /expense/project
  // and /expense/non-project still resolve (routesConfig.tsx), so dashboard cards, bookmarks
  // and deep links keep working -- only the tab buttons (and their count query) are gone.
  // Restoring them is putting the two entries back here along with the useCounts batch.
  const tabs: { label: string; to: string; count?: number }[] = [
    { label: "Expense Request", to: "/expense/requests" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
        <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0" aria-label="Expense sections">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.to);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  isActive
                    ? "bg-primary text-white font-semibold"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium"
                }`}
              >
                {tab.label}
                {typeof tab.count === "number" && (
                  <span
                    className={`text-xs font-bold ${
                      isActive ? "opacity-90" : "opacity-70"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
      <Outlet />
    </div>
  );
};

export default ExpenseLayout;
