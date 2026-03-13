import { useMemo, useState, useCallback } from "react";
import { useFrappeGetCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Search, FolderGit2, EyeOff, ChevronDown, Filter, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

import { ProjectWiseCard } from "./components/ProjectWiseCard";

export default function CommissionReportList() {
    const navigate = useNavigate();

    // List filters
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedProjectFilters, setSelectedProjectFilters] = useState<string[]>([]);
    const [isHiddenSectionOpen, setIsHiddenSectionOpen] = useState(false);

    const { role, user_id } = useUserData();
    const hasHideAccess = role === "Nirmaan Design Lead Profile" || role === "Nirmaan Admin Profile" || role === "Nirmaan PMO Executive Profile" || role === "Nirmaan Project Manager Profile" || user_id === "Administrator" || role === "Administrator";

    // Fetch List from Commission Report Endpoint
    const { data: trackerDocsData, isLoading, mutate: refetchList } = useFrappeGetCall<any>(
        "nirmaan_stack.api.commission_report.get_tracker_list.get_tracker_list",
        {}
    );

    const trackerDocs = useMemo(() => {
        if (!trackerDocsData) return [];
        if (Array.isArray(trackerDocsData)) return trackerDocsData;
        if (Array.isArray(trackerDocsData.message)) return trackerDocsData.message;
        return [];
    }, [trackerDocsData]);

    const trackerDocsWithReport = useMemo(() => {
        if (!trackerDocs) return [];
        return trackerDocs.filter((doc: any) => doc?.has_tracker === true);
    }, [trackerDocs]);

    // Derive Unique Project Names for Filter
    const projectFilterOptions = useMemo(() => {
        if (!trackerDocsWithReport) return [];
        const names = trackerDocsWithReport
            .map((doc: any) => doc.project_name)
            .filter(Boolean);
        return Array.from(new Set(names)).sort();
    }, [trackerDocsWithReport]);

    const filteredDocs = useMemo(() => {
        if (!trackerDocsWithReport) return [];
        const lowerCaseSearch = searchTerm.toLowerCase();
        return trackerDocsWithReport.filter((doc: any) => {
            const matchesSearch = doc.project_name?.toLowerCase().includes(lowerCaseSearch) ||
                doc.name?.toLowerCase().includes(lowerCaseSearch) ||
                doc.project?.toLowerCase().includes(lowerCaseSearch);

            const matchesProject = selectedProjectFilters.length === 0 || selectedProjectFilters.includes(doc.project_name);

            return matchesSearch && matchesProject;
        });
    }, [trackerDocsWithReport, searchTerm, selectedProjectFilters]);

    const activeDocs = useMemo(() => filteredDocs.filter((doc: any) => doc.hide_commission_report !== 1), [filteredDocs]);
    const hiddenDocs = useMemo(() => filteredDocs.filter((doc: any) => doc.hide_commission_report === 1), [filteredDocs]);

    const { updateDoc } = useFrappeUpdateDoc();

    const handleHideToggle = useCallback(async (trackerId: string, newHiddenState: boolean) => {
        try {
            await updateDoc("Project Commission Report", trackerId, {
                hide_commission_report: newHiddenState ? 1 : 0
            });
            refetchList();
            toast({
                title: newHiddenState ? "Report Hidden" : "Report Visible",
                description: newHiddenState
                    ? "Hidden from main list"
                    : "Now visible in main list",
            });
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to update visibility",
                variant: "destructive"
            });
        }
    }, [updateDoc, refetchList]);

    if (isLoading) return <TableSkeleton />;

    const hasNoData = trackerDocsWithReport.length === 0 && !isLoading;

    return (
        <div className="flex-1 space-y-4 md:p-4 pt-6">
            <div className="flex items-center justify-between px-2">
                <div className="flex flex-col gap-1.5">
                    <h2 className="text-2xl font-bold tracking-tight text-gray-900 border-l-4 border-primary pl-3">
                        Testing & Commissioning Reports
                    </h2>
                </div>
            </div>

            {hasNoData ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                    <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                        <FolderGit2 className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-1">
                        No Commission Reports found
                    </h3>
                    <p className="text-sm text-gray-500 max-w-sm">
                        There are no commission reports available.
                    </p>
                </div>
            ) : (
                <>
                    {/* Search and Filter Section */}
                    <div className="flex flex-col sm:flex-row gap-3 px-2 mt-4">
                        {/* Search Input */}
                        <div className="relative flex-1 min-w-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                            <Input
                                placeholder="Search by project name or ID..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 h-10 border-gray-300 focus:ring-2 focus:ring-primary/20"
                            />
                        </div>

                        {/* Filter Button */}
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    className="flex items-center gap-2 h-10 border-gray-300 text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                                >
                                    <Filter className="h-4 w-4" />
                                    <span className="hidden sm:inline">Filter</span>
                                    {selectedProjectFilters.length > 0 && (
                                        <Badge variant="secondary" className="h-5 min-w-[20px] px-1.5 bg-primary text-white text-xs">
                                            {selectedProjectFilters.length}
                                        </Badge>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[280px] p-0" align="end">
                                <Command>
                                    <CommandInput placeholder="Search projects..." className="h-9" />
                                    <CommandList>
                                        <CommandEmpty>No project found.</CommandEmpty>
                                        <CommandGroup>
                                            {projectFilterOptions.map((option: any) => {
                                                const isSelected = selectedProjectFilters.includes(option);
                                                return (
                                                    <CommandItem
                                                        key={option}
                                                        onSelect={() => {
                                                            if (isSelected) {
                                                                setSelectedProjectFilters(prev => prev.filter(p => p !== option));
                                                            } else {
                                                                setSelectedProjectFilters(prev => [...prev, option]);
                                                            }
                                                        }}
                                                        className="cursor-pointer"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <div className={`flex h-4 w-4 items-center justify-center rounded-sm border transition-colors ${isSelected
                                                                    ? "border-primary bg-primary text-primary-foreground"
                                                                    : "border-primary/20 opacity-50"
                                                                }`}>
                                                                <Check className={isSelected ? "h-3 w-3 text-white" : "h-3 w-3 opacity-0"} />
                                                            </div>
                                                            <span>{option}</span>
                                                        </div>
                                                    </CommandItem>
                                                );
                                            })}
                                        </CommandGroup>
                                    </CommandList>
                                    {selectedProjectFilters.length > 0 && (
                                        <div className="p-2 border-t text-center">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 w-full text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                                                onClick={() => setSelectedProjectFilters([])}
                                            >
                                                Clear filters
                                            </Button>
                                        </div>
                                    )}
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* Active Filters Display */}
                    {selectedProjectFilters.length > 0 && (
                        <div className="flex flex-wrap gap-2 px-2 mt-4 items-center">
                            <span className="text-sm text-gray-500 mr-2">Filters:</span>
                            {selectedProjectFilters.map(filter => (
                                <Badge
                                    key={filter}
                                    variant="secondary"
                                    className="bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1.5 px-3 border border-primary/20"
                                >
                                    <span className="truncate max-w-[200px]">{filter}</span>
                                    <button
                                        onClick={() => setSelectedProjectFilters(prev => prev.filter(p => p !== filter))}
                                        className="rounded-full hover:bg-primary/20 p-0.5"
                                    >
                                        ×
                                        <span className="sr-only">Remove filter</span>
                                    </button>
                                </Badge>
                            ))}
                        </div>
                    )}

                    {/* Mapping Project Cards */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 px-2 mt-6 pb-4">
                        {activeDocs.map((doc: any) => (
                            <ProjectWiseCard
                                key={doc.name}
                                tracker={doc}
                                onClick={() => navigate(`/commission-tracker/${doc.name}`)}
                                showHiddenBadge={hasHideAccess}
                                onHideToggle={hasHideAccess ? handleHideToggle : undefined}
                            />
                        ))}
                    </div>

                    {/* Hidden Trackers Section */}
                    {hasHideAccess && hiddenDocs.length > 0 && (
                        <Collapsible
                            open={isHiddenSectionOpen}
                            onOpenChange={setIsHiddenSectionOpen}
                            className="mt-4 px-2 pb-8"
                        >
                            <CollapsibleTrigger asChild>
                                <button className="flex items-center gap-2 w-full px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors">
                                    <EyeOff className="h-4 w-4 text-orange-600" />
                                    <span className="text-sm font-medium text-orange-700">
                                        Hidden Reports
                                    </span>
                                    <Badge
                                        variant="secondary"
                                        className="px-2 py-0.5 text-xs bg-orange-200 text-orange-800 border-0"
                                    >
                                        {hiddenDocs.length}
                                    </Badge>
                                    <ChevronDown
                                        className={`h-4 w-4 text-orange-600 ml-auto transition-transform duration-200 ${
                                            isHiddenSectionOpen ? 'rotate-180' : ''
                                        }`}
                                    />
                                </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {hiddenDocs.map((doc: any) => (
                                        <ProjectWiseCard
                                            key={doc.name}
                                            tracker={doc}
                                            onClick={() => navigate(`/commission-tracker/${doc.name}`)}
                                            showHiddenBadge={true}
                                            onHideToggle={handleHideToggle}
                                        />
                                    ))}
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    )}
                </>
            )}
        </div>
    );
}
