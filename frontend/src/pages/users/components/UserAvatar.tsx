import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getRoleColors } from "@/utils/roleColors";

interface UserAvatarProps {
  fullName: string | undefined | null;
  roleProfile?: string | undefined | null;
  imageUrl?: string | undefined | null;
  size?: "sm" | "md" | "lg" | "xl";
  showRing?: boolean;
  className?: string;
}

/**
 * Enhanced user avatar with role-based gradient backgrounds
 * Shows initials when no image is available, with colors matching the user's role
 */
export function UserAvatar({
  fullName,
  roleProfile,
  imageUrl,
  size = "md",
  showRing = true,
  className,
}: UserAvatarProps) {
  const colors = getRoleColors(roleProfile);

  // Generate initials from full name
  const initials = fullName
    ? fullName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  const sizeClasses = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-16 w-16 text-xl",
    xl: "h-20 w-20 text-2xl",
  };

  const ringClasses = {
    sm: "ring-2 ring-offset-1",
    md: "ring-2 ring-offset-2",
    lg: "ring-[3px] ring-offset-2",
    xl: "ring-[3px] ring-offset-2",
  };

  return (
    <Avatar
      className={cn(
        sizeClasses[size],
        showRing && ringClasses[size],
        showRing && colors.ring,
        "ring-offset-background",
        className
      )}
    >
      {imageUrl && <AvatarImage src={imageUrl} alt={fullName || "User"} />}
      <AvatarFallback
        className={cn(
          colors.gradient,
          "text-white font-semibold"
        )}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Compact avatar for table rows and lists
 */
export function UserAvatarCompact({
  fullName,
  roleProfile,
  className,
}: Pick<UserAvatarProps, 'fullName' | 'roleProfile' | 'className'>) {
  return (
    <UserAvatar
      fullName={fullName}
      roleProfile={roleProfile}
      size="sm"
      showRing={false}
      className={className}
    />
  );
}
