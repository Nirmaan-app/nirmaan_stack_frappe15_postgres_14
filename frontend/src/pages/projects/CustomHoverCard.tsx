import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { ChevronRight } from "lucide-react";


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

// Recursive Tailwind tree: a native <details> disclosure per branch (chevron rotates
// on open), indent guide via border-l; leaves are plain rows.
const TreeNodes = ({ nodes }: { nodes: any[] }) => (
  <ul className="space-y-0.5">
    {nodes?.map((n) => (
      <li key={n.key}>
        {n.children?.length ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1 py-0.5 text-sm hover:text-primary">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
              <span>{n.title}</span>
            </summary>
            <div className="ml-2 mt-0.5 border-l pl-3">
              <TreeNodes nodes={n.children} />
            </div>
          </details>
        ) : (
          <div className="py-0.5 pl-[22px] text-sm text-muted-foreground">{n.title}</div>
        )}
      </li>
    ))}
  </ul>
);

export const CustomHoverCard: React.FC<CustomHoverCardProps> = ({
  totalPosRaised,
  totalServiceOrdersAmt,
  categorizedData,
  workPackageTotalAmounts,
}) => {

  //    console.log("CustomHoverCard DATA", totalPosRaised,
  // totalServiceOrdersAmt,
  // categorizedData,
  // workPackageTotalAmounts,)

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
              title: `${category}: ${formatToIndianRupee(totalAmountWithTax)
                } (Base: ${formatToIndianRupee(totalAmount)
                })`,
              key: `${workPackage}-${category}`,
              children: items.map((item, index) => ({
                title: `${item.item_name} - Qty: ${item.quantity}`,
                key: `${workPackage}-${category}-${index}`,
              })),
            };
          }
        );

        return {
          title: `${workPackage} - Total: ${formatToIndianRupee(workPackageTotalAmounts[workPackage]?.amountWithoutTax)
            }`,
          key: workPackage,
          children: categoryNodes,
        };
      });

    // Add service requests total as a standalone item
    if (totalServiceOrdersAmt) {
      treeData?.push({
        title: `Service Requests Total: ${formatToRoundedIndianRupee(totalServiceOrdersAmt)
          }`,
        key: "service-requests-total",
      });
    }

    return treeData;
  };

  return (
    <HoverCard>
      <HoverCardTrigger>
        <div className="underline">
          <span className="whitespace-nowrap">PO + SR Amt (ex. GST): </span>
          <span className="max-sm:text-end max-sm:w-full text-primary">
            {formatToRoundedIndianRupee(totalPosRaised + totalServiceOrdersAmt)}
          </span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="overflow-y-auto max-h-[80vh]">
        {generateTreeData()?.length !== 0 ? (
          <div>
            <h3 className="font-semibold text-lg mb-2">
              Total Spent Breakdown
            </h3>
            <TreeNodes nodes={generateTreeData()} />
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