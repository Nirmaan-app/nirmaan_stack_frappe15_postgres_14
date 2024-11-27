import { FileUser, HardHat, ShoppingCart, Truck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";

function DashboardCard({ title, icon, onClick, className, beta = false }: any) {
    return (
        <Button
            variant="ghost"
            className={`h-[150px] w-full p-0 ${className}`}
            onClick={onClick}
        >
            <div className="flex h-full w-full flex-col justify-between p-6">
                <div className="text-left">
                    <p className="text-lg font-semibold text-white text-wrap">{title}</p>
                    {beta && <span className="text-xs text-white/70">*(beta)</span>}
                </div>
                <div className="self-end">{icon}</div>
            </div>
        </Button>
    )
}


export const ProjectManager = () => {

    const navigate = useNavigate();

    return (
        <>
            <div className="flex-1 space-y-4 p-8 max-md:p-4">
                <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
                    <DashboardCard
                        title="Create Procurement Request"
                        icon={<ShoppingCart className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/prs&milestones/procurement-requests")}
                        className="bg-red-600"
                    />
                    {/* <DashboardCard
                            title="Update Milestones"
                            icon={<Milestone className="h-8 w-8 text-white" />}
                            onClick={() => navigate("/milestone-update")}
                            className="bg-red-600"
                        /> */}
                    <DashboardCard
                        title="Update Delivery Notes"
                        icon={<Truck className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/prs&milestones/delivery-notes")}
                        className="bg-red-600"
                    />
                    <DashboardCard
                        title="Generate Daily Manpower Report"
                        icon={<HardHat className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/prs&milestones/man-power-report")}
                        className="bg-red-600"
                    />
                </div>
            </div>
        </>
    )
}

