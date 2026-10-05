import { useCallback, useMemo, useState } from "react";
import { BarChart3, Pencil, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useProjectBilling } from "./data/useBillingQueries";
import { dcFreshness, inr, managerNames, pct, progressNote } from "./utils/billingFormat";
import { ApprovalBar, Money, PackageChip, PackageTabs, PersonChips, ToneTag } from "./components/BillingBits";
import { BillsDataTable } from "./components/BillsDataTable";
import { SetupBillingDialog } from "./components/SetupBillingDialog";
import { EditPackageDialog } from "./components/EditPackageDialog";
import { useUserData } from "@/hooks/useUserData";
import { canEditBillingPackage, isBillingProfile } from "@/constants/roles";
import { useProjectFinancialsTabData } from "@/pages/projects/data/tab/financials/useProjectFinancialsTabApi";
import { getTotalInflowAmount, getTotalProjectInvoiceAmount } from "@/utils/getAmounts";
import { SupplyDcSheet } from "./components/SupplyDcSheet";

interface ProjectBillingTabProps {
  projectId: string;
  projectName?: string;
}

// Package table headers wrap so the table always fits the page width.
const PKG_TH = "px-2 py-3 text-left text-[11px] font-semibold leading-tight tracking-wider text-muted-foreground xl:px-3";
const PKG_TD = "px-2 py-3.5 align-top xl:px-3";

