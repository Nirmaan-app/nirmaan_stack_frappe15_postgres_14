import {
  LucideIcon,
  ListChecks,
  Tickets,
  CircleDollarSign,
  Landmark,
  CreditCard,
  ReceiptText,
  HardHat,
  Store,
  Search,
  Package,
  FileSpreadsheet,
  Waypoints,
  ClipboardMinus,
} from "lucide-react";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { useCounts } from "@/hooks/useCounts";
import { getProjectStaticFilters } from "@/pages/projects/config/projectTable.config";
import { MetricCard, Section, getNestedCount } from "./procurement-dashboard";
import { useExpenseAccess } from "@/hooks/useExpenseAccess";
import { showsExpenses } from "@/utils/expenseAccess";

// ============================================================================
// Configuration
//
// One card per item in the Service Procurement sidebar (NewSidebar.tsx), nothing
// more (owner, 2026-10-13). This profile is a company-wide WO desk with no project
// assignment, so every count covers all projects -- see
// SERVICE_PROCUREMENT_EXECUTIVE_PROFILE in constants/roles.ts.
// ============================================================================

interface ServiceMetric {
  id: string;
  title: string;
  description: string;
  linkTo: string;
  Icon: LucideIcon;
  /** Dotted path into the sidebar count store, e.g. "sr.all". */
  storeKey?: string;
  /** Key into this dashboard's batched `useCounts` result. */
  countKey?: "projects" | "vendors" | "approvedQuotes";
}

interface ServiceSection {
  id: string;
  title: string;
  metrics: ServiceMetric[];
}

const SERVICE_SECTIONS: ServiceSection[] = [
  {
    id: "work-orders",
    title: "Work Orders",
    metrics: [
      {
        id: "work-orders",
        title: "Work Orders",
        description: "All work orders",
        linkTo: "/service-requests?tab=all-sr",
        Icon: ListChecks,
        storeKey: "sr.all",
      },
      {
        id: "wo-rate-card",
        title: "Work Order Rate Card",
        description: "Service rates for WOs",
        linkTo: "/work-order-rate-card",
        Icon: Tickets,
      },
    ],
  },
  {
    id: "payments-invoices",
    title: "Payments & Invoices",
    metrics: [
      {
        id: "project-payments",
        title: "Project Payment & Expense",
        description: "Vendor payments and expenses",
        linkTo: "/project-payments",
        Icon: CircleDollarSign,
      },
      {
        // Shown only to a viewer who gets the Expenses page (`useExpenseAccess`), like the sidebar item.
        id: "expenses",
        title: "Expenses",
        description: "Raise and track expenses",
        linkTo: "/expense",
        Icon: Landmark,
      },
      {
        id: "credit-payments",
        title: "Credit Payments",
        description: "Vendor credit terms",
        linkTo: "/credits",
        Icon: CreditCard,
      },
      {
        id: "invoice-recon",
        title: "Vendor Invoice Recon",
        description: "Vendor invoices and pending uploads",
        linkTo: "/invoice-reconciliation",
        Icon: ReceiptText,
      },
    ],
  },
  {
    id: "general",
    title: "General",
    metrics: [
      {
        id: "projects",
        title: "All Projects",
        description: "Every active project",
        linkTo: "/projects",
        Icon: HardHat,
        countKey: "projects",
      },
      {
        id: "vendors",
        title: "Vendors",
        description: "Supplier management",
        linkTo: "/vendors",
        Icon: Store,
        countKey: "vendors",
      },
      {
        id: "item-price",
        title: "Item Price Search",
        description: "Approved quotations",
        linkTo: "/item-price",
        Icon: Search,
        countKey: "approvedQuotes",
      },
      {
        id: "assets",
        title: "Assets",
        description: "Company assets",
        linkTo: "/asset-management",
        Icon: Package,
      },
      {
        id: "upload-boq",
        title: "Upload BoQ",
        description: "Upload and price BoQs",
        linkTo: "/upload-boq",
        Icon: FileSpreadsheet,
      },
      {
        id: "tds-repository",
        title: "TDS Repository",
        description: "Technical data sheets",
        linkTo: "/tds-repository",
        Icon: Waypoints,
      },
      {
        id: "reports",
        title: "Reports",
        description: "WO, payment and project reports",
        linkTo: "/reports",
        Icon: ClipboardMinus,
      },
    ],
  },
];

// ============================================================================
// Main Component
// ============================================================================

/** Dashboard for the Service Procurement Executive profile: its sidebar, as cards. */
export default function ServiceProcurementDashboard() {
  const { counts } = useDocCountStore();
  const { access: expenseAccess } = useExpenseAccess();

  // One batched round-trip. Projects carries the same static filter as the
  // /projects table (Won only), so the card number matches the list it opens.
  const {
    data: countsData,
    isLoading: countsLoading,
    error: countsError,
  } = useCounts(
    [
      { key: "projects", doctype: "Projects", filters: getProjectStaticFilters() },
      { key: "vendors", doctype: "Vendors" },
      { key: "approvedQuotes", doctype: "Approved Quotations" },
    ],
    "dashboard-service-procurement-counts"
  );

  return (
    <div className="flex-1 space-y-8 p-6 md:p-8">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Work Order Dashboard
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Work orders, payments and shared procurement tools across all projects
        </p>
      </div>

      {/* Sections */}
      {SERVICE_SECTIONS.map((section) => (
        <Section key={section.id} title={section.title}>
          {section.metrics.filter((metric) => metric.id !== "expenses" || showsExpenses(expenseAccess)).map((metric) => {
            const hasCount = !!(metric.storeKey || metric.countKey);
            const count = metric.storeKey
              ? getNestedCount(counts, metric.storeKey) || 0
              : metric.countKey
                ? (countsData?.message?.[metric.countKey] as number | undefined)
                : undefined;

            return (
              <MetricCard
                key={metric.id}
                title={metric.title}
                description={metric.description}
                linkTo={metric.linkTo}
                Icon={metric.Icon}
                count={count}
                isLoading={!!metric.countKey && countsLoading}
                error={metric.countKey ? countsError : undefined}
                hideCount={!hasCount}
              />
            );
          })}
        </Section>
      ))}
    </div>
  );
}
