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
  dispatched_on?: string;
  latest_delivery_date?: string;
  latest_dn_date?: string;
  approved_by_full_name?: string;
  direction: string;
  counterpart_project_name?: string;
}

const COLUMN_COUNT = 8;

const ProjectTransferMemosTab: React.FC<ProjectTransferMemosTabProps> = ({
  projectId,
}) => {
  const { data: itmData, isLoading, error: fetchError } = useFrappeGetCall<{
    message: { data: ProjectITM[] };
  }>(
    "nirmaan_stack.api.internal_transfers.project_transfers.get_project_itms",
    projectId ? { project_id: projectId } : undefined,
    projectId ? undefined : null
  );

  const itms = itmData?.message?.data ?? [];

  const [directionFilter, setDirectionFilter] = useState<Set<string>>(
    new Set()
  );
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

  const filteredItems = useMemo(() => {
    let items = itms;
    if (directionFilter.size > 0) {
      items = items.filter((itm) => directionFilter.has(itm.direction));
    }
    if (statusFilter.size > 0) {
      items = items.filter((itm) => statusFilter.has(itm.status));
    }
    return items;
  }, [itms, directionFilter, statusFilter]);

  const directionOptions = useMemo(
    () => [
      { label: "Incoming", value: "Incoming" },
      { label: "Outgoing", value: "Outgoing" },
    ],
    []
  );

  const statusOptions = useMemo(() => {
    const unique = new Set(itms.map((itm) => itm.status));
    return Array.from(unique)
      .sort()
      .map((s) => ({ label: s, value: s }));
  }, [itms]);

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <div className="bg-muted/30 px-3 py-3">
          <div className="flex gap-4">
            {Array.from({ length: COLUMN_COUNT }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-24" />
            ))}
          </div>
        </div>
        <div className="p-3 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
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
            <TableHead className="min-w-[160px]">Transfer ID</TableHead>
            <TableHead className="min-w-[140px]">Creation Date</TableHead>
            <TableHead className="min-w-[200px]">Counterpart Project</TableHead>
            <TableHead className="min-w-[150px]">
              <div className="flex items-center gap-1">
                <SimpleFacetedFilter
                  title="Status"
                  options={statusOptions}
                  selectedValues={statusFilter}
                  onSelectedValuesChange={setStatusFilter}
                />
                <span>Status</span>
              </div>
            </TableHead>
            <TableHead className="min-w-[140px]">Dispatched On</TableHead>
            <TableHead className="min-w-[140px]">Latest Delivery</TableHead>
            <TableHead className="min-w-[150px]">Approved By</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredItems.length === 0 ? (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} className="h-24 text-center">
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
                <TableCell className="py-2 px-3 text-sm text-muted-foreground">
                  {formatDate(itm.creation)}
                </TableCell>
                <TableCell className="py-2 px-3 text-sm">
                  {itm.counterpart_project_name ?? "—"}
                </TableCell>
                <TableCell className="py-2 px-3">
                  <ITMStatusBadge status={itm.status} />
                </TableCell>
                <TableCell className="py-2 px-3 text-sm text-muted-foreground">
                  {itm.dispatched_on ? formatDate(itm.dispatched_on) : "—"}
                </TableCell>
                <TableCell className="py-2 px-3 text-sm text-muted-foreground">
                  {(itm.latest_dn_date || itm.latest_delivery_date)
                    ? formatDate(itm.latest_dn_date || itm.latest_delivery_date!)
                    : "—"}
                </TableCell>
                <TableCell className="py-2 px-3 text-sm">
                  {itm.approved_by_full_name ?? "—"}
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
