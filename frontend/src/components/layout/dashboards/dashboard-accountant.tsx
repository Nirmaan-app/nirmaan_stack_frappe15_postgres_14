import { useFrappeGetDocCount } from "frappe-react-sdk";
import {
  ArrowUpRight,
  Banknote,
  ClipboardList,
  CreditCard,
  FileText,
  FolderKanban,
  HandCoins,
  Landmark,
  LucideIcon,
  ReceiptText,
  ShoppingCart,
  SquareSquare,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";

// Brand primary color (rose)
const BRAND_PRIMARY = "#D03B45";

// ============================================================================
// Types
// ============================================================================

interface QuickAccessItem {
  id: string;
  title: string;
  description: string;
  linkTo: string;
  Icon: LucideIcon;
}

interface StatCardConfig {
  id: string;
  title: string;
  doctype: string;
  filters?: [string, string, string | string[]][];
  linkTo: string;
  Icon: LucideIcon;
  accentColor?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const STAT_CARDS: StatCardConfig[] = [
  {
    id: "pending-payments",
    title: "Pending Payments",
    doctype: "Project Payments",
    filters: [["status", "=", "Approved"]],
    linkTo: "/project-payments",
    Icon: Wallet,
    accentColor: BRAND_PRIMARY,
  },
  {
    id: "pending-invoices",
    title: "Pending Invoices",
    doctype: "Task",
    filters: [
      ["task_type", "=", "po_invoice_approval"],
      ["status", "=", "Pending"],
    ],
    linkTo: "/invoice-reconciliation",
    Icon: ReceiptText,
    accentColor: "#7c3aed", // violet
  },
];

const QUICK_ACCESS_SECTIONS: { title: string; items: QuickAccessItem[] }[] = [
  {
    title: "Payments & Expenses",
    items: [
      {
        id: "project-payments",
        title: "Project Payments",
        description: "Manage PO & SR payments",
        linkTo: "/project-payments",
        Icon: Wallet,
      },
      {
        id: "inflow-payments",
        title: "In-Flow Payments",
        description: "Track customer payments",
        linkTo: "/in-flow-payments",
        Icon: HandCoins,
      },
      {
        id: "project-expenses",
        title: "Project Expenses",
        description: "Miscellaneous expenses",
        linkTo: "/project-expenses",
        Icon: Landmark,
      },
      {
        id: "non-project-expenses",
        title: "Non-Project Expenses",
        description: "Company-wide expenses",
        linkTo: "/non-project",
        Icon: Banknote,
      },
      {
        id: "credit-payments",
        title: "Credit Payments",
        description: "Payment terms & credits",
        linkTo: "/credits",
        Icon: CreditCard,
      },
    ],
  },
  {
    title: "Invoices & Reconciliation",
    items: [
      {
        id: "invoice-recon",
        title: "Invoice Reconciliation",
        description: "Track pending tasks",
        linkTo: "/invoice-reconciliation",
        Icon: ReceiptText,
      },
      {
        id: "project-invoices",
        title: "Project Invoices",
        description: "Manage project invoices",
        linkTo: "/project-invoices",
        Icon: FileText,
      },
    ],
  },
  {
    title: "Operations & Reports",
    items: [
      {
        id: "purchase-orders",
        title: "Purchase Orders",
        description: "View all POs",
        linkTo: "/purchase-orders",
        Icon: ShoppingCart,
      },
      {
        id: "work-orders",
        title: "Work Orders",
        description: "Service requests",
        linkTo: "/service-requests",
        Icon: SquareSquare,
      },
      {
        id: "projects",
        title: "Projects",
        description: "All projects",
        linkTo: "/projects",
        Icon: FolderKanban,
      },
      {
        id: "vendors",
        title: "Vendors",
        description: "Vendor management",
        linkTo: "/vendors",
        Icon: Store,
      },
      {
        id: "customers",
        title: "Customers",
        description: "Customer management",
        linkTo: "/customers",
        Icon: Users,
      },
      {
        id: "reports",
        title: "Reports",
        description: "Financial reports",
        linkTo: "/reports",
        Icon: ClipboardList,
      },
    ],
  },
];

// ============================================================================
// Components
// ============================================================================

interface StatCardProps {
  title: string;
  count?: number;
  isLoading: boolean;
  error?: unknown;
  linkTo: string;
  Icon: LucideIcon;
  accentColor?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  count,
  isLoading,
  error,
  linkTo,
  Icon,
  accentColor = BRAND_PRIMARY,
}) => {
  const renderCount = () => {
    if (isLoading) {
      return (
        <TailSpin
          visible={true}
          height="28"
          width="28"
          color={accentColor}
          ariaLabel="loading"
          radius="1"
        />
      );
    }
    if (error) return "--";
    return count ?? "--";
  };

  return (
    <Link to={linkTo} className="group relative block">
      <div
        className="
          relative
          h-[120px]
          overflow-hidden
          rounded-xl
          border
          border-gray-100
          bg-white
          p-4
          transition-all
          duration-300
          ease-out
          hover:border-gray-200
          hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)]
          dark:border-gray-800
          dark:bg-gray-900
          dark:hover:border-gray-700
        "
      >
        {/* Watermark Icon */}
        <div
          className="
            pointer-events-none
            absolute
            -bottom-4
            -right-4
            opacity-[0.06]
            transition-all
            duration-500
            ease-out
            group-hover:-bottom-2
            group-hover:-right-2
            group-hover:opacity-[0.12]
          "
        >
          <Icon className="h-24 w-24" style={{ color: accentColor }} strokeWidth={1} />
        </div>

        {/* Content */}
        <div className="relative z-10 flex h-full flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {title}
            </span>
            <ArrowUpRight
              className="
                h-3.5 w-3.5
                -translate-x-1 translate-y-1
                text-gray-300 opacity-0
                transition-all duration-300
                group-hover:translate-x-0 group-hover:translate-y-0
                group-hover:opacity-100
              "
              style={{ color: accentColor }}
            />
          </div>

          <span
            className="text-3xl font-semibold tabular-nums tracking-tight"
            style={{ color: accentColor }}
          >
            {renderCount()}
          </span>
        </div>
      </div>
    </Link>
  );
};

