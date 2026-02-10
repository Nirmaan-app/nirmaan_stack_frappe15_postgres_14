import { useState } from "react";
import { Truck, ClipboardCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/FormatDate";
import SITEURL from "@/constants/siteURL";
import { DeliveryDocumentInfo } from "./ProjectMaterialUsageTab";

interface DeliveryDocumentCountCellProps {
  type: 'dc' | 'mir';
  documents: DeliveryDocumentInfo[];
  count: number;
}

export const DeliveryDocumentCountCell = ({ type, documents, count }: DeliveryDocumentCountCellProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const isDC = type === 'dc';
  const label = isDC ? "Delivery Challans" : "Material Inspection Reports";
  const Icon = isDC ? Truck : ClipboardCheck;
  const borderColor = isDC ? "border-amber-300" : "border-blue-300";
  const textColor = isDC ? "text-amber-600" : "text-blue-600";
  const hoverBg = isDC ? "hover:bg-amber-50" : "hover:bg-blue-50";
  const ringColor = isDC ? "focus:ring-amber-500" : "focus:ring-blue-500";
  const iconColor = isDC ? "text-amber-600" : "text-blue-600";

  if (count === 0) {
    return <Badge variant="outline" className="text-gray-400">0</Badge>;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          className={`inline-flex items-center rounded-full border ${borderColor} px-2.5 py-0.5 text-xs font-semibold ${textColor} ${hoverBg} focus:outline-none focus:ring-2 ${ringColor} focus:ring-offset-1 cursor-pointer`}
        >
          <Icon className="w-3 h-3 mr-1" />
          {count}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] max-h-[60vh] overflow-auto p-0" align="start">
        <div className="sticky top-0 bg-white z-20 flex justify-between items-center px-3 py-2 border-b">
          <h4 className="font-semibold text-sm flex items-center gap-1.5">
            <Icon className={`w-4 h-4 ${iconColor}`} />
            {label} ({count})
          </h4>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 rounded-full hover:bg-gray-100"
            onClick={() => setIsOpen(false)}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-2">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="text-xs">Ref No</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs text-center">Signed</TableHead>
                <TableHead className="text-xs text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm text-gray-600 py-2">
                    {doc.referenceNumber || '-'}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 py-2">
                    {doc.dcDate ? formatDate(doc.dcDate) : '-'}
                  </TableCell>
                  <TableCell className="text-center py-2">
                    {doc.isSignedByClient ? (
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 text-xs">Signed</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right py-2">
                    {doc.attachmentUrl ? (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-blue-500 hover:text-blue-700"
                        onClick={() => window.open(`${SITEURL}${doc.attachmentUrl}`, "_blank")}
                      >
                        View
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PopoverContent>
    </Popover>
  );
};
