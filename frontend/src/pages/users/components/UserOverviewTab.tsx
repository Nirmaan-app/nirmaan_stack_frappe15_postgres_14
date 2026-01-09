import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { formatDate } from "@/utils/FormatDate";
import { getRoleColors } from "@/utils/roleColors";
import { UserAvatar, RoleBadge } from "./index";
import {
  Mail,
  Phone,
  Calendar,
  FolderKanban,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface UserOverviewTabProps {
  user: NirmaanUsers;
  projectCount: number;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  description?: string;
  colorClass?: string;
}

function StatCard({ icon, label, value, description, colorClass }: StatCardProps) {
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
        <div className={cn(
          "flex h-10 w-10 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110",
          colorClass ? `${colorClass} bg-current/10` : "bg-primary/10 text-primary"
        )}>
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
  value
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

export function UserOverviewTab({ user, projectCount }: UserOverviewTabProps) {
  const colors = getRoleColors(user.role_profile);

  const stats = useMemo(() => [
    {
      icon: <FolderKanban className="h-5 w-5" />,
      label: "Assigned Projects",
      value: projectCount,
      description: "Active project assignments",
      colorClass: "text-blue-600",
    },
    {
      icon: <Clock className="h-5 w-5" />,
      label: "Days Active",
      value: Math.floor(
        (new Date().getTime() - new Date(user.creation).getTime()) /
        (1000 * 60 * 60 * 24)
      ),
      description: `Since ${formatDate(user.creation)}`,
      colorClass: "text-purple-600",
    },
  ], [projectCount, user.creation]);

  return (
    <div className="space-y-6">
      {/* User Profile Card */}
      <Card className="overflow-hidden">
        <div className={cn("h-24 w-full", colors.gradient)} />
        <CardHeader className="relative pb-4">
          <div className="absolute -top-12 left-6">
            <UserAvatar
              fullName={user.full_name}
              roleProfile={user.role_profile}
              size="xl"
              showRing={true}
              className="border-4 border-background shadow-lg"
            />
          </div>
          <div className="pt-8 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-2xl">{user.full_name}</CardTitle>
                <CardDescription className="mt-1">
                  <RoleBadge roleProfile={user.role_profile} size="md" />
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <InfoItem
              icon={<Mail className="h-4 w-4" />}
              label="Email Address"
              value={user.email}
            />
            <InfoItem
              icon={<Phone className="h-4 w-4" />}
              label="Mobile Number"
              value={user.mobile_no}
            />
            <InfoItem
              icon={<Calendar className="h-4 w-4" />}
              label="Member Since"
              value={formatDate(user.creation)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Overview
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      </div>
    </div>
  );
}
