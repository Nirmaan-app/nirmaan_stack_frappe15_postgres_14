import React, { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TailSpin } from "react-loader-spinner";
import { useEffect } from "react";
import { CalendarClock } from "lucide-react";
import { defaultRecheckDate, isValidRecheckDate, todayISO } from "@/utils/ceoHoldRecheck";


export interface HaltedOptions {
  isDPRDisabled: boolean;
  dprDisableDate?: string;
  isDesignTrackerDisabled: boolean;
  isCommissionReportDisabled: boolean;
  isInventoryDisabled: boolean;
  isPMODisabled: boolean;

  inventoryDisableDate?: string;

  /**
   * CEO Hold scheduled recheck. Present ONLY when `requireRecheck` is set — the date
   * (YYYY-MM-DD) on which the system should run the CEO Hold evaluation again. It travels
   * in the same options bag so the caller writes the status and the schedule in ONE save.
   */
  ceoHoldRecheckDate?: string;
}


interface ProjectStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStatus: string;
  newStatus: string;
  projectName: string;
  projectStatuses: any[];
  designTrackerId?: string;
  onConfirm: (options: HaltedOptions) => void;
  onCancel: () => void;
  isLoading: boolean;
  /**
   * Turns this into the CEO Hold recheck confirmation: the authorized user is moving a
   * held project to a non-terminal status, so a recheck date is REQUIRED before the status
   * can change. Decided by `shouldScheduleCeoHoldRecheck` at the call site.
   */
  requireRecheck?: boolean;
}

