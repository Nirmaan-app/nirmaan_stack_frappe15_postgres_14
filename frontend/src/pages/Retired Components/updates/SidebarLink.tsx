import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SidebarLinkProps {
    to: string;
    label: string;
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
}

const SidebarLink = ({ to, label, icon, isActive, onClick }: SidebarLinkProps) => {
    return (
        <Link to={to} onClick={onClick}>
            <Button
                variant="ghost"
                size="sm"
                className={cn("w-full justify-start", { "bg-red-400": isActive })}
            >
                {icon}
                <span className={cn({ "text-white": isActive })}>{label}</span>
            </Button>
        </Link>
    );
};

export default SidebarLink;
