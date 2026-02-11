/** @deprecated Use DeliveryDocumentCountCell instead. This component uses old Nirmaan Attachments data. */
import { useState } from "react";
import { Truck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/FormatDate";
import SITEURL from "@/constants/siteURL";

export interface DCHoverItem {
  name: string;
  creation: string;
  attachment: string;
  attachment_ref?: string;
}

interface DCCountCellProps {
  dcs: DCHoverItem[];
  count: number;
}

export const DCCountCell = ({ dcs, count }: DCCountCellProps) => {
  const [isOpen, setIsOpen] = useState(false);

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
          className="inline-flex items-center rounded-full border border-amber-300 px-2.5 py-0.5 text-xs font-semibold text-amber-600 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 cursor-pointer"
        >
          <Truck className="w-3 h-3 mr-1" />
          {count}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[350px] max-h-[60vh] overflow-auto p-0" align="start">
        {/* Sticky Header */}
        <div className="sticky top-0 bg-white z-20 flex justify-between items-center px-3 py-2 border-b">
          <h4 className="font-semibold text-sm flex items-center gap-1.5">
            <Truck className="w-4 h-4 text-amber-600" />
            Delivery Challans ({count})
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
                <TableHead className="text-xs">DC No</TableHead>
                <TableHead className="text-xs">Uploaded On</TableHead>
                <TableHead className="text-xs text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dcs.map((dc, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm text-gray-600 py-2">
                    {dc.attachment_ref || '-'}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 py-2">{formatDate(dc.creation)}</TableCell>
                  <TableCell className="text-right py-2">
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-blue-500 hover:text-blue-700"
                      onClick={() => window.open(`${SITEURL}${dc.attachment}`, "_blank")}
                    >
                      View
                    </Button>
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
