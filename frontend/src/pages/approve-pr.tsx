import { useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";

export const ApprovePR = () => {
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
    {
        fields:['name','workflow_state','owner','project','work_package','procurement_list','creation']
    });
    const procurement_request_lists = [];
    procurement_request_list?.map((item) => {
        if(item.workflow_state === "Pending") procurement_request_lists.push(item)
    })
    return (
        <div className="flex">
            <div className="w-1/5 h-[600px] rounded-lg m-1 p-2 border-2 border-gray-300">
            Sidebar Content
            </div>
            <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-lg font-bold tracking-tight">Approve PR</h2>
                </div>
                {/* <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2"> */}
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-gray-200">
                            <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PR number</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Package</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estimated Price</th>
                            </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                            {procurement_request_lists?.map(item => (
                                <tr key={item.name}>
                                <td className="px-6 py-4 text-blue-600 whitespace-nowrap"><Link to={`/approve-order/${item.name}`}>{item.name.slice(-4)}</Link></td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    {item.creation.split(" ")[0]}
                                </td>
                                <td className="px-6 py-4 text-sm whitespace-nowrap">{item.project}</td>
                                <td className="px-6 py-4 text-sm whitespace-nowrap">{item.work_package}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                   N/A
                                </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
            </div>
        </div>
    )
}