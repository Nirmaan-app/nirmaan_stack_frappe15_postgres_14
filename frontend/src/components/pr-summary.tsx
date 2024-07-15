import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { MainLayout } from "./layout/main-layout";
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ProcurementRequests } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Label } from "./ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { ItemComponent } from "@/pages/items";

const PRSummary = () => {

    const { id } = useParams<{ id: string }>();

    const project_id = id?.split('-')[1];

    const { data: pr_data, error: pr_error } = useFrappeGetDoc<ProcurementRequests>("Procurement Requests", id);

    const { data: project, error: project_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ['name', 'project_name', 'project_address'],
        filters: [['name', 'like', `%${project_id}`]]
    });

    return (
        <>
            {pr_error && <h1>{pr_error.message}</h1>}
            {project_error && <h1>{project_error.message}</h1>}
            {(pr_data && project) && <PRSummaryPage pr_data={pr_data} project={project[0]} />}
        </>
    )


};

interface PRSummaryPageProps {
    pr_data: ProcurementRequests
    project: Projects
}

const PRSummaryPage = ({ pr_data, project }: PRSummaryPageProps) => {
    const navigate = useNavigate();
    const pr_no = pr_data.name.split("-").slice(-1)

    const { data: address, error: address_error } = useFrappeGetDoc("Address", project.project_address);

    return (
        <>
            {address_error && <h1>{address_error.message}</h1>}
            {address &&
                <MainLayout>
                    <div className="flex-1 md:space-y-4 p-4 md:p-6 pt-6">
                        <div className="flex items-center pt-1 pb-4">
                            <ArrowLeft className="mb-3" onClick={() => navigate("/procurement-request")} />
                            <h2 className="text-xl pt-1 pb-4 pl-2 font-bold tracking-tight">Summary: </h2>
                            <span className="pl-2 pb-2.5 text-red-500 text-2xl">PR-{pr_no}</span>
                        </div>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <Card className="w-full">
                                <CardHeader>
                                    <CardTitle className="text-xl text-red-600">PR Details</CardTitle>
                                </CardHeader>
                                <CardContent className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                                    <div className="space-y-1">
                                        <Label className="text-slim text-red-300">ID:</Label>
                                        <p className="font-semibold">{pr_data.name}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-slim text-red-300">Project:</Label>
                                        <p className="font-semibold">{project.project_name}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-slim text-red-300">Project Address:</Label>
                                        <p className="font-semibold">{` ${address.address_line1}, ${address.address_line2}, ${address.city}, ${address.state}, PIN-${address.pincode}`}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-slim text-red-300">Package Name:</Label>
                                        <p className="font-semibold">{pr_data.work_package}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-slim text-red-300">Date Created:</Label>
                                        <p className="font-semibold">{new Date(pr_data.creation).toDateString()}</p>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="w-full">
                                <CardHeader>
                                    <CardTitle className="text-xl text-red-600">Order Details</CardTitle>
                                </CardHeader>

                                <div className="overflow-x-auto">

                                    <div className="min-w-full inline-block align-middle">
                                        {JSON.parse(pr_data.category_list).list.map((cat: any) => {
                                            return <div className="p-5">
                                                {/* <div className="text-base font-semibold text-black p-2">{cat.name}</div> */}
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow className="bg-red-100">
                                                            <TableHead className="w-[60%]"><span className="text-red-700 pr-1 font-extrabold">{cat.name}</span>Items</TableHead>
                                                            <TableHead className="w-[25%]">UOM</TableHead>
                                                            <TableHead className="w-[15%]">Qty</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {JSON.parse(pr_data.procurement_list).list.map((item: any) => {
                                                            if (item.category === cat.name) {
                                                                return (
                                                                    <TableRow key={item.item}>
                                                                        <TableCell>{<ItemComponent item_id={item.name} />}</TableCell>
                                                                        <TableCell>{item.unit}</TableCell>
                                                                        <TableCell>{item.quantity}</TableCell>
                                                                    </TableRow>
                                                                )
                                                            }
                                                        })}
                                                    </TableBody>
                                                </Table>
                                                {/* <table className="min-w-full divide-y divide-gray-200">
                                                    <thead className="border-b-2 border-black">
                                                        <tr>
                                                            <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                                                            <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">UOM</th>
                                                            <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="bg-white divide-y divide-gray-200">
                                                        {JSON.parse(pr_data.procurement_list).list.map((item: any) => {
                                                            if (item.category === cat.name) {
                                                                return <tr key={item.item}>
                                                                    <td className="px-3 text-xs py-2 font-medium whitespace-nowrap">{item.item}</td>
                                                                    <td className="px-3 text-xs py-2 font-medium whitespace-nowrap">{item.unit}</td>
                                                                    <td className="px-3 text-xs py-2 font-medium whitespace-nowrap">{item.quantity}</td>
                                                                </tr>
                                                            }
                                                        })}
                                                    </tbody>
                                                </table> */}
                                            </div>
                                        })}
                                    </div>
                                </div>

                            </Card>
                        </div>
                    </div>
                </MainLayout>}
        </>
    );

}

export const Component = PRSummary;
