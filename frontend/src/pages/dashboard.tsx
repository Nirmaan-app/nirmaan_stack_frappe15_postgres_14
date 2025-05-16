import { RocketIcon } from "@radix-ui/react-icons";

import { Accountant } from "@/components/layout/dashboards/dashboard-accountant";
import DefaultDashboard from "@/components/layout/dashboards/dashboard-default";
import { ProjectLead } from "@/components/layout/dashboards/dashboard-pl";
import { ProjectManager } from "@/components/layout/dashboards/dashboard-pm";
import { EstimatesExecutive } from "@/components/layout/dashboards/estimates-executive-dashboard";
import ProcurementDashboard from "@/components/layout/dashboards/procurement-dashboard";
import {
    Alert,
    AlertDescription,
    AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useUserData } from "@/hooks/useUserData";
import { UserContext } from "@/utils/auth/UserProvider";
import { useContext } from "react";

export default function Dashboard() {

    const { role, has_project } = useUserData()
    const { logout } = useContext(UserContext)


    return (
        <>

            {(role === 'Nirmaan Admin Profile') && <DefaultDashboard />}
            {(has_project === "false" && !["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile"].includes(role)) ?
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
                <>{role === 'Nirmaan Project Manager Profile' && <ProjectManager />}
                    {role === 'Nirmaan Project Lead Profile' && <ProjectLead />}
                    {role === 'Nirmaan Procurement Executive Profile' && <ProcurementDashboard />}
                    {role === 'Nirmaan Estimates Executive Profile' && <EstimatesExecutive />}
                    {role === 'Nirmaan Accountant Profile' && <Accountant />}
                </>
            }
        </>
    )

}