import { Link } from "react-router-dom";
import { formatDate } from "@/utils/FormatDate";
import { encodeFrappeId } from "@/pages/DeliveryNotes/constants";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Upload, Eye } from "lucide-react";

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

interface POListCardsProps {
  pos: EnrichedPO[];
  isLoading: boolean;
  selectedCategories: string[];
  getAttachmentCount: (poName: string) => AttachmentCount;
  onUpload: (poName: string, type: "DC" | "MIR") => void;
  onViewAttachments: (poName: string) => void;
}

export const POListCards = ({
  pos,
  isLoading,
  selectedCategories,
  getAttachmentCount,
  onUpload,
  onViewAttachments,
}: POListCardsProps) => {
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
    <div className="md:hidden space-y-4">
      {isLoading && (
        <p className="text-center py-8" role="status">
          Loading...
        </p>
      )}
      {!isLoading && pos.length > 0
        ? pos.map((po) => {
            const attachmentCount = getAttachmentCount(po.name);
            const poLink = getPOLink(po);
            return (
              <Card key={po.name} className="border-l-4 border-l-blue-500">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      {poLink ? (
                        <Link
                          to={poLink}
                          className="font-bold text-blue-600 text-lg underline hover:text-blue-800"
                        >
                          {`PO-${po.name.split("/")[1]}`}
                        </Link>
                      ) : (
                        <span className="font-bold text-lg">
                          {`PO-${po.name.split("/")[1]}`}
                        </span>
                      )}
                    </div>
                    <Badge variant="outline">{po.status}</Badge>
                  </div>

                  <div className="space-y-2 text-sm mb-4">
                    <div className="flex items-start">
                      <span className="text-gray-500 min-w-[120px] font-medium">
                        Vendor:
                      </span>
                      <span className="text-gray-900 flex-1">
                        {po.vendor_name || "N/A"}
                      </span>
                    </div>
                    <div className="flex items-start">
                      <span className="text-gray-500 min-w-[120px] font-medium">
                        Delivery Date:
                      </span>
                      <span className="text-gray-900">
                        {getLatestDeliveryDate(po)}
                      </span>
                    </div>
                    <div className="flex items-start">
                      <span className="text-gray-500 min-w-[120px] font-medium">
                        Categories:
                      </span>
                      <div className="flex-1 flex flex-wrap gap-1">
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
                          <span className="text-muted-foreground text-xs">
                            No categories
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 pt-2 border-t">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onUpload(po.name, "DC")}
                        className="flex-1 flex items-center justify-center gap-2"
                        aria-label={`Upload Delivery Challan for PO-${po.name.split("/")[1]}`}
                      >
                        <FileText className="h-4 w-4" aria-hidden="true" />
                        Upload DC
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onUpload(po.name, "MIR")}
                        className="flex-1 flex items-center justify-center gap-2"
                        aria-label={`Upload MIR for PO-${po.name.split("/")[1]}`}
                      >
                        <Upload className="h-4 w-4" aria-hidden="true" />
                        Upload MIR
                      </Button>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onViewAttachments(po.name)}
                      className="w-full flex items-center justify-center gap-2 relative"
                      aria-label={`View attachments for PO-${po.name.split("/")[1]}`}
                    >
                      <Eye className="h-4 w-4" aria-hidden="true" />
                      View Attachments
                      {attachmentCount.total > 0 && (
                        <span className="ml-1 bg-blue-600 text-white text-xs rounded-full px-2 py-0.5">
                          {attachmentCount.total}
                        </span>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        : !isLoading && (
            <div className="text-center text-red-500 py-8">
              {selectedCategories.length > 0
                ? "No Purchase Orders found matching the selected categories."
                : "No Purchase Orders found for this project."}
            </div>
          )}
    </div>
  );
};
