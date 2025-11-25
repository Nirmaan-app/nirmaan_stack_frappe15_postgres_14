import React, { useState, useEffect, useCallback, useMemo } from "react";
import { KeyedMutator, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { CircleCheckBig, ArrowRightIcon, ArrowLeftIcon, PlusIcon, CircleX, CheckCircle2, XIcon } from "lucide-react";
import { Projects, ProjectWorkHeaderEntry ,ProjectZoneEntry} from "@/types/NirmaanStack/Projects";
// Assuming these shadcn/ui components are available
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

const INVALID_CHARS_REGEX = /[^a-zA-Z0-9\s,]/g; 
// 2. VALID_KEY_REGEX: Used for onKeyDown to allow only specific single keys.
const VALID_KEY_REGEX = /^[a-zA-Z0-9\s,]$/;


interface WorkHeaderDoc {
    name: string;
    work_header_name: string;
    work_package_link: string;
}

interface LocalProjectWorkHeaderEntry {
    work_header_doc_name: string;
    work_header_display_name: string;
    work_package_link: string;
    enabled: boolean;
    name?: string;
}

interface ProjectsWithZones extends Projects {
    project_zones: ProjectZoneEntry[];
}


// --- Setup Progress Tracking Dialog Component Props ---

export interface SetupProgressTrackingDialogProps {
    projectData: ProjectsWithZones;
    allWorkHeaders: WorkHeaderDoc[];
    allWorkHeadersLoading: boolean;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => Promise<void>; // Mutate and close
    generateCombinedHeaders: (
        projectData: Projects, 
        allWorkHeaders: WorkHeaderDoc[], 
        toBoolean: (val: any) => boolean, 
        getLinkedWorkHeaderName: (entry: ProjectWorkHeaderEntry) => string | null
    ) => LocalProjectWorkHeaderEntry[];
    toBoolean: (val: any) => boolean;
    getLinkedWorkHeaderName: (entry: ProjectWorkHeaderEntry) => string | null;
}

export const SetupProgressTrackingDialog: React.FC<SetupProgressTrackingDialogProps> = ({
    projectData,
    allWorkHeaders,
    allWorkHeadersLoading,
    isOpen,
    onClose,
    onSuccess,
    generateCombinedHeaders,
    toBoolean,
    getLinkedWorkHeaderName,
}) => {
    const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();

    const [currentStep, setCurrentStep] = useState(1);
    const [isSaving, setIsSaving] = useState(false);

    // STEP 2 State
    // Default to null to force user selection
    const [useMultipleZones, setUseMultipleZones] = useState<'yes' | 'no' | null>(null);
    const [localProjectZones, setLocalProjectZones] = useState<ProjectZoneEntry[]>([]);
    const [newZoneName, setNewZoneName] = useState("");
    const [zoneErrors, setZoneErrors] = useState<{ empty: boolean, unique: boolean }>({ empty: false, unique: false });


    // STEP 3 State
    const [dialogMilestoneEnabled, setDialogMilestoneEnabled] = useState(true); // Default to ON for setup wizard
    const [localWorkHeaders, setLocalWorkHeaders] = useState<LocalProjectWorkHeaderEntry[]>([]);
    
    // --- Initial Setup Logic ---
    useEffect(() => {
        if (isOpen) {
            // Reset wizard to Step 1 on open
            setCurrentStep(1);
            setIsSaving(false);
            setDialogMilestoneEnabled(true);

            // Determine initial state based on existing data
            const initialZones = projectData.project_zones || [];
            if (initialZones.length > 0) {
                 setUseMultipleZones(initialZones.length > 1 || (initialZones.length === 1 && initialZones[0].zone_name !== "Default") ? 'yes' : 'no');
                 setLocalProjectZones(initialZones);
            } else {
                 setUseMultipleZones(null); // Force selection if empty
                 setLocalProjectZones([]);
            }
            
            setZoneErrors({ empty: false, unique: false });

            // Initialize work headers
            if (allWorkHeaders.length > 0) {
                 // Pre-select existing or none if starting setup
                 setLocalWorkHeaders(generateCombinedHeaders(projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName));
            } else {
                 setLocalWorkHeaders([]);
            }
        }
    }, [isOpen, projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName, generateCombinedHeaders]);

    // Grouping for rendering (Step 3/4)
    const groupedWorkHeaders = useMemo(() => {
        const groups = new Map<string, LocalProjectWorkHeaderEntry[]>();
        localWorkHeaders.forEach(header => {
            const packageLink = header.work_package_link;
            if (!groups.has(packageLink)) {
                groups.set(packageLink, []);
            }
            groups.get(packageLink)!.push(header);
        });
        return Array.from(groups.entries());
    }, [localWorkHeaders]);

    const handleWorkHeaderCheckboxChange = useCallback((docName: string, checked: boolean | "indeterminate") => {
        setLocalWorkHeaders(prevHeaders => {
            const index = prevHeaders.findIndex(h => h.work_header_doc_name === docName);
            if (index === -1) return prevHeaders;

            const newHeaders = [...prevHeaders];
            newHeaders[index] = { ...newHeaders[index], enabled: checked as boolean };
            return newHeaders;
        });
    }, []);

    // --- Zone Handlers (Step 2) ---

    const validateZones = (zones: ProjectZoneEntry[]): boolean => {
        if (useMultipleZones === null) {
            setZoneErrors({ empty: false, unique: false });
            return false; // Must select an option first
        }

        const trimmedNames = zones.map(z => z.zone_name.trim()).filter(Boolean);
        const hasEmptyName = zones.some(z => !z.zone_name.trim());
        const hasDuplicates = new Set(trimmedNames).size !== trimmedNames.length;
        
        // 1. Check for empty or duplicates globally
        if (hasEmptyName || hasDuplicates) {
            setZoneErrors({ empty: hasEmptyName, unique: hasDuplicates });
            return false;
        }

        // 2. Check minimum requirement based on radio selection
        let minRequirementMet = true;
        if (useMultipleZones === 'no' && trimmedNames.length !== 1) {
            minRequirementMet = false; 
        } else if (useMultipleZones === 'yes' && trimmedNames.length < 2) {
            minRequirementMet = false;
        }
        
        setZoneErrors({ empty: false, unique: false }); // Clear on success
        return minRequirementMet;
    }

    const handleAddZone = () => {
        const trimmedZone = newZoneName.trim();
        if (!trimmedZone) return;

        // Check against current list including already defined ones
        const existingNames = localProjectZones.map(z => z.zone_name.trim());
        if (existingNames.includes(trimmedZone)) {
            setZoneErrors(prev => ({ ...prev, unique: true }));
            return;
        }

        const newEntry: ProjectZoneEntry = { zone_name: trimmedZone };
        setLocalProjectZones(prev => [...prev, newEntry]);
        setNewZoneName("");
        setZoneErrors({ empty: false, unique: false });
    };
    
    const handleRemoveZone = (zoneName: string) => {
        const newZones = localProjectZones.filter(z => z.zone_name !== zoneName);
        setLocalProjectZones(newZones);
        validateZones(newZones); // Re-validate after removal
    }

      // --- INPUT VALIDATION HANDLERS ---

    // 1. Block invalid keys (Special chars)
    const handleZoneKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const allowedControlKeys = ['Backspace', 'Delete', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
        
        if (e.key === 'Enter') {
            e.preventDefault(); // Stop form submit
            handleAddZone();    // Trigger Add
            return;
        }

        if (allowedControlKeys.includes(e.key) || e.ctrlKey || e.metaKey) return;

        if (!VALID_KEY_REGEX.test(e.key)) {
            e.preventDefault(); // Block key
        }
    };

    // 2. Clean Pasted Text
    const handleZonePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text');
        const sanitized = text.replace(INVALID_CHARS_REGEX, '');
        if (sanitized !== text) {
             toast({ title: "Warning", description: "Special characters removed.", variant: "warning" });
        }
        setNewZoneName(sanitized); // Simple replacement
    };

    // 3. Clean Input Change (Safety net)
    const handleZoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        const clean = raw.replace(INVALID_CHARS_REGEX, '');
        setNewZoneName(clean);
        setZoneErrors({ empty: false, unique: false });
    };


    // --- Final Save Handler ---
    const handleFinalSave = async () => {
        setIsSaving(true);
        try {
            // 1. Prepare Work Header entries
            const headersToSave = localWorkHeaders
                .filter(entry => entry.enabled)
                .map(entry => {
                    return {
                        name: entry.name,
                        project_work_header_name: entry.work_header_doc_name,
                        enabled: true,
                    };
                });
            
            // 2. Prepare Zones
            const zonesToSave = localProjectZones
                .filter(z => z.zone_name.trim()) // Save only valid names
                .map(zone => ({
                    name: zone.name, 
                    zone_name: zone.zone_name.trim()
                }));

            // 3. Prepare final payload
            const payload = {
                enable_project_milestone_tracking: true, // Always set to true on successful setup
                project_work_header_entries: headersToSave,
                project_zones: zonesToSave,
            };

            await updateDoc("Projects", projectData.name, payload);
            await onSuccess();
            toast({
                title: "Success",
                description: "Project Progress Tracking setup complete!",
                variant: "success",
            });
        } catch (error) {
            console.error("Failed to save project setup:", error);
            toast({
                title: "Error",
                description: "Failed to complete Project Setup.",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    // --- Render Logic for Steps ---



    // --- Step 1: Introduction ---
    const renderStep1 = () => (
        <>
            <DialogHeader>
                <DialogTitle className="text-xl text-center border-b">Setup Progress Tracking</DialogTitle>
                <DialogDescription className="text-center text-xs">
                    This wizard will guide you through the initial setup for tracking work progress on this project.
                </DialogDescription>
            </DialogHeader>
            <div className="py-8 space-y-6">
                <div className="flex items-center space-x-3 text-lg">
                    <CheckCircle2 className="h-6 w-6 text-blue-500" />
                    <span>Define Project Zones</span>
                </div>
                <div className="flex items-center space-x-3 text-lg">
                    <CheckCircle2 className="h-6 w-6 text-blue-500" />
                    <span>Select Trackable Work Headers</span>
                </div>
            </div>
            <DialogFooter className="flex justify-end gap-4">
                <Button variant="outline" onClick={onClose} disabled={isSaving}>
                    Cancel
                </Button>
                <Button onClick={() => setCurrentStep(2)} disabled={isSaving}>
                    Next <ArrowRightIcon className="h-4 w-4 ml-2" />
                </Button>
            </DialogFooter>
        </>
    );

    // --- Step 2: Zone Setup ---
    const isStep2NextDisabled = useMemo(() => {
        // Validation depends on a selection being made AND the zones being valid
        if (useMultipleZones === null) return true;
        
        // Call validateZones to update errors and check validity
        return !validateZones(localProjectZones);
    }, [localProjectZones, useMultipleZones]);
    
    const handleZoneRadioChange = (value: 'yes' | 'no') => {
        setUseMultipleZones(value);
        if (value === 'no') {
            // Set to default zone for single zone project
            setLocalProjectZones([{ zone_name: "Default" }]);
            setZoneErrors({ empty: false, unique: false });
        } else {
             // If switching to yes, clear existing zones (if only default was present)
             if (localProjectZones.length === 1 && localProjectZones[0].zone_name === "Default") {
                 setLocalProjectZones([]);
             }
             // Ensure existing custom zones are re-validated
             validateZones(localProjectZones); 
        }
    };


    const renderStep2 = () => (
        <>
            <DialogHeader>
                <DialogTitle className="text-xl text-center border-b">Step 2: Setup Zones</DialogTitle>
                <DialogDescription className="text-center text-xs">
                    A zone allows you to track progress across different geographical or structural areas of your project.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-6">
                <div className="space-y-2">
                    <Label className="font-semibold mb-2">Do you want to set up multiple Zones for this Project?</Label>
                    <div className="flex space-x-8">
                        {/* Custom Radio Button for YES */}
                        <div className="flex items-center space-x-2 cursor-pointer" onClick={() => handleZoneRadioChange('yes')}>
                            <input 
                                type="radio" 
                                id="multi-yes" 
                                name="multiple-zones" 
                                value="yes" 
                                checked={useMultipleZones === 'yes'}
                                onChange={() => handleZoneRadioChange('yes')}
                                className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                            />
                            <Label htmlFor="multi-yes" className="cursor-pointer">Yes, I need multiple zones (Min 2)</Label>
                        </div>
                        {/* Custom Radio Button for NO */}
                        <div className="flex items-center space-x-2 cursor-pointer" onClick={() => handleZoneRadioChange('no')}>
                            <input 
                                type="radio" 
                                id="multi-no" 
                                name="multiple-zones" 
                                value="no" 
                                checked={useMultipleZones === 'no'}
                                onChange={() => handleZoneRadioChange('no')}
                                className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                            />
                            <Label htmlFor="multi-no" className="cursor-pointer">No, use a single zone (Default)</Label>
                        </div>
                    </div>
                    {useMultipleZones === null && <p className="text-red-500 text-sm mt-1">Please select an option to proceed.</p>}
                </div>

                {useMultipleZones === 'no' && (
                    <div className="p-3 border rounded-md bg-gray-100">
                        <p className="text-sm font-medium">Zone Name: Default</p>
                    </div>
                )}
                
                {useMultipleZones === 'yes' && (
                    <div className="space-y-3">
                        <h4 className="font-medium text-sm">Define Custom Zones ({localProjectZones.length} / Min 2)</h4>
                        <div className="flex space-x-2">
                            <Input
                                placeholder="Enter Zone Name (e.g., Block A)"
                                value={newZoneName}
                                onChange={handleZoneChange}   // Clean on change
                                onKeyDown={handleZoneKeyDown} // Block bad keys
                                onPaste={handleZonePaste}     // Clean paste
                            />
                            <Button onClick={handleAddZone} disabled={!newZoneName.trim()} variant="outline">
                                <PlusIcon className="h-4 w-4 mr-2" /> Add
                            </Button>
                        </div>

                        {/* Zone List */}
                        <div className="w-full border rounded-md p-2">
                            <div className="space-y-2">
                                {localProjectZones.map((zone) => (
                                    <div key={zone.zone_name} className="flex items-center justify-between p-1 border rounded-md bg-white">
                                        <span className="text-sm">{zone.zone_name}</span>
                                        <Button variant="ghost" size="icon" onClick={() => handleRemoveZone(zone.zone_name)}>
                                            <XIcon className="h-4 w-4 text-red-500" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            {localProjectZones.length === 0 && (
                                <p className="text-center text-gray-500 text-sm italic pt-3">Add at least 2 zones above.</p>
                            )}
                        </div>
                        
                        {/* Display Errors */}
                        {isStep2NextDisabled && (
                           <p className="text-red-500 text-sm">
                               {zoneErrors.empty && "Zone names cannot be empty."}
                               {zoneErrors.unique && "Zone names must be unique."}
                               {!(zoneErrors.empty || zoneErrors.unique) && (useMultipleZones === 'yes' ? "You must define at least 2 zones." : "")}
                           </p>
                        )}
                        
                    </div>
                )}
            </div>
            <DialogFooter className="flex justify-between gap-4">
                <Button variant="outline" onClick={() => setCurrentStep(1)} disabled={isSaving}>
                    <ArrowLeftIcon className="h-4 w-4 mr-2" /> Back
                </Button>
                <Button onClick={() => setCurrentStep(3)} disabled={isSaving || isStep2NextDisabled}>
                    Next <ArrowRightIcon className="h-4 w-4 ml-2" />
                </Button>
            </DialogFooter>
        </>
    );

    // --- Step 3: Select Work Headers ---
    const enabledHeadersCount = localWorkHeaders.filter(h => h.enabled).length;
    const isStep3NextDisabled = enabledHeadersCount === 0;

    const renderStep3 = () => (
        <>
            <DialogHeader>
                <DialogTitle className="text-xl text-center border-b">Step 3: Enable Work Headers</DialogTitle>
                <DialogDescription className="text-center text-xs">
                    Select the specific work headers for which progress tracking will be enabled.(Min 1 required)
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-6"> 
                <h4 className="font-medium text-md text-gray-700">Available Work Headers ({enabledHeadersCount} Selected)</h4>
                {allWorkHeadersLoading ? (
                    <div className="flex justify-center"><TailSpin width={30} height={30} color="#007bff" /></div>
                ) : (
                    <div className="w-full border p-4 rounded-md">
                        {groupedWorkHeaders.map(([workPackage, headers]) => (
                            <div key={workPackage} className="mb-4">
                                <h5 className="text-sm font-semibold mb-2 text-gray-800 border-b pb-1">{workPackage}</h5>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                    {headers.map((entry) => (
                                        <div
                                            key={entry.work_header_doc_name}
                                            className="flex items-center space-x-2"
                                        >
                                            <Checkbox
                                                id={`wh-dialog-${entry.work_header_doc_name}`}
                                                checked={entry.enabled}
                                                onCheckedChange={(checked) => handleWorkHeaderCheckboxChange(entry.work_header_doc_name, checked)}
                                            />
                                            <Label htmlFor={`wh-dialog-${entry.work_header_doc_name}`} className="text-sm cursor-pointer">
                                                {entry.work_header_display_name}
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                
                {isStep3NextDisabled && <p className="text-red-500 text-sm">At least one Work Header must be selected.</p>}
            </div>
            <DialogFooter className="flex justify-between gap-4">
                <Button variant="outline" onClick={() => setCurrentStep(2)} disabled={isSaving}>
                    <ArrowLeftIcon className="h-4 w-4 mr-2" /> Back
                </Button>
                <Button onClick={() => setCurrentStep(4)} disabled={isSaving || isStep3NextDisabled}>
                    Next <ArrowRightIcon className="h-4 w-4 ml-2" />
                </Button>
            </DialogFooter>
        </>
    );

    // --- Step 4: Summary ---

    const renderStep4 = () => (
        <>
            <DialogHeader>
                <DialogTitle className="text-xl text-center border-b">Step 4: Review & Submit</DialogTitle>
                <DialogDescription className="text-center text-xs">
                    Review your setup before enabling progress tracking for the project.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-6">
                {/* Zones Summary */}
                <div className="space-y-2 p-3 border rounded-md">
                    <h4 className="font-semibold flex items-center">
                        <CheckCircle2 className="h-5 w-5 mr-2 text-green-600" />
                        Project Zones ({localProjectZones.length})
                    </h4>
                    <div className="grid grid-cols-3 gap-2">
                        {localProjectZones.map((zone) => (
                             <span key={zone.zone_name} className="px-3 py-1 text-xs bg-gray-100 rounded-full border border-gray-300">
                                {zone.zone_name}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Work Headers Summary */}
                <div className="space-y-2 p-3 border rounded-md">
                    <h4 className="font-semibold flex items-center">
                        <CheckCircle2 className="h-5 w-5 mr-2 text-green-600" />
                        Tracked Work Headers ({enabledHeadersCount})
                    </h4>
                    <ScrollArea className="h-24 pr-4">
                        <ul className="text-sm list-disc pl-5 space-y-1">
                            {localWorkHeaders.filter(h => h.enabled).map(h => (
                                <li key={h.work_header_doc_name} className="text-gray-700">{h.work_header_display_name}</li>
                            ))}
                        </ul>
                    </ScrollArea>
                </div>
            </div>
            <DialogFooter className="flex justify-between gap-4">
                <Button variant="outline" onClick={() => setCurrentStep(3)} disabled={isSaving}>
                    <ArrowLeftIcon className="h-4 w-4 mr-2" /> Back
                </Button>
                <Button onClick={handleFinalSave} disabled={isSaving || updateDocLoading}>
                    {isSaving || updateDocLoading ? (
                        <TailSpin width={20} height={20} color="white" />
                    ) : (
                        <>
                            <CircleCheckBig size={20} className="mr-2" /> Submit & Enable Tracking
                        </>
                    )}
                </Button>
            </DialogFooter>
        </>
    );
    
    // --- Main Render ---

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !isSaving && open ? {} : onClose()}>
            <DialogContent className="max-h-[70vh] sm:max-w-[650px] lg:max-h-[90vh] overflow-y-auto">      
                {currentStep === 1 && renderStep1()}
                {currentStep === 2 && renderStep2()}
                {currentStep === 3 && renderStep3()}
                {currentStep === 4 && renderStep4()}
            </DialogContent>
        </Dialog>
    );
};