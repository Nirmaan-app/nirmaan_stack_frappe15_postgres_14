import * as React from "react";
import { useFrappeGetDoc } from "frappe-react-sdk";
import {
  Camera,
  CheckCircle,
  ImageOff,
  Loader2,
  MapPin,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";

import CameraCapture from "@/components/CameraCapture";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import { usePermissionCheck } from "@/pages/Manpower-and-WorkMilestones/hooks/usePermissionCheck";
import { locationAddress } from "@/utils/snagPhoto";

import {
  SnagPhotoDraft,
  draftFromCamera,
  draftFromUpload,
} from "../photo/snagPhotoCapture";

export interface SnagPhotoFieldProps {
  /** The stored photo (`Project Snag.attachment`), or null. */
  storedUrl: string | null;
  storedLocation: string | null;
  /** A new photo picked in this dialog, not yet uploaded. Owned by the dialog. */
  draft: SnagPhotoDraft | null;
  onDraftChange: (draft: SnagPhotoDraft | null) => void;
  /**
   * The stored photo is marked for removal. Presence of `onRemovedChange` IS the gate: only
   * the Edit dialog passes it, and only for a snag that is NOT Completed (a Completed snag
   * must keep its photo). A Project Manager, who has only the status dialog, never removes one.
   */
  removed?: boolean;
  onRemovedChange?: (removed: boolean) => void;
  /** "Required" beside the label — the dialog decides, from the status. */
  required?: boolean;
  disabled?: boolean;
}

/**
 * ONE photo slot (owner 2026-10-08: a snag holds one photo). Shows what the snag will have
 * after Save — the new photo, the stored one, or nothing — with Take photo / Upload to set or
 * replace it.
 *
 * The two buttons are not two ways of doing the same thing: Take photo records where the
 * phone is at capture, an Upload carries NO location (owner 2026-10-08). Take photo follows
 * DPR's permission handling (`usePermissionCheck`, as in `PhotoPermissionChecker`): it opens
 * only once BOTH camera and location are allowed, so the capture always gets its GPS; until
 * then the Camera / Location steps ask the browser for each.
 *
 * Nothing uploads here: the draft goes to the dialog, which uploads it on Save, so a
 * cancelled dialog leaves no file behind.
 */
export const SnagPhotoField: React.FC<SnagPhotoFieldProps> = ({
  storedUrl,
  storedLocation,
  draft,
  onDraftChange,
  removed = false,
  onRemovedChange,
  required = false,
  disabled = false,
}) => {
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  // The same Google key DPR's camera uses. A Single, readable by every snag role.
  const { data: mapApi } = useFrappeGetDoc<{ api_key?: string }>("Map API", "Map API");
  const apiKey = mapApi?.api_key;
  // DPR's camera + location permission state (Permissions API, kept live).
  const { cameraStatus, locationStatus, checkCamera, checkLocation } = usePermissionCheck();
  const cameraReady = cameraStatus === "granted" && locationStatus === "granted";
  const blocked = cameraStatus === "denied" || locationStatus === "denied";

  // The draft's object URL is released when it is replaced or the dialog closes.
  const previewUrl = draft?.previewUrl;
  React.useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  const take = async (make: () => Promise<SnagPhotoDraft>) => {
    setBusy(true);
    try {
      onDraftChange(await make());
      onRemovedChange?.(false);
    } catch (e) {
      toast({
        title: "Photo not added",
        description: e instanceof Error ? e.message : "The photo could not be read.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same file again must fire again
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Not an image", description: "Choose a photo file.", variant: "destructive" });
      return;
    }
    void take(() => draftFromUpload(file));
  };

  const shownUrl = draft?.previewUrl ?? (removed ? null : storedUrl ? `${SITEURL}${storedUrl}` : null);
  const shownLocation = draft ? draft.location : removed ? null : storedLocation;
  const hasPhoto = Boolean(shownUrl);
  const address = locationAddress(shownLocation);
  const locationLine = shownLocation
    ? `${draft?.source === "camera" ? "Taken here" : "Location"}: ${address}`
    : "Location not available";

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium">
        Photo{" "}
        <span className="font-normal text-muted-foreground">
          {required ? "(required to complete)" : "(optional)"}
        </span>
      </div>

      <div className="flex items-start gap-3 rounded-md border px-3 py-2">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : shownUrl ? (
            <img src={shownUrl} alt="Snag photo" className="h-full w-full object-cover" />
          ) : (
            <ImageOff className="h-5 w-5 text-muted-foreground" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          {hasPhoto ? (
            <p
              className={cn(
                "flex items-start gap-1 text-[11px]",
                shownLocation ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <MapPin className="mt-px h-3 w-3 shrink-0" />
              <span className="break-words">{locationLine}</span>
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {removed ? "The photo will be removed when you save." : "No photo yet."}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={disabled || busy || !cameraReady}
              title={cameraReady ? undefined : "Allow camera and location first"}
              onClick={() => setCameraOpen(true)}
            >
              <Camera className="mr-1 h-3.5 w-3.5" /> {hasPhoto ? "Replace photo" : "Take photo"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={disabled || busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="mr-1 h-3.5 w-3.5" /> {hasPhoto ? "Re-upload" : "Upload"}
            </Button>
            {draft && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={disabled || busy}
                onClick={() => onDraftChange(null)}
              >
                <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo
              </Button>
            )}
            {onRemovedChange && storedUrl && !draft && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                disabled={disabled || busy}
                onClick={() => onRemovedChange(!removed)}
              >
                {removed ? (
                  <>
                    <Undo2 className="mr-1 h-3.5 w-3.5" /> Keep photo
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                  </>
                )}
              </Button>
            )}
          </div>
          {/* DPR's steps 1 and 2, shown only until both are allowed. */}
          {!cameraReady && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">To take a photo, allow:</span>
              {(
                [
                  ["Camera", cameraStatus, checkCamera],
                  ["Location", locationStatus, checkLocation],
                ] as const
              ).map(([label, status, check]) => (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-6 px-2 text-[11px]",
                    status === "granted" && "border-green-500 text-green-700",
                    status === "denied" && "border-red-500 text-red-700"
                  )}
                  disabled={disabled || busy || status === "granted"}
                  onClick={async () => {
                    const message = await check();
                    toast({ title: `${label} check`, description: String(message) });
                  }}
                >
                  {status === "granted" ? (
                    <CheckCircle className="mr-1 h-3 w-3" />
                  ) : status === "denied" ? (
                    <X className="mr-1 h-3 w-3" />
                  ) : label === "Camera" ? (
                    <Camera className="mr-1 h-3 w-3" />
                  ) : (
                    <MapPin className="mr-1 h-3 w-3" />
                  )}
                  {label}
                </Button>
              ))}
            </div>
          )}
          {blocked && (
            <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-600">
              Camera or location is blocked. Enable both from{" "}
              <strong>Settings → Apps → Browser → Permissions</strong>, then reopen this dialog.
              Upload still works, without a location.
            </p>
          )}
          {draft?.source === "upload" && (
            <p className="text-[11px] text-muted-foreground">
              An uploaded photo has no location, so there is no Location link. Use Take photo
              on site to record where it is.
            </p>
          )}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />

      {/* Rendered only while open: unmounting is what stops the camera stream. */}
      {cameraOpen && (
        <Dialog open onOpenChange={(open) => !open && setCameraOpen(false)}>
          <DialogContent className="max-w-lg border-none bg-transparent p-0 shadow-none">
            <DialogTitle className="sr-only">Take photo</DialogTitle>
            <CameraCapture
              project_id=""
              report_date=""
              GEO_API={apiKey}
              onCaptureSuccess={() => undefined}
              onCancel={() => setCameraOpen(false)}
              onCaptured={({ file, location }) => {
                setCameraOpen(false);
                void take(() => draftFromCamera(file, location));
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
