import { WalletCards } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button";

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
                </div>
                <div className="self-end">{icon}</div>
            </div>
        </Button>
    )
}


export const Accountant = () => {

    const navigate = useNavigate();

    return (
        <>
            <div className="flex-1 space-y-4">
                <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
                    <DashboardCard
                        title="Project Payments"
                        icon={<WalletCards className="h-8 w-8 text-white" />}
                        onClick={() => navigate("/project-payments")}
                        className="bg-red-600"
                    />
                </div>
            </div>
        </>
    )
}
