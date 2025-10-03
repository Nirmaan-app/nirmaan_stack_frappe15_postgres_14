// CameraCapture.tsx
import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, RefreshCw, MapPin, Upload, X } from "lucide-react"; // Import X for retake button
import { Button } from "@/components/ui/button";
import { TailSpin } from "react-loader-spinner";
import { toast } from "@/components/ui/use-toast";
import { useFrappeGetDoc, useFrappeFileUpload } from "frappe-react-sdk";

// UPDATED: Define the structure for the photo data that will be returned to the parent
interface CapturedPhotoData {
  image_link: string; // The uploaded file_url
  location: string | null; // The combined location string
  remarks: string; // General remarks for the photo
  local_id: string; // Temporary ID for local state management in MilestoneTab
}

interface CameraCaptureProps {
  report_date: string;
  project_id: string;
  onCaptureSuccess: (photo: CapturedPhotoData) => void;
  onCancel: () => void;
}

// UPDATED: New helper to get coordinates and a user-friendly location string including city name
const getLocationAndCityName = async (GEO_API): Promise<{ lat: number | null, lon: number | null, formattedLocation: string | null }> => {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      toast({ title: "Geolocation Error 🗺️", description: "Geolocation is not supported by your browser.", variant: "destructive" });
      return resolve({ lat: null, lon: null, formattedLocation: "Geolocation Not Supported" });
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        let cityName: string | null = null;

        try {
          // const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
          const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${GEO_API}`);


          // https://maps.googleapis.com/maps/api/geocode/json?latlng=40.714224,-73.961452&key=YOUR_API_KEY

          const data = await response.json();
          console.log("location data", data.results[0].formatted_address)
          // Nominatim's response structure varies, you might need to dig into 'address' object
          cityName = data?.results[0]?.formatted_address

        } catch (apiError) {
          console.error("Reverse geocoding API error:", apiError);
          cityName = "Unknown City"; // Fallback if API fails
        }
        // --- END: Integration Point for Reverse Geocoding API ---

        const formattedLocation = `${cityName || 'Location'} (Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)})`;
        resolve({ lat, lon, formattedLocation });
      },
      (error) => {
        console.error("CameraCapture: Location error:", error);
        toast({ title: "Location Error 🗺️", description: "Could not fetch location. Please check permissions.", variant: "destructive" });
        resolve({ lat: null, lon: null, formattedLocation: "Location Not Found (Error)" });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
};


const CameraCapture: React.FC<CameraCaptureProps> = ({
  project_id,
  report_date,
  onCaptureSuccess,
  onCancel,
  GEO_API
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { upload: uploadFile, loading: isfileUploading } = useFrappeFileUpload()

  // UPDATED State: Single location string and remarks
  const [currentLocationString, setCurrentLocationString] = useState<string | null>(null);
  const [currentRemarks, setCurrentRemarks] = useState('');

  const frappeFileUpload = useFrappeFileUpload(); // Get the object directly
  const isUploading = frappeFileUpload.loading; // Use loading state from the hook

  const startCamera = useCallback(async (mode: 'user' | 'environment') => {
    setIsLoading(true);

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    setStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    try {
      const isMobile = /Mobi|Android/i.test(navigator.userAgent);

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: isMobile ? mode : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;

        const playVideo = (videoEl: HTMLVideoElement) => {
          return new Promise<void>(resolve => {
            const checkReady = () => {
              if (videoEl.readyState >= 3) {
                videoEl.play().then(() => {
                  resolve();
                }).catch(err => {
                  console.warn("CameraCapture: Video play interrupted (expected):", err);
                  resolve();
                });
                videoEl.removeEventListener('canplay', checkReady);
              }
            };
            videoEl.addEventListener('canplay', checkReady);
            if (videoEl.readyState >= 3) {
              checkReady();
            }
          });
        };

        await playVideo(videoRef.current);
      }
    } catch (err) {
      console.error("CameraCapture: Error accessing camera:", err);
      toast({
        title: "Camera Access Error 🚫",
        description: "Could not access camera. Please check permissions.",
        variant: "destructive",
      });
      setStream(null);
    } finally {
      setIsLoading(false);

    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [facingMode, startCamera]);


  const switchCamera = () => {
    setFacingMode(prev => (prev === 'user' ? 'environment' : 'user'));
    setCapturedImage(null);
    setCurrentLocationString(null); // Reset location string
    setCurrentRemarks(''); // Reset remarks
  };

  const captureImage = async () => {
    if (videoRef.current && canvasRef.current) {
      setIsLoading(true);
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      setStream(null);

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageDataUrl = canvas.toDataURL('image/jpeg');
        setCapturedImage(imageDataUrl);

        const userLocationData = await getLocationAndCityName(GEO_API); // Use new helper
        setCurrentLocationString(userLocationData.formattedLocation);
      }
      setIsLoading(false);
    }
  };

  const uploadAndSave = async () => {
    if (!capturedImage) {
      return;
    }

    setIsLoading(true);
    try {
      const blob = await fetch(capturedImage).then(res => res.blob());
      const fileName = `photo_${Date.now()}.jpeg`;
      const file = new File([blob], fileName, { type: 'image/jpeg' });

      console.log("CameraCapture: Uploading file:", file);

      const fileResponse = await uploadFile(file, { // Use frappeFileUpload object
        doctype: "Project Progress Report Attachment",
        fieldname: "image_link", // Ensure this fieldname matches your DocType
        isPrivate: true // Good practice for personal info
      });
      const frappeFileUrl = fileResponse.file_url;

      const photoPayload: CapturedPhotoData = {
        local_id: `temp_${Date.now()}`,
        image_link: frappeFileUrl,
        location: currentLocationString, // Use the formatted string
        remarks: currentRemarks, // Use the current remarks
      };

      toast({
        title: "Photo Uploaded! 🚀",
        description: `Image uploaded to Frappe. Details ready for report submission.`,
        variant: "default",
      });

      onCaptureSuccess(photoPayload);
    stopCameraStream(); 


    } catch (error: any) {
      console.error("CameraCapture: Caught error in uploadAndSave:", error);
      toast({
        title: "Upload Failed ❌",
        description: error.message || "An unknown error occurred during file upload.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);

    }
  };


  const stopCameraStream = useCallback(() => {
    if (stream) {
        console.log("CameraCapture: Explicitly stopping camera stream tracks.");
        stream.getTracks().forEach(track => track.stop());
    }
    if (videoRef.current) {
        console.log("CameraCapture: Clearing video srcObject.");
        videoRef.current.srcObject = null;
    }
}, []);

 // NEW Local Cancel Handler
  const handleCancel = () => {
    stopCameraStream(); 
    onCancel();
  };


  const retakePhoto = () => {
    setCapturedImage(null);
    setCurrentLocationString(null); // Reset location string
    setCurrentRemarks(''); // Reset remarks
    startCamera(facingMode);
  };



  return (
    <div className="flex flex-col h-full items-center justify-center p-4 bg-gray-900 rounded-lg">
      <h3 className="text-xl font-bold text-white mb-4">Camera Capture</h3>

      <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden mb-4">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <TailSpin height={40} width={40} color="#6366F1" />
          </div>
        )}

        {capturedImage ? (
          <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
        ) : (
          <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      <div className="flex gap-4 w-full justify-center mb-4">
        {!capturedImage ? (
          <>
            <Button variant="secondary" onClick={switchCamera} disabled={!stream || isLoading}>
              <RefreshCw className="h-5 w-5 mr-2" /> Switch Camera
            </Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white p-4 rounded-full shadow-lg" onClick={captureImage} disabled={!stream || isLoading}>
              <Camera className="h-5 w-6" />
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={retakePhoto} disabled={isLoading || isUploading}>
              <X className="h-5 w-5 mr-2" /> Retake
            </Button>
            <Button variant="default" className="bg-red-600 hover:bg-red-700" onClick={uploadAndSave} disabled={isLoading || isUploading || !capturedImage}>
              {isUploading ? <TailSpin height={20} width={20} color="#fff" /> : <Upload className="h-5 w-5 mr-2" />}
              Upload & Save
            </Button>
          </>
        )}
      </div>

      {capturedImage && (
        <div className="w-full p-3 bg-gray-800 rounded-lg space-y-3">
          <div className="flex items-center text-sm text-gray-300">
            <MapPin className="h-4 w-4 mr-2 text-red-400" />
            <span className="font-semibold">Location:</span>
            <span className="ml-2">{currentLocationString || 'Location Not Found'}</span> {/* Use currentLocationString */}
          </div>
          <textarea
            value={currentRemarks} // Use currentRemarks
            onChange={(e) => setCurrentRemarks(e.target.value)}
            placeholder="Add remarks for this photo..."
            className="w-full p-2 border border-gray-700 rounded-md bg-gray-700 text-white text-sm min-h-[60px]"
            rows={2}
          />
        </div>
      )}

      <Button variant="ghost" onClick={handleCancel} className="mt-4 text-white">
        Cancel
      </Button>
    </div>
  );
};

export default CameraCapture;