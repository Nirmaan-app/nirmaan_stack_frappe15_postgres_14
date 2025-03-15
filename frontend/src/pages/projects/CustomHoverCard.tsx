import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import formatToIndianRupee from "@/utils/FormatPrice";
import { DownOutlined } from "@ant-design/icons";
import { Tree } from "antd";


interface CustomHoverCardProps {
  totalPosRaised?: number;
  totalServiceOrdersAmt?: number;
  categorizedData?: {
    [workPackage: string]: {
        [category: string]: any[];
    };
  };
  workPackageTotalAmounts?: {
    [key: string]: any;
  };
}

export const CustomHoverCard : React.FC<CustomHoverCardProps> = ({
  totalPosRaised,
  totalServiceOrdersAmt,
  categorizedData,
  workPackageTotalAmounts,
}) => {
  // Generate tree data for the Tree component
  const generateTreeData = () => {
    const treeData =
      categorizedData &&
      Object.entries(categorizedData)?.map(([workPackage, categories]) => {
        // Children for each category in the work package
        const categoryNodes = Object.entries(categories).map(
          ([category, items]) => {
            const totalAmount = items.reduce(
              (sum, item) => sum + item.amount,
              0
            );
            const totalAmountWithTax = items.reduce(
              (sum, item) => sum + item.amountWithTax,
              0
            );

            return {
              title: `${category}: ₹${parseFloat(
                totalAmountWithTax
              ).toLocaleString()} (Base: ₹${parseFloat(
                totalAmount
              ).toLocaleString()})`,
              key: `${workPackage}-${category}`,
              children: items.map((item, index) => ({
                title: `${item.item_name} - Qty: ${item.quantity}`,
                key: `${workPackage}-${category}-${index}`,
              })),
            };
          }
        );

        return {
          title: `${workPackage} - Total: ₹${parseFloat(
            workPackageTotalAmounts[workPackage]?.amountWithoutTax
          ).toLocaleString()}`,
          key: workPackage,
          children: categoryNodes,
        };
      });

    // Add service requests total as a standalone item
    if (totalServiceOrdersAmt) {
      treeData?.push({
        title: `Service Requests Total: ₹${parseFloat(
          totalServiceOrdersAmt
        ).toLocaleString()}`,
        key: "service-requests-total",
      });
    }

    return treeData;
  };

  return (
    <HoverCard>
      <HoverCardTrigger>
        <div className="underline">
          <span className="whitespace-nowrap">PO Amt (ex. GST): </span>
          <span className="max-sm:text-end max-sm:w-full text-primary">
            {formatToIndianRupee(totalPosRaised + totalServiceOrdersAmt)}
          </span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="overflow-y-auto max-h-[80vh]">
        {generateTreeData()?.length !== 0 ? (
          <div>
            <h3 className="font-semibold text-lg mb-2">
              Total Spent Breakdown
            </h3>
            <Tree
              showLine
              switcherIcon={<DownOutlined />}
              defaultExpandedKeys={["0-0"]}
              treeData={generateTreeData()}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center font-semibold text-xs">
            Empty!
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
};