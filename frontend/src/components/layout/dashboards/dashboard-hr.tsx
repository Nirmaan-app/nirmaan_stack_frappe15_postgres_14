import { useFrappeGetDocCount, useFrappePostCall } from "frappe-react-sdk";
import { UsersRound, ArrowUpRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";
import { useEffect, useState } from "react";
import { getRoleColors, getRoleLabel } from "@/utils/roleColors";

// Brand primary color (rose)
const BRAND_PRIMARY = "#D03B45";

interface RoleCountPillProps {
  roleProfile: string;
  count: number;
  onClick: () => void;
}

const RoleCountPill: React.FC<RoleCountPillProps> = ({
  roleProfile,
  count,
  onClick,
}) => {
  const colors = getRoleColors(roleProfile);
  const label = getRoleLabel(roleProfile);

  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-full
        ${colors.bg} ${colors.border} border
        hover:opacity-80 transition-opacity cursor-pointer
      `}
    >
      <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
      <span className={`text-sm font-medium ${colors.text}`}>{label}</span>
      <span className={`text-sm font-semibold ${colors.text}`}>{count}</span>
    </button>
  );
};

export const HRDashboard = () => {
  const navigate = useNavigate();

  // State for role counts
  const [roleCounts, setRoleCounts] = useState<Record<string, number>>({});
  const [isLoadingRoles, setIsLoadingRoles] = useState(true);
  const [roleError, setRoleError] = useState<string | null>(null);

  // Fetch total users count
  const {
    data: usersCount,
    isLoading: usersLoading,
    error: usersError,
  } = useFrappeGetDocCount(
    "Nirmaan Users",
    undefined,
    true,
    false,
    "hr_users_count"
  );

  // Fetch role counts via API
  const { call: getUserRoleCounts } = useFrappePostCall(
    "nirmaan_stack.api.users.get_user_role_counts"
  );

  useEffect(() => {
    const fetchRoleCounts = async () => {
      try {
        setIsLoadingRoles(true);
        const result = await getUserRoleCounts({});
        setRoleCounts(result.message || {});
        setRoleError(null);
      } catch (err) {
        console.error("Failed to fetch role counts:", err);
        setRoleError("Failed to load role statistics");
        setRoleCounts({});
      } finally {
        setIsLoadingRoles(false);
      }
    };

    fetchRoleCounts();
  }, []);

  // Convert role counts object to sorted array
  const roleCountsArray = Object.entries(roleCounts)
    .map(([role_profile, count]) => ({ role_profile, count }))
    .sort((a, b) => b.count - a.count);

  // Navigate to users page with role filter
  const navigateToFilteredUsers = (roleProfile: string) => {
    const filter = [{ id: "role_profile", value: [roleProfile] }];
    const encodedFilter = btoa(JSON.stringify(filter));
    navigate(`/users?users_list_filters=${encodedFilter}`);
  };

  return (
    <div className="flex-1 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          HR Dashboard
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Team metrics and user management
        </p>
      </div>

      {/* Total Users Card */}
      <Link to="/users" className="group relative block max-w-sm">
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
            <UsersRound
              className="h-32 w-32 text-rose-700 dark:text-rose-300"
              strokeWidth={1}
            />
          </div>

          {/* Content */}
          <div className="relative z-10 flex h-full flex-col justify-between">
            <div className="flex items-start justify-between">
              <span
                className="
                  text-sm
                  font-medium
                  tracking-wide
                  text-gray-500
                  transition-colors
                  duration-200
                  group-hover:text-rose-700
                  dark:text-gray-400
                  dark:group-hover:text-rose-400
                "
              >
                Total Users
              </span>
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

            <div className="flex items-end justify-between">
              <span
                className="text-4xl font-semibold tabular-nums tracking-tight"
                style={{ color: BRAND_PRIMARY }}
              >
                {usersLoading ? (
                  <TailSpin
                    visible={true}
                    height="32"
                    width="32"
                    color={BRAND_PRIMARY}
                    ariaLabel="loading"
                    radius="1"
                  />
                ) : usersError ? (
                  "--"
                ) : (
                  usersCount ?? "--"
                )}
              </span>

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

      {/* Role Distribution Section */}
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-lg font-medium tracking-tight text-gray-700 dark:text-gray-300">
            Role Distribution
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Click on a role to view filtered users
          </p>
        </div>

        {isLoadingRoles ? (
          <div className="flex justify-center py-8">
            <TailSpin
              visible={true}
              height="32"
              width="32"
              color={BRAND_PRIMARY}
              ariaLabel="loading-roles"
              radius="1"
            />
          </div>
        ) : roleError ? (
          <p className="text-sm text-gray-400">{roleError}</p>
        ) : roleCountsArray.length === 0 ? (
          <p className="text-sm text-gray-400">No role data available</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {roleCountsArray.map((item) => (
              <RoleCountPill
                key={item.role_profile}
                roleProfile={item.role_profile}
                count={item.count}
                onClick={() => navigateToFilteredUsers(item.role_profile)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
