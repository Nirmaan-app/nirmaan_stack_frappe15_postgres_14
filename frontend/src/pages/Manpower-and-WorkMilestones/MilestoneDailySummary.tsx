import React, { useState, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFrappeDeleteDoc } from 'frappe-react-sdk';

import { formatDate } from '@/utils/FormatDate';
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { Card, CardContent } from "@/components/ui/card";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { CEOHoldBanner } from "@/components/ui/ceo-hold-banner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Shared components
import { useMilestoneReportData } from './hooks/useMilestoneReportData';
import { ReportControlBar } from './components/ReportControlBar';
import { DailyReportView } from './components/DailyReportView';
import OverallMilestonesReport from './components/OverallMilestonesReport';
import { formatDateForInput, isDateToday } from './utils/milestoneHelpers';

// Re-export for backwards compatibility
export { MilestoneProgress } from './components/MilestoneProgress';
export { getZoneStatusIndicator } from './utils/milestoneHelpers';

// Hook to get query params from URL
const useQuery = () => {
  return new URLSearchParams(useLocation().search);
};

export const MilestoneDailySummary: React.FC = () => {
  const query = useQuery();
  const navigate = useNavigate();
  const location = useLocation();

  // Read initial values from URL params
  const initialProjectId = query.get('project_id') || '';
  const initialDateStr = query.get('report_date');
  const initialZone = query.get('zone');
  const initialDate = initialDateStr ? new Date(initialDateStr) : new Date();

  // User role for permissions
  const { role, user_id } = useUserData();

  // CEO Hold guard
  const { isCEOHold } = useCEOHoldGuard(initialProjectId);

  // Local state
  const [selectedZone, setSelectedZone] = useState<string | null>(initialZone);
  const [displayDate, setDisplayDate] = useState<Date>(initialDate);
  const [reportType, setReportType] = useState<'Daily' | 'Overall'>('Daily');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Delete hook
  const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();

  // Permission checks
  const canDeleteReport = user_id === "Administrator" ||
    ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role || "");

  const isToday = useMemo(() => isDateToday(displayDate), [displayDate]);

  // Use shared data hook
  const {
    projectData,
    dailyReportDetails,
    workPlanGroups,
    milestoneGroups,
    validationZoneProgress,
    totalWorkHeaders,
    completedWorksOnReport,
    totalManpowerInReport,
    isLoading,
    projectLoading,
    projectError,
    reportForDisplayDateName,
    mutateProgressReports,
    mutateAllReportsForDate,
    workHeaderOrderMap,
    workMilestonesList,
  } = useMilestoneReportData({
    projectId: initialProjectId,
    selectedZone,
    displayDate,
    reportType,
  });

  // Handler for Zone Tab Click - updates URL
  const handleZoneChange = useCallback((zoneName: string) => {
    setSelectedZone(zoneName);
    const params = new URLSearchParams(location.search);
    params.set('zone', zoneName);
    navigate(`?${params.toString()}`);
  }, [location.search, navigate]);

  // Handler for Date Change - updates URL
  const handleDateChange = useCallback((newDate: Date) => {
    setDisplayDate(newDate);
    const params = new URLSearchParams(location.search);
    params.set('report_date', formatDateForInput(newDate));
    navigate(`?${params.toString()}`);
  }, [location.search, navigate]);

  // Handler for deleting today's report
  const handleDeleteReport = useCallback(async () => {
    if (!reportForDisplayDateName) {
      toast({
        title: "Error",
        description: "No report found to delete.",
        variant: "destructive",
      });
      return;
    }

    try {
      await deleteDoc("Project Progress Reports", reportForDisplayDateName);

      // Refetch queries to update UI
      await Promise.all([
        mutateProgressReports?.(),
        mutateAllReportsForDate?.(),
      ]);

      toast({
        title: "Report Deleted",
        description: `Progress report for ${selectedZone || 'this zone'} has been deleted.`,
        variant: "success",
      });

      setShowDeleteConfirm(false);
    } catch (error: any) {
      console.error("Error deleting report:", error);
      toast({
        title: "Delete Failed",
        description: error?.message || "Failed to delete the report. Please try again.",
        variant: "destructive",
      });
    }
  }, [reportForDisplayDateName, deleteDoc, mutateProgressReports, mutateAllReportsForDate, selectedZone]);

  // Loading and error states
  if (!initialProjectId) return <h1>No Project ID found in URL.</h1>;
  if (projectLoading || isLoading) return <h1>Loading...</h1>;
  if (projectError) return <h1>Error loading project data.</h1>;

  return (
    <>
      <div className="flex-1 space-y-4 min-h-[50vh]">
        {isCEOHold && <CEOHoldBanner className="mb-4" />}
        <div className="mx-0 px-0 pt-4">
          {/* Control Bar with zones, date, report type toggle, and delete button */}
          <ReportControlBar
            projectData={projectData}
            projectId={initialProjectId}
            selectedZone={selectedZone}
            validationZoneProgress={validationZoneProgress}
            onZoneChange={handleZoneChange}
            displayDate={displayDate}
            onDateChange={handleDateChange}
            reportType={reportType}
            onReportTypeChange={setReportType}
            userRole={role}
            showDeleteButton={isToday && !!reportForDisplayDateName}
            canDelete={canDeleteReport}
            isDeleting={deleteLoading}
            onDeleteClick={() => setShowDeleteConfirm(true)}
          />

          {/* Report Content */}
          {reportType === 'Daily' ? (
            <DailyReportView
              dailyReportDetails={dailyReportDetails}
              projectData={projectData}
              selectedZone={selectedZone}
              displayDate={displayDate}
              workPlanGroups={workPlanGroups}
              milestoneGroups={milestoneGroups}
              totalWorkHeaders={totalWorkHeaders}
              completedWorksOnReport={completedWorksOnReport}
              totalManpowerInReport={totalManpowerInReport}
              workMilestonesList={workMilestonesList}
              workHeaderOrderMap={workHeaderOrderMap}
            />
          ) : (
            <Card className="mt-4">
              <CardContent>
                <OverallMilestonesReport
                  selectedProject={initialProjectId}
                  projectData={projectData}
                  selectedZone={selectedZone}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Today's Report?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the progress report for{' '}
              <span className="font-semibold">{selectedZone || 'this zone'}</span> dated{' '}
              <span className="font-semibold">{formatDate(displayDate)}</span>.
              <br />
              <br />
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteReport}
              disabled={deleteLoading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteLoading ? "Deleting..." : "Delete Report"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default MilestoneDailySummary;
