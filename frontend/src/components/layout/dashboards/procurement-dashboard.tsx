import { useDocCountStore } from "@/zustand/useDocCountStore";
import { useFrappeGetDocCount, useFrappeGetDocList } from "frappe-react-sdk";
import {
  LucideIcon,
  FileText,
  Clock,
  RotateCcw,
  SkipForward,
  XCircle,
  ListChecks,
  PlayCircle,
  CheckCircle2,
  FileCheck,
  Truck,
  PackageCheck,
  Package,
  HardHat,
  Store,
  ShoppingCart,
  Search,
  ArrowUpRight,
} from "lucide-react";
import { Link } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";

const BRAND_PRIMARY = "#D03B45";

// ============================================================================
// Types & Configuration
// ============================================================================

interface DashboardMetric {
  id: string;
  title: string;
  description: string;
  linkTo: string;
  Icon: LucideIcon;
  countKey?: string;
  doctype?: string;
}

interface DashboardSection {
  id: string;
  title: string;
  metrics: DashboardMetric[];
}

const PROCUREMENT_SECTIONS: DashboardSection[] = [
  {
    id: "pr-actions",
    title: "PR and Sent Back Actions",
    metrics: [
      {
        id: "new-pr",
        title: "New PR Request",
        description: "Pending approval",
        linkTo: "/procurement-requests?tab=New+PR+Request",
        Icon: FileText,
        countKey: "pr.approved",
      },
      {
        id: "in-progress",
        title: "In Progress",
        description: "Currently processing",
        linkTo: "/procurement-requests?tab=In+Progress",
        Icon: Clock,
        countKey: "pr.in_progress",
      },
    ],
  },
  {
    id: "sent-back",
    title: "Sent Back Actions",
    metrics: [
      {
        id: "sent-back",
        title: "Sent Back",
        description: "Rejected requests",
        linkTo: "/procurement-requests?tab=Rejected",
        Icon: RotateCcw,
        countKey: "sb.rejected.pending",
      },
      {
        id: "skipped-pr",
        title: "Skipped PR",
        description: "Delayed requests",
        linkTo: "/procurement-requests?tab=Delayed",
        Icon: SkipForward,
        countKey: "sb.delayed.pending",
      },
      {
        id: "rejected-po",
        title: "Rejected PO",
        description: "Cancelled orders",
        linkTo: "/procurement-requests?tab=Cancelled",
        Icon: XCircle,
        countKey: "sb.cancelled.pending",
      },
    ],
  },
  {
    id: "work-orders",
    title: "Work Orders",
    metrics: [
      {
        id: "all-wos",
        title: "All WOs",
        description: "Total work orders",
        linkTo: "/service-requests-list",
        Icon: ListChecks,
        countKey: "sr.all",
      },
      {
        id: "in-progress-wo",
        title: "In Progress WO",
        description: "Awaiting vendor",
        linkTo: "/service-requests?tab=choose-vendor",
        Icon: PlayCircle,
        countKey: "sr.pending",
      },
      {
        id: "approved-wo",
        title: "Approved WO",
        description: "Ready for execution",
        linkTo: "/service-requests?tab=approved-sr",
        Icon: CheckCircle2,
        countKey: "sr.approved",
      },
    ],
  },
  {
    id: "po-actions",
    title: "PO Actions",
    metrics: [
      {
        id: "approved-po",
        title: "Approved PO",
        description: "Ready to dispatch",
        linkTo: "/purchase-orders?tab=Approved+PO",
        Icon: FileCheck,
        countKey: "po.PO Approved",
      },
      {
        id: "dispatched-po",
        title: "Dispatched PO",
        description: "In transit",
        linkTo: "/purchase-orders?tab=Dispatched+PO",
        Icon: Truck,
        countKey: "po.Dispatched",
      },
      {
        id: "partially-delivered",
        title: "Partially Delivered",
        description: "Partial delivery",
        linkTo: "/purchase-orders?tab=Partially+Delivered+PO",
        Icon: PackageCheck,
        countKey: "po.Partially Delivered",
      },
      {
        id: "delivered-po",
        title: "Delivered PO",
        description: "Fully received",
        linkTo: "/purchase-orders?tab=Delivered+PO",
        Icon: Package,
        countKey: "po.Delivered",
      },
    ],
  },
  {
    id: "general",
    title: "General Actions",
    metrics: [
      {
        id: "projects",
        title: "Projects Assigned",
        description: "Active projects",
        linkTo: "/projects",
        Icon: HardHat,
        doctype: "projects",
      },
      {
        id: "vendors",
        title: "Total Vendors",
        description: "Supplier management",
        linkTo: "/vendors",
        Icon: Store,
        doctype: "Vendors",
      },
      {
        id: "products",
        title: "Total Products",
        description: "Item catalog",
        linkTo: "/products",
        Icon: ShoppingCart,
        doctype: "Items",
      },
      {
        id: "item-price",
        title: "Item Price Search",
        description: "Approved quotations",
        linkTo: "/item-price",
        Icon: Search,
        doctype: "Approved Quotations",
      },
    ],
  },
];

// ============================================================================
// Components
// ============================================================================

