import { NavBar } from "@/components/nav/nav-bar";
import React, { useState } from "react";
import { Default } from "@/components/dashboard-default"
import { ProjectManager } from "@/components/dashboard-pm"
import { ProjectLead } from "@/components/dashboard-pl"
import { useUserData } from "@/hooks/useUserData";
import ProcurementDashboard from "@/components/procurement/procurement-dashboard";
import { MainLayout } from "@/components/layout/main-layout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";


export default function Dashboard() {

    const [selectedValue, setSelectedValue] = useState<string>('');

    const handleButtonClick = (value: string) => {
        setSelectedValue(value);
    };

    const userData = useUserData()

    return (
        <>
            <MainLayout>
                {(userData.user_id == "Administrator" || userData.role == "Nirmaan Admin Profile") && <div className="flex flex-col justify-center">
                    <div className="flex space-y-2">
                        <h1 className="pt-4 pl-12 pr-10 text-xl font-bold text-red-300 hidden md:flex">Role Selector:</h1>
                        <Tabs defaultValue="default" className="min-h-[50]">
                            <TabsList className="">
                                <TabsTrigger value="default" onClick={() => handleButtonClick('default')}>Admin</TabsTrigger>
                                <TabsTrigger value="Project_Manager" className="hidden md:flex" onClick={() => handleButtonClick('Project_Manager')}>Project Manager</TabsTrigger>
                                <TabsTrigger value="Project_Lead" className="hidden md:flex" onClick={() => handleButtonClick('Project_Lead')}>Project Lead</TabsTrigger>
                                <TabsTrigger value="Procurement_Executive" className="hidden md:flex" onClick={() => handleButtonClick('Procurement_Executive')}>Procurement Executive</TabsTrigger>
                                <TabsTrigger value="Project_Manager_mobile" className="md:hidden" onClick={() => handleButtonClick('Project_Manager')}>Proj.Man</TabsTrigger>
                                <TabsTrigger value="Project_Lead_mobile" className="md:hidden" onClick={() => handleButtonClick('Project_Lead')}>Proj.Lead</TabsTrigger>
                                <TabsTrigger value="Procurement_Executive_mobile" className="md:hidden" onClick={() => handleButtonClick('Procurement_Executive')}>Proc.Exec</TabsTrigger>
                            </TabsList>
                        </Tabs>
                        {/* <button
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
                        </button> */}
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