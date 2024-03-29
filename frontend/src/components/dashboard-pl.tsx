import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "./breadcrumb";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { useFrappeGetDocCount } from "frappe-react-sdk";
import { HardHat, UserRound, PersonStanding } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Link } from "react-router-dom";

interface TableItem {
    id: number;
    date: string;
    projectName: string;
    description: string;
    category: string;
    subcategory: string;
  }
  
    // Generate 10 random items for demonstration
const generateRandomItems = (): TableItem[] => {
      const items: TableItem[] = [];
      for (let i = 1; i <= 10; i++) {
        items.push({
          id: i,
          date: getRandomDate(),
          projectName: `Project ${i}`,
          description: `Description ${i}`,
          category: `Category ${i}`,
          subcategory: `Subcategory ${i}`
        });
      }
      return items;
};
  
    // Generate a random date string
const getRandomDate = (): string => {
      const year = Math.floor(Math.random() * (2024 - 2020 + 1)) + 2020;
      const month = Math.floor(Math.random() * 12) + 1;
      const day = Math.floor(Math.random() * 28) + 1; // Considering only 28 days for simplicity
      return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
};
  
    // Table items
const items3 = generateRandomItems();

export const ProjectLead = () => {
    return (
        <>
            <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem isCurrentPage>
                            <BreadcrumbLink href="/wp">
                                Dashboard
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div>
                <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Modules List</h2>
                </div>
                {/* <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2"> */}
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-gray-200">
                            <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project Name and Description</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created by</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                            {items3.map(item => (
                                <tr key={item.id}>
                                <td className="px-6 py-4 whitespace-nowrap">{item.date}</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm font-medium text-gray-900">{item.projectName}</div>
                                    <div className="text-sm text-gray-500">{item.description}</div>
                                </td>
                                <td className="px-6 py-4 text-sm whitespace-nowrap">{item.category}-{item.subcategory}</td>
                                <td className="px-6 py-4 text-sm whitespace-nowrap">username_xyz</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                    <button className="text-gray-600 bg-blue-200 px-8 py-1 rounded-sm hover:bg-blue-300 mr-2"><Link to="/confirmation2">View</Link></button>
                                    <button className="text-white px-6 py-1 rounded-sm bg-blue-600 hover:bg-blue-700">Approve</button>
                                </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                {/* </div> */}
            </div>
        </>
    )
}