interface MetricCardProps {
  title: string;
  description: string;
  linkTo: string;
  Icon: LucideIcon;
  count?: number | string;
  isLoading?: boolean;
  error?: unknown;
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  description,
  linkTo,
  Icon,
  count,
  isLoading,
  error,
}) => {
  const renderContent = () => {
    if (isLoading) {
      return (
        <TailSpin
          visible={true}
          height="32"
          width="32"
          color={BRAND_PRIMARY}
          ariaLabel="metric-loading"
          radius="1"
        />
      );
    }
    if (error) {
      return <span className="text-sm text-gray-300">--</span>;
    }
    return count !== undefined ? count : "--";
  };

  return (
    <Link to={linkTo} className="group relative block">
      <div
        className="
          relative
          h-[140px]
          overflow-hidden
          rounded-xl
          border
          border-rose-100
          bg-white
          p-5
          transition-all
          duration-300
          ease-out
          hover:border-rose-200
          hover:shadow-[0_8px_30px_rgb(208,59,69,0.08)]
          dark:border-rose-900/30
          dark:bg-gray-900
          dark:hover:border-rose-800/50
        "
      >
        {/* Watermark Icon */}
        <div
          className="
            pointer-events-none
            absolute
            -bottom-6
            -right-6
            opacity-[0.06]
            transition-all
            duration-500
            ease-out
            group-hover:-bottom-4
            group-hover:-right-4
            group-hover:opacity-[0.12]
          "
        >
          <Icon
            className="h-32 w-32 text-rose-700 dark:text-rose-300"
            strokeWidth={1}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 flex h-full flex-col justify-between">
          {/* Top Section */}
          <div className="flex items-start justify-between">
            <div className="space-y-0.5">
              <span
                className="
                  text-sm
                  font-medium
                  tracking-wide
                  text-gray-600
                  transition-colors
                  duration-200
                  group-hover:text-rose-700
                  dark:text-gray-400
                  dark:group-hover:text-rose-400
                "
              >
                {title}
              </span>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {description}
              </p>
            </div>
            <ArrowUpRight
              className="
                h-4
                w-4
                -translate-x-1
                translate-y-1
                text-gray-300
                opacity-0
                transition-all
                duration-300
                group-hover:translate-x-0
                group-hover:translate-y-0
                group-hover:text-rose-600
                group-hover:opacity-100
              "
            />
          </div>

          {/* Bottom Section - Count */}
          <div className="flex items-end justify-between">
            <span
              className="
                text-4xl
                font-semibold
                tabular-nums
                tracking-tight
                transition-colors
                duration-200
              "
              style={{ color: BRAND_PRIMARY }}
            >
              {renderContent()}
            </span>

            {/* Subtle indicator line */}
            <div
              className="
                mb-2
                h-[2px]
                w-0
                rounded-full
                bg-rose-500
                transition-all
                duration-300
                group-hover:w-8
              "
            />
          </div>
        </div>
      </div>
    </Link>
  );
};

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => (
  <div className="space-y-4">
    <h3 className="text-base font-semibold tracking-tight text-gray-700 dark:text-gray-300">
      {title}
    </h3>
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  </div>
);

// ============================================================================
// Helper to get nested count from store
// ============================================================================

const getNestedCount = (
  counts: Record<string, any>,
  path: string
): number | undefined => {
  const keys = path.split(".");
  let value: any = counts;
  for (const key of keys) {
    if (value && typeof value === "object" && key in value) {
      value = value[key];
    } else {
      return undefined;
    }
  }
  return typeof value === "number" ? value : undefined;
};

// ============================================================================
// Main Component
// ============================================================================

export default function ProcurementDashboard() {
  const { counts } = useDocCountStore();

  // Fetch doc counts for general actions
  const {
    data: vendor_list,
    isLoading: vendor_list_loading,
    error: vendor_list_error,
  } = useFrappeGetDocCount("Vendors");
  const {
    data: item_list,
    isLoading: item_list_loading,
    error: item_list_error,
  } = useFrappeGetDocCount("Items");
  const {
    data: projects_data,
    isLoading: projects_loading,
    error: projects_error,
  } = useFrappeGetDocList("Projects");
  const {
    data: approved_quotes,
    isLoading: approved_quotes_loading,
    error: approved_quotes_error,
  } = useFrappeGetDocCount("Approved Quotations");

  // Map doctype to fetched data
  const doctypeData: Record<
    string,
    { count?: number; isLoading: boolean; error?: unknown }
  > = {
    projects: {
      count: projects_data?.length,
      isLoading: projects_loading,
      error: projects_error,
    },
    Vendors: {
      count: vendor_list,
      isLoading: vendor_list_loading,
      error: vendor_list_error,
    },
    Items: {
      count: item_list,
      isLoading: item_list_loading,
      error: item_list_error,
    },
    "Approved Quotations": {
      count: approved_quotes,
      isLoading: approved_quotes_loading,
      error: approved_quotes_error,
    },
  };

  return (
    <div className="flex-1 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Procurement Dashboard
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Overview of procurement requests, orders, and actions
        </p>
      </div>

      {/* Sections */}
      {PROCUREMENT_SECTIONS.map((section) => (
        <Section key={section.id} title={section.title}>
          {section.metrics.map((metric) => {
            // Determine count source
            let count: number | undefined;
            let isLoading = false;
            let error: unknown;

            if (metric.doctype && doctypeData[metric.doctype]) {
              const data = doctypeData[metric.doctype];
              count = data.count;
              isLoading = data.isLoading;
              error = data.error;
            } else if (metric.countKey) {
              count = getNestedCount(counts, metric.countKey) || 0;
            }

            return (
              <MetricCard
                key={metric.id}
                title={metric.title}
                description={metric.description}
                linkTo={metric.linkTo}
                Icon={metric.Icon}
                count={count}
                isLoading={isLoading}
                error={error}
              />
            );
          })}
        </Section>
      ))}
    </div>
  );
}
