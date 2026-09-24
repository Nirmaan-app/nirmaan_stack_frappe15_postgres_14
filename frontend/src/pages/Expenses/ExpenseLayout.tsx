// src/pages/Expenses/ExpenseLayout.tsx
//
// Unified "Expense" module shell. Now a bare <Outlet /> -- it renders no chrome of its own.
//
// ⚠️ THE TAB STRIP IS GONE (owner, 23 Sep 2026), not hidden behind a flag. It had been down
// to ONE button since 17 Sep, when the Misc Project / Non-Project tabs were hidden for every
// role: a lone red "Expense Request" pill that was always active and navigated to the page
// you were already on. A tab strip of one is a control that cannot do anything.
//
// HIDDEN ≠ DELETED still holds for the ROUTES: /expense/project and /expense/non-project
// resolve exactly as before (routesConfig.tsx), so dashboard cards, bookmarks and deep links
// keep working. Only the buttons are gone.
//
// Restoring the strip is git history -- it was a `tabs` array of { label, to, count } mapped
// to <Link>s, styled like the status pills below it (active = bg-primary/white). Bring back
// the useCounts batch with it if the counts are wanted.
//
// The right-action button ("Raise Expense Request") is UNAFFECTED: it lives in
// components/helpers/renderRightActionButton.tsx and keys off the sub-route, not off this
// file. It is the only entry point for creating a request.

import React from "react";
import { Outlet } from "react-router-dom";

const ExpenseLayout: React.FC = () => (
  <div className="flex flex-col gap-3">
    <Outlet />
  </div>
);

export default ExpenseLayout;
