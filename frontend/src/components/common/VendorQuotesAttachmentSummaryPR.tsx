import React, { useMemo } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, FileText } from "lucide-react";
import SITEURL from "@/constants/siteURL";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";

interface VendorQuotesAttachmentSummaryPRProps {
  docId: string;
  selectedVendorIds?: string[];
  className?: string;
}

export const VendorQuotesAttachmentSummaryPR: React.FC<VendorQuotesAttachmentSummaryPRProps> = ({
  docId,
  selectedVendorIds = [],
  className,
}) => {
  // 1. Fetch all vendor quote attachments for this specific document
  const { data: attachments, isLoading: attachmentsLoading } = useFrappeGetDocList<NirmaanAttachment>(
    "Nirmaan Attachments",
    {
      fields: ["name", "attachment", "attachment_link_docname", "attachment_type"],
      filters: [
        ["associated_docname", "=", docId],
        ["attachment_type", "=", "Vendor Quote"],
      ],
      limit: 0,
    },
    `vendor_quotes_summary_attachments_${docId}`
  );

  // 2. Extract unique vendor IDs to fetch their names
  const vendorIds = useMemo(() => {
    return Array.from(new Set(attachments?.map(a => a.attachment_link_docname).filter(Boolean))) as string[];
  }, [attachments]);

  // 3. Fetch vendor names for the IDs found
  const vendorFilters: any = useMemo(() => [
    ["name", "in", vendorIds.length > 0 ? vendorIds : [""]]
  ], [vendorIds]);

  const { data: vendors, isLoading: vendorsLoading } = useFrappeGetDocList(
    "Vendors",
    {
      fields: ["name", "vendor_name"],
      filters: vendorFilters,
      limit: 0,
    },
    vendorIds.length > 0 ? `summary_vendors_${vendorIds.sort().join('_')}` : undefined
  );

  const vendorMap = useMemo(() => {
    const map = new Map<string, string>();
    vendors?.forEach((v: any) => map.set(v.name, v.vendor_name));
    return map;
  }, [vendors]);

  const isLoading = attachmentsLoading || (attachments && attachments.length > 0 && vendorsLoading);

  if (isLoading) {
    return (
      <Card className={className}>
        <div className="p-4 flex items-center justify-center min-h-[100px]">
          <LoadingFallback />
        </div>
      </Card>
    );
  }

  if (!attachmentsLoading && attachments?.length === 0) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3 border-b flex flex-row items-center gap-2">
        <FileText className="h-5 w-5 text-primary" />
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Vendor Quotes Attachments
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 px-0 pb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 px-4 text-left">
          {attachments?.map((attr) => {
            const vendorId = attr.attachment_link_docname;
            const vendorName = vendorMap.get(vendorId || "") || vendorId;
            const attachmentUrl = attr.attachment;
            const isSelected = selectedVendorIds.includes(vendorId || "");

            return (
              <div
                key={attr.name}
                className={`flex items-center justify-between p-3 rounded-lg border shadow-sm transition-all duration-200 group hover:-translate-y-0.5 ${
                  isSelected 
                    ? "bg-emerald-50/40 border-emerald-100 hover:bg-emerald-50 hover:border-emerald-200" 
                    : "bg-rose-50/40 border-rose-100 hover:bg-rose-50 hover:border-rose-200"
                }`}
              >
                <div className="flex flex-col min-w-0 pr-3">
                  <span className={`text-sm font-bold tracking-tight ${isSelected ? "text-emerald-700" : "text-rose-700"}`} title={vendorName || ""}>
                    {vendorName}
                  </span>
                  <span className={`text-[10px] font-black uppercase tracking-wider opacity-60 ${isSelected ? "text-emerald-600" : "text-rose-600"}`}>
                    {isSelected ? "Selected" : "Removed/Skipped"}
                  </span>
                </div>
                <div className="flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-8 flex items-center gap-2 px-3 rounded-md transition-all shadow-sm ${
                      isSelected 
                        ? "text-emerald-700 border-emerald-300 bg-white hover:bg-emerald-50 hover:border-emerald-400" 
                        : "text-rose-700 border-rose-300 bg-white hover:bg-rose-50 hover:border-rose-400"
                    }`}
                    onClick={() => window.open(`${SITEURL}${attachmentUrl}`, "_blank")}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span className="text-xs font-bold whitespace-nowrap">View Quote</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
