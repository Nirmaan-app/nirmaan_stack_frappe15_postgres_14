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
import { useCounts } from "@/hooks/useCounts";
import { useUserData } from "@/hooks/useUserData";

// A Project Manager reaches this module ONLY to raise expense requests -- the Expense
// sidebar entry was opened to them for that alone, so the two ledger tabs stay hidden.
const REQUESTS_ONLY_ROLES = ["Nirmaan Project Manager Profile"];

const ExpenseLayout: React.FC = () => {
  const { pathname } = useLocation();
  const { role } = useUserData();
  const requestsOnly = REQUESTS_ONLY_ROLES.includes(role as string);

  // Both tab totals (global, no filters) in ONE batch round-trip via useCounts.
  const { data: countsData } = useCounts(
    [
      { key: "project", doctype: "Project Expenses" },
      { key: "nonProject", doctype: "Non Project Expenses" },
    ],
    "expense_layout_tab_counts"
  );
  const projectCount = countsData?.message?.project as number | undefined;
  const nonProjectCount = countsData?.message?.nonProject as number | undefined;

  // Expense Request sits FIRST (owner ruling). It carries NO count badge: the other two are
  // whole-table totals, while a request list is scoped per viewer (own + routed), so one
  // global number would be wrong for everyone who is not an Admin.
  const tabs: { label: string; to: string; count?: number }[] = [
    { label: "Expense Request", to: "/expense/requests" },
    ...(requestsOnly
      ? []
      : [
          { label: "Misc Project Expense", to: "/expense/project", count: projectCount },
          { label: "Non-Project Expense", to: "/expense/non-project", count: nonProjectCount },
        ]),
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
