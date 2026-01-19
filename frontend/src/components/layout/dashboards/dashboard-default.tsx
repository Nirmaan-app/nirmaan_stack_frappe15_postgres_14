import { useFrappeGetDocCount } from "frappe-react-sdk";
import {
  LucideIcon,
  Boxes,
  HardHat,
  Package,
  ShoppingCart,
  SquareUserRound,
  UsersRound,
  Milestone,
  PencilRuler,
  AlertTriangle,
  ArrowUpRight,
  Layers,
} from "lucide-react";
import { Link } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";

// Brand primary color (rose)
const BRAND_PRIMARY = "#D03B45";

// ============================================================================
// Types & Configuration
// ============================================================================

export interface DashboardMetric {
  id: string;
  title: string;
  description: string;
  doctype: string;
  linkTo: string;
  Icon: LucideIcon;
  dataCy?: string;
}

export const DASHBOARD_METRICS_CONFIG: DashboardMetric[] = [
  {
    id: "projects",
    title: "Projects",
    description: "Active construction projects",
    doctype: "Projects",
    linkTo: "/projects",
    Icon: HardHat,
    dataCy: "admin-dashboard-project-card",
  },
  {
    id: "users",
    title: "Users",
    description: "System users & roles",
    doctype: "Nirmaan Users",
    linkTo: "/users",
    Icon: UsersRound,
    dataCy: "admin-dashboard-users-card",
  },
  {
    id: "products",
    title: "Products",
    description: "Item catalog",
    doctype: "Items",
    linkTo: "/products",
    Icon: ShoppingCart,
    dataCy: "admin-dashboard-products-card",
  },
  {
    id: "vendors",
    title: "Vendors",
    description: "Supplier management",
    doctype: "Vendors",
    linkTo: "/vendors",
    Icon: Package,
    dataCy: "admin-dashboard-vendors-card",
  },
  {
    id: "customers",
    title: "Customers",
    description: "Client management",
    doctype: "Customers",
    linkTo: "/customers",
    Icon: SquareUserRound,
    dataCy: "admin-dashboard-customers-card",
  },
  {
    id: "product-packages",
    title: "Product Packages",
    description: "Procurement categories",
    doctype: "Procurement Packages",
    linkTo: "/product-packages",
    Icon: Boxes,
    dataCy: "admin-dashboard-proc-packages-card",
  },
  {
    id: "milestone-packages",
    title: "Milestone Packages",
    description: "Work milestones",
    doctype: "Work Headers",
    linkTo: "/milestone-packages",
    Icon: Milestone,
    dataCy: "admin-dashboard-proc-packages-card",
  },
  {
    id: "design-packages",
    title: "Design Packages",
    description: "Design categories",
    doctype: "Design Tracker Category",
    linkTo: "/design-packages",
    Icon: PencilRuler,
    dataCy: "admin-dashboard-design-packages-card",
  },
  {
    id: "critical-po-categories",
    title: "Critical PO Categories",
    description: "Priority categories",
    doctype: "Critical PO Category",
    linkTo: "/critical-po-categories",
    Icon: AlertTriangle,
    dataCy: "admin-dashboard-critical-po-categories-card",
  },
  {
    id: "assets",
    title: "Assets",
    description: "Asset management",
    doctype: "Asset Master",
    linkTo: "/asset-management",
    Icon: Layers,
    dataCy: "admin-dashboard-assets-card",
  },
];

// ============================================================================
// Components
// ============================================================================

interface DashboardMetricCardProps {
  title: string;
  description: string;
  linkTo: string;
  Icon: LucideIcon;
  count?: number | string;
  isLoading: boolean;
  error?: unknown;
  dataCy?: string;
}

export const DashboardMetricCard: React.FC<DashboardMetricCardProps> = ({
  title,
  description,
  linkTo,
  Icon,
  count,
  isLoading,
  error,
  dataCy,
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
    <Link to={linkTo} className="group relative block" data-cy={dataCy}>
      {/* Card Container */}
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
        {/* Watermark Icon - Large, Faded, Positioned Bottom-Right */}
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
          {/* Top Section - Title with Arrow */}
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

// ============================================================================
// Main Component
// ============================================================================

export default function DefaultDashboard() {
  const metricDataHooks = DASHBOARD_METRICS_CONFIG.map((metric) => ({
    ...metric,
    ...useFrappeGetDocCount(
      metric.doctype,
      undefined,
      false,
      `${metric.doctype}_total_count`
    ),
  }));

  return (
    <div className="flex-1 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Admin Dashboard
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          System overview and quick access to all modules
        </p>
      </div>

      {/* Grid */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {metricDataHooks.map(
          ({ id, title, description, linkTo, Icon, dataCy, data, isLoading, error }) => (
            <DashboardMetricCard
              key={id}
              title={title}
              description={description}
              linkTo={linkTo}
              Icon={Icon}
              count={data}
              isLoading={isLoading}
              error={error}
              dataCy={dataCy}
            />
          )
        )}
      </div>
    </div>
  );
}
