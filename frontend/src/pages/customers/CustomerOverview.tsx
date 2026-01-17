import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Customers } from "@/types/NirmaanStack/Customers";
import { useFrappeGetDoc, useFrappeGetDocCount } from "frappe-react-sdk";
import React, { Suspense } from "react";
import { TailSpin } from "react-loader-spinner";
import {
  Building2,
  Tag,
  User,
  Phone,
  Mail,
  FileText,
  MapPin,
  Map,
  FolderKanban,
  Briefcase,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";

interface CustomerOverviewProps {
  data?: Customers;
  customerId?: string;
  tab: string;
  onClick: (value: string) => void;
}

const Projects = React.lazy(() => import("../projects/projects"));
const InFlowPayments = React.lazy(
  () => import("../inflow-payments/InFlowPayments")
);
const AllProjectInvoices = React.lazy(
  () => import("../ProjectInvoices/AllProjectInvoices")
);

// =============================================================================
// REUSABLE COMPONENTS
// =============================================================================

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  description?: string;
  colorClass?: string;
}

function StatCard({
  icon,
  label,
  value,
  description,
  colorClass,
}: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-all duration-300 hover:shadow-md hover:border-primary/20">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </p>
          <p className={cn("text-2xl font-bold tabular-nums", colorClass)}>
            {value}
          </p>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110",
            colorClass
              ? `${colorClass} bg-current/10`
              : "bg-primary/10 text-primary"
          )}
        >
          {icon}
        </div>
      </div>
      {/* Subtle gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-primary/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none" />
    </div>
  );
}

function InfoItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | undefined | null;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg transition-colors hover:bg-muted/50">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary flex-shrink-0">
        {icon}
      </div>
      <div className="space-y-0.5 min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        <p className="text-sm font-medium truncate">{value || "—"}</p>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const CustomerOverview: React.FC<CustomerOverviewProps> = ({
  data,
  customerId,
  tab,
  onClick,
}) => {
  // Fetch address data
  const { data: customerAddress } = useFrappeGetDoc(
    "Address",
    data?.company_address,
    data?.company_address ? `Address ${data?.company_address}` : null,
    {
      revalidateIfStale: false,
    }
  );

  // Fetch project counts for stats
  const { data: totalProjectCount } = useFrappeGetDocCount(
    "Projects",
    customerId ? [["customer", "=", customerId]] : undefined
  );

  const { data: activeProjectCount } = useFrappeGetDocCount(
    "Projects",
    customerId
      ? [
          ["customer", "=", customerId],
          ["status", "=", "WIP"],
        ]
      : undefined
  );

  // Format address for display
  const formattedAddress = useMemo(() => {
    if (!customerAddress) return null;
    const parts = [
      customerAddress.address_line1,
      customerAddress.address_line2,
      customerAddress.city,
      customerAddress.state,
      customerAddress.pincode,
    ].filter(Boolean);
    return parts.join(", ");
  }, [customerAddress]);

  // Calculate days as customer
  const daysAsCustomer = useMemo(() => {
    if (!data?.creation) return 0;
    return Math.floor(
      (new Date().getTime() - new Date(data.creation).getTime()) /
        (1000 * 60 * 60 * 24)
    );
  }, [data?.creation]);

  // Stats configuration
  const stats = useMemo<StatCardProps[]>(
    () => [
      {
        icon: <FolderKanban className="h-5 w-5" />,
        label: "Total Projects",
        value: totalProjectCount ?? 0,
        description: "All associated projects",
        colorClass: "text-blue-600",
      },
      {
        icon: <Briefcase className="h-5 w-5" />,
        label: "Active Projects",
        value: activeProjectCount ?? 0,
        description: "Currently in progress",
        colorClass: "text-emerald-600",
      },
      {
        icon: <Clock className="h-5 w-5" />,
        label: "Days as Customer",
        value: daysAsCustomer,
        description: data?.creation
          ? `Since ${formatDate(data.creation)}`
          : undefined,
        colorClass: "text-purple-600",
      },
    ],
    [totalProjectCount, activeProjectCount, daysAsCustomer, data?.creation]
  );

  return (
    <div className="space-y-6">
      {/* Customer Profile Card */}
      <Card className="overflow-hidden">
        <div className="h-20 w-full bg-gradient-to-r from-primary/20 via-primary/10 to-transparent" />
        <CardHeader className="relative pb-4">
          <div className="absolute -top-10 left-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg border-4 border-background">
              <Building2 className="h-8 w-8" />
            </div>
          </div>
          <div className="pt-6 space-y-1">
            <CardTitle className="text-2xl">
              {data?.company_name || "—"}
            </CardTitle>
            {data?.customer_nickname && (
              <p className="text-sm text-muted-foreground">
                Nickname: {data.customer_nickname}
              </p>
            )}
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            <InfoItem
              icon={<Tag className="h-4 w-4" />}
              label="Customer ID"
              value={data?.name}
            />
            <InfoItem
              icon={<User className="h-4 w-4" />}
              label="Contact Person"
              value={data?.company_contact_person}
            />
            <InfoItem
              icon={<Phone className="h-4 w-4" />}
              label="Contact Number"
              value={data?.company_phone}
            />
            <InfoItem
              icon={<Mail className="h-4 w-4" />}
              label="Email Address"
              value={data?.company_email}
            />
            <InfoItem
              icon={<FileText className="h-4 w-4" />}
              label="GST Number"
              value={data?.company_gst}
            />
            <InfoItem
              icon={<Map className="h-4 w-4" />}
              label="City, State"
              value={
                customerAddress
                  ? `${customerAddress.city || "—"}, ${customerAddress.state || "—"}`
                  : null
              }
            />
            <InfoItem
              icon={<MapPin className="h-4 w-4" />}
              label="Full Address"
              value={formattedAddress}
            />
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Overview
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      </div>

      {/* Sub-Tabs Section */}
      <Tabs value={tab} onValueChange={onClick} className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="projects" className="gap-2">
            <FolderKanban className="h-4 w-4" />
            <span className="hidden sm:inline">Projects</span>
          </TabsTrigger>
          <TabsTrigger value="payments-inflow" className="gap-2">
            <Briefcase className="h-4 w-4" />
            <span className="hidden sm:inline">Inflow</span>
          </TabsTrigger>
          <TabsTrigger value="invoices" className="gap-2">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Invoices</span>
          </TabsTrigger>
        </TabsList>

        <Suspense
          fallback={
            <div className="flex items-center h-[50vh] w-full justify-center">
              <TailSpin color={"red"} />
            </div>
          }
        >
          <TabsContent value="projects" className="mt-4">
            <Projects customersView customerId={customerId} />
          </TabsContent>

          <TabsContent value="payments-inflow" className="mt-4">
            <InFlowPayments customerId={customerId} />
          </TabsContent>

          <TabsContent value="invoices" className="mt-4">
            <AllProjectInvoices customerId={customerId} />
          </TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
};

export default CustomerOverview;
