import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { useUserData } from "@/hooks/useUserData";
import { useContext } from "react";
import { UserContext } from "@/utils/auth/UserProvider";

export function UserNav() {
    const userData = useUserData()
    const { logout } = useContext(UserContext)

    const generateFallback = (full_name: string) => {
        let names = full_name.split(" ");
        let initials = names[0].substring(0, 1).toUpperCase() + (names.length === 1 ? "" : names[1].substring(0, 1).toUpperCase());
        return initials;
    }


    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                        <AvatarImage src={userData.user_image} alt={userData.full_name} />
                        <AvatarFallback>{generateFallback(userData.full_name)}</AvatarFallback>
                    </Avatar>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                    <div className="flex">
                        <Avatar className="h-12 w-12 mr-2">
                            <AvatarImage src={userData.user_image} alt={userData.full_name} />
                            <AvatarFallback className="text-2xl">{generateFallback(userData.full_name)}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col space-y-1">
                            <p className="text-sm font-bold leading-none">{userData.full_name}</p>
                            <p className="text-xs font-light text-red-700 leading-none">{userData.role?.split(" ").slice(1, -1).join(" ")}</p>
                            <p className="text-xs font-thin leading-none text-muted-foreground">
                                {userData.user_id}
                            </p>
                        </div>
                    </div>

                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    {/* <DropdownMenuItem>
                        Profile
                        <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                        Billing
                        <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                        Settings
                        <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem>New Team</DropdownMenuItem> */}
                    <DropdownMenuItem>
                        Profile<span className="text-red-700 text-xs font-thin">(beta)</span>
                        <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                    Log out
                    <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}