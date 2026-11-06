import { useCallback, useState } from "react";
import { useFrappeGetCall, useFrappeGetDoc } from "frappe-react-sdk";
import ProjectInventorySelect from "@/components/custom-select/ProjectInventorySelect";
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
        <ProjectInventorySelect onChange={handleProjectChange} />
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

  const { data: latestReport, isLoading: latestLoading } = useFrappeGetCall<{
    message: { report_date: string | null; submitted_by: string | null; submitted_by_full_name: string | null; items: Record<string, any> };
  }>(
    "nirmaan_stack.api.remaining_items_report.get_latest_remaining_quantities",
    { project: projectId },
    projectId ? `latest_report_${projectId}` : undefined
  );

  const todayExists = todayReport?.message?.exists ?? false;

  const [editOverride, setEditOverride] = useState(false);
  const mode: Mode = editOverride ? "edit" : todayExists ? "summary" : "create";

  const isLoading = itemsLoading || todayLoading || latestLoading;

  if (isLoading) return <LoadingFallback />;

  // A project with no eligible items still goes through the form: the PM submits an
  // empty report, which records today's inventory as updated.
  return (
    <>
      <DateMetadataBar
        hasProject={true}
        lastReport={
          latestReport?.message?.report_date
            ? {
                submitted_by_full_name: latestReport.message.submitted_by_full_name || latestReport.message.submitted_by || "",
                report_date: latestReport.message.report_date,
                isEmpty: Object.keys(latestReport.message.items ?? {}).length === 0,
              }
            : null
        }
        todayReportExists={todayExists}
      />
      {mode === "summary" ? (
        <ReportSummaryCard
          report={todayReport?.message}
          totalItems={eligibleItems.length}
          onEdit={() => setEditOverride(true)}
        />
      ) : (
        <RemainingItemsFormWrapper
          projectId={projectId}
          projectName={projectName}
          projectCity={projectCity}
          eligibleItems={eligibleItems}
          existingReport={todayReport?.message}
          mutateTodayReport={mutateTodayReport}
          onCancel={() => setEditOverride(false)}
          onSuccess={() => setEditOverride(false)}
          mode={mode}
          latestReportItems={latestReport?.message?.items ?? null}
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
  onCancel,
  onSuccess,
  mode,
  latestReportItems,
}: {
  projectId: string;
  projectName: string;
  projectCity: string;
  eligibleItems: any[];
  existingReport?: { exists: boolean; name?: string; status?: string; items?: any[] };
  mutateTodayReport: () => Promise<any>;
  onCancel: () => void;
  onSuccess: () => void;
  mode: Mode;
  latestReportItems: Record<string, any> | null;
}) {
  const {
    entries,
    handleQuantityChange,
    handleSubmit,
    isSubmitting,
    validationErrors,
    filledCount,
    totalCount,
    copyPreviousValues,
    hasPreviousReport,
  } = useRemainingItemsForm(projectId, eligibleItems, existingReport, async () => {
    await mutateTodayReport();
    onSuccess();
  }, latestReportItems);

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
      onCancel={mode === "edit" ? onCancel : undefined}
      filledCount={filledCount}
      totalCount={totalCount}
      onCopyPrevious={copyPreviousValues}
      hasPreviousReport={hasPreviousReport}
    />
  );
}
