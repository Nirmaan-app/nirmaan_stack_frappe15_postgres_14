import { useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

export const EstimatedPriceOverview = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const searchParams = new URLSearchParams(location.search);
    const poId = searchParams.get("poId");
    const itemId = searchParams.get("itemId");

    const { data: quote_data } = useFrappeGetDocList("Approved Quotations", {
        fields: ["*"],
        filters: [["procurement_order", "=", poId], ["item_id", "=", itemId]],
        limit: 10000,
    });

    // console.log("quote_data", quote_data);

    const calculateTotals = (item) => {
        const totalWithoutGST = parseFloat(item?.quote || 0) * parseFloat(item?.quantity || 0)
        const tax = item?.tax || 0;
        const gst = totalWithoutGST * (parseFloat(tax) / 100);
        const totalWithGST = totalWithoutGST + gst;
        return { totalWithoutGST, gst, totalWithGST };
    };

    return (
        <div className="flex-1 space-y-4">
            <div className="flex items-center gap-1">
                <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
                <h1 className="text-2xl font-bold text-gray-800">Approved Quotations: <span className="text-primary">{itemId}</span></h1>
            </div>

            {quote_data && quote_data.length > 0 ? (
                <div className="bg-white shadow-lg rounded-lg p-4">
                    <div className="mb-6 border-b pb-4 flex justify-between">
                        <div>
                            <h2 className="text-primary font-semibold">Vendor Details</h2>
                            <p className="text-gray-600">Vendor: {quote_data[0]?.vendor}</p>
                            <p className="text-gray-600">City: {quote_data[0]?.city}</p>
                            <p className="text-gray-600">State: {quote_data[0]?.state}</p>
                        </div>

                        <div>
                            <span className="text-primary font-semibold">Associated PO</span> : {poId}
                        </div>
                    </div>

                    <table className="min-w-full border-collapse border border-gray-200 rounded-lg">
                        <thead className="bg-gray-100">
                            <tr>
                                <th className="border border-gray-200 p-2 text-left text-gray-700">Item Name</th>
                                <th className="border border-gray-200 p-2 text-left text-gray-700">Unit</th>
                                <th className="border border-gray-200 p-2 text-left text-gray-700">Quantity</th>
                                <th className="border border-gray-200 p-2 text-left text-gray-700">Quote</th>
                                <th className="border border-gray-200 p-2 text-left text-gray-700">Tax (%)</th>
                                <th className="border border-gray-200 p-2 text-left text-gray-700">Total (Without GST)</th>
                                <th className="border border-gray-200 p-2 text-left text-gray-700">Total (With GST)</th>
                                <th className="border border-gray-200 p-2 text-left text-gray-700">Category</th>
                            </tr>
                        </thead>
                        <tbody>
                            {quote_data.map((item, index) => {
                                const { totalWithoutGST, gst, totalWithGST } = calculateTotals(item);
                                return (
                                    <tr
                                        key={index}
                                        className={
                                            index % 2 === 0 ? "bg-white" : "bg-gray-50"
                                        }
                                    >
                                        <td className="border border-gray-200 p-2">{item.item_name}</td>
                                        <td className="border border-gray-200 p-2">{item.unit}</td>
                                        <td className="border border-gray-200 p-2">{item.quantity}</td>
                                        <td className="border border-gray-200 p-2">₹{item.quote}</td>
                                        <td className="border border-gray-200 p-2">{item.tax}%</td>
                                        <td className="border border-gray-200 p-2">₹{totalWithoutGST.toFixed(2)}</td>
                                        <td className="border border-gray-200 p-2">₹{totalWithGST.toFixed(2)}</td>
                                        <td className="border border-gray-200 p-2">{item.category || "--"}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p className="text-gray-500">No quotations found for this Procurement Order.</p>
            )}
        </div>
    );
};
