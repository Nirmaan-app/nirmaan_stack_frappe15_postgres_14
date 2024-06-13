import { useFrappeGetDocList } from "frappe-react-sdk";
import { useParams,useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { MainLayout } from "./layout/main-layout";
import { ArrowLeft } from 'lucide-react';

export const PRSummary = () => {
    const navigate = useNavigate();

    const { id } = useParams<{ id: string }>();
    const { data: procurement_request_list } = useFrappeGetDocList("Procurement Requests", {
        fields: ['name', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation', 'category_list'],
        limit: 100
    });

    const [orderData, setOrderData] = useState<any>({
        project: '',
        procurement_list: { list: [] }
    });

    useEffect(() => {
        procurement_request_list?.forEach(item => {
            if (item.name === id) {
                setOrderData(item);
            }
        });
    }, [procurement_request_list, id]);

    return (
        <>
        <MainLayout>
            <div className="flex items-center space-y-2">
                <ArrowLeft onClick={() => navigate("/")} />
                <h2 className="text-base pt-1 pb-4 pl-2 font-bold tracking-tight">Summary</h2>
            </div>
            </MainLayout>
            <div className="overflow-x-auto">
                <div className="min-w-full inline-block align-middle">
                    {orderData.category_list?.list.map((cat) => {return <div>
                    <div className="text-base font-semibold text-black p-2">{cat.name}</div>
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="border-b-2 border-black">
                            <tr>
                                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">UOM</th>
                                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {orderData.procurement_list?.list?.map(item => {
                                if(item.category === cat.name){ return <tr key={item.item}>
                                    <td className="px-3 text-xs py-2 font-medium whitespace-nowrap">{item.item}</td>
                                    <td className="px-3 text-xs py-2 font-medium whitespace-nowrap">{item.unit}</td>
                                    <td className="px-3 text-xs py-2 font-medium whitespace-nowrap">{item.quantity}</td>
                                </tr>}
                            })}
                        </tbody>
                    </table>
                    </div>})}
                </div>
            </div>
            </>
    );
};
