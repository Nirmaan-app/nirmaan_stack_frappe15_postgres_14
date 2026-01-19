import { PencilRuler, ArrowUpRight, LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

// ============================================================================
// Types & Configuration
// ============================================================================

interface DashboardMetric {
  id: string;
  title: string;
  description: string;
  linkTo: string;
  Icon: LucideIcon;
}

const DESIGN_METRICS: DashboardMetric[] = [
  {
    id: "design-tracker",
    title: "Design Tracker",
    description: "Track design progress",
    linkTo: "/design-tracker",
    Icon: PencilRuler,
  },
];

// ============================================================================
// Components
// ============================================================================

interface MetricCardProps {
  title: string;
  description: string;
  linkTo: string;
  Icon: LucideIcon;
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  description,
  linkTo,
  Icon,
}) => {
  return (
    <Link to={linkTo} className="group relative block">
      <div
        className="
          relative
          h-[140px]
          overflow-hidden
          rounded-xl
          border
          border-rose-100
          bg-white
          p-5
          transition-all
          duration-300
          ease-out
          hover:border-rose-200
          hover:shadow-[0_8px_30px_rgb(208,59,69,0.08)]
          dark:border-rose-900/30
          dark:bg-gray-900
          dark:hover:border-rose-800/50
        "
      >
        {/* Watermark Icon */}
        <div
          className="
            pointer-events-none
            absolute
            -bottom-6
            -right-6
            opacity-[0.06]
            transition-all
            duration-500
            ease-out
            group-hover:-bottom-4
            group-hover:-right-4
            group-hover:opacity-[0.12]
          "
        >
          <Icon
            className="h-32 w-32 text-rose-700 dark:text-rose-300"
            strokeWidth={1}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 flex h-full flex-col justify-between">
          {/* Top Section */}
          <div className="flex items-start justify-between">
            <div className="space-y-0.5">
              <span
                className="
                  text-sm
                  font-medium
                  tracking-wide
                  text-gray-600
                  transition-colors
                  duration-200
                  group-hover:text-rose-700
                  dark:text-gray-400
                  dark:group-hover:text-rose-400
                "
              >
                {title}
              </span>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {description}
              </p>
            </div>
            <ArrowUpRight
              className="
                h-4
                w-4
                -translate-x-1
                translate-y-1
                text-gray-300
                opacity-0
                transition-all
                duration-300
                group-hover:translate-x-0
                group-hover:translate-y-0
                group-hover:text-rose-600
                group-hover:opacity-100
              "
            />
          </div>

          {/* Bottom Section */}
          <div className="flex items-end justify-end">
            {/* Subtle indicator line */}
            <div
              className="
                mb-2
                h-[2px]
                w-0
                rounded-full
                bg-rose-500
                transition-all
                duration-300
                group-hover:w-8
              "
            />
          </div>
        </div>
      </div>
    </Link>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const DesignDashboard = () => {
  return (
    <div className="flex-1 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Design Dashboard
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Design tracking and project visualization
        </p>
      </div>

      {/* Cards Grid */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {DESIGN_METRICS.map((metric) => (
          <MetricCard
            key={metric.id}
            title={metric.title}
            description={metric.description}
            linkTo={metric.linkTo}
            Icon={metric.Icon}
          />
        ))}
      </div>
    </div>
  );
};
