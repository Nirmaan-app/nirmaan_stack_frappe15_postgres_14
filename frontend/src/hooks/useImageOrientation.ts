import { useState, useEffect } from 'react';

export type ImageOrientation = 'portrait' | 'landscape' | 'square';

interface ImageOrientationResult {
  orientation: ImageOrientation | null;
  isLoading: boolean;
  error: Error | null;
  dimensions: { width: number; height: number } | null;
}

/**
 * Custom hook to detect image orientation by loading the image and checking its dimensions
 * @param imageUrl - URL of the image to analyze
 * @returns Object containing orientation, loading state, error, and dimensions
 */
export const useImageOrientation = (imageUrl: string): ImageOrientationResult => {
  const [orientation, setOrientation] = useState<ImageOrientation | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setIsLoading(false);
      setError(new Error('No image URL provided'));
      return;
    }

    setIsLoading(true);
    setError(null);

    const img = new Image();

    img.onload = () => {
      const { naturalWidth, naturalHeight } = img;

      setDimensions({ width: naturalWidth, height: naturalHeight });

      // Determine orientation based on aspect ratio
      const aspectRatio = naturalWidth / naturalHeight;

      if (Math.abs(aspectRatio - 1) < 0.1) {
        // Nearly square (aspect ratio close to 1:1)
        setOrientation('square');
      } else if (aspectRatio > 1) {
        // Width > Height = Landscape
        setOrientation('landscape');
      } else {
        // Height > Width = Portrait
        setOrientation('portrait');
      }

      setIsLoading(false);
    };

    img.onerror = () => {
      setError(new Error('Failed to load image'));
      setIsLoading(false);
    };

    img.src = imageUrl;

    // Cleanup function
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [imageUrl]);

  return { orientation, isLoading, error, dimensions };
};
