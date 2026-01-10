import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { TailSpin } from "react-loader-spinner";
import { Badge } from "@/components/ui/badge";
import { ColumnFiltersState } from "@tanstack/react-table";

interface InflowSummaryCardProps {
    aggregates: { sum_of_amount?: number } | null;
    isAggregatesLoading: boolean;
    totalCount: number;
    columnFilters: ColumnFiltersState;
    searchTerm: string;
    projectName?: string;
    customerName?: string;
}

export const InflowSummaryCard: React.FC<InflowSummaryCardProps> = ({
    aggregates,
    isAggregatesLoading,
    totalCount,
    columnFilters,
    searchTerm,
    projectName,
    customerName,
}) => {
    const hasFilters = columnFilters.length > 0 || !!searchTerm || !!projectName || !!customerName;

    const getTitle = () => {
        if (projectName) return `Inflow Summary for ${projectName}`;
        if (customerName) return `Inflow Summary for ${customerName}`;
        return "Inflow Summary";
    };

    return (
        <Card>
            <CardHeader className="p-4 pb-2">
                <CardTitle className="text-lg">{getTitle()}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-2">
                {isAggregatesLoading ? (
                    <div className="flex justify-center items-center h-20">
                        <TailSpin height={24} width={24} color="#4f46e5" />
                    </div>
                ) : aggregates ? (
                    <div className="space-y-4">
                        {/* Metrics Grid */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                                <dt className="text-sm font-medium text-gray-600">Total Inflow</dt>
                                <dd className="text-xl font-bold text-green-600 mt-1">
                                    {formatToRoundedIndianRupee(aggregates.sum_of_amount || 0)}
                                </dd>
                            </div>
                            <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                                <dt className="text-sm font-medium text-gray-600">Total Count</dt>
                                <dd className="text-xl font-bold text-blue-600 mt-1">
                                    {totalCount}
                                </dd>
                            </div>
                        </div>

                        {/* Filter Badges */}
                        {hasFilters && (
                            <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-gray-100">
                                <span className="text-xs font-medium text-gray-500">Filters:</span>
                                {projectName && (
                                    <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                                        Project: {projectName}
                                    </Badge>
                                )}
                                {customerName && (
                                    <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                                        Customer: {customerName}
                                    </Badge>
                                )}
                                {searchTerm && (
                                    <Badge variant="outline" className="text-xs bg-gray-100 text-gray-700 border-gray-300">
                                        Search: "{searchTerm}"
                                    </Badge>
                                )}
                                {columnFilters.map(filter => (
                                    <Badge
                                        key={filter.id}
                                        variant="outline"
                                        className="text-xs bg-blue-50 text-blue-700 border-blue-200 capitalize"
                                    >
                                        {filter.id.replace(/_/g, ' ')}
                                    </Badge>
                                ))}
                            </div>
                        )}

                        {!hasFilters && (
                            <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">
                                Overview of all inflow payments.
                            </p>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-center text-muted-foreground h-20 flex items-center justify-center">
                        No summary data available.
                    </p>
                )}
            </CardContent>
        </Card>
    );
};

export default InflowSummaryCard;
