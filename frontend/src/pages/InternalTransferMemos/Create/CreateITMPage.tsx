// New Transfer page: the one place an Internal Transfer Memo is created.
//
// Reached from the "Create Internal Transfer Memo" button on the Inventory / Warehouse tab
// bar (InventoryWarehouseLayout), with no direction chosen. `?type=` preselects one; the
// old /warehouse/request URL redirects here with `?type=warehouse-to-project`.
// The user picks a direction, then the source and the
// destination, then ticks items from THAT source only. One submit creates one ITM.
// The rules (directions per role, rows per source, the payload) are in utils/itmTransfer.ts.

import { useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowLeftRight, ArrowRight, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import {
  FuzzySearchSelect,
  type FuzzyOptionType,
} from "@/components/ui/fuzzy-search-select";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useUserData } from "@/hooks/useUserData";
import { ITM_SOURCE_SCOPED_ROLES } from "@/constants/itm";
import { getFrappeError } from "@/utils/frappeErrors";
import formatToIndianRupee from "@/utils/FormatPrice";
import { cn } from "@/lib/utils";
import type { Projects } from "@/types/NirmaanStack/Projects";
import { useWarehouseStock } from "@/pages/Warehouse/hooks/useWarehouseStock";
import {
  allowedTransferDirections,
  buildTransferPayload,
  effectiveDirection,
  parseTransferDirection,
  pickedTotals,
  projectStockRows,
  projectsWithStock,
  sourceIsWarehouse,
  targetIsWarehouse,
  warehouseStockRows,
  type TransferDirection,
} from "@/utils/itmTransfer";
import { TransferDirectionPicker } from "./components/TransferDirectionPicker";
import { TransferRouteCard } from "./components/TransferRouteCard";
import { TransferStockTable } from "./components/TransferStockTable";
import { TransferRequestPreviewDialog } from "./TransferRequestPreviewDialog";
import { useInventoryPickerData } from "./hooks/useInventoryPickerData";
import { useCreateITMs } from "./hooks/useCreateITMs";

interface ProjectOption extends FuzzyOptionType {
  label: string;
  value: string;
}

const PROJECT_SEARCH_CONFIG = {
  searchFields: ["label", "value"],
  minSearchLength: 1,
  partialMatch: true,
  fieldWeights: { label: 2, value: 1 },
};

/** One labelled figure in the summary bar. */
function SummaryStat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("truncate text-sm tabular-nums", strong ? "font-bold text-primary" : "font-medium")}>
        {value}
      </span>
    </div>
  );
}

/** The warehouse side of a direction: fixed, there is only one warehouse. */
function WarehouseSide() {
  return (
    <div className="flex h-[38px] items-center gap-2 rounded-md border bg-muted px-3 text-sm">
      <Warehouse className="h-4 w-4 text-primary" />
      <span className="font-medium">Warehouse</span>
      <span className="ml-auto text-xs text-muted-foreground">Default</span>
    </div>
  );
}

