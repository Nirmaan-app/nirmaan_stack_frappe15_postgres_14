/**
 * FinanceActionTabs — the accountant's tabbed "actions" section of the Action Center.
 *
 * The finance counterpart to ActionTabs (the PM's All / DPR / DN / DC). SAME shape — the
 * shared `StatTab` tabs + a list under the active tab — but the tabs are
 * Expenses / Payments / Invoices, and each list row navigates to the EXISTING page to act
 * (mark-paid / pay / approve). No action logic is re-implemented here.
 *
 * The Expenses tab MERGES the two expense doctypes (`Project Expenses` + `Non Project
 * Expenses`); each row carries a `tag` ("Project" / "Non-Project") so they stay
 * distinguishable and route to the right page. Payments / Invoices tag PO vs SR.
 *
 * Items are GROUPED BY PROJECT into collapsible accordions to keep the list scannable.
 *
 * Data is fetched via a single optimized backend API `get_pending_finance_items` 
 * to eliminate frontend joining/mapping overhead.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetCall } from "frappe-react-sdk";
import { ChevronRight, ChevronDown } from "lucide-react";
import { StatTab } from "./ActionTabs";

type FinanceTab = "all" | "expenses" | "payments" | "invoices";

interface FinanceItem {
  key: string;
  category: string; // Expense / Payment / Invoice — shown as the badge on the "All" tab
  tag: string; // finer sub-type — Project / Non-Project / PO / SR (badge on a specific tab)
  title: string;
  subtitle?: string;
  amount?: number | string;
  amount_str?: string;
  linkTo: string;
  project?: string;
}

interface FinanceResponse {
  counts: {
    all: number;
    expenses: number;
    payments: number;
    invoices: number;
  };
  groups: {
    all: [string, FinanceItem[]][];
    expenses: [string, FinanceItem[]][];
    payments: [string, FinanceItem[]][];
    invoices: [string, FinanceItem[]][];
  };
}

export function FinanceActionTabs() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<FinanceTab>("all");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const { data, isLoading, error } = useFrappeGetCall<{ message: FinanceResponse }>(
    "nirmaan_stack.api.action_items.finance.get_pending_finance_items",
    undefined,
    "ac-fin-unified"
  );

  const toggleGroup = (grp: string) => {
    setOpenGroups((prev) => ({ ...prev, [grp]: !prev[grp] }));
  };

  const counts = data?.message?.counts || { all: 0, expenses: 0, payments: 0, invoices: 0 };
  const groupedItems = data?.message?.groups?.[tab] || [];

  return (
    <>
      {/* Finance category tabs */}
      <div className="mb-4 grid grid-cols-4 gap-2">
        <StatTab label="All" count={counts.all} dot="bg-red-500" active={tab === "all"} onClick={() => setTab("all")} />
        <StatTab label="Expenses" count={counts.expenses} dot="bg-blue-500" active={tab === "expenses"} onClick={() => setTab("expenses")} />
        <StatTab label="Payments" count={counts.payments} dot="bg-emerald-500" active={tab === "payments"} onClick={() => setTab("payments")} />
        <StatTab label="Invoices" count={counts.invoices} dot="bg-amber-500" active={tab === "invoices"} onClick={() => setTab("invoices")} />
      </div>

      <hr className="mb-4 border-gray-200" />

      {error ? (
        <p className="text-sm text-destructive">Couldn&rsquo;t load finance actions.</p>
      ) : isLoading && counts.all === 0 ? (
        <div className="space-y-2">
          <div className="h-12 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-12 animate-pulse rounded-lg bg-gray-100" />
        </div>
      ) : counts[tab] === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
          All clear — nothing pending here.
        </p>
      ) : (
        <div className="space-y-4">
          {groupedItems.map(([projectName, items]) => {
            const expanded = openGroups[projectName] ?? true; 
            return (
              <div
                key={projectName}
                className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm ring-1 ring-transparent transition-all hover:border-gray-300 hover:shadow-md"
              >
                <button
                  onClick={() => toggleGroup(projectName)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3.5 p-2 text-left transition-colors hover:bg-gray-50/70"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 text-lg font-bold uppercase text-white shadow-sm">
                    {projectName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold text-gray-900">
                      {projectName}
                    </h3>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500" />
                      {items.length} pending
                    </p>
                  </div>
                  {expanded ? (
                    <ChevronDown className="mr-1 h-5 w-5 shrink-0 text-gray-400" />
                  ) : (
                    <ChevronRight className="mr-1 h-5 w-5 shrink-0 text-gray-400" />
                  )}
                </button>

                {expanded && (
                  <div className="space-y-1.5 border-t border-gray-100 bg-gray-50/50 p-2">
                    {items.map((it) => (
                      <button
                        key={it.key}
                        onClick={() => navigate(it.linkTo)}
                        className="group flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white p-2.5 text-left shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-gray-600">
                              {tab === "all" ? it.category : it.tag}
                            </span>
                            <span className="min-w-0 truncate text-xs font-semibold text-gray-900">
                              {it.title}
                            </span>
                          </div>
                          {it.subtitle && (
                            <p className="mt-0.5 truncate text-[11px] text-sky-600">
                              {it.subtitle}
                            </p>
                          )}
                        </div>
                        {it.amount_str && (
                          <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-700">
                            {it.amount_str}
                          </span>
                        )}
                        <ChevronRight className="h-4 w-4 shrink-0 text-indigo-400 transition-transform group-hover:translate-x-0.5" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default FinanceActionTabs;

