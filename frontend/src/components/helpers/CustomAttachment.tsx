import { cn } from "@/lib/utils";
import { Paperclip, X } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from "react";

export type AcceptedFileType = 
  "image/*" | 
  "application/pdf" | 
  "text/csv" | 
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface CustomAttachmentProps {
  selectedFile?: File | null;
  onFileSelect: (file: File | null) => void;
  acceptedTypes?: AcceptedFileType | AcceptedFileType[];
  label?: string;
  maxFileSize?: number; // In bytes
  className?: string;
  disabled?: boolean;
  onError?: (error: { type: "size" | "type", message: string }) => void;
}

export const CustomAttachment = React.forwardRef<
  HTMLInputElement,
  CustomAttachmentProps
>(({
  onFileSelect,
  acceptedTypes = '*/*',
  label = 'Upload File',
  selectedFile,
  maxFileSize = 5 * 1024 * 1024, // 5MB default
  className,
  disabled = false,
  onError,
}, ref) => {
  const inputId = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File) => {
    if (maxFileSize && file.size > maxFileSize) {
      onError?.({
        type: "size",
        message: `File size exceeds ${maxFileSize / 1024 / 1024}MB limit`
      });
      return false;
    }

    if (acceptedTypes !== '*/*' && !file.type.match(new RegExp(
      (Array.isArray(acceptedTypes) ? acceptedTypes.join("|") : acceptedTypes
    ))) ) {
      onError?.({
        type: "type",
        message: `Unsupported file type: ${file.type}`
      });
      return false;
    }

    return true;
  }, [acceptedTypes, maxFileSize, onError]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!validateFile(file)) {
      e.target.value = ''; // Reset input
      return;
    }

    onFileSelect(file);
    setPreview(URL.createObjectURL(file));
  }, [onFileSelect, validateFile]);

  const handleRemove = useCallback(() => {
    onFileSelect(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [onFileSelect]);

  // Cleanup preview URL
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  return (
    <div className={cn("space-y-2 w-full", className)}>
      <label
        htmlFor={inputId}
        className={cn(
          "flex items-center justify-center gap-2 p-2 border rounded-md cursor-pointer",
          "transition-colors duration-200 hover:bg-accent/20",
          "focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2",
          disabled ? "opacity-50 cursor-not-allowed" : "",
          selectedFile ? "border-primary opacity-50 cursor-not-allowed" : "border-input"
        )}
        aria-disabled={disabled}
      >
        <Paperclip className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="text-sm font-medium text-primary">{label}</span>
        <input
          ref={inputRef}
          id={inputId}
          accept={Array.isArray(acceptedTypes) ? acceptedTypes.join(",") : acceptedTypes}
          type="file"
          className="sr-only"
          onChange={handleChange}
          disabled={disabled || !!selectedFile}
          aria-labelledby={`${inputId}-label`}
        />
      </label>

      {selectedFile && (
        <div className="flex items-center justify-between p-2 bg-accent/10 rounded-md">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <a
              href={preview ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "text-sm truncate max-w-[150px] hover:underline",
                preview ? "text-primary" : "text-muted-foreground"
              )}
              aria-label={`View ${selectedFile.name}`}
            >
              {selectedFile.name}
            </a>
            <span className="text-xs text-muted-foreground">
              ({(selectedFile.size / 1024).toFixed(1)}KB)
            </span>
          </div>
          
          <button
            type="button"
            onClick={handleRemove}
            className="p-1 rounded-full hover:bg-accent/20 transition-colors"
            aria-label="Remove file"
          >
            <X className="h-4 w-4 text-destructive" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
});

CustomAttachment.displayName = "CustomAttachment";