export const ProjectStatusDialog: React.FC<ProjectStatusDialogProps> = ({
  open,
  onOpenChange,
  currentStatus,
  newStatus,
  projectName,
  projectStatuses,
  designTrackerId,
  onConfirm,
  onCancel,
  isLoading,
  requireRecheck = false
}) => {
  // --- Halted Status Options State ---
  const [isDPRDisabled, setIsDPRDisabled] = useState(true);
  const [dprDisableDate, setDprDisableDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isDesignTrackerDisabled, setIsDesignTrackerDisabled] = useState(true);
  const [isCommissionReportDisabled, setIsCommissionReportDisabled] = useState(true);

  const [isInventoryDisabled, setIsInventoryDisabled] = useState(true);
  const [inventoryDisableDate, setInventoryDisableDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isPMODisabled, setIsPMODisabled] = useState(true);

  // --- CEO Hold recheck state ---
  // Pre-filled with the day after tomorrow (owner ruling): that is the usual window, and
  // the CEO adjusts it — almost always further out. Still mandatory and still validated;
  // the default only saves the common case a click. Both dates are recomputed on each
  // open, so a dialog left mounted overnight never offers a stale "today".
  const [recheckDate, setRecheckDate] = useState<string>(defaultRecheckDate);
  const minRecheckDate = todayISO();
  const isRecheckDateValid = isValidRecheckDate(recheckDate);
  const canConfirm = !requireRecheck || isRecheckDateValid;

  // Handle status-based defaults
  useEffect(() => {
    if (newStatus === "Handover") {
      setIsDesignTrackerDisabled(false);
      setIsCommissionReportDisabled(false);
    } else if (newStatus === "Halted" || newStatus === "Completed") {
      setIsDesignTrackerDisabled(true);
      setIsCommissionReportDisabled(true);
    }
  }, [open,newStatus]);

  // Re-seed on every open. A date the user typed for a previous, abandoned status change
  // must never be silently attached to the next one, and re-computing here is what keeps
  // the default correct across a day boundary.
  useEffect(() => {
    if (open) setRecheckDate(defaultRecheckDate());
  }, [open]);


  const handleConfirm = () => {
    // Belt and braces: the button is disabled without a valid date, but this is the one
    // place the schedule leaves the dialog, so it re-checks rather than trusting the UI.
    if (requireRecheck && !isRecheckDateValid) return;

    onConfirm({
      isDPRDisabled,
      dprDisableDate: isDPRDisabled ? dprDisableDate : undefined,
      isDesignTrackerDisabled,
      isCommissionReportDisabled,
      isInventoryDisabled,
      isPMODisabled,

      inventoryDisableDate: isInventoryDisabled ? inventoryDisableDate : undefined,
      ceoHoldRecheckDate: requireRecheck ? recheckDate : undefined,
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {requireRecheck ? "Schedule a CEO Hold recheck" : "Are you sure?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {requireRecheck ? (
              "This project is currently under CEO Hold. You are changing the project status from CEO Hold to another status. Please select the date when the system should check the CEO Hold conditions again."
            ) : newStatus === "Handover" ? (
              designTrackerId
                ? "This will change the project status to Handover, generate handover copies of all applicable design tasks with a 7-day deadline, and initialize the project Commission Report if it does not exist."
                : "This will change the project status to Handover and initialize the project Commission Report. No Design Tracker exists for this project, so no design handover tasks will be generated."
            ) : (
              <>
                This action will change the status of "{projectName}" from "{currentStatus}" to "{
                  projectStatuses.find((s) => s.value === newStatus)?.label || "Unknown"
                }".
              </>
            )}
          </AlertDialogDescription>

          {/* --- CEO Hold recheck (authorized user releasing a held project) --- */}
          {requireRecheck && (
            <div className="mt-4 space-y-3 py-2 border-t pt-4 text-left">
              <div className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
                <span className="text-gray-500">Current Status</span>
                <span className="font-semibold text-amber-700">{currentStatus}</span>
                <span className="text-gray-500">New Status</span>
                <span className="font-semibold text-gray-900">
                  {projectStatuses.find((s) => s.value === newStatus)?.label || newStatus}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ceo-hold-recheck-date" className="text-sm font-medium flex items-center gap-1.5">
                  <CalendarClock className="h-4 w-4 text-amber-600" />
                  CEO Hold Recheck Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="ceo-hold-recheck-date"
                  type="date"
                  required
                  min={minRecheckDate}
                  value={recheckDate}
                  onChange={(e) => setRecheckDate(e.target.value)}
                  className="h-9 text-sm w-48"
                />
                {recheckDate && !isRecheckDateValid ? (
                  <p className="text-[11px] text-red-600">
                    Pick today or a later date — the recheck cannot be scheduled in the past.
                  </p>
                ) : (
                  <p className="text-[11px] text-gray-500">
                    Until this date the CEO Hold conditions are not re-evaluated. On it, the
                    system re-runs the same checks and puts the project back on CEO Hold if
                    they still fail.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* --- Halted/Handover/Completed Status Options --- */}
          {(newStatus === "Halted" || newStatus === "Handover" || newStatus === "Completed") && (
            <div className="mt-4 space-y-4 py-2 border-t pt-4 text-left">
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Modules for this project <span className="font-normal text-gray-500">(on = active, off = inactive)</span>:</h4>

              <div className="flex items-center space-x-2">
                <Switch
                  id="dpr-checkbox"
                  className="data-[state=checked]:bg-green-600"
                  checked={!isDPRDisabled}
                  onCheckedChange={(checked) => setIsDPRDisabled(!checked)}
                />
                <span className={`w-7 text-xs font-semibold ${isDPRDisabled ? "text-gray-400" : "text-green-600"}`}>
                  {isDPRDisabled ? "OFF" : "ON"}
                </span>
                <Label htmlFor="dpr-checkbox" className="text-sm cursor-pointer font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  DPR Report
                </Label>
              </div>
              {isDPRDisabled && (
                <div className="ml-6 flex flex-col gap-1.5">
                  <Label htmlFor="dpr-date" className="text-[11px] text-gray-500">Disable from date:</Label>
                  <Input
                    id="dpr-date"
                    type="date"
                    value={dprDisableDate}
                    onChange={(e) => setDprDisableDate(e.target.value)}
                    className="h-8 text-xs w-40"
                  />
                </div>
              )}


              <div className="flex flex-col space-y-1">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="design-checkbox"
                    className="data-[state=checked]:bg-green-600"
                    checked={!isDesignTrackerDisabled}
                    onCheckedChange={(checked) => setIsDesignTrackerDisabled(!checked)}
                  />
                  <span className={`w-7 text-xs font-semibold ${isDesignTrackerDisabled ? "text-gray-400" : "text-green-600"}`}>
                    {isDesignTrackerDisabled ? "OFF" : "ON"}
                  </span>
                  <Label htmlFor="design-checkbox" className="text-sm cursor-pointer font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Design Tracker
                  </Label>
                </div>
                {newStatus === "Handover" && isDesignTrackerDisabled && (
                  <p className="ml-6 text-[10px] text-red-500 italic">
                    Are you sure? Disabling this will hide the handover report being created.
                  </p>
                )}
              </div>

              <div className="flex flex-col space-y-1">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="commission-checkbox"
                    className="data-[state=checked]:bg-green-600"
                    checked={!isCommissionReportDisabled}
                    onCheckedChange={(checked) => setIsCommissionReportDisabled(!checked)}
                  />
                  <span className={`w-7 text-xs font-semibold ${isCommissionReportDisabled ? "text-gray-400" : "text-green-600"}`}>
                    {isCommissionReportDisabled ? "OFF" : "ON"}
                  </span>
                  <Label htmlFor="commission-checkbox" className="text-sm cursor-pointer font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Commission Report
                  </Label>
                </div>
                {newStatus === "Handover" && isCommissionReportDisabled && (
                  <p className="ml-6 text-[10px] text-red-500 italic">
                    Are you sure? Disabling this will hide the report generated on this status change.
                  </p>
                )}
              </div>



              <div className="flex items-center space-x-2">
                <Switch
                  id="inventory-checkbox"
                  className="data-[state=checked]:bg-green-600"
                  checked={!isInventoryDisabled}
                  onCheckedChange={(checked) => setIsInventoryDisabled(!checked)}
                />
                <span className={`w-7 text-xs font-semibold ${isInventoryDisabled ? "text-gray-400" : "text-green-600"}`}>
                  {isInventoryDisabled ? "OFF" : "ON"}
                </span>
                <Label htmlFor="inventory-checkbox" className="text-sm cursor-pointer font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Inventory
                </Label>
              </div>
              {isInventoryDisabled && (
                <div className="ml-6 flex flex-col gap-1.5">
                  <Label htmlFor="inv-date" className="text-[11px] text-gray-500">Disable from date:</Label>
                  <Input
                    id="inv-date"
                    type="date"
                    value={inventoryDisableDate}
                    onChange={(e) => setInventoryDisableDate(e.target.value)}
                    className="h-8 text-xs w-40"
                  />
                </div>
              )}

              <div className="flex items-center space-x-2">
                <Switch
                  id="pmo-checkbox"
                  className="data-[state=checked]:bg-green-600"
                  checked={!isPMODisabled}
                  onCheckedChange={(checked) => setIsPMODisabled(!checked)}
                />
                <span className={`w-7 text-xs font-semibold ${isPMODisabled ? "text-gray-400" : "text-green-600"}`}>
                  {isPMODisabled ? "OFF" : "ON"}
                </span>
                <Label htmlFor="pmo-checkbox" className="text-sm cursor-pointer font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  PMO Dashboard
                </Label>
              </div>

            </div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {isLoading ? (
            <TailSpin color="red" width={26} height={26} />
          ) : (
            <>
              <AlertDialogCancel onClick={onCancel}>
                Cancel
              </AlertDialogCancel>
              <Button onClick={handleConfirm} disabled={!canConfirm}>
                {requireRecheck ? "Change Status & Schedule Recheck" : "Continue"}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
