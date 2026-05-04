import { Link } from "react-router-dom";
import { formatDate } from "@/utils/FormatDate";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Upload, Eye } from "lucide-react";

import type { EnrichedITM } from "./ITMListTable";

interface AttachmentCount {
  dc: number;
  mir: number;
  total: number;
}

interface ITMListCardsProps {
  itms: EnrichedITM[];
  isLoading: boolean;
  selectedCategories: string[];
  getAttachmentCount: (itmName: string) => AttachmentCount;
  onUpload: (itmName: string, type: "DC" | "MIR") => void;
  onViewAttachments: (itmName: string) => void;
}

export const ITMListCards = ({
  itms,
  isLoading,
  selectedCategories,
  getAttachmentCount,
  onUpload,
  onViewAttachments,
}: ITMListCardsProps) => {
  const getLatestDeliveryDate = (itm: EnrichedITM): string => {
    const date = itm.latest_delivery_date || itm.dispatch_date;
    return date ? formatDate(date) : "N/A";
  };

  return (
    <div className="md:hidden space-y-4">
      {isLoading && (
        <p className="text-center py-8" role="status">
          Loading...
        </p>
      )}
      {!isLoading && itms.length > 0
        ? itms.map((itm) => {
            const attachmentCount = getAttachmentCount(itm.name);
            return (
              <Card key={itm.name} className="border-l-4 border-l-purple-500">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <Link
                        to={`/internal-transfer-memos/${itm.name}`}
                        className="font-bold text-blue-600 text-lg underline hover:text-blue-800"
                      >
                        {itm.name}
                      </Link>
                    </div>
                    <Badge variant="outline">{itm.status}</Badge>
                  </div>

                  <div className="space-y-2 text-sm mb-4">
                    <div className="flex items-start">
                      <span className="text-gray-500 min-w-[120px] font-medium">
                        Delivery Date:
                      </span>
                      <span className="text-gray-900">
                        {getLatestDeliveryDate(itm)}
                      </span>
                    </div>
                    <div className="flex items-start">
                      <span className="text-gray-500 min-w-[120px] font-medium">
                        Categories:
                      </span>
                      <div className="flex-1 flex flex-wrap gap-1">
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
                        onClick={() => onUpload(itm.name, "DC")}
                        className="flex-1 flex items-center justify-center gap-2"
                        aria-label={`Upload Delivery Challan for ${itm.name}`}
                      >
                        <FileText className="h-4 w-4" aria-hidden="true" />
                        Upload DC
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onUpload(itm.name, "MIR")}
                        className="flex-1 flex items-center justify-center gap-2"
                        aria-label={`Upload MIR for ${itm.name}`}
                      >
                        <Upload className="h-4 w-4" aria-hidden="true" />
                        Upload MIR
                      </Button>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onViewAttachments(itm.name)}
                      className="w-full flex items-center justify-center gap-2 relative"
                      aria-label={`View attachments for ${itm.name}`}
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
                ? "No Transfer Memos found matching the selected categories."
                : "No eligible Transfer Memos found for this project."}
            </div>
          )}
    </div>
  );
};
