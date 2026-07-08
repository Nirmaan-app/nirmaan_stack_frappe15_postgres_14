import { useMemo } from "react";
import { useFrappeDocumentEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Users } from "lucide-react";
import { useUserData } from "@/hooks/useUserData";

/**
 * BoQ-level "who else is here" presence badge (Phase B2 / ADR-0011 D7).
 *
 * A SOFT AWARENESS layer -- the single-editor draft/pricing locks own correctness; this only
 * shows which OTHER users currently have this BoQ open on ANY screen (hub / config / review /
 * pricing), via Frappe-core `doc_viewers` presence (useFrappeDocumentEventListener on the
 * BOQs doc, emitOpenCloseEventsOnMount=true so THIS client also announces its presence). No
 * enforcement, no backend code. Coexists with the "being edited by X" lock banner: that names
 * the one EDITOR of a sheet; this names everyone PRESENT in the BoQ.
 *
 * MUST be mounted on every BoQ screen (not just the hub) -- a screen that does not mount the
 * listener never registers as a viewer, so its user would be invisible to everyone else.
 */

const NOOP = () => {};

export const BoqPresence = ({ boqId, className }: { boqId?: string; className?: string }) => {
  const { user_id: currentUser } = useUserData();
  // doc_viewers presence on the BOQs doc. The 4th arg (emit-open-close-on-mount) makes this
  // client appear as a viewer to others; false when boqId is absent so we never subscribe to "".
  const { viewers } = useFrappeDocumentEventListener("BOQs", boqId ?? "", NOOP, Boolean(boqId));
  // Self-contained id -> name resolution (small cached Nirmaan Users list; shared SWR cache).
  const { data: users } = useFrappeGetDocList<{ name: string; full_name?: string }>(
    "Nirmaan Users",
    { fields: ["name", "full_name"], limit: 0 },
    "boq-presence-users",
  );
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    users?.forEach((u) => map.set(u.name, u.full_name || u.name));
    return (id: string) => map.get(id) || id;
  }, [users]);

  const others = (viewers ?? []).filter((u) => u && u !== currentUser);
  if (!boqId || others.length === 0) return null;

  const names = others.map(nameOf);
  const shown =
    names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  return (
    <div
      className={
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground " +
        (className ?? "")
      }
      title={`Also in this BoQ: ${names.join(", ")}`}
    >
      <Users className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden sm:inline">Also here:</span>
      <span className="font-medium text-foreground truncate max-w-[180px]">{shown}</span>
    </div>
  );
};
