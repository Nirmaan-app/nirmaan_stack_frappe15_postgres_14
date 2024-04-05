import { NavBar } from "@/components/nav/nav-bar";
//import React, { useState } from "react";
import { Default } from "@/components/dashboard-default"
import { ProjectManager } from "@/components/dashboard-pm"
import { ProjectLead } from "@/components/dashboard-pl"
import { useUserData } from "@/hooks/useUserData";


export default function Dashboard() {

    // const [selectedValue, setSelectedValue] = useState<string>('');

    // const handleButtonClick = (value: string) => {
    //     setSelectedValue(value);
    // };

    const userData = useUserData()


    return (
        <>
            <NavBar />
            {/* <div className="flex flex-col justify-center">
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
                </div>
            </div> 
            {selectedValue=='default' && <Default/>}
            {selectedValue=='Project_Manager' && <ProjectManager/>}
            {selectedValue=='Project_Lead' && <ProjectLead/>}
            */}
            {userData.role == 'Nirmaan Admin' && <Default />}
            {userData.role == 'Project Manager Profile' && <ProjectManager />}
            {userData.role == 'Project Lead Profile' && <ProjectLead />}

        </>
    )
}