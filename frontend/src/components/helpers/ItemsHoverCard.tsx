import React, { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatToIndianRupee from "@/utils/FormatPrice";
import { BookOpen, Loader2, X } from "lucide-react"; // Added Loader2 and X
import { useFrappeGetDoc, FrappeDoc } from "frappe-react-sdk"; // Import useFrappeGetDoc
import { Button } from "@/components/ui/button";


interface ItemsHoverCardProps {
  parentDoc: FrappeDoc<any>;          // e.g., PR-00001
  parentDoctype: string;        // e.g., "Procurement Requests"
  childTableName: string;       // e.g., "order_list" or "procurement_list"
  isSR?: boolean
  isPR?: boolean
  isSB?: boolean
}
/** 
 * This component is used to display order details of a PR or a PO or a SB or a SR in hover card
 */

// Define a generic type for the parent document to access the child table
type ParentWithChildTable<T = any> = FrappeDoc<any> & {
  [key: string]: T[] | undefined; // The child table will be an array
};

export const ItemsHoverCard: React.FC<ItemsHoverCardProps> = ({
  parentDocId,
  parentDoctype,
  childTableName,
  isSR = false,
  isPR = false, // Keep these if they affect column rendering/data access
  isSB = false,
}) => {

  const [isOpen, setIsOpen] = useState(false);

  // Fetch the parent document when the card is open
  const { data: parentDocData, isLoading, error, mutate } = useFrappeGetDoc(
    parentDoctype,
    parentDocId?.name,
    // SWR key - make it unique per document
    isOpen ? `${parentDoctype}-${parentDocId?.name}` : null,
    {
      revalidateOnFocus: false, // Optional: prevent re-fetching on window focus
      revalidateOnReconnect: false,
    }
  );

  // console.log(parentDoctype, parentDocId?.name,parentDocData)
  // Extract the child table items once the parent data is loaded
  // Only use parentDocData if it matches the current parentDocId to prevent stale data
  let itemsToDisplay: any;
  const isCorrectData = parentDocData?.name === parentDocId?.name;

  if (parentDoctype === "Service Requests") {
    // console.log(parentDocData)
    itemsToDisplay = Array.isArray(parentDocId?.service_order_list?.list)
      ? parentDocId[childTableName].list // If true, use the dynamic childTableName
      : []; // If false, default to an empty array

    // console.log(itemsToDisplay)
  } else {
    itemsToDisplay = isCorrectData ? parentDocData?.[childTableName] : undefined;
  }



  // Close popover and reset when parentDocId changes
  useEffect(() => {
    setIsOpen(false);
  }, [parentDocId?.name]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
  };

  const handleClick = () => {
    setIsOpen(!isOpen);
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          aria-label="View items"
          className="p-1 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 cursor-pointer"
          onClick={handleClick}
          tabIndex={0}
          type="button"
        >
          <BookOpen className="w-4 h-4 text-blue-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[550px] max-h-[60vh] overflow-auto p-0 relative">
        {/* Close Button */}
        <div className="sticky top-0 bg-white z-20 flex justify-between items-center px-3 py-2 border-b">
          <h4 className="font-semibold text-sm">Order Items</h4>
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
            <span className="ml-2">Loading items...</span>
          </div>
        )}
        {error && (
          <div className="text-red-500 p-4">
            Error loading items: {error.message || "Unknown error"}
          </div>
        )}
        {!isLoading && !error && (!itemsToDisplay || itemsToDisplay.length === 0) && (
          <div className="text-gray-500 p-4 text-center">No items to display.</div>
        )}
        {!isLoading && !error && itemsToDisplay && itemsToDisplay.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-gray-100">
                <TableRow>
                  <TableHead className="min-w-[180px]">{isSR ? "Category" : "Item"}</TableHead>
                  {isSR && <TableHead className="min-w-[120px]">Description</TableHead>}
                  <TableHead className="w-[70px]">Unit</TableHead>
                  <TableHead className="w-[60px]">Qty</TableHead>
                  <TableHead className="w-[80px]">Rate</TableHead>
                  {/* Add Make column back if needed, data should be in fetched child items */}
                  {(!isSR && (isPR || isSB)) && <TableHead className="min-w-[100px]">Make</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemsToDisplay?.map((item: any) => (
                  <TableRow key={item?.name || item?.id}> {/* Child table rows have a 'name' */}
                    <TableCell className="font-medium text-sm">{isSR ? item.category : item.item_name}</TableCell>
                    {isSR && <TableCell className="text-sm max-w-[120px] break-words">{item.description}</TableCell>}
                    <TableCell className="text-sm">{isSR ? item.uom : item.unit}</TableCell>
                    <TableCell className="text-sm text-center">{item.quantity}</TableCell>
                    <TableCell className="text-sm">{formatToIndianRupee(isSR ? item?.rate : item?.quote)}</TableCell>
                    {(!isSR && (isPR || isSB)) && (
                      <TableCell className="text-sm">{item?.make || "--"}</TableCell>
                    )}
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