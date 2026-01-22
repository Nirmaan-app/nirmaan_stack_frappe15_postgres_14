import React, { useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFrappeDeleteDoc } from 'frappe-react-sdk';
import { Trash2 } from 'lucide-react';

import { UserContext } from "@/utils/auth/UserProvider";
import { useUserData } from "@/hooks/useUserData";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
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
import ProjectMilestoneSelect from "@/components/custom-select/project-milestone-select";
import { formatDate } from '@/utils/FormatDate';

// Shared components
import { useMilestoneReportData } from './hooks/useMilestoneReportData';
import { DailyReportView } from './components/DailyReportView';
import OverallMilestonesReport from './components/OverallMilestonesReport';
import { CopyReportButton } from './components/CopyReportButton';
import { getZoneStatusIndicator, formatDateForInput, isDateToday } from './utils/milestoneHelpers';

// Re-export for backwards compatibility
export { MilestoneProgress } from './components/MilestoneProgress';

interface MilestonesSummaryProps {
  workReport?: boolean;
  projectIdForWorkReport?: string;
  // parentSelectedZone?: string | null;
}

export const MilestonesSummary: React.FC<MilestonesSummaryProps> = ({
  workReport = false,
  projectIdForWorkReport,
  // parentSelectedZone = null,
}) => {
  const { selectedProject, setSelectedProject } = useContext(UserContext);
  const navigate = useNavigate();
  const { role, user_id } = useUserData();

  const [searchParams] = useState(new URLSearchParams(window.location.search));

  // Local state
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [displayDate, setDisplayDate] = useState<Date>(new Date());
  const [reportType, setReportType] = useState<'Daily' | 'Overall'>('Daily');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Delete hook
  const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();

  // Permission checks for delete
  const canDeleteReport = user_id === "Administrator" ||
    ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role || "");

  const isToday = useMemo(() => isDateToday(displayDate), [displayDate]);

  // Set selected project when in work report mode
  useEffect(() => {
    if (workReport && projectIdForWorkReport) {
      setSelectedProject(projectIdForWorkReport);
    }
  }, [workReport, projectIdForWorkReport, setSelectedProject]);

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
    projectId: selectedProject,
    selectedZone,
    displayDate,
    reportType,
  });

  // Effect to initialize selectedZone
  useEffect(() => {
    if (!projectData || !selectedProject) {
      setSelectedZone(null);
      return;
    }

    // Parent control for work report mode
    // if (workReport && parentSelectedZone !== null) {
    //   setSelectedZone(parentSelectedZone);
    //   return;
    // }

    const currentProjectZones = projectData.project_zones?.map((z: any) => z.zone_name) || [];

    // Reset zone if current zone is not in the new project's zones
    if (selectedZone !== null && !currentProjectZones.includes(selectedZone)) {
      setSelectedZone(null);
      return;
    }

    // Zone selection logic
    if (selectedZone === null && currentProjectZones.length > 0) {
      // Check URL for zone parameter
      const urlZone = searchParams.get('zone');
      if (urlZone && currentProjectZones.includes(urlZone)) {
        setSelectedZone(urlZone);
        return;
      }

      // Select first available zone
      const firstZoneName = currentProjectZones[0];
      if (firstZoneName) {
        setSelectedZone(firstZoneName);
      }
    }
  }, [projectData, selectedProject, workReport, selectedZone, searchParams]);

  // Handle project selection change
  const handleProjectChange = useCallback((selectedItem: any) => {
    setSelectedProject(selectedItem ? selectedItem.value : null);
    if (selectedItem) {
      sessionStorage.setItem("selectedProject", JSON.stringify(selectedItem.value));
    } else {
      sessionStorage.removeItem("selectedProject");
    }
  }, [setSelectedProject]);

  // Handle zone selection (updates state and sessionStorage only)
  // Note: We don't navigate/update URL because it causes component remount which resets displayDate
  const handleZoneChange = useCallback((zoneName: string) => {
    setSelectedZone(zoneName);
    sessionStorage.setItem("selectedZone", JSON.stringify(zoneName));
  }, []);

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
  if (projectLoading || isLoading) return <h1>Loading</h1>;
  if (projectError) {
    const specificErrorMessage = projectError?.message || "An unexpected issue occurred while fetching data.";
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 bg-red-50 text-red-800 rounded-lg shadow-md m-4">
        <h3 className="text-2xl font-bold mb-2 text-center text-red-900">
          Failed to Load Data!
        </h3>
        <p className="text-lg text-center text-red-700 mb-4">
          We encountered a problem trying to fetch the necessary project information.
        </p>
        <p className="text-md text-center text-red-600 mb-6">
          Error Details: <span className="font-semibold">{specificErrorMessage}</span>
        </p>
        <Button
          onClick={() => {
            sessionStorage.removeItem('selectedProject');
            navigate('/prs&milestones/milestone-report');
          }}
          className="bg-red-600 hover:bg-red-700 text-white text-lg py-3 px-8 rounded-full shadow-lg transition-all duration-300 ease-in-out hover:scale-105"
        >
          Go Back to Reports Overview
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4">
      {/* Project Selector and Zone Actions (only when not in workReport mode) */}

      {workReport &&(
          <div className="border border-gray-200 rounded bg-white">
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex-shrink-0">
                    Zone
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {projectData?.project_zones?.length === 0 ? (
                      <div className="text-red-500 text-xs px-3 py-1.5 bg-red-50 border border-red-300 rounded">
                        Define Zones
                      </div>
                    ) : (
                      projectData?.project_zones?.map((zone: any) => {
                        const zoneStatus = validationZoneProgress.get(zone.zone_name);
                        const statusData = getZoneStatusIndicator(zoneStatus ? zoneStatus.status : null);
                        return (
                          <button
                            key={zone.zone_name}
                            type="button"
                            onClick={() => handleZoneChange(zone.zone_name)}
                            className={`px-3 py-1.5 text-sm rounded transition-colors flex items-center gap-1.5 ${
                              selectedZone === zone.zone_name
                                ? "bg-sky-500 text-white"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            {zone.zone_name}
                            <Badge variant="secondary" className={`p-0 ${statusData.color}`}>
                              {statusData.icon}
                            </Badge>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
      )}
      {!workReport && (
        <div className="flex flex-col gap-4 mb-2 w-full">
          {/* Project Select */}
          <div className="w-full flex-shrink-0">
            <ProjectMilestoneSelect
              onChange={handleProjectChange}
              universal={true}
            />
          </div>

          {/* Zone Tabs and Action Buttons */}
          {selectedProject && (
            <div className="flex flex-col w-full gap-4">
              {/* Zone Tab Section */}
              <div className="border border-gray-200 rounded bg-white">
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex-shrink-0">
                    Zone
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {projectData?.project_zones?.length === 0 ? (
                      <div className="text-red-500 text-xs px-3 py-1.5 bg-red-50 border border-red-300 rounded">
                        Define Zones
                      </div>
                    ) : (
                      projectData?.project_zones?.map((zone: any) => {
                        const zoneStatus = validationZoneProgress.get(zone.zone_name);
                        const statusData = getZoneStatusIndicator(zoneStatus ? zoneStatus.status : null);
                        return (
                          <button
                            key={zone.zone_name}
                            type="button"
                            onClick={() => handleZoneChange(zone.zone_name)}
                            className={`px-3 py-1.5 text-sm rounded transition-colors flex items-center gap-1.5 ${
                              selectedZone === zone.zone_name
                                ? "bg-sky-500 text-white"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            {zone.zone_name}
                            <Badge variant="secondary" className={`p-0 ${statusData.color}`}>
                              {statusData.icon}
                            </Badge>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons: Copy Report & Add Report */}
              {selectedProject && selectedZone && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 w-full p-2">
                  <div className="w-full">
                    <CopyReportButton
                      selectedProject={selectedProject}
                      selectedZone={selectedZone}
                      dailyReportDetailsDisable={reportType !== "Daily" || !!dailyReportDetails}
                    />
                  </div>
                  <Button
                    onClick={() => navigate(`${selectedProject}?zone=${selectedZone}`)}
                    className="text-sm w-full"
                    disabled={
                      !!dailyReportDetails ||
                      reportType !== "Daily" ||
                      !selectedProject ||
                      !selectedZone
                    }
                  >
                    {"Add Today's Report"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Report Content */}
      {selectedProject && (
        <div className="mx-0 px-0 pt-4">
          {/* Control Bar with report type toggle and date picker */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 p-4 shadow-sm border border-gray-300 rounded-md gap-3">
            <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
              <span className="font-semibold text-gray-700 whitespace-nowrap">Report Type</span>
              <div className="flex rounded-md border border-gray-300 overflow-hidden w-full md:w-auto">
                <button
                  className={`flex-1 px-4 py-2 text-sm font-medium ${
                    reportType === 'Daily' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'
                  }`}
                  onClick={() => setReportType('Daily')}
                >
                  Daily
                </button>
                {role !== 'Nirmaan Project Manager Profile' && (
                  <button
                    className={`flex-1 px-4 py-2  text-sm font-medium whitespace-nowrap ${
                      reportType === 'Overall' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'
                    }`}
                    onClick={() => setReportType('Overall')}
                  >
                    14 Days
                  </button>
                )}
              </div>
            </div>

            {reportType === 'Daily' && (
              <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
                {/* Delete button (only for today, with report, and authorized users) */}
                {isToday && reportForDisplayDateName && canDeleteReport && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deleteLoading}
                    className="h-9 w-9 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 flex-shrink-0"
                    title="Delete today's report for this zone"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}

                <span className="font-semibold text-gray-700 whitespace-nowrap">Report Date</span>
                <div className="relative w-full md:w-auto">
                  <input
                    type="date"
                    value={displayDate ? formatDateForInput(displayDate) : ''}
                    onChange={(e) => setDisplayDate(new Date(e.target.value))}
                    className="pl-3 pr-10 py-2 border border-gray-300 rounded-md text-sm cursor-pointer w-full"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Report Display */}
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
                  selectedProject={selectedProject}
                  projectData={projectData}
                  selectedZone={selectedZone}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

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
    </div>
  );
};

export default MilestonesSummary;
