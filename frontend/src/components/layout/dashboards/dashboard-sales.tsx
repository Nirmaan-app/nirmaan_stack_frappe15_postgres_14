import { ArrowUpRight, BlendIcon, FileUp, HandCoins, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useUserData } from "@/hooks/useUserData";

interface QuickLink {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const QUICK_LINKS: QuickLink[] = [
  {
    to: "/projects",
    label: "Projects",
    description: "Browse and review your projects",
    icon: BlendIcon,
  },
  {
    to: "/project-invoices",
    label: "Project Invoices",
    description: "View project invoices",
    icon: FileUp,
  },
  {
    to: "/in-flow-payments",
    label: "Project Inflows",
    description: "Track incoming project payments",
    icon: HandCoins,
  },
];

const QuickLinkCard: React.FC<{ link: QuickLink }> = ({ link }) => {
  const Icon = link.icon;
  return (
    <Link to={link.to} className="group relative block">
      <div
        className="
          relative h-[140px] overflow-hidden rounded-xl border border-rose-100
          bg-white p-5 transition-all duration-300 ease-out
          hover:border-rose-200 hover:shadow-[0_8px_30px_rgb(208,59,69,0.08)]
          dark:border-rose-900/30 dark:bg-gray-900 dark:hover:border-rose-800/50
        "
      >
        {/* Watermark icon */}
        <div
          className="
            pointer-events-none absolute -bottom-6 -right-6 opacity-[0.06]
            transition-all duration-500 ease-out
            group-hover:-bottom-4 group-hover:-right-4 group-hover:opacity-[0.12]
          "
        >
          <Icon className="h-32 w-32 text-rose-700 dark:text-rose-300" strokeWidth={1} />
        </div>

        {/* Content */}
        <div className="relative z-10 flex h-full flex-col justify-between">
          <div className="flex items-start justify-between">
            <span
              className="
                text-base font-semibold tracking-tight text-gray-900
                transition-colors duration-200 group-hover:text-rose-700
                dark:text-gray-100 dark:group-hover:text-rose-400
              "
            >
              {link.label}
            </span>
            <ArrowUpRight
              className="
                h-4 w-4 -translate-x-1 translate-y-1 text-gray-300 opacity-0
                transition-all duration-300 group-hover:translate-x-0
                group-hover:translate-y-0 group-hover:text-rose-600 group-hover:opacity-100
              "
            />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{link.description}</p>
        </div>
      </div>
    </Link>
  );
};

export const SalesDashboard = () => {
  const { full_name } = useUserData();

  return (
    <div className="flex-1 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Welcome{full_name ? `, ${full_name}` : ""}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Quick access to your projects and payments
        </p>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_LINKS.map((link) => (
          <QuickLinkCard key={link.to} link={link} />
        ))}
      </div>
    </div>
  );
};

export default SalesDashboard;
