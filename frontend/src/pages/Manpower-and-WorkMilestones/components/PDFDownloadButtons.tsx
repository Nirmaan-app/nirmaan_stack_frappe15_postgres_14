import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { format } from 'date-fns';
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
import { useUserData } from '@/hooks/useUserData';

interface ZoneProgressInfo {
  status: string | null;
}

interface PDFDownloadButtonsProps {
  projectId: string;
  projectName?: string;
  reportDate: Date;
  selectedZone: string | null;
  zones: string[];
  zoneProgress?: Map<string, ZoneProgressInfo>;
  disabled?: boolean;
}

// Helper to format date as YYYY-MM-DD for API
const formatDateForAPI = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper to generate filename
const generateFileName = (projectName: string, zone: string, date: Date): string => {
  const pName = (projectName || "Project").replace(/\s+/g, '_');
  const zoneSuffix = zone.replace(/\s+/g, '_');
  const dStr = format(date, "dd-MMM-yyyy");
  return `${pName}-${zoneSuffix}-${dStr}_DPR.pdf`;
};

// Force download helper using fetch
const forceDownload = async (url: string, filename: string): Promise<void> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Download failed');

  const blob = await response.blob();
  const blobUrl = window.URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(blobUrl);
};

export const PDFDownloadButtons: React.FC<PDFDownloadButtonsProps> = ({
  projectId,
  projectName = 'Project',
  reportDate,
  selectedZone,
  zones,
  zoneProgress,
  disabled = false,
}) => {
  const [isDownloadingZone, setIsDownloadingZone] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [isDownloadingOverall, setIsDownloadingOverall] = useState(false);

  // Admin flag — gates whether the "With Target Progress" option is offered.
  // The actual is_admin=1 query param is now decided at confirm time so the
  // admin can pick with/without target per download.
  const { user_id, role } = useUserData();
  const isAdmin = user_id === "Administrator" || role === "Nirmaan Admin Profile";

  // Dialog state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<'all_zones' | 'overall' | null>(null);
  const [missingZonesList, setMissingZonesList] = useState<string[]>([]);

  // Check if selected zone has a completed report
  const isSelectedZoneCompleted = useMemo(() => {
    if (!selectedZone || !zoneProgress) return false;
    const status = zoneProgress.get(selectedZone);
    return status?.status?.toLowerCase() === 'completed';
  }, [selectedZone, zoneProgress]);



  // Count completed zones
  const completedZonesCount = useMemo(() => {
    if (!zoneProgress) return 0;
    let count = 0;
    for (const [_, info] of zoneProgress) {
      if (info?.status?.toLowerCase() === 'completed') count++;
    }
    return count;
  }, [zoneProgress]);

  // // Download single zone PDF
  // const handleDownloadZone = async () => {
  //   if (!selectedZone) {
  //     toast({
  //       title: 'No Zone Selected',
  //       description: 'Please select a zone first.',
  //       variant: 'destructive',
  //     });
  //     return;
  //   }

  //   setIsDownloadingZone(true);

  //   try {
  //     // First get the report document name
  //     const dateStr = formatDateForAPI(reportDate);
  //     const response = await fetch(
  //       `/api/method/nirmaan_stack.api.milestone.print_milestone_reports.get_report_doc_name?` +
  //       `project_id=${encodeURIComponent(projectId)}&` +
  //       `report_date=${dateStr}&` +
  //       `zone=${encodeURIComponent(selectedZone)}`
  //     );

  //     const result = await response.json();

  //     if (!result.message?.report_name) {
  //       toast({
  //         title: 'No Report Found',
  //         description: `No completed report found for ${selectedZone} on ${dateStr}`,
  //         variant: 'destructive',
  //       });
  //       return;
  //     }

  //     // Generate filename and download URL
  //     const fileName = generateFileName(projectName, selectedZone, reportDate);
  //     const pdfUrl = `/api/method/frappe.utils.print_format.download_pdf?` +
  //       `doctype=Project Progress Reports&` +
  //       `name=${encodeURIComponent(result.message.report_name)}&` +
  //       `format=Milestone Report&` +
  //       `no_letterhead=0`;

  //     // Force download with proper filename
  //     await forceDownload(pdfUrl, fileName);

  //     toast({
  //       title: 'Download Complete',
  //       description: `Downloaded DPR for ${selectedZone}`,
  //       variant: 'default',
  //     });
  //   } catch (error) {
  //     console.error('Download failed:', error);
  //     toast({
  //       title: 'Download Failed',
  //       description: 'Failed to download the report. Please try again.',
  //       variant: 'destructive',
  //     });
  //   } finally {
  //     setIsDownloadingZone(false);
  //   }
  // };

  // Download all zones merged PDF.
  // includeTarget=true sends &is_admin=1 so the print format renders
  // Target Progress columns alongside Actual.
  const handleDownloadAllZones = async (includeTarget: boolean) => {
    if (!zones.length) {
      toast({
        title: 'No Zones Available',
        description: 'No zones found for this project.',
        variant: 'destructive',
      });
      return;
    }

    setIsDownloadingAll(true);

    try {
      const dateStr = formatDateForAPI(reportDate);
      const adminQ = includeTarget ? `&is_admin=1` : ``;
      const targetSuffix = includeTarget ? '_with_target' : '';

      const fileName = generateFileName(projectName, `All_Zones${targetSuffix}`, reportDate);

      const pdfUrl = `/api/method/nirmaan_stack.api.milestone.print_milestone_reports.get_merged_zone_reports_pdf?` +
        `project_id=${encodeURIComponent(projectId)}&` +
        `report_date=${dateStr}` +
        adminQ;

      await forceDownload(pdfUrl, fileName);

      toast({
        title: 'Download Complete',
        description: `Downloaded merged DPR for all zones${includeTarget ? ' with Target Progress' : ''}`,
        variant: 'default',
      });
    } catch (error) {
      console.error('Download failed:', error);
      toast({
        title: 'Download Failed',
        description: 'Failed to download the merged report. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDownloadingAll(false);
    }
  };


  // Download "All Zones 14 Days" merged PDF
  const handleDownloadOverall = async (includeTarget: boolean) => {
    setIsDownloadingOverall(true);
    try {
      const adminQ = includeTarget ? `&is_admin=1` : ``;
      const targetSuffix = includeTarget ? '_with_target' : '';
      const fileName = `${(projectName || 'Project').replace(/\s+/g, '_')}_Overall_14Days_AllZones${targetSuffix}.pdf`;

      const pdfUrl = `/api/method/nirmaan_stack.api.milestone.print_milestone_reports.get_all_zones_overall_report_pdf?` +
        `project_id=${encodeURIComponent(projectId)}` +
        adminQ;

      await forceDownload(pdfUrl, fileName);

      toast({
        title: "Download Complete",
        description: `Downloaded 14-Days Overall Report for All Zones${includeTarget ? ' with Target Progress' : ''}`,
        variant: "default",
      });

    } catch (e) {
      console.error("Download failed:", e);
      toast({
        title: "Download Failed",
        description: "Failed to download the report. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingOverall(false);
    }
  };

  // Decide whether to open the dialog (admin always sees it so they can
  // pick with/without target; non-admin only sees it when reports are missing).
  const handleCheckAndDownload = (type: 'all_zones' | 'overall') => {
    if (!zoneProgress) return;

    const missing: string[] = [];
    zones.forEach(zone => {
      const info = zoneProgress.get(zone);
      if (info?.status?.toLowerCase() !== 'completed') {
        missing.push(zone);
      }
    });

    setMissingZonesList(missing);
    setPendingAction(type);

    if (isAdmin || missing.length > 0) {
      setShowConfirmDialog(true);
    } else {
      // Non-admin, all zones complete → direct download without target.
      if (type === 'all_zones') handleDownloadAllZones(false);
      else handleDownloadOverall(false);
      setPendingAction(null);
    }
  };

  const handleConfirmDownload = (includeTarget: boolean) => {
    setShowConfirmDialog(false);
    if (pendingAction === 'all_zones') {
      handleDownloadAllZones(includeTarget);
    } else if (pendingAction === 'overall') {
      handleDownloadOverall(includeTarget);
    }
    setPendingAction(null);
  };


  // Validation Checks
  const isSingleZone = zones.length <= 1;
  const isEnoughCompleted = completedZonesCount >= 2;

  // Disable zone button if no zone selected OR zone not completed
  const isZoneButtonDisabled = disabled || isDownloadingZone || !selectedZone || !isSelectedZoneCompleted;

  // Disable all zones button checks
  // 1. Must have multiple zones
  // 2. Must have at least 2 completed zones
  const isAllZonesButtonDisabled = disabled || isDownloadingAll || isSingleZone || !isEnoughCompleted;

  // Disable overall button checks (same logic as All Zones DPR)
  const isOverallButtonDisabled = disabled || isDownloadingOverall || isSingleZone || !isEnoughCompleted;

  // Truncate zone name for button if too long
  // const zoneButtonLabel = selectedZone 
  //   ? (selectedZone.length > 12 ? `${selectedZone.slice(0, 10)}..` : selectedZone) + ' DPR'
  //   : 'Zone DPR';

  // const { role } = useUserData();
  const isProjectManager = role === "Nirmaan Project Manager Profile";

  return (
    <div className="flex items-center gap-2">
      {/* Zone DPR Button - shows current zone name */}
      {/* <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1 border-gray-300 text-gray-700 hover:bg-gray-100"
              onClick={handleDownloadZone}
              disabled={isZoneButtonDisabled}
            >
              {isDownloadingZone ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {zoneButtonLabel}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {!selectedZone 
              ? 'Select a zone first'
              : !isSelectedZoneCompleted 
                ? `No completed report for ${selectedZone}`
                : `Download DPR for ${selectedZone}`
            }
          </TooltipContent>
        </Tooltip>
      </TooltipProvider> */}

      {/* All Zones DPR Button */}
      {!isProjectManager && (
        <TooltipProvider>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="sm"
                className="h-8 text-xs gap-1 bg-red-600 hover:bg-red-700"
                onClick={() => handleCheckAndDownload('all_zones')}
                disabled={isAllZonesButtonDisabled}
              >
                {isDownloadingAll ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                All Zones DPR
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {isSingleZone
                ? 'All Zones report is available only when multiple zones exist.'
                : !isEnoughCompleted
                  ? 'At least 2 zones must have completed reports.'
                  : `Download merged DPR for ${completedZonesCount} completed zone(s)`
              }
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* All Zones 14 Days Report Button */}
      {!isProjectManager && (
        <TooltipProvider>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="sm"
                className="h-8 text-xs gap-1 bg-blue-600 hover:bg-blue-700"
                onClick={() => handleCheckAndDownload('overall')}
                disabled={isOverallButtonDisabled}
              >
                {isDownloadingOverall ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                All Zones 14 Days
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Download merged 14-days overall report for all zones
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}


      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {missingZonesList.length > 0
                ? 'Some Zones Have Incomplete Reports'
                : 'Download Merged Report'}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {missingZonesList.length > 0 && (
                <>
                  Reports are missing for the following zones:
                  <ul className="list-disc pl-5 mt-2 mb-2">
                    {missingZonesList.map(zone => (
                      <li key={zone}>{zone}</li>
                    ))}
                  </ul>
                  Only the completed zones will be included in the merged PDF.
                </>
              )}
              {isAdmin && (
                <span className="block pt-1 text-sm text-slate-600">
                  Choose a version of the PDF. The admin version splits the{' '}
                  <span className="font-semibold text-slate-800">Done</span> column into{' '}
                  <span className="font-semibold text-slate-800">Target</span> and{' '}
                  <span className="font-semibold text-slate-800">Actual</span> sub-columns for each milestone.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-2">
            <AlertDialogCancel className="mt-0 sm:mt-0" onClick={() => setPendingAction(null)}>
              Cancel
            </AlertDialogCancel>
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              {isAdmin ? (
                <>
                  <Button
                    className="bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => handleConfirmDownload(false)}
                  >
                    Without Target Progress
                  </Button>
                  <AlertDialogAction
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => handleConfirmDownload(true)}
                  >
                    With Target Progress
                  </AlertDialogAction>
                </>
              ) : (
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => handleConfirmDownload(false)}
                >
                  Confirm / Download
                </AlertDialogAction>
              )}
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PDFDownloadButtons;



