import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatToIndianRupee from "@/utils/FormatPrice";
import { BookOpen } from "lucide-react";

interface ItemsHoverCardProps {
  order_list : any
  isSR?: boolean
  isPR?: boolean
  isSB?: boolean
}
/** 
 * This component is used to display order details of a PR or a PO or a SB or a SR in hover card
 */

export const ItemsHoverCard : React.FC<ItemsHoverCardProps> = ({order_list, isSB = false, isSR = false, isPR = false}) => {

      return (
              <HoverCard>
                    <HoverCardTrigger>
                      <BookOpen className="w-4 h-4 text-blue-500" />
                    </HoverCardTrigger>
                    <HoverCardContent className="p-2 w-80 overflow-auto max-h-[50vh]">
                      <Table>
                        <TableHeader className="bg-gray-200">
                          <TableRow>
                            <TableHead>{isSR ? "Category" : "Item"}</TableHead>
                            {isSR && <TableHead>Description</TableHead>}
                            <TableHead>Unit</TableHead>
                            <TableHead>Qty</TableHead>
                            <TableHead>Rate</TableHead>
                            {!isSR && (
                              <TableHead>Make</TableHead>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {order_list?.map((item : any) => (
                            <TableRow key={item?.name || item?.id}>
                              <TableCell>{isSR ? item.category : item.item}</TableCell>
                              {isSR && <TableCell className="truncate max-w-[100px]">{item.description}</TableCell>}
                              <TableCell>{isSR ? item.uom : item.unit}</TableCell>
                              <TableCell>{item.quantity}</TableCell>
                              <TableCell>{formatToIndianRupee(isSR ? item?.rate : item.quote)}</TableCell>
                              {!isSR && (
                                (isPR || isSB) ? (
                                  <TableCell>
                                  {item?.make || "--"}
                                </TableCell>
                                ) : (
                                  <TableCell>
                                  {item.makes?.list?.find((i) => i?.enabled === "true")?.make || "--"}
                                </TableCell>
                                )
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </HoverCardContent>
              </HoverCard>
  )
}