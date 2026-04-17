import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useFrappeGetCall } from "frappe-react-sdk";
import { ArrowDownLeft, ArrowUpRight, PackageOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ITMStatusBadge } from "@/pages/InternalTransferMemos/components/ITMStatusBadge";
import { SimpleFacetedFilter } from "./SimpleFacetedFilter";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

interface ProjectTransferMemosTabProps {
  projectId: string;
}

interface ProjectITM {
  name: string;
  source_project: string;
  target_project: string;
  source_project_name?: string;
  target_project_name?: string;
  status: string;
  total_items: number;
  estimated_value: number;
  creation: string;
}

type Direction = "Incoming" | "Outgoing";

const ProjectTransferMemosTab: React.FC<ProjectTransferMemosTabProps> = ({
  projectId,
}) => {
  const { data: itmData, isLoading, error: fetchError } = useFrappeGetCall<{
    message: ProjectITM[];
  }>(
    "nirmaan_stack.api.internal_transfers.project_transfers.get_project_itms",
    projectId ? { project_id: projectId } : undefined,
    projectId ? undefined : null
  );

  const itms = itmData?.message ?? [];

  const [directionFilter, setDirectionFilter] = useState<Set<string>>(
    new Set()
  );

  const itemsWithDirection = useMemo(() => {
    return itms.map((itm) => ({
      ...itm,
      direction: (itm.target_project === projectId
        ? "Incoming"
        : "Outgoing") as Direction,
      counterpartProject:
        itm.target_project === projectId
          ? itm.source_project_name || itm.source_project
          : itm.target_project_name || itm.target_project,
    }));
  }, [itms, projectId]);

  const filteredItems = useMemo(() => {
    if (directionFilter.size === 0) return itemsWithDirection;
    return itemsWithDirection.filter((itm) =>
      directionFilter.has(itm.direction)
    );
  }, [itemsWithDirection, directionFilter]);

  const directionOptions = useMemo(
    () => [
      { label: "Incoming", value: "Incoming" },
      { label: "Outgoing", value: "Outgoing" },
    ],
    []
  );

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="text-center py-8 text-destructive">
        Failed to load transfer memos.
      </div>
    );
  }

  if (itms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
        <PackageOpen className="h-10 w-10" />
        <p className="text-sm">No transfer memos for this project</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader className="bg-background">
          <TableRow>
            <TableHead className="min-w-[130px]">
              <div className="flex items-center gap-1">
                <SimpleFacetedFilter
                  title="Direction"
                  options={directionOptions}
                  selectedValues={directionFilter}
                  onSelectedValuesChange={setDirectionFilter}
                />
                <span>Direction</span>
              </div>
            </TableHead>
            <TableHead className="min-w-[160px]">ITM ID</TableHead>
            <TableHead className="min-w-[200px]">Counterpart Project</TableHead>
            <TableHead className="min-w-[150px]">Status</TableHead>
            <TableHead className="text-center min-w-[80px]">Items</TableHead>
            <TableHead className="text-right min-w-[140px]">Est. Value</TableHead>
            <TableHead className="min-w-[120px]">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredItems.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center">
                No results found.
              </TableCell>
            </TableRow>
          ) : (
            filteredItems.map((itm) => (
              <TableRow key={itm.name}>
                <TableCell className="py-2 px-3">
                  <Badge
                    variant="outline"
                    className={
                      itm.direction === "Incoming"
                        ? "bg-green-50 text-green-700 border-green-300"
                        : "bg-orange-50 text-orange-700 border-orange-300"
                    }
                  >
                    {itm.direction === "Incoming" ? (
                      <ArrowDownLeft className="h-3 w-3 mr-1" />
                    ) : (
                      <ArrowUpRight className="h-3 w-3 mr-1" />
                    )}
                    {itm.direction}
                  </Badge>
                </TableCell>
                <TableCell className="py-2 px-3">
                  <Link
                    to={`/internal-transfer-memos/${itm.name}`}
                    className="text-blue-600 hover:underline text-sm font-mono"
                  >
                    {itm.name}
                  </Link>
                </TableCell>
                <TableCell className="py-2 px-3 text-sm">
                  {itm.counterpartProject}
                </TableCell>
                <TableCell className="py-2 px-3">
                  <ITMStatusBadge status={itm.status} />
                </TableCell>
                <TableCell className="text-center py-2 px-3 font-mono text-sm">
                  {itm.total_items}
                </TableCell>
                <TableCell className="text-right py-2 px-3 font-mono text-sm">
                  {formatToRoundedIndianRupee(itm.estimated_value)}
                </TableCell>
                <TableCell className="py-2 px-3 text-sm text-muted-foreground">
                  {formatDate(itm.creation)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default ProjectTransferMemosTab;
