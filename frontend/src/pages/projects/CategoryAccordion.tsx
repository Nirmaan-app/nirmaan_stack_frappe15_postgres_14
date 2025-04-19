import { Badge } from "@/components/ui/badge";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { Table as AntTable, ConfigProvider, TableColumnsType } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";

interface CategoryAccordionProps {
  categorizedData?: {
    [workPackage: string]: {
        [category: string]: any[];
    };
  };
  selectedPackage?: string;
  projectEstimates?: any[];
  po_data?: ProcurementOrder[];
}

const getExpandedRowKeysStorageKey = () => `expandedRowKeys_${window.location.href}`;
const getExpandedPORowKeysStorageKey = () => `expandedPORowKeys_${window.location.href}`;

export const CategoryAccordion : React.FC<CategoryAccordionProps> = ({
  categorizedData,
  selectedPackage,
  projectEstimates,
  po_data,
}) => {

  const selectedData = useMemo(() => categorizedData?.[selectedPackage || ""], [categorizedData, selectedPackage])

  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>(() => {
    const storedKeys = localStorage.getItem(getExpandedRowKeysStorageKey());
    return storedKeys ? JSON.parse(storedKeys) : [];
  });

  const [expandedPORowKyes, setExpandedPORowKeys] = useState<string[]>(() => {
    const storedKeys = localStorage.getItem(getExpandedPORowKeysStorageKey());
    return storedKeys ? JSON.parse(storedKeys) : [];
  });

  useEffect(() => {
    localStorage.setItem(getExpandedRowKeysStorageKey(), JSON.stringify(expandedRowKeys));
    // return () => localStorage.removeItem(getExpandedRowKeysStorageKey());
  }, [expandedRowKeys]);

  useEffect(() => {
    localStorage.setItem(getExpandedPORowKeysStorageKey(), JSON.stringify(expandedPORowKyes));
    // return () => localStorage.removeItem(getExpandedPORowKeysStorageKey());
  }, [expandedPORowKyes]);

  const navigate = useNavigate();

  const getItemAttributes = useMemo(() => (item : any) => {
    const estimateItem = projectEstimates?.find(
      (i) => i?.item === item?.item_id
    );

    if(!estimateItem) return { dynamicQtyClass: null, updated_estd_amt: null, percentage_change: null, estimateItem: null }

    const quantityDif = item?.quantity - estimateItem?.quantity_estimate;

    let dynamicQtyClass = null;

    if (estimateItem) {
      if (quantityDif > 0) {
        dynamicQtyClass = "text-primary";
      } else if (
        quantityDif < 0 &&
        Math.abs(quantityDif) < 5
      ) {
        dynamicQtyClass = "text-yellow-600";
      } else if (quantityDif === 0) {
        dynamicQtyClass = "text-green-500";
      } else {
        dynamicQtyClass = "text-blue-500";
      }
    }

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

    return { dynamicQtyClass, updated_estd_amt, percentage_change, estimateItem }
  }, [projectEstimates])

  const columns : TableColumnsType<{key : string, total_amount : number, total_estimate_amount : number, category : string, items : any[]}> = useMemo(() => [
    {
      title: "Category",
      dataIndex: "category",
      key: "category",
      width: "45%",
      render: (text) => <span className="text-primary font-extrabold">{text}</span>,
    },
    {
      title: "Total PO Amount (exc. GST)",
      dataIndex: "total_amount",
      key: "total_amount",
      width: "30%",
      render: (text) => <Badge className="font-bold">{text ? formatToRoundedIndianRupee(text) : "--"}</Badge>,
    },
    {
      title: "Total Estd. Amount (exc. GST)",
      dataIndex: "total_estimate_amount",
      key: "total_estimate_amount",
      width: "30%",
      render: (text) => <Badge className="font-bold">{text ? formatToRoundedIndianRupee(text) : "--"}</Badge>,
    },
  ], [])

  const innerColumns = useMemo(() => [
    // {
    //   title: "Item ID",
    //   dataIndex: "item_id",
    //   key: "item_id",
    //   render: (text) => <span className="italic">{text}</span>,
    // },
    {
      title: "Item Name",
      dataIndex: "item_name",
      key: "item_name",
      width: "30%",
      className: "min-w-[200px]",
      render: (text) => <div className="italic">{text}</div>,
    },
    {
      title: "Unit",
      dataIndex: "unit",
      key: "unit",
      render: (text) => <span className="italic">{text || "--"}</span>,
    },
    {
      title: "Qty Ordered",
      dataIndex: "quantity",
      key: "qty_quantity",
      render: (text, data) => {
        const { dynamicQtyClass } = getItemAttributes(data)
        return <span className={`${text && dynamicQtyClass} italic`}>{text || "--"}</span>
      }
    },
    {
      title: "Qty Received",
      dataIndex: "received",
      key: "qty_received"
    },
    {
      title: "Estd. Qty",
      key: "estd_quantity",
      render: (text, data) => {
        const { estimateItem } = getItemAttributes(data)
        return <span className="italic">{estimateItem?.quantity_estimate || "--"}</span>
      }
    },
    {
      title: "PO Amt",
      dataIndex: "amount",
      key: "amount_spent",
      render: (text) => (
        <span className="italic">
          {text ? formatToRoundedIndianRupee(text) : "--"}
        </span>
      ),
    },
    {
      title: "Estd. Amt",
      key: "amount_estd",
      render: (text, data) => {
        const { estimateItem } = getItemAttributes(data)
        return <span className="italic">
          {formatToRoundedIndianRupee(
            estimateItem?.rate_estimate *
            estimateItem?.quantity_estimate
          )}
        </span>
      },
    },
    {
      title: "Updated Estd. Amt",
      key: "updated_amount_estd",
      render: (text, data) => {
        const { updated_estd_amt, percentage_change, estimateItem } = getItemAttributes(data)
        return <span
          className={`${(estimateItem?.quantity_estimate !==
              undefined && updated_estd_amt)
              ? updated_estd_amt >
                (estimateItem?.rate_estimate *
                  estimateItem?.quantity_estimate)
                ? "text-red-500"
                : "text-green-500"
              : ""
            } italic`}
        >
          {estimateItem?.quantity_estimate !==
            undefined
            ? formatToRoundedIndianRupee(updated_estd_amt)
            : "--"}
          {!isNaN(percentage_change) && (estimateItem?.quantity_estimate !==
            undefined && ` (${percentage_change}%)`)}
        </span>
      },
    },
  ], [getItemAttributes, projectEstimates, selectedData])

  const innerPOColumns = useMemo(() => [
    {
      title: "PO ID",
      dataIndex: "name",
      key: "name",
      render: (text, data) => {
        return <span className="underline cursor-pointer text-blue-600" onClick={() => navigate(`po/${text?.replaceAll("/", "&=")}`)}>
          {text}
        </span>
      },
      // width: "35%",
      className: "min-w-[230px]",
    },
    {
      title: "Quantity",
      dataIndex: "po_item_quantity",
      key: "po_item_quantity",
    },
    {
      title: "Received",
      dataIndex: "po_item_qty_received",
      key: "po_item_qty_received",
    },
    {
      title: "Rate",
      dataIndex: "po_item_quote",
      key: "po_item_quote",
      render: (text) => (
        <span>{formatToIndianRupee(text)}</span>
      )
    },
    {
      title: "Vendor",
      dataIndex: "vendor_name",
      key: "vendor_name",
    },
  ], [])

  const getTotalAmount = useMemo(
    () => (key: string) : number => {
      return selectedData?.[key]?.reduce((acc, item) => acc + parseNumber(item?.amount), 0) || 0
    }
  , [selectedData])

  const getTotalCategoryEstdAmt = useMemo(
    () => (key: string) : number => {
      const categoryEstimates = projectEstimates?.filter(
        (i) => i?.category === key
      );
      return categoryEstimates?.reduce((sum, item) => sum + parseNumber(item?.rate_estimate) * parseNumber(item?.quantity_estimate),
        0
      ) || 0
    }
  , [projectEstimates])

  return (
    <div className="w-full">
      {selectedData ? (
        <div className="overflow-x-auto pb-4">
          <ConfigProvider>
            <AntTable
              dataSource={Object.keys(selectedData)
                ?.sort((a, b) =>
                  a?.localeCompare(b)
                )
                ?.map((key) => {
                  const totalAmount = getTotalAmount(key);
                  const totalCategoryEstdAmt = getTotalCategoryEstdAmt(key)
                  return {
                    key: key,
                    total_amount: totalAmount,
                    total_estimate_amount: totalCategoryEstdAmt,
                    category: key,
                    items: selectedData[key],
                  }
                })?.sort((a, b) => b?.total_estimate_amount - a?.total_estimate_amount)}
              columns={columns}
              pagination={false}
              expandable={{
                expandedRowKeys,
                onExpandedRowsChange: setExpandedRowKeys,
                expandedRowRender: (record) => (
                  <AntTable
                    dataSource={record.items}
                    columns={innerColumns}
                    pagination={false}
                    rowKey={(item) => item.item_id || uuidv4()}
                    expandable={{
                      expandedPORowKyes,
                      onExpandedRowsChange: setExpandedPORowKeys,
                      expandedRowRender: (record) => {
                        if (!record?.po_number) return null;
                        const filteredPOData = po_data?.filter((i) => {
                          const po_numbers = record?.po_number?.split(",");
                          return po_numbers?.includes(i.name);
                        });

                        // Add the `item_id` field to each data object
                        const enrichedPOData = filteredPOData?.map((item) => {
                          const po_item = item?.order_list?.list?.find((i) => i?.name === record?.item_id);
                          return {
                            ...item,
                            po_item_quantity: po_item?.quantity,
                            po_item_qty_received: po_item?.received || "--",
                            po_item_quote: po_item?.quote,
                          };
                        });
                        return (
                          <AntTable
                            dataSource={enrichedPOData}
                            columns={innerPOColumns}
                            pagination={false}
                            rowKey={(item) => item.name || uuidv4()}
                          />
                        )
                      },
                      rowExpandable: (record) => !!record?.po_number
                    }}
                  />
                ),
              }}
              rowKey="key"
            />
          </ConfigProvider>
        </div>
      ) : (
        <div className="h-[10vh] flex items-center justify-center">
          No Results.
        </div>
      )}
    </div>
  )
}

export default CategoryAccordion;