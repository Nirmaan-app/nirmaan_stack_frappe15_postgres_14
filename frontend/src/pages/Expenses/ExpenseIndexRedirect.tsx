// src/pages/Expenses/ExpenseIndexRedirect.tsx
//
// Where /expense lands: Expense Request, for every role.
//
// It used to land on Misc Project Expense (a PM alone went to Requests). Since 17 Sep 2026
// ExpenseLayout hides the two ledger tabs from everyone, so that default would drop the
// sidebar click on a page with no visible tab of its own.

import React from "react";
import { Navigate } from "react-router-dom";

export const ExpenseIndexRedirect: React.FC = () => <Navigate to="/expense/requests" replace />;

export default ExpenseIndexRedirect;
