import React, { useState, useEffect } from 'react';
import { MapPin, MessagesSquare, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type ImageOrientation = 'portrait' | 'landscape' | 'square';

interface ImageData {
  image_link: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  remarks?: string;
  local_id?: string; // Added for identification
  id?: string; // Added for identification
}

interface ImageWithOrientation extends ImageData {
  orientation: ImageOrientation;
  aspectRatio: number;
}

interface ImageBentoGridProps {
  images: ImageData[];
  forPdf?: boolean;
  maxImagesPerPage?: number;
  isEditable?: boolean;
  onRemove?: (id: string) => void;
  onRemarkChange?: (id: string, value: string) => void;
  disabled?: boolean;
}

/**
 * Pre-loads all images and detects their orientations synchronously
 * before rendering to avoid layout shifts and ensure proper PDF generation
 */
const usePreloadImages = (images: ImageData[]) => {
  const [loadedImages, setLoadedImages] = useState<ImageWithOrientation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!images || images.length === 0) {
      setIsLoading(false);
      return;
    }

    const loadImage = (imageData: ImageData): Promise<ImageWithOrientation> => {
      return new Promise((resolve) => {
        const img = new Image();

        img.onload = () => {
          const aspectRatio = img.naturalWidth / img.naturalHeight;
          let orientation: ImageOrientation;

          if (Math.abs(aspectRatio - 1) < 0.1) {
            orientation = 'square';
          } else if (aspectRatio > 1) {
            orientation = 'landscape';
          } else {
            orientation = 'portrait';
          }

          resolve({
            ...imageData,
            orientation,
            aspectRatio,
          });
        };

        img.onerror = () => {
          // On error, default to square
          resolve({
            ...imageData,
            orientation: 'square',
            aspectRatio: 1,
            });
        };

        img.src = imageData.image_link;
      });
    };

    Promise.all(images.map(loadImage))
      .then((loaded) => {
        setLoadedImages(loaded);
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });
  }, [images]);

  return { loadedImages, isLoading };
};

/**
 * Smart Bento Grid that arranges images based on their orientations
 * Uses a flexible layout that prevents stretching
 */
export const ImageBentoGrid: React.FC<ImageBentoGridProps> = ({
  images,
  forPdf = false,
  maxImagesPerPage = 4,
  isEditable = false,
  onRemove,
  onRemarkChange,
  disabled = false,
}) => {
  const { loadedImages, isLoading } = usePreloadImages(images);

  if (isLoading) {
    return (
      <div className={cn(
        "flex items-center justify-center bg-gray-100",
        forPdf ? "h-[400px]" : "min-h-[300px]"
      )}>
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Loading images...</span>
      </div>
    );
  }

  if (loadedImages.length === 0) {
    return (
      <div className="w-full h-32 bg-gray-100 flex items-center justify-center text-gray-500 rounded-lg border-2 border-dashed border-gray-300">
        <p className="text-base font-medium">No Work Images Available</p>
      </div>
    );
  }

  // For PDF, split into pages of maxImagesPerPage
  if (forPdf) {
    const pages: ImageWithOrientation[][] = [];
    for (let i = 0; i < loadedImages.length; i += maxImagesPerPage) {
      pages.push(loadedImages.slice(i, i + maxImagesPerPage));
    }

    return (
      <>
        {pages.map((pageImages, pageIdx) => (
          <BentoGridPage
            key={pageIdx}
            images={pageImages}
            pageNumber={pageIdx + 1}
            totalPages={pages.length}
            forPdf={true}
          />
        ))}
      </>
    );
  }

  // For regular view, show all images in a single adaptive grid
  return (
    <BentoGridPage
      images={loadedImages}
      forPdf={false}
      isEditable={isEditable}
      onRemove={onRemove}
      onRemarkChange={onRemarkChange}
      disabled={disabled}
    />
  );
};

/**
 * Single page/section of Bento Grid
 */
