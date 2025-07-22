import { Badge } from "@/components/ui/badge";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { ConfigProvider, Table } from "antd";
import { useMemo } from "react";

interface AllTabProps {
  workPackageTotalAmounts?: {
    [key: string]: any;
  };
  setProjectSpendsTab: (tab: any) => void;
  segregatedServiceOrderData?: {
    [category: string]: {
      key: string;
      unit: string;
      quantity: number;
      amount: number;
      children: any[];
      estimate_total: number;
    };
  }[];
  totalServiceOrdersAmt?: number;
  getTotalAmountPaid?: {
    poAmount: number;
    srAmount: number;
    totalAmount: number;
  };
}

export const AllTab: React.FC<AllTabProps> = ({ workPackageTotalAmounts, setProjectSpendsTab, segregatedServiceOrderData, totalServiceOrdersAmt, getTotalAmountPaid }) => {

  // const [totalsAmounts, setTotalsAmounts] = useState<{ [key: string]: any }>({})



  const serviceTotalEstdAmt = useMemo(() => segregatedServiceOrderData
    ?.reduce((acc, i) => {
      const { estimate_total } = Object.values(i)[0];
      return acc + parseNumber(estimate_total);
    }, 0), [segregatedServiceOrderData])

  const totalsAmounts = useMemo(() => {
    const totalAmountsObject = { ...workPackageTotalAmounts };

    if ((serviceTotalEstdAmt || totalServiceOrdersAmt)) {
      totalAmountsObject["Services"] = {
        amountWithoutTax: totalServiceOrdersAmt,
        total_estimated_amount: serviceTotalEstdAmt,
        total_amount_paid: getTotalAmountPaid?.srAmount,
      };
    }

    return totalAmountsObject;
  }, [workPackageTotalAmounts, serviceTotalEstdAmt, totalServiceOrdersAmt, getTotalAmountPaid]);

  // console.log("totalsAmounts", totalsAmounts);

  const tableRows = useMemo(() => {
    return Object.keys(totalsAmounts)
      .sort((a, b) => a?.localeCompare(b))
      .map((key) => ({
        key,
        work_package: key,
        amountWithoutTax: totalsAmounts[key]?.amountWithoutTax,
        total_estimated_amount: totalsAmounts[key]?.total_estimated_amount,
        total_amount_paid: totalsAmounts[key]?.total_amount_paid,
      }))
      .sort((a, b) => b?.total_estimated_amount - a?.total_estimated_amount);
  }, [totalsAmounts]);

  // useEffect(() => {
  //   const totalAmountsObject = { ...workPackageTotalAmounts }
  //   if ((serviceTotalEstdAmt || totalServiceOrdersAmt)) {
  //     totalAmountsObject["Services"] = { amountWithoutTax: totalServiceOrdersAmt, total_estimated_amount: serviceTotalEstdAmt, total_amount_paid: getTotalAmountPaid?.srAmount }
  //   }
  //   setTotalsAmounts(totalAmountsObject)
  // }, [serviceTotalEstdAmt, workPackageTotalAmounts, totalServiceOrdersAmt])

  const columns = useMemo(() => [
    {
      title: "Work Package",
      dataIndex: "work_package",
      key: "work_package",
      width: "25%",
      render: (text) => <strong onClick={() => setProjectSpendsTab(text)} className="text-primary underline cursor-pointer">{text}</strong>,
    },
    {
      title: "Total PO Amount (exc. GST)",
      dataIndex: "amountWithoutTax",
      key: "amountWithoutTax",
      width: "20%",
      render: (text) => <Badge className="font-bold">{text ? formatToRoundedIndianRupee(text) : "--"}</Badge>,
    },
    {
      title: "Total Estd. Amount (exc. GST)",
      dataIndex: "total_estimated_amount",
      key: "total_estimated_amount",
      width: "20%",
      render: (text) => <Badge className="font-bold">{text ? formatToRoundedIndianRupee(text) : "--"}</Badge>,
    },
    {
      title: "Total Amount Paid",
      dataIndex: "total_amount_paid",
      key: "total_amount_paid",
      width: "20%",
      render: (text) => <Badge className="font-bold">{text ? formatToRoundedIndianRupee(text) : "--"}</Badge>,
    },
  ], [totalsAmounts])

  return (
    <div className="w-full">
      {Object.keys(totalsAmounts)?.length !== 0 ? (
        <div className="overflow-x-auto">
          <ConfigProvider>
            <Table dataSource={tableRows} columns={columns} />
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

export default AllTab;