import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { useUserData } from "@/hooks/useUserData";
import { useContext } from "react";
import { UserContext } from "@/utils/auth/UserProvider";
import { useLocation, useNavigate } from "react-router-dom";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { BadgeCheck, Bell, ChevronsUpDown, HelpCircle, LogOut } from "lucide-react";
import { Notifications } from "./notifications";

export function UserNav({ isMobileMain = false }) {
  const userData = useUserData();
  const { logout } = useContext(UserContext);
  const navigate = useNavigate();
  const location = useLocation();

  const { isMobile, state, toggleSidebar } = useSidebar();

  const generateFallback = (full_name: string) => {
    let names = full_name.split(" ");
    let initials =
      names[0].substring(0, 1).toUpperCase() +
      (names.length === 1 ? "" : names[1].substring(0, 1).toUpperCase());
    return initials;
  };

  const handleProfileClick = () => {
    if (userData.user_id === "Administrator") {
      alert("Admin does not has a profile page");
    } else {
      if (isMobile && !isMobileMain) {
        toggleSidebar();
      }
      navigate(`/users/${userData.user_id}`);
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className={`${location.pathname === "/help-repository" ? "bg-[#FFD3CC]" : ""}`}
          onClick={() => {
            if (isMobile && !isMobileMain) toggleSidebar();
            navigate("/help-repository");
          }}
          tooltip="Help"
        >
          <div className="flex gap-4 ml-1 items-center">
            <HelpCircle className="relative max-md:w-5 max-md:h-5" />
            <span className="font-medium">Help</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>{!isMobileMain && <Notifications />}</SidebarMenuItem>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* {!isMobileMain ? ( */}
            <SidebarMenuButton
              size="lg"
              className={`data-[state=open]:bg-[#FFD3CC] data-[state=open]:text-sidebar-accent-foreground`}
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage
                  src={userData.user_image}
                  alt={userData.full_name}
                />
                <AvatarFallback
                  className={`rounded-lg ${
                    state === "collapsed" && "bg-transparent"
                  }`}
                >
                  {generateFallback(userData.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {userData.full_name}
                </span>
                <span className="truncate text-xs">{userData.user_id}</span>
              </div>
              <ChevronsUpDown className="ml-auto mr-2 size-4" />
            </SidebarMenuButton>
            {/* ) : (
               <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                 <Avatar className="h-8 w-8">
                   <AvatarImage
                     src={userData.user_image}
                     alt={userData.full_name}
                   />
                   <AvatarFallback>
                     {generateFallback(userData.full_name)}
                   </AvatarFallback>
                 </Avatar>
               </Button>
             )} */}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage
                    src={userData.user_image}
                    alt={userData.full_name}
                  />
                  <AvatarFallback className="rounded-lg">
                    {generateFallback(userData.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {userData.full_name}
                  </span>
                  <span className="truncate text-xs">{userData.user_id}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={handleProfileClick}
                className="flex gap-1 items-center cursor-pointer"
              >
                <BadgeCheck className="w-4 h-4" />
                Profile
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={logout}
              className="flex gap-1 items-center cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
