import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BarChart3, ChevronLeft, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import { useBillingProjects } from "./data/useBillingQueries";
import { TONE_CLASSES, etaTag, pct, projectDeadline, projectStatusTone } from "./utils/billingFormat";
import { PackageTabs, ToneTag } from "./components/BillingBits";
import { BillsDataTable } from "./components/BillsDataTable";
import { SetupBillingDialog } from "./components/SetupBillingDialog";
import { RemovePackageDialog } from "./components/RemovePackageDialog";
import { useUserData } from "@/hooks/useUserData";
import { canEditBillingPackage } from "@/constants/roles";

function HeaderChip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border bg-white px-3.5 py-2 text-sm", className)}>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-bold">{children}</span>
    </div>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const done = percent >= 100;
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className="stroke-gray-100" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(100, percent) / 100)}
          className={done ? "stroke-green-700" : "stroke-amber-500"}
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center text-base font-bold",
          done ? "text-green-700" : "text-amber-600",
        )}
      >
        {percent}%
      </span>
    </div>
  );
}

/** One project's bills, opened from "View Bills" on the Billing Tracker's Project Wise view. */
export default function BillingProjectPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  // The same call the tracker list makes, so arriving from "View Bills" reads it from the cache.
  const { data, isLoading, error } = useBillingProjects();
  const row = data?.message?.projects.find((p) => p.project === projectId);

  // Stable identity: the bills table derives its columns from these.
  const trackers = useMemo(() => row?.packages ?? [], [row]);
  const projectLabel = row?.project_name || projectId;
  const projectNameOf = useCallback(() => projectLabel, [projectLabel]);

  const canWrite = !!data?.message?.can_write;
  const [setupOpen, setSetupOpen] = useState(false);
  // Admin removes a package from the project (trash icon on its tab), as on the project Billing tab.
  const { role, user_id } = useUserData();
  const canRemovePackage = canEditBillingPackage(role, user_id);
  const [removingName, setRemovingName] = useState<string | null>(null);
  const removing = trackers.find((t) => t.name === removingName) ?? null;

  const [pkg, setPkg] = useState<string | null>(null);
  const scopeFilters = useMemo(
    () => (pkg ? [["project", "=", projectId], ["package", "=", pkg]] : [["project", "=", projectId]]),
    [projectId, pkg],
  );

  const backButton = (
    <Button variant="outline" size="sm" onClick={() => navigate("/billing-tracker?tab=project")}>
      <ChevronLeft className="mr-1 h-4 w-4" /> All projects
    </Button>
  );

  if (isLoading) return <TableSkeleton />;
  if (error || !row) {
    return (
      <div className="flex-1 space-y-5 pt-6 md:p-4">
        {backButton}
        <div className="flex flex-col items-center justify-center rounded-xl border bg-white px-6 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
            <BarChart3 className="h-7 w-7 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">
            {error ? "Billing could not be loaded" : "No billing is set up for this project"}
          </h3>
          {error?.message && <p className="mt-1 max-w-md text-sm text-muted-foreground">{error.message}</p>}
        </div>
      </div>
    );
  }

  const billCount = row.bill_count;
  const approvedCount = billCount - row.pending_count;
  const deadline = projectDeadline(row.packages);
  const deadlineTag = etaTag(deadline);

  return (
    <div className="flex-1 space-y-5 pt-6 md:p-4">
      {backButton}

      <div className="space-y-6 rounded-xl border bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold tracking-wider text-muted-foreground">BILLING TRACKER</div>
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold text-gray-900">{projectLabel}</h1>
              {row.status && <ToneTag label={row.status} tone={projectStatusTone(row.status)} />}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <HeaderChip label="Owner">{row.managers.join(", ") || "Unassigned"}</HeaderChip>
            <HeaderChip
              label="Deadline"
              className={deadlineTag?.tone === "critical" ? TONE_CLASSES.critical : undefined}
            >
              {deadline ? formatDate(deadline) : "Not set"}
            </HeaderChip>
            <HeaderChip label="Bills">{billCount}</HeaderChip>
            {canWrite && (
              <Button onClick={() => setSetupOpen(true)}>
                <Settings2 className="mr-1.5 h-4 w-4" /> Setup Packages
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <ProgressRing percent={pct(approvedCount, billCount)} />
            <div>
              <div className="text-sm text-gray-700">Bills approved &amp; beyond</div>
              <div className="text-3xl font-bold leading-tight">
                <span className="text-amber-600">{approvedCount}</span>
                <span className="text-gray-400"> / {billCount}</span>
              </div>
            </div>
          </div>
          {row.pending_count > 0 && (
            <ToneTag
              label={`${row.pending_count} bill${row.pending_count === 1 ? "" : "s"} pending`}
              tone="warning"
              className="px-3.5 py-1.5 text-xs"
            />
          )}
        </div>
      </div>

      <PackageTabs
        packages={row.packages}
        total={billCount}
        value={pkg}
        onChange={setPkg}
        onRemove={
          canRemovePackage ? (p) => setRemovingName(trackers.find((t) => t.package === p)?.name ?? null) : undefined
        }
      />

      <BillsDataTable
        scopeFilters={scopeFilters}
        trackers={trackers}
        projectNameOf={projectNameOf}
        urlSyncKey={`billing_project_${projectId}`}
        exportFileName={`${projectLabel}_Bills`}
        showManager
        addBillFor={{ project: projectId, onSetupPackages: canWrite ? () => setSetupOpen(true) : undefined }}
      />

      <SetupBillingDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        project={projectId}
        projectLabel={projectLabel}
        trackers={trackers}
      />
      <RemovePackageDialog tracker={removing} onClose={() => setRemovingName(null)} onRemoved={() => setPkg(null)} />
    </div>
  );
}
