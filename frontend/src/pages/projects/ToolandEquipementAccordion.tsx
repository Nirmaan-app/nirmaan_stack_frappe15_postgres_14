import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatToIndianRupee from "@/utils/FormatPrice";

interface ToolandEquipementAccordionProps {
  projectEstimates?: any[];
  categorizedData?: {
    [workPackage: string]: {
        [category: string]: any[];
    };
  };
}

export const ToolandEquipementAccordion : React.FC<ToolandEquipementAccordionProps> = ({
  projectEstimates,
  categorizedData,
}) => {
  const selectedData = categorizedData?.["Tool & Equipments"] || null;

  const toolandEquipEstimates = projectEstimates?.filter(
    (p) => p?.work_package === "Tool & Equipments"
  );

  return (
    <div className="w-full">
      {selectedData ? (
        <div className="flex flex-col gap-4">
          <Accordion type="multiple" className="space-y-4">
            {Object.entries(selectedData)
              ?.sort(([a], [b]) => a?.localeCompare(b))
              ?.map(([category, items]) => {
                const totalAmount = items.reduce(
                  (sum, item) => sum + parseFloat(item?.amount),
                  0
                );

                // const categoryEstimates = projectEstimates?.filter((i) => i?.category === category)
                // const totalCategoryEstdAmt = categoryEstimates?.reduce((sum, item) =>
                //   sum + parseFloat(item?.rate_estimate) * parseFloat(item?.quantity_estimate) * (1 + parseFloat(item?.item_tax) / 100),
                // 0
                // )
                return (
                  <AccordionItem
                    key={category}
                    value={category}
                    className="border-b rounded-lg shadow"
                  >
                    <AccordionTrigger className="bg-[#FFD3CC] px-4 py-2 rounded-lg text-blue-900 flex justify-between items-center">
                      <div className="flex space-x-4 text-sm text-gray-600">
                        <span className="font-semibold">{category}:</span>
                        <span>
                          Total Amount: {formatToIndianRupee(totalAmount)}
                        </span>
                        {/* <span>Total Estd Amount: {formatToIndianRupee(totalCategoryEstdAmt)}</span> */}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="overflow-x-auto">
                      <Table className="min-w-full text-left text-sm">
                        <TableHeader>
                          <TableRow className="bg-gray-100 text-gray-700">
                            <TableHead className="px-4 py-2 font-semibold">
                              Item ID
                            </TableHead>
                            <TableHead className="px-4 py-2 font-semibold w-[40%]">
                              Item Name
                            </TableHead>
                            <TableHead className="px-4 py-2 font-semibold">
                              Unit
                            </TableHead>
                            <TableHead className="px-4 py-2 font-semibold">
                              Qty Ordered
                            </TableHead>
                            <TableHead className="px-4 py-2 font-semibold">
                              Estd Qty
                            </TableHead>
                            <TableHead className="px-4 py-2 font-semibold">
                              Amt Spent
                            </TableHead>
                            <TableHead className="px-4 py-2 font-semibold">
                              Estd. Amt
                            </TableHead>
                            <TableHead className="px-4 py-2 font-semibold">
                              Updated Estd. Amt
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items?.map((item) => {
                            const estimateItem = toolandEquipEstimates?.find(
                              (i) => i?.item === item?.item_id
                            );
                            // const quantityDif = item?.quantity - estimateItem?.quantity_estimate
                            // let dynamicQtyClass = null;

                            // if(estimateItem) {
                            //   if(quantityDif > 0) {
                            //     dynamicQtyClass = "text-primary"
                            //   } else if (quantityDif < 0 && Math.abs(quantityDif) < 5) {
                            //     dynamicQtyClass = "text-yellow-600"
                            //   } else if(quantityDif === 0) {
                            //     dynamicQtyClass = "text-green-500"
                            //   } else {
                            //     dynamicQtyClass = "text-blue-500"
                            //   }
                            // }

                            // console.log("estimateItme", estimateItem)

                            const updated_estd_amt =
                              estimateItem?.quantity_estimate > item?.quantity
                                ? estimateItem?.quantity_estimate *
                                item?.averageRate
                                : item.amount;

                            const percentage_change = Math.floor(
                              ((updated_estd_amt -
                                estimateItem?.rate_estimate *
                                estimateItem?.quantity_estimate) /
                                (estimateItem?.rate_estimate *
                                  estimateItem?.quantity_estimate)) *
                              100
                            );

                            return (
                              <TableRow key={item.item_id}>
                                <TableCell className="px-4 py-2">
                                  {item.item_id.slice(5)}
                                </TableCell>
                                <TableCell className="px-4 py-2">
                                  {item.item_name}
                                </TableCell>
                                <TableCell className="px-4 py-2">
                                  {item.unit}
                                </TableCell>
                                <TableCell className={`px-4 py-2`}>
                                  {item.quantity}
                                </TableCell>
                                <TableCell className="px-4 py-2">
                                  {estimateItem?.quantity_estimate || "--"}
                                </TableCell>
                                <TableCell className="px-4 py-2">
                                  {formatToIndianRupee(item.amount)}
                                </TableCell>
                                <TableCell className="px-4 py-2">
                                  {formatToIndianRupee(
                                    estimateItem?.rate_estimate *
                                    estimateItem?.quantity_estimate
                                  )}
                                </TableCell>
                                <TableCell
                                  className={`px-4 py-2 ${estimateItem?.quantity_estimate !==
                                      undefined
                                      ? updated_estd_amt >
                                        estimateItem?.rate_estimate *
                                        estimateItem?.quantity_estimate
                                        ? "text-red-500"
                                        : "text-green-500"
                                      : ""
                                    }`}
                                >
                                  {estimateItem?.quantity_estimate !== undefined
                                    ? formatToIndianRupee(updated_estd_amt)
                                    : "--"}
                                  {estimateItem?.quantity_estimate !==
                                    undefined && ` (${percentage_change}%)`}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
          </Accordion>
        </div>
      ) : (
        <div className="h-[10vh] flex items-center justify-center">
          No Results.
        </div>
      )}
    </div>
  );
};