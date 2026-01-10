import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useFrappeUpdateDoc } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { X, Plus, Check, ChevronRight, ChevronLeft } from "lucide-react";
import { Projects, ProjectWorkHeaderEntry, ProjectZoneEntry } from "@/types/NirmaanStack/Projects";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";

const INVALID_CHARS_REGEX = /[^a-zA-Z0-9\s,]/g;
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

export interface SetupProgressTrackingDialogProps {
    projectData: ProjectsWithZones;
    allWorkHeaders: WorkHeaderDoc[];
    allWorkHeadersLoading: boolean;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => Promise<void>;
    generateCombinedHeaders: (
        projectData: Projects,
        allWorkHeaders: WorkHeaderDoc[],
        toBoolean: (val: any) => boolean,
        getLinkedWorkHeaderName: (entry: ProjectWorkHeaderEntry) => string | null
    ) => LocalProjectWorkHeaderEntry[];
    toBoolean: (val: any) => boolean;
    getLinkedWorkHeaderName: (entry: ProjectWorkHeaderEntry) => string | null;
}

// Simple step indicator component
const StepIndicator: React.FC<{ currentStep: number; totalSteps: number }> = ({ currentStep, totalSteps }) => {
    return (
        <div className="flex items-center justify-center gap-2 py-3 border-b border-gray-200">
            {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
                <React.Fragment key={step}>
                    <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium border ${
                            step < currentStep
                                ? "bg-emerald-500 border-emerald-500 text-white"
                                : step === currentStep
                                ? "bg-sky-500 border-sky-500 text-white"
                                : "bg-gray-100 border-gray-300 text-gray-500"
                        }`}
                    >
                        {step < currentStep ? <Check className="h-3.5 w-3.5" /> : step}
                    </div>
                    {step < totalSteps && (
                        <div className={`w-8 h-0.5 ${step < currentStep ? "bg-emerald-500" : "bg-gray-200"}`} />
                    )}
                </React.Fragment>
            ))}
        </div>
    );
};

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

    // Step 2: Zone configuration
    const [useMultipleZones, setUseMultipleZones] = useState<'yes' | 'no' | null>(null);
    const [localProjectZones, setLocalProjectZones] = useState<ProjectZoneEntry[]>([]);
    const [newZoneName, setNewZoneName] = useState("");
    const [zoneErrors, setZoneErrors] = useState<{ empty: boolean; unique: boolean }>({ empty: false, unique: false });

    // Step 3: Work headers
    const [localWorkHeaders, setLocalWorkHeaders] = useState<LocalProjectWorkHeaderEntry[]>([]);

    // Initialize on dialog open
    useEffect(() => {
        if (isOpen) {
            setCurrentStep(1);
            setIsSaving(false);

            const initialZones = projectData.project_zones || [];
            if (initialZones.length > 0) {
                setUseMultipleZones(
                    initialZones.length > 1 || (initialZones.length === 1 && initialZones[0].zone_name !== "Default")
                        ? "yes"
                        : "no"
                );
                setLocalProjectZones(initialZones);
            } else {
                setUseMultipleZones(null);
                setLocalProjectZones([]);
            }

            setZoneErrors({ empty: false, unique: false });

            if (allWorkHeaders.length > 0) {
                setLocalWorkHeaders(generateCombinedHeaders(projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName));
            } else {
                setLocalWorkHeaders([]);
            }
        }
    }, [isOpen, projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName, generateCombinedHeaders]);

    // Group work headers by package
    const groupedWorkHeaders = useMemo(() => {
        const groups = new Map<string, LocalProjectWorkHeaderEntry[]>();
        localWorkHeaders.forEach((header) => {
            const packageLink = header.work_package_link || "Uncategorized";
            if (!groups.has(packageLink)) {
                groups.set(packageLink, []);
            }
            groups.get(packageLink)!.push(header);
        });
        return Array.from(groups.entries()).sort(([a], [b]) => {
            if (a === "Uncategorized") return 1;
            if (b === "Uncategorized") return -1;
            return a.localeCompare(b);
        });
    }, [localWorkHeaders]);

    const handleWorkHeaderCheckboxChange = useCallback((docName: string, checked: boolean | "indeterminate") => {
        setLocalWorkHeaders((prevHeaders) => {
            const index = prevHeaders.findIndex((h) => h.work_header_doc_name === docName);
            if (index === -1) return prevHeaders;
            const newHeaders = [...prevHeaders];
            newHeaders[index] = { ...newHeaders[index], enabled: checked as boolean };
            return newHeaders;
        });
    }, []);

    // Zone validation
    const validateZones = (zones: ProjectZoneEntry[]): boolean => {
        if (useMultipleZones === null) {
            setZoneErrors({ empty: false, unique: false });
            return false;
        }

        const trimmedNames = zones.map((z) => z.zone_name.trim()).filter(Boolean);
        const hasEmptyName = zones.some((z) => !z.zone_name.trim());
        const hasDuplicates = new Set(trimmedNames).size !== trimmedNames.length;

        if (hasEmptyName || hasDuplicates) {
            setZoneErrors({ empty: hasEmptyName, unique: hasDuplicates });
            return false;
        }

        let minRequirementMet = true;
        if (useMultipleZones === "no" && trimmedNames.length !== 1) {
            minRequirementMet = false;
        } else if (useMultipleZones === "yes" && trimmedNames.length < 2) {
            minRequirementMet = false;
        }

        setZoneErrors({ empty: false, unique: false });
        return minRequirementMet;
    };

    const handleAddZone = () => {
        const trimmedZone = newZoneName.trim();
        if (!trimmedZone) return;

        const existingNames = localProjectZones.map((z) => z.zone_name.trim().toLowerCase());
        if (existingNames.includes(trimmedZone.toLowerCase())) {
            setZoneErrors((prev) => ({ ...prev, unique: true }));
            return;
        }

        setLocalProjectZones((prev) => [...prev, { zone_name: trimmedZone }]);
        setNewZoneName("");
        setZoneErrors({ empty: false, unique: false });
    };

    const handleRemoveZone = (zoneName: string) => {
        const newZones = localProjectZones.filter((z) => z.zone_name !== zoneName);
        setLocalProjectZones(newZones);
        validateZones(newZones);
    };

    const handleZoneKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const allowedControlKeys = ["Backspace", "Delete", "Tab", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];

        if (e.key === "Enter") {
            e.preventDefault();
            handleAddZone();
            return;
        }

        if (allowedControlKeys.includes(e.key) || e.ctrlKey || e.metaKey) return;

        if (!VALID_KEY_REGEX.test(e.key)) {
            e.preventDefault();
        }
    };

    const handleZonePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text");
        const sanitized = text.replace(INVALID_CHARS_REGEX, "");
        if (sanitized !== text) {
            toast({ title: "Note", description: "Special characters removed." });
        }
        setNewZoneName(sanitized);
    };

    const handleZoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        const clean = raw.replace(INVALID_CHARS_REGEX, "");
        setNewZoneName(clean);
        setZoneErrors({ empty: false, unique: false });
    };

    const handleZoneRadioChange = (value: "yes" | "no") => {
        setUseMultipleZones(value);
        if (value === "no") {
            setLocalProjectZones([{ zone_name: "Default" }]);
            setZoneErrors({ empty: false, unique: false });
        } else {
            if (localProjectZones.length === 1 && localProjectZones[0].zone_name === "Default") {
                setLocalProjectZones([]);
            }
            validateZones(localProjectZones);
        }
    };

    // Final save
    const handleFinalSave = async () => {
        setIsSaving(true);
        try {
            const headersToSave = localWorkHeaders
                .filter((entry) => entry.enabled)
                .map((entry) => ({
                    name: entry.name,
                    project_work_header_name: entry.work_header_doc_name,
                    enabled: true,
                }));

            const zonesToSave = localProjectZones
                .filter((z) => z.zone_name.trim())
                .map((zone) => ({
                    name: zone.name,
                    zone_name: zone.zone_name.trim(),
                }));

            const payload = {
                enable_project_milestone_tracking: true,
                project_work_header_entries: headersToSave,
                project_zones: zonesToSave,
            };

            await updateDoc("Projects", projectData.name, payload);
            await onSuccess();
            toast({
                title: "Success",
                description: "Progress tracking setup complete.",
                variant: "success",
            });
        } catch (error) {
            console.error("Failed to save project setup:", error);
            toast({
                title: "Error",
                description: "Failed to complete setup.",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    const isStep2NextDisabled = useMemo(() => {
        if (useMultipleZones === null) return true;
        return !validateZones(localProjectZones);
    }, [localProjectZones, useMultipleZones]);

    const enabledHeadersCount = localWorkHeaders.filter((h) => h.enabled).length;
    const isStep3NextDisabled = enabledHeadersCount === 0;

    // Step 1: Introduction
    const renderStep1 = () => (
        <div className="space-y-4 py-4">
            <p className="text-sm text-gray-600">
                This wizard will guide you through configuring progress tracking for this project.
            </p>
            <div className="space-y-2 text-sm text-gray-700">
                <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium">1</span>
                    <span>Configure project zones</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium">2</span>
                    <span>Select work headers to track</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium">3</span>
                    <span>Review and confirm</span>
                </div>
            </div>
        </div>
    );

    // Step 2: Zones
    const renderStep2 = () => (
        <div className="space-y-4 py-4">
            <div className="space-y-3">
                <Label className="text-sm font-medium text-gray-700">Zone Configuration</Label>
                <p className="text-xs text-gray-500">
                    Zones allow tracking progress across different areas of the project.
                </p>

                <RadioGroup
                    value={useMultipleZones || ""}
                    onValueChange={(value: string) => handleZoneRadioChange(value as "yes" | "no")}
                    className="space-y-2"
                >
                    <label className="flex items-center gap-3 px-3 py-2 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                        <RadioGroupItem value="no" id="zone-single" />
                        <div>
                            <span className="text-sm text-gray-700">Single Zone (Default)</span>
                            <p className="text-xs text-gray-400">All work tracked under one zone</p>
                        </div>
                    </label>
                    <label className="flex items-center gap-3 px-3 py-2 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                        <RadioGroupItem value="yes" id="zone-multiple" />
                        <div>
                            <span className="text-sm text-gray-700">Multiple Zones</span>
                            <p className="text-xs text-gray-400">Track progress by floor, wing, or area (min. 2)</p>
                        </div>
                    </label>
                </RadioGroup>

                {useMultipleZones === null && (
                    <p className="text-xs text-amber-600">Please select an option to proceed.</p>
                )}
            </div>

            {useMultipleZones === "no" && (
                <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded">
                    <span className="text-sm text-gray-600">Zone: Default</span>
                </div>
            )}

            {useMultipleZones === "yes" && (
                <div className="space-y-3">
                    <div className="flex gap-2">
                        <Input
                            type="text"
                            placeholder="Enter zone name (e.g., Ground Floor)"
                            value={newZoneName}
                            onChange={handleZoneChange}
                            onKeyDown={handleZoneKeyDown}
                            onPaste={handleZonePaste}
                            className="flex-1 h-9 text-sm"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleAddZone}
                            disabled={!newZoneName.trim()}
                            className="h-9 px-3"
                        >
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>

                    {localProjectZones.length > 0 && (
                        <div className="border border-gray-200 rounded divide-y divide-gray-200">
                            {localProjectZones.map((zone) => (
                                <div key={zone.zone_name} className="flex items-center justify-between px-3 py-2">
                                    <span className="text-sm text-gray-700">{zone.zone_name}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveZone(zone.zone_name)}
                                        className="text-gray-400 hover:text-red-500 p-1"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {localProjectZones.length === 0 && (
                        <p className="text-xs text-gray-500 text-center py-3 border border-dashed border-gray-200 rounded">
                            No zones added yet. Add at least 2 zones.
                        </p>
                    )}

                    {(zoneErrors.empty || zoneErrors.unique || (useMultipleZones === "yes" && localProjectZones.length < 2)) && (
                        <p className="text-xs text-red-500">
                            {zoneErrors.empty && "Zone names cannot be empty. "}
                            {zoneErrors.unique && "Zone names must be unique. "}
                            {!zoneErrors.empty && !zoneErrors.unique && localProjectZones.length < 2 && "Add at least 2 zones."}
                        </p>
                    )}
                </div>
            )}
        </div>
    );

    // Step 3: Work Headers
    const renderStep3 = () => (
        <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-gray-700">Select Work Headers</Label>
                <span className="text-xs text-gray-500">{enabledHeadersCount} selected</span>
            </div>
            <p className="text-xs text-gray-500">
                Select the work headers for which you want to track daily progress.
            </p>

            {allWorkHeadersLoading ? (
                <div className="flex justify-center py-8">
                    <TailSpin width={24} height={24} color="#6b7280" />
                </div>
            ) : (
                <div className="border border-gray-200 rounded max-h-64 overflow-y-auto">
                    {groupedWorkHeaders.map(([packageName, headers], groupIdx) => (
                        <div key={packageName} className={groupIdx > 0 ? "border-t border-gray-200" : ""}>
                            <div className="px-3 py-2 bg-gray-50 sticky top-0">
                                <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                                    {packageName}
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2">
                                {headers.map((header) => (
                                    <label
                                        key={header.work_header_doc_name}
                                        className="flex items-center gap-2 py-1.5 cursor-pointer"
                                    >
                                        <Checkbox
                                            checked={header.enabled}
                                            onCheckedChange={(checked) =>
                                                handleWorkHeaderCheckboxChange(header.work_header_doc_name, checked)
                                            }
                                        />
                                        <span className="text-sm text-gray-700">{header.work_header_display_name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {isStep3NextDisabled && (
                <p className="text-xs text-amber-600">Select at least one work header to continue.</p>
            )}
        </div>
    );

    // Step 4: Review
    const renderStep4 = () => (
        <div className="space-y-4 py-4">
            <p className="text-sm text-gray-600">Review your configuration before enabling progress tracking.</p>

            {/* Zones summary */}
            <div className="border border-gray-200 rounded">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
                    <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                        Zones ({localProjectZones.length})
                    </span>
                </div>
                <div className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                        {localProjectZones.map((zone) => (
                            <span
                                key={zone.zone_name}
                                className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded"
                            >
                                {zone.zone_name}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Work headers summary */}
            <div className="border border-gray-200 rounded">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
                    <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                        Work Headers ({enabledHeadersCount})
                    </span>
                </div>
                <div className="px-3 py-2 max-h-32 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {localWorkHeaders
                            .filter((h) => h.enabled)
                            .map((h) => (
                                <span key={h.work_header_doc_name} className="text-sm text-gray-700">
                                    {h.work_header_display_name}
                                </span>
                            ))}
                    </div>
                </div>
            </div>
        </div>
    );

    const stepTitles = ["Setup Progress Tracking", "Configure Zones", "Select Work Headers", "Review & Submit"];

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !isSaving && !open && onClose()}>
            <DialogContent className="sm:max-w-[550px] p-0 overflow-hidden">
                <DialogHeader className="px-6 pt-6 pb-0">
                    <DialogTitle className="text-base font-medium text-gray-900">{stepTitles[currentStep - 1]}</DialogTitle>
                    <DialogDescription className="text-xs text-gray-500">
                        Step {currentStep} of 4
                    </DialogDescription>
                </DialogHeader>

                <StepIndicator currentStep={currentStep} totalSteps={4} />

                <div className="px-6">
                    {currentStep === 1 && renderStep1()}
                    {currentStep === 2 && renderStep2()}
                    {currentStep === 3 && renderStep3()}
                    {currentStep === 4 && renderStep4()}
                </div>

                <DialogFooter className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                    <div className="flex items-center justify-between w-full">
                        <Button
                            variant="ghost"
                            onClick={currentStep === 1 ? onClose : () => setCurrentStep(currentStep - 1)}
                            disabled={isSaving}
                            className="text-gray-600"
                        >
                            {currentStep === 1 ? (
                                "Cancel"
                            ) : (
                                <>
                                    <ChevronLeft className="h-4 w-4 mr-1" /> Back
                                </>
                            )}
                        </Button>

                        {currentStep < 4 ? (
                            <Button
                                onClick={() => setCurrentStep(currentStep + 1)}
                                disabled={
                                    isSaving ||
                                    (currentStep === 2 && isStep2NextDisabled) ||
                                    (currentStep === 3 && isStep3NextDisabled)
                                }
                                className="bg-sky-500 hover:bg-sky-600 text-white"
                            >
                                Next <ChevronRight className="h-4 w-4 ml-1" />
                            </Button>
                        ) : (
                            <Button
                                onClick={handleFinalSave}
                                disabled={isSaving || updateDocLoading}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                            >
                                {isSaving || updateDocLoading ? (
                                    <TailSpin width={16} height={16} color="white" />
                                ) : (
                                    <>
                                        <Check className="h-4 w-4 mr-1" /> Enable Tracking
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