export default function CreateITMPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { role, user_id } = useUserData();
  const allowed = useMemo(() => allowedTransferDirections(role, user_id), [role, user_id]);

  const [chosen, setChosen] = useState<TransferDirection | null>(() =>
    parseTransferDirection(searchParams.get("type"))
  );
  const [source, setSource] = useState<ProjectOption | null>(null);
  const [target, setTarget] = useState<ProjectOption | null>(null);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [previewOpen, setPreviewOpen] = useState(false);

  // A `?type=` this role may not use counts as unchosen (a Project Manager or Lead on
  // the old Request from Warehouse link), and a role with a single direction gets it
  // preselected.
  const direction = effectiveDirection(chosen, allowed);
  const fromWarehouse = sourceIsWarehouse(direction);
  const toWarehouse = targetIsWarehouse(direction);

  // Fetch only the stock the direction can draw from.
  const picker = useInventoryPickerData("", !!direction && !fromWarehouse);
  const warehouse = useWarehouseStock("", fromWarehouse);
  const { create, isLoading: isCreating } = useCreateITMs();

  // A source-scoped role (Project Manager / Lead) may only return stock from its own
  // projects: the projects it can read, since Frappe applies its User Permissions.
  // Other roles pick from every project's stock, so this list is only fetched for them.
  const scopeSource = ITM_SOURCE_SCOPED_ROLES.includes(role);
  const { data: ownProjects, isLoading: ownProjectsLoading } = useFrappeGetDocList<Projects>(
    "Projects",
    { fields: ["name"], limit: 0 },
    scopeSource ? "itm-own-projects" : null
  );
  const sourceOptions = useMemo<ProjectOption[]>(() => {
    if (!scopeSource) return projectsWithStock(picker.items);
    return projectsWithStock(picker.items, new Set((ownProjects ?? []).map((p) => p.name)));
  }, [picker.items, ownProjects, scopeSource]);

  // Destination projects: every Won project, regardless of the user's own project
  // assignments (Admin / PMO / Procurement may send to any project), so it comes from a
  // server method instead of a permission-filtered list. Fetched only when the
  // destination is a project.
  const needsTargetProject = !!direction && !toWarehouse;
  const destinations = useFrappeGetCall<{ message: { name: string; project_name: string | null }[] }>(
    "nirmaan_stack.api.internal_transfers.get_transfer_destinations.get_transfer_destinations",
    undefined,
    needsTargetProject ? "itm-transfer-destinations" : null
  );
  const targetOptions = useMemo<ProjectOption[]>(
    () =>
      (destinations.data?.message ?? [])
        .map((p) => ({ label: p.project_name || p.name, value: p.name }))
        .filter((o) => o.value !== source?.value)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [destinations.data, source?.value]
  );

  const rows = useMemo(() => {
    if (fromWarehouse) return warehouseStockRows(warehouse.data?.message ?? []);
    return source ? projectStockRows(picker.items, source.value) : [];
  }, [fromWarehouse, warehouse.data, picker.items, source]);

  const check = useMemo(
    () =>
      buildTransferPayload(
        {
          direction,
          sourceProject: source?.value ?? null,
          targetProject: target?.value ?? null,
          picks,
        },
        rows
      ),
    [direction, source?.value, target?.value, picks, rows]
  );

  const pickedItems = useMemo(
    () => rows.filter((r) => r.key in picks).map((r) => ({ ...r, qty: picks[r.key] })),
    [rows, picks]
  );
  const pickCount = Object.keys(picks).length;

  if (role === "Loading") return <LoadingFallback />;
  if (role && allowed.length === 0) {
    return <Navigate to="/internal-transfer-memos" replace />;
  }

  const hasSource = fromWarehouse || !!source;
  const fromLabel = fromWarehouse ? "Warehouse" : source?.label ?? "";
  const toLabel = toWarehouse ? "Warehouse" : target?.label ?? "";
  const stockError = fromWarehouse ? warehouse.error : picker.error;
  const stockLoading = fromWarehouse ? warehouse.isLoading : picker.isLoading;
  const totals = pickedTotals(rows, picks);
  const stockCount = `${rows.length} item${rows.length === 1 ? "" : "s"} in stock`;

  // One muted line under each route card.
  const sourceHint = hasSource
    ? stockLoading ? "Loading stock..." : stockCount
    : scopeSource ? "Only your assigned projects with stock are listed." : "Projects with stock available.";
  const targetHint = destinations.error
    ? `Couldn't load the projects: ${getFrappeError(destinations.error) || "please try again."}`
    : toWarehouse ? "Material goes back to the warehouse." : "Won projects only.";

  const chooseDirection = (d: TransferDirection) => {
    if (d === direction) return;
    setChosen(d);
    setSource(null);
    setTarget(null);
    setPicks({});
  };

  // Picks belong to the source they were made from, so a new source starts empty.
  const chooseSource = (opt: ProjectOption | null) => {
    setSource(opt);
    setPicks({});
    if (opt && target?.value === opt.value) setTarget(null);
  };

  const handleCreate = async () => {
    if (!check.ok) return;
    try {
      const result = await create(check.payload);
      const names = result?.message?.itms ?? [];
      toast({
        title: names.length ? `Transfer memo ${names.join(", ")} created` : "Transfer memo created",
        variant: "success",
      });
      setPreviewOpen(false);
      navigate("/internal-transfer-memos?tab=Approved");
    } catch (e) {
      toast({
        title: "Failed to create transfer memo",
        description: getFrappeError(e) || "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-4 px-4 pt-2 pb-6">
      {/* Header + summary, pinned to the top: title on the left; route, items, estimated
          value and the actions on the right (owner wanted the summary at the top). */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-x-8 gap-y-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ArrowLeftRight className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight">New Transfer</h1>
            <p className="text-xs text-muted-foreground">Each submit creates one transfer memo.</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-8 gap-y-2">
          <SummaryStat label="Route" value={`${fromLabel || "—"} → ${toLabel || "—"}`} />
          <SummaryStat label="Items" value={String(totals.items)} />
          <SummaryStat label="Est. Value" value={formatToIndianRupee(totals.value)} strong />
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate(-1)} disabled={isCreating}>
              Cancel
            </Button>
            <Button
              disabled={!check.ok || isCreating}
              onClick={() => setPreviewOpen(true)}
              title={check.ok ? undefined : check.reason}
            >
              Review Transfer
            </Button>
          </div>
        </div>
        {!check.ok && direction && (
          <p className="w-full text-right text-xs text-muted-foreground">{check.reason}</p>
        )}
      </div>

      {/* Transfer type first, in its own card. Shown even with a single direction
          (Project Manager / Lead: Project → Warehouse, preselected) so the user sees
          what kind of transfer this is (owner, 2026-10-16). */}
      {allowed.length > 0 && (
        <section className="rounded-lg border bg-card p-4 shadow-sm flex flex-wrap items-center gap-x-6 gap-y-2">
          <Label className="text-sm font-semibold">Transfer type</Label>
          <TransferDirectionPicker
            allowed={allowed}
            value={direction}
            onChange={chooseDirection}
            disabled={isCreating}
          />
        </section>
      )}

      {/* Route: From → To, as two "account" cards */}
      {!direction ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Choose a transfer type to pick where the material comes from and where it goes.
        </p>
      ) : (
        <section className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <TransferRouteCard side="From" kind={fromWarehouse ? "Warehouse" : "Project"} hint={sourceHint}>
            {fromWarehouse ? (
              <WarehouseSide />
            ) : (
              <FuzzySearchSelect<ProjectOption>
                allOptions={sourceOptions}
                value={source}
                onChange={(opt) => chooseSource(opt as ProjectOption | null)}
                tokenSearchConfig={PROJECT_SEARCH_CONFIG}
                isClearable
                isLoading={picker.isLoading || (scopeSource && ownProjectsLoading)}
                placeholder="Search and select source project..."
              />
            )}
          </TransferRouteCard>
          <div className="flex items-center justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border bg-background shadow-sm">
              <ArrowRight className="h-4 w-4 rotate-90 text-primary md:rotate-0" />
            </span>
          </div>
          <TransferRouteCard
            side="To"
            kind={toWarehouse ? "Warehouse" : "Project"}
            hint={targetHint}
            hintIsError={!!destinations.error}
          >
            {toWarehouse ? (
              <WarehouseSide />
            ) : (
              <FuzzySearchSelect<ProjectOption>
                allOptions={targetOptions}
                value={target}
                onChange={(opt) => setTarget(opt as ProjectOption | null)}
                tokenSearchConfig={PROJECT_SEARCH_CONFIG}
                isClearable
                isLoading={destinations.isLoading}
                placeholder="Search and select destination project..."
              />
            )}
          </TransferRouteCard>
        </section>
      )}

      {/* Items of the chosen source only */}
      <section className="rounded-lg border bg-card p-4 shadow-sm space-y-3 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Transfer Items</h2>
          {hasSource && (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {fromLabel} stock only
            </span>
          )}
          {pickCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7"
              onClick={() => setPicks({})}
              disabled={isCreating}
            >
              Clear selection ({pickCount})
            </Button>
          )}
        </div>
        {!hasSource ? (
          <p className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
            Choose where the material comes from to see its items.
          </p>
        ) : stockError ? (
          <AlertDestructive error={stockError} />
        ) : stockLoading ? (
          <LoadingFallback />
        ) : (
          <TransferStockTable
            key={fromWarehouse ? "warehouse" : source?.value}
            rows={rows}
            picks={picks}
            onPicksChange={setPicks}
            emptyText={`No stock available in ${fromLabel}.`}
          />
        )}
      </section>

      <TransferRequestPreviewDialog
        open={previewOpen}
        onOpenChange={(v) => !isCreating && setPreviewOpen(v)}
        fromLabel={fromLabel}
        toLabel={toLabel}
        items={pickedItems}
        onConfirm={handleCreate}
        isSubmitting={isCreating}
      />
    </div>
  );
}
