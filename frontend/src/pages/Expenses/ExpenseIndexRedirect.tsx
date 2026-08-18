// src/pages/Expenses/ExpenseIndexRedirect.tsx
//
// Where /expense lands, by role.
//
// TAB ORDER IS NOT LANDING ORDER. Expense Request became the first tab, but the landing page
// deliberately did not move with it: every role with Expense access has landed on Misc
// Project Expense since the module was unified, and relocating all of them is not something
// adding a tab should do quietly.
//
// A Project Manager is the exception, and not as a preference -- `ExpenseLayout` hides the
// two ledger tabs from them, so the historical default would drop a PM on a page they cannot
// see and cannot navigate away from within the module.

import React from "react";
import { Navigate } from "react-router-dom";
import { useUserData } from "@/hooks/useUserData";

const REQUESTS_ONLY_ROLES = ["Nirmaan Project Manager Profile"];

export const ExpenseIndexRedirect: React.FC = () => {
  const { role } = useUserData();

  // `useUserData` returns the literal "Loading" while the Nirmaan Users doc is in flight.
  // Redirecting then would send a PM to a ledger tab and leave them there, so hold.
  if (role === "Loading") return null;

  const to = REQUESTS_ONLY_ROLES.includes(role as string)
    ? "/expense/requests"
    : "/expense/project";

  return <Navigate to={to} replace />;
};

export default ExpenseIndexRedirect;
