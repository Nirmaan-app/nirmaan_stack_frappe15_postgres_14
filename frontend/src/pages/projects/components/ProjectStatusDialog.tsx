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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TailSpin } from "react-loader-spinner";
import { useEffect } from "react";


export interface HaltedOptions {
  isDPRDisabled: boolean;
  dprDisableDate?: string;
  isDesignTrackerDisabled: boolean;
  isCommissionReportDisabled: boolean;
  isInventoryDisabled: boolean;
  isPMODisabled: boolean;

  inventoryDisableDate?: string;
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
  isLoading
}) => {
  // --- Halted Status Options State ---
  const [isDPRDisabled, setIsDPRDisabled] = useState(true);
  const [dprDisableDate, setDprDisableDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isDesignTrackerDisabled, setIsDesignTrackerDisabled] = useState(true);
  const [isCommissionReportDisabled, setIsCommissionReportDisabled] = useState(true);

  const [isInventoryDisabled, setIsInventoryDisabled] = useState(true);
  const [inventoryDisableDate, setInventoryDisableDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isPMODisabled, setIsPMODisabled] = useState(true);

  // Handle status-based defaults
  useEffect(() => {
    if (newStatus === "Handover") {
      setIsDesignTrackerDisabled(false);
      setIsCommissionReportDisabled(false);
    } else if (newStatus === "Halted" || newStatus === "Completed") {
      setIsDesignTrackerDisabled(true);
      setIsCommissionReportDisabled(true);
    }
  }, [newStatus]);


  const handleConfirm = () => {
    onConfirm({
      isDPRDisabled,
      dprDisableDate: isDPRDisabled ? dprDisableDate : undefined,
      isDesignTrackerDisabled,
      isCommissionReportDisabled,
      isInventoryDisabled,
      isPMODisabled,

      inventoryDisableDate: isInventoryDisabled ? inventoryDisableDate : undefined,
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            {newStatus === "Handover" ? (
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

          {/* --- Halted/Handover/Completed Status Options --- */}
          {(newStatus === "Halted" || newStatus === "Handover" || newStatus === "Completed") && (
            <div className="mt-4 space-y-4 py-2 border-t pt-4 text-left">
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Disable modules for this project:</h4>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="dpr-checkbox"
                  checked={isDPRDisabled}
                  onCheckedChange={(checked) => setIsDPRDisabled(checked === true)}
                />
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
                  <Checkbox
                    id="design-checkbox"
                    checked={isDesignTrackerDisabled}
                    onCheckedChange={(checked) => setIsDesignTrackerDisabled(checked === true)}
                  />
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
                  <Checkbox
                    id="commission-checkbox"
                    checked={isCommissionReportDisabled}
                    onCheckedChange={(checked) => setIsCommissionReportDisabled(checked === true)}
                  />
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
                <Checkbox
                  id="inventory-checkbox"
                  checked={isInventoryDisabled}
                  onCheckedChange={(checked) => setIsInventoryDisabled(checked === true)}
                />
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
                <Checkbox
                  id="pmo-checkbox"
                  checked={isPMODisabled}
                  onCheckedChange={(checked) => setIsPMODisabled(checked === true)}
                />
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
              <Button onClick={handleConfirm}>
                Continue
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
