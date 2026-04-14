import React, { useMemo, useState, useCallback } from "react";
import { useFrappePostCall, useFrappeGetDocList } from "frappe-react-sdk";
import { useNavigate } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";
import { ArrowLeft, Search, EyeOff, Eye, ArrowUpRight, Filter, Check, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CardListSkeleton } from "@/components/ui/skeleton";

interface CategorySummary {
  total: number;
  done: number;
}

interface PMOProject {
  name: string;
  project_name: string;
  project_city: string;
  project_state: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  pending_tasks: number;
  progress: number;
  categories: Record<string, CategorySummary>;
  disabled_pmo: 0 | 1;
}



const formatCategoryName = (cat: string) => {
  return cat
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

const STYLE_PALETTE = [
  {
    bg: "bg-gray-50/80 border border-gray-100",
    text: "text-gray-500",
    countText: "text-gray-700",
  },
  {
    bg: "bg-blue-50/80 border border-blue-100",
    text: "text-blue-700",
    countText: "text-blue-900",
  },
  {
    bg: "bg-green-50/80 border border-green-100",
    text: "text-green-700",
    countText: "text-green-900",
  },
  {
    bg: "bg-amber-50/80 border border-amber-100",
    text: "text-amber-700",
    countText: "text-amber-900",
  },
];

const DEFAULT_STYLE = {
  bg: "bg-slate-50/80 border border-slate-100",
  text: "text-slate-500",
  countText: "text-slate-700",
};




const PMODashboardList: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProjectFilters, setSelectedProjectFilters] = useState<string[]>([]);
  const [filtersInitialized, setFiltersInitialized] = useState(false);
  const [isHiddenSectionOpen, setIsHiddenSectionOpen] = useState(false);

  const { data: masterCategories } = useFrappeGetDocList("PMO Task Category", {
    fields: ["category_name"],
    orderBy: { field: "category_name", order: "asc" },
  });

  const sortedMasterNames = useMemo(() => {
    return (masterCategories || []).map((c) => c.category_name);
  }, [masterCategories]);

  // Map category names to their style indices
  const categoryStyleMap = useMemo(() => {
    const map = new Map<string, number>();
    sortedMasterNames.forEach((name, idx) => {
      map.set(name, idx);
    });
    return map;
  }, [sortedMasterNames]);

  const getStyleForCategory = useCallback((catName: string) => {
    const idx = categoryStyleMap.get(catName);
    if (idx === undefined) return DEFAULT_STYLE;
    return STYLE_PALETTE[idx % STYLE_PALETTE.length];
  }, [categoryStyleMap]);

  const sortCategories = useCallback((cats: [string, any][]) => {
    return [...cats].sort(([a], [b]) => {
      const idxA = categoryStyleMap.get(a) ?? 999;
      const idxB = categoryStyleMap.get(b) ?? 999;
      return idxA - idxB;
    });
  }, [categoryStyleMap]);

  const { call, loading } = useFrappePostCall(
    "nirmaan_stack.api.pmo_dashboard.get_pmo_projects"
  );

  const { call: toggleVisibility } = useFrappePostCall(
    "nirmaan_stack.api.pmo_dashboard.update_project_pmo_visibility"
  );

  const [projects, setProjects] = React.useState<PMOProject[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  const fetchProjects = useCallback(() => {
    call({}).then((res: any) => {
      setProjects(res?.message || []);
      setLoaded(true);
    });
  }, [call]);

  React.useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const toggleHide = useCallback((projectName: string, currentStatus: number) => {
    const newStatus = currentStatus === 1 ? 0 : 1;
    toggleVisibility({
      project_name: projectName,
      disabled: newStatus
    }).then(() => {
      fetchProjects();
    });
  }, [toggleVisibility, fetchProjects]);

  // Derive unique project statuses for filter dropdown
  const projectStatusOptions = useMemo(() => {
    if (!projects) return [];
    const statuses = projects.map((p) => p.status).filter(Boolean);
    return Array.from(new Set(statuses)).sort();
  }, [projects]);

  // Auto-select all statuses except "Completed" on first load
  React.useEffect(() => {
    if (loaded && projects.length > 0 && !filtersInitialized) {
      const initialFilters = projectStatusOptions.filter((status) => status !== "Completed");
      setSelectedProjectFilters(initialFilters);
      setFiltersInitialized(true);
    }
  }, [loaded, projects.length, projectStatusOptions, filtersInitialized]);

  const filteredProjects = useMemo(() => {
    let list = projects;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.project_name?.toLowerCase().includes(q) ||
          p.name?.toLowerCase().includes(q)
      );
    }
    if (selectedProjectFilters.length > 0) {
      list = list.filter((p) => selectedProjectFilters.includes(p.status));
    }
    return list;
  }, [projects, searchQuery, selectedProjectFilters]);

  const activeProjects = useMemo(() => filteredProjects.filter((p) => p.disabled_pmo === 0), [filteredProjects]);
  const hiddenProjectsList = useMemo(() => filteredProjects.filter((p) => p.disabled_pmo === 1), [filteredProjects]);

  if (loading && !loaded) {
    return <CardListSkeleton />;
  }

  return (
    <div className="flex-1 md:space-y-4">
      {/* Header */}
      {/* <div className="flex items-center gap-1 mb-2">
        <ArrowLeft
          className="h-5 w-5 cursor-pointer text-gray-500 hover:text-gray-700"
          onClick={() => navigate(-1)}
        />
        <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          PMO DASHBOARD
        </span>
      </div> */}

      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
          PMO Dashboard
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Track task progress and status across all active projects
        </p>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
          <Input
            placeholder="Search by project name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
              <span className="hidden sm:inline">Status</span>
              {selectedProjectFilters.length > 0 && (
                <Badge variant="secondary" className="h-5 min-w-[20px] px-1.5 bg-primary text-white text-xs">
                  {selectedProjectFilters.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="end">
            <Command>
              <CommandInput placeholder="Filter by status..." className="h-9" />
              <CommandList>
                <CommandEmpty>No project found.</CommandEmpty>
                <CommandGroup>
                  {projectStatusOptions.map((option) => {
                    const isSelected = selectedProjectFilters.includes(option);
                    return (
                      <CommandItem
                        key={option}
                        onSelect={() => {
                          if (isSelected) {
                            setSelectedProjectFilters((prev) => prev.filter((p) => p !== option));
                          } else {
                            setSelectedProjectFilters((prev) => [...prev, option]);
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
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <span className="text-sm text-gray-500 mr-2">Filters:</span>
          {selectedProjectFilters.map((filter) => (
            <Badge
              key={filter}
              variant="secondary"
              className="bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1.5 px-3 border border-primary/20"
            >
              <span className="truncate max-w-[200px]">{filter}</span>
              <button
                onClick={() => setSelectedProjectFilters((prev) => prev.filter((p) => p !== filter))}
                className="rounded-full hover:bg-primary/20 p-0.5"
              >
                ×
                <span className="sr-only">Remove filter</span>
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Project Cards Grid */}
      {activeProjects.length === 0 && hiddenProjectsList.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-1">
            No Projects Found
          </h3>
          <p className="text-sm text-gray-500">
            {searchQuery
              ? "No projects match your search."
              : "No active projects with PMO tasks."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeProjects.map((project) => {
              const orderedCategories = sortCategories(Object.entries(project.categories || {}));

              const progressColor =
                project.progress >= 75
                  ? "text-green-600"
                  : project.progress >= 30
                    ? "text-amber-500"
                    : "text-red-500";

              return (
                <div
                  key={project.name}
                  onClick={() => navigate(`/pmo-dashboard/${project.name}`)}
                  className={`
                  group flex flex-col justify-between
                  border bg-white rounded-xl
                  transition-all duration-300 ease-in-out
                  hover:shadow-md hover:border-blue-400
                  cursor-pointer h-full min-h-[220px]
                  border-gray-200
                `}
                >
                  <div className="p-4 flex flex-col h-full relative">
                    {/* Card Header */}
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1 flex flex-col gap-1 pr-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-gray-900 text-lg leading-tight line-clamp-2">
                            {project.project_name || project.name}
                          </h3>
                          <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-100 shadow-sm leading-none shrink-0">
                            {project.status}
                          </span>
                        </div>
                      </div>
                      <ProgressCircle
                        value={project.progress}
                        className={`size-[38px] flex-shrink-0 ${progressColor}`}
                        textSizeClassName="text-[10px]"
                      />
                    </div>

                    <div className="mt-auto">
                      {/* Category Grid - 2x2 layout */}
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        {orderedCategories.map(([cat, summary]) => {
                          const color = getStyleForCategory(cat);
                          const formattedCat = formatCategoryName(cat);
                          return (
                            <div
                              key={cat}
                              className={`flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-md ${color.bg}`}
                            >
                              <span className={`font-medium truncate mr-1 ${color.text}`}>
                                {formattedCat}
                              </span>
                              <span className={`font-semibold whitespace-nowrap ${color.countText}`}>
                                {summary.done}/{summary.total}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Card Footer */}
                      <div className="border-t border-gray-100 pt-3 mt-auto flex justify-between items-center text-xs font-medium">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleHide(project.name, project.disabled_pmo);
                          }}
                          className="h-6 text-[10px] px-2 gap-1 text-gray-500 hover:text-orange-600 flex items-center transition-colors"
                        >
                          <EyeOff className="h-3 w-3" />
                          Hide
                        </button>
                        <div className="flex items-center gap-1 text-red-500 hover:text-red-600 transition-colors group/link">
                          <span>View Details</span>
                          <ArrowUpRight className="w-3.5 h-3.5 group-hover/link:-translate-y-[2px] group-hover/link:translate-x-[2px] transition-transform" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hidden Projects Section */}
          {hiddenProjectsList.length > 0 && (
            <Collapsible
              open={isHiddenSectionOpen}
              onOpenChange={setIsHiddenSectionOpen}
              className="mt-4 pb-8"
            >
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-2 w-full px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors">
                  <EyeOff className="h-4 w-4 text-orange-600" />
                  <span className="text-sm font-medium text-orange-700">
                    Hidden Projects
                  </span>
                  <Badge
                    variant="secondary"
                    className="px-2 py-0.5 text-xs bg-orange-200 text-orange-800 border-0"
                  >
                    {hiddenProjectsList.length}
                  </Badge>
                  <ChevronDown
                    className={`h-4 w-4 text-orange-600 ml-auto transition-transform duration-200 ${isHiddenSectionOpen ? 'rotate-180' : ''
                      }`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {hiddenProjectsList.map((project) => {
                    const orderedCategories = sortCategories(Object.entries(project.categories || {}));

                    const progressColor =
                      project.progress >= 75
                        ? "text-green-600"
                        : project.progress >= 30
                          ? "text-amber-500"
                          : "text-gray-500";

                    return (
                      <div
                        key={project.name}
                        onClick={() => navigate(`/pmo-dashboard/${project.name}`)}
                        className="group flex flex-col justify-between border border-orange-300 bg-orange-50/30 rounded-xl transition-all duration-300 ease-in-out hover:shadow-md hover:border-blue-400 cursor-pointer h-full min-h-[220px]"
                      >
                        <div className="p-4 flex flex-col h-full relative">
                          {/* Card Header */}
                          <div className="flex justify-between items-start mb-4">
                            <div className="flex-1 flex flex-col gap-1 pr-2">
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 w-fit bg-orange-100 text-orange-700 border-orange-300"
                              >
                                <EyeOff className="h-2.5 w-2.5 mr-1" />
                                Hidden
                              </Badge>
                              <h3 className="font-semibold text-gray-900 text-lg leading-tight line-clamp-2">
                                {project.project_name || project.name}
                              </h3>
                            </div>
                            <ProgressCircle
                              value={project.progress}
                              className={`size-[38px] flex-shrink-0 ${progressColor}`}
                              textSizeClassName="text-[10px]"
                            />
                          </div>

                          <div className="mt-auto">
                            {/* Category Grid - 2x2 layout */}
                            <div className="grid grid-cols-2 gap-2 mb-4">
                              {orderedCategories.map(([cat, summary]) => {
                                const color = getStyleForCategory(cat);
                                const formattedCat = formatCategoryName(cat);
                                return (
                                  <div
                                    key={cat}
                                    className={`flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-md ${color.bg}`}
                                  >
                                    <span className={`font-medium truncate mr-1 ${color.text}`}>
                                      {formattedCat}
                                    </span>
                                    <span className={`font-semibold whitespace-nowrap ${color.countText}`}>
                                      {summary.done}/{summary.total}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Card Footer */}
                            <div className="border-t border-gray-100 pt-3 mt-auto flex justify-between items-center text-xs font-medium">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleHide(project.name, project.disabled_pmo);
                                }}
                                className="h-6 text-[10px] px-2 gap-1 text-gray-500 hover:text-orange-600 flex items-center transition-colors"
                              >
                                <Eye className="h-3 w-3" />
                                Unhide
                              </button>
                              <div className="flex items-center gap-1 text-red-500 hover:text-red-600 transition-colors group/link">
                                <span>View Details</span>
                                <ArrowUpRight className="w-3.5 h-3.5 group-hover/link:-translate-y-[2px] group-hover/link:translate-x-[2px] transition-transform" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
    </div>
  );
};

export default PMODashboardList;