interface QuickAccessCardProps {
  title: string;
  description: string;
  linkTo: string;
  Icon: LucideIcon;
}

const QuickAccessCard: React.FC<QuickAccessCardProps> = ({
  title,
  description,
  linkTo,
  Icon,
}) => {
  return (
    <Link to={linkTo} className="group relative block">
      <div
        className="
          relative
          h-full
          min-h-[100px]
          overflow-hidden
          rounded-xl
          border
          border-gray-100
          bg-white
          p-4
          transition-all
          duration-300
          ease-out
          hover:border-rose-200
          hover:shadow-[0_8px_30px_rgb(208,59,69,0.08)]
          dark:border-gray-800
          dark:bg-gray-900
          dark:hover:border-rose-900/50
        "
      >
        {/* Watermark Icon */}
        <div
          className="
            pointer-events-none
            absolute
            -bottom-3
            -right-3
            opacity-[0.05]
            transition-all
            duration-500
            ease-out
            group-hover:-bottom-1
            group-hover:-right-1
            group-hover:opacity-[0.1]
          "
        >
          <Icon className="h-20 w-20 text-rose-700 dark:text-rose-300" strokeWidth={1} />
        </div>

        {/* Content */}
        <div className="relative z-10 flex h-full flex-col justify-between gap-2">
          <div className="flex items-start justify-between">
            <div
              className="
                flex h-9 w-9 items-center justify-center
                rounded-lg
                bg-rose-50
                transition-colors duration-200
                group-hover:bg-rose-100
                dark:bg-rose-950/50
                dark:group-hover:bg-rose-900/50
              "
            >
              <Icon className="h-4.5 w-4.5 text-rose-600 dark:text-rose-400" strokeWidth={2} />
            </div>
            <ArrowUpRight
              className="
                h-4 w-4
                -translate-x-1 translate-y-1
                text-gray-300 opacity-0
                transition-all duration-300
                group-hover:translate-x-0 group-hover:translate-y-0
                group-hover:text-rose-600 group-hover:opacity-100
              "
            />
          </div>

          <div>
            <h3
              className="
                text-sm font-semibold text-gray-900
                transition-colors duration-200
                group-hover:text-rose-700
                dark:text-gray-100
                dark:group-hover:text-rose-400
              "
            >
              {title}
            </h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {description}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
};

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title, subtitle }) => (
  <div className="space-y-1">
    <h3 className="text-lg font-medium tracking-tight text-gray-700 dark:text-gray-300">
      {title}
    </h3>
    {subtitle && (
      <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
    )}
  </div>
);

// ============================================================================
// Main Component
// ============================================================================

export const Accountant = () => {
  // Fetch counts for stat cards
  const statCardData = STAT_CARDS.map((config) => ({
    ...config,
    ...useFrappeGetDocCount(
      config.doctype,
      config.filters,
      false,
      `accountant_${config.id}_count`
    ),
  }));

  return (
    <div className="flex-1 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Finance Dashboard
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Payment processing and financial operations
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3">
        {statCardData.map(({ id, title, linkTo, Icon, accentColor, data, isLoading, error }) => (
          <StatCard
            key={id}
            title={title}
            count={data}
            isLoading={isLoading}
            error={error}
            linkTo={linkTo}
            Icon={Icon}
            accentColor={accentColor}
          />
        ))}
      </div>

      {/* Quick Access Sections */}
      {QUICK_ACCESS_SECTIONS.map((section) => (
        <div key={section.title} className="space-y-4">
          <SectionHeader title={section.title} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {section.items.map((item) => (
              <QuickAccessCard
                key={item.id}
                title={item.title}
                description={item.description}
                linkTo={item.linkTo}
                Icon={item.Icon}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default Accountant;
