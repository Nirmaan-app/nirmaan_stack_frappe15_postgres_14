// import { useState,useContext, useEffect } from "react";
// import { Default } from "@/components/dashboard-default"
// import { ProjectManager } from "@/components/dashboard-pm"
// import { ProjectLead } from "@/components/dashboard-pl"
// import { useUserData } from "@/hooks/useUserData";
// import ProcurementDashboard from "@/components/procurement/procurement-dashboard";
// import { MainLayout } from "@/components/layout/main-layout";
// import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
// import { useFrappeGetDocList } from "frappe-react-sdk";

// import { Default } from "@/components/dashboard-default";
// import { useUserData } from "@/hooks/useUserData";

// import { RocketIcon } from "@radix-ui/react-icons"
 
// import {
//   Alert,
//   AlertDescription,
//   AlertTitle,
// } from "@/components/ui/alert"
// import { Button } from "@/components/ui/button";
// import { UserContext } from "@/utils/auth/UserProvider";


// export default function Dashboard() {

//     const { logout } = useContext(UserContext)

//     const [selectedValue, setSelectedValue] = useState<string>('');

//     const handleButtonClick = (value: string) => {
//         setSelectedValue(value);
//     };

//     const userData = useUserData()

//     useEffect(()=>{
//         if((userData.user_id == "Administrator" || userData.role == "Nirmaan Admin Profile") && selectedValue === ''){
//             setSelectedValue("default")
//         }
//     },[userData])

//     return (
//         <>
//             {(userData.user_id == "Administrator" || userData.role == "Nirmaan Admin Profile") && <div className="flex flex-col justify-center">
//                 <div className="flex space-y-2 justify-center bg-red-100 pb-2">
//                     <h1 className="pt-4 pl-12 pr-10 text-xl font-bold text-red-500 hidden md:flex">Role Selector:</h1>
//                     <Tabs className="min-h-[50]">
//                         <TabsList>
//                             <TabsTrigger value="default" onClick={() => handleButtonClick('default')}>Admin</TabsTrigger>
//                             <TabsTrigger value="Project_Manager" className="hidden md:flex" onClick={() => handleButtonClick('Project_Manager')}>Project Manager</TabsTrigger>
//                             <TabsTrigger value="Project_Lead" className="hidden md:flex" onClick={() => handleButtonClick('Project_Lead')}>Project Lead</TabsTrigger>
//                             <TabsTrigger value="Procurement_Executive" className="hidden md:flex" onClick={() => handleButtonClick('Procurement_Executive')}>Procurement Executive</TabsTrigger>
//                             <TabsTrigger value="Project_Manager_mobile" className="md:hidden" onClick={() => handleButtonClick('Project_Manager')}>Proj.Man</TabsTrigger>
//                             <TabsTrigger value="Project_Lead_mobile" className="md:hidden" onClick={() => handleButtonClick('Project_Lead')}>Proj.Lead</TabsTrigger>
//                             <TabsTrigger value="Procurement_Executive_mobile" className="md:hidden" onClick={() => handleButtonClick('Procurement_Executive')}>Proc.Exec</TabsTrigger>
//                         </TabsList>
//                     </Tabs>
//                 </div>
//             </div>}
//             {selectedValue == 'default' && <Default />}
//             {selectedValue == 'Project_Manager' && <ProjectManager />}
//             {selectedValue == 'Project_Lead' && <ProjectLead />}
//             {selectedValue == 'Procurement_Executive' && <ProcurementDashboard />}


//             {/* {userData.role == 'Nirmaan Admin' && <Default />} */}
//             {(userData.has_project === "false" && userData.role !== "Nirmaan Admin Profile") ? 
//             <Alert className="ml-[25%] w-[50%] mt-[15%]">
//                 <RocketIcon className="h-4 w-4" />
//                 <AlertTitle>Sorry !!!</AlertTitle>
//                 <AlertDescription className="flex justify-between">
//                     You are not Assigned to any project.
//                     <Button onClick={logout}>Log Out</Button>
//                 </AlertDescription>
//             </Alert>
//              : 
//              <>{userData.role == 'Nirmaan Project Manager Profile' && <ProjectManager />}
//              {userData.role == 'Nirmaan Project Lead Profile' && <ProjectLead />}
//              {userData.role == 'Nirmaan Procurement Executive Profile' && <ProcurementDashboard />}
//              </>
//             }   
//         </>
//     )
// }


import { RocketIcon } from "@radix-ui/react-icons"
 
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button";
import { useUserData } from "@/hooks/useUserData";
import { Default } from "@/components/dashboard-default";
import { useContext } from "react";
import { UserContext } from "@/utils/auth/UserProvider";
import { ProjectManager } from "@/components/dashboard-pm";
import ProcurementDashboard from "@/components/procurement/procurement-dashboard";
import { EstimatesExecutive } from "@/components/estimates-executive-dashboard";
import { ProjectLead } from "@/components/dashboard-pl";

export default function Dashboard() { 

    const {role, has_project, user_id} = useUserData()
    const { logout } = useContext(UserContext)


    return (
        <>

          {(role == 'Nirmaan Admin Profile' || user_id === "Administrator") && <Default />} 
            {(has_project === "false" && role !== "Nirmaan Admin Profile") ? 
            <Alert className="flex flex-col max-md:w-[80%] max-lg:w-[60%] w-[50%] mx-auto justify-center max-md:mt-[40%] mt-[20%]">
              <div className="flex gap-2 items-center">
                <RocketIcon className="h-4 w-4" />
                <AlertTitle>Oops !!!</AlertTitle>
                </div>

                <AlertDescription className="flex justify-between items-center">
                    You are not Assigned to any project.
                    <Button onClick={logout}>Log Out</Button>
                </AlertDescription>
            </Alert>
             : 
             <>{role == 'Nirmaan Project Manager Profile' && <ProjectManager />}
             {role == 'Nirmaan Project Lead Profile' && <ProjectLead />}
             {role == 'Nirmaan Procurement Executive Profile' && <ProcurementDashboard />}
             {role == 'Nirmaan Estimates Executive Profile' && <EstimatesExecutive />}
             </>
            }   
            </>
    )

}