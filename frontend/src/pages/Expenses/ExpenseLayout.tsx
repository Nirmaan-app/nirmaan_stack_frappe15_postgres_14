// src/pages/Expenses/ExpenseLayout.tsx
//
// Unified "Expense" module shell. Renders a page-level pill tab strip (Misc
// Project Expense / Non-Project Expense) above an <Outlet />. The active tab is
// the primary button color (red) with white text; inactive tabs are gray with
// dark text — same style as the status pills (Requested/Approved/Paid) below, so
// the active tab reads clearly. Each tab is its own URL (/expense/project,
// /expense/non-project) so the active tab is derived from the URL and deep-links
// / refreshes land on the right tab. The right-action button
// (renderRightActionButton) keys off the same sub-route to show the matching
// creation dialog.

import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useFrappeGetDocCount } from "frappe-react-sdk";

const ExpenseLayout: React.FC = () => {
  const { pathname } = useLocation();

  const { data: projectCount } = useFrappeGetDocCount("Project Expenses", undefined);
  const { data: nonProjectCount } = useFrappeGetDocCount("Non Project Expenses", undefined);

  const tabs: { label: string; to: string; count?: number }[] = [
    { label: "Misc Project Expense", to: "/expense/project", count: projectCount },
    { label: "Non-Project Expense", to: "/expense/non-project", count: nonProjectCount },
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