function Stat({ label, value, note, accent }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div>
      <div className={cn("mb-1 text-[11px] font-semibold tracking-wider", accent ? "text-blue-700" : "text-muted-foreground")}>
        {label}
      </div>
      <div className={cn("text-xl font-bold leading-tight", accent ? "text-blue-700" : "text-gray-900")}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

export default function ProjectBillingTab({ projectId, projectName }: ProjectBillingTabProps) {
  const { data, isLoading, error } = useProjectBilling(projectId);
  const billing = data?.message;

  // Total Invoiced / Total Inflow: the same records, request and sums as the project's
  // Financials tab (Project Invoices / Project Inflows), so the two screens always agree.
  const { inflowsResponse, invoicesResponse } = useProjectFinancialsTabData(projectId);
  const inflows = inflowsResponse.data;
  const invoices = invoicesResponse.data;
  const totalInflow = useMemo(() => getTotalInflowAmount(inflows || []), [inflows]);
  const totalInvoiced = useMemo(() => getTotalProjectInvoiceAmount(invoices || []), [invoices]);
  // Stable identity: the bills table derives its columns from these.
  const trackers = useMemo(() => billing?.trackers ?? [], [billing]);
  const summary = billing?.summary;
  const canWrite = !!billing?.can_write;
  const projectLabel = projectName || projectId;

  const [setupOpen, setSetupOpen] = useState(false);
  // Admin edits one package's PO value and assigned users from its row.
  const { role, user_id } = useUserData();
  const canEditPackage = canEditBillingPackage(role, user_id);
  // Billing users log Supply DC from Billing Tracker → My Bills, not here (owner, 2026-10-05).
  // Display only: who may log a DC row is still decided by the tracker hooks.
  const showSupplyDcButton = role !== "Loading" && !isBillingProfile(role);
  const [editingName, setEditingName] = useState<string | null>(null);
  const editing = trackers.find((t) => t.name === editingName) ?? null;
  const [dcOpen, setDcOpen] = useState(false);

  const [pkg, setPkg] = useState<string | null>(null);
  const scopeFilters = useMemo(
    () => (pkg ? [["project", "=", projectId], ["package", "=", pkg]] : [["project", "=", projectId]]),
    [projectId, pkg],
  );
  const projectNameOf = useCallback(() => projectLabel, [projectLabel]);
  const staleCount = trackers.filter((t) => !dcFreshness(t.dc_updated_on).isToday).length;
  // Supply DC lists only the packages this user may log for: all for Admin, else the ones they manage.
  const dcTrackers = useMemo(() => trackers.filter((t) => t.can_edit_bills), [trackers]);

  if (isLoading) return <TableSkeleton />;
  if (error) {
    return (
      <div className="rounded-xl border bg-white px-6 py-14 text-center text-sm text-muted-foreground">
        {error.message || "Billing could not be loaded."}
      </div>
    );
  }

  if (!trackers.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border bg-white px-6 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
          <BarChart3 className="h-7 w-7 text-gray-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900">Billing isn't set up for this project</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Pick the billing packages in scope, with a manager and PO value for each. Bills are then added under a package.
        </p>
        {canWrite && (
          <Button className="mt-5" onClick={() => setSetupOpen(true)}>
            <Settings2 className="mr-2 h-4 w-4" /> Set up billing packages
          </Button>
        )}
        <SetupBillingDialog
          open={setupOpen}
          onOpenChange={setSetupOpen}
          project={projectId}
          projectLabel={projectLabel}
          trackers={trackers}
        />
      </div>
    );
  }

  const billed = summary?.billed ?? 0;
  const approved = summary?.approved ?? 0;
  const poTotal = summary?.po_value ?? 0;
  // Bars measure against the PO value; until one is entered, against what is billed.
  const barBase = poTotal > 0 ? poTotal : billed;

  return (
    <div className="space-y-5">
      {/* Billing summary */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Billing summary</h2>
          <p className="text-sm text-muted-foreground">PO value, Supply DC and billing progress for each package in this project.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-gray-600">
            {summary?.bill_count ?? 0} bill{summary?.bill_count === 1 ? "" : "s"} · <span className="font-bold text-amber-700">{summary?.pending_count ?? 0} pending</span>
          </span>
          <ToneTag
            label={
              staleCount === 0
                ? "All packages' DC updated today"
                : `${staleCount} package DC${staleCount === 1 ? "" : "s"} not updated today`
            }
            tone={staleCount === 0 ? "good" : "warning"}
          />
          {canWrite && (
            <Button size="sm" onClick={() => setSetupOpen(true)}>
              <Settings2 className="mr-1.5 h-4 w-4" /> Setup Packages
            </Button>
          )}
          {showSupplyDcButton && dcTrackers.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setDcOpen(true)}>
              <BarChart3 className="mr-1.5 h-4 w-4" /> Update Supply DC
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-10">
          <div className="min-w-[280px] max-w-[640px] flex-1">
            <div className="mb-1.5 text-[11px] font-bold tracking-wider text-muted-foreground">PROJECT TOTAL</div>
            <div className="text-3xl font-bold leading-tight text-gray-900">{inr(poTotal)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {poTotal > 0
                ? `PO value across ${trackers.length} packages`
                : "No PO value entered yet — add it from Packages"}
            </div>
            <div className="mt-5">
              <ApprovalBar approved={approved} billed={billed} total={barBase} thick />
              <div className="mt-3 flex flex-wrap gap-6 text-xs text-gray-600">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm bg-green-700" />
                  Approved <b className="text-gray-900">{inr(approved)}</b>
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
                  Billed, awaiting approval <b className="text-gray-900">{inr(billed - approved)}</b>
                </span>
                {poTotal > 0 && (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm border border-gray-300 bg-gray-100" />
                    Not yet billed <b className="text-gray-900">{inr(Math.max(0, poTotal - billed))}</b>
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-9 gap-y-5">
            <Stat
              label="SUPPLY DC TILL DATE"
              value={inr(summary?.supply_dc ?? 0)}
              note={poTotal > 0 ? `${pct(summary?.supply_dc ?? 0, poTotal)}% of PO` : "Across all packages"}
            />
            <Stat
              label="BILLED TILL DATE"
              value={inr(billed)}
              note={poTotal > 0 ? `${pct(billed, poTotal)}% of PO` : `${pct(approved, billed)}% approved`}
            />
            <Stat
              label="TOTAL INVOICED"
              value={invoicesResponse.isLoading ? "…" : invoicesResponse.error ? "—" : inr(totalInvoiced)}
              note={
                invoicesResponse.error
                  ? "Could not load client invoices"
                  : invoices?.length
                    ? `Client invoices, incl. GST · ${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`
                    : "No client invoices yet"
              }
            />
            <Stat
              label="TOTAL INFLOW"
              value={inflowsResponse.isLoading ? "…" : inflowsResponse.error ? "—" : inr(totalInflow)}
              note={
                inflowsResponse.error
                  ? "Could not load inflows"
                  : inflows?.length
                    ? `Received from the client · ${inflows.length} payment${inflows.length === 1 ? "" : "s"}`
                    : "No payment received yet"
              }
              accent
            />
          </div>
        </div>
      </div>

      {/* Packages: fits the page width, no horizontal scroll (owner, 2026-10-03). */}
      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full table-auto border-collapse tabular-nums">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className={PKG_TH}>PACKAGE</th>
              <th className={PKG_TH}>MANAGERS</th>
              <th className={cn(PKG_TH, "text-right")}>PO VALUE</th>
              <th className={cn(PKG_TH, "text-right")}>SUPPLY DC TILL DATE</th>
              <th className={cn(PKG_TH, "text-right text-amber-700")}>BILLED TILL DATE</th>
              <th className={cn(PKG_TH, "text-right text-green-700")}>APPROVED TILL DATE</th>
              <th className={cn(PKG_TH, "w-[18%]")}>PROGRESS VS PO</th>
              <th className={cn(PKG_TH, "text-center")}>BILLS</th>
              {canEditPackage && <th className={cn(PKG_TH, "text-center")}>EDIT</th>}
            </tr>
          </thead>
          <tbody>
            {trackers.map((t) => {
              const fresh = dcFreshness(t.dc_updated_on);
              return (
                <tr key={t.name} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className={PKG_TD}>
                    <PackageChip label={t.package} className="inline-block whitespace-normal" />
                  </td>
                  <td className={PKG_TD}>
                    <PersonChips names={managerNames(t.billing_managers)} />
                  </td>
                  <td className={cn(PKG_TD, "text-right text-sm font-medium")}>
                    {t.po_value ? <Money value={t.po_value} /> : <span className="text-muted-foreground">Not set</span>}
                  </td>
                  <td className={cn(PKG_TD, "text-right")}>
                    <div className="text-sm font-medium">
                      <Money value={t.supply_dc} />
                    </div>
                    <div className="mt-1">
                      <ToneTag label={fresh.label} tone={fresh.tone} className="inline-block whitespace-normal" />
                    </div>
                  </td>
                  <td className={cn(PKG_TD, "text-right text-sm font-semibold text-amber-700")}>
                    {t.billed ? <Money value={t.billed} /> : <span className="text-muted-foreground">—</span>}
                    {t.po_value > 0 && t.billed > 0 && (
                      <div className="mt-0.5 text-[11px] font-normal text-muted-foreground">{pct(t.billed, t.po_value)}% of PO</div>
                    )}
                  </td>
                  <td className={cn(PKG_TD, "text-right text-sm font-semibold text-green-700")}>
                    {t.approved ? <Money value={t.approved} /> : <span className="text-muted-foreground">—</span>}
                    {t.po_value > 0 && t.approved > 0 && (
                      <div className="mt-0.5 text-[11px] font-normal text-muted-foreground">{pct(t.approved, t.po_value)}% of PO</div>
                    )}
                  </td>
                  <td className={PKG_TD}>
                    <div className="min-w-[80px]">
                      <ApprovalBar approved={t.approved} billed={t.billed} total={t.po_value > 0 ? t.po_value : t.billed} />
                    </div>
                    <div className="mt-1.5 text-[11px] text-muted-foreground">{progressNote(t.billed, t.approved)}</div>
                  </td>
                  <td className={cn(PKG_TD, "text-center text-sm font-semibold")}>{t.bill_count}</td>
                  {canEditPackage && (
                    <td className={cn(PKG_TD, "text-center")}>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Edit ${t.package}`}
                        onClick={() => setEditingName(t.name)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bills: the app's standard DataTable (facets on Package / Bill Type / Status). */}
      <div className="pt-2">
        <h2 className="text-lg font-bold text-gray-900">Bills</h2>
        <p className="text-sm text-muted-foreground">Every bill in this project. Filter from the column headers.</p>
      </div>

      <PackageTabs packages={trackers} total={summary?.bill_count ?? 0} value={pkg} onChange={setPkg} />

      <BillsDataTable
        scopeFilters={scopeFilters}
        trackers={trackers}
        projectNameOf={projectNameOf}
        urlSyncKey={`project_bills_${projectId}`}
        exportFileName={`${projectLabel}_Bills`}
        addBillFor={{ project: projectId, onSetupPackages: () => setSetupOpen(true) }}
      />

      <SetupBillingDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        project={projectId}
        projectLabel={projectLabel}
        trackers={trackers}
      />
      <SupplyDcSheet open={dcOpen} onOpenChange={setDcOpen} trackers={dcTrackers} />
      <EditPackageDialog project={projectId} tracker={editing} onClose={() => setEditingName(null)} />
    </div>
  );
}
