import {
  BlendIcon,
  Calendar,
  ClipboardCheck,
  ClipboardMinus,
  ClipboardPlus,
  Milestone,
  HandPlatter,
  ShoppingCart,
  Truck,
  PencilRuler,
  Package,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface DashboardCardProps {
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary";
  beta?: boolean;
}

function DashboardCard({
  title,
  icon,
  onClick,
  variant = "primary",
  beta = false
}: DashboardCardProps) {
  const colors = {
    primary: {
      bg: "bg-gradient-to-br from-red-600 to-red-700",
      hover: "hover:from-red-700 hover:to-red-800"
    },
    secondary: {
      bg: "bg-gradient-to-br from-blue-600 to-blue-700",
      hover: "hover:from-blue-700 hover:to-blue-800"
    }
  };

  return (
    <button
      onClick={onClick}
      className={`
        group relative overflow-hidden rounded-xl
        ${colors[variant].bg} ${colors[variant].hover}
        transition-all duration-300 ease-out
        hover:shadow-xl hover:scale-[1.02]
        active:scale-[0.98]
        w-full h-full
      `}
    >
      {/* Subtle pattern overlay */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,.1) 10px, rgba(255,255,255,.1) 20px)`
        }}
      />

      <div className="relative p-5 h-full flex flex-col justify-between min-h-[140px]">
        {/* Title section */}
        <div className="text-left">
          <h3 className="text-white font-semibold text-base leading-snug mb-1">
            {title}
          </h3>
          {beta && (
            <span className="inline-block text-[10px] font-medium text-white/70 bg-white/20 px-2 py-0.5 rounded">
              BETA
            </span>
          )}
        </div>

        {/* Icon section */}
        <div className="flex justify-end">
          <div className="text-white/90 transition-transform duration-300 group-hover:scale-110">
            {icon}
          </div>
        </div>
      </div>
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-gray-800">
        {title}
      </h2>
      <div className="mt-1.5 h-0.5 w-16 bg-gradient-to-r from-red-600 to-transparent rounded-full" />
    </div>
  );
}

export const ProjectManager = () => {
  const navigate = useNavigate();

  return (
    <div className="flex-1 p-6 md:p-8 space-y-8 bg-gray-50/50">
      {/* Quick Actions Section */}
      <section>
        <SectionHeader title="Quick Actions" />

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <DashboardCard
            title="Create Procurement Request"
            icon={<ShoppingCart className="h-8 w-8" strokeWidth={1.5} />}
            onClick={() => navigate("/prs&milestones/procurement-requests")}
            variant="primary"
          />
          <DashboardCard
            title="Daily Progress Report"
            icon={<Milestone className="h-8 w-8" strokeWidth={1.5} />}
            onClick={() => navigate("/prs&milestones/milestone-report")}
            variant="primary"
          />
          <DashboardCard
            title="Delivery Notes"
            icon={<Truck className="h-8 w-8" strokeWidth={1.5} />}
            onClick={() => navigate("/prs&milestones/delivery-notes")}
            variant="primary"
          />
          <DashboardCard
            title="Upload Delivery Challans & MIR"
            icon={<ClipboardPlus className="h-8 w-8" strokeWidth={1.5} />}
            onClick={() => navigate("/prs&milestones/delivery-challans-and-mirs")}
            variant="primary"
          />
        </div>
      </section>

      {/* Other Options Section */}
      <section>
        <SectionHeader title="Other Options" />

        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-6">
          <DashboardCard
            title="Projects"
            icon={<BlendIcon className="h-7 w-7" strokeWidth={1.5} />}
            onClick={() => navigate("/projects")}
            variant="secondary"
          />
          <DashboardCard
            title="View Work Orders"
            icon={<HandPlatter className="h-7 w-7" strokeWidth={1.5} />}
            onClick={() => navigate("/service-requests-list")}
            variant="secondary"
          />
          {/* <DashboardCard
            title="Item Price Search"
            icon={<Dices className="h-7 w-7" strokeWidth={1.5} />}
            onClick={() => navigate("/item-price")}
            variant="secondary"
          /> */}
          <DashboardCard
            title="Reports"
            icon={<ClipboardMinus className="h-7 w-7" strokeWidth={1.5} />}
            onClick={() => navigate("/reports")}
            variant="secondary"
          />
          <DashboardCard
            title="Design Tracker"
            icon={<PencilRuler className="h-7 w-7" strokeWidth={1.5} />}
            onClick={() => navigate("/design-tracker")}
            variant="secondary"
          />
          <DashboardCard
            title="PO Tracker"
            icon={<ClipboardCheck className="h-7 w-7" strokeWidth={1.5} />}
            onClick={() => navigate("/critical-po-tracker")}
            variant="secondary"
          />
          <DashboardCard
            title="Work Plan Tracker"
            icon={<Calendar className="h-7 w-7" strokeWidth={1.5} />}
            onClick={() => navigate("/work-plan-tracker")}
            variant="secondary"
          />
          <DashboardCard
            title="Material Plan"
            icon={<Package className="h-7 w-7" strokeWidth={1.5} />}
            onClick={() => navigate("/material-plan-tracker")}
            variant="secondary"
          />
        </div>
      </section>
    </div>
  );
};
