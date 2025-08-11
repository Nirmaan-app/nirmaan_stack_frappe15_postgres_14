import { useFrappeGetDocCount } from "frappe-react-sdk";
import { LucideIcon, Boxes, HardHat, Package, ShoppingCart, SquareUserRound, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TailSpin } from "react-loader-spinner";


export interface DashboardMetric {
  id: string; // Unique key for mapping
  title: string;
  doctype: string;
  linkTo: string;
  Icon: LucideIcon;
  dataCy?: string; // For cypress testing
}



export const DASHBOARD_METRICS_CONFIG: DashboardMetric[] = [
  {
    id: "projects",
    title: "Projects",
    doctype: "Projects",
    linkTo: "/projects",
    Icon: HardHat,
    dataCy: "admin-dashboard-project-card",
  },
  {
    id: "users",
    title: "Users",
    doctype: "Nirmaan Users",
    linkTo: "/users",
    Icon: UsersRound,
    dataCy: "admin-dashboard-users-card",
  },
  {
    id: "products", // Assuming "Items" are products
    title: "Products",
    doctype: "Items",
    linkTo: "/products",
    Icon: ShoppingCart,
    dataCy: "admin-dashboard-products-card",
  },
  {
    id: "vendors",
    title: "Vendors",
    doctype: "Vendors",
    linkTo: "/vendors",
    Icon: Package,
    dataCy: "admin-dashboard-vendors-card",
  },
  {
    id: "customers",
    title: "Customers",
    doctype: "Customers",
    linkTo: "/customers",
    Icon: SquareUserRound,
    dataCy: "admin-dashboard-customers-card",
  },
  {
    id: "product-packages",
    title: "Product Packages",
    doctype: "Procurement Packages",
    linkTo: "/product-packages",
    Icon: Boxes,
    dataCy: "admin-dashboard-proc-packages-card",
  },
  // {
  //   id: "approved-quotations",
  //   title: "Approved Quotations",
  //   doctype: "Approved Quotations",
  //   linkTo: "/all-AQs",
  //   Icon: Boxes,
  //   dataCy: "admin-dashboard-approved-quotes-card",
  // },
];


// Helper hook to encapsulate useFrappeGetDocCount logic if needed, or use directly
// const useMetricCount = (doctype: string) => {
//   return useFrappeGetDocCount(doctype, {
//     // Optional: Add caching or other options here if the hook supports it
//     // staleTime: 1000 * 60 * 5, // Example: 5 minutes stale time
//   });
// };

// You can create a wrapper if you need to call this hook multiple times in a loop,
// but React rules say hooks must be called at the top level.
// So, we will call them individually for now, driven by the config.

export default function DefaultDashboard() {
  // Fetch data for each metric. This is still multiple hooks, but managed.
  // This is okay for a limited number of metrics.
  // For many (>10-15), consider a custom hook that fetches all in one go if backend supports.
  const metricDataHooks = DASHBOARD_METRICS_CONFIG.map(metric => ({
    ...metric,
    ...useFrappeGetDocCount(metric.doctype, undefined, true, false, `${metric.doctype}_total_count`)
  }));

  return (
    <div className="flex-1 space-y-4"> {/* Added padding */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight" style={{ color: "#D03B45" }}>
          Modules
        </h2>
        {/* Optional: Add a global refresh button or date range selector here */}
      </div>

      <div
        //   className="grid gap-4 md:gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        className="grid gap-4 md:gap-6 md:grid-cols-2"
      > {/* Responsive grid */}
        {metricDataHooks.map(({ id, title, linkTo, Icon, dataCy, data, isLoading, error }) => (
          <DashboardMetricCard
            key={id}
            title={title}
            linkTo={linkTo}
            Icon={Icon}
            count={data}
            isLoading={isLoading}
            error={error}
            dataCy={dataCy}
          // You can add custom colors here if needed, e.g., based on metric type
          // iconColor={id === 'projects' ? 'text-blue-500' : undefined}
          />
        ))}
      </div>
    </div>
  );
};


interface DashboardMetricCardProps {
  title: string;
  linkTo: string;
  Icon: LucideIcon;
  count?: number | string; // Allow string if API returns it as such sometimes
  isLoading: boolean;
  error?: any; // Can be more specific if you know the error type from frappe-react-sdk
  dataCy?: string;
  iconColor?: string; // Optional: if you want to customize icon color per card
  countColor?: string; // Optional: if you want to customize count color
}

export const DashboardMetricCard: React.FC<DashboardMetricCardProps> = ({
  title,
  linkTo,
  Icon,
  count,
  isLoading,
  error,
  dataCy,
  iconColor = "text-muted-foreground", // Default color
  countColor = "#D03B45", // Your specified red color
}) => {
  const renderContent = () => {
    if (isLoading) {
      return (
        <TailSpin
          visible={true}
          height="30"
          width="30"
          color={countColor}
          ariaLabel="metric-loading"
          radius="1"
        />
      );
    }
    if (error) {
      // Consider a more user-friendly error display or icon
      return <p className="text-sm text-destructive">Error loading</p>;
    }
    return count !== undefined ? count : "-"; // Display '-' if count is undefined but not loading/error
  };

  return (
    <Card className="hover:animate-shadow-drop-center transition-shadow duration-300 hover:shadow-lg" data-cy={dataCy}>
      <Link to={linkTo} className="block h-full"> {/* Make entire card clickable and fill height */}
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-foreground">
            {title}
          </CardTitle>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" style={{ color: countColor }}>
            {renderContent()}
          </div>
          {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
        </CardContent>
      </Link>
    </Card>
  );
};