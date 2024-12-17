import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useNavigate } from "react-router-dom";

export const EstimatedPriceHoverCard = ({ total, prUsedQuotes }) => {
    const navigate = useNavigate();

    const handleNavigation = (poId, itemId) => {
        navigate(`/estimate-overview?poId=${encodeURIComponent(poId)}&itemId=${encodeURIComponent(itemId)}`);
    };

    return (
        <HoverCard>
            <HoverCardTrigger>
                <div className="font-medium underline">
                    {formatToIndianRupee(total)}
                </div>
            </HoverCardTrigger>
            <HoverCardContent>
                <div>
                    <h2 className="text-primary font-semibold mb-4">Estimate Summary:</h2>
                    <div className="flex flex-col gap-4">
                        {Object.entries(prUsedQuotes)?.map(([item, quotes]) => (
                            <div key={item} className="flex flex-col gap-2">
                                <p className="font-semibold">{item}</p>
                                <p className="font-semibold">({quotes?.quantity} * ₹{quotes?.amount} = {formatToIndianRupee(quotes?.quantity * quotes?.amount)})</p>
                                <ul className="list-disc">
                                    {quotes?.items ? (
                                        <li
                                            className="ml-4 text-gray-600 underline hover:underline-offset-2 cursor-pointer"
                                            key={quotes?.items?.name}
                                            onClick={() =>
                                                handleNavigation(
                                                    quotes?.items?.procurement_order,
                                                    quotes?.items?.item_id
                                                )
                                            }
                                        >
                                            {quotes?.items?.procurement_order}
                                        </li>
                                    ) : (
                                        <p className="text-xs">No previous Quotes found for this item</p>
                                    )}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
};