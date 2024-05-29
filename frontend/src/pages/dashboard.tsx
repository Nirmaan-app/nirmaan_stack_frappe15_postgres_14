import { NavBar } from "@/components/nav/nav-bar";
import React, { useState } from "react";
import { Default } from "@/components/dashboard-default"
import { ProjectManager } from "@/components/dashboard-pm"
import { ProjectLead } from "@/components/dashboard-pl"
import { useUserData } from "@/hooks/useUserData";
import ProcurementDashboard from "@/components/procurement/procurement-dashboard";
import { MainLayout } from "@/components/layout/main-layout";


export default function Dashboard() {

    const [selectedValue, setSelectedValue] = useState<string>('');

    const handleButtonClick = (value: string) => {
        setSelectedValue(value);
    };

    const userData = useUserData()

    return (
        <>
            <MainLayout>
                {userData.user_id == "Administrator" && <div className="flex flex-col justify-center">
                    <div className="space-y-2">
                        <button
                            className="bg-gray-100 hover:bg-gray-600 text-black px-4 py-2 rounded"
                            onClick={() => handleButtonClick('default')}
                        >
                            default
                        </button>
                        <button
                            className="bg-gray-200 hover:bg-gray-600 text-black px-4 py-2 rounded"
                            onClick={() => handleButtonClick('Project_Manager')}
                        >
                            Project_Manager
                        </button>
                        <button
                            className="bg-gray-300 hover:bg-gray-600 text-black px-4 py-2 rounded"
                            onClick={() => handleButtonClick('Project_Lead')}
                        >
                            Project_Lead
                        </button>
                        <button
                            className="bg-gray-300 hover:bg-gray-600 text-black px-4 py-2 rounded"
                            onClick={() => handleButtonClick('Procurement_Executive')}
                        >
                            Procurement_Executive
                        </button>
                    </div>
                </div>}
                {selectedValue == 'default' && <Default />}
                {selectedValue == 'Project_Manager' && <ProjectManager />}
                {selectedValue == 'Project_Lead' && <ProjectLead />}
                {selectedValue == 'Procurement_Executive' && <ProcurementDashboard />}
                

                {/* {userData.role == 'Nirmaan Admin' && <Default />} */}
            {userData.role == 'Nirmaan Project Manager Profile' && <ProjectManager />}
            {userData.role == 'Nirmaan Project Lead Profile' && <ProjectLead />}
            {userData.role == 'Nirmaan Procurement Executive Profile' && <ProcurementDashboard />}
            </MainLayout>

        </>
    )
}