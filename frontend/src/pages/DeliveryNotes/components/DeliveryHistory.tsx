import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { DeliveryDataType } from '@/types/NirmaanStack/ProcurementOrders';
import { formatDate } from "date-fns";
import { useFrappeGetDocList } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { ChevronDown, ChevronUp } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';

const TRANSITION_DURATION = 300;
const MAX_HEIGHT = 1000;

interface DeliveryHistoryTableProps {
  deliveryData: DeliveryDataType;
}

interface ExpandableRowProps {
  index: number;
  date: string;
  data: DeliveryDataType[string];
  isExpanded: boolean;
  onToggle: (date: string) => void;
}

const ExpandableRow: React.FC<ExpandableRowProps> = ({ index, date, data, isExpanded, onToggle }) => {

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      onToggle(date);
    }
  }, [date, onToggle]);

  const {data : usersList} = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
    fields: ["name", "full_name"],
    limit: 1000,
  }, `Nirmaan Users`);

  const getUserName = useMemo(() => memoize((id : string | undefined) => {
    if(id === "Administrator") return "Administrator"
    return usersList?.find((user) => user.name === id)?.full_name || ""
  }, (id : string | undefined) => id), [usersList]);

  return (
    <>
      <TableRow
        role="button"
        tabIndex={0}
        onClick={() => onToggle(date)}
        onKeyDown={handleKeyPress}
        aria-expanded={isExpanded}
        className="cursor-pointer transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <TableCell>
          <div className="flex items-center">
            <span className="font-medium">{formatDate(new Date(date), "dd/MM/yyyy")}</span>
            <button
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} delivery details`}
              className="ml-2 rounded p-1 hover:bg-gray-100"
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </TableCell>
        <TableCell>{data.items.length}</TableCell>
        <TableCell className={`${index === 0 ? "font-bold" : ""}`}>{index === 0 ? "Create" : "Update"}</TableCell>
        <TableCell>{getUserName(data.updated_by)}</TableCell>
      </TableRow>
      <TableRow aria-hidden={!isExpanded}>
        <TableCell colSpan={3} className="p-0">
          <div
            className={`overflow-hidden transition-all duration-${TRANSITION_DURATION} ease-in-out`}
            style={{
              maxHeight: isExpanded ? MAX_HEIGHT : 0,
              transitionProperty: 'max-height',
              transitionDuration: `${TRANSITION_DURATION}ms`,
            }}
          >
            <Table className="bg-gray-50">
              <TableBody>
                {data.items.map((item, index) => (
                  <TableRow key={`${date}-${index}`}>
                    <TableCell className="w-[50%]">
                      {item.item_name && (
                        <span className="ml-6 italic font-semibold text-gray-600">
                          - {item.item_name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="w-[25%]">{item.unit}</TableCell>
                    <TableCell>{item.to}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TableCell>
      </TableRow>
    </>
  );
};


const DeliveryHistoryTable: React.FC<DeliveryHistoryTableProps> = ({ deliveryData }) => {
  const [expandedRows, setExpandedRows] = useState<string[]>([]);

  const handleToggle = useCallback((date: string) => {
    setExpandedRows(prev => prev.includes(date)
      ? prev.filter(d => d !== date)
      : [...prev, date]
    );
  }, []);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-xl font-semibold text-red-600 max-md:text-lg">
          Delivery History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto">
        <Table>
          <TableHeader className="bg-gray-100">
            <TableRow>
              <TableHead className="font-bold w-[50%] min-w-[200px]">Date</TableHead>
              <TableHead className="font-bold w-[25%] min-w-[100px]">No. of Items</TableHead>
              <TableHead className="font-bold w-[25%] min-w-[100px]">Change Type</TableHead>
              <TableHead className="font-bold">Updated By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveryData ? (
              Object.entries(deliveryData).map(([date, data], index) => (
                <ExpandableRow
                  index={index}
                  key={date}
                  date={date}
                  data={data}
                  isExpanded={expandedRows.includes(date)}
                  onToggle={handleToggle}
                />
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center py-4 text-gray-500"
                >
                  No delivery history available
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      </CardContent>
    </Card>
  );
};

export default React.memo(DeliveryHistoryTable);