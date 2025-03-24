import { Badge } from "@/components/ui/badge";
import formatToIndianRupee from "@/utils/FormatPrice";
import { ConfigProvider, Table } from "antd";
import { useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";

interface ServiceRequestsAccordionProps {
  segregatedData?: {
    [category: string]: {
        key: string;
        unit: string;
        quantity: number;
        amount: number;
        children: any[];
        estimate_total: number;
    };
}[];
}


export const ServiceRequestsAccordion : React.FC<ServiceRequestsAccordionProps> = ({
  segregatedData,
}) => {
  const [expandedRowKeys, setExpandedRowKeys] = useState([]);

  // useEffect(() => {
  //   if (segregatedData) {
  //     setExpandedRowKeys(Object.keys(segregatedData));
  //   }
  // }, [segregatedData]);

  // Main table columns
  const columns = useMemo(() => [
    {
      title: "Category",
      dataIndex: "category",
      key: "category",
      width: "50%",
      render: (text) => <strong className="text-primary">{text}</strong>,
    },
    {
      title: "Total Amount (exc. GST)",
      dataIndex: "amount",
      key: "amount",
      width: "20%",
      render: (text) => <Badge>{text ? formatToIndianRupee(text) : "--"}</Badge>,
    },
    {
      title: "Total Estd. Amount (exc. GST)",
      dataIndex: "estimate_total",
      key: "estimate_total",
      width: "25%",
      render: (text) => <Badge>{text ? formatToIndianRupee(text) : "--"}</Badge>,
    },
  ], [segregatedData]);

  const innerColumns = useMemo(() => [
    {
      title: "Description",
      dataIndex: "description",
      key: "description",
      width: "40%",
    },
    {
      title: "Unit",
      dataIndex: "uom",
      key: "unit",
    },
    {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
      width: "20%",
    },
    {
      title: "Amount Spent",
      dataIndex: "amount",
      key: "amount",
      width: "25%",
      render: (text) => (
        <span className="italic">
          {text ? formatToIndianRupee(text) : "--"}
        </span>
      ),
    },
  ], [segregatedData]);

  return (
    <div className="w-full">
      {(segregatedData || []).length > 0 ? (
        <div className="overflow-x-auto">
          <ConfigProvider>
            <Table
              dataSource={segregatedData
                ?.sort((a, b) =>
                  Object.keys(a)[0]?.localeCompare(Object.keys(b)[0])
                )
                ?.map((key) => ({
                  key: Object.values(key)[0]?.key,
                  amount: Object.values(key)[0]?.amount,
                  estimate_total: Object.values(key)[0]?.estimate_total,
                  category: Object.keys(key)[0],
                  items: Object.values(key)[0]?.children,
                }))?.sort((a, b) => b?.estimate_total - a?.estimate_total)}
              columns={columns}
              pagination={false}
              expandable={{
                expandedRowKeys,
                onExpandedRowsChange: setExpandedRowKeys,
                expandedRowRender: (record) => (
                  <Table
                    dataSource={record.items}
                    columns={innerColumns}
                    pagination={false}
                    rowKey={(item) => item.id || uuidv4()}
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
  );
};


export default ServiceRequestsAccordion;