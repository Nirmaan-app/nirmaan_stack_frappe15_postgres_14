import React, { useState, useEffect } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatToIndianRupee from "@/utils/FormatPrice";
import { BookOpen, Loader2 } from "lucide-react"; // Added Loader2
import { useFrappeGetDoc, FrappeDoc } from "frappe-react-sdk"; // Import useFrappeGetDoc


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

  const { data: parentDocData, isLoading, error } = useFrappeGetDoc(
    parentDoctype,
    parentDocId?.name,
    // SWR key - make it unique per document
    isOpen ? `${parentDoctype}-${parentDocId}` : null,
    {
      enabled: isOpen, // Only fetch when isOpen is true
      revalidateOnFocus: false, // Optional: prevent re-fetching on window focus
    }
  );

  console.log(parentDoctype, parentDocId?.name,parentDocData)
  // Extract the child table items once the parent data is loaded
let itemsToDisplay:any;
  if(parentDoctype === "Service Requests"){
    console.log(parentDocData)
    itemsToDisplay = Array.isArray(parentDocId?.service_order_list?.list)
  ? parentDocId[childTableName].list // If true, use the dynamic childTableName
  : []; // If false, default to an empty array

    console.log(itemsToDisplay)
  }else{
   itemsToDisplay = parentDocData?.[childTableName];

  }



  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
  };

  return (
    <HoverCard open={isOpen} onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>
        <button aria-label="View items" className="p-1"> {/* Make it a button for accessibility */}
          <BookOpen className="w-4 h-4 text-blue-500" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="p-2 w-80 overflow-auto max-h-[50vh]">
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
          <Table>
            <TableHeader className="bg-gray-200">
              <TableRow>
                <TableHead>{isSR ? "Category" : "Item"}</TableHead>
                {isSR && <TableHead>Description</TableHead>}
                <TableHead>Unit</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Rate</TableHead>
                {/* Add Make column back if needed, data should be in fetched child items */}
                {(!isSR && (isPR || isSB)) && <TableHead>Make</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemsToDisplay?.map((item: any) => (
                <TableRow key={item?.name || item?.id}> {/* Child table rows have a 'name' */}
                  <TableCell>{isSR ? item.category : item.item_name}</TableCell>
                  {isSR && <TableCell className="truncate max-w-[100px]">{item.description}</TableCell>}
                  <TableCell>{isSR ? item.uom : item.unit}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{formatToIndianRupee(isSR ? item?.rate : item.quote)}</TableCell>
                  {(!isSR && (isPR || isSB)) && (
                    <TableCell>{item?.make || "--"}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </HoverCardContent>
    </HoverCard>
  );
};