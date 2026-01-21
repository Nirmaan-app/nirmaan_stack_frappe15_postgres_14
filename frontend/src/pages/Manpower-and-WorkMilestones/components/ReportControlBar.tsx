import React from 'react';
import { Trash2 } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateForInput, getZoneStatusIndicator, ProjectZoneEntry, ZoneProgressInfo } from '../utils/milestoneHelpers';

interface ReportControlBarProps {
  // Project data
  projectData: any;
  projectName?: string;

  // Zone state
  selectedZone: string | null;
  validationZoneProgress: Map<string, ZoneProgressInfo>;
  onZoneChange: (zone: string) => void;

  // Date state (only shown for Daily)
  displayDate: Date;
  onDateChange: (date: Date) => void;

  // Report type state
  reportType: 'Daily' | 'Overall';
  onReportTypeChange: (type: 'Daily' | 'Overall') => void;

  // User role for hiding Overall tab
  userRole?: string;

  // Delete functionality (optional)
  showDeleteButton?: boolean;
  canDelete?: boolean;
  isDeleting?: boolean;
  onDeleteClick?: () => void;
}

export const ReportControlBar: React.FC<ReportControlBarProps> = ({
  projectData,
  projectName,
  selectedZone,
  validationZoneProgress,
  onZoneChange,
  displayDate,
  onDateChange,
  reportType,
  onReportTypeChange,
  userRole,
  showDeleteButton = false,
  canDelete = false,
  isDeleting = false,
  onDeleteClick,
}) => {
  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 p-4 shadow-sm border border-gray-300 rounded-md gap-3">
      {/* Project Name */}
      <div className="font-bold text-lg text-gray-800 flex items-center gap-2">
        <span className="font-semibold text-gray-700 whitespace-nowrap">Project:</span>
        {projectName || projectData?.project_name || "Daily Report Summary"}
      </div>

      {/* Zone Tabs (with status badges) */}
      {projectData?.project_zones?.length > 0 && (
        <div className="border border-gray-200 rounded bg-white">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex-shrink-0">
              Zone
            </span>
            <div className="flex flex-wrap gap-1.5">
              {projectData.project_zones.map((zone: ProjectZoneEntry) => {
                const zoneStatus = validationZoneProgress.get(zone.zone_name);
                const statusData = getZoneStatusIndicator(zoneStatus ? zoneStatus.status : null);

                return (
                  <button
                    key={zone.zone_name}
                    type="button"
                    onClick={() => onZoneChange(zone.zone_name)}
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
              })}
            </div>
          </div>
        </div>
      )}

      {/* Right side controls: Delete, Date, Report Type Toggle */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
        {/* Date picker and Delete button (only for Daily) */}
        {reportType === 'Daily' && (
          <>
            {/* Delete button */}
            {showDeleteButton && canDelete && (
              <Button
                variant="outline"
                size="icon"
                onClick={onDeleteClick}
                disabled={isDeleting}
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
                onChange={(e) => onDateChange(new Date(e.target.value))}
                className="pl-3 pr-10 py-2 border border-gray-300 rounded-md text-sm cursor-pointer w-full"
              />
            </div>
          </>
        )}

        {/* Report Type Toggle */}
        <div className="flex rounded-md border border-gray-300 overflow-hidden w-full md:w-auto">
          <button
            className={`flex-1 px-4 py-2 text-sm font-medium ${
              reportType === 'Daily' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'
            }`}
            onClick={() => onReportTypeChange('Daily')}
          >
            Daily
          </button>
          {/* Hide Overall for Project Manager role */}
          {userRole !== 'Nirmaan Project Manager Profile' && (
            <button
              className={`flex-1 px-4 py-2 text-sm font-medium ${
                reportType === 'Overall' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'
              }`}
              onClick={() => onReportTypeChange('Overall')}
            >
              Overall
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportControlBar;
