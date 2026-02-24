import { useCallback, useEffect, useState } from "react";
import { useFrappeGetCall, useFrappeGetDoc } from "frappe-react-sdk";
import ProjectSelect from "@/components/custom-select/project-select";
import { RemainingItemsForm } from "./components/RemainingItemsForm";
import DateMetadataBar from "./components/DateMetadataBar";
import { ReportSummaryCard } from "./components/ReportSummaryCard";
import { useEligibleItems } from "./hooks/useEligibleItems";
import { useRemainingItemsForm } from "./hooks/useRemainingItemsForm";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";

type Mode = "create" | "summary" | "edit";

// Lazy export for route
export function Component() {
  const [selectedProject, setSelectedProject] = useState<{ value: string; label: string } | null>(null);

  const handleProjectChange = useCallback((option: { value: string; label: string } | null) => {
    setSelectedProject(option);
  }, []);

  return (
    <div className="flex-1 space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Update Inventory</h2>
      {!selectedProject && <DateMetadataBar hasProject={false} lastReport={null} todayReportExists={false} />}
      <div className="max-w-sm">
        <ProjectSelect onChange={handleProjectChange} universal={false} />
      </div>
      {selectedProject ? (
        <UpdateInventoryContent projectId={selectedProject.value} projectName={selectedProject.label} />
      ) : (
        <p className="text-sm text-muted-foreground">Select a project to update inventory.</p>
      )}
    </div>
  );
}

function UpdateInventoryContent({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { eligibleItems, isLoading: itemsLoading } = useEligibleItems(projectId);
  const { data: projectDoc } = useFrappeGetDoc("Projects", projectId);
  const projectCity = (projectDoc as any)?.project_city || "";

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const { data: todayReport, isLoading: todayLoading, mutate: mutateTodayReport } = useFrappeGetCall<{
    message: { exists: boolean; name?: string; status?: string; items?: any[] };
  }>(
    "nirmaan_stack.api.remaining_items_report.get_today_report_for_project",
    { project: projectId },
    projectId ? `today_report_${projectId}_${todayStr}` : undefined
  );

  const { data: latestReport } = useFrappeGetCall<{
    message: { report_date: string | null; submitted_by: string | null; submitted_by_full_name: string | null; items: Record<string, any> };
  }>(
    "nirmaan_stack.api.remaining_items_report.get_latest_remaining_quantities",
    { project: projectId },
    projectId ? `latest_report_${projectId}` : undefined
  );

  const todayExists = todayReport?.message?.exists ?? false;

  const lastReportDate = latestReport?.message?.report_date;
  const daysSinceLastReport = lastReportDate
    ? Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(lastReportDate + "T00:00:00").getTime()) / 86400000)
    : Infinity;
  const isWithinCooldown = !todayExists && daysSinceLastReport < 3;
  const daysUntilNextUpdate = isWithinCooldown ? 3 - daysSinceLastReport : 0;

  const [mode, setMode] = useState<Mode>("create");

  useEffect(() => {
    if (todayExists) setMode("summary");
    else if (isWithinCooldown) setMode("summary");
    else setMode("create");
  }, [todayExists, isWithinCooldown]);

  const isLoading = itemsLoading || todayLoading;

  const cooldownReport = isWithinCooldown ? {
    exists: true,
    status: "Submitted",
    submitted_by: latestReport?.message?.submitted_by_full_name || latestReport?.message?.submitted_by || "",
    modified: latestReport?.message?.report_date || "",
    items: Object.values(latestReport?.message?.items || {}).map((item: any) => ({
      remaining_quantity: item.remaining_quantity,
    })),
  } : null;

  if (isLoading) return <LoadingFallback />;

  if (!eligibleItems || eligibleItems.length === 0) {
    return (
      <>
        <DateMetadataBar
          hasProject={true}
          lastReport={
            latestReport?.message?.report_date
              ? { submitted_by_full_name: latestReport.message.submitted_by_full_name || latestReport.message.submitted_by || "", report_date: latestReport.message.report_date }
              : null
          }
          todayReportExists={todayExists}
        />
        <p className="text-sm text-muted-foreground">No high-value items (per-unit quote &gt; &#8377;5,000) found for this project.</p>
      </>
    );
  }

  return (
    <>
      <DateMetadataBar
        hasProject={true}
        lastReport={
          latestReport?.message?.report_date
            ? { submitted_by_full_name: latestReport.message.submitted_by_full_name || latestReport.message.submitted_by || "", report_date: latestReport.message.report_date }
            : null
        }
        todayReportExists={todayExists}
      />
      {mode === "summary" ? (
        <ReportSummaryCard
          report={isWithinCooldown ? cooldownReport : todayReport?.message}
          totalItems={eligibleItems.length}
          onEdit={isWithinCooldown ? undefined : () => setMode("edit")}
          cooldownMessage={isWithinCooldown
            ? `Next update available in ${daysUntilNextUpdate} day${daysUntilNextUpdate !== 1 ? "s" : ""}`
            : undefined}
        />
      ) : (
        <RemainingItemsFormWrapper
          projectId={projectId}
          projectName={projectName}
          projectCity={projectCity}
          eligibleItems={eligibleItems}
          existingReport={todayReport?.message}
          mutateTodayReport={mutateTodayReport}
          setMode={setMode}
          mode={mode}
        />
      )}
    </>
  );
}

function RemainingItemsFormWrapper({
  projectId,
  projectName,
  projectCity,
  eligibleItems,
  existingReport,
  mutateTodayReport,
  setMode,
  mode,
}: {
  projectId: string;
  projectName: string;
  projectCity: string;
  eligibleItems: any[];
  existingReport?: { exists: boolean; name?: string; status?: string; items?: any[] };
  mutateTodayReport: () => Promise<any>;
  setMode: (mode: Mode) => void;
  mode: Mode;
}) {
  const {
    entries,
    handleQuantityChange,
    handleSubmit,
    isSubmitting,
    validationErrors,
    filledCount,
    totalCount,
  } = useRemainingItemsForm(projectId, eligibleItems, existingReport, async () => {
    await mutateTodayReport();
    setMode("summary");
  });

  return (
    <RemainingItemsForm
      projectName={projectName}
      projectCity={projectCity}
      entries={entries}
      onQuantityChange={handleQuantityChange}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      validationErrors={validationErrors}
      isEditing={mode === "edit"}
      onCancel={mode === "edit" ? () => setMode("summary") : undefined}
      filledCount={filledCount}
      totalCount={totalCount}
    />
  );
}
