// import { useContext } from "react";
// import { Default } from "@/components/dashboard-default";
// import { ProjectManager } from "@/components/dashboard-pm";
// import { ProjectLead } from "@/components/dashboard-pl";
// import ProcurementDashboard from "@/components/procurement/procurement-dashboard";
// import { UserContext } from "@/utils/auth/UserProvider";
// import { useUserData } from "@/hooks/useUserData";
// import { RocketIcon } from "@radix-ui/react-icons"
 
// import {
//   Alert,
//   AlertDescription,
//   AlertTitle,
// } from "@/components/ui/alert"
// import { Button } from "@/components/ui/button";
// import { Sidebar } from "../sidebar-nav";

// const RoleDashboard = ({ selectedValue  } ) => {
//     const { logout } = useContext(UserContext);
//     const userData = useUserData();

//     return (
//         <>
//         <div className="flex">
//         <Sidebar />
//             {selectedValue === 'default' && <Default />}
//             {selectedValue === 'Project_Manager' && <ProjectManager />}
//             {selectedValue === 'Project_Lead' && <ProjectLead />}
//             {selectedValue === 'Procurement_Executive' && <ProcurementDashboard />}

//             {(userData.has_project === "false" && userData.role !== "Nirmaan Admin Profile") ?
//                 <Alert className="ml-[25%] w-[50%] mt-[15%]">
//                     <RocketIcon className="h-4 w-4" />
//                     <AlertTitle>Sorry !!!</AlertTitle>
//                     <AlertDescription className="flex justify-between">
//                         You are not assigned to any project.
//                         <Button onClick={logout}>Log Out</Button>
//                     </AlertDescription>
//                 </Alert>
//                 :
//                 <>
//                     {userData.role === 'Nirmaan Project Manager Profile' && <ProjectManager />}
//                     {userData.role === 'Nirmaan Project Lead Profile' && <ProjectLead />}
//                     {userData.role === 'Nirmaan Procurement Executive Profile' && <ProcurementDashboard />}
//                 </>
//             }
//             </div>
//         </>
//     );
// };

// export default RoleDashboard;

import { useContext } from "react";
import { Default } from "@/components/dashboard-default";
import { ProjectManager } from "@/components/dashboard-pm";
import { ProjectLead } from "@/components/dashboard-pl";
import ProcurementDashboard from "@/components/procurement/procurement-dashboard";
import { UserContext } from "@/utils/auth/UserProvider";
import { useUserData } from "@/hooks/useUserData";
import { RocketIcon } from "@radix-ui/react-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sidebar } from "../sidebar-nav";

const RoleDashboard = ({ selectedValue }) => {
    const { logout } = useContext(UserContext);
    const userData = useUserData();

    return (
        <>
            <div className="flex">
                {/* <Sidebar className="w-64" /> */}
                <div className="flex-1 p-4">
                    {selectedValue === 'default' && <Default />}
                    {selectedValue === 'Project_Manager' && <ProjectManager />}
                    {selectedValue === 'Project_Lead' && <ProjectLead />}
                    {selectedValue === 'Procurement_Executive' && <ProcurementDashboard />}

                    {(userData.has_project === "false" && !["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Accountant Profile"].includes(userData.role)) ? (
                        <Alert className="ml-[25%] w-[50%] mt-[15%]">
                            <RocketIcon className="h-4 w-4" />
                            <AlertTitle>Sorry !!!</AlertTitle>
                            <AlertDescription className="flex justify-between">
                                You are not assigned to any project.
                                <Button onClick={logout}>Log Out</Button>
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <>
                            {userData.role === 'Nirmaan Project Manager Profile' && <ProjectManager />}
                            {userData.role === 'Nirmaan Project Lead Profile' && <ProjectLead />}
                            {userData.role === 'Nirmaan Procurement Executive Profile' && <ProcurementDashboard />}
                        </>
                    )}
                </div>
            </div>
        </>
    );
};

export default RoleDashboard;