const BentoGridPage: React.FC<{
  images: ImageWithOrientation[];
  pageNumber?: number;
  totalPages?: number;
  forPdf: boolean;
  isEditable?: boolean;
  onRemove?: (id: string) => void;
  onRemarkChange?: (id: string, value: string) => void;
  disabled?: boolean;
}> = ({ images, forPdf, isEditable, onRemove, onRemarkChange, disabled }) => {
  // Smart layout algorithm: arrange images to minimize empty space
  const getGridLayout = (imgs: ImageWithOrientation[]) => {
    const layout: { image: ImageWithOrientation; span: string }[] = [];

    imgs.forEach((img) => {
      // Determine grid span based on orientation and position
      let span = 'col-span-1 row-span-1';

      if (forPdf) {
        // PDF: Fixed 2x2 grid, each image takes exactly 1 cell
        span = 'col-span-1 row-span-1';
      } else {
        // Regular view: More flexible layout
        if (img.orientation === 'landscape') {
          // Landscape images can span 2 columns if there's space
          span = 'col-span-2 row-span-1';
        } else if (img.orientation === 'portrait') {
          // Portrait images take 1 column but can be taller
          span = 'col-span-1 row-span-1';
        } else {
          // Square images
          span = 'col-span-1 row-span-1';
        }
      }

      layout.push({ image: img, span });
    });

    return layout;
  };

  const layout = getGridLayout(images);

  return (
    <div className={cn(
      "grid gap-3",
      forPdf ? "grid-cols-2 auto-rows-fr" : "grid-cols-2 lg:grid-cols-4 auto-rows-auto"
    )}>
      {layout.map((item, idx) => (
        <div
          key={idx}
          className={cn(
            "rounded-lg overflow-hidden shadow-md bg-white border border-gray-200 relative", // Added relative for positioning removal button
            forPdf && "avoid-page-break-inside",
            !forPdf && item.span
          )}
        >
          <div className="flex flex-col h-full">
            {/* Image container */}
            <div className={cn(
              "w-full flex items-center justify-center bg-gray-50",
              forPdf ? "min-h-[180px]" : "min-h-[200px]"
            )}>
              <img
                src={item.image.image_link}
                alt={`Work Image ${idx + 1}`}
                className={cn(
                  "w-full h-full object-contain",
                  forPdf && getImageHeightClass(item.image.orientation, true),
                  !forPdf && getImageHeightClass(item.image.orientation, false)
                )}
                loading="lazy"
              />
            </div>

            {/* Details section */}
            <div className={cn(
              "w-full flex flex-col justify-between",
              forPdf ? "p-2" : "p-3"
            )}>
              {/* Location */}
              <div className={cn(
                "flex items-center text-gray-700 mb-1",
                forPdf ? "text-xs" : "text-xs"
              )}>
                <MapPin className={cn(
                  "mr-1 text-red-500 flex-shrink-0",
                  forPdf ? "h-3 w-3" : "h-4 w-4"
                )} />
                <span className="font-medium break-words">
                  {item.image.location ||
                    `Lat: ${item.image.latitude?.toFixed(2)}, Lon: ${item.image.longitude?.toFixed(2)}`}
                </span>
              </div>

              {/* Remarks */}
                {/* Edit Mode: Textarea */}
                {isEditable ? (
                   <div className="mt-1">
                      <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Remarks</label>
                      <Textarea
                        value={item.image.remarks || ""}
                        onChange={(e) => onRemarkChange?.(item.image.local_id || item.image.id || "", e.target.value)}
                        placeholder="Add remarks..."
                        className="min-h-[80px] text-xs resize-none"
                        disabled={disabled}
                        onClick={(e) => e.stopPropagation()} 
                      />
                   </div>
                ) : (
                  /* Read-Only Mode */
                  <p className={cn(
                    "bg-yellow-100 text-yellow-900 rounded-md break-words",
                    forPdf ? "p-1.5 text-xs" : "p-2 text-xs"
                  )}>
                    <MessagesSquare className={cn(
                      "inline-block mr-1 flex-shrink-0",
                      forPdf ? "h-3 w-3" : "h-4 w-4"
                    )} />
                    {item.image.remarks || "No remarks provided."}
                  </p>
                )}
              </div>
            </div>
             {/* Remove Button for Editable Mode */}
             {isEditable && (
              <Button
                variant="destructive"
                size="icon"
                className="absolute top-2 right-2 h-7 w-7 rounded-full shadow-md z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove?.(item.image.local_id || item.image.id || "");
                }}
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

      ))}
    </div>
  );
};

/**
 * Get appropriate max-height class based on orientation
 */
const getImageHeightClass = (orientation: ImageOrientation, forPdf: boolean): string => {
  if (forPdf) {
    return {
      portrait: 'max-h-[220px]',
      landscape: 'max-h-[160px]',
      square: 'max-h-[190px]',
    }[orientation];
  }

  return {
    portrait: 'max-h-[350px]',
    landscape: 'max-h-[250px]',
    square: 'max-h-[300px]',
  }[orientation];
};
