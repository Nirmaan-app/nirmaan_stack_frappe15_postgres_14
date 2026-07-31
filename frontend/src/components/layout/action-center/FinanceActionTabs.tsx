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
 * NO fixed-height inner scroll — the whole Action Center panel scrolls (the shell's aside is
 * a viewport-bounded sticky rail on xl), so the list grows naturally.
 *
 * Data via `useFrappeGetDocList` on the live doctypes (accountants are unscoped → see all);
 * tab counts are the list lengths. Invoices use `Vendor Invoices` status "Pending" (the live
 * source, not the deprecated `Task`/po_invoice_approval the dashboard stat card still uses).
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ChevronRight } from "lucide-react";
import { StatTab } from "./ActionTabs";

type FinanceTab = "all" | "expenses" | "payments" | "invoices";

interface FinanceItem {
  key: string;
  category: string; // Expense / Payment / Invoice — shown as the badge on the "All" tab
  tag: string; // finer sub-type — Project / Non-Project / PO / SR (badge on a specific tab)
  title: string;
  subtitle?: string;
  amount?: number | string;
  linkTo: string;
}

const rupee = (n?: number | string) => {
  const val = typeof n === "number" ? n : typeof n === "string" ? parseFloat(n) : NaN;
  return !isNaN(val)
    ? "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(val)
    : "";
};

// "Procurement Orders" → PO, "Service Requests" → SR (the two ALLOWED_DOCS).
const poSr = (docType?: string) => (docType === "Service Requests" ? "SR" : "PO");

export function FinanceActionTabs() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<FinanceTab>("all");

  // Four live-doctype list queries (accountants see all — no project scoping).
  const { data: pe, isLoading: peLoading, error: peErr } = useFrappeGetDocList<
    Record<string, any>
  >(
    "Project Expenses",
    {
      fields: ["name", "type", "description", "amount", "vendor", "projects"],
      filters: [["status", "=", "Approved"]],
      limit: 0,
    },
    "ac-fin-project-expenses"
  );
  const { data: npe } = useFrappeGetDocList<Record<string, any>>(
    "Non Project Expenses",
    {
      fields: ["name", "type", "description", "amount"],
      filters: [["status", "=", "Approved"]],
      limit: 0,
    },
    "ac-fin-nonproject-expenses"
  );
  const { data: pp } = useFrappeGetDocList<Record<string, any>>(
    "Project Payments",
    {
      fields: ["name", "document_type", "document_name", "amount", "vendor", "project"],
      filters: [["status", "=", "Approved"]],
      limit: 0,
    },
    "ac-fin-project-payments"
  );
  const { data: vi } = useFrappeGetDocList<Record<string, any>>(
    "Vendor Invoices",
    {
      fields: [
        "name",
        "invoice_no",
        "invoice_amount",
        "vendor",
        "project",
        "document_type",
        "document_name",
      ],
      filters: [["status", "=", "Pending"]],
      limit: 0,
    },
    "ac-fin-vendor-invoices"
  );

  const expenses = useMemo<FinanceItem[]>(
    () => [
      ...(pe ?? []).map((e) => ({
        key: `pe-${e.name}`,
        category: "Expense",
        tag: "Project",
        title: e.type || e.description || e.name,
        subtitle: e.vendor || e.projects || undefined,
        amount: e.amount,
        linkTo: "/expense/project",
      })),
      ...(npe ?? []).map((e) => ({
        key: `npe-${e.name}`,
        category: "Expense",
        tag: "Non-Project",
        title: e.type || e.description || e.name,
        subtitle: e.description || undefined,
        amount: e.amount,
        linkTo: "/expense/non-project",
      })),
    ],
    [pe, npe]
  );

  const payments = useMemo<FinanceItem[]>(
    () =>
      (pp ?? []).map((p) => ({
        key: p.name,
        category: "Payment",
        tag: poSr(p.document_type),
        title: p.document_name || p.name,
        subtitle: p.vendor || undefined,
        amount: p.amount,
        linkTo: `/project-payments/${encodeURIComponent(p.name)}`,
      })),
    [pp]
  );

  const invoices = useMemo<FinanceItem[]>(
    () =>
      (vi ?? []).map((v) => ({
        key: v.name,
        category: "Invoice",
        tag: poSr(v.document_type),
        title: v.invoice_no ? `Invoice ${v.invoice_no}` : v.name,
        subtitle: [v.vendor, v.document_name].filter(Boolean).join(" · ") || undefined,
        amount: v.invoice_amount,
        linkTo: "/invoice-reconciliation?tab=pending",
      })),
    [vi]
  );

  const all = useMemo<FinanceItem[]>(
    () => [...expenses, ...payments, ...invoices],
    [expenses, payments, invoices]
  );

  const active =
    tab === "all"
      ? all
      : tab === "expenses"
        ? expenses
        : tab === "payments"
          ? payments
          : invoices;

  return (
    <>
      {/* Finance category tabs */}
      <div className="mb-4 grid grid-cols-4 gap-2">
        <StatTab label="All" count={all.length} dot="bg-red-500" active={tab === "all"} onClick={() => setTab("all")} />
        <StatTab label="Expenses" count={expenses.length} dot="bg-blue-500" active={tab === "expenses"} onClick={() => setTab("expenses")} />
        <StatTab label="Payments" count={payments.length} dot="bg-emerald-500" active={tab === "payments"} onClick={() => setTab("payments")} />
        <StatTab label="Invoices" count={invoices.length} dot="bg-amber-500" active={tab === "invoices"} onClick={() => setTab("invoices")} />
      </div>

      <hr className="mb-4 border-gray-200" />

      {peErr ? (
        <p className="text-sm text-destructive">Couldn&rsquo;t load finance actions.</p>
      ) : peLoading && active.length === 0 ? (
        <div className="space-y-2">
          <div className="h-12 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-12 animate-pulse rounded-lg bg-gray-100" />
        </div>
      ) : active.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
          All clear — nothing pending here.
        </p>
      ) : (
        <div className="space-y-2">
          {active.map((it) => (
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
              {it.amount != null && (
                <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-700">
                  {rupee(it.amount)}
                </span>
              )}
              <ChevronRight className="h-4 w-4 shrink-0 text-red-400 transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default FinanceActionTabs;
