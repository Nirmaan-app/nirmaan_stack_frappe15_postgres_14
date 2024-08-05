// import { useState, useEffect, useContext } from "react";
// import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
// import { UserContext } from "@/utils/auth/UserProvider";
// import { useUserData } from "@/hooks/useUserData";
// import { NavBar } from "../nav/nav-bar";

// const RoleSelector = ({ selectedValue, setSelectedValue }) => {
//     const userData = useUserData();
    
//     const handleButtonClick = (value : string) => {
//         setSelectedValue(value);
//     };

//     useEffect(() => {
//         if ((userData.user_id === "Administrator" || userData.role === "Nirmaan Admin Profile") && selectedValue === '') {
//             setSelectedValue("default");
//         }
//     }, [userData]);

//     return (
//         <>
//         {(userData.user_id === "Administrator" || userData.role === "Nirmaan Admin Profile") && (
//             <div className="flex flex-col justify-center">
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
//             </div>
//         )}

//         <NavBar />
//         </>
//     );
// };

// export default RoleSelector;


import { useState, useEffect, useContext } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserContext } from "@/utils/auth/UserProvider";
import { useUserData } from "@/hooks/useUserData";
import { NavBar } from "../nav/nav-bar";

const RoleSelector = ({ selectedValue, setSelectedValue }) => {
    const userData = useUserData();
    
    const handleButtonClick = (value) => {
        setSelectedValue(value);
    };


    useEffect(() => {
        if ((userData.user_id === "Administrator" || userData.role === "Nirmaan Admin Profile") && selectedValue === '') {
            setSelectedValue("default");
        }
    }, []);

    return (
        <>
        {(userData.user_id === "Administrator" || userData.role === "Nirmaan Admin Profile") && (
            <div className="flex flex-col justify-center">
                <div className="flex space-y-2 justify-center bg-red-100 pb-2">
                    <h1 className="pt-4 pl-12 pr-10 text-xl font-bold text-red-500 hidden md:flex">Role Selector:</h1>
                    <Tabs className="min-h-[50]">
                        <TabsList>
                            <TabsTrigger value="default" onClick={() => handleButtonClick('default')}>Admin</TabsTrigger>
                            <TabsTrigger value="Project_Manager" className="hidden md:flex" onClick={() => handleButtonClick('Project_Manager')}>Project Manager</TabsTrigger>
                            <TabsTrigger value="Project_Lead" className="hidden md:flex" onClick={() => handleButtonClick('Project_Lead')}>Project Lead</TabsTrigger>
                            <TabsTrigger value="Procurement_Executive" className="hidden md:flex" onClick={() => handleButtonClick('Procurement_Executive')}>Procurement Executive</TabsTrigger>
                            <TabsTrigger value="Project_Manager_mobile" className="md:hidden" onClick={() => handleButtonClick('Project_Manager')}>Proj.Man</TabsTrigger>
                            <TabsTrigger value="Project_Lead_mobile" className="md:hidden" onClick={() => handleButtonClick('Project_Lead')}>Proj.Lead</TabsTrigger>
                            <TabsTrigger value="Procurement_Executive_mobile" className="md:hidden" onClick={() => handleButtonClick('Procurement_Executive')}>Proc.Exec</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
            </div>
        )}

        <NavBar />
        </>
    );
};

export default RoleSelector;

