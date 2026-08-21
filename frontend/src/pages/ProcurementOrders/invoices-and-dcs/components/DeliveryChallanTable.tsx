import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SITEURL from "@/constants/siteURL";
import { formatDate } from "@/utils/FormatDate";
import { Eye, Pencil, AlertTriangle, ChevronDown, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TailSpin } from "react-loader-spinner";
import { cn } from "@/lib/utils";
import type { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";

interface DeliveryChallanTableProps {
  documents: PODeliveryDocuments[];
  onEdit?: (doc: PODeliveryDocuments) => void;
  /**
   * Delete handler. OPTIONAL and off by default on purpose — this table is also
   * rendered by the DC & MIR hub (`ViewAttachmentsDialog`) and by ITM detail
   * (`ITMAttachmentSection`), and neither should grow a trash icon just because
   * the PO detail page did. A surface opts in by passing both `onDelete` and
   * `canDelete`.
   */
  onDelete?: (doc: PODeliveryDocuments) => void;
  /** Per-row permission test. No trash icon renders unless this returns true. */
  canDelete?: (doc: PODeliveryDocuments) => boolean;
  /** `name` of the row currently being deleted — disables just that row, not all. */
  deletingName?: string | null;
}

export const DeliveryChallanTable: React.FC<DeliveryChallanTableProps> = ({
  documents,
  onEdit,
  onDelete,
  canDelete,
  deletingName,
}) => {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  return (
    <Table>
      <TableHeader className="bg-red-100">
        <TableRow>
          <TableHead className="w-[80px] text-black font-bold">S.No.</TableHead>
          <TableHead className="text-black font-bold">Type</TableHead>
          <TableHead className="text-black font-bold">Ref No.</TableHead>
          <TableHead className="w-[120px] text-black font-bold">Date</TableHead>
          <TableHead className="w-[100px] text-center text-black font-bold">Items</TableHead>
          <TableHead className="w-[120px] text-center text-black font-bold">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.length > 0 ? (
          documents.map((doc, index) => (
            <React.Fragment key={doc.name}>
              <TableRow>
                <TableCell className="text-center">{index + 1}</TableCell>
                <TableCell className="font-medium">
                  {doc.type}
                  {doc.is_signed_by_client === 1 && (
                    <Badge
                      variant="outline"
                      className="ml-2 text-xs text-green-700 border-green-300"
                    >
                      Signed
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{doc.reference_number || "-"}</TableCell>
                <TableCell>
                  {doc.dc_date ? formatDate(doc.dc_date) : formatDate(doc.creation)}
                </TableCell>
                <TableCell className="text-center">
                  {doc.is_stub === 1 ? (
                    <Badge
                      variant="outline"
                      className="text-xs text-amber-700 border-amber-300 bg-amber-50"
                    >
                      <AlertTriangle className="h-3 w-3 mr-1" aria-hidden="true" />
                      N/A
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="text-xs cursor-pointer hover:bg-secondary/80"
                      onClick={() => setExpandedRow(prev => prev === doc.name ? null : doc.name)}
                    >
                      {doc.items?.length || 0} item{(doc.items?.length || 0) !== 1 ? "s" : ""}
                      <ChevronDown className={cn("h-3 w-3 ml-1 transition-transform", expandedRow === doc.name && "rotate-180")} />
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex gap-1 justify-center">
                    {doc.attachment_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-blue-600 hover:text-blue-800"
                        asChild
                        aria-label={`View ${doc.type} file`}
                      >
                        <a
                          href={`${SITEURL}${doc.attachment_url}`}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          <Eye className="h-4 w-4 mr-1" aria-hidden="true" />
                          View
                        </a>
                      </Button>
                    )}
                    {onEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className={doc.is_stub === 1 ? "text-amber-700 hover:text-amber-900" : "text-primary hover:text-primary/80"}
                        onClick={() => onEdit(doc)}
                        title={`${doc.is_stub === 1 ? "Update" : "Edit"} ${doc.type}`}
                        aria-label={`${doc.is_stub === 1 ? "Update" : "Edit"} ${doc.type}`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                    {onDelete && canDelete?.(doc) && (
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-600 hover:text-red-800"
                            disabled={deletingName === doc.name}
                            title={`Delete ${doc.type}`}
                            aria-label={`Delete ${doc.type}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete this {doc.type}?</DialogTitle>
                          </DialogHeader>
                          <DialogDescription asChild>
                            <div className="space-y-2 text-sm">
                              <p className="text-primary">
                                {doc.type}
                                {doc.reference_number ? ` (Ref ${doc.reference_number})` : ""}{" "}
                                and its uploaded file will be permanently removed. This
                                cannot be undone.
                              </p>
                              {doc.is_signed_by_client === 1 && (
                                <p className="text-amber-700">
                                  This document is signed by the client
                                  {doc.client_representative_name
                                    ? ` (${doc.client_representative_name})`
                                    : ""}
                                  . Deleting it removes that delivery proof.
                                </p>
                              )}
                              {doc.is_stub === 1 && (
                                <p className="text-muted-foreground">
                                  This is a legacy record with no itemised quantities.
                                </p>
                              )}
                            </div>
                          </DialogDescription>
                          <div className="flex items-center justify-end gap-2">
                            {deletingName === doc.name ? (
                              <TailSpin color="red" height={30} width={30} />
                            ) : (
                              <>
                                <DialogClose asChild>
                                  <Button
                                    variant="outline"
                                    className="border-primary text-primary"
                                  >
                                    Cancel
                                  </Button>
                                </DialogClose>
                                <Button onClick={() => onDelete(doc)}>Confirm</Button>
                              </>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>
                </TableCell>
              </TableRow>
              {expandedRow === doc.name && doc.items && doc.items.length > 0 && (() => {
                const allQtyZero = doc.items.every((item) => !item.quantity);
                return (
                <TableRow>
                  <TableCell colSpan={6} className="p-0">
                    <div className="bg-muted/30 p-3">
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
                              <td className="p-2 text-muted-foreground">{item.category || "-"}</td>
                              {!allQtyZero && (
                                <>
                                  <td className="p-2 text-right font-medium">{item.quantity}</td>
                                  <td className="p-2 text-muted-foreground">{item.unit}</td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })()}
            </React.Fragment>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={6} className="text-center py-4 text-gray-500">
              No Delivery Challans or MIRs Found
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
};
