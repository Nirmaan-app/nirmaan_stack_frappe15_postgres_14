/**
 * Role color mappings for Nirmaan Stack user management
 * Each role has a consistent color scheme used across badges, avatars, and UI elements
 */

export interface RoleColorScheme {
  bg: string;
  text: string;
  border: string;
  dot: string;
  gradient: string;
  ring: string;
}

export const ROLE_COLORS: Record<string, RoleColorScheme> = {
  "Nirmaan Admin Profile": {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    dot: "bg-red-500",
    gradient: "bg-gradient-to-br from-red-500 to-rose-600",
    ring: "ring-red-500/30",
  },
  "Nirmaan Project Lead Profile": {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-500",
    gradient: "bg-gradient-to-br from-amber-500 to-orange-600",
    ring: "ring-amber-500/30",
  },
  "Nirmaan Project Manager Profile": {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    dot: "bg-blue-500",
    gradient: "bg-gradient-to-br from-blue-500 to-indigo-600",
    ring: "ring-blue-500/30",
  },
  "Nirmaan Procurement Executive Profile": {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
    gradient: "bg-gradient-to-br from-emerald-500 to-teal-600",
    ring: "ring-emerald-500/30",
  },
  "Nirmaan Accountant Profile": {
    bg: "bg-purple-50",
    text: "text-purple-700",
    border: "border-purple-200",
    dot: "bg-purple-500",
    gradient: "bg-gradient-to-br from-purple-500 to-violet-600",
    ring: "ring-purple-500/30",
  },
  "Nirmaan Estimates Executive Profile": {
    bg: "bg-cyan-50",
    text: "text-cyan-700",
    border: "border-cyan-200",
    dot: "bg-cyan-500",
    gradient: "bg-gradient-to-br from-cyan-500 to-sky-600",
    ring: "ring-cyan-500/30",
  },
  "Nirmaan Design Executive Profile": {
    bg: "bg-pink-50",
    text: "text-pink-700",
    border: "border-pink-200",
    dot: "bg-pink-500",
    gradient: "bg-gradient-to-br from-pink-500 to-rose-600",
    ring: "ring-pink-500/30",
  },
  "Nirmaan Design Lead Profile": {
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    border: "border-indigo-200",
    dot: "bg-indigo-500",
    gradient: "bg-gradient-to-br from-indigo-500 to-purple-600",
    ring: "ring-indigo-500/30",
  },
  "Nirmaan PMO Executive Profile": {
    bg: "bg-teal-50",
    text: "text-teal-700",
    border: "border-teal-200",
    dot: "bg-teal-500",
    gradient: "bg-gradient-to-br from-teal-500 to-cyan-600",
    ring: "ring-teal-500/30",
  },
};

// Default fallback colors for unknown roles
const DEFAULT_COLORS: RoleColorScheme = {
  bg: "bg-gray-50",
  text: "text-gray-700",
  border: "border-gray-200",
  dot: "bg-gray-500",
  gradient: "bg-gradient-to-br from-gray-500 to-slate-600",
  ring: "ring-gray-500/30",
};

/**
 * Get color scheme for a role profile
 * @param roleProfile - The full role profile name (e.g., "Nirmaan Admin Profile")
 * @returns RoleColorScheme object with all color classes
 */
export function getRoleColors(roleProfile: string | undefined | null): RoleColorScheme {
  if (!roleProfile) return DEFAULT_COLORS;
  return ROLE_COLORS[roleProfile] || DEFAULT_COLORS;
}

/**
 * Get short display label for a role profile
 * @param roleProfile - The full role profile name
 * @returns Short label (e.g., "Admin", "Project Lead")
 */
export function getRoleLabel(roleProfile: string | undefined | null): string {
  if (!roleProfile) return "Unknown";
  return roleProfile
    .replace("Nirmaan ", "")
    .replace(" Profile", "");
}

/**
 * Role options for dropdowns and filters
 */
export const ROLE_OPTIONS: { label: string; value: string }[] = [
  { label: "Admin", value: "Nirmaan Admin Profile" },
  { label: "PMO Executive", value: "Nirmaan PMO Executive Profile" },
  { label: "Project Lead", value: "Nirmaan Project Lead Profile" },
  { label: "Project Manager", value: "Nirmaan Project Manager Profile" },
  { label: "Procurement Executive", value: "Nirmaan Procurement Executive Profile" },
  { label: "Accountant", value: "Nirmaan Accountant Profile" },
  { label: "Estimates Executive", value: "Nirmaan Estimates Executive Profile" },
  { label: "Design Executive", value: "Nirmaan Design Executive Profile" },
  { label: "Design Lead", value: "Nirmaan Design Lead Profile" },
];
