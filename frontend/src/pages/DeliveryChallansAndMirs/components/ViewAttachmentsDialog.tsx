import { useMemo } from "react";
import { formatDate } from "@/utils/FormatDate";
import SITEURL from "@/constants/siteURL";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Eye, FileText, Upload, AlertTriangle, Pencil } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Separator } from "@/components/ui/separator";

import type { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";

interface ViewAttachmentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poName: string;
  poDisplayName: string;
  documents: PODeliveryDocuments[] | null;
  isLoading: boolean;
  onEdit?: (doc: PODeliveryDocuments) => void;
}

export const ViewAttachmentsDialog = ({
  open,
  onOpenChange,
  poName: _poName,
  poDisplayName,
  documents,
  isLoading,
  onEdit,
}: ViewAttachmentsDialogProps) => {
  void _poName; // kept for future use
  const grouped = useMemo(() => {
    if (!documents) return { dc: [], mir: [] };
    const dc = documents.filter((d) => d.type === "Delivery Challan");
    const mir = documents.filter((d) => d.type === "Material Inspection Report");
    return { dc, mir };
  }, [documents]);

  const truncateFileName = (name: string, max = 25) => {
    if (name.length <= max) return name;
    const dotIdx = name.lastIndexOf(".");
    const ext = dotIdx !== -1 ? name.slice(dotIdx) : "";
    const availLen = max - ext.length - 3; // 3 for "..."
    return availLen > 0
      ? `${name.slice(0, availLen)}...${ext}`
      : `${name.slice(0, max - 3)}...`;
  };

  const renderDocCard = (doc: PODeliveryDocuments, borderColor: string) => {
    const fileName = doc.attachment_url?.split("/").pop() || "file";
    const slicedName = truncateFileName(fileName);

    return (
      <Card key={doc.name} className={`border-l-4 ${borderColor}`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0 space-y-1">
              {doc.attachment_url && (
                <p className="text-sm font-medium" title={fileName}>
                  {slicedName}
                </p>
              )}
              {doc.reference_number && (
                <p className="text-xs text-muted-foreground">
                  Ref: {doc.reference_number}
                </p>
              )}
              {doc.type === "Material Inspection Report" && doc.dc_reference && (
                <p className="text-xs text-muted-foreground">
                  Associated DC: {doc.dc_reference}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Date: {doc.dc_date ? formatDate(doc.dc_date) : formatDate(doc.creation)}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {doc.items && doc.items.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {doc.items.length} item{doc.items.length !== 1 ? "s" : ""}
                  </Badge>
                )}
                {doc.is_signed_by_client === 1 && (
                  <Badge variant="outline" className="text-xs text-green-700 border-green-300">
                    Signed by {doc.client_representative_name || "client"}
                  </Badge>
                )}
                {doc.is_stub === 1 && (
                  <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 bg-amber-50">
                    <AlertTriangle className="h-3 w-3 mr-1" aria-hidden="true" />
                    Items not recorded
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {doc.attachment_url && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`${SITEURL}${doc.attachment_url}`, "_blank")}
                  className="flex items-center gap-1"
                  aria-label={`View ${doc.type} file`}
                >
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  View
                </Button>
              )}
              {onEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(doc)}
                  className={`flex items-center gap-1 ${
                    doc.is_stub === 1
                      ? "text-amber-700 border-amber-300 hover:bg-amber-50"
                      : "text-primary border-primary hover:bg-primary/5"
                  }`}
                  aria-label={`${doc.is_stub === 1 ? "Update" : "Edit"} ${doc.type}`}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  {doc.is_stub === 1 ? "Update" : "Edit"}
                </Button>
              )}
            </div>
          </div>

          {/* Expandable items list */}
          {doc.items && doc.items.length > 0 && (() => {
            const allQtyZero = doc.items.every((item) => !item.quantity);
            return (
            <Accordion type="single" collapsible className="mt-2">
              <AccordionItem value="items" className="border-0">
                <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
                  View items ({doc.items.length})
                </AccordionTrigger>
                <AccordionContent>
                  <div className="border rounded-md overflow-hidden mt-1">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2 font-medium">Item</th>
                          <th className="text-left p-2 font-medium">Category</th>
                          {!allQtyZero && (
                            <>
                              <th className="text-right p-2 font-medium">Qty</th>
                              <th className="text-left p-2 font-medium">Unit</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {doc.items.map((item, idx) => (
                          <tr key={item.name || idx} className="border-t">
                            <td className="p-2">{item.item_name}</td>
                            <td className="p-2 text-muted-foreground">
                              {item.category || "-"}
                            </td>
                            {!allQtyZero && (
                              <>
                                <td className="p-2 text-right font-medium">
                                  {item.quantity}
                                </td>
                                <td className="p-2 text-muted-foreground">
                                  {item.unit}
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            );
          })()}
        </CardContent>
      </Card>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto overscroll-y-contain">
        <DialogHeader>
          <DialogTitle>Attachments for {poDisplayName}</DialogTitle>
          <DialogDescription>
            View all uploaded Delivery Challans and MIRs
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-6">
          {isLoading ? (
            <div className="flex justify-center py-8" role="status">
              <TailSpin color="#3b82f6" width={40} height={40} />
              <span className="sr-only">Loading attachments...</span>
            </div>
          ) : (
            <>
              {/* Delivery Challans */}
              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-blue-600" aria-hidden="true" />
                  Delivery Challans ({grouped.dc.length})
                </h3>
                {grouped.dc.length > 0 ? (
                  <div className="space-y-2">
                    {grouped.dc.map((doc) =>
                      renderDocCard(doc, "border-l-blue-500")
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic py-4 text-center border rounded-lg">
                    No Delivery Challans uploaded yet
                  </p>
                )}
              </div>

              <Separator />

              {/* Material Inspection Reports */}
              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Upload className="h-5 w-5 text-green-600" aria-hidden="true" />
                  Material Inspection Reports ({grouped.mir.length})
                </h3>
                {grouped.mir.length > 0 ? (
                  <div className="space-y-2">
                    {grouped.mir.map((doc) =>
                      renderDocCard(doc, "border-l-green-500")
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic py-4 text-center border rounded-lg">
                    No Material Inspection Reports uploaded yet
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
