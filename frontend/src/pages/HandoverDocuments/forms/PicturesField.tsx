// O&M pictures for THIS project and system: users upload them here (not in the shared library).
// Each is a private File attached to the row; the list { url, caption } lives in `form_data.pictures`
// and is saved with the dialog. The PDF prints them after the manual text, two per row.

import { useFrappeFileUpload } from "frappe-react-sdk";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

import { HOD_DOCTYPE } from "../hodApi";
import { asObjectList, asString } from "../hodRules";
import type { HodPicture } from "../types";
import type { FormProps } from "./TableForms";

export const PicturesField: React.FC<FormProps & { rowName: string }> = ({
  value,
  onChange,
  readOnly,
  rowName,
}) => {
  const pictures = asObjectList<HodPicture>(value.pictures);
  const { upload } = useFrappeFileUpload();
  const [uploading, setUploading] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Uploads finish one by one; always append to the latest list, not the one the upload started with.
  const latest = React.useRef({ value, pictures });
  latest.current = { value, pictures };

  const setPictures = (next: HodPicture[]) =>
    onChange({ ...latest.current.value, pictures: next });

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Not a picture",
          description: `${file.name} is not an image.`,
          variant: "destructive",
        });
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const res = await upload(file, {
          doctype: HOD_DOCTYPE,
          docname: rowName,
          isPrivate: true,
        });
        setPictures([
          ...latest.current.pictures,
          { url: res.file_url, caption: "" },
        ]);
      } catch (error) {
        toast({
          title: `Could not upload ${file.name}`,
          description: getFrappeError(error),
          variant: "destructive",
        });
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-700">
            Pictures for this project
          </p>
          <p className="text-xs text-gray-500">
            Printed after the manual text, two per row, with their captions.
          </p>
        </div>
        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={uploading > 0}
            onClick={() => inputRef.current?.click()}
          >
            {uploading > 0 ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImagePlus className="mr-1 h-3.5 w-3.5" />
            )}
            {uploading > 0 ? `Uploading ${uploading}…` : "Add pictures"}
          </Button>
        )}
      </div>

      {pictures.length === 0 ? (
        <p className="py-3 text-center text-sm text-gray-400">
          No pictures yet.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pictures.map((p, i) => (
            <div
              key={`${p.url}-${i}`}
              className="space-y-1.5 rounded-md border bg-gray-50 p-2"
            >
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="block"
              >
                <img
                  src={p.url}
                  alt={asString(p.caption) || `Picture ${i + 1}`}
                  className="h-36 w-full rounded object-contain"
                />
              </a>
              <div className="flex items-center gap-1">
                <Input
                  className="h-8 text-sm"
                  placeholder="Caption"
                  value={asString(p.caption)}
                  disabled={readOnly}
                  onChange={(e) =>
                    setPictures(
                      pictures.map((x, j) =>
                        j === i ? { ...x, caption: e.target.value } : x,
                      ),
                    )
                  }
                />
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-gray-400 hover:text-red-600"
                    title="Remove picture"
                    onClick={() =>
                      setPictures(pictures.filter((_, j) => j !== i))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onFiles}
      />
    </div>
  );
};
