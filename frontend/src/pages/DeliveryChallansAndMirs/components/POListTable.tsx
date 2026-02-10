import { Link } from "react-router-dom";
import { formatDate } from "@/utils/FormatDate";
import { encodeFrappeId } from "@/pages/DeliveryNotes/constants";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CirclePlus, Eye } from "lucide-react";

import type { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";

interface EnrichedPO extends ProcurementOrder {
  categories: string[];
  items: any[];
}

interface AttachmentCount {
  dc: number;
  mir: number;
  total: number;
}

interface POListTableProps {
  pos: EnrichedPO[];
  isLoading: boolean;
  selectedCategories: string[];
  getAttachmentCount: (poName: string) => AttachmentCount;
  onUpload: (poName: string, type: "DC" | "MIR") => void;
  onViewAttachments: (poName: string) => void;
}

export const POListTable = ({
  pos,
  isLoading,
  selectedCategories,
  getAttachmentCount,
  onUpload,
  onViewAttachments,
}: POListTableProps) => {
  const getLatestDeliveryDate = (po: ProcurementOrder): string => {
    const date = po.latest_delivery_date || po.dispatch_date;
    return date ? formatDate(date) : "N/A";
  };

  const getPOLink = (po: ProcurementOrder): string | null => {
    if (!po.procurement_request || !po.name) return null;
    const encodedPoId = encodeFrappeId(po.name);
    return `/prs&milestones/procurement-requests/${po.procurement_request}/${encodedPoId}`;
  };

  return (
    <div className="hidden md:block overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[120px]">PO No.</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Categories</TableHead>
            <TableHead>Latest Delivery Date</TableHead>
            <TableHead className="text-center w-[140px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8" role="status">
                <span>Loading...</span>
              </TableCell>
            </TableRow>
          )}
          {!isLoading && pos.length > 0
            ? pos.map((po) => {
                const attachmentCount = getAttachmentCount(po.name);
                const poLink = getPOLink(po);
                return (
                  <TableRow key={po.name}>
                    <TableCell className="font-medium">
                      {poLink ? (
                        <Link
                          to={poLink}
                          className="text-blue-600 underline hover:text-blue-800"
                        >
                          {`PO-${po.name.split("/")[1]}`}
                        </Link>
                      ) : (
                        <span>{`PO-${po.name.split("/")[1]}`}</span>
                      )}
                    </TableCell>
                    <TableCell>{po.vendor_name || "N/A"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {po.categories && po.categories.length > 0 ? (
                          po.categories.map((category) => (
                            <Badge
                              key={category}
                              variant="outline"
                              className="text-xs"
                            >
                              {category}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            No categories
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getLatestDeliveryDate(po)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5 items-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onUpload(po.name, "DC")}
                          className="flex items-center gap-1 w-full justify-center"
                          aria-label={`Upload Delivery Challan for PO-${po.name.split("/")[1]}`}
                        >
                          <CirclePlus className="h-4 w-4" aria-hidden="true" />
                          <span className="hidden lg:inline">Upload</span>
                          <span> DC</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onUpload(po.name, "MIR")}
                          className="flex items-center gap-1 w-full justify-center"
                          aria-label={`Upload MIR for PO-${po.name.split("/")[1]}`}
                        >
                          <CirclePlus className="h-4 w-4" aria-hidden="true" />
                          <span className="hidden lg:inline">Upload</span>
                          <span> MIR</span>
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onViewAttachments(po.name)}
                          className="flex items-center gap-1 relative w-full justify-center"
                          aria-label={`View attachments for PO-${po.name.split("/")[1]}${attachmentCount.total > 0 ? `, ${attachmentCount.total} attachments` : ""}`}
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                          <span className="hidden lg:inline">View</span>
                          {attachmentCount.total > 0 && (
                            <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                              {attachmentCount.total}
                            </span>
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            : !isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-red-500 py-8"
                  >
                    {selectedCategories.length > 0
                      ? "No Purchase Orders found matching the selected categories."
                      : "No Purchase Orders found for this project."}
                  </TableCell>
                </TableRow>
              )}
        </TableBody>
      </Table>
    </div>
  );
};
