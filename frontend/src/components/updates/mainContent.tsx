// import RoleDashboard from "./RoleDashboard";
// import RoleSelector from "./RoleSelector";

// // export default function Content () {


// //     return (
// //         <RoleSelector  />

// //         <RoleDashboard />
// //     )
// // }

// import { useState, useContext } from "react";

// import { UserContext } from "@/utils/auth/UserProvider";
// import { useUserData } from "@/hooks/useUserData";

// export default function MainContent() {
//     const [selectedValue, setSelectedValue] = useState<string>('');
//     const userData = useUserData();

//     return (
//         <>
//             <RoleSelector selectedValue={selectedValue} setSelectedValue={setSelectedValue} />
//             <RoleDashboard selectedValue={selectedValue} />
//         </>
//     );
// }


import { useState } from "react";
import RoleSelector from "./RoleSelector";
import RoleDashboard from "./RoleDashboard";

const MainContent = () => {
    const [selectedValue, setSelectedValue] = useState("");

    return (
        <>
            {/* <RoleSelector selectedValue={selectedValue} setSelectedValue={setSelectedValue} />
            <RoleDashboard selectedValue={selectedValue} /> */}
        </>
    );
};

export default MainContent;
// const MainContent = () => {
//     return (
//         <div>
//             <h1 className="text-2xl font-bold">Welcome to the Admin Dashboard</h1>
//             {/* Add default admin content here */}
//         </div>
//     );
// };

// export default MainContent;

