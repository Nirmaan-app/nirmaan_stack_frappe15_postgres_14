import { useMemo, useCallback, useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { ProjectFormValues, DailyProgressWorkHeader } from "../schema";
import { ProjectFormData, WorkPackageType, WorkHeaderType } from "../hooks/useProjectFormData";
import { Plus, X, ClipboardList, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

// Local type for form's internal work package structure
interface FormWorkPackage {
    work_package_name: string;
    category_list: {
        list: Array<{
            name: string;
            makes: Array<{ label: string; value: string }>;
        }>;
    };
}

interface PackageSelectionStepProps {
    form: UseFormReturn<ProjectFormValues>;
    formData: ProjectFormData;
    onNext: () => void;
    onPrevious: () => void;
}

export const PackageSelectionStep: React.FC<PackageSelectionStepProps> = ({
    form,
    formData,
    onNext,
    onPrevious,
}) => {
    const { workPackages, categories, workHeaders, isPackageDataLoading, isWorkHeadersLoading } = formData;
    const watchedWorkPackages = form.watch("project_work_packages.work_packages");
    const selectedWorkPackages: FormWorkPackage[] = Array.isArray(watchedWorkPackages) ? watchedWorkPackages : [];

    // Daily Progress Setup state
    const dailyProgressSetup = form.watch("daily_progress_setup");
    const isProgressEnabled = dailyProgressSetup?.enabled ?? false;
    const zoneType = dailyProgressSetup?.zone_type;
    const zones = dailyProgressSetup?.zones ?? [];
    const selectedWorkHeaders = dailyProgressSetup?.work_headers ?? [];

    // Local state for new zone input
    const [newZoneName, setNewZoneName] = useState("");
    const [expandedPackages, setExpandedPackages] = useState<Set<string>>(new Set());

    // Get categories for a work package
    const getCategoriesForPackage = (workPackageName: string) => {
        return categories?.filter((cat) => cat.work_package === workPackageName) || [];
    };

    // Check if a work package is selected
    const isPackageSelected = (workPackageName: string) => {
        return selectedWorkPackages.some((wp) => wp.work_package_name === workPackageName);
    };

    // Calculate selection stats
    const selectionStats = useMemo(() => {
        const totalPackages = workPackages?.length || 0;
        const selectedCount = selectedWorkPackages.length;
        return { totalPackages, selectedCount };
    }, [workPackages, selectedWorkPackages]);

    // Handle work package selection
    const handlePackageToggle = (workPackageName: string, checked: boolean) => {
        const packageCategories = getCategoriesForPackage(workPackageName);
        const currentPackages = [...selectedWorkPackages];

        if (checked) {
            if (currentPackages.some((wp) => wp.work_package_name === workPackageName)) {
                return;
            }
            const newPackage: FormWorkPackage = {
                work_package_name: workPackageName,
                category_list: {
                    list: packageCategories.map((cat) => ({
                        name: cat.category_name,
                        makes: [],
                    })),
                },
            };
            form.setValue("project_work_packages.work_packages", [
                ...currentPackages,
                newPackage,
            ]);
        } else {
            form.setValue(
                "project_work_packages.work_packages",
                currentPackages.filter((wp) => wp.work_package_name !== workPackageName)
            );
        }
    };

    // Handle select all
    const handleSelectAll = (checked: boolean) => {
        if (checked && workPackages) {
            const allWorkPackages = workPackages.map((wp) => ({
                work_package_name: wp.work_package_name,
                category_list: {
                    list: getCategoriesForPackage(wp.work_package_name).map((cat) => ({
                        name: cat.category_name,
                        makes: [],
                    })),
                },
            }));
            form.setValue("project_work_packages.work_packages", allWorkPackages);
        } else {
            form.setValue("project_work_packages.work_packages", []);
        }
    };

    const isAllSelected = selectionStats.selectedCount === selectionStats.totalPackages && selectionStats.totalPackages > 0;

    // ═══════════════════════════════════════════════════════════════════════
    // DAILY PROGRESS REPORT SETUP HANDLERS
    // ═══════════════════════════════════════════════════════════════════════

    const handleProgressEnabledChange = useCallback((checked: boolean) => {
        form.setValue("daily_progress_setup.enabled", checked);
        if (!checked) {
            // Reset all settings when disabled
            form.setValue("daily_progress_setup.zone_type", undefined);
            form.setValue("daily_progress_setup.zones", []);
            form.setValue("daily_progress_setup.work_headers", []);
        }
    }, [form]);

    const handleZoneTypeChange = useCallback((value: 'single' | 'multiple') => {
        form.setValue("daily_progress_setup.zone_type", value);
        if (value === 'single') {
            form.setValue("daily_progress_setup.zones", []);
        }
    }, [form]);

    const handleAddZone = useCallback(() => {
        const trimmedName = newZoneName.trim();
        if (!trimmedName) return;

        // Check for duplicates
        if (zones.some(z => z.zone_name.toLowerCase() === trimmedName.toLowerCase())) {
            return;
        }

        form.setValue("daily_progress_setup.zones", [...zones, { zone_name: trimmedName }]);
        setNewZoneName("");
    }, [newZoneName, zones, form]);

    const handleRemoveZone = useCallback((zoneName: string) => {
        form.setValue("daily_progress_setup.zones", zones.filter(z => z.zone_name !== zoneName));
    }, [zones, form]);

    const handleWorkHeaderToggle = useCallback((header: WorkHeaderType, checked: boolean) => {
        const newHeader: DailyProgressWorkHeader = {
            work_header_doc_name: header.name,
            work_header_display_name: header.work_header_name,
            work_package_link: header.work_package_link,
        };

        if (checked) {
            // Add header if not already selected
            if (!selectedWorkHeaders.some(wh => wh.work_header_doc_name === header.name)) {
                form.setValue("daily_progress_setup.work_headers", [...selectedWorkHeaders, newHeader]);
            }
        } else {
            // Remove header
            form.setValue(
                "daily_progress_setup.work_headers",
                selectedWorkHeaders.filter(wh => wh.work_header_doc_name !== header.name)
            );
        }
    }, [selectedWorkHeaders, form]);

    const isWorkHeaderSelected = useCallback((headerName: string) => {
        return selectedWorkHeaders.some(wh => wh.work_header_doc_name === headerName);
    }, [selectedWorkHeaders]);

    const togglePackageExpand = useCallback((packageName: string) => {
        setExpandedPackages(prev => {
            const next = new Set(prev);
            if (next.has(packageName)) {
                next.delete(packageName);
            } else {
                next.add(packageName);
            }
            return next;
        });
    }, []);

    // Get ALL work headers grouped by their work_package_link
    const groupedWorkHeaders = useMemo(() => {
        if (!workHeaders || workHeaders.length === 0) return [];

        const groups: { packageName: string; headers: WorkHeaderType[] }[] = [];
        const groupMap = new Map<string, WorkHeaderType[]>();

        // Group all work headers by their work_package_link
        workHeaders.forEach(wh => {
            const linkName = wh.work_package_link || "Uncategorized";
            if (!groupMap.has(linkName)) {
                groupMap.set(linkName, []);
            }
            groupMap.get(linkName)!.push(wh);
        });

        // Convert map to array, sorting so "Uncategorized" appears last
        const sortedKeys = Array.from(groupMap.keys()).sort((a, b) => {
            if (a === "Uncategorized" || a === "None") return 1;
            if (b === "Uncategorized" || b === "None") return -1;
            return a.localeCompare(b);
        });

        sortedKeys.forEach(key => {
            const headers = groupMap.get(key)!;
            groups.push({
                packageName: key === "None" ? "Uncategorized" : key,
                headers
            });
        });

        return groups;
    }, [workHeaders]);

    // Loading state
    if (isPackageDataLoading) {
        return (
            <div className="space-y-4">
                <div className="h-4 bg-gray-100 rounded w-48 animate-pulse" />
                <div className="border border-gray-200 rounded">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-10 border-b border-gray-100 animate-pulse bg-gray-50" />
                    ))}
                </div>
            </div>
        );
    }

    // Pair work packages into rows of 2
    const workPackageRows: WorkPackageType[][] = [];
    if (workPackages) {
        for (let i = 0; i < workPackages.length; i += 2) {
            workPackageRows.push(workPackages.slice(i, i + 2));
        }
    }

    return (
        <div className="space-y-8">
            {/* ════════════════════════════════════════════════════════════
                SECTION 1: Work Package Selection
                ════════════════════════════════════════════════════════════ */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-gray-700">
                        Work Packages <span className="text-red-500">*</span>
                    </Label>
                    {selectionStats.selectedCount > 0 && (
                        <span className="text-xs text-gray-500">
                            {selectionStats.selectedCount} of {selectionStats.totalPackages} selected
                        </span>
                    )}
                </div>

                {/* Select All */}
                <div className="flex items-center gap-2 py-2 px-3 bg-gray-50 border border-gray-200 rounded-t">
                    <Checkbox
                        id="select-all-packages"
                        checked={isAllSelected}
                        onCheckedChange={(checked) => handleSelectAll(checked === true)}
                    />
                    <Label
                        htmlFor="select-all-packages"
                        className="text-sm font-medium text-gray-600 cursor-pointer"
                    >
                        Select All
                    </Label>
                </div>

                {/* Work Package Grid - 2 columns */}
                <div className="border border-gray-200 border-t-0 rounded-b overflow-hidden">
                    {workPackageRows.map((row, rowIndex) => (
                        <div
                            key={rowIndex}
                            className="grid grid-cols-1 sm:grid-cols-2 divide-x divide-gray-200 border-t border-gray-200 first:border-t-0"
                        >
                            {row.map((pkg) => {
                                const isSelected = isPackageSelected(pkg.work_package_name);
                                const categoryCount = getCategoriesForPackage(pkg.work_package_name).length;

                                return (
                                    <label
                                        key={pkg.work_package_name}
                                        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50"
                                    >
                                        <Checkbox
                                            checked={isSelected}
                                            onCheckedChange={(checked) => {
                                                if (typeof checked === 'boolean') {
                                                    handlePackageToggle(pkg.work_package_name, checked);
                                                }
                                            }}
                                        />
                                        <span className="text-sm text-gray-700">
                                            {pkg.work_package_name}
                                        </span>
                                        <span className="text-xs text-gray-400">
                                            ({categoryCount})
                                        </span>
                                    </label>
                                );
                            })}
                            {/* Empty cell if odd number */}
                            {row.length === 1 && (
                                <div className="hidden sm:block px-3 py-2.5 bg-gray-50/50" />
                            )}
                        </div>
                    ))}
                </div>

                {/* Empty state */}
                {(!workPackages || workPackages.length === 0) && (
                    <div className="text-center py-6 text-sm text-gray-400 border border-gray-200 border-t-0 rounded-b">
                        No work packages available
                    </div>
                )}

                {/* Validation message */}
                {selectionStats.selectedCount === 0 && (
                    <p className="text-xs text-amber-600 mt-2">
                        Please select at least one work package
                    </p>
                )}
            </div>

            {/* ════════════════════════════════════════════════════════════
                SECTION 2: Daily Progress Report Setup (Optional)
                ════════════════════════════════════════════════════════════ */}
            <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <div className="flex items-center gap-2">
                        <ClipboardList className="h-4 w-4 text-gray-500" />
                        <Label className="text-sm font-medium text-gray-700">
                            Daily Progress Reports
                        </Label>
                        <span className="text-xs text-gray-400 font-normal">(Optional)</span>
                    </div>
                </div>

                {/* Enable Toggle */}
                <label className="flex items-center gap-3 px-3 py-2.5 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                    <Checkbox
                        id="enable-progress-reports"
                        checked={isProgressEnabled}
                        onCheckedChange={(checked) => handleProgressEnabledChange(checked === true)}
                    />
                    <div className="flex-1">
                        <span className="text-sm text-gray-700">
                            Enable Daily Progress Reports for this project
                        </span>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Track work progress with zones and milestones
                        </p>
                    </div>
                </label>

                {/* Expanded Settings (when enabled) */}
                {isProgressEnabled && (
                    <div className="border border-gray-200 rounded overflow-hidden">
                        {/* Zone Setup */}
                        <div className="p-4 bg-gray-50/50 border-b border-gray-200">
                            <Label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                                Zone Configuration
                            </Label>
                            <p className="text-xs text-gray-400 mt-1 mb-3">
                                Zones help organize progress tracking by area
                            </p>

                            <RadioGroup
                                value={zoneType || ''}
                                onValueChange={(value: string) => handleZoneTypeChange(value as 'single' | 'multiple')}
                                className="space-y-2"
                            >
                                <label className="flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded cursor-pointer hover:border-gray-300">
                                    <RadioGroupItem value="single" id="zone-single" />
                                    <div>
                                        <span className="text-sm text-gray-700">Single Zone (Default)</span>
                                        <p className="text-xs text-gray-400">All work tracked under one zone</p>
                                    </div>
                                </label>
                                <label className="flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded cursor-pointer hover:border-gray-300">
                                    <RadioGroupItem value="multiple" id="zone-multiple" />
                                    <div>
                                        <span className="text-sm text-gray-700">Multiple Zones</span>
                                        <p className="text-xs text-gray-400">Track progress by floor, wing, or area</p>
                                    </div>
                                </label>
                            </RadioGroup>

                            {/* Multiple Zones Input */}
                            {zoneType === 'multiple' && (
                                <div className="mt-4 space-y-3">
                                    {/* Zone List */}
                                    {zones.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {zones.map((zone) => (
                                                <div
                                                    key={zone.zone_name}
                                                    className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded text-sm"
                                                >
                                                    <span className="text-gray-700">{zone.zone_name}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveZone(zone.zone_name)}
                                                        className="text-gray-400 hover:text-red-500"
                                                    >
                                                        <X className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Add Zone Input */}
                                    <div className="flex gap-2">
                                        <Input
                                            type="text"
                                            placeholder="Enter zone name (e.g., Ground Floor, Tower A)"
                                            value={newZoneName}
                                            onChange={(e) => setNewZoneName(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    handleAddZone();
                                                }
                                            }}
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

                                    {zones.length === 0 && (
                                        <p className="text-xs text-amber-600">
                                            Add at least one zone to continue
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Work Headers Selection */}
                        {zoneType && (zoneType === 'single' || zones.length > 0) && (
                            <div className="p-4">
                                <Label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                                    Work Headers to Track
                                </Label>
                                <p className="text-xs text-gray-400 mt-1 mb-3">
                                    Select work categories to track daily progress
                                </p>

                                {isWorkHeadersLoading ? (
                                    <div className="space-y-2">
                                        {[1, 2, 3].map((i) => (
                                            <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
                                        ))}
                                    </div>
                                ) : groupedWorkHeaders.length === 0 ? (
                                    <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded">
                                        No work headers found in the system
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {groupedWorkHeaders.map(({ packageName, headers }) => {
                                            const isExpanded = expandedPackages.has(packageName);
                                            const selectedInPackage = headers.filter(h => isWorkHeaderSelected(h.name)).length;

                                            return (
                                                <div key={packageName} className="border border-gray-200 rounded overflow-hidden">
                                                    {/* Package Header */}
                                                    <button
                                                        type="button"
                                                        onClick={() => togglePackageExpand(packageName)}
                                                        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left"
                                                    >
                                                        <span className="text-sm font-medium text-gray-700">
                                                            {packageName}
                                                        </span>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs text-gray-400">
                                                                {selectedInPackage}/{headers.length} selected
                                                            </span>
                                                            {isExpanded ? (
                                                                <ChevronDown className="h-4 w-4 text-gray-400" />
                                                            ) : (
                                                                <ChevronRight className="h-4 w-4 text-gray-400" />
                                                            )}
                                                        </div>
                                                    </button>

                                                    {/* Headers List */}
                                                    {isExpanded && (
                                                        <div className="px-3 py-2 space-y-1">
                                                            {headers.map((header) => (
                                                                <label
                                                                    key={header.name}
                                                                    className="flex items-center gap-2 py-1.5 cursor-pointer"
                                                                >
                                                                    <Checkbox
                                                                        checked={isWorkHeaderSelected(header.name)}
                                                                        onCheckedChange={(checked) => {
                                                                            if (typeof checked === 'boolean') {
                                                                                handleWorkHeaderToggle(header, checked);
                                                                            }
                                                                        }}
                                                                    />
                                                                    <span className="text-sm text-gray-600">
                                                                        {header.work_header_name}
                                                                    </span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {selectedWorkHeaders.length > 0 && (
                                    <p className="text-xs text-gray-500 mt-3">
                                        {selectedWorkHeaders.length} work header{selectedWorkHeaders.length !== 1 ? 's' : ''} selected
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ════════════════════════════════════════════════════════════
                SECTION 3: Placeholder for future content
                ════════════════════════════════════════════════════════════ */}
            {/* Section 3 will be added here */}

            {/* ════════════════════════════════════════════════════════════
                SECTION 4: Placeholder for future content
                ════════════════════════════════════════════════════════════ */}
            {/* Section 4 will be added here */}

            {/* ════════════════════════════════════════════════════════════
                SECTION 5: Placeholder for future content
                ════════════════════════════════════════════════════════════ */}
            {/* Section 5 will be added here */}

            {/* ════════════════════════════════════════════════════════════
                Navigation
                ════════════════════════════════════════════════════════════ */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <Button
                    type="button"
                    variant="ghost"
                    onClick={onPrevious}
                    className="text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                >
                    ← Previous
                </Button>
                <Button
                    type="button"
                    onClick={onNext}
                    disabled={selectionStats.selectedCount === 0}
                    className="bg-sky-500 hover:bg-sky-600 text-white px-6 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Continue →
                </Button>
            </div>
        </div>
    );
};

export default PackageSelectionStep;
