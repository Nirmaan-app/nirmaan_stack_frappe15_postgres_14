// One sidebar entry ("Inventory / Warehouse"), two tabs. Each tab is a real route, /inventory and
// /warehouse, so old links, bookmarks and the browser's back button keep working; this
// layout only draws the tab strip above whichever page matched. The sidebar keeps the
// entry highlighted on both through `groupMappings['/inventory']` in NewSidebar.tsx.
//
// The strip also carries the module's ONE transfer button, "Create Internal Transfer Memo",
// on both tabs. It replaced the Inventory page's own button and the Warehouse page's
// "Request from Warehouse"; the New Transfer page asks for the direction and offers each
// role only its own (utils/itmTransfer.ts `allowedTransferDirections`).

import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ArrowLeftRight, Package, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUserData } from "@/hooks/useUserData";
import { allowedTransferDirections } from "@/utils/itmTransfer";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/inventory", label: "Inventory", icon: Warehouse },
  { to: "/warehouse", label: "Warehouse", icon: Package },
] as const;

const InventoryWarehouseLayout = () => {
  const navigate = useNavigate();
  const { role, user_id } = useUserData();
  // Shown to anyone allowed at least one direction; the page offers only those.
  const canTransfer = allowedTransferDirections(role, user_id).length > 0;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4">
        <nav aria-label="Inventory sections" className="flex gap-1 self-end">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "-mb-px inline-flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        {canTransfer && (
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => navigate("/internal-transfer-memos/create")}
          >
            <ArrowLeftRight className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Create Internal Transfer Memo</span>
            <span className="sm:hidden">New Transfer</span>
          </Button>
        )}
      </div>
      <Outlet />
    </div>
  );
};

export default InventoryWarehouseLayout;
