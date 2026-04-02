import React, { useState, useEffect } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BookOpen, Loader2, X, Tags } from "lucide-react";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";

interface HeaderHoverCardProps {
  prName: string;
}

export const HeaderHoverCard: React.FC<HeaderHoverCardProps> = ({
  prName,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const {
    data: prDoc,
    isLoading,
    error,
  } = useFrappeGetDoc<ProcurementRequest>(
    "Procurement Requests",
    prName,
    isOpen ? `HeaderHoverCard-${prName}` : null,
    {
      revalidateOnFocus: false,
    }
  );

  const tags = prDoc?.pr_tag_list || [];

  useEffect(() => {
    setIsOpen(false);
  }, [prName]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          aria-label="View PR Tags"
          className="p-1 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 cursor-pointer inline-flex"
          onClick={handleClick}
          tabIndex={0}
          type="button"
        >
          <BookOpen className="w-3.5 h-3.5 text-blue-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] max-h-[60vh] overflow-auto p-0 relative" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white z-20 flex justify-between items-center px-3 py-2 border-b">
          <div className="flex items-center gap-2">
            <Tags className="w-4 h-4 text-muted-foreground" />
            <h4 className="font-semibold text-sm">PR Tag Headers</h4>
          </div>
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
          {isLoading && (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2">Loading tags...</span>
            </div>
          )}
          {error && (
            <div className="text-red-500 p-4">
              Error loading tags: {error.message || "Unknown error"}
            </div>
          )}
          {!isLoading && !error && tags.length === 0 && (
            <div className="text-gray-500 p-4 text-center">
              No tags found for this PR.
            </div>
          )}
          {!isLoading && !error && tags.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-100">
                  <TableRow>
                    <TableHead className="text-xs font-bold uppercase">Tag Header</TableHead>
                    <TableHead className="text-xs font-bold uppercase">Package</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tags.map((tag, idx) => (
                    <TableRow key={tag.name || idx}>
                      <TableCell className="text-sm font-medium">
                        {tag.tag_header}
                      </TableCell>
                      <TableCell className="text-sm">
                        {tag.tag_package}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const WPRTagsBadge: React.FC<{ tags?: { tag_header: string; tag_package: string }[] }> = ({ tags }) => {
  if (!tags || tags.length === 0) return null;

  const uniquePackages = Array.from(new Set(tags.map(t => t.tag_header))).filter(Boolean).sort();

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 pr-2 border-r border-purple-100/50 mr-1">
        <Badge variant="outline" className="flex items-center gap-1 py-0.5 px-1.5 text-[9px] font-bold uppercase tracking-wider bg-white border-purple-200 text-purple-600 shadow-sm">
          <Tags className="h-3 w-3" />
          PR Tags
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {uniquePackages.map((pkg) => (
            <Badge
              key={pkg}
              variant="secondary"
              className="bg-white border-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-[10px] font-medium"
            >
              {pkg}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
};
