import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Building2, ChevronDown, FolderKanban, CalendarPlus } from "lucide-react";
import { useFrappeGetDocCount, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { CUSTOMER_DOCTYPE } from '../customers.constants';
import { cn } from "@/lib/utils";

// State colors for visual distinction (using state names)
const STATE_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
    "Maharashtra": { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", dot: "bg-orange-500" },
    "Karnataka": { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700", dot: "bg-purple-500" },
    "Tamil Nadu": { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", dot: "bg-blue-500" },
    "Telangana": { bg: "bg-pink-50", border: "border-pink-200", text: "text-pink-700", dot: "bg-pink-500" },
    "Delhi": { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", dot: "bg-red-500" },
    "Gujarat": { bg: "bg-green-50", border: "border-green-200", text: "text-green-700", dot: "bg-green-500" },
    "Haryana": { bg: "bg-cyan-50", border: "border-cyan-200", text: "text-cyan-700", dot: "bg-cyan-500" },
    "Uttar Pradesh": { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", dot: "bg-amber-500" },
    "West Bengal": { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-700", dot: "bg-indigo-500" },
    "Rajasthan": { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700", dot: "bg-rose-500" },
    "Kerala": { bg: "bg-teal-50", border: "border-teal-200", text: "text-teal-700", dot: "bg-teal-500" },
    "Andhra Pradesh": { bg: "bg-lime-50", border: "border-lime-200", text: "text-lime-700", dot: "bg-lime-500" },
    "Punjab": { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-700", dot: "bg-yellow-500" },
    "Madhya Pradesh": { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500" },
};

const getStateColors = (stateName: string) => {
    return STATE_COLORS[stateName] || { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-700", dot: "bg-slate-500" };
};

// State count pill component
interface StateCountPillProps {
    stateName: string;
    count: number;
    compact?: boolean;
}

const StateCountPill: React.FC<StateCountPillProps> = ({
    stateName,
    count,
    compact = false,
}) => {
    const colors = getStateColors(stateName);
    const displayName = stateName.length > 14 ? stateName.slice(0, 12) + "..." : stateName;

    return (
        <div
            className={cn(
                "inline-flex items-center gap-1.5 rounded-full border transition-all hover:shadow-sm flex-shrink-0",
                compact ? "px-2 py-0.5" : "px-2.5 py-1",
                colors.bg,
                colors.border
            )}
        >
            <span
                className={cn(
                    "rounded-full flex-shrink-0",
                    compact ? "w-1.5 h-1.5" : "w-2 h-2",
                    colors.dot
                )}
            />
            <span
                className={cn(
                    "font-medium whitespace-nowrap",
                    compact ? "text-[10px]" : "text-xs",
                    colors.text
                )}
            >
                {displayName}
            </span>
            <span
                className={cn(
                    "font-bold tabular-nums",
                    compact ? "text-[10px]" : "text-xs",
                    colors.text
                )}
            >
                {count}
            </span>
        </div>
    );
};

// Compact summary for mobile collapsed state
interface CompactStateSummaryProps {
    stateCounts: Record<string, number>;
}

const CompactStateSummary: React.FC<CompactStateSummaryProps> = ({ stateCounts }) => {
    const sortedStates = Object.entries(stateCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);

    return (
        <div className="flex items-center gap-2">
            {sortedStates.map(([name, count]) => {
                const colors = getStateColors(name);
                return (
                    <div key={name} className="flex items-center gap-1">
                        <span className={cn("w-2 h-2 rounded-full", colors.dot)} />
                        <span className="text-xs text-muted-foreground tabular-nums">
                            {count}
                        </span>
                    </div>
                );
            })}
            {Object.keys(stateCounts).length > 4 && (
                <span className="text-xs text-muted-foreground">...</span>
            )}
        </div>
    );
};

// Quick stat badge component
interface QuickStatProps {
    icon: React.ReactNode;
    value: number;
    label: string;
}

const QuickStat: React.FC<QuickStatProps> = ({ icon, value, label }) => (
    <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-xs">
            <span className="font-semibold text-foreground tabular-nums">{value}</span> {label}
        </span>
    </div>
);

export const CustomersSummaryCard: React.FC = () => {
    const [stats, setStats] = useState<{
        total: number;
        by_state: Record<string, number>;
        with_projects: number;
        without_projects: number;
        recent_30_days: number;
    } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

    // Fetch total count
    const { data: totalCountData, isLoading: totalCountLoading } = useFrappeGetDocCount(
        CUSTOMER_DOCTYPE,
        undefined,
        false,
        `${CUSTOMER_DOCTYPE}_total_summary`
    );

    // Fetch customer stats
    const { call: getCustomerStats } = useFrappePostCall(
        "nirmaan_stack.api.customers.customer_stats.get_customer_stats"
    );

    useEffect(() => {
        const fetchStats = async () => {
            try {
                setIsLoading(true);
                const result = await getCustomerStats({});
                setStats(result.message);
                setError(null);
            } catch (err) {
                console.error("Failed to fetch customer stats:", err);
                setError("Failed to load statistics");
                setStats(null);
            } finally {
                setIsLoading(false);
            }
        };

        fetchStats();
    }, []);

    if (error) {
        return (
            <Card className="my-2 border-red-200 bg-red-50">
                <CardContent className="py-3">
                    <p className="text-sm text-red-600">{error}</p>
                </CardContent>
            </Card>
        );
    }

    // Sort states by count for display
    const sortedStates = stats?.by_state
        ? Object.entries(stats.by_state)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
        : [];

    return (
        <Card className="my-2 shadow-sm overflow-hidden">
            <CardContent className="p-0">
                {/* Header - Always visible */}
                <div
                    className="flex items-center justify-between p-3 md:p-4 cursor-pointer md:cursor-default"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                            <Building2 className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-baseline gap-1.5">
                                {totalCountLoading ? (
                                    <TailSpin
                                        visible={true}
                                        height="18"
                                        width="18"
                                        color="#D03B45"
                                        radius="1"
                                    />
                                ) : (
                                    <span className="text-lg md:text-xl font-semibold tabular-nums">
                                        {totalCountData ?? 0}
                                    </span>
                                )}
                                <span className="text-sm text-muted-foreground font-normal">
                                    Customers
                                </span>
                            </div>
                            {/* Mobile: Show compact state summary when collapsed */}
                            <div className="md:hidden">
                                {!isLoading && !isExpanded && stats?.by_state && (
                                    <CompactStateSummary stateCounts={stats.by_state} />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Quick stats - visible on desktop */}
                    <div className="hidden md:flex items-center gap-4">
                        {!isLoading && stats && (
                            <>
                                <QuickStat
                                    icon={<FolderKanban className="h-3.5 w-3.5" />}
                                    value={stats.with_projects}
                                    label="with projects"
                                />
                                <QuickStat
                                    icon={<CalendarPlus className="h-3.5 w-3.5" />}
                                    value={stats.recent_30_days}
                                    label="this month"
                                />
                            </>
                        )}
                    </div>

                    {/* Mobile expand/collapse button */}
                    <button
                        className="md:hidden p-1.5 rounded-md hover:bg-muted/50 transition-colors"
                        aria-label={isExpanded ? "Collapse details" : "Expand details"}
                    >
                        <ChevronDown
                            className={cn(
                                "h-4 w-4 text-muted-foreground transition-transform duration-200",
                                isExpanded && "rotate-180"
                            )}
                        />
                    </button>
                </div>

                {/* State Pills Section - Desktop & Tablet: Always visible */}
                <div className="hidden md:block px-4 pb-4">
                    {isLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                            <TailSpin
                                visible={true}
                                height="16"
                                width="16"
                                color="#6b7280"
                                radius="1"
                            />
                            <span>Loading...</span>
                        </div>
                    ) : sortedStates.length > 0 ? (
                        <div className="lg:flex lg:flex-wrap lg:gap-2 md:flex md:gap-2 md:overflow-x-auto md:pb-1 md:-mb-1 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                            {sortedStates.map(([name, count]) => (
                                <StateCountPill
                                    key={name}
                                    stateName={name}
                                    count={count}
                                />
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">No state data available</p>
                    )}
                </div>

                {/* Mobile: Collapsible section */}
                <div
                    ref={contentRef}
                    className={cn(
                        "md:hidden overflow-hidden transition-all duration-200 ease-in-out",
                        isExpanded ? "max-h-64 opacity-100" : "max-h-0 opacity-0"
                    )}
                >
                    <div className="px-3 pb-3 pt-1 space-y-3">
                        {/* Quick stats for mobile */}
                        {!isLoading && stats && (
                            <div className="flex items-center gap-4 pb-2 border-b border-muted/50">
                                <QuickStat
                                    icon={<FolderKanban className="h-3.5 w-3.5" />}
                                    value={stats.with_projects}
                                    label="with projects"
                                />
                                <QuickStat
                                    icon={<CalendarPlus className="h-3.5 w-3.5" />}
                                    value={stats.recent_30_days}
                                    label="this month"
                                />
                            </div>
                        )}

                        {/* State pills */}
                        {isLoading ? (
                            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
                                <TailSpin
                                    visible={true}
                                    height="14"
                                    width="14"
                                    color="#6b7280"
                                    radius="1"
                                />
                                <span>Loading...</span>
                            </div>
                        ) : sortedStates.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                                {sortedStates.map(([name, count]) => (
                                    <StateCountPill
                                        key={name}
                                        stateName={name}
                                        count={count}
                                        compact
                                    />
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">No state data available</p>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
