import { Link } from "react-router-dom";
import { formatDate } from "@/utils/FormatDate";

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

interface ITMItem {
  item_id: string;
  item_name: string;
  category: string;
  quantity: number;
  received_quantity: number;
  unit: string;
  make: string;
}

export interface EnrichedITM {
  name: string;
  project: string;
  source_project: string;
  target_project: string;
  status: "Partially Delivered" | "Delivered" | string;
  creation: string;
  dispatch_date?: string | null;
  latest_delivery_date?: string | null;
  transfer_request?: string | null;
  requested_by?: string | null;
  categories: string[];
  category_count: number;
  items: ITMItem[];
  item_count: number;
  error?: string;
}

interface AttachmentCount {
  dc: number;
  mir: number;
  total: number;
}

interface ITMListTableProps {
  itms: EnrichedITM[];
  isLoading: boolean;
  selectedCategories: string[];
  getAttachmentCount: (itmName: string) => AttachmentCount;
  onUpload: (itmName: string, type: "DC" | "MIR") => void;
  onViewAttachments: (itmName: string) => void;
}

export const ITMListTable = ({
  itms,
  isLoading,
  selectedCategories,
  getAttachmentCount,
  onUpload,
  onViewAttachments,
}: ITMListTableProps) => {
  const getLatestDeliveryDate = (itm: EnrichedITM): string => {
    const date = itm.latest_delivery_date || itm.dispatch_date;
    return date ? formatDate(date) : "N/A";
  };

  return (
    <div className="hidden md:block overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[350px]">ITM No.</TableHead>
            <TableHead>Categories</TableHead>
            <TableHead>Latest Delivery Date</TableHead>
            <TableHead className="text-center w-[140px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-8" role="status">
                <span>Loading...</span>
              </TableCell>
            </TableRow>
          )}
          {!isLoading && itms.length > 0
            ? itms.map((itm) => {
                const attachmentCount = getAttachmentCount(itm.name);
                return (
                  <TableRow key={itm.name}>
                    <TableCell className="font-medium align-top">
                      <Link
                        to={`/internal-transfer-memos/${itm.name}`}
                        className="text-blue-600 underline hover:text-blue-800"
                      >
                        {itm.name}
                      </Link>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap gap-1">
                        {itm.categories && itm.categories.length > 0 ? (
                          itm.categories.map((category) => (
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
                    <TableCell className="align-top">{getLatestDeliveryDate(itm)}</TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1.5 items-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onUpload(itm.name, "DC")}
                          className="flex items-center gap-1 w-full justify-center"
                          aria-label={`Upload Delivery Challan for ${itm.name}`}
                        >
                          <CirclePlus className="h-4 w-4" aria-hidden="true" />
                          <span className="hidden lg:inline">Upload</span>
                          <span> DC</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onUpload(itm.name, "MIR")}
                          className="flex items-center gap-1 w-full justify-center"
                          aria-label={`Upload MIR for ${itm.name}`}
                        >
                          <CirclePlus className="h-4 w-4" aria-hidden="true" />
                          <span className="hidden lg:inline">Upload</span>
                          <span> MIR</span>
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onViewAttachments(itm.name)}
                          className="flex items-center gap-1 relative w-full justify-center"
                          aria-label={`View attachments for ${itm.name}${attachmentCount.total > 0 ? `, ${attachmentCount.total} attachments` : ""}`}
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
                    colSpan={4}
                    className="text-center text-red-500 py-8"
                  >
                    {selectedCategories.length > 0
                      ? "No Transfer Memos found matching the selected categories."
                      : "No eligible Transfer Memos found for this project."}
                  </TableCell>
                </TableRow>
              )}
        </TableBody>
      </Table>
    </div>
  );
};
