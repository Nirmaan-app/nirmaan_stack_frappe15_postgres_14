import React from 'react';
import { useImageOrientation, ImageOrientation } from '@/hooks/useImageOrientation';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface OrientationAwareImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  showLoader?: boolean;
  onOrientationDetected?: (orientation: ImageOrientation) => void;
  forPdf?: boolean; // Flag to apply PDF-specific styling
}

/**
 * Image component that automatically detects orientation and applies appropriate styling
 * to preserve aspect ratio and show full image without cropping
 */
export const OrientationAwareImage: React.FC<OrientationAwareImageProps> = ({
  src,
  alt,
  className,
  containerClassName,
  showLoader = true,
  onOrientationDetected,
  forPdf = false,
}) => {
  const { orientation, isLoading, error } = useImageOrientation(src);

  // Notify parent when orientation is detected
  React.useEffect(() => {
    if (orientation && onOrientationDetected) {
      onOrientationDetected(orientation);
    }
  }, [orientation, onOrientationDetected]);

  // Show loading state
  if (isLoading && showLoader) {
    return (
      <div className={cn(
        "flex items-center justify-center bg-gray-100",
        forPdf ? "h-[200px]" : "min-h-[180px]",
        containerClassName
      )}>
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className={cn(
        "flex items-center justify-center bg-gray-100 text-gray-500 text-sm p-4",
        forPdf ? "h-[200px]" : "min-h-[180px]",
        containerClassName
      )}>
        <span>Failed to load image</span>
      </div>
    );
  }

  // Base image classes
  const baseImageClasses = "w-full object-contain";

  // Orientation-specific classes for regular view
  const orientationClasses = {
    portrait: "max-h-[400px] mx-auto",
    landscape: "max-h-[300px] w-full",
    square: "max-h-[320px] mx-auto",
  };

  // Orientation-specific classes for PDF
  const pdfOrientationClasses = {
    portrait: "max-h-[280px] mx-auto",
    landscape: "max-h-[200px] w-full",
    square: "max-h-[240px] mx-auto",
  };

  const appliedClasses = forPdf
    ? pdfOrientationClasses[orientation || 'square']
    : orientationClasses[orientation || 'square'];

  return (
    <div className={cn(
      "flex items-center justify-center bg-gray-50",
      forPdf ? "h-full" : "min-h-[180px]",
      containerClassName
    )}>
      <img
        src={src}
        alt={alt}
        className={cn(
          baseImageClasses,
          appliedClasses,
          className
        )}
        loading="lazy"
      />
    </div>
  );
};

// Export a simpler variant for cases where we just need the orientation class
export const getOrientationClass = (orientation: ImageOrientation | null, forPdf: boolean = false): string => {
  if (!orientation) return '';

  if (forPdf) {
    const pdfClasses = {
      portrait: "max-h-[280px] mx-auto object-contain",
      landscape: "max-h-[200px] w-full object-contain",
      square: "max-h-[240px] mx-auto object-contain",
    };
    return pdfClasses[orientation];
  }

  const regularClasses = {
    portrait: "max-h-[400px] mx-auto object-contain",
    landscape: "max-h-[300px] w-full object-contain",
    square: "max-h-[320px] mx-auto object-contain",
  };
  return regularClasses[orientation];
};
