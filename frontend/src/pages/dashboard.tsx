import { Accountant } from "@/components/layout/dashboards/dashboard-accountant";
import DefaultDashboard from "@/components/layout/dashboards/dashboard-default";
import { HRDashboard } from "@/components/layout/dashboards/dashboard-hr";
import { ProjectLead } from "@/components/layout/dashboards/dashboard-pl";
import { ProjectManager } from "@/components/layout/dashboards/dashboard-pm";
import { EstimatesExecutive } from "@/components/layout/dashboards/estimates-executive-dashboard";
import { BillingExecutive } from "@/components/layout/dashboards/billing-executive-dashboard";
import ProcurementDashboard from "@/components/layout/dashboards/procurement-dashboard";
import ServiceProcurementDashboard from "@/components/layout/dashboards/service-procurement-dashboard";
import { DesignDashboard } from "@/components/layout/dashboards/design-dashboard";
import { SalesDashboard } from "@/components/layout/dashboards/dashboard-sales";
import { useUserData } from "@/hooks/useUserData";
import { isProcurementProfile, SERVICE_PROCUREMENT_EXECUTIVE_PROFILE } from "@/constants/roles";


export default function Dashboard() {

    const { role, has_project } = useUserData();
    // Sentry's user is set in the main layout (`useSentryUser`), for every page -- a locked user never gets here.

    console.log("Role",role,has_project)
    return (
        <>

            {/* "No project assigned" is no longer an alert here: the app access gate (utils/appAccess.ts) shows its
                card on this page before any of these dashboards render. */}
            {(role === 'Nirmaan Admin Profile' || role === 'Nirmaan PMO Executive Profile') && <DefaultDashboard />}
            {role === 'Nirmaan Project Manager Profile' && <ProjectManager />}
            {role === 'Nirmaan Project Lead Profile' && <ProjectLead />}
            {isProcurementProfile(role) && role !== SERVICE_PROCUREMENT_EXECUTIVE_PROFILE && <ProcurementDashboard />}
            {role === SERVICE_PROCUREMENT_EXECUTIVE_PROFILE && <ServiceProcurementDashboard />}
            {role === 'Nirmaan Estimates Executive Profile' && <EstimatesExecutive />}
            {role === 'Nirmaan Billing Executive Profile' && <BillingExecutive />}
            {(role === 'Nirmaan Accountant Profile' || role === 'Nirmaan Accountant Lead Profile') && <Accountant />}
            {(role === "Nirmaan Design Lead Profile" || role === "Nirmaan Design Executive Profile") && <DesignDashboard />}
            {role === "Nirmaan HR Executive Profile" && <HRDashboard />}
            {(role === "Nirmaan Sales Executive Profile" || role === "Nirmaan Sales Lead Profile") && <SalesDashboard />}
        </>
    )

}